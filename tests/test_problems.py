import db
import problems
from tests.conftest import FakeConn

ROW = ("codeforces", "4A", "Watermelon", "https://codeforces.com/problemset/problem/4/A", ["math"], 800, None)
SIMILAR = ("codeforces", "71A", "Way Too Long Words", "https://codeforces.com/problemset/problem/71/A", ["strings"], 800, None, 0.61234)


def test_extract_ids():
    assert problems.extract_ids("show me CF 1850A please") == ["1850A"]
    assert problems.extract_ids("4a and 1352 C1") == ["4A", "1352C1"]
    assert problems.extract_ids("two numbers that sum to a target") == []


def test_problem_text():
    assert problems.problem_text("Watermelon", ["math", "brute force"]) == "Watermelon. Topics: math, brute force."
    assert problems.problem_text("X", []) == "X. Topics: general."


def test_exact_match_comes_first_then_similar(monkeypatch, fake_embed, no_mongo):
    conn = FakeConn(results=[[ROW], [SIMILAR]])
    monkeypatch.setattr(db, "connect", lambda: conn)

    results = problems.find_problems("4A", k=2)

    assert [(p["id"], p["match"]) for p in results] == [("4A", "exact"), ("71A", "similar")]
    assert results[1]["score"] == 0.6123
    # the similar search must exclude what was already matched exactly
    assert conn.executed[1][1][1] == ["4A"]
    assert no_mongo[-1][1] == "fetch"


def test_similar_search_skipped_when_exact_matches_fill_k(monkeypatch, fake_embed):
    conn = FakeConn(results=[[ROW]])
    monkeypatch.setattr(db, "connect", lambda: conn)

    assert len(problems.find_problems("4A", k=1)) == 1
    assert len(conn.executed) == 1
