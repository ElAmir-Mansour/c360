"""Ingestion pipeline + CLI.

Idempotent + incremental: each document is keyed by a SHA-256 of its bytes;
unchanged docs are skipped unless ``force`` is set. The same ``ingest()``
function backs both the ``POST /ingest`` route and the CLI.

Robustness:
  * per-document status is tracked in ``library_documents``
    (ingested / ocr_partial / empty / failed) so a bad document surfaces in
    /health and the ingest report instead of vanishing;
  * OCR-failure handling — pages still below the text floor after OCR are
    counted as ``failed_pages`` (unsearchable) rather than crashing ingestion;
  * article-aware chunking builds a manifest-driven article index per document;
  * progress is logged per document.

    python -m app.ingest            # incremental (skip unchanged)
    python -m app.ingest --force    # re-ingest everything
"""

from __future__ import annotations

import argparse
import hashlib
import logging

from .config import get_settings
from .rag.article_chunking import article_chunk_pages, build_article_index
from .rag.chunking import chunk_pages
from .rag.corpus import doc_id_scheme, load_corpus_documents
from .rag.embeddings import get_embedder
from .rag.extraction import classify_empty, extract_pages
from .rag.vectorstore import VectorStore

log = logging.getLogger(__name__)


def _chunk(pages, meta, settings):
    """Article-aware when configured (safe fallback to page chunking)."""
    page_tuples = [(p.page_number, p.text) for p in pages]
    if settings.chunk_article_aware:
        chunks = article_chunk_pages(
            page_tuples, meta, settings.chunk_max_chars, settings.chunk_overlap
        )
        return chunks, build_article_index(chunks)
    return chunk_pages(page_tuples, meta, settings.chunk_max_chars, settings.chunk_overlap), []


def ingest(force: bool = False) -> dict:
    settings = get_settings()

    store = VectorStore(settings)
    store.bootstrap()
    embedder = get_embedder()

    docs = load_corpus_documents(settings)
    scheme, scoped_ask_supported = doc_id_scheme(docs, settings)
    log.info("resolved %d corpus documents (doc_id_scheme=%s)", len(docs), scheme)
    if docs and not scoped_ask_supported:
        # The corpus is keyed by code/filename but document-scoped /ask requests
        # arrive keyed by the reference-library UUID — they will match nothing
        # and refuse for EVERY document. Make this impossible to miss.
        log.warning(
            "CORPUS DOC-ID MISMATCH: %d document(s) are keyed by '%s', but "
            "document-scoped /ask uses the reference-library UUID. Doc-scoped "
            "questions will hit the out-of-corpus refusal for EVERY document "
            "until the corpus is ingested from LEX_API_URL (UUID-keyed).",
            len(docs), scheme,
        )
    total = len(docs)

    ingested_docs = 0
    total_chunks = 0
    skipped = 0
    failed = 0
    empty = 0
    ocr_failed = 0
    ocr_pages_total = 0
    per_doc = []

    for i, doc in enumerate(docs, start=1):
        log.info("[%d/%d] %s", i, total, doc.doc_id)
        try:
            data = doc.fetch_bytes()
        except Exception as exc:
            log.warning("fetch failed for %s: %s", doc.doc_id, exc)
            try:
                store.mark_document(doc, status="failed", error=f"fetch: {exc}")
            except Exception as merr:  # store may be down; keep going
                log.warning("could not record failure for %s: %s", doc.doc_id, merr)
            failed += 1
            skipped += 1
            per_doc.append({"doc_id": doc.doc_id, "status": "failed", "error": str(exc)})
            continue

        content_hash = hashlib.sha256(data).hexdigest()
        if not force and store.document_hash(doc.doc_id) == content_hash:
            log.info("skip unchanged: %s", doc.doc_id)
            skipped += 1
            per_doc.append({"doc_id": doc.doc_id, "status": "unchanged"})
            continue

        pages = extract_pages(data, settings)
        ocr_pages = sum(1 for p in pages if getattr(p, "ocr_used", False))
        failed_pages = sum(
            1 for p in pages if len((p.text or "").strip()) < settings.ocr_min_chars
        )
        ocr_pages_total += ocr_pages

        chunks, article_index = _chunk(pages, doc.as_meta(), settings)
        if not chunks:
            status, error, store_hash = classify_empty(pages)
            log.warning("no chunks for %s -> %s: %s", doc.doc_id, status, error)
            try:
                # (a) On an OCR failure we deliberately do NOT persist the content
                # hash, so the incremental-skip check misses next run and the doc
                # is retried once OCR is fixed — no --force required.
                store.mark_document(
                    doc, status=status, error=error,
                    content_hash=content_hash if store_hash else "",
                )
            except Exception as merr:
                log.warning("could not record %s status for %s: %s", status, doc.doc_id, merr)
            if status == "ocr_failed":
                ocr_failed += 1
            else:
                empty += 1
            skipped += 1
            per_doc.append(
                {"doc_id": doc.doc_id, "status": status, "pages": len(pages),
                 "failed_pages": failed_pages,
                 "ocr_failed_pages": sum(1 for p in pages if p.ocr_failed)}
            )
            continue

        embeddings = embedder.embed_documents([c.text for c in chunks])
        status = "ocr_partial" if failed_pages else "ingested"
        store.replace_document(
            doc, chunks, embeddings, content_hash, page_count=len(pages),
            ocr_pages=ocr_pages, failed_pages=failed_pages, status=status,
            article_index=article_index,
        )
        ingested_docs += 1
        total_chunks += len(chunks)
        per_doc.append(
            {
                "doc_id": doc.doc_id,
                "status": status,
                "pages": len(pages),
                "chunks": len(chunks),
                "articles": len(article_index),
                "ocr_pages": ocr_pages,
                "failed_pages": failed_pages,
            }
        )
        log.info(
            "ingested %s: %d pages, %d chunks, %d articles, %d ocr pages, %d failed pages",
            doc.doc_id, len(pages), len(chunks), len(article_index), ocr_pages, failed_pages,
        )

    result = {
        "ingested_docs": ingested_docs,
        "chunks": total_chunks,
        "skipped": skipped,
        "failed": failed,
        "empty": empty,
        "ocr_failed": ocr_failed,
        "ocr_pages": ocr_pages_total,
        "doc_id_scheme": scheme,
        "scoped_ask_supported": scoped_ask_supported,
        "documents": per_doc,
    }
    log.info(
        "ingestion complete: ingested=%d chunks=%d skipped=%d failed=%d empty=%d "
        "ocr_failed=%d doc_id_scheme=%s",
        ingested_docs, total_chunks, skipped, failed, empty, ocr_failed, scheme,
    )
    return result


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    parser = argparse.ArgumentParser(description="Ingest the WatheeqTech reference corpus.")
    parser.add_argument("--force", action="store_true", help="re-ingest even unchanged documents")
    args = parser.parse_args()
    print(ingest(force=args.force))


if __name__ == "__main__":
    main()
