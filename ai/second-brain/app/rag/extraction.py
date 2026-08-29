"""PDF text extraction with per-page OCR fallback.

Primary path is pdfplumber (better Arabic layout); pypdf is the fallback. Each
page's text-layer output is measured; pages below ``ocr_min_chars`` are treated
as scanned and re-run through OCR (Arabic). Page numbers are preserved 1-indexed.
"""

from __future__ import annotations

import io
import logging
from dataclasses import dataclass

from .ocr import ocr_page

log = logging.getLogger(__name__)


@dataclass
class Page:
    page_number: int
    text: str
    ocr_used: bool = False
    # Hardening: tell a genuinely-blank page apart from one that NEEDED OCR but
    # could not be read (missing tesseract/poppler/lang pack, or OCR disabled).
    needs_ocr: bool = False
    ocr_attempted: bool = False
    ocr_failed: bool = False


def _extract_text_layer(data: bytes) -> list[Page]:
    # Try pdfplumber first.
    try:
        import pdfplumber

        pages: list[Page] = []
        with pdfplumber.open(io.BytesIO(data)) as pdf:
            for i, page in enumerate(pdf.pages, start=1):
                pages.append(Page(i, page.extract_text() or ""))
        return pages
    except Exception as exc:
        log.warning("pdfplumber extraction failed (%s); falling back to pypdf", exc)

    # Fallback: pypdf.
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(data))
    return [Page(i, page.extract_text() or "") for i, page in enumerate(reader.pages, start=1)]


def extract_pages(data: bytes, settings) -> list[Page]:
    """Extract text for every page, OCR-ing low-text (scanned) pages.

    A page whose text-layer is below ``ocr_min_chars`` is flagged ``needs_ocr``.
    If OCR is disabled, or is enabled but the engine is unavailable / errors,
    that page is flagged ``ocr_failed`` — so the caller can tell "scanned but
    unreadable" (actionable, should retry) apart from "genuinely empty".
    """
    pages = _extract_text_layer(data)
    for page in pages:
        if len((page.text or "").strip()) >= settings.ocr_min_chars:
            continue
        page.needs_ocr = True
        if not settings.ocr_enabled:
            # Scanned content we are choosing not to read (yet): recoverable by
            # enabling OCR, so surface it rather than treating it as empty.
            page.ocr_failed = True
            continue
        outcome = ocr_page(data, page.page_number, settings)
        page.ocr_attempted = outcome.attempted
        if outcome.text and len(outcome.text.strip()) > len((page.text or "").strip()):
            page.text = outcome.text
            page.ocr_used = True
        elif outcome.failed:
            page.ocr_failed = True
    return pages


def classify_empty(pages: list[Page]) -> tuple[str, str, bool]:
    """Classify a document that produced zero chunks.

    Returns ``(status, error, store_content_hash)``.

    * A doc whose scanned pages could not be OCR'd (missing tesseract/poppler/
      lang pack, or OCR disabled) is ``ocr_failed`` and its content hash is NOT
      persisted, so a later run RETRIES it automatically once OCR is fixed — no
      ``--force`` needed.
    * A doc that is genuinely empty (a real text-layer that is blank, with
      nothing to OCR) is ``empty`` and its hash IS persisted, so a hopeless doc
      is not re-processed on every incremental run.
    """
    ocr_failed_pages = sum(1 for p in pages if p.ocr_failed)
    if ocr_failed_pages:
        return (
            "ocr_failed",
            (
                f"OCR unavailable/failed for {ocr_failed_pages} scanned page(s) — "
                "install tesseract-ocr + tesseract-ocr-ara + poppler-utils (or set "
                "OCR_ENABLED=true) and re-ingest"
            ),
            False,  # do not persist hash -> self-heals on the next run
        )
    return (
        "empty",
        "no extractable text (no text layer and no scanned content to OCR)",
        True,  # genuinely empty -> sticky, don't re-attempt every run
    )
