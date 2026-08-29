"""Integration smoke tests for the HTTP contract.

Requires FastAPI + pydantic-settings (skips otherwise, so a bare `python -m
pytest` of the pure-logic suite still passes). These exercise the *contract* and
guardrail/observability wiring **without** a DB, embedding model, or LLM — so
they assert the graceful-degradation behaviour (503s), the additive /health and
/metrics surface, and the SSE shape via the pre-retrieval refusal path.
"""

import pytest

pytest.importorskip("fastapi")
pytest.importorskip("pydantic_settings")

from fastapi.testclient import TestClient  # noqa: E402

import app.config as cfg  # noqa: E402


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    cfg.get_settings.cache_clear()
    import app.main as m
    return TestClient(m.app)


def test_health_degraded_shape(client):
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] in ("ok", "degraded")
    assert "indexed_docs" in body and "indexed_chunks" in body  # stable contract
    assert set(body["components"].keys()) >= {"db", "embeddings", "llm", "reranker"}
    # provider-aware llm block: default anthropic, not_configured without a key.
    llm = body["components"]["llm"]
    assert llm["provider"] == "anthropic" and llm["status"] == "not_configured"
    assert "x-request-id" in {k.lower() for k in r.headers}


def test_openai_compatible_provider_gates_ask_and_health(monkeypatch):
    # Sovereign path: NO ANTHROPIC_API_KEY, but a KSA-hosted OpenAI-compatible
    # endpoint is configured -> the LLM gate is SATISFIED. /health reports the
    # openai_compatible provider as configured, and an (empty) /ask now refuses at
    # the guardrail screen with 200 instead of the pre-gate 503 "llm not
    # configured" — proving the gate is provider-aware, without touching retrieval.
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setenv("AI_LLM_PROVIDER", "openai_compatible")
    monkeypatch.setenv("AI_LLM_BASE_URL", "http://allam.gov.local/v1")
    cfg.get_settings.cache_clear()
    import app.main as m
    c = TestClient(m.app)

    hb = c.get("/health").json()["components"]["llm"]
    assert hb["provider"] == "openai_compatible" and hb["status"] == "configured"

    r = c.post("/ask", json={"question": "   "})  # empty -> guardrail refusal (200), not a 503
    assert r.status_code == 200 and r.json()["refused"] is True

    cfg.get_settings.cache_clear()  # don't leak the mutated provider into other tests


def test_ask_503_without_llm(client):
    r = client.post("/ask", json={"question": "ما هي شروط الاستثمار؟"})
    assert r.status_code == 503
    assert r.json()["error"] == "llm not configured"


def test_metrics_renders(client):
    client.get("/health")  # generate at least one request metric
    r = client.get("/metrics")
    assert r.status_code == 200
    assert b"secondbrain_requests_total" in r.content


def test_guardrail_refusal_and_sse(monkeypatch):
    # With a key set, empty/too-long questions refuse BEFORE any retrieval/LLM.
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")
    cfg.get_settings.cache_clear()
    import app.main as m
    c = TestClient(m.app)

    r = c.post("/ask", json={"question": "   "})
    assert r.status_code == 200
    assert r.json()["refused"] is True

    # SSE stream on the refusal path yields token + citations + done events.
    with c.stream("POST", "/ask/stream", json={"question": ""}) as resp:
        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith("text/event-stream")
        body = "".join(resp.iter_text())
    for ev in ("event: token", "event: citations", "event: done"):
        assert ev in body
