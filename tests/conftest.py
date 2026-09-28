import pytest


class FakeCursor:
    def __init__(self, conn):
        self.conn = conn

    def execute(self, sql, params=None):
        self.conn.executed.append((sql, params))

    def fetchall(self):
        return self.conn.results.pop(0) if self.conn.results else []

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class FakeConn:
    """Stands in for a psycopg2 connection; `results` is a queue of fetchall() return values."""

    def __init__(self, results=None):
        self.results = list(results or [])
        self.executed = []
        self.closed = False

    def cursor(self):
        return FakeCursor(self)

    def commit(self):
        pass

    def close(self):
        self.closed = True


@pytest.fixture
def fake_conn():
    return FakeConn()


@pytest.fixture(autouse=True)
def no_mongo(monkeypatch):
    """Never touch a real MongoDB from tests; record what would have been logged."""
    import log

    logged = []
    monkeypatch.setattr(log, "log_query", lambda *args: logged.append(args))
    return logged


@pytest.fixture
def fake_embed(monkeypatch):
    import embed

    monkeypatch.setattr(embed, "encode", lambda texts: [0.0] * 384 if isinstance(texts, str) else [[0.0] * 384 for _ in texts])
