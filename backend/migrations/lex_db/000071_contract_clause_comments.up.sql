-- CAP-110 — Legal comments on contract clauses: @mention-aware collaboration
-- thread scoped to a contract clause. Clones legal_matter_comments (000048) but
-- hangs off contract_clauses, carrying contract_id alongside clause_id so the
-- thread can be loaded/scoped by contract without an extra join, and a nullable
-- parent_comment_id for threaded replies. Mentions are stored as a JSONB array of
-- strings (user IDs or display handles) so the frontend can render @mentions
-- without a fixed UUID shape.

CREATE TABLE IF NOT EXISTS contract_clause_comments (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID        NOT NULL,
    contract_id       UUID        NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    clause_id         UUID        NOT NULL REFERENCES contract_clauses(id) ON DELETE CASCADE,
    parent_comment_id UUID        REFERENCES contract_clause_comments(id) ON DELETE CASCADE,
    body              TEXT        NOT NULL,
    mentions          JSONB       NOT NULL DEFAULT '[]'::jsonb,
    metadata          JSONB       NOT NULL DEFAULT '{}'::jsonb,
    author_user_id    UUID        NOT NULL,
    author_name       TEXT        NOT NULL DEFAULT '',
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_contract_clause_comments_clause
    ON contract_clause_comments (tenant_id, clause_id, created_at ASC)
    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_contract_clause_comments_contract
    ON contract_clause_comments (tenant_id, contract_id, created_at ASC)
    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_contract_clause_comments_parent
    ON contract_clause_comments (tenant_id, parent_comment_id)
    WHERE deleted_at IS NULL AND parent_comment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contract_clause_comments_mentions
    ON contract_clause_comments USING GIN (mentions)
    WHERE deleted_at IS NULL;

ALTER TABLE contract_clause_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_clause_comments FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON contract_clause_comments
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON contract_clause_comments
    FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON contract_clause_comments
    FOR UPDATE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON contract_clause_comments
    FOR DELETE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
