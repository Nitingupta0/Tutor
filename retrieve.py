from sentence_transformers import util , SentenceTransformer
import psycopg2
from pgvector.psycopg2 import register_vector
import redis
import json

def retrieve(query : str , top_k : int = 5) -> list[tuple[str,str]]:
    r = redis.Redis(host = "localhost" , port=6379 , decode_responses = True)
    key = f"query:{query}:{top_k}"
    response = r.get(key)
    if response :
        answer = [tuple(x) for x in json.loads(response)]
        return answer

    model = SentenceTransformer('all-MiniLM-L6-v2')
    embeddings = model.encode(query)

    conn = psycopg2.connect(host="localhost", port=5432, dbname="rag_db", user="rag", password="rag_dev_pw")
    register_vector(conn)
    cur = conn.cursor()

    cur.execute('Select source,content FROM document_chunks ORDER BY embedding <=> %s LIMIT %s' , (embeddings,top_k))
    results = cur.fetchall()

    r.set(key , json.dumps(results) , ex = 3600)
    conn.close()

    return results


if __name__ == "__main__":
    for source, content in retrieve("binary search"):
        print(source, "-", content[:80])
