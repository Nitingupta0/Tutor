from pathlib import Path

import pytest

from evals import retrieval

NOTES = {p.name for p in Path("notes").glob("*.md")}


def test_the_question_set_is_well_formed():
    items = retrieval.load_set()
    assert len(items) >= 30
    assert {i["kind"] for i in items} == {"keyword", "paraphrase", "vague"}
    for item in items:
        assert item["q"].strip()
        assert item["expect"] and item["expect"] <= NOTES, f"unknown note in {item}"


def test_first_hit_rank():
    assert retrieval.first_hit_rank(["a.md", "b.md", "c.md"], {"b.md"}) == 2
    assert retrieval.first_hit_rank(["sub/b.md"], {"b.md"}) == 1           # matched by file name
    assert retrieval.first_hit_rank(["a.md"], {"b.md"}) is None


def test_score():
    s = retrieval.score([1, 3, None, 5])
    assert s["hit@1"] == 0.25 and s["hit@3"] == 0.5 and s["hit@5"] == 0.75
    assert s["mrr"] == pytest.approx((1 + 1 / 3 + 1 / 5) / 4)


def test_evaluate_and_report_with_a_fake_search():
    items = [{"q": "a", "expect": {"x.md"}, "kind": "keyword"}, {"q": "b", "expect": {"y.md"}, "kind": "vague"}]

    def search(query, top_k, mode):
        return [("x.md", "")] if query == "a" else [("z.md", ""), ("y.md", "")]

    res = retrieval.evaluate(search, items, "hybrid")
    assert res["overall"]["hit@1"] == 0.5 and res["overall"]["hit@3"] == 1.0
    assert res["by_kind"]["vague"]["mrr"] == 0.5

    text = retrieval.report([res], show_misses=True)
    assert "| hybrid | 50% | 100% | 100% | 0.75 |" in text
    assert "0 question(s) not in the top 3" in text
