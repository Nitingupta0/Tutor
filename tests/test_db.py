import pytest

import db
from tests.conftest import FakeConn


@pytest.fixture
def captured_connect(monkeypatch):
    calls = []

    def fake_connect(*args, **kwargs):
        calls.append((args, kwargs))
        return FakeConn()

    monkeypatch.setattr(db.psycopg2, "connect", fake_connect)
    monkeypatch.setattr(db, "register_vector", lambda conn: None)
    return calls


def test_missing_postgres_password_gives_a_clear_error(monkeypatch):
    monkeypatch.setattr(db.config, "DATABASE_URL", None)
    monkeypatch.setattr(db.config, "POSTGRES_PASSWORD", None)
    with pytest.raises(RuntimeError, match="POSTGRES_PASSWORD"):
        db.connect()


def test_database_url_is_used_when_set(monkeypatch, captured_connect):
    url = "postgresql://u:p@example.neon.tech/db?sslmode=require"
    monkeypatch.setattr(db.config, "DATABASE_URL", url)
    monkeypatch.setattr(db.config, "POSTGRES_PASSWORD", None)  # not needed with a URL

    db.connect()

    assert captured_connect[0][0] == (url,)


def test_separate_settings_are_used_without_a_url(monkeypatch, captured_connect):
    monkeypatch.setattr(db.config, "DATABASE_URL", None)
    monkeypatch.setattr(db.config, "POSTGRES_PASSWORD", "secret")

    db.connect()

    assert captured_connect[0][1]["password"] == "secret"
