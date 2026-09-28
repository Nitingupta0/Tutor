"""`fetch` mode: surface the exact indexed problem, or the most similar ones.

Exact matches are found by problem id (e.g. "1850A", "CF 1850A") or title; everything
else is ranked by cosine similarity between the query and each problem's embedding.
"""
import re

import db
import embed
import log

_ID_PATTERN = re.compile(r"\b(?:cf\s*)?(\d{1,5}\s*[A-Za-z]\d?)\b", re.IGNORECASE)

_COLUMNS = "source, ext_id, title, url, tags, rating, summary"


def problem_text(title: str, tags: list[str], summary: str | None = None) -> str:
    """The text that gets embedded for a problem — shared by the importers and tests."""
    text = f"{title}. Topics: {', '.join(tags) if tags else 'general'}."
    if summary:
        text += f" {summary}"
    return text


def extract_ids(query: str) -> list[str]:
    return [re.sub(r"\s+", "", m).upper() for m in _ID_PATTERN.findall(query)]


def _row_to_dict(row, match: str, score: float | None) -> dict:
    source, ext_id, title, url, tags, rating, summary = row
    return {
        "source": source, "id": ext_id, "title": title, "url": url,
        "tags": list(tags or []), "rating": rating, "summary": summary,
        "match": match, "score": None if score is None else round(float(score), 4),
    }


def find_problems(query: str, k: int = 5) -> list[dict]:
    conn = db.connect()
    cur = conn.cursor()

    exact: list[dict] = []
    ids = extract_ids(query)
    cur.execute(
        f"SELECT {_COLUMNS} FROM problems WHERE upper(ext_id) = ANY(%s::text[]) OR lower(title) = lower(%s) LIMIT %s",
        (ids, query.strip(), k),
    )
    for row in cur.fetchall():
        exact.append(_row_to_dict(row, "exact", 1.0))

    seen = [p["id"] for p in exact]
    remaining = k - len(exact)
    similar: list[dict] = []
    if remaining > 0:
        vector = embed.encode(query)
        cur.execute(
            f"SELECT {_COLUMNS}, 1 - (embedding <=> %s) AS score FROM problems "
            "WHERE NOT (ext_id = ANY(%s::text[])) ORDER BY embedding <=> %s LIMIT %s",
            (vector, seen, vector, remaining),
        )
        for row in cur.fetchall():
            similar.append(_row_to_dict(row[:-1], "similar", row[-1]))

    conn.close()
    results = exact + similar
    log.log_query(query, "fetch", [], results)
    return results
