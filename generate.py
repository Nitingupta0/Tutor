from collections.abc import Iterator
from functools import lru_cache

import config
import log
import retrieve

ANSWER_PROMPT = """You are a DSA tutor. Use the provided context to answer the
        user's question. If the context doesn't cover it, use your own knowledge, but
        stay consistent with the brute-force → bottleneck → tool framework."""
HINT_PROMPT = """You are a DSA tutor. Use the provided context to provide the user a
        hint/ point at where to look. Do not rewrite or provide the complete solution
        and just point where to look at. while answering keep 3 things in mind :
        1. Never mention specific function/filenames from context .
        2.Never give step-by-step directions.
        3.Prefer asking a guiding question over stating a fact.
        If the context is not enough , use your own knowledge
        ,but stay consistent with the brute-force -> bottleneck -> tool framework """
DEBUG_PROMPT = """You are a DSA tutor. Use the provided context to help debug the user's
        code and problem. Locate the bug and explain what's wrong - not rewrite the whole solution
        from scratch. If the context is not enough , use your own knowledge."""

# Users never see the notes themselves, so answers must read as the tutor's own explanation.
NO_SOURCES_RULE = """
        Never mention the context, your notes, sources, documents or file names in your
        reply — explain things directly, as your own knowledge."""

# The page draws these two kinds of code block as pictures (static/app.js). Hints stay picture-free:
# a step-by-step trace would give the answer away.
VISUALS_RULE = """
        When a picture genuinely makes the idea clearer, add one visual (two at most). Most
        replies need none, and never draw what the text already makes obvious.
        - A tree (recursion tree, BST, heap, trie): a ```tree code block with one node per line
          and each child indented two spaces more than its parent; write "-" for a missing
          child. Write every call or node on its own line, even when the same label repeats,
          and check it against the algorithm, e.g. for fib(3):
          fib(3)
            fib(2)
              fib(1)
              fib(0)
            fib(1)
        - Other structure or flow (graphs, state machines, decisions): a ```mermaid code block
          with a flowchart (flowchart TD or LR), at most about 15 nodes. Give every node its
          own id even when labels repeat, and put labels containing symbols in quotes, e.g.
          A["mid = (lo + hi) / 2"].
        - An algorithm moving over an array (binary search, two pointers, sliding window, a
          sorting pass, prefix sums): a ```trace code block containing only JSON, shaped like
          {"title": "Binary search for 7", "array": [1, 3, 5, 7, 9],
           "steps": [{"pointers": {"lo": 0, "mid": 2, "hi": 4}, "active": [0, 4], "mark": [2],
                      "done": [], "vars": {"a[mid]": 5}, "note": "5 < 7, so the answer is right of mid"}]}
          pointers map a short name to an index; active is the inclusive index range still in
          play; mark highlights the cells being looked at; done marks finished cells; vars shows
          a few running values; a step may carry its own "array" when values change (a swap).
          Use a small example (at most 12 elements, 10 steps) and make every step correct.
        Explain in words as well: a visual supports the explanation, it never replaces it."""

SYSTEM_PROMPTS = {
    "answer": ANSWER_PROMPT + NO_SOURCES_RULE + VISUALS_RULE,
    "hint": HINT_PROMPT + NO_SOURCES_RULE,
    "debug": DEBUG_PROMPT + NO_SOURCES_RULE + VISUALS_RULE,
}
LLM_MODES = tuple(SYSTEM_PROMPTS)


def build_context(chunks: list[tuple[str, str]]) -> str:
    """Only the passage text goes to the LLM — file names stay internal."""
    return "\n\n---\n\n".join(content for _source, content in chunks)


def build_user_content(context: str, query: str) -> str:
    return f"Context:\n{context}\n\nQuestion:\n{query}"


# Follow-ups ("explain step 2 again") need the recent conversation. It is capped here as well as in the
# browser, so a client can't run up the LLM bill by sending a huge history.
MAX_HISTORY_TURNS = 6        # three question/answer exchanges
MAX_TURN_CHARS = 2000


def clean_history(history) -> list[dict]:
    """Keep the last few well-formed turns, each trimmed, as chat messages."""
    turns = []
    for turn in history or []:
        role = turn.get("role") if isinstance(turn, dict) else getattr(turn, "role", None)
        content = turn.get("content") if isinstance(turn, dict) else getattr(turn, "content", None)
        if role in ("user", "assistant") and isinstance(content, str) and content.strip():
            turns.append({"role": role, "content": content.strip()[:MAX_TURN_CHARS]})
    return turns[-MAX_HISTORY_TURNS:]


def retrieval_query(query: str, history: list[dict]) -> str:
    """A follow-up on its own ("why?") retrieves nothing useful, so search with the previous question too."""
    previous = next((t["content"] for t in reversed(history) if t["role"] == "user"), None)
    return f"{previous}\n{query}" if previous else query


@lru_cache(maxsize=1)
def get_client():
    from groq import Groq

    if not config.GROQ_API_KEY:
        raise RuntimeError("GROQ_API_KEY is not set — copy .env.example to .env and add your key.")
    return Groq(api_key=config.GROQ_API_KEY)


def _messages(system_prompt: str, user_content: str, history: list[dict] = ()) -> list[dict]:
    return [
        {"role": "system", "content": system_prompt},
        *history,
        {"role": "user", "content": user_content},
    ]


def call_llm(system_prompt: str, user_content: str, history: list[dict] = ()) -> str:
    response = get_client().chat.completions.create(
        model=config.GROQ_MODEL, messages=_messages(system_prompt, user_content, history)
    )
    return response.choices[0].message.content


def stream_llm(system_prompt: str, user_content: str, history: list[dict] = ()) -> Iterator[str]:
    stream = get_client().chat.completions.create(
        model=config.GROQ_MODEL, messages=_messages(system_prompt, user_content, history), stream=True
    )
    for chunk in stream:
        delta = chunk.choices[0].delta.content if chunk.choices else None
        if delta:
            yield delta


def _check_mode(mode: str) -> None:
    if mode not in SYSTEM_PROMPTS:
        raise ValueError(f"Unknown mode {mode!r}; expected one of {', '.join(LLM_MODES)}")


def ask(query: str, mode: str = "answer", history=None) -> dict:
    """Retrieve, generate and log. Returns the answer and how many passages grounded it.

    `history` is the recent conversation (oldest first) so follow-up questions make sense.
    Which files the passages came from is logged to MongoDB but never returned to users."""
    _check_mode(mode)
    turns = clean_history(history)
    chunks, cached = retrieve.search(retrieval_query(query, turns))
    result = call_llm(SYSTEM_PROMPTS[mode], build_user_content(build_context(chunks), query), turns)
    log.log_query(query, mode, chunks, result)
    return {"answer": result, "passages": len(chunks), "cached": cached}


def ask_stream(query: str, mode: str = "answer", history=None) -> Iterator[dict]:
    """Same as ask(), but yields events: one 'grounding', many 'token', one 'done'."""
    _check_mode(mode)
    turns = clean_history(history)
    chunks, cached = retrieve.search(retrieval_query(query, turns))
    yield {"type": "grounding", "passages": len(chunks), "cached": cached}

    parts = []
    for token in stream_llm(SYSTEM_PROMPTS[mode], build_user_content(build_context(chunks), query), turns):
        parts.append(token)
        yield {"type": "token", "text": token}

    log.log_query(query, mode, chunks, "".join(parts))
    yield {"type": "done"}


def answer(query: str, mode: str = "answer") -> str:
    return ask(query, mode)["answer"]


if __name__ == "__main__":
    print("Answer Mode Test")
    print(answer("what is binary search?", "answer"))
    print("-" * 100, "\n")
    print("Hint Mode Test")
    print(answer("I need to find the first and last position of a target value in a sorted array. "
                 "Where should I start thinking?", "hint"))
    print("-" * 100, "\n")
    print("Debug Mode Test")
    print(answer("""int lowerBound(vector<int>& a, int target) {
                int left = 0, right = a.size() - 1;
                while (left <= right) {
                int mid = left + (right - left) / 2;
                    if (a[mid] < target) left = mid + 1;
                    else right = mid;
                }
                return left;
                }""", "debug"))
