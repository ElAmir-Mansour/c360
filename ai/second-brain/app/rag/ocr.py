"""OCR for scanned pages — pytesseract (Arabic) via pdf2image.

Heavy deps (pdf2image, pytesseract) and the tesseract binary are imported/used
lazily. A failure no longer silently collapses to an empty string that is
indistinguishable from a genuinely-blank page: ``ocr_page`` returns an
:class:`OcrOutcome` recording whether OCR was *attempted* and whether it
*failed* (and why). The ingest pipeline uses that to mark a scanned-but-unreadable
document ``ocr_failed`` (actionable: install tesseract/poppler) rather than the
look-alike ``empty`` status — and to decide whether the doc should self-heal on
the next run. ``ocr_page`` never raises; a missing binary/dep is reported, not
crashed on.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

log = logging.getLogger(__name__)


@dataclass
class OcrOutcome:
    """Result of an OCR attempt on one page.

    ``text``      — extracted text ("" when nothing usable was produced).
    ``attempted`` — the OCR engine was actually invoked (deps + binary present).
    ``failed``    — OCR was needed but produced no usable text because a
                    dependency/binary was missing or the engine errored. This is
                    distinct from a page that OCR'd cleanly to empty (a genuinely
                    blank image), which is ``attempted=True, failed=False``.
    ``reason``    — short machine tag when failed: ``'deps_missing'`` |
                    ``'ocr_error'`` | ``'render_empty'``; ``None`` on success.
    """

    text: str = ""
    attempted: bool = False
    failed: bool = False
    reason: str | None = None


def ocr_page(data: bytes, page_number: int, settings) -> OcrOutcome:
    """OCR a single 1-indexed PDF page.

    Requires the ``tesseract`` binary with the Arabic language pack
    (``tesseract-ocr-ara``) and ``poppler`` (``poppler-utils``) for pdf2image.
    Never raises — a missing dependency/binary is reported via the returned
    :class:`OcrOutcome` (``failed=True``) instead of crashing ingestion.
    """
    try:
        from pdf2image import convert_from_bytes
        import pytesseract
    except ImportError as exc:  # deps not installed
        log.warning("OCR unavailable (missing python deps): %s", exc)
        return OcrOutcome(failed=True, reason="deps_missing")

    try:
        images = convert_from_bytes(
            data,
            dpi=settings.ocr_dpi,
            first_page=page_number,
            last_page=page_number,
        )
        if not images:
            return OcrOutcome(attempted=True, failed=True, reason="render_empty")
        text = pytesseract.image_to_string(images[0], lang=settings.ocr_lang)
        return OcrOutcome(text=text or "", attempted=True)
    except Exception as exc:  # missing tesseract binary, bad page, etc.
        log.warning("OCR failed on page %s: %s", page_number, exc)
        return OcrOutcome(attempted=True, failed=True, reason="ocr_error")
