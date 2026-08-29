-- Settlement <-> document registry links (FEATURE 12). Mirrors the matter
-- document-link pattern (legal_matter_documents in 000049): a join table linking a
-- settlement to an existing legal_documents row. Byte storage stays owned by the
-- document registry.

CREATE TABLE IF NOT EXISTS legal_settlement_documents (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID        NOT NULL,
    settlement_id UUID        NOT NULL REFERENCES legal_settlement(id) ON DELETE CASCADE,
    document_id   UUID        NOT NULL REFERENCES legal_documents(id) ON DELETE RESTRICT,
    relationship  TEXT        NOT NULL DEFAULT 'related',
    created_by    UUID        NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at    TIMESTAMPTZ,
    UNIQUE (settlement_id, document_id)
);

CREATE INDEX IF NOT EXISTS idx_legal_settlement_documents_settlement
    ON legal_settlement_documents (tenant_id, settlement_id, created_at DESC)
    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_legal_settlement_documents_document
    ON legal_settlement_documents (tenant_id, document_id)
    WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_legal_settlement_documents_unique_active
    ON legal_settlement_documents (tenant_id, settlement_id, document_id)
    WHERE deleted_at IS NULL;

ALTER TABLE legal_settlement_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_settlement_documents FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON legal_settlement_documents
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON legal_settlement_documents
    FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON legal_settlement_documents
    FOR UPDATE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON legal_settlement_documents
    FOR DELETE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
