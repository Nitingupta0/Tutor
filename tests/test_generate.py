import pytest

import generate
import retrieve

CHUNKS = [("binary-search.md", "halve the interval"), ("dp.md", "memoize states")]


@pytest.fixture
def stub_pipeline(monkeypatch):
    calls = {}
    monkeypatch.setattr(retrieve, "search", lambda q, top_k=5: (CHUNKS, False))

    def fake_llm(system_prompt, user_content):
        calls["system"], calls["user"] = system_prompt, user_content
        return "the answer"

    def fake_stream(system_prompt, user_content):
        calls["system"] = system_prompt
        yield from ["the ", "answer"]

    monkeypatch.setattr(generate, "call_llm", fake_llm)
    monkeypatch.setattr(generate, "stream_llm", fake_stream)
    return calls


def test_build_context_keeps_file_names_away_from_the_llm():
    context = generate.build_context(CHUNKS)
    assert "halve the interval" in context and "memoize states" in context
    assert ".md" not in context


@pytest.mark.parametrize("mode", ["answer", "hint", "debug"])
def test_every_prompt_forbids_mentioning_sources(mode):
    assert "Never mention the context" in generate.SYSTEM_PROMPTS[mode]


@pytest.mark.parametrize("mode", ["answer", "hint", "debug"])
def test_each_mode_uses_its_own_system_prompt(stub_pipeline, mode):
    result = generate.ask("what is binary search?", mode)
    assert stub_pipeline["system"] is generate.SYSTEM_PROMPTS[mode]
    assert "halve the interval" in stub_pipeline["user"]
    assert "binary-search.md" not in stub_pipeline["user"]
    assert stub_pipeline["user"].endswith("what is binary search?")
    assert result == {"answer": "the answer", "passages": 2, "cached": False}


def test_answer_is_logged_with_its_sources(stub_pipeline, no_mongo):
    generate.ask("q", "hint")
    assert no_mongo == [("q", "hint", CHUNKS, "the answer")]


def test_unknown_mode_is_rejected(stub_pipeline):
    with pytest.raises(ValueError):
        generate.ask("q", "spoil-everything")


def test_stream_emits_grounding_then_tokens_then_done(stub_pipeline, no_mongo):
    events = list(generate.ask_stream("q", "answer"))
    assert events[0] == {"type": "grounding", "passages": 2, "cached": False}
    assert "binary-search.md" not in str(events)
    assert [e["text"] for e in events if e["type"] == "token"] == ["the ", "answer"]
    assert events[-1] == {"type": "done"}
    assert no_mongo[-1][3] == "the answer"


def test_missing_api_key_gives_a_clear_error(monkeypatch):
    generate.get_client.cache_clear()
    monkeypatch.setattr(generate.config, "GROQ_API_KEY", None)
    with pytest.raises(RuntimeError, match="GROQ_API_KEY"):
        generate.get_client()
    generate.get_client.cache_clear()
