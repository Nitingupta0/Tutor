"""Import Codeforces problem metadata (via the public API) into the `problems` table.

Only metadata is stored — id, title, tags, rating and a link back to the statement — which
is what `fetch` mode needs to surface the exact or a similar problem.

    python -m corpus.codeforces                              # whole problemset
    python -m corpus.codeforces --min-rating 800 --max-rating 1600 --limit 2000
    python -m corpus.codeforces --from-file problemset.json  # offline, from a saved API response
"""
import argparse
import json

API_URL = "https://codeforces.com/api/problemset.problems"


def fetch_payload(timeout: int = 30) -> dict:
    import requests

    response = requests.get(API_URL, timeout=timeout)
    response.raise_for_status()
    return response.json()


def parse_problems(payload: dict, min_rating: int | None = None, max_rating: int | None = None,
                   limit: int | None = None) -> list[dict]:
    if payload.get("status") != "OK":
        raise ValueError(f"Codeforces API error: {payload.get('comment', 'unknown')}")

    parsed = []
    for p in payload["result"]["problems"]:
        if "contestId" not in p:
            continue
        rating = p.get("rating")
        if min_rating is not None and (rating is None or rating < min_rating):
            continue
        if max_rating is not None and (rating is None or rating > max_rating):
            continue
        parsed.append({
            "source": "codeforces",
            "ext_id": f"{p['contestId']}{p['index']}",
            "title": p["name"],
            "url": f"https://codeforces.com/problemset/problem/{p['contestId']}/{p['index']}",
            "tags": p.get("tags", []),
            "rating": rating,
        })
        if limit is not None and len(parsed) >= limit:
            break
    return parsed


def store(problem_rows: list[dict], batch_size: int = 256) -> int:
    import db
    import embed
    from problems import problem_text

    db.init_schema()
    conn = db.connect()
    cur = conn.cursor()
    for start in range(0, len(problem_rows), batch_size):
        batch = problem_rows[start:start + batch_size]
        vectors = embed.encode([problem_text(p["title"], p["tags"]) for p in batch])
        for p, vector in zip(batch, vectors, strict=True):
            cur.execute(
                """INSERT INTO problems (source, ext_id, title, url, tags, rating, embedding)
                   VALUES (%s, %s, %s, %s, %s, %s, %s)
                   ON CONFLICT (source, ext_id) DO UPDATE SET
                     title = EXCLUDED.title, url = EXCLUDED.url, tags = EXCLUDED.tags,
                     rating = EXCLUDED.rating, embedding = EXCLUDED.embedding""",
                (p["source"], p["ext_id"], p["title"], p["url"], p["tags"], p["rating"], vector),
            )
        conn.commit()
    conn.close()
    return len(problem_rows)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--from-file", help="saved problemset.problems JSON response")
    parser.add_argument("--min-rating", type=int)
    parser.add_argument("--max-rating", type=int)
    parser.add_argument("--limit", type=int)
    args = parser.parse_args()

    if args.from_file:
        with open(args.from_file, encoding="utf-8") as f:
            data = json.load(f)
    else:
        data = fetch_payload()

    rows = parse_problems(data, args.min_rating, args.max_rating, args.limit)
    print(f"Indexed {store(rows)} Codeforces problems.")
