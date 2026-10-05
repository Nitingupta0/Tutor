"""Measure how well search finds the right note for a question.

    python -m evals.retrieval                       # compare vector vs hybrid on evals/retrieval_set.jsonl
    python -m evals.retrieval --modes hybrid --show-misses

Each line of the set is {"q": question, "expect": [note file names], "kind": "keyword|paraphrase|vague"}.
A question counts as found at rank r if any expected note appears at position r (1-based) in the results.
Reported: hit@1 / hit@3 / hit@5 (share of questions found within the top 1/3/5) and MRR (mean of 1/rank,
0 when not found). Run it against an index built from the bundled notes (`python ingest.py`) for numbers
that are comparable over time. The cache is bypassed so every mode is measured fresh.
"""
import argparse
import json
from pathlib import Path

DEFAULT_SET = Path(__file__).with_name("retrieval_set.jsonl")
CUTOFFS = (1, 3, 5)


def load_set(path=DEFAULT_SET) -> list[dict]:
    items = []
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        if line.strip():
            item = json.loads(line)
            items.append({"q": item["q"], "expect": set(item["expect"]), "kind": item.get("kind", "other")})
    return items


def first_hit_rank(sources: list[str], expected: set[str]) -> int | None:
    """1-based rank of the first result whose note is one of the expected ones."""
    for rank, source in enumerate(sources, start=1):
        if Path(source).name in expected:
            return rank
    return None


def score(ranks: list[int | None]) -> dict:
    n = len(ranks) or 1
    out = {f"hit@{k}": sum(1 for r in ranks if r is not None and r <= k) / n for k in CUTOFFS}
    out["mrr"] = sum(1 / r for r in ranks if r is not None) / n
    return out


def evaluate(search, items: list[dict], mode: str, k: int = max(CUTOFFS)) -> dict:
    """`search(query, top_k, mode)` returns [(source, content), ...]."""
    rows = []
    for item in items:
        sources = [source for source, _content in search(item["q"], k, mode)]
        rows.append({**item, "rank": first_hit_rank(sources, item["expect"]), "got": sources[:3]})
    by_kind = {kind: score([r["rank"] for r in rows if r["kind"] == kind]) for kind in sorted({r["kind"] for r in rows})}
    return {"mode": mode, "overall": score([r["rank"] for r in rows]), "by_kind": by_kind, "rows": rows}


def report(results: list[dict], show_misses: bool = False) -> str:
    pct = lambda x: f"{100 * x:.0f}%"  # noqa: E731
    lines = ["| mode | hit@1 | hit@3 | hit@5 | MRR |", "|---|---|---|---|---|"]
    for res in results:
        o = res["overall"]
        lines.append(f"| {res['mode']} | {pct(o['hit@1'])} | {pct(o['hit@3'])} | {pct(o['hit@5'])} | {o['mrr']:.2f} |")
    kinds = sorted({kind for res in results for kind in res["by_kind"]})
    lines += ["", "hit@3 by question kind:", "", "| mode | " + " | ".join(kinds) + " |", "|---|" + "---|" * len(kinds)]
    for res in results:
        lines.append(f"| {res['mode']} | " + " | ".join(pct(res["by_kind"][k]["hit@3"]) for k in kinds) + " |")
    if show_misses:
        for res in results:
            misses = [r for r in res["rows"] if r["rank"] is None or r["rank"] > 3]
            lines += ["", f"{res['mode']}: {len(misses)} question(s) not in the top 3"]
            lines += [f"  - [{r['kind']}] {r['q']}  -> got {r['got']}" for r in misses]
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--set", default=DEFAULT_SET, help="JSONL file of questions")
    parser.add_argument("--modes", default="vector,hybrid", help="comma-separated: vector, hybrid")
    parser.add_argument("--show-misses", action="store_true", help="list questions not found in the top 3")
    args = parser.parse_args()

    import retrieve

    def search(query, top_k, mode):
        return retrieve.search(query, top_k, mode=mode, use_cache=False)[0]

    items = load_set(args.set)
    results = [evaluate(search, items, mode.strip()) for mode in args.modes.split(",") if mode.strip()]
    print(f"{len(items)} questions from {args.set}\n")
    print(report(results, args.show_misses))


if __name__ == "__main__":
    main()
