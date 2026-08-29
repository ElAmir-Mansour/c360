-- =============================================================================
-- WatheeqTech Reference Library — the GLOBAL, read-only Saudi legal reference
-- corpus (WatheeqTech_Library_Design.md §3.2). Unlike every other lex_db table
-- this catalog carries NO tenant_id: the 33 Saudi-law PDFs are identical public
-- content for every tenant and are read by ALL authenticated Watheeq users.
--
-- Byte bytes themselves live OUTSIDE this row: either the platform file-service
-- (file_id + library_tenant_id, design §2.3 Option A) or a mounted read-only
-- volume keyed by storage_key (design §2.4, the dev-runnable path wired in P0).
-- byte_source discriminates the two so the frontend never sees the difference.
--
-- The table is provisioned once by the dedicated ingestion job
-- (cmd/reference-library-seed), NOT by the per-tenant demo seeder and NOT on
-- every boot — so a 95 MB corpus can never make the FATAL startup path flaky.
-- There is NO tenant-facing write surface: read-only is structural (no write
-- handlers, no tenant write RLS policy), not merely convention.
-- =============================================================================

CREATE TABLE IF NOT EXISTS reference_library_documents (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    title_ar          TEXT        NOT NULL,
    title_en          TEXT        NOT NULL DEFAULT '',
    description_ar    TEXT        NOT NULL DEFAULT '',
    description_en    TEXT        NOT NULL DEFAULT '',
    category          TEXT        NOT NULL,            -- systems-regulations | judicial-journal | research
    doc_type          TEXT        NOT NULL,            -- system | regulation | judicial-journal | research
    jurisdiction      TEXT        NOT NULL DEFAULT 'SA',
    authority         TEXT        NOT NULL DEFAULT '', -- e.g. وزارة العدل, الهيئة العامة للمنافسة
    source            TEXT        NOT NULL DEFAULT '',
    source_url        TEXT,
    tags              TEXT[]      NOT NULL DEFAULT '{}',
    -- byte binding (design §2.3 / §2.4).
    byte_source       TEXT        NOT NULL DEFAULT 'file-service', -- file-service | volume
    file_id           UUID,          -- file-service platform_core.files.id (Option A/B); no cross-DB FK by design
    storage_key       TEXT,          -- volume key (fallback §2.4) — relative path under LEX_REFERENCE_LIBRARY_DIR
    library_tenant_id UUID,          -- canonical owner tenant for the Option A file-service proxy
    file_size_bytes   BIGINT,
    content_hash      TEXT,          -- SHA-256 hex; dedup + integrity display; the ingestion UPSERT key
    -- lifecycle.
    published         BOOLEAN     NOT NULL DEFAULT true,
    version           INT         NOT NULL DEFAULT 1,
    hijri_date        TEXT,          -- optional issuance date (Hijri), free text
    gregorian_date    DATE,          -- optional issuance/effective date
    metadata          JSONB       NOT NULL DEFAULT '{}', -- e.g. {"issue":"39"} for مجلة قضاء
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at        TIMESTAMPTZ
);

-- Bilingual full-text (mirrors idx_regulation_library_search; 'simple' config,
-- consistent with existing lex FTS — no Arabic stemming, adequate for 33 docs).
-- NOTE: tags are deliberately NOT folded into this index expression. array_to_string()
-- is only STABLE, not IMMUTABLE, so including it makes the whole expression
-- non-indexable ("functions in index expression must be marked IMMUTABLE"). The
-- runtime search query (reference_library_repo.go) still folds tags into its own
-- tsvector AND carries an `array_to_string(tags,' ') ILIKE` fallback, so tag terms
-- remain fully searchable — this index just accelerates the immutable text fields.
CREATE INDEX IF NOT EXISTS idx_reference_library_search ON reference_library_documents
    USING GIN (to_tsvector('simple',
        coalesce(title_ar,'')       || ' ' || coalesce(title_en,'')       || ' ' ||
        coalesce(description_ar,'')  || ' ' || coalesce(description_en,'') || ' ' ||
        coalesce(authority,'')));

-- Tag filtering ($N = ANY(tags), tags @> ...) — a plain GIN on the array column.
CREATE INDEX IF NOT EXISTS idx_reference_library_tags
    ON reference_library_documents USING GIN (tags)
    WHERE deleted_at IS NULL;

-- Faceted browse by corpus class.
CREATE INDEX IF NOT EXISTS idx_reference_library_category
    ON reference_library_documents (category, doc_type)
    WHERE deleted_at IS NULL;

-- Makes the ingestion UPSERT idempotent: one catalog row per distinct PDF.
CREATE UNIQUE INDEX IF NOT EXISTS uq_reference_library_hash
    ON reference_library_documents (content_hash)
    WHERE content_hash IS NOT NULL;

-- RLS defensive posture: enable but keep a permissive read policy so the table
-- is safe if RLS is ever activated platform-wide (today RLS is inert on the
-- owner/superuser lex pool — app-layer SQL is the real control). NOT FORCEd, so
-- the owner/ingest connection still writes; every tenant role may SELECT (all
-- rows), and no write policy exists for tenant roles → writes only via owner.
ALTER TABLE reference_library_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS reference_library_read ON reference_library_documents;
CREATE POLICY reference_library_read ON reference_library_documents FOR SELECT USING (true);
