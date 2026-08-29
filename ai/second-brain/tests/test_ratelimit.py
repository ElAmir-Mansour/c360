"""Unit tests for the token-bucket rate limiter. Pure logic, no deps."""

from app.ratelimit import TokenBucketLimiter, client_key


def test_allows_up_to_burst_then_blocks():
    lim = TokenBucketLimiter(rate_per_minute=3)  # burst == 3
    assert lim.allow("k")[0]
    assert lim.allow("k")[0]
    assert lim.allow("k")[0]
    allowed, retry_after = lim.allow("k")
    assert not allowed and retry_after > 0


def test_keys_are_independent():
    lim = TokenBucketLimiter(rate_per_minute=1)
    assert lim.allow("a")[0]
    assert not lim.allow("a")[0]
    assert lim.allow("b")[0]  # different client unaffected


def test_refill_over_time():
    lim = TokenBucketLimiter(rate_per_minute=60)  # 1 token/sec
    for _ in range(60):
        lim.allow("k")
    allowed, retry_after = lim.allow("k")
    assert not allowed
    # Simulate 2 seconds passing by rewinding the bucket's last-timestamp.
    tokens, last = lim._buckets["k"]
    lim._buckets["k"] = (tokens, last - 2.0)
    assert lim.allow("k")[0]  # refilled ~2 tokens


def test_retry_after_is_positive_and_bounded():
    lim = TokenBucketLimiter(rate_per_minute=60)
    lim.allow("k")  # drain to ~0 within capacity; then overspend
    for _ in range(60):
        lim.allow("k")
    allowed, retry_after = lim.allow("k")
    assert not allowed and 0 < retry_after <= 60


def test_client_key_prefers_token():
    assert client_key(token="abc123", ip="1.2.3.4").startswith("tok:")
    assert client_key(token="", ip="1.2.3.4") == "ip:1.2.3.4"
    assert client_key(token="", ip="") == "ip:unknown"
