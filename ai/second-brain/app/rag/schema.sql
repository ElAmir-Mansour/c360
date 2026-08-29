-- Reference DDL for the Second Brain vector store (documentation).
--
-- The authoritative DDL is built + migrated at runtime in
-- app/rag/vectorstore.py::bootstrap() so the embedding dimension always matches
-- AI_EMBEDDING_DIM and the text-search config matches KEYWORD_TS_CONFIG. Replace
-- {DIM} with your embedding dimension (1024 for intfloat/multilingual-e5-large,
-- 768 for paraphrase-multilingual-mpnet-base-v2) and {TS} with your text-search
-- config (default 'simple') if applying this by hand.

CREATE EXTENSION IF NOT EXISTS vector;

-- One row per chunk, with its embedding, full-text vector, + citation metadata
-- (including the Saudi-legal article locus: article number/label, chapter, part).
CREATE TABLE IF NOT EXISTS library_chunks (
    id            BIGSERIAL PRIMARY KEY,
    doc_id        TEXT NOT NULL,
    chunk_index   INT  NOT NULL,
    chunk_text    TEXT NOT NULL,
    page          INT,
    category      TEXT,
    doc_type      TEXT,
    title_ar      TEXT,
    title_en      TEXT,
    authority     TEXT,
    tags          TEXT[],
    article_no    INT,
    article_label TEXT,
    chapter       TEXT,
    part          TEXT,
    content_hash  TEXT,
    embedding     vector({DIM}) NOT NULL,
    metadata      JSONB NOT NULL DEFAULT '{}',
    -- Keyword search vector, kept in sync automatically.
    tsv           tsvector GENERATED ALWAYS AS (to_tsvector('{TS}', coalesce(chunk_text,''))) STORED,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per ingested document — powers /ingest idempotency, /health counts,
-- and per-document ingest status (ingested / ocr_partial / empty / failed).
CREATE TABLE IF NOT EXISTS library_documents (
    doc_id        TEXT PRIMARY KEY,
    title_ar      TEXT,
    title_en      TEXT,
    category      TEXT,
    doc_type      TEXT,
    authority     TEXT,
    tags          TEXT[],
    content_hash  TEXT,
    page_count    INT,
    chunk_count   INT,
    article_count INT DEFAULT 0,
    ocr_pages     INT DEFAULT 0,
    failed_pages  INT DEFAULT 0,
    status        TEXT DEFAULT 'ingested',
    error         TEXT,
    source        TEXT,
    ingested_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Manifest-driven article index: one row per distinct article in a document.
CREATE TABLE IF NOT EXISTS library_articles (
    id            BIGSERIAL PRIMARY KEY,
    doc_id        TEXT NOT NULL,
    article_no    INT,
    article_label TEXT,
    chapter       TEXT,
    part          TEXT,
    first_page    INT,
    chunk_count   INT,
    UNIQUE (doc_id, article_label)
);

CREATE INDEX IF NOT EXISTS library_chunks_doc_id_idx ON library_chunks (doc_id);
CREATE INDEX IF NOT EXISTS library_articles_doc_id_idx ON library_articles (doc_id);

-- Keyword search (BM25-style) — GIN over the generated tsvector.
CREATE INDEX IF NOT EXISTS library_chunks_tsv_idx ON library_chunks USING gin (tsv);

-- Cosine-similarity ANN index. HNSW preferred; IVFFlat is the fallback.
CREATE INDEX IF NOT EXISTS library_chunks_embedding_idx
    ON library_chunks USING hnsw (embedding vector_cosine_ops);
-- Fallback if HNSW is unavailable:
-- CREATE INDEX IF NOT EXISTS library_chunks_embedding_idx
--     ON library_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
