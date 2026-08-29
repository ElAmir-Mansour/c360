"""Corpus source resolution.

Two sources, selected by config:

1. **LEX_API_URL set** (preferred): pull the catalog from
   ``GET {LEX_API_URL}/api/v1/lex/reference-library`` (real doc_ids + metadata)
   and the bytes from ``GET .../{id}/download``. Matches the Go
   ``ReferenceLibraryDocument`` JSON shape (id, title_ar, title_en, category,
   doc_type, authority, tags, metadata).

2. **Local fallback**: read the manifest
   (``docs/ClarioWatheeq/reference_library_manifest.json``) for metadata and the
   PDFs from ``docs/ClarioWatheeq/WatheeqTech Library/``. doc_id is keyed by the
   manifest ``code`` (or the source filename). If the manifest is absent, the
   PDF directory is enumerated and metadata is inferred from the filename.

httpx is imported lazily so importing this module needs no HTTP client.
"""

from __future__ import annotations

import json
import logging
import re
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

log = logging.getLogger(__name__)

_UUID_RE = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)


def looks_like_uuid(value: str) -> bool:
    """True when ``value`` is a canonical 8-4-4-4-12 UUID string."""
    return bool(_UUID_RE.match((value or "").strip()))


def _norm_ar(text: str) -> str:
    """NFKC-normalise and fold alef-hamza variants so startswith/contains checks
    are robust to how a filename encodes أ / إ / آ vs a bare ا."""
    text = unicodedata.normalize("NFKC", text or "")
    for ch in ("أ", "إ", "آ", "ٱ"):
        text = text.replace(ch, "ا")
    return text


@dataclass
class CorpusDoc:
    doc_id: str
    title_ar: str = ""
    title_en: str = ""
    category: str = ""
    doc_type: str = ""
    authority: str = ""
    tags: list = field(default_factory=list)
    metadata: dict = field(default_factory=dict)
    _fetch: Callable[[], bytes] | None = None

    def fetch_bytes(self) -> bytes:
        if self._fetch is None:
            raise RuntimeError(f"no byte source bound for doc {self.doc_id}")
        return self._fetch()

    def as_meta(self) -> dict[str, Any]:
        return {
            "doc_id": self.doc_id,
            "title_ar": self.title_ar,
            "title_en": self.title_en,
            "category": self.category,
            "doc_type": self.doc_type,
            "authority": self.authority,
            "tags": self.tags,
            "metadata": self.metadata,
        }


# --------------------------------------------------------------------------- #
# Local manifest / filename fallback
# --------------------------------------------------------------------------- #

def _clean_title(filename: str) -> str:
    name = filename
    for suffix in (".pdf", ".PDF"):
        if name.endswith(suffix):
            name = name[: -len(suffix)]
    name = name.replace("_copy", "").replace("_", " ").strip()
    return name.strip("_ ").strip()


def _infer_category(title: str) -> tuple[str, str]:
    t = _norm_ar(title)
    if "مجلة قضاء" in t:
        return "judicial-journal", "judicial-journal"
    # "نظام ..." (a law, often bundled with its لائحة) or "أنظمة ..." (a compendium
    # of statutes) — both are systems-regulations at the top level.
    if t.startswith("نظام") or t.startswith("انظم"):
        return "systems-regulations", "system"
    return "research", "research"


def _infer_tags(title: str) -> list[str]:
    t = _norm_ar(title)
    tags: list[str] = []
    keywords = {
        "عقاري": ["عقار", "ملكية", "اراضي", "اراض"],
        "قضاء": ["قضاء", "قضائي", "احكام", "دعوى", "مرافعات"],
        "استثمار": ["استثمار", "منافسة", "شركات"],
        "جزائي": ["جرائم", "فساد", "عقوب"],
        "زكاة وضرائب": ["زكاة", "ضريب"],
    }
    for tag, needles in keywords.items():
        if any(_norm_ar(n) in t for n in needles):
            tags.append(tag)
    return tags


def _load_manifest(settings) -> list[dict] | None:
    path = Path(settings.manifest_path)
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        log.warning("failed to parse manifest %s: %s", path, exc)
        return None
    if isinstance(data, dict):
        data = data.get("documents") or data.get("data") or []
    return data if isinstance(data, list) else None


def _local_docs(settings) -> list[CorpusDoc]:
    lib = Path(settings.library_path)
    if not lib.exists():
        log.warning("library path does not exist: %s", lib)
    manifest = _load_manifest(settings)
    docs: list[CorpusDoc] = []

    if manifest:
        log.info("loading corpus from manifest (%d entries)", len(manifest))
        for entry in manifest:
            filename = entry.get("source_filename") or entry.get("filename")
            if not filename:
                log.warning("manifest entry has no source_filename: %s", entry.get("title_ar"))
                continue
            path = lib / filename
            if not path.exists():
                log.warning("manifest PDF missing on disk: %s", path)
                continue
            # Prefer an explicit reference-library id/UUID when the manifest
            # carries one, so local-mode chunks key by the SAME id the React
            # detail page scopes /ask with. Falls back to code/filename (which
            # will NOT match a UUID-scoped ask — see doc_id_scheme()).
            doc_id = str(
                entry.get("id")
                or entry.get("uuid")
                or entry.get("doc_id")
                or entry.get("code")
                or filename.rsplit(".", 1)[0]
            )
            docs.append(
                CorpusDoc(
                    doc_id=doc_id,
                    title_ar=entry.get("title_ar", ""),
                    title_en=entry.get("title_en", ""),
                    category=entry.get("category", ""),
                    doc_type=entry.get("doc_type", ""),
                    authority=entry.get("authority", ""),
                    tags=list(entry.get("tags") or []),
                    metadata=dict(entry.get("metadata") or {}),
                    _fetch=(lambda p=path: p.read_bytes()),
                )
            )
        return docs

    # No manifest: enumerate PDFs and infer metadata from the filename.
    log.info("no manifest found; enumerating PDFs under %s", lib)
    for path in sorted(lib.glob("*.pdf")):
        title = _clean_title(path.name)
        category, doc_type = _infer_category(title)
        docs.append(
            CorpusDoc(
                doc_id=path.name.rsplit(".", 1)[0],
                title_ar=title,
                title_en="",
                category=category,
                doc_type=doc_type,
                authority="",
                tags=_infer_tags(title),
                metadata={"source_filename": path.name},
                _fetch=(lambda p=path: p.read_bytes()),
            )
        )
    return docs


# --------------------------------------------------------------------------- #
# LEX API source
# --------------------------------------------------------------------------- #

def _lex_headers(settings) -> dict[str, str]:
    headers: dict[str, str] = {}
    if settings.lex_api_token:
        headers["Authorization"] = f"Bearer {settings.lex_api_token}"
    if settings.lex_tenant_id:
        headers["X-Tenant-ID"] = settings.lex_tenant_id
    return headers


def _lex_fetch(base: str, doc_id: str, headers: dict[str, str], settings) -> Callable[[], bytes]:
    def fetch() -> bytes:
        import httpx

        url = f"{base}/api/v1/lex/reference-library/{doc_id}/download"
        with httpx.Client(timeout=settings.request_timeout, headers=headers) as client:
            resp = client.get(url)
            resp.raise_for_status()
            return resp.content

    return fetch


def _lex_docs(settings) -> list[CorpusDoc]:
    import httpx

    base = settings.lex_api_url.rstrip("/")
    headers = _lex_headers(settings)
    with httpx.Client(timeout=settings.request_timeout, headers=headers) as client:
        resp = client.get(
            f"{base}/api/v1/lex/reference-library", params={"per_page": 200}
        )
        resp.raise_for_status()
        payload = resp.json()

    rows = payload.get("data") if isinstance(payload, dict) else payload
    docs: list[CorpusDoc] = []
    for row in rows or []:
        doc_id = str(row.get("id") or row.get("doc_id") or "")
        if not doc_id:
            continue
        docs.append(
            CorpusDoc(
                doc_id=doc_id,
                title_ar=row.get("title_ar", ""),
                title_en=row.get("title_en", ""),
                category=row.get("category", ""),
                doc_type=row.get("doc_type", ""),
                authority=row.get("authority", ""),
                tags=list(row.get("tags") or []),
                metadata=dict(row.get("metadata") or {}),
                _fetch=_lex_fetch(base, doc_id, headers, settings),
            )
        )
    log.info("loaded %d documents from LEX_API_URL", len(docs))
    return docs


def load_corpus_documents(settings) -> list[CorpusDoc]:
    if settings.lex_api_url:
        return _lex_docs(settings)
    return _local_docs(settings)


def doc_id_scheme(docs: list[CorpusDoc], settings) -> tuple[str, bool]:
    """Classify how the resolved corpus is keyed — for silent-mismatch detection.

    The React document detail page scopes ``/ask`` by the reference-library
    **UUID**. When ingest keys chunks by a manifest ``code``/filename instead
    (the local fallback, with no UUID available), doc-scoped retrieval matches
    zero rows and EVERY question refuses out-of-corpus — a failure that is
    otherwise invisible. Returns ``(scheme, scoped_ask_supported)`` where
    ``scheme`` is ``"lex-uuid"`` | ``"local-code"`` | ``"empty"``.
    """
    if settings.lex_api_url:
        return "lex-uuid", True
    ids = [d.doc_id for d in docs]
    if not ids:
        return "empty", False
    if all(looks_like_uuid(i) for i in ids):
        return "lex-uuid", True
    return "local-code", False
