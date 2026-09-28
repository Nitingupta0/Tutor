import json

import redis

import db
import retrieve
from tests.conftest import FakeConn


class FakeRedis:
    def __init__(self, store=None, broken=False):
        self.store = dict(store or {})
        self.broken = broken

    def get(self, key):
        if self.broken:
            raise redis.ConnectionError("down")
        return self.store.get(key)

    def set(self, key, value, ex=None):
        if self.broken:
            raise redis.ConnectionError("down")
        self.store[key] = value


def test_cache_hit_skips_embedding_and_postgres(monkeypatch):
    rows = [["a.md", "cached text"]]
    monkeypatch.setattr(retrieve, "get_redis", lambda: FakeRedis({"query:q:5": json.dumps(rows)}))
    monkeypatch.setattr(db, "connect", lambda: (_ for _ in ()).throw(AssertionError("should not query postgres")))

    assert retrieve.search("q", 5) == ([("a.md", "cached text")], True)


def test_cache_miss_queries_postgres_and_fills_cache(monkeypatch, fake_embed):
    cache = FakeRedis()
    conn = FakeConn(results=[[("a.md", "fresh text")]])
    monkeypatch.setattr(retrieve, "get_redis", lambda: cache)
    monkeypatch.setattr(db, "connect", lambda: conn)

    assert retrieve.search("q", 3) == ([("a.md", "fresh text")], False)
    assert "ORDER BY embedding <=>" in conn.executed[0][0]
    assert conn.executed[0][1][1] == 3
    assert json.loads(cache.store["query:q:3"]) == [["a.md", "fresh text"]]
    assert conn.closed


def test_redis_outage_degrades_to_uncached_search(monkeypatch, fake_embed):
    monkeypatch.setattr(retrieve, "get_redis", lambda: FakeRedis(broken=True))
    monkeypatch.setattr(db, "connect", lambda: FakeConn(results=[[("a.md", "text")]]))

    assert retrieve.search("q") == ([("a.md", "text")], False)
