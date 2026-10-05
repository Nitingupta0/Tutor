import json

import psycopg2
import redis

import db
import log
import retrieve
from tests.conftest import FakeConn

REAL_LOG_QUERY = log.log_query  # captured before conftest's autouse stub replaces it


def test_empty_redis_url_turns_caching_off(monkeypatch, fake_embed):
    monkeypatch.setattr(retrieve.config, "REDIS_URL", "")
    monkeypatch.setattr(retrieve, "get_redis", lambda: (_ for _ in ()).throw(AssertionError("redis should not be used")))
    monkeypatch.setattr(db, "connect", lambda: FakeConn(results=[[("a.md", "text")]]))

    assert retrieve.search("q") == ([("a.md", "text")], False)


def test_empty_mongo_url_turns_logging_off(monkeypatch):
    monkeypatch.setattr(log.config, "MONGO_URL", "")
    monkeypatch.setattr(log, "_writer", None)  # would raise AttributeError if logging tried to run

    REAL_LOG_QUERY("q", "answer", [], "a")


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
    monkeypatch.setattr(retrieve, "get_redis", lambda: FakeRedis({"query:hybrid:q:5": json.dumps(rows)}))
    monkeypatch.setattr(db, "connect", lambda: (_ for _ in ()).throw(AssertionError("should not query postgres")))

    assert retrieve.search("q", 5) == ([("a.md", "cached text")], True)


def test_cache_miss_queries_postgres_and_fills_cache(monkeypatch, fake_embed):
    cache = FakeRedis()
    conn = FakeConn(results=[[("a.md", "fresh text")]])
    monkeypatch.setattr(retrieve, "get_redis", lambda: cache)
    monkeypatch.setattr(db, "connect", lambda: conn)

    assert retrieve.search("q", 3) == ([("a.md", "fresh text")], False)
    assert "ORDER BY embedding <=>" in conn.executed[0][0]
    assert conn.executed[0][1]["k"] == 3
    assert json.loads(cache.store["query:hybrid:q:3"]) == [["a.md", "fresh text"]]
    assert conn.closed


def test_redis_outage_degrades_to_uncached_search(monkeypatch, fake_embed):
    monkeypatch.setattr(retrieve, "get_redis", lambda: FakeRedis(broken=True))
    monkeypatch.setattr(db, "connect", lambda: FakeConn(results=[[("a.md", "text")]]))

    assert retrieve.search("q") == ([("a.md", "text")], False)


class FailingFirstCursor:
    """Raises on the first execute (as if the full-text column were missing), then behaves normally."""

    def __init__(self, conn):
        self.conn = conn

    def execute(self, sql, params=None):
        self.conn.executed.append((sql, params))
        if len(self.conn.executed) == 1:
            raise psycopg2.errors.UndefinedColumn("column content_tsv does not exist")

    def fetchall(self):
        return [("a.md", "fallback text")]


class FailingFirstConn(FakeConn):
    def cursor(self):
        return FailingFirstCursor(self)

    def rollback(self):
        self.rolled_back = True


def test_hybrid_is_the_default_and_fuses_vector_and_keyword_rankings(monkeypatch, fake_embed):
    monkeypatch.setattr(retrieve.config, "REDIS_URL", "")
    conn = FakeConn(results=[[("a.md", "t")]])
    monkeypatch.setattr(db, "connect", lambda: conn)

    retrieve.search("lower_bound loops forever")

    sql, params = conn.executed[0]
    assert "ts_rank_cd" in sql and "embedding <=>" in sql          # both rankings
    assert "1.0 / (%(rrf)s + v.r)" in sql                          # reciprocal rank fusion
    assert params["query"] == "lower_bound loops forever"
    assert params["pool"] >= 4 * params["k"]


def test_vector_mode_uses_only_embeddings(monkeypatch, fake_embed):
    monkeypatch.setattr(retrieve.config, "REDIS_URL", "")
    conn = FakeConn(results=[[("a.md", "t")]])
    monkeypatch.setattr(db, "connect", lambda: conn)

    retrieve.search("q", mode="vector")

    assert "ts_rank_cd" not in conn.executed[0][0]


def test_hybrid_falls_back_to_vector_search_if_keyword_search_is_unavailable(monkeypatch, fake_embed):
    monkeypatch.setattr(retrieve.config, "REDIS_URL", "")
    conn = FailingFirstConn()
    monkeypatch.setattr(db, "connect", lambda: conn)

    results, cached = retrieve.search("q")

    assert results == [("a.md", "fallback text")] and not cached
    assert conn.rolled_back
    assert "ts_rank_cd" not in conn.executed[1][0]


def test_modes_do_not_share_cache_entries(monkeypatch, fake_embed):
    cache = FakeRedis()
    monkeypatch.setattr(retrieve, "get_redis", lambda: cache)
    monkeypatch.setattr(db, "connect", lambda: FakeConn(results=[[("a.md", "t")]]))
    retrieve.search("q", mode="vector")
    assert "query:vector:q:5" in cache.store and "query:hybrid:q:5" not in cache.store


def test_use_cache_false_bypasses_the_cache(monkeypatch, fake_embed):
    cache = FakeRedis({"query:hybrid:q:5": json.dumps([["stale.md", "old"]])})
    monkeypatch.setattr(retrieve, "get_redis", lambda: cache)
    monkeypatch.setattr(db, "connect", lambda: FakeConn(results=[[("fresh.md", "new")]]))
    assert retrieve.search("q", use_cache=False) == ([("fresh.md", "new")], False)
