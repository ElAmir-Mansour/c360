"""Retrieval — hybrid (vector + keyword) with cross-encoder reranking.

Pipeline (all knobs env-driven, see config):

    embed query
      → vector search  (cosine, candidate_k)   ┐
      → keyword search (tsvector, candidate_k)  ┘→ RRF fusion → cross-encoder
        rerank(top_n) → trim to top_k

Every step degrades gracefully: keyword search returning nothing falls back to
vector-only; an unavailable reranker keeps the fused order. Results are plain
dicts (not pydantic) so both /search (metadata) and /ask (needs chunk_text +
article locus for grounding) consume the same structure.

Result dict fields:
    doc_id, title_ar, title_en, snippet, page, score, chunk_text, category,
    article_no, article_label, chapter, part,
    vector_score  — cosine similarity or None (semantic out-of-corpus signal)
    keyword_score — ts_rank or None
    rrf_score, rerank_score, reranked, sources  — retrieval diagnostics
"""

from __future__ import annotations

import re

from .fusion import fuse_hybrid

_WS_RE = re.compile(r"\s+")


def _snippet(text: str, max_chars: int) -> str:
    text = _WS_RE.sub(" ", text or "").strip()
    if len(text) <= max_chars:
        return text
    return text[:max_chars].rstrip() + "…"


class Retriever:
    def __init__(self, settings):
        from .vectorstore import VectorStore

        self.settings = settings
        self.store = VectorStore(settings)

    # -- normalisation ------------------------------------------------------

    def _row_id(self, row) -> str:
        return f"{row['doc_id']}:{row['chunk_index']}"

    def _normalize(self, row, *, vector: bool):
        chunk_text = row.get("chunk_text") or ""
        raw = row.get("score")
        raw = float(raw) if raw is not None else None
        entry = {
            "_id": self._row_id(row),
            "doc_id": row["doc_id"],
            "chunk_index": row.get("chunk_index"),
            "title_ar": row.get("title_ar") or "",
            "title_en": row.get("title_en") or "",
            "snippet": _snippet(chunk_text, self.settings.snippet_chars),
            "page": row.get("page"),
            "chunk_text": chunk_text,
            "category": row.get("category") or "",
            "doc_type": row.get("doc_type") or "",
            "article_no": row.get("article_no"),
            "article_label": row.get("article_label") or "",
            "chapter": row.get("chapter") or "",
            "part": row.get("part") or "",
            # Primary display/relevance score.
            "score": raw,
            # Cosine (semantic) score used by the out-of-corpus guardrail.
            "vector_score": raw if vector else None,
            "keyword_score": None if vector else raw,
        }
        return entry

    # -- public -------------------------------------------------------------

    def search(self, query: str, top_k=None, doc_ids=None, mode=None):
        from .embeddings import get_embedder

        k = top_k or self.settings.default_top_k
        k = max(1, min(int(k), self.settings.max_top_k))
        mode = (mode or self.settings.retrieval_mode or "hybrid").lower()
        cand = max(k, int(self.settings.retrieval_candidate_k))

        vector_norm = []
        keyword_norm = []

        if mode in ("hybrid", "vector"):
            embedder = get_embedder()  # may raise EmbeddingsUnavailable
            qvec = embedder.embed_query(query)
            vector_rows = self.store.search(qvec, cand, doc_ids)  # may raise VectorStoreUnavailable
            vector_norm = [self._normalize(r, vector=True) for r in vector_rows]

        if mode in ("hybrid", "keyword"):
            keyword_rows = self.store.keyword_search(query, cand, doc_ids)
            keyword_norm = [self._normalize(r, vector=False) for r in keyword_rows]

        # Fuse / select.
        if mode == "vector":
            results = vector_norm
        elif mode == "keyword":
            results = keyword_norm
        else:  # hybrid
            if keyword_norm:
                vec_by_id = {e["_id"]: e for e in vector_norm}
                results = fuse_hybrid(
                    vector_norm, keyword_norm,
                    key=lambda e: e["_id"], k=int(self.settings.hybrid_rrf_k),
                )
                # Restore the exact cosine score for the semantic guardrail
                # (fusion preserves it, but be explicit for keyword-only hits).
                for e in results:
                    src = vec_by_id.get(e["_id"])
                    e["vector_score"] = src["vector_score"] if src else None
            else:
                results = vector_norm  # keyword unavailable → vector-only

        reranked = False
        if self.settings.rerank_enabled and results and mode != "keyword":
            from .rerank import apply_rerank

            results = apply_rerank(
                query, results, self.settings.rerank_model,
                int(self.settings.rerank_top_n),
            )
            reranked = any(r.get("reranked") for r in results)

        results = results[:k]
        for r in results:
            if r.get("score") is not None:
                r["score"] = round(float(r["score"]), 4)
            if r.get("vector_score") is not None:
                r["vector_score"] = round(float(r["vector_score"]), 4)
        self._last_mode = mode
        self._last_reranked = reranked
        return results
