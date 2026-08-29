-- =============================================================================
-- e-Archiving connector — tamper-evident archive manifest.
--
-- lex_document_archive_manifest: one append-only row per archived document
-- version. Each row's content_hash IS the DocumentVersion.ContentHash (the
-- source of truth) and entry_hash chains off the previous row's entry_hash via
-- prev_hash — a hash-chain identical in shape to the lex audit-log chain, so an
-- auditor can prove the archived corpus has not been silently mutated.
--
-- The connector (internal/lex/service/integration/earchive_connector.go) appends
-- a row on every successful `archive` invoke and stamps the resulting entry_hash
-- back into legal_documents.metadata->'archive'. The object itself is WORM-
-- protected in the backend (S3 object-lock / CMIS retention); this table is the
-- verifiable index over it.
--
-- tenant_id FIRST, 4 RLS policies, no soft-delete (append-only history).
-- Numbered 000060 (assigned by integrator; prior committed max = 000059).
-- =============================================================================

CREATE TABLE IF NOT EXISTS lex_document_archive_manifest (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID        NOT NULL,
    endpoint_id  UUID        NOT NULL REFERENCES lex_integration_endpoints(id) ON DELETE CASCADE,
    document_id  UUID        NOT NULL,
    sequence     INT         NOT NULL,
    version      INT         NOT NULL DEFAULT 0,
    content_hash TEXT        NOT NULL DEFAULT '',  -- DocumentVersion.ContentHash (source of truth)
    object_key   TEXT        NOT NULL DEFAULT '',  -- backend object key (s3 key / cmis id / sp item)
    object_hash  TEXT        NOT NULL DEFAULT '',  -- SHA-256 of the bytes actually written to WORM
    prev_hash    TEXT        NOT NULL DEFAULT '',  -- previous entry_hash (genesis = '')
    entry_hash   TEXT        NOT NULL,             -- SHA-256(seq|doc|ver|content_hash|object_hash|prev_hash)
    archived_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- One sequence number per (tenant, document): the chain is per-document.
    CONSTRAINT uq_lex_archive_manifest_seq UNIQUE (tenant_id, document_id, sequence)
);

CREATE INDEX IF NOT EXISTS idx_lex_archive_manifest_document
    ON lex_document_archive_manifest (tenant_id, document_id, sequence DESC);
CREATE INDEX IF NOT EXISTS idx_lex_archive_manifest_endpoint
    ON lex_document_archive_manifest (tenant_id, endpoint_id, archived_at DESC);

ALTER TABLE lex_document_archive_manifest ENABLE ROW LEVEL SECURITY;
ALTER TABLE lex_document_archive_manifest FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON lex_document_archive_manifest
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON lex_document_archive_manifest
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON lex_document_archive_manifest
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON lex_document_archive_manifest
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
