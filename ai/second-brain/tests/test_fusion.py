"""Unit tests for Reciprocal Rank Fusion. Pure logic, no deps."""

from app.rag.fusion import fuse_hybrid, reciprocal_rank_fusion


def _id(r):
    return r["id"]


def test_rrf_rewards_agreement_across_lists():
    # 'b' ranks well in BOTH lists; it should top the fusion.
    vec = [{"id": "a", "score": 0.9}, {"id": "b", "score": 0.8}, {"id": "c", "score": 0.7}]
    kw = [{"id": "b", "score": 5.0}, {"id": "d", "score": 4.0}, {"id": "a", "score": 3.0}]
    fused = fuse_hybrid(vec, kw, key=_id, k=60)
    assert fused[0]["id"] == "b"
    # every input doc is present exactly once
    assert sorted(e["id"] for e in fused) == ["a", "b", "c", "d"]


def test_rrf_preserves_vector_cosine_score():
    vec = [{"id": "a", "score": 0.91}]
    kw = [{"id": "a", "score": 7.3}]  # ts_rank scale — must NOT overwrite cosine
    fused = fuse_hybrid(vec, kw, key=_id)
    assert fused[0]["score"] == 0.91
    assert set(fused[0]["sources"]) == {0, 1}


def test_rrf_keyword_only_entry_keeps_its_score():
    vec = [{"id": "a", "score": 0.5}]
    kw = [{"id": "z", "score": 2.0}]
    fused = fuse_hybrid(vec, kw, key=_id)
    z = next(e for e in fused if e["id"] == "z")
    assert z["score"] == 2.0  # only source that carried a score
    assert z["sources"] == [1]


def test_rrf_score_monotonic_in_rank():
    lst = [{"id": x} for x in ["a", "b", "c", "d"]]
    fused = reciprocal_rank_fusion([lst], key=_id, k=60)
    scores = [e["rrf_score"] for e in fused]
    assert fused[0]["id"] == "a"
    assert scores == sorted(scores, reverse=True)


def test_rrf_weights_bias_a_list():
    vec = [{"id": "a", "score": 0.9}]
    kw = [{"id": "b", "score": 0.9}]
    # Heavily weight the keyword list -> 'b' wins despite equal ranks.
    fused = reciprocal_rank_fusion([vec, kw], key=_id, k=60, weights=[0.1, 10.0])
    assert fused[0]["id"] == "b"


def test_rrf_empty_lists():
    assert reciprocal_rank_fusion([[], []], key=_id) == []
