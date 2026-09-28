"""Shared embedding model — loaded once per process instead of once per request."""
from functools import lru_cache

import config


@lru_cache(maxsize=1)
def get_model():
    from sentence_transformers import SentenceTransformer

    return SentenceTransformer(config.EMBEDDING_MODEL)


def encode(texts):
    return get_model().encode(texts)
