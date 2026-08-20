from pymongo import MongoClient
from datetime import datetime,timezone

client = MongoClient("mongodb://localhost:27017/")
db = client["rag_db"]              # pick a database (created automatically if it doesn't exist)
collection = db["query_logs"]      # pick a collection (same — auto-created)

def log_query(query: str , mode: str , chunks: list[tuple[str,str]] , answer: str) -> None:
    collection.insert_one({ "query": query,
                            "mode": mode,
                            "chunks": chunks,
                            "answer": answer,
                            "timestamp": datetime.now(timezone.utc)
                            })


