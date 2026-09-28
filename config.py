"""Central settings, read from the environment (and .env) so nothing is hard-coded."""
import os

from dotenv import load_dotenv

load_dotenv()

# A hosted database (e.g. Neon) gives one connection string; when set, it wins over the parts below.
DATABASE_URL = os.getenv("DATABASE_URL")

POSTGRES_HOST = os.getenv("POSTGRES_HOST", "localhost")
POSTGRES_PORT = int(os.getenv("POSTGRES_PORT", "5432"))
POSTGRES_DB = os.getenv("POSTGRES_DB", "rag_db")
POSTGRES_USER = os.getenv("POSTGRES_USER", "rag")
POSTGRES_PASSWORD = os.getenv("POSTGRES_PASSWORD")  # required — set it in .env, never in code

# Redis and MongoDB are optional: set the URL to an empty string to turn caching / logging off.
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
CACHE_TTL_SECONDS = int(os.getenv("CACHE_TTL_SECONDS", "3600"))

MONGO_URL = os.getenv("MONGO_URL", "mongodb://localhost:27017/")
MONGO_DB = os.getenv("MONGO_DB", "rag_db")

# Questions allowed per visitor per minute (0 turns the limit off).
RATE_LIMIT_PER_MINUTE = int(os.getenv("RATE_LIMIT_PER_MINUTE", "20"))

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
GROQ_MODEL = os.getenv("GROQ_MODEL", "openai/gpt-oss-120b")

EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "all-MiniLM-L6-v2")
EMBEDDING_DIM = 384
TOP_K = int(os.getenv("TOP_K", "5"))
