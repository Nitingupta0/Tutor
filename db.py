"""Postgres + pgvector connection helper and schema bootstrap."""
import logging

import psycopg2
from pgvector.psycopg2 import register_vector

import config

logger = logging.getLogger(__name__)

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
    if config.DATABASE_URL:
        conn = psycopg2.connect(config.DATABASE_URL, connect_timeout=15)
    else:
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


# Added after the first release. Each one is idempotent, so init_schema() can run on every start and upgrade
# an existing database in place. One that fails (e.g. an old pgvector without HNSW) is skipped, not fatal.
UPGRADES = [
    # Keyword search: a stemmed full-text vector kept in sync by Postgres, plus its index.
    "ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS content_tsv tsvector "
    "GENERATED ALWAYS AS (to_tsvector('english', content)) STORED",
    "CREATE INDEX IF NOT EXISTS document_chunks_tsv_idx ON document_chunks USING gin (content_tsv)",
    # Approximate nearest-neighbour indexes, so vector search doesn't scan every row as the corpus grows.
    "CREATE INDEX IF NOT EXISTS document_chunks_embedding_hnsw ON document_chunks USING hnsw (embedding vector_cosine_ops)",
    "CREATE INDEX IF NOT EXISTS problems_embedding_hnsw ON problems USING hnsw (embedding vector_cosine_ops)",
]


def init_schema() -> None:
    conn = connect()
    with conn.cursor() as cur:
        cur.execute(SCHEMA)
        conn.commit()
        for statement in UPGRADES:
            try:
                cur.execute(statement)
                conn.commit()
            except psycopg2.Error as exc:
                conn.rollback()
                logger.warning("Schema upgrade skipped (%s): %s", statement.split(" ON ")[0][:60], exc)
    conn.close()


if __name__ == "__main__":
    init_schema()
    print("Schema ready.")
