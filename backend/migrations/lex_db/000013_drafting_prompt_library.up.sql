-- AID-09: prompt library — reusable, tenant-scoped LLM prompt templates for
-- repeatable legal-ops drafting tasks. A template carries a system prompt and a
-- user-prompt body with {{variable}} placeholders; "run" substitutes variables
-- and invokes the governed drafting LLM (claude-opus-4-8).
CREATE TABLE IF NOT EXISTS lex_prompt_templates (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID        NOT NULL,
    name          TEXT        NOT NULL,
    description   TEXT        NOT NULL DEFAULT '',
    category      TEXT        NOT NULL DEFAULT 'general',
    system_prompt TEXT        NOT NULL DEFAULT '',
    user_prompt   TEXT        NOT NULL,
    -- variables is a JSON array of declared placeholder names, e.g. ["party_a"]
    variables     JSONB       NOT NULL DEFAULT '[]'::jsonb,
    metadata      JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_by    UUID        NOT NULL,
    updated_by    UUID,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at    TIMESTAMPTZ,
    CHECK (btrim(name) <> ''),
    CHECK (btrim(user_prompt) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_lex_prompt_templates_name
    ON lex_prompt_templates (tenant_id, lower(name))
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_lex_prompt_templates_list
    ON lex_prompt_templates (tenant_id, category, updated_at DESC)
    WHERE deleted_at IS NULL;

ALTER TABLE lex_prompt_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE lex_prompt_templates FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON lex_prompt_templates
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON lex_prompt_templates
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON lex_prompt_templates
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON lex_prompt_templates
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
