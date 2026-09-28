import json
import logging
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

import generate
import problems

logger = logging.getLogger(__name__)
STATIC_DIR = Path(__file__).parent / "static"

Mode = Literal["answer", "hint", "debug", "fetch"]


class Query(BaseModel):
    question: str = Field(min_length=1, max_length=8000)
    mode: Mode = "answer"


app = FastAPI(title="Tutor", description="RAG-grounded DSA tutor", version="1.0.0")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/", include_in_schema=False)
def home():
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/health")
def health():
    return {"status": "ok"}


def _run(request: Query) -> dict:
    if request.mode == "fetch":
        return {"mode": "fetch", "problems": problems.find_problems(request.question)}
    return {"mode": request.mode, **generate.ask(request.question, request.mode)}


@app.post("/ask")
def ask(request: Query):
    try:
        return _run(request)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


def _sse(event: dict) -> str:
    return f"data: {json.dumps(event)}\n\n"


@app.post("/ask/stream")
def ask_stream(request: Query):
    """Server-sent events: 'grounding' → 'token'* → 'done' (or a single 'problems' for fetch)."""

    def events():
        try:
            if request.mode == "fetch":
                yield _sse({"type": "problems", "problems": problems.find_problems(request.question)})
                yield _sse({"type": "done"})
                return
            for event in generate.ask_stream(request.question, request.mode):
                yield _sse(event)
        except Exception as exc:  # surface the failure to the client instead of dropping the stream
            logger.exception("Streaming request failed")
            yield _sse({"type": "error", "message": str(exc)})

    return StreamingResponse(events(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
