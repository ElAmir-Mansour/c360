"""Arabic-aware chunking. Pure logic — no I/O, no network, no heavy deps.

Text is normalised, split into sentences on Arabic + Latin terminators, then
greedily packed into overlapping chunks. Chunking happens per page so every
chunk carries an exact page number for citations.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Iterable

# Sentence boundary: after a terminator (Arabic ؟ ؛ ، excluded; . ! ? ؟ ؛ kept)
# followed by whitespace, OR on a blank line.
_SENTENCE_SPLIT_RE = re.compile(r"(?<=[\.\!\?؟؛])\s+|\n{2,}")
_INLINE_WS_RE = re.compile(r"[ \t ]+")


@dataclass
class Chunk:
    doc_id: str
    chunk_index: int
    text: str
    page: int | None = None
    title_ar: str = ""
    title_en: str = ""
    category: str = ""
    doc_type: str = ""
    authority: str = ""
    tags: list = field(default_factory=list)
    metadata: dict = field(default_factory=dict)
    # Article-aware fields (populated by article_chunking; empty otherwise).
    article_no: int | None = None
    article_label: str = ""
    chapter: str = ""
    part: str = ""


def normalize(text: str) -> str:
    """Collapse intra-line whitespace, keep paragraph breaks, trim.

    Preserves Arabic code points verbatim (no reshaping, no bidi rewriting) —
    the raw logical-order Unicode is what embeddings and Claude expect.
    """
    if not text:
        return ""
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    lines = [_INLINE_WS_RE.sub(" ", ln).strip() for ln in text.split("\n")]
    text = "\n".join(lines)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def split_sentences(text: str) -> list[str]:
    text = normalize(text)
    if not text:
        return []
    parts = _SENTENCE_SPLIT_RE.split(text)
    return [p.strip() for p in parts if p and p.strip()]


def chunk_units(sentences: list[str], max_chars: int, overlap: int) -> list[str]:
    """Greedily pack sentences into <= max_chars chunks with sentence overlap.

    Overlap is realised by carrying trailing sentences of a completed chunk into
    the next one (up to ``overlap`` chars). Sentences longer than ``max_chars``
    are hard-split so a chunk never exceeds the limit.
    """
    chunks: list[str] = []
    cur: list[str] = []
    cur_len = 0

    def flush() -> None:
        nonlocal cur, cur_len
        if cur:
            joined = " ".join(cur).strip()
            if joined:
                chunks.append(joined)
        cur, cur_len = [], 0

    for s in sentences:
        if len(s) > max_chars:
            # Oversized single sentence: flush, then hard-split it.
            flush()
            for j in range(0, len(s), max_chars):
                piece = s[j:j + max_chars].strip()
                if piece:
                    chunks.append(piece)
            continue

        projected = cur_len + len(s) + (1 if cur else 0)
        if cur and projected > max_chars:
            flush()
            # Rebuild an overlap tail from the just-flushed chunk.
            tail: list[str] = []
            tail_len = 0
            for prev in reversed(chunks[-1].split(" ")):
                # walk words backwards until we reach the overlap budget
                if tail_len + len(prev) + 1 > overlap:
                    break
                tail.insert(0, prev)
                tail_len += len(prev) + 1
            if tail:
                cur = [" ".join(tail)]
                cur_len = tail_len

        cur.append(s)
        cur_len += len(s) + 1

    flush()
    return chunks


def chunk_pages(
    pages: Iterable[tuple[int, str]],
    meta: dict[str, Any],
    max_chars: int = 1200,
    overlap: int = 200,
) -> list[Chunk]:
    """Chunk a document page-by-page, carrying metadata + page numbers.

    ``pages`` is an iterable of ``(page_number, page_text)`` tuples. ``meta`` is
    the document metadata (doc_id, title_ar/en, category, doc_type, authority,
    tags, metadata). Returns a flat, globally-indexed list of Chunk.
    """
    out: list[Chunk] = []
    idx = 0
    tags = list(meta.get("tags") or [])
    doc_metadata = dict(meta.get("metadata") or {})
    for page_number, page_text in pages:
        for unit in chunk_units(split_sentences(page_text), max_chars, overlap):
            out.append(
                Chunk(
                    doc_id=meta["doc_id"],
                    chunk_index=idx,
                    text=unit,
                    page=page_number,
                    title_ar=meta.get("title_ar", ""),
                    title_en=meta.get("title_en", ""),
                    category=meta.get("category", ""),
                    doc_type=meta.get("doc_type", ""),
                    authority=meta.get("authority", ""),
                    tags=tags,
                    metadata=doc_metadata,
                )
            )
            idx += 1
    return out
