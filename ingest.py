# Ingestion pipeline: load docs -> chunk -> embed -> insert into pgvector.
# Write your attempt below.
from pathlib import Path
from sentence_transformers import SentenceTransformer
import psycopg2
from pgvector.psycopg2 import register_vector


def load_documents(folder_path) -> list[tuple[str , str]]:
    docs = Path(folder_path).glob("*.md")
    material = []
    for obj in docs:
        material.append((obj.name , obj.read_text(encoding="utf-8")))
    return material


def chunk_text(text: str, chunk_size: int = 200, overlap: int = 50) -> list[str]:
    '''Behavior: split text into words (text.split()), then slide a window of chunk_size words
    across them, advancing by chunk_size - overlap words each step (that's what creates the 
    overlap — you're re-including the last overlap words of the previous window at the start of
    the next one). Join each window's words back into a string, collect all windows into a list, return it.'''

    words = text.split()
    chunks = []
    step = chunk_size - overlap
    for i in range(0 , len(words) , step):
        chunk = ' '.join(words[i:i+chunk_size])
        chunks.append(chunk)
    return chunks


if __name__ == "__main__":
    docs = load_documents(r"D:\Placement_Prep\DSA")
    conn = psycopg2.connect(host="localhost", port=5432, dbname="rag_db", user="rag", password="rag_dev_pw")
    register_vector(conn)
    cur = conn.cursor()
    document_chunks = []
    model = SentenceTransformer('all-MiniLM-L6-v2')

    cur.execute("TRUNCATE document_chunks RESTART IDENTITY;")

    for obj in docs:
        doc_chunk = chunk_text(obj[1] , 200 , 50)
        embedding = model.encode(doc_chunk)

        for doc , embed in zip(doc_chunk , embedding):
            cur.execute("INSERT INTO document_chunks (source, content, embedding) VALUES (%s, %s, %s)", (obj[0], doc, embed))

    conn.commit()
    conn.close()



