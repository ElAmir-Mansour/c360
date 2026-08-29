-- =============================================================================
-- Lex server-side SAVED VIEWS (#12 — list-workspace saved views persistence).
--
-- Persists a user's saved list-workspace configurations (filters / sort /
-- columns / density / active view mode) server-side so they follow the user
-- across devices and can be SHARED. One row = one named view inside a
-- NAMESPACE (the owning workspace, e.g. 'lex-contracts', 'lex-matters').
-- The payload is an opaque JSONB blob owned by the frontend workspace — the
-- backend never interprets it, it only stores/authorizes it.
--
-- Share scopes (enforced in the service layer; the table just records them):
--   * personal — visible/writable by the OWNER only.
--   * team/org — readable tenant-wide; writable by the owner or a holder of
--                lex:catalog:manage (the Lex config-authority key).
--
-- Default-for-role: a SHARED view may carry a role_slug, making it the default
-- view for every holder of that legal role in that namespace. Exactly ONE
-- default per (tenant, namespace, role) is enforced by a partial unique index;
-- the service swaps defaults transactionally (clear-then-set upsert semantics).
-- A personal view can never be a role default (CHECK below) — other members of
-- the role could not read it.
-- =============================================================================

CREATE TABLE IF NOT EXISTS lex_saved_views (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID        NOT NULL,
    owner_user_id UUID        NOT NULL,
    namespace     TEXT        NOT NULL,
    name          TEXT        NOT NULL,
    scope         TEXT        NOT NULL DEFAULT 'personal'
                              CHECK (scope IN ('personal', 'team', 'org')),
    role_slug     TEXT,
    payload       JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- A personal view is invisible to everyone but its owner, so it can never
    -- be the default for a role.
    CONSTRAINT lex_saved_views_role_default_shared
        CHECK (role_slug IS NULL OR scope IN ('team', 'org'))
);

-- Primary read path: a tenant's views for one namespace (the GET /saved-views
-- listing filters visibility — shared OR owner — on top of this).
CREATE INDEX IF NOT EXISTS idx_lex_saved_views_tenant_ns
    ON lex_saved_views (tenant_id, namespace, name ASC);

-- Owner-scoped lookups (personal listings, owner-only write checks).
CREATE INDEX IF NOT EXISTS idx_lex_saved_views_tenant_owner
    ON lex_saved_views (tenant_id, owner_user_id, namespace);

-- One view NAME per owner per namespace (case-insensitive) — a user cannot
-- save two views both called "Expiring this quarter" in the same workspace.
CREATE UNIQUE INDEX IF NOT EXISTS uq_lex_saved_views_owner_name
    ON lex_saved_views (tenant_id, namespace, owner_user_id, lower(name));

-- ONE role default per (tenant, namespace, role). The service clears the
-- previous holder inside the same transaction before setting a new one, so
-- this index is the hard backstop for the upsert semantics.
CREATE UNIQUE INDEX IF NOT EXISTS uq_lex_saved_views_role_default
    ON lex_saved_views (tenant_id, namespace, role_slug)
    WHERE role_slug IS NOT NULL;

-- Row-Level Security (ENABLE + FORCE + 4 policies on app.current_tenant_id),
-- mirroring the lex_db template (000076 / 000077).
ALTER TABLE lex_saved_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE lex_saved_views FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON lex_saved_views
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON lex_saved_views
    FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON lex_saved_views
    FOR UPDATE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON lex_saved_views
    FOR DELETE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
