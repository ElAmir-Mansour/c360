-- =============================================================================
-- Lex active-persona preference (Lex_Codebase_RBAC_Map.md §4 / §17.3).
--
-- Persists the LAST-SELECTED active legal persona per (tenant, user). This is a
-- pure UX preference store: it records which of the caller's assigned legal-affairs
-- roles is the "active persona" so GET /api/v1/lex/me can default the active role
-- deterministically and POST /api/v1/lex/persona can switch it. It is NOT a new
-- authorization boundary (§17.4) — backend route authorization still evaluates the
-- caller's assigned role slugs from the JWT, unchanged.
--
-- One row per (tenant, user): the natural key is (tenant_id, user_id). The stored
-- role_slug is whatever persona the user last selected; the /persona handler ONLY
-- writes a slug the caller actually holds (validated against the JWT role slugs),
-- and /me defensively ignores a stored slug the caller no longer holds.
-- =============================================================================

CREATE TABLE IF NOT EXISTS lex_user_persona (
    tenant_id  UUID        NOT NULL,
    user_id    UUID        NOT NULL,
    role_slug  TEXT        NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, user_id)
);

-- Row-Level Security (ENABLE + FORCE + 4 policies on app.current_tenant_id),
-- mirroring the lex_db template (000033 / 000076).
ALTER TABLE lex_user_persona ENABLE ROW LEVEL SECURITY;
ALTER TABLE lex_user_persona FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON lex_user_persona
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON lex_user_persona
    FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON lex_user_persona
    FOR UPDATE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON lex_user_persona
    FOR DELETE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
