"""Score fusion for hybrid retrieval. Pure logic — no I/O, no heavy deps.

Vector (semantic) and keyword (BM25/tsvector) retrievers return results on
incomparable score scales — cosine similarity in [0, 1] vs. ``ts_rank`` in an
open-ended range. Normalising and adding them is fragile. **Reciprocal Rank
Fusion (RRF)** sidesteps that: it fuses purely on *rank position*, so the two
lists combine robustly without any score calibration.

    rrf_score(d) = Σ_lists 1 / (k + rank_list(d))

``k`` (default 60, from the original Cormack et al. RRF paper) damps the weight
of low ranks. A document that ranks well in *either* retriever floats up; a
document that ranks well in *both* dominates.

The fused entries keep the original cosine ``score`` (from the vector list when
present, else the keyword list) so downstream refuse-when-out-of-corpus checks
still see a meaningful absolute relevance number, and expose ``rrf_score`` +
``sources`` for observability.
"""

from __future__ import annotations

from typing import Callable, List, Optional, Sequence


def reciprocal_rank_fusion(
    ranked_lists: Sequence[Sequence[dict]],
    key: Callable[[dict], object],
    k: int = 60,
    weights: Optional[Sequence[float]] = None,
) -> List[dict]:
    """Fuse several ranked result lists by Reciprocal Rank Fusion.

    ``ranked_lists`` — each an iterable of result dicts already in rank order
    (best first). ``key`` maps a result to its identity (e.g. a chunk id) so the
    same document across lists is recognised. ``weights`` optionally scales each
    list's contribution (default: all 1.0). Returns a single list of the fused
    dicts sorted by descending RRF score, each augmented with:

        rrf_score : float   the fused score
        sources   : list    names/indices of the lists that contributed
        score     : float   preserved from the first list that carried one

    Ties in RRF score are broken by the best (lowest) original rank, keeping the
    fusion deterministic.
    """
    if weights is None:
        weights = [1.0] * len(ranked_lists)
    if len(weights) != len(ranked_lists):
        raise ValueError("weights length must match ranked_lists length")

    merged: dict = {}
    best_rank: dict = {}
    for li, results in enumerate(ranked_lists):
        w = float(weights[li])
        for rank, item in enumerate(results, start=1):
            ident = key(item)
            contribution = w / (k + rank)
            entry = merged.get(ident)
            if entry is None:
                entry = dict(item)
                entry["rrf_score"] = 0.0
                entry["sources"] = []
                merged[ident] = entry
                best_rank[ident] = rank
            entry["rrf_score"] += contribution
            entry["sources"].append(li)
            # Preserve an absolute cosine score if this list has one and the
            # entry doesn't yet (vector list is passed first by convention).
            if entry.get("score") is None and item.get("score") is not None:
                entry["score"] = item.get("score")
            if rank < best_rank[ident]:
                best_rank[ident] = rank

    fused = list(merged.values())
    fused.sort(key=lambda e: (-e["rrf_score"], best_rank[key(e)]))
    return fused


def fuse_hybrid(
    vector_results: Sequence[dict],
    keyword_results: Sequence[dict],
    key: Callable[[dict], object],
    k: int = 60,
    vector_weight: float = 1.0,
    keyword_weight: float = 1.0,
) -> List[dict]:
    """Convenience wrapper: fuse a vector list and a keyword list.

    The vector list is passed first so its cosine ``score`` is the one preserved
    on the fused entries (used by the out-of-corpus guardrail).
    """
    return reciprocal_rank_fusion(
        [vector_results, keyword_results],
        key=key,
        k=k,
        weights=[vector_weight, keyword_weight],
    )
