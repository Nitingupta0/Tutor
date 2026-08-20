# Scratch test — first embeddings, first proof that meaning > spelling.
# Write your attempt below.
from sentence_transformers import util , SentenceTransformer

A = "How do I reset my password?"
B = "Steps to change your login credentials"
C = "The weather is nice today"

model = SentenceTransformer('all-MiniLM-L6-v2')
embeddings = model.encode([A, B, C], convert_to_tensor=True)
similarity_AB = util.pytorch_cos_sim(embeddings[0], embeddings[1])
similarity_AC = util.pytorch_cos_sim(embeddings[0], embeddings[2])

print(f"Similarity between A and B: {similarity_AB.item():.4f}")
print(f"Similarity between A and C: {similarity_AC.item():.4f}")


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

