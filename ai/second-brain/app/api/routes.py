"""HTTP surface — the exact contract a Go proxy + React UI build against.

    GET  /health      -> {status, indexed_docs, indexed_chunks, components, index, cache}
    POST /ingest      -> {ingested_docs, chunks, skipped, failed, empty, documents}
    GET  /search      -> {data:[{doc_id,title_ar,title_en,snippet,score,article_*}], meta}
    GET  /articles    -> {data:[{article_no,label,title,page}], meta}  (pure read)
    POST /ask         -> {answer, citations:[...], model, latency_ms, usage, cached}
    POST /ask/stream  -> Server-Sent Events: `token` deltas + a final `citations` event
    GET  /metrics     -> Prometheus exposition (see app.main)

The streaming path is ADDITIVE — the non-stream JSON /ask is unchanged for the
proxy. Guardrails, per-answer caching, and rate limiting sit in front of /ask
and /ask/stream.
"""

from __future__ import annotations

import json
import logging
import time
from functools import lru_cache

from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse, StreamingResponse

from .. import cache as cache_mod
from .. import ratelimit
from ..config import get_settings
from ..observability.metrics import get_metrics
from ..rag import generator, guardrails, providers
from ..rag.article_chunking import format_article_label
from ..rag.embeddings import EmbeddingsUnavailable
from ..rag.retriever import Retriever
from ..rag.vectorstore import VectorStore, VectorStoreUnavailable
from .schemas import (
    ArticlesResponse,
    AskRequest,
    HealthResponse,
    IngestRequest,
    IngestResponse,
    SearchResponse,
)

log = logging.getLogger(__name__)
router = APIRouter()


# --------------------------------------------------------------------------- #
# Lazily-built singletons (settings is itself lru_cached)
# --------------------------------------------------------------------------- #

@lru_cache
def _answer_cache() -> cache_mod.AnswerCache:
    s = get_settings()
    return cache_mod.AnswerCache(
        max_entries=s.answer_cache_max_entries, ttl_seconds=s.answer_cache_ttl_seconds
    )


@lru_cache
def _ask_limiter() -> ratelimit.TokenBucketLimiter:
    return ratelimit.TokenBucketLimiter(get_settings().rate_limit_per_minute)


@lru_cache
def _search_limiter() -> ratelimit.TokenBucketLimiter:
    return ratelimit.TokenBucketLimiter(get_settings().rate_limit_search_per_minute)


def _client_key(request: Request) -> str:
    auth = request.headers.get("authorization", "")
    token = auth[7:] if auth.lower().startswith("bearer ") else ""
    ip = request.client.host if request.client else ""
    fwd = request.headers.get("x-forwarded-for", "")
    if fwd:
        ip = fwd.split(",")[0].strip()
    return ratelimit.client_key(token=token, ip=ip)


def _rate_limited(request: Request, limiter, endpoint: str):
    """Return a 429 JSONResponse if the client is over budget, else None."""
    settings = get_settings()
    if not settings.rate_limit_enabled:
        return None
    allowed, retry_after = limiter.allow(_client_key(request))
    if allowed:
        return None
    get_metrics().observe_rate_limited(endpoint)
    return JSONResponse(
        status_code=429,
        content={"error": "rate limit exceeded", "retry_after": round(retry_after, 2)},
        headers={"Retry-After": str(int(retry_after) + 1)},
    )


def _unavailable(message: str) -> JSONResponse:
    return JSONResponse(status_code=503, content={"error": message})


def _search_item(r: dict) -> dict:
    return {
        "doc_id": r["doc_id"],
        "title_ar": r.get("title_ar", ""),
        "title_en": r.get("title_en", ""),
        "snippet": r.get("snippet", ""),
        "score": float(r.get("score") or 0.0),
        "page": r.get("page"),
        "article_no": r.get("article_no"),
        "article_label": r.get("article_label") or "",
        "chapter": r.get("chapter") or "",
        "part": r.get("part") or "",
    }


# --------------------------------------------------------------------------- #
# Health
# --------------------------------------------------------------------------- #

@router.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    settings = get_settings()
    store = VectorStore(settings)
    components = {}
    indexed_docs = 0
    indexed_chunks = 0
    index_info = {}

    # DB + index.
    try:
        indexed_docs, indexed_chunks = store.counts()
        index_info = store.freshness()
        components["db"] = {"status": "ok"}
        get_metrics().set_index_size(indexed_docs, indexed_chunks)
    except Exception as exc:
        components["db"] = {"status": "down", "detail": str(exc)}

    # Embeddings (report configured model; don't force a heavy load on health).
    components["embeddings"] = {
        "status": "configured",
        "model": settings.ai_embedding_model,
        "dim": settings.ai_embedding_dim,
    }
    # LLM (provider-aware: anthropic OR any openai-compatible in-Kingdom endpoint).
    components["llm"] = {
        "status": "configured" if providers.llm_configured(settings) else "not_configured",
        "provider": settings.ai_llm_provider,
        "model": settings.ai_llm_model,
    }
    # Reranker (config only).
    components["reranker"] = {
        "status": "enabled" if settings.rerank_enabled else "disabled",
        "model": settings.rerank_model if settings.rerank_enabled else "",
    }

    healthy = components.get("db", {}).get("status") == "ok" and indexed_chunks > 0
    status = "ok" if healthy else "degraded"
    return HealthResponse(
        status=status,
        indexed_docs=indexed_docs,
        indexed_chunks=indexed_chunks,
        components=components,
        index=index_info,
        cache=_answer_cache().stats(),
        version="1.0.0",
    )


# --------------------------------------------------------------------------- #
# Ingest
# --------------------------------------------------------------------------- #

@router.post("/ingest", response_model=IngestResponse)
def ingest_endpoint(req: IngestRequest):
    from ..ingest import ingest as run_ingest

    try:
        result = run_ingest(force=req.force)
    except VectorStoreUnavailable as exc:
        return _unavailable(f"vector store not configured: {exc}")
    except EmbeddingsUnavailable as exc:
        return _unavailable(f"embeddings not configured: {exc}")
    return IngestResponse(**result)


# --------------------------------------------------------------------------- #
# Search
# --------------------------------------------------------------------------- #

@router.get("/search", response_model=SearchResponse)
def search_endpoint(
    request: Request,
    q: str = Query(..., description="Arabic or English query"),
    top_k: int = Query(8, ge=1, le=50),
    mode: str = Query(None, description="hybrid | vector | keyword (default: config)"),
):
    limited = _rate_limited(request, _search_limiter(), "search")
    if limited is not None:
        return limited

    settings = get_settings()
    retriever = Retriever(settings)
    try:
        results = retriever.search(q, top_k, mode=mode)
    except VectorStoreUnavailable as exc:
        return _unavailable(f"vector store not configured: {exc}")
    except EmbeddingsUnavailable as exc:
        return _unavailable(f"embeddings not configured: {exc}")

    get_metrics().observe_retrieval(
        getattr(retriever, "_last_mode", "?"), getattr(retriever, "_last_reranked", False)
    )
    data = [_search_item(r) for r in results]
    return {"data": data, "meta": {"count": len(data), "mode": getattr(retriever, "_last_mode", "")}}


# --------------------------------------------------------------------------- #
# Articles (article table-of-contents for one document — pure read)
# --------------------------------------------------------------------------- #

_ORDER_SENTINEL = 2**31  # sort nulls (no page / no number) last, deterministically


def _article_sort_key(r: dict) -> tuple:
    page = r.get("first_page")
    no = r.get("article_no")
    return (
        page if isinstance(page, int) else _ORDER_SENTINEL,
        no if isinstance(no, int) and not isinstance(no, bool) else _ORDER_SENTINEL,
        r.get("article_label") or "",
    )


def _article_item(r: dict) -> dict:
    no = r.get("article_no")
    # title is not captured by the article index today; surface it honestly as
    # null unless a future ingest starts persisting a مادة rubric.
    title = r.get("title") or r.get("article_title")
    return {
        "article_no": str(no) if no is not None else "",
        "label": format_article_label(no, r.get("article_label") or ""),
        "title": title or None,
        "page": r.get("first_page"),
    }


@router.get("/articles", response_model=ArticlesResponse)
def articles_endpoint(
    doc_id: str = Query(..., description="Document id whose article TOC to return"),
):
    """Article table-of-contents for one document, ordered by page then article no.

    A pure read of the manifest-built article index — no LLM, no embedding, so it
    is cheap and always-available. Degrades gracefully to an empty list (HTTP 200,
    never 503) for an unknown / not-yet-ingested doc, a research paper with no
    article markers, or an unreachable DB, so the lex proxy + UI just hide the
    TOC panel.
    """
    store = VectorStore(get_settings())
    try:
        rows = store.list_articles(doc_id)
    except VectorStoreUnavailable:
        return {"data": []}
    except Exception:  # never surface a 5xx for a read-only TOC
        log.warning("articles lookup failed for doc_id=%s", doc_id, exc_info=True)
        return {"data": []}

    rows = sorted(rows or [], key=_article_sort_key)
    data = [_article_item(r) for r in rows]
    return {"data": data, "meta": {"count": len(data), "doc_id": doc_id}}


# --------------------------------------------------------------------------- #
# Ask (non-stream JSON)
# --------------------------------------------------------------------------- #

def _prepare_ask(req: AskRequest):
    """Shared pre-flight for /ask + /ask/stream.

    Returns one of:
      ("error", JSONResponse)                      -> return it directly (503/etc)
      ("refuse", message, result_type)             -> guardrail refusal (200)
      ("cached", payload)                           -> answer served from cache
      ("generate", retrieved, cache_key)            -> proceed to the LLM
    """
    settings = get_settings()
    metrics = get_metrics()

    if not providers.llm_configured(settings):
        return ("error", _unavailable("llm not configured"))

    screen = guardrails.screen_question(req.question, settings.guardrail_max_question_chars)
    if not screen.ok:
        metrics.observe_answer("refused_screen")
        return ("refuse", screen.refusal_message, "refused_screen")
    if screen.injection_detected:
        metrics.observe_injection()
        log.warning("prompt-injection pattern in question; neutralising and proceeding")

    retriever = Retriever(settings)
    try:
        retrieved = retriever.search(req.question, req.top_k, req.doc_ids, mode=req.mode)
    except VectorStoreUnavailable as exc:
        return ("error", _unavailable(f"vector store not configured: {exc}"))
    except EmbeddingsUnavailable as exc:
        return ("error", _unavailable(f"embeddings not configured: {exc}"))

    effective_mode = getattr(retriever, "_last_mode", "")
    metrics.observe_retrieval(
        effective_mode or "?", getattr(retriever, "_last_reranked", False)
    )

    # The out-of-corpus refusal is a SEMANTIC (cosine) check — skip it in
    # keyword-only mode, where cosine scores are absent by design.
    if effective_mode != "keyword" and guardrails.is_out_of_corpus(
        retrieved, settings.guardrail_min_score
    ):
        metrics.observe_answer("refused_out_of_corpus")
        return ("refuse", guardrails.OUT_OF_CORPUS_MESSAGE, "refused_out_of_corpus")

    # Cache lookup.
    store = VectorStore(settings)
    try:
        corpus_version = store.corpus_version()
    except Exception:
        corpus_version = ""
    cache_key = cache_mod.make_key(
        req.question, top_k=req.top_k, doc_ids=req.doc_ids,
        model=settings.ai_llm_model, corpus_version=corpus_version,
    )
    if settings.answer_cache_enabled and not req.no_cache:
        hit = _answer_cache().get(cache_key)
        if hit is not None:
            metrics.observe_cache("hit")
            return ("cached", hit)
        metrics.observe_cache("miss")

    return ("generate", retrieved, cache_key)


@router.post("/ask")
def ask_endpoint(req: AskRequest, request: Request):
    limited = _rate_limited(request, _ask_limiter(), "ask")
    if limited is not None:
        return limited

    settings = get_settings()
    metrics = get_metrics()
    started = time.perf_counter()

    prep = _prepare_ask(req)
    kind = prep[0]

    if kind == "error":
        return prep[1]

    if kind == "refuse":
        latency_ms = int((time.perf_counter() - started) * 1000)
        return {
            "answer": prep[1], "citations": [], "model": "", "latency_ms": latency_ms,
            "usage": {"input_tokens": 0, "output_tokens": 0}, "cached": False,
            "grounded": False, "refused": True,
        }

    if kind == "cached":
        payload = dict(prep[1])
        payload["cached"] = True
        payload["latency_ms"] = int((time.perf_counter() - started) * 1000)
        metrics.observe_answer("cached")
        return payload

    _, retrieved, cache_key = prep
    try:
        answer, citations, model, usage = generator.generate_answer(
            req.question, retrieved, settings
        )
    except generator.LLMNotConfigured:
        return _unavailable("llm not configured")
    except Exception as exc:  # SDK / network error
        metrics.observe_answer("error")
        log.exception("generation failed")
        return _unavailable(f"generation failed: {exc}")

    metrics.observe_answer("generated")
    metrics.observe_tokens(usage.get("input_tokens", 0), usage.get("output_tokens", 0))
    grounded = guardrails.is_grounded(answer)
    payload = {
        "answer": answer, "citations": citations, "model": model,
        "usage": usage, "cached": False, "grounded": grounded, "refused": False,
    }
    if settings.answer_cache_enabled:
        _answer_cache().set(cache_key, dict(payload))
        metrics.observe_cache("store")
    payload["latency_ms"] = int((time.perf_counter() - started) * 1000)
    return payload


# --------------------------------------------------------------------------- #
# Ask (streaming SSE)
# --------------------------------------------------------------------------- #

def _sse(event: str, data) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@router.post("/ask/stream")
def ask_stream_endpoint(req: AskRequest, request: Request):
    limited = _rate_limited(request, _ask_limiter(), "ask_stream")
    if limited is not None:
        return limited

    settings = get_settings()
    metrics = get_metrics()

    # All fallible pre-flight runs BEFORE the stream starts, so real HTTP status
    # codes (503/429) are returned rather than a half-open event stream.
    prep = _prepare_ask(req)
    kind = prep[0]
    if kind == "error":
        return prep[1]

    started = time.perf_counter()

    if kind == "refuse":
        message, _rtype = prep[1], prep[2]

        def refuse_gen():
            yield _sse("meta", {"refused": True})
            yield _sse("token", {"text": message})
            yield _sse("citations", {
                "citations": [], "model": "", "refused": True,
                "usage": {"input_tokens": 0, "output_tokens": 0},
                "latency_ms": int((time.perf_counter() - started) * 1000),
            })
            yield _sse("done", {})

        return StreamingResponse(refuse_gen(), media_type="text/event-stream")

    if kind == "cached":
        payload = prep[1]

        def cached_gen():
            yield _sse("meta", {"cached": True})
            yield _sse("token", {"text": payload.get("answer", "")})
            yield _sse("citations", {
                "citations": payload.get("citations", []),
                "model": payload.get("model", ""),
                "usage": payload.get("usage", {}),
                "cached": True,
                "latency_ms": int((time.perf_counter() - started) * 1000),
            })
            yield _sse("done", {})

        metrics.observe_answer("cached")
        return StreamingResponse(cached_gen(), media_type="text/event-stream")

    _, retrieved, cache_key = prep

    def generate_gen():
        yield _sse("meta", {"cached": False, "sources": len(retrieved)})
        final = None
        try:
            for kind2, data in generator.stream_answer(req.question, retrieved, settings):
                if kind2 == "token":
                    yield _sse("token", {"text": data})
                elif kind2 == "final":
                    final = data
        except generator.LLMNotConfigured:
            yield _sse("error", {"error": "llm not configured"})
            return
        except Exception as exc:  # mid-stream SDK/network failure
            metrics.observe_answer("error")
            log.exception("streaming generation failed")
            yield _sse("error", {"error": f"generation failed: {exc}"})
            return

        if final is None:
            yield _sse("error", {"error": "no answer produced"})
            return

        usage = final.get("usage", {})
        metrics.observe_answer("generated")
        metrics.observe_tokens(usage.get("input_tokens", 0), usage.get("output_tokens", 0))
        grounded = guardrails.is_grounded(final.get("answer", ""))
        payload = {
            "answer": final.get("answer", ""),
            "citations": final.get("citations", []),
            "model": final.get("model", ""),
            "usage": usage, "cached": False, "grounded": grounded, "refused": False,
        }
        if settings.answer_cache_enabled:
            _answer_cache().set(cache_key, dict(payload))
            metrics.observe_cache("store")
        yield _sse("citations", {
            "citations": payload["citations"], "model": payload["model"],
            "usage": usage, "grounded": grounded, "cached": False,
            "latency_ms": int((time.perf_counter() - started) * 1000),
        })
        yield _sse("done", {})

    return StreamingResponse(generate_gen(), media_type="text/event-stream")
