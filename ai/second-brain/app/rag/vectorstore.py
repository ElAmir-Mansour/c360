"""pgvector vector store on Postgres — vector + keyword (tsvector) search.

Owns the ``library_chunks`` (embeddings + full-text ``tsv``), ``library_documents``
(per-doc idempotency + ingest status), and ``library_articles`` (manifest-driven
article index) tables, the idempotent DDL bootstrap/migration, cosine-similarity
vector search, and BM25-style keyword search. psycopg2 and pgvector are imported
lazily so importing this module needs no DB driver.

The DDL is also mirrored (as documentation) in ``schema.sql``; the authoritative
version is built here so the embedding dimension always matches AI_EMBEDDING_DIM
and the text-search config always matches KEYWORD_TS_CONFIG.
"""

from __future__ import annotations

import logging
import re
from contextlib import contextmanager

log = logging.getLogger(__name__)

# Postgres text-search config names are unquoted identifiers — validate to keep
# the interpolated DDL injection-proof (config can't be a bound parameter in a
# GENERATED column expression).
_TS_CONFIG_RE = re.compile(r"^[a-z_][a-z0-9_]*$")


def _safe_ts_config(name: str) -> str:
    name = (name or "simple").strip().lower()
    if not _TS_CONFIG_RE.match(name):
        log.warning("invalid KEYWORD_TS_CONFIG %r; falling back to 'simple'", name)
        return "simple"
    return name


class VectorStoreUnavailable(RuntimeError):
    """Raised when the DB is unreachable or the pgvector driver is missing."""


# Columns returned by every retrieval path (kept in sync across vector + keyword).
_SELECT_COLS = (
    "doc_id, chunk_index, chunk_text, page, category, doc_type, title_ar, "
    "title_en, authority, article_no, article_label, chapter, part"
)


class VectorStore:
    def __init__(self, settings):
        self.settings = settings
        self.ts_config = _safe_ts_config(getattr(settings, "keyword_ts_config", "simple"))

    @contextmanager
    def _conn(self):
        try:
            import psycopg2
            from pgvector.psycopg2 import register_vector
        except ImportError as exc:
            raise VectorStoreUnavailable(f"DB drivers not installed: {exc}") from exc
        try:
            conn = psycopg2.connect(self.settings.ai_database_url)
        except Exception as exc:
            raise VectorStoreUnavailable(
                f"cannot connect to AI_DATABASE_URL: {exc}"
            ) from exc
        try:
            with conn.cursor() as cur:
                cur.execute("CREATE EXTENSION IF NOT EXISTS vector")
            conn.commit()
            register_vector(conn)
            yield conn
        finally:
            conn.close()

    # -- schema -------------------------------------------------------------

    def bootstrap(self) -> None:
        dim = int(self.settings.ai_embedding_dim)
        create_chunks = (
            "CREATE TABLE IF NOT EXISTS library_chunks ("
            "id BIGSERIAL PRIMARY KEY,"
            "doc_id TEXT NOT NULL,"
            "chunk_index INT NOT NULL,"
            "chunk_text TEXT NOT NULL,"
            "page INT,"
            "category TEXT,"
            "doc_type TEXT,"
            "title_ar TEXT,"
            "title_en TEXT,"
            "authority TEXT,"
            "tags TEXT[],"
            "article_no INT,"
            "article_label TEXT,"
            "chapter TEXT,"
            "part TEXT,"
            "content_hash TEXT,"
            f"embedding vector({dim}) NOT NULL,"
            "metadata JSONB NOT NULL DEFAULT '{}',"
            "created_at TIMESTAMPTZ NOT NULL DEFAULT now()"
            ")"
        )
        create_docs = (
            "CREATE TABLE IF NOT EXISTS library_documents ("
            "doc_id TEXT PRIMARY KEY,"
            "title_ar TEXT,"
            "title_en TEXT,"
            "category TEXT,"
            "doc_type TEXT,"
            "authority TEXT,"
            "tags TEXT[],"
            "content_hash TEXT,"
            "page_count INT,"
            "chunk_count INT,"
            "article_count INT DEFAULT 0,"
            "ocr_pages INT DEFAULT 0,"
            "failed_pages INT DEFAULT 0,"
            "status TEXT DEFAULT 'ingested',"
            "error TEXT,"
            "source TEXT,"
            "ingested_at TIMESTAMPTZ NOT NULL DEFAULT now()"
            ")"
        )
        create_articles = (
            "CREATE TABLE IF NOT EXISTS library_articles ("
            "id BIGSERIAL PRIMARY KEY,"
            "doc_id TEXT NOT NULL,"
            "article_no INT,"
            "article_label TEXT,"
            "chapter TEXT,"
            "part TEXT,"
            "first_page INT,"
            "chunk_count INT,"
            "UNIQUE (doc_id, article_label)"
            ")"
        )
        with self._conn() as conn:
            with conn.cursor() as cur:
                cur.execute(create_chunks)
                cur.execute(create_docs)
                cur.execute(create_articles)
                cur.execute(
                    "CREATE INDEX IF NOT EXISTS library_chunks_doc_id_idx "
                    "ON library_chunks (doc_id)"
                )
                cur.execute(
                    "CREATE INDEX IF NOT EXISTS library_articles_doc_id_idx "
                    "ON library_articles (doc_id)"
                )
            conn.commit()
            self._migrate(conn)
            self._ensure_vector_index(conn)
            self._ensure_fts_column(conn)

    def _migrate(self, conn) -> None:
        """Idempotently add columns that older deployments may be missing."""
        alters = [
            "ALTER TABLE library_chunks ADD COLUMN IF NOT EXISTS article_no INT",
            "ALTER TABLE library_chunks ADD COLUMN IF NOT EXISTS article_label TEXT",
            "ALTER TABLE library_chunks ADD COLUMN IF NOT EXISTS chapter TEXT",
            "ALTER TABLE library_chunks ADD COLUMN IF NOT EXISTS part TEXT",
            "ALTER TABLE library_documents ADD COLUMN IF NOT EXISTS article_count INT DEFAULT 0",
            "ALTER TABLE library_documents ADD COLUMN IF NOT EXISTS ocr_pages INT DEFAULT 0",
            "ALTER TABLE library_documents ADD COLUMN IF NOT EXISTS failed_pages INT DEFAULT 0",
            "ALTER TABLE library_documents ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'ingested'",
            "ALTER TABLE library_documents ADD COLUMN IF NOT EXISTS error TEXT",
        ]
        for ddl in alters:
            try:
                with conn.cursor() as cur:
                    cur.execute(ddl)
                conn.commit()
            except Exception as exc:
                conn.rollback()
                log.warning("migration step failed (%s): %s", ddl, exc)

    def _ensure_fts_column(self, conn) -> None:
        """Add the generated tsvector column + GIN index for keyword search.

        The column is GENERATED ALWAYS so it stays in sync with chunk_text with
        no application code. The config name is validated (not user-injectable).
        """
        cfg = self.ts_config
        add_col = (
            "ALTER TABLE library_chunks ADD COLUMN IF NOT EXISTS tsv tsvector "
            f"GENERATED ALWAYS AS (to_tsvector('{cfg}', coalesce(chunk_text,''))) STORED"
        )
        try:
            with conn.cursor() as cur:
                cur.execute(add_col)
            conn.commit()
        except Exception as exc:
            conn.rollback()
            log.warning("could not add tsvector column (keyword search disabled): %s", exc)
            return
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "CREATE INDEX IF NOT EXISTS library_chunks_tsv_idx "
                    "ON library_chunks USING gin (tsv)"
                )
            conn.commit()
        except Exception as exc:
            conn.rollback()
            log.warning("could not create tsv GIN index: %s", exc)

    def _ensure_vector_index(self, conn) -> None:
        """Create an ANN index for cosine search; degrade gracefully.

        Prefer HNSW (no training needed); fall back to IVFFlat; if neither is
        available the query still works via a sequential scan (correct, slower).
        """
        for ddl in (
            "CREATE INDEX IF NOT EXISTS library_chunks_embedding_idx "
            "ON library_chunks USING hnsw (embedding vector_cosine_ops)",
            "CREATE INDEX IF NOT EXISTS library_chunks_embedding_idx "
            "ON library_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)",
        ):
            try:
                with conn.cursor() as cur:
                    cur.execute(ddl)
                conn.commit()
                return
            except Exception as exc:
                conn.rollback()
                log.warning("vector index attempt failed (%s)", exc)
        log.warning("no ANN index created; cosine search will use a sequential scan")

    # -- reads --------------------------------------------------------------

    def ping(self) -> bool:
        """Lightweight liveness probe for /health."""
        try:
            with self._conn() as conn:
                with conn.cursor() as cur:
                    cur.execute("SELECT 1")
                    cur.fetchone()
            return True
        except Exception as exc:
            log.warning("db ping failed: %s", exc)
            return False

    def counts(self) -> tuple:
        with self._conn() as conn:
            with conn.cursor() as cur:
                try:
                    cur.execute("SELECT count(*) FROM library_documents")
                    docs = cur.fetchone()[0]
                    cur.execute("SELECT count(*) FROM library_chunks")
                    chunks = cur.fetchone()[0]
                except Exception:
                    conn.rollback()
                    return 0, 0
        return docs, chunks

    def freshness(self) -> dict:
        """Index freshness for /health — last ingest time + article/doc counts."""
        out = {"last_ingested_at": None, "documents": 0, "articles": 0, "failed_documents": 0}
        with self._conn() as conn:
            with conn.cursor() as cur:
                try:
                    cur.execute(
                        "SELECT max(ingested_at), count(*), "
                        "count(*) FILTER (WHERE status <> 'ingested') "
                        "FROM library_documents"
                    )
                    row = cur.fetchone()
                    if row:
                        out["last_ingested_at"] = row[0].isoformat() if row[0] else None
                        out["documents"] = row[1] or 0
                        out["failed_documents"] = row[2] or 0
                    cur.execute("SELECT count(*) FROM library_articles")
                    out["articles"] = cur.fetchone()[0]
                except Exception:
                    conn.rollback()
        return out

    def document_hash(self, doc_id: str):
        with self._conn() as conn:
            with conn.cursor() as cur:
                try:
                    cur.execute(
                        "SELECT content_hash FROM library_documents WHERE doc_id = %s",
                        (doc_id,),
                    )
                    row = cur.fetchone()
                    return row[0] if row else None
                except Exception:
                    conn.rollback()
                    return None

    def corpus_version(self) -> str:
        """A cheap version token that changes whenever the corpus changes.

        Used as a cache-key component so a re-ingest invalidates cached answers.
        """
        with self._conn() as conn:
            with conn.cursor() as cur:
                try:
                    cur.execute(
                        "SELECT count(*), coalesce(max(ingested_at), 'epoch') "
                        "FROM library_documents"
                    )
                    n, ts = cur.fetchone()
                    return f"{n}:{ts}"
                except Exception:
                    conn.rollback()
                    return "unknown"

    def search(self, query_embedding, top_k: int, doc_ids=None):
        """Vector (cosine) search. ``score`` is cosine similarity in [0, 1]."""
        from psycopg2.extras import RealDictCursor

        base = (
            f"SELECT {_SELECT_COLS}, 1 - (embedding <=> %s) AS score "
            "FROM library_chunks"
        )
        with self._conn() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                if doc_ids:
                    cur.execute(
                        base + " WHERE doc_id = ANY(%s) ORDER BY embedding <=> %s LIMIT %s",
                        (query_embedding, list(doc_ids), query_embedding, int(top_k)),
                    )
                else:
                    cur.execute(
                        base + " ORDER BY embedding <=> %s LIMIT %s",
                        (query_embedding, query_embedding, int(top_k)),
                    )
                return cur.fetchall()

    def keyword_search(self, query_text: str, top_k: int, doc_ids=None):
        """BM25-style keyword search over the tsvector column.

        ``score`` here is ``ts_rank`` (an open-ended relevance, NOT cosine) — it
        is used only for *ranking* inside hybrid fusion, never for the absolute
        out-of-corpus threshold. Returns [] if the tsv column is unavailable.
        """
        from psycopg2.extras import RealDictCursor

        cfg = self.ts_config
        base = (
            f"SELECT {_SELECT_COLS}, ts_rank(tsv, q) AS score "
            "FROM library_chunks, websearch_to_tsquery(%s::regconfig, %s) q "
            "WHERE tsv @@ q"
        )
        try:
            with self._conn() as conn:
                with conn.cursor(cursor_factory=RealDictCursor) as cur:
                    if doc_ids:
                        cur.execute(
                            base + " AND doc_id = ANY(%s) ORDER BY score DESC LIMIT %s",
                            (cfg, query_text, list(doc_ids), int(top_k)),
                        )
                    else:
                        cur.execute(
                            base + " ORDER BY score DESC LIMIT %s",
                            (cfg, query_text, int(top_k)),
                        )
                    return cur.fetchall()
        except Exception as exc:
            log.warning("keyword_search failed (falling back to vector-only): %s", exc)
            return []

    def list_articles(self, doc_id: str):
        """Article table-of-contents for one document — a pure read.

        Sources the manifest-driven ``library_articles`` index built at ingest,
        ordered by page then article number (nulls last). Returns ``[]`` when the
        doc has no indexed articles (research paper / not-yet-ingested) but the DB
        is reachable; raises ``VectorStoreUnavailable`` (via ``_conn``) only when
        the DB itself is down — the route turns that into a graceful empty reply.
        No embedding / LLM is touched, so it is cheap and always-available.
        """
        from psycopg2.extras import RealDictCursor

        with self._conn() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                try:
                    cur.execute(
                        "SELECT article_no, article_label, chapter, part, first_page, "
                        "chunk_count FROM library_articles WHERE doc_id = %s "
                        "ORDER BY coalesce(first_page, 2147483647), "
                        "coalesce(article_no, 2147483647), article_label",
                        (doc_id,),
                    )
                    return cur.fetchall()
                except Exception:
                    conn.rollback()
                    return []

    # -- writes -------------------------------------------------------------

    def replace_document(
        self,
        doc,
        chunks,
        embeddings,
        content_hash,
        page_count,
        *,
        ocr_pages: int = 0,
        failed_pages: int = 0,
        status: str = "ingested",
        error: str = "",
        article_index=None,
    ) -> None:
        """Idempotently replace all rows for a document in one transaction."""
        from psycopg2.extras import Json, execute_values

        source = "lex" if self.settings.lex_api_url else "local"
        article_index = article_index or []
        rows = []
        for chunk, emb in zip(chunks, embeddings):
            rows.append(
                (
                    doc.doc_id,
                    chunk.chunk_index,
                    chunk.text,
                    chunk.page,
                    doc.category,
                    doc.doc_type,
                    doc.title_ar,
                    doc.title_en,
                    doc.authority,
                    list(doc.tags or []),
                    getattr(chunk, "article_no", None),
                    getattr(chunk, "article_label", "") or None,
                    getattr(chunk, "chapter", "") or None,
                    getattr(chunk, "part", "") or None,
                    content_hash,
                    emb,
                    Json(doc.metadata or {}),
                )
            )
        art_rows = [
            (
                doc.doc_id,
                a.get("article_no"),
                a.get("article_label"),
                a.get("chapter") or None,
                a.get("part") or None,
                a.get("first_page"),
                a.get("chunk_count"),
            )
            for a in article_index
        ]
        with self._conn() as conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM library_chunks WHERE doc_id = %s", (doc.doc_id,))
                cur.execute("DELETE FROM library_articles WHERE doc_id = %s", (doc.doc_id,))
                if rows:
                    execute_values(
                        cur,
                        "INSERT INTO library_chunks (doc_id, chunk_index, chunk_text, page, "
                        "category, doc_type, title_ar, title_en, authority, tags, article_no, "
                        "article_label, chapter, part, content_hash, embedding, metadata) VALUES %s",
                        rows,
                    )
                if art_rows:
                    execute_values(
                        cur,
                        "INSERT INTO library_articles (doc_id, article_no, article_label, "
                        "chapter, part, first_page, chunk_count) VALUES %s "
                        "ON CONFLICT (doc_id, article_label) DO NOTHING",
                        art_rows,
                    )
                cur.execute(
                    "INSERT INTO library_documents (doc_id, title_ar, title_en, category, "
                    "doc_type, authority, tags, content_hash, page_count, chunk_count, "
                    "article_count, ocr_pages, failed_pages, status, error, source, ingested_at) "
                    "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s, now()) "
                    "ON CONFLICT (doc_id) DO UPDATE SET title_ar = EXCLUDED.title_ar, "
                    "title_en = EXCLUDED.title_en, category = EXCLUDED.category, "
                    "doc_type = EXCLUDED.doc_type, authority = EXCLUDED.authority, "
                    "tags = EXCLUDED.tags, content_hash = EXCLUDED.content_hash, "
                    "page_count = EXCLUDED.page_count, chunk_count = EXCLUDED.chunk_count, "
                    "article_count = EXCLUDED.article_count, ocr_pages = EXCLUDED.ocr_pages, "
                    "failed_pages = EXCLUDED.failed_pages, status = EXCLUDED.status, "
                    "error = EXCLUDED.error, source = EXCLUDED.source, ingested_at = now()",
                    (
                        doc.doc_id,
                        doc.title_ar,
                        doc.title_en,
                        doc.category,
                        doc.doc_type,
                        doc.authority,
                        list(doc.tags or []),
                        content_hash,
                        page_count,
                        len(chunks),
                        len(art_rows),
                        int(ocr_pages),
                        int(failed_pages),
                        status,
                        error or None,
                        source,
                    ),
                )
            conn.commit()

    def mark_document(self, doc, status: str, error: str = "", content_hash: str = "") -> None:
        """Record a per-doc status (e.g. 'failed', 'empty') without chunks.

        Used when a document can't be fetched or yields no extractable text, so
        /health and the ingest report surface it instead of it vanishing.
        """
        source = "lex" if self.settings.lex_api_url else "local"
        with self._conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO library_documents (doc_id, title_ar, title_en, category, "
                    "doc_type, authority, tags, content_hash, status, error, source, ingested_at) "
                    "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s, now()) "
                    "ON CONFLICT (doc_id) DO UPDATE SET status = EXCLUDED.status, "
                    "error = EXCLUDED.error, ingested_at = now()",
                    (
                        doc.doc_id,
                        doc.title_ar,
                        doc.title_en,
                        doc.category,
                        doc.doc_type,
                        doc.authority,
                        list(doc.tags or []),
                        content_hash or None,
                        status,
                        error or None,
                        source,
                    ),
                )
            conn.commit()
