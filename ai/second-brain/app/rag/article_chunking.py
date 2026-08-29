"""Article-aware chunking for Saudi legal text. Pure logic — no I/O, no deps.

Saudi statutes (الأنظمة واللوائح) are organised as a hierarchy:

    الباب   (Part / Book)      e.g. "الباب الأول: التعريفات"
      الفصل (Chapter)          e.g. "الفصل الثاني: الأحكام العامة"
        الفرع (Section)        e.g. "الفرع الأول"
          المادة (Article)     e.g. "المادة الخامسة والعشرون:" / "المادة (5):" / "مادة ٥"

Chunking on the raw fixed-size window splits an article mid-sentence and loses
the article number a lawyer actually cites. This module instead:

1. Detects باب / فصل / فرع headings and المادة boundaries in reading order,
   tolerating Arabic-Indic (٠-٩) and Western digits, parenthesised numbers,
   and Arabic ordinal words ("الأولى" … "الثانية والعشرون").
2. Carries the *current* part / chapter / article across page breaks, so text
   that continues onto the next page keeps its article attribution and its own
   (correct) page number.
3. Packs each article's body into ``<= max_chars`` overlapping chunks (reusing
   the sentence packer in ``chunking``) and stamps every chunk with the article
   number/label + chapter + part for metadata and citations.

If a document has **no** article markers (a research paper, a scanned مجلة قضاء
issue), every segment is preamble and the output is identical to plain
``chunk_pages`` — so this is safe to run over the whole corpus.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from typing import Iterable, Optional

from .chunking import Chunk, chunk_units, normalize, split_sentences

# --------------------------------------------------------------------------- #
# Digit + ordinal parsing
# --------------------------------------------------------------------------- #

_ARABIC_INDIC = "٠١٢٣٤٥٦٧٨٩"
_ARABIC_INDIC_MAP = {ch: str(i) for i, ch in enumerate(_ARABIC_INDIC)}
# Eastern-Arabic (Persian) variants sometimes appear in mixed PDFs.
_EASTERN = "۰۱۲۳۴۵۶۷۸۹"
_ARABIC_INDIC_MAP.update({ch: str(i) for i, ch in enumerate(_EASTERN)})

# Arabic ordinal words 1..10 (feminine form, as used with مادة).
_ORDINAL_ONES = {
    "الاولى": 1, "الأولى": 1, "اولى": 1,
    "الثانية": 2, "ثانية": 2,
    "الثالثة": 3, "ثالثة": 3,
    "الرابعة": 4, "رابعة": 4,
    "الخامسة": 5, "خامسة": 5,
    "السادسة": 6, "سادسة": 6,
    "السابعة": 7, "سابعة": 7,
    "الثامنة": 8, "ثامنة": 8,
    "التاسعة": 9, "تاسعة": 9,
    "العاشرة": 10, "عاشرة": 10,
}
# Tens words.
_ORDINAL_TENS = {
    "العشرون": 20, "العشرين": 20,
    "الثلاثون": 30, "الثلاثين": 30,
    "الاربعون": 40, "الأربعون": 40, "الاربعين": 40, "الأربعين": 40,
    "الخمسون": 50, "الخمسين": 50,
    "الستون": 60, "الستين": 60,
    "السبعون": 70, "السبعين": 70,
    "الثمانون": 80, "الثمانين": 80,
    "التسعون": 90, "التسعين": 90,
    "المائة": 100, "المئة": 100,
}
# "عشرة" marks a teen (11..19): ones + عشرة.
_TEEN_MARK = {"عشرة", "عشر"}


def _fold(text: str) -> str:
    """NFKC + fold hamza-carrying alef variants so ordinal lookups are robust."""
    text = unicodedata.normalize("NFKC", text or "")
    for ch in ("أ", "إ", "آ", "ٱ"):
        text = text.replace(ch, "ا")
    return text


def _digits_to_int(token: str) -> Optional[int]:
    out = []
    for ch in token:
        if ch.isdigit():
            out.append(ch)
        elif ch in _ARABIC_INDIC_MAP:
            out.append(_ARABIC_INDIC_MAP[ch])
    if out:
        try:
            return int("".join(out))
        except ValueError:
            return None
    return None


def parse_arabic_ordinal(label: str) -> Optional[int]:
    """Parse an article number from its label. Returns None if unparseable.

    Handles digits ("(5)", "٥", "12"), simple ordinals ("الخامسة" -> 5),
    teens ("الخامسة عشرة" -> 15) and ones+tens compounds
    ("الثانية والعشرون" -> 22, "الخامسة والثلاثون" -> 35).
    """
    if not label:
        return None
    text = _fold(label)
    # 1. Any digits present win outright.
    d = _digits_to_int(text)
    if d is not None:
        return d
    # 2. Word ordinals — tokenise on whitespace + the connector و.
    tokens = [t for t in re.split(r"[\s]+|و(?=ال)", text) if t]
    # Re-split leading "و" glued to a tens word ("والعشرون").
    norm_tokens = []
    for t in tokens:
        if t.startswith("و") and t[1:] in _ORDINAL_TENS:
            norm_tokens.append(t[1:])
        else:
            norm_tokens.append(t)
    tokens = norm_tokens

    ones = None
    tens = None
    teen = False
    for t in tokens:
        if t in _ORDINAL_ONES and ones is None:
            ones = _ORDINAL_ONES[t]
        elif t in _ORDINAL_TENS and tens is None:
            tens = _ORDINAL_TENS[t]
        elif t in _TEEN_MARK:
            teen = True
    if ones is None and tens is None:
        return None
    if teen and ones is not None:
        # الحادية عشرة .. التاسعة عشرة  -> 11..19 (ones + 10)
        return 10 + ones
    total = 0
    if tens is not None:
        total += tens
    if ones is not None:
        total += ones
    return total or None


# --------------------------------------------------------------------------- #
# Ordinal *formatting* (inverse of parse_arabic_ordinal) — for TOC labels
# --------------------------------------------------------------------------- #

# Standalone feminine ordinals 1..10 as used with مادة ("المادة الأولى").
_ORD_STANDALONE = {
    1: "الأولى", 2: "الثانية", 3: "الثالثة", 4: "الرابعة", 5: "الخامسة",
    6: "السادسة", 7: "السابعة", 8: "الثامنة", 9: "التاسعة", 10: "العاشرة",
}
# Unit component inside a compound (teens + tens): "1" is حادية, not أولى.
_ORD_UNIT = {
    1: "الحادية", 2: "الثانية", 3: "الثالثة", 4: "الرابعة", 5: "الخامسة",
    6: "السادسة", 7: "السابعة", 8: "الثامنة", 9: "التاسعة",
}
_ORD_TENS = {
    20: "العشرون", 30: "الثلاثون", 40: "الأربعون", 50: "الخمسون",
    60: "الستون", 70: "السبعون", 80: "الثمانون", 90: "التسعون",
}


def arabic_ordinal_feminine(n) -> Optional[str]:
    """Feminine Arabic ordinal words for a whole number, or None if unsupported.

    Covers 1..99 (e.g. 3 -> "الثالثة", 13 -> "الثالثة عشرة",
    21 -> "الحادية والعشرون", 35 -> "الخامسة والثلاثون") and exactly 100
    ("المائة"). Returns None for anything outside that vocabulary (0, negatives,
    non-ints, 101+) so the caller can fall back to a digit form — never guesses.
    """
    if isinstance(n, bool) or not isinstance(n, int) or n < 1:
        return None
    if n <= 10:
        return _ORD_STANDALONE[n]
    if n <= 19:
        return f"{_ORD_UNIT[n - 10]} عشرة"
    if n == 100:
        return "المائة"
    if n < 100:
        tens = (n // 10) * 10
        unit = n % 10
        if unit == 0:
            return _ORD_TENS[tens]
        return f"{_ORD_UNIT[unit]} و{_ORD_TENS[tens]}"
    return None


def format_article_label(article_no, fallback_label: str = "") -> str:
    """Canonical article label for a table-of-contents row.

    Prefers the derived feminine ordinal ("المادة الثالثة") when the number is in
    range; drops to the digit form ("مادة 105") when it is not; and — when there
    is no number at all — reuses whatever label was captured at ingest (else the
    bare "مادة"). Honest: never invents an ordinal it can't form.
    """
    if isinstance(article_no, int) and not isinstance(article_no, bool):
        ordinal = arabic_ordinal_feminine(article_no)
        if ordinal:
            return f"المادة {ordinal}"
        return f"مادة {article_no}"
    label = (fallback_label or "").strip()
    return label or "مادة"


# --------------------------------------------------------------------------- #
# Marker detection
# --------------------------------------------------------------------------- #

# An article header at (line start): "المادة"/"مادة" + a number token +
# a terminator (colon / dash / period / end-of-line). Anchoring to line start
# stops inline references ("وفقاً للمادة الأولى من النظام") from matching.
_NUM_TOKEN = (
    r"(?:\([ \t]*[0-9٠-٩۰-۹]+[ \t]*\)"   # (12) / (١٢)
    r"|[0-9٠-٩۰-۹]+"                      # 12 / ١٢
    r"|[ء-ي]+(?:[ \t]+و?[ء-ي]+){0,3})"    # ordinal words (+ connectors, no newline)
)
_ARTICLE_RE = re.compile(
    r"(?:^|\n)[ \t]*(?P<kw>ال?مادة)[ \t]+(?P<num>" + _NUM_TOKEN + r")"
    r"[ \t]*(?=[:\.–—\-]|\n|$)",
    re.UNICODE,
)
# Part / chapter / section headings — capture the heading line for metadata.
_HEADING_RE = re.compile(
    r"(?:^|\n)[ \t]*(?P<hkw>الباب|الفصل|الفرع)[ \t]+(?P<label>[^\n:：]{1,60})",
    re.UNICODE,
)


@dataclass
class Segment:
    kind: str                      # "preamble" | "article" | "heading"
    text: str                      # body text following the marker
    heading_kind: str = ""         # "part" | "chapter" | "section" (heading only)
    heading_label: str = ""        # full heading line (heading only)
    article_label: str = ""        # e.g. "المادة الخامسة" (article only)
    article_no: Optional[int] = None


_HEADING_KIND = {"الباب": "part", "الفصل": "chapter", "الفرع": "section"}


def _markers(text: str) -> list:
    """All article + heading markers in one page, in reading order.

    Each entry is ``(start, end, kind, match)``. Overlapping matches (an article
    regex and a heading regex hitting the same span) keep the earliest-starting,
    longest one so a marker is never double-counted.
    """
    found = []
    for m in _ARTICLE_RE.finditer(text):
        found.append((m.start(), m.end(), "article", m))
    for m in _HEADING_RE.finditer(text):
        found.append((m.start(), m.end(), "heading", m))
    found.sort(key=lambda t: (t[0], -(t[1] - t[0])))
    merged = []
    last_end = -1
    for start, end, kind, m in found:
        if start >= last_end:
            merged.append((start, end, kind, m))
            last_end = end
    return merged


def segment_page(text: str) -> list:
    """Split one page's normalised text into ordered segments on legal markers.

    The text before the first marker is a single ``preamble`` segment (it
    continues whatever article was open on the previous page). Each marker
    starts a new segment carrying the text up to the next marker.
    """
    text = normalize(text)
    if not text:
        return []
    markers = _markers(text)
    if not markers:
        return [Segment(kind="preamble", text=text)]

    segments: list = []
    preamble = text[: markers[0][0]].strip()
    if preamble:
        segments.append(Segment(kind="preamble", text=preamble))

    for i, (start, end, kind, m) in enumerate(markers):
        body_end = markers[i + 1][0] if i + 1 < len(markers) else len(text)
        body = text[end:body_end].strip()
        body = re.sub(r"^[\s:：\.–—\-]+", "", body)  # drop a leading terminator
        if kind == "article":
            kw = m.group("kw")
            num = (m.group("num") or "").strip()
            label = f"{kw} {num}".strip()
            segments.append(
                Segment(
                    kind="article",
                    text=body,
                    article_label=label,
                    article_no=parse_arabic_ordinal(num),
                )
            )
        else:
            heading_kw = m.group("hkw")
            heading_label = f"{heading_kw} {m.group('label').strip()}".strip()
            segments.append(
                Segment(
                    kind="heading",
                    text=body,
                    heading_kind=_HEADING_KIND.get(heading_kw, "chapter"),
                    heading_label=heading_label,
                )
            )
    return segments


# --------------------------------------------------------------------------- #
# Public API
# --------------------------------------------------------------------------- #

def article_chunk_pages(
    pages: Iterable,
    meta: dict,
    max_chars: int = 1200,
    overlap: int = 200,
) -> list:
    """Chunk a document article-by-article, carrying legal structure + pages.

    ``pages`` is an iterable of ``(page_number, page_text)`` tuples. Returns a
    flat, globally-indexed list of ``Chunk`` whose ``article_no``/``article_label``
    /``chapter``/``part`` fields describe the legal locus of each chunk. Degrades
    to plain page chunking when a document carries no article markers.
    """
    out: list = []
    idx = 0
    tags = list(meta.get("tags") or [])
    doc_metadata = dict(meta.get("metadata") or {})

    cur_part = ""
    cur_chapter = ""
    cur_article_label = ""
    cur_article_no: Optional[int] = None

    for page_number, page_text in pages:
        for seg in segment_page(page_text):
            if seg.kind == "heading":
                if seg.heading_kind == "part":
                    cur_part = seg.heading_label
                    cur_chapter = ""  # a new part resets the chapter
                elif seg.heading_kind == "chapter":
                    cur_chapter = seg.heading_label
                else:  # section — keep as chapter context if no chapter yet
                    if not cur_chapter:
                        cur_chapter = seg.heading_label
                # A heading opens no article of its own; its trailing body (if
                # any) belongs to whatever article was already open.
            elif seg.kind == "article":
                cur_article_label = seg.article_label
                cur_article_no = seg.article_no

            for unit in chunk_units(split_sentences(seg.text), max_chars, overlap):
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
                        article_no=cur_article_no,
                        article_label=cur_article_label,
                        chapter=cur_chapter,
                        part=cur_part,
                    )
                )
                idx += 1
    return out


def build_article_index(chunks: list) -> list:
    """Derive a per-document article index from produced chunks.

    Returns a list of ``{article_no, article_label, chapter, part, first_page,
    chunk_count}`` rows, one per distinct article, in first-appearance order.
    Feeds the manifest-driven article index persisted at ingest time.
    """
    order: list = []
    seen: dict = {}
    for c in chunks:
        if not c.article_label:
            continue
        key = (c.article_label, c.article_no)
        row = seen.get(key)
        if row is None:
            row = {
                "article_no": c.article_no,
                "article_label": c.article_label,
                "chapter": c.chapter,
                "part": c.part,
                "first_page": c.page,
                "chunk_count": 0,
            }
            seen[key] = row
            order.append(row)
        row["chunk_count"] += 1
        if c.page is not None and (row["first_page"] is None or c.page < row["first_page"]):
            row["first_page"] = c.page
    return order
