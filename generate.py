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

SYSTEM_PROMPTS = {
    "answer": ANSWER_PROMPT + NO_SOURCES_RULE,
    "hint": HINT_PROMPT + NO_SOURCES_RULE,
    "debug": DEBUG_PROMPT + NO_SOURCES_RULE,
}
LLM_MODES = tuple(SYSTEM_PROMPTS)


def build_context(chunks: list[tuple[str, str]]) -> str:
    """Only the passage text goes to the LLM — file names stay internal."""
    return "\n\n---\n\n".join(content for _source, content in chunks)


def build_user_content(context: str, query: str) -> str:
    return f"Context:\n{context}\n\nQuestion:\n{query}"


@lru_cache(maxsize=1)
def get_client():
    from groq import Groq

    if not config.GROQ_API_KEY:
        raise RuntimeError("GROQ_API_KEY is not set — copy .env.example to .env and add your key.")
    return Groq(api_key=config.GROQ_API_KEY)


def _messages(system_prompt: str, user_content: str) -> list[dict]:
    return [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_content},
    ]


def call_llm(system_prompt: str, user_content: str) -> str:
    response = get_client().chat.completions.create(
        model=config.GROQ_MODEL, messages=_messages(system_prompt, user_content)
    )
    return response.choices[0].message.content


def stream_llm(system_prompt: str, user_content: str) -> Iterator[str]:
    stream = get_client().chat.completions.create(
        model=config.GROQ_MODEL, messages=_messages(system_prompt, user_content), stream=True
    )
    for chunk in stream:
        delta = chunk.choices[0].delta.content if chunk.choices else None
        if delta:
            yield delta


def _check_mode(mode: str) -> None:
    if mode not in SYSTEM_PROMPTS:
        raise ValueError(f"Unknown mode {mode!r}; expected one of {', '.join(LLM_MODES)}")


def ask(query: str, mode: str = "answer") -> dict:
    """Retrieve, generate and log. Returns the answer and how many passages grounded it.

    Which files the passages came from is logged to MongoDB but never returned to users."""
    _check_mode(mode)
    chunks, cached = retrieve.search(query)
    result = call_llm(SYSTEM_PROMPTS[mode], build_user_content(build_context(chunks), query))
    log.log_query(query, mode, chunks, result)
    return {"answer": result, "passages": len(chunks), "cached": cached}


def ask_stream(query: str, mode: str = "answer") -> Iterator[dict]:
    """Same as ask(), but yields events: one 'grounding', many 'token', one 'done'."""
    _check_mode(mode)
    chunks, cached = retrieve.search(query)
    yield {"type": "grounding", "passages": len(chunks), "cached": cached}

    parts = []
    for token in stream_llm(SYSTEM_PROMPTS[mode], build_user_content(build_context(chunks), query)):
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
