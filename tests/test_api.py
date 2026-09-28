import json

import pytest
from fastapi.testclient import TestClient

import generate
import main
import problems


@pytest.fixture
def client():
    return TestClient(main.app)


def test_home_serves_the_ui(client):
    r = client.get("/")
    assert r.status_code == 200
    assert "text/html" in r.headers["content-type"]
    assert "constellation" in r.text


def test_static_assets(client):
    for path in ("/static/app.js", "/static/app.css", "/static/constellation.js"):
        assert client.get(path).status_code == 200


def test_health(client):
    assert client.get("/health").json() == {"status": "ok"}


def test_ask_returns_answer_and_passage_count(client, monkeypatch):
    monkeypatch.setattr(generate, "ask", lambda q, m: {"answer": f"{m}:{q}", "passages": 5, "cached": True})
    r = client.post("/ask", json={"question": "what is dp?", "mode": "hint"})
    assert r.status_code == 200
    assert r.json() == {"mode": "hint", "answer": "hint:what is dp?", "passages": 5, "cached": True}


def test_ask_defaults_to_answer_mode(client, monkeypatch):
    monkeypatch.setattr(generate, "ask", lambda q, m: {"answer": m, "passages": 0, "cached": False})
    assert client.post("/ask", json={"question": "x"}).json()["answer"] == "answer"


def test_fetch_mode_returns_problems(client, monkeypatch):
    monkeypatch.setattr(problems, "find_problems", lambda q: [{"id": "4A", "title": "Watermelon"}])
    r = client.post("/ask", json={"question": "4A", "mode": "fetch"})
    assert r.json() == {"mode": "fetch", "problems": [{"id": "4A", "title": "Watermelon"}]}


@pytest.mark.parametrize("body", [
    {"question": "x", "mode": "spoil"},
    {"question": ""},
    {"mode": "answer"},
])
def test_invalid_requests_are_rejected(client, body):
    assert client.post("/ask", json=body).status_code == 422


def test_configuration_errors_become_503(client, monkeypatch):
    def boom(q, m):
        raise RuntimeError("GROQ_API_KEY is not set")

    monkeypatch.setattr(generate, "ask", boom)
    r = client.post("/ask", json={"question": "x"})
    assert r.status_code == 503
    assert "GROQ_API_KEY" in r.json()["detail"]


def _events(response):
    return [json.loads(line[5:]) for line in response.text.split("\n") if line.startswith("data:")]


def test_stream_relays_generator_events(client, monkeypatch):
    def fake_stream(q, m):
        yield {"type": "grounding", "passages": 5, "cached": False}
        yield {"type": "token", "text": "hi"}
        yield {"type": "done"}

    monkeypatch.setattr(generate, "ask_stream", fake_stream)
    r = client.post("/ask/stream", json={"question": "x", "mode": "debug"})
    assert r.headers["content-type"].startswith("text/event-stream")
    assert [e["type"] for e in _events(r)] == ["grounding", "token", "done"]


def test_stream_fetch_mode(client, monkeypatch):
    monkeypatch.setattr(problems, "find_problems", lambda q: [{"id": "4A"}])
    events = _events(client.post("/ask/stream", json={"question": "4A", "mode": "fetch"}))
    assert events == [{"type": "problems", "problems": [{"id": "4A"}]}, {"type": "done"}]


def test_stream_reports_errors_in_band(client, monkeypatch):
    def broken(q, m):
        raise ConnectionError("could not connect to server")
        yield  # pragma: no cover

    monkeypatch.setattr(generate, "ask_stream", broken)
    events = _events(client.post("/ask/stream", json={"question": "x"}))
    assert events == [{"type": "error", "message": "could not connect to server"}]
