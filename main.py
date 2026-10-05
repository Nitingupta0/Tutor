import hashlib
import json
import logging
import re
import threading
import time
from collections import defaultdict, deque
from pathlib import Path
from typing import Literal

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

import config
import generate
import problems

logger = logging.getLogger(__name__)
STATIC_DIR = Path(__file__).parent / "static"

Mode = Literal["answer", "hint", "debug", "fetch"]


class Turn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=8000)


class Query(BaseModel):
    question: str = Field(min_length=1, max_length=8000)
    mode: Mode = "answer"
    # Recent conversation, oldest first, so follow-ups make sense. generate.py keeps only the last few turns.
    history: list[Turn] = Field(default_factory=list, max_length=20)

    def turns(self) -> list[dict]:
        return [t.model_dump() for t in self.history]


app = FastAPI(title="Tutor", description="RAG-grounded DSA tutor", version="1.0.0")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


_ASSET = re.compile(r"/static/([\w./-]+\.(?:js|css))")


def _versioned(match: re.Match) -> str:
    """/static/app.js -> /static/app.js?v=<content hash>, so each deploy gets fresh URLs."""
    path = STATIC_DIR / match.group(1)
    if not path.is_file():
        return match.group(0)
    digest = hashlib.sha256(path.read_bytes()).hexdigest()[:10]
    return f"/static/{match.group(1)}?v={digest}"


@app.get("/", include_in_schema=False)
def home():
    # The page is small and always revalidated; the scripts it points to change URL whenever their content
    # changes, so browsers never run a stale app.js / app.css after a deploy.
    html = _ASSET.sub(_versioned, (STATIC_DIR / "index.html").read_text(encoding="utf-8"))
    return HTMLResponse(html, headers={"Cache-Control": "no-cache"})


@app.get("/health")
def health():
    return {"status": "ok"}


# Every question costs LLM quota, so a public deployment caps questions per visitor.
_hits: dict[str, deque] = defaultdict(deque)
_hits_lock = threading.Lock()


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")  # set by the hosting proxy
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def rate_limit(request: Request) -> None:
    limit = config.RATE_LIMIT_PER_MINUTE
    if limit <= 0:
        return
    now = time.monotonic()
    ip = _client_ip(request)
    with _hits_lock:
        window = _hits[ip]
        while window and now - window[0] >= 60:
            window.popleft()
        if len(window) >= limit:
            retry = int(60 - (now - window[0])) + 1
            raise HTTPException(
                status_code=429,
                detail=f"Slow down a little — you can ask {limit} questions a minute. Try again in {retry}s.",
                headers={"Retry-After": str(retry)},
            )
        window.append(now)


def _run(request: Query) -> dict:
    if request.mode == "fetch":
        return {"mode": "fetch", "problems": problems.find_problems(request.question)}
    return {"mode": request.mode, **generate.ask(request.question, request.mode, request.turns())}


@app.post("/ask", dependencies=[Depends(rate_limit)])
def ask(request: Query):
    try:
        return _run(request)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


def _sse(event: dict) -> str:
    return f"data: {json.dumps(event)}\n\n"


@app.post("/ask/stream", dependencies=[Depends(rate_limit)])
def ask_stream(request: Query):
    """Server-sent events: 'grounding' → 'token'* → 'done' (or a single 'problems' for fetch)."""

    def events():
        try:
            if request.mode == "fetch":
                yield _sse({"type": "problems", "problems": problems.find_problems(request.question)})
                yield _sse({"type": "done"})
                return
            for event in generate.ask_stream(request.question, request.mode, request.turns()):
                yield _sse(event)
        except Exception as exc:  # surface the failure to the client instead of dropping the stream
            logger.exception("Streaming request failed")
            yield _sse({"type": "error", "message": str(exc)})

    return StreamingResponse(events(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
