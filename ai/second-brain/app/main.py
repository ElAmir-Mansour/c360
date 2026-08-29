"""FastAPI application entrypoint.

    uvicorn app.main:app --host 0.0.0.0 --port 8000

Adds, on top of the RAG routes: structured JSON logging with per-request ids,
a Prometheus ``/metrics`` endpoint, and request-count/latency instrumentation.
"""

from __future__ import annotations

import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response

from .api.routes import router
from .config import get_settings
from .observability.logging_config import configure_logging, new_request_id, set_request_id
from .observability.metrics import CONTENT_TYPE_LATEST, get_metrics

configure_logging(get_settings())
log = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Best-effort schema bootstrap; the app still serves /health if the DB is down.
    settings = get_settings()
    try:
        from .rag.vectorstore import VectorStore

        VectorStore(settings).bootstrap()
        log.info("vector store bootstrapped (%s)", settings.ai_database_url.rsplit("@", 1)[-1])
    except Exception as exc:
        log.warning("vector store bootstrap skipped: %s", exc)
    yield


app = FastAPI(
    title="WatheeqTech Second Brain",
    version="1.0.0",
    description="RAG over the WatheeqTech Saudi legal reference corpus (FastAPI AI runtime).",
    lifespan=lifespan,
)


@app.middleware("http")
async def observability_middleware(request: Request, call_next):
    rid = request.headers.get("x-request-id") or new_request_id()
    set_request_id(rid)
    started = time.perf_counter()
    endpoint = request.scope.get("path", request.url.path)
    status = 500
    try:
        response = await call_next(request)
        status = response.status_code
        response.headers["x-request-id"] = rid
        return response
    finally:
        seconds = time.perf_counter() - started
        try:
            get_metrics().observe_request(endpoint, request.method, status, seconds)
        except Exception:  # never let metrics break a request
            pass


@app.get("/metrics")
def metrics() -> Response:
    settings = get_settings()
    if not settings.metrics_enabled:
        return Response(status_code=404)
    return Response(content=get_metrics().render(), media_type=CONTENT_TYPE_LATEST)


app.include_router(router)
