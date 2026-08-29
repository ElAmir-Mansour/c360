-- Case collaboration + case document registry links.

CREATE TABLE IF NOT EXISTS legal_case_comments (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID        NOT NULL,
    case_id       UUID        NOT NULL REFERENCES legal_cases(id) ON DELETE CASCADE,
    body          TEXT        NOT NULL,
    mentions      UUID[]      NOT NULL DEFAULT '{}',
    metadata      JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_by    UUID        NOT NULL,
    updated_by    UUID,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_legal_case_comments_case
    ON legal_case_comments (tenant_id, case_id, created_at ASC)
    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_legal_case_comments_mentions
    ON legal_case_comments USING GIN (mentions)
    WHERE deleted_at IS NULL;

ALTER TABLE legal_case_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_case_comments FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON legal_case_comments
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON legal_case_comments
    FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON legal_case_comments
    FOR UPDATE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON legal_case_comments
    FOR DELETE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE TABLE IF NOT EXISTS legal_case_documents (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID        NOT NULL,
    case_id       UUID        NOT NULL REFERENCES legal_cases(id) ON DELETE CASCADE,
    document_id   UUID        NOT NULL REFERENCES legal_documents(id) ON DELETE RESTRICT,
    source        TEXT        NOT NULL DEFAULT 'linked',
    category      TEXT,
    notes         TEXT        NOT NULL DEFAULT '',
    metadata      JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_by    UUID        NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_legal_case_documents_case
    ON legal_case_documents (tenant_id, case_id, created_at DESC)
    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_legal_case_documents_document
    ON legal_case_documents (tenant_id, document_id)
    WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_legal_case_documents_unique_active
    ON legal_case_documents (tenant_id, case_id, document_id)
    WHERE deleted_at IS NULL;

ALTER TABLE legal_case_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_case_documents FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON legal_case_documents
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON legal_case_documents
    FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON legal_case_documents
    FOR UPDATE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON legal_case_documents
    FOR DELETE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'legal_case_sub_audit_log_resource_type_check'
          AND conrelid = 'legal_case_sub_audit_log'::regclass
    ) THEN
        ALTER TABLE legal_case_sub_audit_log DROP CONSTRAINT legal_case_sub_audit_log_resource_type_check;
    END IF;
END$$;

ALTER TABLE legal_case_sub_audit_log
    ADD CONSTRAINT legal_case_sub_audit_log_resource_type_check
    CHECK (resource_type IN ('party', 'hearing', 'task', 'comment', 'document_link'));
