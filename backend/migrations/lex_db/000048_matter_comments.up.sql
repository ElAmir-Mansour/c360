-- Matter collaboration comments (Feature 10): @mention-aware notes on a matter.
-- Mirrors legal_case_comments (000045) but scoped to legal_matters. Mentions are
-- stored as a JSONB array of strings (user IDs or display handles) so the
-- frontend can render @mentions without a fixed UUID shape.

CREATE TABLE IF NOT EXISTS legal_matter_comments (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID        NOT NULL,
    matter_id      UUID        NOT NULL REFERENCES legal_matters(id) ON DELETE CASCADE,
    body           TEXT        NOT NULL,
    mentions       JSONB       NOT NULL DEFAULT '[]'::jsonb,
    metadata       JSONB       NOT NULL DEFAULT '{}'::jsonb,
    author_user_id UUID        NOT NULL,
    author_name    TEXT        NOT NULL DEFAULT '',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_legal_matter_comments_matter
    ON legal_matter_comments (tenant_id, matter_id, created_at ASC)
    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_legal_matter_comments_mentions
    ON legal_matter_comments USING GIN (mentions)
    WHERE deleted_at IS NULL;

ALTER TABLE legal_matter_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_matter_comments FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON legal_matter_comments
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON legal_matter_comments
    FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON legal_matter_comments
    FOR UPDATE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON legal_matter_comments
    FOR DELETE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
