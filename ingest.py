"""Ingestion pipeline: load docs -> chunk -> embed -> insert into pgvector.

    python ingest.py                         # re-index the bundled notes/ folder
    python ingest.py path/to/notes --append  # add another folder (e.g. official docs) on top
"""
import argparse
from pathlib import Path

DEFAULT_FOLDER = Path(__file__).parent / "notes"
EXTENSIONS = (".md", ".txt", ".rst")


def load_documents(folder_path, recursive: bool = True) -> list[tuple[str, str]]:
    folder = Path(folder_path)
    paths = folder.rglob("*") if recursive else folder.glob("*")
    material = []
    for obj in sorted(paths):
        if obj.is_file() and obj.suffix.lower() in EXTENSIONS:
            material.append((str(obj.relative_to(folder)).replace("\\", "/"), obj.read_text(encoding="utf-8")))
    return material


def chunk_text(text: str, chunk_size: int = 200, overlap: int = 50) -> list[str]:
    '''Split text into words, then slide a window of chunk_size words across them, advancing
    by chunk_size - overlap words each step (re-including the last `overlap` words of the
    previous window). Stops once a window reaches the end, so no chunk is a pure subset of
    the one before it.'''
    if overlap >= chunk_size:
        raise ValueError("overlap must be smaller than chunk_size")

    words = text.split()
    chunks = []
    step = chunk_size - overlap
    for i in range(0, len(words), step):
        chunks.append(' '.join(words[i:i + chunk_size]))
        if i + chunk_size >= len(words):
            break
    return chunks


def ingest(docs: list[tuple[str, str]], append: bool = False, chunk_size: int = 200, overlap: int = 50) -> int:
    import db
    import embed

    db.init_schema()
    conn = db.connect()
    cur = conn.cursor()
    if not append:
        cur.execute("TRUNCATE document_chunks RESTART IDENTITY;")

    total = 0
    for source, text in docs:
        doc_chunks = chunk_text(text, chunk_size, overlap)
        if not doc_chunks:
            continue
        cur.execute("DELETE FROM document_chunks WHERE source = %s", (source,))
        for chunk, vector in zip(doc_chunks, embed.encode(doc_chunks), strict=True):
            cur.execute("INSERT INTO document_chunks (source, content, embedding) VALUES (%s, %s, %s)",
                        (source, chunk, vector))
        total += len(doc_chunks)

    conn.commit()
    conn.close()
    return total


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("folder", nargs="?", default=DEFAULT_FOLDER, help="folder of .md/.txt/.rst files")
    parser.add_argument("--append", action="store_true", help="keep existing chunks instead of truncating")
    parser.add_argument("--chunk-size", type=int, default=200)
    parser.add_argument("--overlap", type=int, default=50)
    args = parser.parse_args()

    documents = load_documents(args.folder)
    count = ingest(documents, append=args.append, chunk_size=args.chunk_size, overlap=args.overlap)
    print(f"Indexed {count} chunks from {len(documents)} documents in {args.folder}.")
