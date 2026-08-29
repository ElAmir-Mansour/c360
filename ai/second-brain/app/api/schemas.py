"""Request / response models — mirror the Go proxy contract in
backend/internal/lex/dto/reference_library_dto.go.

The base contract (fields the Go proxy + React UI already build against) is kept
stable; every field added for the hardening pass is optional/additive.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel


class HealthResponse(BaseModel):
    status: str
    indexed_docs: int
    indexed_chunks: int
    # Additive: richer health for ops dashboards.
    components: Optional[Dict[str, Any]] = None
    index: Optional[Dict[str, Any]] = None
    cache: Optional[Dict[str, Any]] = None
    version: Optional[str] = None


class IngestRequest(BaseModel):
    force: bool = False


class IngestResponse(BaseModel):
    ingested_docs: int
    chunks: int
    skipped: int
    # Additive.
    failed: int = 0
    empty: int = 0
    # Scanned docs that needed OCR but could not be read (actionable: install
    # tesseract/poppler). Retried on the next run — not made sticky.
    ocr_failed: int = 0
    ocr_pages: int = 0
    # Corpus key scheme + whether document-scoped /ask can resolve against it
    # ("local-code" keying will refuse every UUID-scoped question).
    doc_id_scheme: Optional[str] = None
    scoped_ask_supported: Optional[bool] = None
    documents: Optional[List[Dict[str, Any]]] = None


class SearchItem(BaseModel):
    doc_id: str
    title_ar: str = ""
    title_en: str = ""
    snippet: str = ""
    score: float
    # Additive: article locus + page for the UI.
    page: Optional[int] = None
    article_no: Optional[int] = None
    article_label: str = ""
    chapter: str = ""
    part: str = ""


class SearchResponse(BaseModel):
    data: List[SearchItem]
    meta: dict


class ArticleItem(BaseModel):
    # Stringified to match the /articles contract ("3"); "" when the article
    # carries no parseable number.
    article_no: str = ""
    # Canonical Arabic label — the feminine ordinal form when derivable, else
    # "مادة {n}" / the label captured at ingest.
    label: str = ""
    # The مادة heading/rubric text if captured at ingest; null otherwise.
    title: Optional[str] = None
    page: Optional[int] = None


class ArticlesResponse(BaseModel):
    data: List[ArticleItem]
    # {"count": N, "doc_id": "..."} on success; omitted/null on the graceful
    # DB-unavailable path (data is still [] and the status is still 200).
    meta: Optional[Dict[str, Any]] = None


class AskRequest(BaseModel):
    question: str
    top_k: int = 8
    doc_ids: Optional[List[str]] = None
    # Additive: override retrieval mode / bypass the answer cache per request.
    mode: Optional[str] = None
    no_cache: bool = False


class Citation(BaseModel):
    doc_id: str
    title_ar: str = ""
    title_en: str = ""
    snippet: str = ""
    page: Optional[int] = None
    score: Optional[float] = None
    # Additive: legal locus.
    article_no: Optional[int] = None
    article_label: str = ""
    chapter: str = ""
    part: str = ""


class AskResponse(BaseModel):
    answer: str
    citations: List[Citation]
    model: str
    latency_ms: int
    # Additive: observability / grounding signals.
    usage: Optional[Dict[str, int]] = None
    cached: bool = False
    grounded: Optional[bool] = None
    refused: bool = False
