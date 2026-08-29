"""Prometheus metrics for the Second Brain service.

Everything lives on a **dedicated** ``CollectorRegistry`` (never the global
default) so re-importing under uvicorn reload / pytest never triggers a
duplicate-timeseries registration panic. ``/metrics`` renders this registry.

If ``prometheus_client`` isn't installed the module still imports and every
helper is a no-op (``available == False``) — metrics are observability, never a
hard dependency.
"""

from __future__ import annotations

import logging
from functools import lru_cache
from typing import Optional

log = logging.getLogger(__name__)

try:
    from prometheus_client import CONTENT_TYPE_LATEST, CollectorRegistry, Counter, Gauge, Histogram, generate_latest
    _PROM = True
except Exception:  # pragma: no cover - prometheus_client absent
    _PROM = False
    CONTENT_TYPE_LATEST = "text/plain; version=0.0.4; charset=utf-8"


class Metrics:
    def __init__(self):
        self.available = _PROM
        if not _PROM:
            return
        reg = CollectorRegistry()
        self.registry = reg
        self.requests = Counter(
            "secondbrain_requests_total",
            "HTTP requests handled",
            ["endpoint", "method", "status"],
            registry=reg,
        )
        self.latency = Histogram(
            "secondbrain_request_latency_seconds",
            "Request latency in seconds",
            ["endpoint"],
            registry=reg,
        )
        self.llm_tokens = Counter(
            "secondbrain_llm_tokens_total",
            "Claude tokens consumed",
            ["direction"],  # input | output
            registry=reg,
        )
        self.answers = Counter(
            "secondbrain_answers_total",
            "Answer outcomes",
            ["result"],  # generated | cached | refused_out_of_corpus | refused_screen | error
            registry=reg,
        )
        self.cache_events = Counter(
            "secondbrain_answer_cache_total",
            "Answer cache events",
            ["event"],  # hit | miss | store
            registry=reg,
        )
        self.rate_limited = Counter(
            "secondbrain_rate_limited_total",
            "Requests rejected by the rate limiter",
            ["endpoint"],
            registry=reg,
        )
        self.retrievals = Counter(
            "secondbrain_retrievals_total",
            "Retrieval calls by mode",
            ["mode", "reranked"],
            registry=reg,
        )
        self.injections = Counter(
            "secondbrain_injection_detected_total",
            "Prompt-injection attempts detected",
            [],
            registry=reg,
        )
        self.indexed_docs = Gauge(
            "secondbrain_indexed_docs",
            "Documents in the vector store",
            registry=reg,
        )
        self.indexed_chunks = Gauge(
            "secondbrain_indexed_chunks",
            "Chunks in the vector store",
            registry=reg,
        )

    # -- safe observers (no-ops when prometheus is absent) ------------------

    def observe_request(self, endpoint: str, method: str, status: int, seconds: float) -> None:
        if not self.available:
            return
        self.requests.labels(endpoint=endpoint, method=method, status=str(status)).inc()
        self.latency.labels(endpoint=endpoint).observe(max(0.0, seconds))

    def observe_tokens(self, input_tokens: int = 0, output_tokens: int = 0) -> None:
        if not self.available:
            return
        if input_tokens:
            self.llm_tokens.labels(direction="input").inc(input_tokens)
        if output_tokens:
            self.llm_tokens.labels(direction="output").inc(output_tokens)

    def observe_answer(self, result: str) -> None:
        if self.available:
            self.answers.labels(result=result).inc()

    def observe_cache(self, event: str) -> None:
        if self.available:
            self.cache_events.labels(event=event).inc()

    def observe_rate_limited(self, endpoint: str) -> None:
        if self.available:
            self.rate_limited.labels(endpoint=endpoint).inc()

    def observe_retrieval(self, mode: str, reranked: bool) -> None:
        if self.available:
            self.retrievals.labels(mode=mode, reranked=str(bool(reranked)).lower()).inc()

    def observe_injection(self) -> None:
        if self.available:
            self.injections.inc()

    def set_index_size(self, docs: int, chunks: int) -> None:
        if self.available:
            self.indexed_docs.set(docs)
            self.indexed_chunks.set(chunks)

    def render(self) -> bytes:
        if not self.available:
            return b"# prometheus_client not installed\n"
        return generate_latest(self.registry)


@lru_cache
def get_metrics() -> Metrics:
    return Metrics()
