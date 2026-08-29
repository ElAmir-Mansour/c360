-- =============================================================================
-- cyber_db: lightweight `users` projection table
-- =============================================================================
-- This table is a LIGHTWEIGHT projection of IAM users (platform_core.users),
-- kept inside cyber_db purely for alert enrichment and analyst-workload joins
-- so the Cyber suite can resolve assignee/owner names and emails WITHOUT a
-- cross-service join into platform_core. It is intentionally a thin lookup
-- table (id, tenant_id, name, email, soft-delete) and is NOT modelled on the
-- full IAM user schema.
--
-- WHY THE CREATE LIVES HERE (version 000033):
-- The original 000033 only ran `ALTER TABLE users ADD COLUMN ...`, but no
-- earlier cyber_db migration ever created the `users` table. That made 000033
-- fail with `relation "users" does not exist`, blocking the entire migration
-- chain — so no later migration could ever repair it. The CREATE therefore
-- must live in 000033 itself. Everything below is idempotent so a down+up
-- cycle (or a re-run) is safe.
--
-- Consumers (only cyber_db query sites that read this table):
--   * internal/cyber/repository/alert_repo.go:
--       SELECT id, first_name, last_name, email FROM users
--       WHERE tenant_id = $1 AND id = ANY($2) AND deleted_at IS NULL
--   * internal/cyber/dashboard/workload.go:
--       FROM alerts a JOIN users u ON u.id = a.assigned_to
--       ... GROUP BY u.id, u.first_name, u.last_name
--   (u.id is a UUID that matches alerts.assigned_to)
-- =============================================================================

-- 1. Lightweight projection table.
CREATE TABLE IF NOT EXISTS users (
    id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  UUID         NOT NULL,
    first_name TEXT,
    last_name  TEXT,
    email      TEXT         NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

COMMENT ON TABLE users IS 'Lightweight projection of platform_core.users for cyber alert enrichment and analyst-workload joins (avoids cross-service joins). Not the full IAM user table.';
COMMENT ON COLUMN users.tenant_id IS 'Owning tenant (references platform_core.tenants)';
COMMENT ON COLUMN users.id IS 'Mirrors platform_core.users.id; matches alerts.assigned_to / asset owner UUIDs';

-- 2. Tenant index (partial on live rows), matching cyber_db index style.
CREATE INDEX IF NOT EXISTS idx_users_tenant ON users (tenant_id) WHERE deleted_at IS NULL;

-- 3. Row-Level Security following the cyber_db tenant-isolation pattern
--    (see migrations/cyber_db/000011_rls.up.sql). Each policy is dropped first
--    so re-running / a down+up cycle is idempotent.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON users;
CREATE POLICY tenant_isolation ON users
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

DROP POLICY IF EXISTS tenant_insert ON users;
CREATE POLICY tenant_insert ON users
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

DROP POLICY IF EXISTS tenant_update ON users;
CREATE POLICY tenant_update ON users
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

DROP POLICY IF EXISTS tenant_delete ON users;
CREATE POLICY tenant_delete ON users
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- 4. Preserve the migration's original documented intent. These are no-ops
--    after the CREATE above, but keep the email/deleted_at columns guaranteed
--    even on any environment where a bare `users` table somehow pre-existed.
ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
