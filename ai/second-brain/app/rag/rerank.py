"""Cross-encoder reranking with graceful fallback.

A bi-encoder (the e5 embedder) retrieves fast but scores query and passage
independently. A **cross-encoder** reads the (query, passage) pair jointly and
is markedly more accurate at ordering the top candidates — the standard
retrieve-then-rerank pattern. We rerank only the top ``rerank_top_n`` fused
candidates (reranking is O(n) model calls, so it is bounded), then return them
best-first.

The cross-encoder (``sentence-transformers`` ``CrossEncoder``, e.g.
``BAAI/bge-reranker-v2-m3`` — strong on Arabic) is a **quality boost, never a
hard dependency**: if the model or its deps can't load, ``rerank`` logs once and
returns the input order unchanged. Callers never crash for lack of a reranker.

Heavy deps are imported lazily so importing this module pulls in nothing.
"""

from __future__ import annotations

import logging
from functools import lru_cache
from typing import List, Optional, Sequence

log = logging.getLogger(__name__)


class RerankUnavailable(RuntimeError):
    """Raised internally when the cross-encoder can't be constructed."""


class CrossEncoderReranker:
    def __init__(self, model_name: str):
        try:
            from sentence_transformers import CrossEncoder
        except ImportError as exc:  # sentence-transformers/torch absent
            raise RerankUnavailable(f"sentence-transformers not installed: {exc}") from exc
        try:
            self.model = CrossEncoder(model_name)
        except Exception as exc:  # download / load failure
            raise RerankUnavailable(f"failed to load reranker '{model_name}': {exc}") from exc
        self.model_name = model_name

    def score(self, query: str, passages: Sequence[str]) -> List[float]:
        if not passages:
            return []
        scores = self.model.predict(
            [(query, p or "") for p in passages], convert_to_numpy=True
        )
        return [float(s) for s in scores]


@lru_cache(maxsize=4)
def _get_reranker(model_name: str) -> Optional[CrossEncoderReranker]:
    """Process-wide singleton per model. Returns None (cached) if unavailable."""
    try:
        return CrossEncoderReranker(model_name)
    except RerankUnavailable as exc:
        log.warning("reranker disabled: %s", exc)
        return None


def rerank_texts(
    query: str,
    passages: Sequence[str],
    model_name: str,
) -> Optional[List[float]]:
    """Score (query, passage) pairs. Returns None if the reranker is unavailable.

    Pure enough to unit-test the reordering logic below without a model — this
    function is the only part that touches the heavy model.
    """
    reranker = _get_reranker(model_name)
    if reranker is None:
        return None
    return reranker.score(query, passages)


def apply_rerank(
    query: str,
    results: List[dict],
    model_name: str,
    top_n: int,
    text_key: str = "chunk_text",
) -> List[dict]:
    """Rerank the top ``top_n`` results in place-safe fashion, best-first.

    Writes ``rerank_score`` onto each reranked entry and moves reranked entries
    (sorted by that score) ahead of the untouched tail. If the reranker is
    unavailable the input order is returned unchanged (a ``reranked=False`` flag
    is stamped for observability). Deterministic and side-effect free on the
    input list.
    """
    if not results:
        return results
    head = results[: max(0, top_n)]
    tail = results[max(0, top_n):]

    scores = rerank_texts(query, [r.get(text_key) or r.get("snippet") or "" for r in head], model_name)
    if scores is None:
        # Fallback: keep fused order, mark it.
        return [dict(r, reranked=False) for r in results]

    scored = []
    for r, s in zip(head, scores):
        e = dict(r)
        e["rerank_score"] = float(s)
        e["reranked"] = True
        scored.append(e)
    # Stable sort by rerank score desc; ties keep prior (fused) order.
    order = sorted(range(len(scored)), key=lambda i: (-scored[i]["rerank_score"], i))
    reordered = [scored[i] for i in order]
    return reordered + [dict(r, reranked=False) for r in tail]
