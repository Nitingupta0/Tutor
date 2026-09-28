# App image, used by docker-compose.prod.yml. Serves the app on port 7860.
FROM python:3.11-slim

# Redis / MongoDB are off unless their URLs are provided (docker-compose.prod.yml sets them).
ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HOME=/app/.cache/huggingface \
    PORT=7860 \
    REDIS_URL="" \
    MONGO_URL=""

# Run as an unprivileged user.
RUN useradd --create-home --uid 1000 user
WORKDIR /app

# CPU-only PyTorch keeps the image far smaller than the default CUDA build.
COPY requirements.txt .
RUN pip install --index-url https://download.pytorch.org/whl/cpu torch \
 && pip install -r requirements.txt

# Bake the embedding model into the image so the app starts without downloading it.
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('all-MiniLM-L6-v2')"

COPY . .
RUN chown -R user:user /app
USER user

EXPOSE 7860
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips='*'"]
