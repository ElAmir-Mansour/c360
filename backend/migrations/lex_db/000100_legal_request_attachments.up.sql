-- Durable, audit-grade attachments for the Legal Request spine.
--
-- File bytes remain owned by file-service.  This table is the authoritative
-- request -> file relationship and keeps the immutable metadata needed to show
-- approvers exactly what they reviewed even if the file record later changes.
CREATE TABLE IF NOT EXISTS legal_request_attachments (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID        NOT NULL,
    legal_request_id  UUID        NOT NULL REFERENCES legal_requests(id) ON DELETE CASCADE,
    file_id           UUID        NOT NULL,
    slot_key          TEXT,
    original_name     TEXT        NOT NULL,
    content_type      TEXT        NOT NULL,
    size_bytes        BIGINT      NOT NULL CHECK (size_bytes >= 0),
    checksum_sha256   TEXT        NOT NULL,
    file_version      INTEGER     NOT NULL DEFAULT 1 CHECK (file_version > 0),
    virus_scan_status TEXT        NOT NULL,
    uploaded_by       UUID        NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at        TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_legal_request_attachments_live_file
    ON legal_request_attachments (tenant_id, legal_request_id, file_id)
    WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_legal_request_attachments_live_slot
    ON legal_request_attachments (tenant_id, legal_request_id, lower(slot_key))
    WHERE deleted_at IS NULL AND NULLIF(btrim(slot_key), '') IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_legal_request_attachments_request
    ON legal_request_attachments (tenant_id, legal_request_id, created_at, id)
    WHERE deleted_at IS NULL;

ALTER TABLE legal_request_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_request_attachments FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON legal_request_attachments
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON legal_request_attachments
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON legal_request_attachments
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON legal_request_attachments
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
