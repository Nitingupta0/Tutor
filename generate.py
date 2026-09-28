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

SYSTEM_PROMPTS = {"answer": ANSWER_PROMPT, "hint": HINT_PROMPT, "debug": DEBUG_PROMPT}
LLM_MODES = tuple(SYSTEM_PROMPTS)


def build_context(chunks: list[tuple[str, str]]) -> str:
    return "\n\n".join(f"[{source}] {content}" for source, content in chunks)


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
    """Retrieve, generate and log. Returns the answer plus the chunks it was grounded in."""
    _check_mode(mode)
    chunks, cached = retrieve.search(query)
    result = call_llm(SYSTEM_PROMPTS[mode], build_user_content(build_context(chunks), query))
    log.log_query(query, mode, chunks, result)
    return {"answer": result, "sources": chunks, "cached": cached}


def ask_stream(query: str, mode: str = "answer") -> Iterator[dict]:
    """Same as ask(), but yields events: one 'sources', many 'token', one 'done'."""
    _check_mode(mode)
    chunks, cached = retrieve.search(query)
    yield {"type": "sources", "sources": chunks, "cached": cached}

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
