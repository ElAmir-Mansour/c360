"""Eval scoring — retrieval hit-rate, MRR, citation accuracy, groundedness.

Pure logic (stdlib only) so the metrics are unit-tested independently of any
running service, model, or DB. ``run_eval.py`` drives a live service and feeds
its results through these functions.

Matching is by **Arabic-normalised substring** (fold alef-hamza variants, strip
tatweel/diacritics, collapse whitespace) so an eval item can name an expected
document by a stable title fragment rather than a brittle exact doc_id.
"""

from __future__ import annotations

import re
import unicodedata
from typing import List, Sequence

_DIACRITICS = re.compile(r"[ً-ْـ]")  # tashkeel + tatweel
_WS = re.compile(r"\s+")


def normalize_ar(text: str) -> str:
    """Fold Arabic text for robust substring matching."""
    text = unicodedata.normalize("NFKC", text or "")
    text = _DIACRITICS.sub("", text)
    for a, b in (("أ", "ا"), ("إ", "ا"), ("آ", "ا"), ("ٱ", "ا"), ("ة", "ه"), ("ى", "ي")):
        text = text.replace(a, b)
    text = _WS.sub(" ", text).strip().lower()
    return text


def matches_any(expected: Sequence[str], candidate: str) -> bool:
    """True if any expected fragment is a (normalised) substring of candidate."""
    c = normalize_ar(candidate)
    return any(normalize_ar(e) in c for e in expected if e)


def _first_hit_rank(expected: Sequence[str], ranked: Sequence[str]) -> int:
    """1-indexed rank of the first ranked string matching any expected fragment.

    Returns 0 when there is no match.
    """
    for i, cand in enumerate(ranked, start=1):
        if matches_any(expected, cand):
            return i
    return 0


def retrieval_hit(expected: Sequence[str], ranked: Sequence[str]) -> bool:
    """Did any expected document appear anywhere in the ranked results?"""
    return _first_hit_rank(expected, ranked) > 0


def reciprocal_rank(expected: Sequence[str], ranked: Sequence[str]) -> float:
    """1 / rank of the first relevant result (0.0 if none)."""
    rank = _first_hit_rank(expected, ranked)
    return 1.0 / rank if rank else 0.0


def keyword_coverage(expected_keywords: Sequence[str], text: str) -> float:
    """Fraction of expected keywords present (normalised) in the text."""
    kws = [k for k in expected_keywords if k]
    if not kws:
        return 1.0
    t = normalize_ar(text)
    hit = sum(1 for k in kws if normalize_ar(k) in t)
    return hit / len(kws)


def citation_scores(expected: Sequence[str], got: Sequence[str]) -> dict:
    """Precision / recall / F1 of returned citations against expected documents.

    ``expected`` are title fragments; ``got`` are the titles/ids of the citations
    the answer returned. A citation counts as a true positive if it matches any
    expected fragment; recall counts distinct expected fragments hit.
    """
    exp = [e for e in expected if e]
    if not got and not exp:
        return {"precision": 1.0, "recall": 1.0, "f1": 1.0}
    tp = sum(1 for g in got if matches_any(exp, g)) if exp else 0
    precision = tp / len(got) if got else 0.0
    covered = sum(1 for e in exp if any(matches_any([e], g) for g in got))
    recall = covered / len(exp) if exp else 0.0
    f1 = (2 * precision * recall / (precision + recall)) if (precision + recall) else 0.0
    return {"precision": round(precision, 4), "recall": round(recall, 4), "f1": round(f1, 4)}


def mean(values: Sequence[float]) -> float:
    values = list(values)
    return round(sum(values) / len(values), 4) if values else 0.0


def aggregate(item_results: List[dict]) -> dict:
    """Aggregate per-item metric dicts into corpus-level averages.

    Each item dict may carry: hit (bool), rr (float), keyword_coverage (float),
    citation (dict), grounded (float|None). Missing keys are skipped.
    """
    hits = [1.0 if r.get("hit") else 0.0 for r in item_results if "hit" in r]
    rrs = [r["rr"] for r in item_results if "rr" in r]
    kcs = [r["keyword_coverage"] for r in item_results if "keyword_coverage" in r]
    f1s = [r["citation"]["f1"] for r in item_results if r.get("citation")]
    grounded = [r["grounded"] for r in item_results if r.get("grounded") is not None]
    return {
        "n": len(item_results),
        "retrieval_hit_rate": mean(hits),
        "mrr": mean(rrs),
        "keyword_coverage": mean(kcs),
        "citation_f1": mean(f1s),
        "groundedness": mean(grounded) if grounded else None,
    }
