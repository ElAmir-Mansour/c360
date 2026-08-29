"""Per-answer cache — question-hash → answer. Pure logic, thread-safe, no I/O.

``/ask`` is expensive (embedding + retrieval + a Claude generation). Identical
questions (same corpus scope + model) recur constantly in a reference-library
setting, so caching the whole answer cuts both cost and latency to ~0 on a hit.

The key is a SHA-256 over the *normalised* question plus every input that can
change the answer (top_k, doc_ids, model, corpus version). A bounded TTL-LRU
keeps memory flat: entries expire after ``ttl_seconds`` and the least-recently
used entry is evicted when ``max_entries`` is exceeded.

Corpus version is folded into the key so a re-ingest transparently invalidates
stale answers without a manual flush.
"""

from __future__ import annotations

import hashlib
import json
import threading
import time
from collections import OrderedDict
from typing import Any, Optional


def make_key(
    question: str,
    *,
    top_k: int,
    doc_ids: Optional[list] = None,
    model: str = "",
    corpus_version: str = "",
) -> str:
    """Stable cache key. Normalises the question and sorts doc_ids so trivially
    different requests that mean the same thing collide on one entry."""
    payload = {
        "q": " ".join((question or "").split()).strip().lower(),
        "k": int(top_k),
        "docs": sorted(str(d) for d in (doc_ids or [])),
        "model": model or "",
        "corpus": corpus_version or "",
    }
    blob = json.dumps(payload, ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


class AnswerCache:
    """Bounded, TTL-bounded, thread-safe LRU cache of answer payloads."""

    def __init__(self, max_entries: int = 512, ttl_seconds: int = 3600):
        self.max_entries = max(1, int(max_entries))
        self.ttl_seconds = max(0, int(ttl_seconds))
        self._store: "OrderedDict[str, tuple]" = OrderedDict()
        self._lock = threading.Lock()
        self.hits = 0
        self.misses = 0

    def _now(self) -> float:
        return time.monotonic()

    def get(self, key: str) -> Optional[Any]:
        with self._lock:
            entry = self._store.get(key)
            if entry is None:
                self.misses += 1
                return None
            value, expires_at = entry
            if self.ttl_seconds and expires_at is not None and self._now() > expires_at:
                # Expired — evict and miss.
                del self._store[key]
                self.misses += 1
                return None
            self._store.move_to_end(key)  # mark as recently used
            self.hits += 1
            return value

    def set(self, key: str, value: Any) -> None:
        with self._lock:
            expires_at = self._now() + self.ttl_seconds if self.ttl_seconds else None
            if key in self._store:
                self._store.move_to_end(key)
            self._store[key] = (value, expires_at)
            while len(self._store) > self.max_entries:
                self._store.popitem(last=False)  # evict LRU

    def clear(self) -> None:
        with self._lock:
            self._store.clear()

    def stats(self) -> dict:
        with self._lock:
            total = self.hits + self.misses
            return {
                "entries": len(self._store),
                "max_entries": self.max_entries,
                "ttl_seconds": self.ttl_seconds,
                "hits": self.hits,
                "misses": self.misses,
                "hit_rate": round(self.hits / total, 4) if total else 0.0,
            }
