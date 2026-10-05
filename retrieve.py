import json
import logging
from functools import lru_cache

import psycopg2
import redis

import config
import db
import embed

logger = logging.getLogger(__name__)


@lru_cache(maxsize=1)
def get_redis():
    return redis.Redis.from_url(config.REDIS_URL, decode_responses=True)


def _cache_get(key: str):
    if not config.REDIS_URL:
        return None  # caching turned off
    try:
        return get_redis().get(key)
    except redis.RedisError:
        return None  # cache is an optimisation — never fail a request because of it


def _cache_set(key: str, value: str) -> None:
    if not config.REDIS_URL:
        return
    try:
        get_redis().set(key, value, ex=config.CACHE_TTL_SECONDS)
    except redis.RedisError:
        pass


VECTOR_SQL = "SELECT source, content FROM document_chunks ORDER BY embedding <=> %(embedding)s LIMIT %(k)s"

# Hybrid search: the top candidates by meaning (vector) and by words (full-text) are fused with reciprocal rank
# fusion, so a passage ranked well by either method rises, and one ranked well by both rises most. The words
# are OR-ed rather than AND-ed: a natural-language question rarely has every word in the right passage.
HYBRID_SQL = """
WITH q AS (
    SELECT replace(plainto_tsquery('english', %(query)s)::text, '&', '|')::tsquery AS terms
),
by_vector AS (
    SELECT id, row_number() OVER (ORDER BY embedding <=> %(embedding)s) AS r
    FROM document_chunks
    ORDER BY embedding <=> %(embedding)s
    LIMIT %(pool)s
),
by_words AS (
    SELECT id, row_number() OVER (ORDER BY ts_rank_cd(content_tsv, q.terms) DESC) AS r
    FROM document_chunks, q
    WHERE content_tsv @@ q.terms
    ORDER BY ts_rank_cd(content_tsv, q.terms) DESC
    LIMIT %(pool)s
)
SELECT c.source, c.content
FROM document_chunks c
LEFT JOIN by_vector v ON v.id = c.id
LEFT JOIN by_words w ON w.id = c.id
WHERE v.id IS NOT NULL OR w.id IS NOT NULL
ORDER BY COALESCE(1.0 / (%(rrf)s + v.r), 0) + COALESCE(1.0 / (%(rrf)s + w.r), 0) DESC, c.id
LIMIT %(k)s
"""


def search(query: str, top_k: int = config.TOP_K, mode: str | None = None,
           use_cache: bool = True) -> tuple[list[tuple[str, str]], bool]:
    """Return (top-k (source, content) chunks, whether they came from the cache)."""
    mode = mode or config.SEARCH_MODE
    key = f"query:{mode}:{query}:{top_k}"
    if use_cache:
        cached = _cache_get(key)
        if cached:
            return [tuple(x) for x in json.loads(cached)], True

    params = {"embedding": embed.encode(query), "query": query, "k": top_k,
              "pool": max(4 * top_k, 20), "rrf": config.RRF_K}
    conn = db.connect()
    cur = conn.cursor()
    try:
        if mode == "hybrid":
            try:
                cur.execute(HYBRID_SQL, params)
            except psycopg2.Error as exc:
                # e.g. the full-text column hasn't been added yet: degrade to vector search instead of failing
                logger.warning("Hybrid search unavailable, using vector search: %s", exc)
                conn.rollback()
                cur.execute(VECTOR_SQL, params)
        else:
            cur.execute(VECTOR_SQL, params)
        results = [tuple(r) for r in cur.fetchall()]
    finally:
        conn.close()

    if use_cache:
        _cache_set(key, json.dumps(results))
    return results, False


def retrieve(query: str, top_k: int = config.TOP_K) -> list[tuple[str, str]]:
    return search(query, top_k)[0]


if __name__ == "__main__":
    for source, content in retrieve("binary search"):
        print(source, "-", content[:80])
