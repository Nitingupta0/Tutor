"""Turn a Stack Exchange data dump (Posts.xml) into Markdown notes ready for `ingest.py`.

The dump is published under CC BY-SA (https://archive.org/details/stackexchange). Each
generated note links back to its question and carries the license, as attribution requires.
The file is streamed, so even the multi-GB Stack Overflow dump fits in memory.

    python -m corpus.stackoverflow Posts.xml --out corpus_out/stackoverflow \\
        --tags algorithm,binary-search,dynamic-programming --min-score 10 --limit 2000
    python ingest.py corpus_out/stackoverflow --append
"""
import argparse
import re
import xml.etree.ElementTree as ET
from html.parser import HTMLParser
from pathlib import Path

DEFAULT_TAGS = (
    "algorithm", "data-structures", "binary-search", "dynamic-programming", "graph-algorithm",
    "recursion", "sorting", "time-complexity", "big-o", "tree", "linked-list", "hashmap",
)
LICENSE = "CC BY-SA 4.0"


class _TextExtractor(HTMLParser):
    """HTML → readable text that keeps <pre> blocks as fenced code."""

    def __init__(self):
        super().__init__()
        self.parts: list[str] = []
        self._in_pre = False

    def handle_starttag(self, tag, attrs):
        if tag == "pre":
            self._in_pre = True
            self.parts.append("\n```\n")
        elif tag in ("p", "br", "li", "h1", "h2", "h3", "blockquote"):
            self.parts.append("\n")
        elif tag == "code" and not self._in_pre:
            self.parts.append("`")

    def handle_endtag(self, tag):
        if tag == "pre":
            self._in_pre = False
            self.parts.append("\n```\n")
        elif tag == "code" and not self._in_pre:
            self.parts.append("`")
        elif tag == "p":
            self.parts.append("\n")

    def handle_data(self, data):
        self.parts.append(data)


def html_to_text(html: str) -> str:
    parser = _TextExtractor()
    parser.feed(html)
    return re.sub(r"\n{3,}", "\n\n", "".join(parser.parts)).strip()


def parse_tags(raw: str) -> list[str]:
    """Handles both dump formats: '<a><b>' (older) and '|a|b|' (2023+)."""
    return [t for t in re.split(r"[<>|]", raw or "") if t]


def _rows(path):
    root = None
    for event, elem in ET.iterparse(path, events=("start", "end")):
        if event == "start":
            if root is None:
                root = elem
            continue
        if elem.tag == "row":
            yield dict(elem.attrib)
            root.clear()  # drop processed rows so memory stays flat on huge dumps


def select_questions(path, tags: set[str], min_score: int, limit: int | None) -> dict[str, dict]:
    """Pass 1: questions with an accepted answer, a matching tag and enough votes."""
    questions = {}
    for row in _rows(path):
        if row.get("PostTypeId") != "1" or not row.get("AcceptedAnswerId"):
            continue
        if int(row.get("Score", 0)) < min_score:
            continue
        row_tags = parse_tags(row.get("Tags", ""))
        if not tags.intersection(row_tags):
            continue
        questions[row["AcceptedAnswerId"]] = {
            "id": row["Id"], "title": row.get("Title", ""), "body": row.get("Body", ""),
            "tags": row_tags, "score": int(row.get("Score", 0)),
        }
        if limit is not None and len(questions) >= limit:
            break
    return questions


def attach_answers(path, questions: dict[str, dict]) -> list[dict]:
    """Pass 2: pull the accepted answer body for every selected question."""
    for row in _rows(path):
        q = questions.get(row.get("Id", ""))
        if q is not None and row.get("PostTypeId") == "2":
            q["answer"] = row.get("Body", "")
    return [q for q in questions.values() if "answer" in q]


def to_markdown(q: dict) -> str:
    url = f"https://stackoverflow.com/questions/{q['id']}"
    return (
        f"# {q['title']}\n\n"
        f"Tags: {', '.join(q['tags'])} · Score: {q['score']} · Source: {url} · License: {LICENSE}\n\n"
        f"## Question\n\n{html_to_text(q['body'])}\n\n"
        f"## Accepted answer\n\n{html_to_text(q['answer'])}\n"
    )


def export(path, out_dir, tags=DEFAULT_TAGS, min_score: int = 10, limit: int | None = None) -> int:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    selected = attach_answers(path, select_questions(path, set(tags), min_score, limit))
    for q in selected:
        (out / f"so-{q['id']}.md").write_text(to_markdown(q), encoding="utf-8")
    return len(selected)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("posts_xml")
    parser.add_argument("--out", default="corpus_out/stackoverflow")
    parser.add_argument("--tags", default=",".join(DEFAULT_TAGS))
    parser.add_argument("--min-score", type=int, default=10)
    parser.add_argument("--limit", type=int)
    args = parser.parse_args()

    n = export(args.posts_xml, args.out, [t.strip() for t in args.tags.split(",")], args.min_score, args.limit)
    print(f"Wrote {n} Q&A notes to {args.out}. Next: python ingest.py {args.out} --append")
