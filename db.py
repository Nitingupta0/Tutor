"""Postgres + pgvector connection helper and schema bootstrap."""
import psycopg2
from pgvector.psycopg2 import register_vector

import config

SCHEMA = f"""
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS document_chunks (
    id        SERIAL PRIMARY KEY,
    source    TEXT NOT NULL,
    content   TEXT NOT NULL,
    embedding vector({config.EMBEDDING_DIM})
);

CREATE TABLE IF NOT EXISTS problems (
    id        SERIAL PRIMARY KEY,
    source    TEXT NOT NULL,
    ext_id    TEXT NOT NULL,
    title     TEXT NOT NULL,
    url       TEXT,
    tags      TEXT[] DEFAULT '{{}}',
    rating    INT,
    summary   TEXT,
    embedding vector({config.EMBEDDING_DIM}),
    UNIQUE (source, ext_id)
);
"""


def connect():
    if not config.POSTGRES_PASSWORD:
        raise RuntimeError("POSTGRES_PASSWORD is not set — copy .env.example to .env and choose a password.")
    conn = psycopg2.connect(
        host=config.POSTGRES_HOST,
        port=config.POSTGRES_PORT,
        dbname=config.POSTGRES_DB,
        user=config.POSTGRES_USER,
        password=config.POSTGRES_PASSWORD,
    )
    # The extension must exist before the vector type can be registered.
    with conn.cursor() as cur:
        cur.execute("CREATE EXTENSION IF NOT EXISTS vector;")
    conn.commit()
    register_vector(conn)
    return conn


def init_schema() -> None:
    conn = connect()
    with conn.cursor() as cur:
        cur.execute(SCHEMA)
    conn.commit()
    conn.close()


if __name__ == "__main__":
    init_schema()
    print("Schema ready.")
