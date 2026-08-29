"""Per-client rate limiting. Pure logic, thread-safe, no I/O.

A token-bucket limiter keyed by client identity (bearer token if present, else
client IP). Each key gets ``rate`` tokens that refill continuously at
``rate / 60`` per second up to a burst ceiling of ``rate``. A request costs one
token; when the bucket is empty the request is rejected with the number of
seconds to wait (surfaced as HTTP 429 + ``Retry-After``).

In-process and single-node — appropriate for one FastAPI worker or as a
last-line cost cap behind the platform gateway's own limiter. For multi-replica
enforcement, back it with Redis; the ``allow`` contract stays the same.
"""

from __future__ import annotations

import threading
import time
from typing import Dict, Tuple


class TokenBucketLimiter:
    def __init__(self, rate_per_minute: int, burst: int = 0):
        self.rate_per_minute = max(1, int(rate_per_minute))
        self.refill_per_sec = self.rate_per_minute / 60.0
        self.capacity = float(burst) if burst else float(self.rate_per_minute)
        self._buckets: Dict[str, Tuple[float, float]] = {}  # key -> (tokens, last_ts)
        self._lock = threading.Lock()

    def _now(self) -> float:
        return time.monotonic()

    def allow(self, key: str, cost: float = 1.0) -> Tuple[bool, float]:
        """Try to spend ``cost`` tokens for ``key``.

        Returns ``(allowed, retry_after_seconds)``. ``retry_after_seconds`` is 0
        when allowed, else the wait until enough tokens have refilled.
        """
        now = self._now()
        with self._lock:
            tokens, last = self._buckets.get(key, (self.capacity, now))
            # Refill for elapsed time, capped at capacity.
            tokens = min(self.capacity, tokens + (now - last) * self.refill_per_sec)
            if tokens >= cost:
                self._buckets[key] = (tokens - cost, now)
                return True, 0.0
            # Not enough — compute wait for the shortfall.
            deficit = cost - tokens
            retry_after = deficit / self.refill_per_sec if self.refill_per_sec else 60.0
            self._buckets[key] = (tokens, now)
            return False, retry_after

    def reset(self, key: str = None) -> None:
        with self._lock:
            if key is None:
                self._buckets.clear()
            else:
                self._buckets.pop(key, None)


def client_key(*, token: str = "", ip: str = "") -> str:
    """Derive a stable client identity: prefer the bearer token, else the IP."""
    token = (token or "").strip()
    if token:
        # Don't key on the raw secret — hash a short prefix marker is overkill;
        # the token is server-side only, but keep the bucket keyspace opaque.
        return "tok:" + token[-24:]
    return "ip:" + (ip or "unknown")
