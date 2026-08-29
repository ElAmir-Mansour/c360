"""Unit tests for the answer cache. Pure logic, thread-safe, no deps."""

import time

from app.cache import AnswerCache, make_key


def test_make_key_is_stable_and_order_insensitive():
    k1 = make_key("ما هو الاستثمار؟", top_k=8, doc_ids=["b", "a"], model="m", corpus_version="v1")
    k2 = make_key("  ما هو   الاستثمار؟ ", top_k=8, doc_ids=["a", "b"], model="m", corpus_version="v1")
    assert k1 == k2  # whitespace + doc_id order normalised


def test_make_key_varies_on_inputs():
    base = dict(top_k=8, doc_ids=None, model="m", corpus_version="v1")
    k = make_key("q", **base)
    assert k != make_key("q", top_k=5, doc_ids=None, model="m", corpus_version="v1")
    assert k != make_key("q", top_k=8, doc_ids=None, model="m2", corpus_version="v1")
    assert k != make_key("q", top_k=8, doc_ids=None, model="m", corpus_version="v2")  # re-ingest


def test_get_set_hit_miss_stats():
    c = AnswerCache(max_entries=4, ttl_seconds=100)
    assert c.get("k") is None
    c.set("k", {"answer": "a"})
    assert c.get("k") == {"answer": "a"}
    s = c.stats()
    assert s["hits"] == 1 and s["misses"] == 1 and s["entries"] == 1


def test_lru_eviction():
    c = AnswerCache(max_entries=2, ttl_seconds=100)
    c.set("a", 1)
    c.set("b", 2)
    c.get("a")           # touch 'a' so 'b' is now LRU
    c.set("c", 3)        # evicts 'b'
    assert c.get("a") == 1
    assert c.get("c") == 3
    assert c.get("b") is None


def test_ttl_expiry():
    c = AnswerCache(max_entries=4, ttl_seconds=0)  # 0 => never expires
    c.set("k", 1)
    assert c.get("k") == 1

    c2 = AnswerCache(max_entries=4, ttl_seconds=1)
    c2.set("k", 1)
    # Force expiry via monotonic offset without sleeping a full second.
    c2._store["k"] = (1, time.monotonic() - 5)
    assert c2.get("k") is None
