"""Tests for the ingest hardening pass:

(a) an OCR-unreadable doc does NOT get a sticky content hash, so it self-heals
    on the next run once OCR is fixed;
(b) OCR failures surface as a distinct ``ocr_failed`` status instead of being
    swallowed to "" / an indistinguishable ``empty``;
(c) local-mode ingest keyed by code/filename (which cannot satisfy a UUID-scoped
    /ask) is detected loudly via ``doc_id_scheme`` instead of silently mismatching.

These exercise pure logic only — no pdfplumber/pytesseract/DB required (the OCR
engine is monkeypatched; the missing-deps path is exercised for real).
"""

from __future__ import annotations

import json
from types import SimpleNamespace

from app.rag import extraction
from app.rag.corpus import (
    CorpusDoc,
    doc_id_scheme,
    load_corpus_documents,
    looks_like_uuid,
)
from app.rag.extraction import Page, classify_empty, extract_pages
from app.rag.ocr import OcrOutcome, ocr_page

_UUID = "d84cbdd9-e1fd-4075-94c8-7ea52da2f193"


def _ocr_settings(enabled: bool = True, min_chars: int = 60) -> SimpleNamespace:
    return SimpleNamespace(
        ocr_enabled=enabled, ocr_min_chars=min_chars, ocr_dpi=300, ocr_lang="ara"
    )


# --------------------------------------------------------------------------- #
# (b) OCR outcome is typed, not a swallowed ""
# --------------------------------------------------------------------------- #

def test_ocr_page_missing_deps_reports_failure_not_empty_string():
    # pdf2image / pytesseract are not installed in the test env -> the real
    # ImportError path runs and must report failure (not a bare "").
    outcome = ocr_page(b"%PDF-1.4", 1, _ocr_settings())
    assert isinstance(outcome, OcrOutcome)
    assert outcome.text == ""
    assert outcome.failed is True
    assert outcome.attempted is False
    assert outcome.reason == "deps_missing"


def test_extract_pages_flags_ocr_failed_when_engine_unavailable(monkeypatch):
    monkeypatch.setattr(
        extraction, "_extract_text_layer", lambda data: [Page(1, "")]
    )
    monkeypatch.setattr(
        extraction, "ocr_page",
        lambda data, n, s: OcrOutcome(failed=True, reason="deps_missing"),
    )
    pages = extract_pages(b"", _ocr_settings())
    assert pages[0].needs_ocr is True
    assert pages[0].ocr_failed is True
    assert pages[0].ocr_used is False


def test_extract_pages_uses_ocr_text_when_available(monkeypatch):
    monkeypatch.setattr(
        extraction, "_extract_text_layer", lambda data: [Page(1, "")]
    )
    monkeypatch.setattr(
        extraction, "ocr_page",
        lambda data, n, s: OcrOutcome(text="نص عربي مستخرج" * 5, attempted=True),
    )
    pages = extract_pages(b"", _ocr_settings())
    assert pages[0].ocr_used is True
    assert pages[0].ocr_failed is False
    assert "نص عربي" in pages[0].text


def test_extract_pages_flags_ocr_failed_when_disabled(monkeypatch):
    monkeypatch.setattr(
        extraction, "_extract_text_layer", lambda data: [Page(1, "")]
    )
    pages = extract_pages(b"", _ocr_settings(enabled=False))
    assert pages[0].needs_ocr is True
    assert pages[0].ocr_failed is True  # recoverable by enabling OCR
    assert pages[0].text == ""


def test_extract_pages_leaves_text_layer_pages_untouched(monkeypatch):
    monkeypatch.setattr(
        extraction, "_extract_text_layer", lambda data: [Page(1, "x" * 200)]
    )
    # ocr_page must never be called for a page that already has enough text.
    monkeypatch.setattr(
        extraction, "ocr_page",
        lambda *a, **k: (_ for _ in ()).throw(AssertionError("OCR should not run")),
    )
    pages = extract_pages(b"", _ocr_settings())
    assert pages[0].needs_ocr is False
    assert pages[0].ocr_failed is False


# --------------------------------------------------------------------------- #
# (a) empty-doc classification drives self-heal vs sticky
# --------------------------------------------------------------------------- #

def test_classify_empty_ocr_failure_is_retryable_not_sticky():
    pages = [Page(1, "", ocr_failed=True), Page(2, "", ocr_failed=True)]
    status, error, store_hash = classify_empty(pages)
    assert status == "ocr_failed"
    assert store_hash is False  # (a) no sticky hash -> retried next run
    assert "tesseract" in error


def test_classify_empty_genuinely_empty_is_sticky():
    pages = [Page(1, ""), Page(2, "")]  # low-text but OCR never flagged failure
    status, error, store_hash = classify_empty(pages)
    assert status == "empty"
    assert store_hash is True  # sticky -> do not re-OCR a hopeless doc every run


# --------------------------------------------------------------------------- #
# (c) doc-id scheme / mismatch detection
# --------------------------------------------------------------------------- #

def test_looks_like_uuid():
    assert looks_like_uuid(_UUID) is True
    assert looks_like_uuid("  " + _UUID + "  ") is True
    assert looks_like_uuid("نظام-الاستثمار") is False
    assert looks_like_uuid("REF-014") is False
    assert looks_like_uuid("") is False


def test_doc_id_scheme_lex_mode_is_uuid_and_supported():
    settings = SimpleNamespace(lex_api_url="http://lex")
    scheme, supported = doc_id_scheme([], settings)
    assert scheme == "lex-uuid"
    assert supported is True


def test_doc_id_scheme_local_code_is_unsupported():
    settings = SimpleNamespace(lex_api_url="")
    docs = [CorpusDoc(doc_id="REF-014"), CorpusDoc(doc_id="نظام")]
    scheme, supported = doc_id_scheme(docs, settings)
    assert scheme == "local-code"
    assert supported is False


def test_doc_id_scheme_local_uuid_is_supported():
    settings = SimpleNamespace(lex_api_url="")
    docs = [CorpusDoc(doc_id=_UUID)]
    scheme, supported = doc_id_scheme(docs, settings)
    assert scheme == "lex-uuid"
    assert supported is True


def test_doc_id_scheme_empty_corpus():
    settings = SimpleNamespace(lex_api_url="")
    scheme, supported = doc_id_scheme([], settings)
    assert scheme == "empty"
    assert supported is False


# --------------------------------------------------------------------------- #
# (c) manifest id preference in local resolution
# --------------------------------------------------------------------------- #

def _write_corpus(tmp_path, entries):
    lib = tmp_path / "lib"
    lib.mkdir()
    for e in entries:
        (lib / e["source_filename"]).write_bytes(b"%PDF-1.4 dummy")
    manifest = tmp_path / "manifest.json"
    manifest.write_text(json.dumps({"documents": entries}), encoding="utf-8")
    return SimpleNamespace(
        lex_api_url="", library_path=str(lib), manifest_path=str(manifest)
    )


def test_local_docs_prefers_explicit_uuid_id(tmp_path):
    settings = _write_corpus(
        tmp_path,
        [{"source_filename": "a.pdf", "id": _UUID, "code": "REF-001", "title_ar": "أ"}],
    )
    docs = load_corpus_documents(settings)
    assert [d.doc_id for d in docs] == [_UUID]
    scheme, supported = doc_id_scheme(docs, settings)
    assert scheme == "lex-uuid" and supported is True


def test_local_docs_falls_back_to_code_then_filename(tmp_path):
    settings = _write_corpus(
        tmp_path,
        [
            {"source_filename": "a.pdf", "code": "REF-001", "title_ar": "أ"},
            {"source_filename": "b.pdf", "title_ar": "ب"},
        ],
    )
    docs = load_corpus_documents(settings)
    assert [d.doc_id for d in docs] == ["REF-001", "b"]
    scheme, supported = doc_id_scheme(docs, settings)
    assert scheme == "local-code" and supported is False
