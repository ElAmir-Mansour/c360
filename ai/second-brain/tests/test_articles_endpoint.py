"""HTTP contract tests for ``GET /articles`` — the article table-of-contents.

Requires FastAPI + pydantic-settings (skips otherwise, like test_api_contract).
The vector store is stubbed so no Postgres / embedding model / LLM is touched:
these assert the page-then-article ordering, field mapping (stringified
article_no, derived Arabic label, honest null title), and BOTH graceful-empty
paths — an empty index (reachable DB) and an unreachable DB (never a 503).
"""

import pytest

pytest.importorskip("fastapi")
pytest.importorskip("pydantic_settings")

from fastapi.testclient import TestClient  # noqa: E402

import app.config as cfg  # noqa: E402
from app.rag.vectorstore import VectorStore, VectorStoreUnavailable  # noqa: E402


@pytest.fixture()
def client():
    cfg.get_settings.cache_clear()
    import app.main as m
    return TestClient(m.app)


def _stub_rows(monkeypatch, rows):
    monkeypatch.setattr(VectorStore, "list_articles", lambda self, doc_id: rows)


def test_articles_orders_by_page_then_number_and_maps_fields(client, monkeypatch):
    # Deliberately scrambled, mixed digit/word labels, plus a numberless row.
    rows = [
        {"article_no": 13, "article_label": "المادة الثالثة عشرة", "first_page": 2,
         "chapter": "الفصل الثاني", "part": ""},
        {"article_no": 2, "article_label": "المادة الثانية", "first_page": 1},
        {"article_no": 5, "article_label": "مادة ٥", "first_page": 2},
        {"article_no": 1, "article_label": "المادة الأولى", "first_page": 1},
        {"article_no": None, "article_label": "مادة", "first_page": None},
    ]
    _stub_rows(monkeypatch, rows)

    r = client.get("/articles", params={"doc_id": "nizam-istithmar"})
    assert r.status_code == 200
    body = r.json()
    assert body["meta"] == {"count": 5, "doc_id": "nizam-istithmar"}

    data = body["data"]
    # page-then-number order (within page 2: article 5 before 13); the
    # numberless row sorts last.
    assert [d["article_no"] for d in data] == ["1", "2", "5", "13", ""]
    assert [d["page"] for d in data] == [1, 1, 2, 2, None]
    # Canonical labels: the digit source "مادة ٥" is rendered as an ordinal.
    assert data[0]["label"] == "المادة الأولى"
    assert data[2]["label"] == "المادة الخامسة"
    assert data[3]["label"] == "المادة الثالثة عشرة"
    # article_no is a string; title is honestly null (not captured today).
    assert isinstance(data[0]["article_no"], str)
    assert all(d["title"] is None for d in data)


def test_articles_empty_index_is_200_with_meta(client, monkeypatch):
    # A research paper / not-yet-ingested doc: reachable DB, no indexed articles.
    _stub_rows(monkeypatch, [])
    r = client.get("/articles", params={"doc_id": "research-1"})
    assert r.status_code == 200
    assert r.json() == {"data": [], "meta": {"count": 0, "doc_id": "research-1"}}


def test_articles_db_unavailable_degrades_to_empty_not_503(client, monkeypatch):
    def boom(self, doc_id):
        raise VectorStoreUnavailable("cannot connect")

    monkeypatch.setattr(VectorStore, "list_articles", boom)
    r = client.get("/articles", params={"doc_id": "whatever"})
    assert r.status_code == 200          # never 503 for a read-only TOC
    assert r.json()["data"] == []


def test_articles_missing_doc_id_is_client_error(client):
    # doc_id is required; its absence is a 422 (client error), not a 5xx.
    r = client.get("/articles")
    assert r.status_code == 422
