import pytest

import db


def test_missing_postgres_password_gives_a_clear_error(monkeypatch):
    monkeypatch.setattr(db.config, "POSTGRES_PASSWORD", None)
    with pytest.raises(RuntimeError, match="POSTGRES_PASSWORD"):
        db.connect()
