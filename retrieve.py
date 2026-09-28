import json
from functools import lru_cache

import redis

import config
import db
import embed


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


def search(query: str, top_k: int = config.TOP_K) -> tuple[list[tuple[str, str]], bool]:
    """Return (top-k (source, content) chunks, whether they came from the cache)."""
    key = f"query:{query}:{top_k}"
    cached = _cache_get(key)
    if cached:
        return [tuple(x) for x in json.loads(cached)], True

    embedding = embed.encode(query)

    conn = db.connect()
    cur = conn.cursor()
    cur.execute(
        "SELECT source, content FROM document_chunks ORDER BY embedding <=> %s LIMIT %s",
        (embedding, top_k),
    )
    results = cur.fetchall()
    conn.close()

    _cache_set(key, json.dumps(results))
    return results, False


def retrieve(query: str, top_k: int = config.TOP_K) -> list[tuple[str, str]]:
    return search(query, top_k)[0]


if __name__ == "__main__":
    for source, content in retrieve("binary search"):
        print(source, "-", content[:80])
