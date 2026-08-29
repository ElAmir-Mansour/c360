-- =============================================================================
-- HUMAN-SCALE — OUT-OF-OFFICE / SUBSTITUTE (DEPUTY) REGISTRY.
--
-- Delegation today is single-hop, per-decision metadata with no depth limit or
-- loop detection: an approver on vacation silently BLOCKS every workflow routed
-- to them. This table is the core, tenant-scoped, date-windowed OOO registry the
-- human-task assignment/create path consults: within [from_time, to_time] a
-- user's in-tray work is auto-reassigned (or duplicated) to their deputy. The
-- resolver that consumes it applies a DEPTH LIMIT + LOOP DETECTION so a chain
-- A->B->C is bounded and a cycle A->B->A cannot loop.
--
-- RLS is FORCED here (this table is NEW and has NO embedding-suite direct-SQL
-- callers, unlike the 000001 core tables — see schema.go's SchemaSQL note), so
-- it follows the EXACT per-operation policy shape the forms/SLA tables use
-- (000004): each policy keys on
--     tenant_id = current_setting('app.current_tenant_id', true)::uuid
--   OR current_setting('app.bypass_rls', true) = 'on'
-- The retrofitted substitution repository sets SET LOCAL app.current_tenant_id
-- (tenant scope) or SET LOCAL app.bypass_rls='on' (cross-tenant background reads)
-- on every statement via the workflow repository/rls.go helpers, so absent a
-- scope current_setting(...) is NULL and NO row is visible — fail-closed.
--
-- Additive, reversible, idempotent: IF NOT EXISTS on every object; no existing
-- table is altered. The down migration drops only what this file adds.
-- The migration role must have BYPASSRLS. Requires no data migration.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS workflow_substitutions (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID        NOT NULL,
    -- The out-of-office principal whose in-tray work is handed off.
    user_id     UUID        NOT NULL,
    -- The deputy the work is handed off to during the window.
    deputy_id   UUID        NOT NULL,
    -- Absolute [from_time, to_time] out-of-office window (inclusive), in UTC.
    from_time   TIMESTAMPTZ NOT NULL,
    to_time     TIMESTAMPTZ NOT NULL,
    -- Operator kill switch: an inactive row is ignored even inside its window.
    active      BOOLEAN     NOT NULL DEFAULT true,
    reason      TEXT        NOT NULL DEFAULT '',
    created_by  UUID,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- A user cannot deputise themselves (that would be an immediate self-loop).
    CONSTRAINT workflow_substitutions_no_self CHECK (user_id <> deputy_id),
    -- The window must be well-formed.
    CONSTRAINT workflow_substitutions_window CHECK (to_time >= from_time)
);

-- The resolver's hot query is "active substitution for (tenant, user) covering
-- an instant". Index the lookup key; the window/active filters are applied on
-- top. A partial index on active rows keeps it small.
CREATE INDEX IF NOT EXISTS idx_workflow_substitutions_lookup
    ON workflow_substitutions (tenant_id, user_id, active);

CREATE INDEX IF NOT EXISTS idx_workflow_substitutions_window
    ON workflow_substitutions (tenant_id, user_id, from_time, to_time)
    WHERE active = true;

-- At most one ACTIVE substitution per (tenant, user) so the resolver has a
-- single deterministic deputy per hop (no ambiguity, no ordering surprises).
-- Setting a new active window supersedes the prior one (the repository upsert
-- deactivates any existing active row first).
CREATE UNIQUE INDEX IF NOT EXISTS uq_workflow_substitutions_active_user
    ON workflow_substitutions (tenant_id, user_id)
    WHERE active = true;

-- ---------------------------------------------------------------------------
-- FORCE RLS (new table, no embedding-suite direct-SQL callers).
-- ---------------------------------------------------------------------------
ALTER TABLE workflow_substitutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_substitutions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON workflow_substitutions;
CREATE POLICY tenant_isolation ON workflow_substitutions
    USING (
        tenant_id = current_setting('app.current_tenant_id', true)::uuid
        OR current_setting('app.bypass_rls', true) = 'on'
    );
DROP POLICY IF EXISTS tenant_insert ON workflow_substitutions;
CREATE POLICY tenant_insert ON workflow_substitutions
    FOR INSERT
    WITH CHECK (
        tenant_id = current_setting('app.current_tenant_id', true)::uuid
        OR current_setting('app.bypass_rls', true) = 'on'
    );
DROP POLICY IF EXISTS tenant_update ON workflow_substitutions;
CREATE POLICY tenant_update ON workflow_substitutions
    FOR UPDATE
    USING (
        tenant_id = current_setting('app.current_tenant_id', true)::uuid
        OR current_setting('app.bypass_rls', true) = 'on'
    )
    WITH CHECK (
        tenant_id = current_setting('app.current_tenant_id', true)::uuid
        OR current_setting('app.bypass_rls', true) = 'on'
    );
DROP POLICY IF EXISTS tenant_delete ON workflow_substitutions;
CREATE POLICY tenant_delete ON workflow_substitutions
    FOR DELETE
    USING (
        tenant_id = current_setting('app.current_tenant_id', true)::uuid
        OR current_setting('app.bypass_rls', true) = 'on'
    );
