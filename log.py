import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from functools import lru_cache

from pymongo import MongoClient
from pymongo.errors import PyMongoError

import config

logger = logging.getLogger(__name__)

# One background writer: logging never adds latency to a response, and writes stay ordered.
_writer = ThreadPoolExecutor(max_workers=1, thread_name_prefix="mongo-log")


@lru_cache(maxsize=1)
def get_collection():
    client = MongoClient(config.MONGO_URL, serverSelectionTimeoutMS=2000)
    return client[config.MONGO_DB]["query_logs"]


def _write(document: dict) -> None:
    try:
        get_collection().insert_one(document)
    except PyMongoError as exc:
        logger.warning("Could not log query to MongoDB: %s", exc)


def log_query(query: str, mode: str, chunks: list, answer) -> None:
    """Queue a query for MongoDB. Logging failures are reported but never raised."""
    _writer.submit(_write, {
        "query": query,
        "mode": mode,
        "chunks": chunks,
        "answer": answer,
        "timestamp": datetime.now(UTC),
    })
