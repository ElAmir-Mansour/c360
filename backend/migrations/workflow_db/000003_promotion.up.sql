-- =============================================================================
-- WP-4 — Versioning + environment promotion (DESIGN_Workflow_Forms_Automation.md
-- §3.3).
--
-- Adds the promotion lineage + stage columns to the EXISTING
-- workflow_definitions table:
--   * definition_key — a stable lineage id constant across every version of a
--     logical definition (all versions that share (tenant_id, name) get the same
--     key). The seed versions by (tenant,name) and forks-on-edit; this column
--     gives that lineage a stable, queryable identity independent of name edits
--     going forward.
--   * stage          — dev | staging | prod. A draft is born in 'dev' and is
--     advanced by the promote FSM (dev→staging→prod, no skips).
--   * immutable      — set true the moment a version reaches staging or prod, so
--     Update/Archive on it return 409 (the INTEGRATE phase wires ImmutableGuard
--     into those call sites; editing forks a new draft under the same key).
--   * promoted_at / promoted_by — stamped on each successful promote.
--
-- This migration only ALTERs the existing workflow_definitions table and adds a
-- lineage index; it creates no new tables. Per the workflow_db convention
-- (000001 header) the existing workflow tables keep NO forced RLS — the
-- repositories filter by tenant_id in SQL but do not yet adopt RunWithTenant, so
-- forcing RLS here would break them. RLS retrofit for these tables is deferred.
-- New RLS-aware tables (forms/approval/SLA) are introduced by their own WPs.
--
-- Every statement is idempotent (ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT
-- EXISTS / guarded constraint add) so applying on an already-migrated database,
-- or re-applying, is a safe no-op.
-- =============================================================================

-- pgcrypto is required for gen_random_uuid() used in the backfill. Provisioned
-- centrally; declared idempotently so an apply-from-scratch succeeds.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------------
-- 1. Columns. definition_key is added nullable first so the backfill can run;
--    the NOT NULL is enforced afterwards once every row carries a key.
-- ---------------------------------------------------------------------------
ALTER TABLE workflow_definitions
    ADD COLUMN IF NOT EXISTS definition_key UUID;

ALTER TABLE workflow_definitions
    ADD COLUMN IF NOT EXISTS stage TEXT NOT NULL DEFAULT 'dev';

ALTER TABLE workflow_definitions
    ADD COLUMN IF NOT EXISTS immutable BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE workflow_definitions
    ADD COLUMN IF NOT EXISTS promoted_at TIMESTAMPTZ;

ALTER TABLE workflow_definitions
    ADD COLUMN IF NOT EXISTS promoted_by TEXT;

-- ---------------------------------------------------------------------------
-- 2. stage CHECK constraint. Added guarded (the column default already keeps new
--    rows in range) so re-running the migration does not error on a duplicate
--    constraint name.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'workflow_definitions_stage_check'
    ) THEN
        ALTER TABLE workflow_definitions
            ADD CONSTRAINT workflow_definitions_stage_check
            CHECK (stage IN ('dev', 'staging', 'prod'));
    END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 3. Backfill definition_key per (tenant_id, name) lineage. Every version that
--    shares a (tenant_id, name) inherits ONE freshly generated key, so the
--    existing fork-on-edit lineage gets a single stable identity. Only rows that
--    have not already been assigned a key are touched, making the backfill
--    idempotent and re-runnable.
-- ---------------------------------------------------------------------------
WITH lineage AS (
    SELECT DISTINCT tenant_id, name
    FROM workflow_definitions
    WHERE definition_key IS NULL
),
assigned AS (
    SELECT tenant_id, name, gen_random_uuid() AS new_key
    FROM lineage
)
UPDATE workflow_definitions d
SET definition_key = a.new_key
FROM assigned a
WHERE d.tenant_id = a.tenant_id
  AND d.name = a.name
  AND d.definition_key IS NULL;

-- ---------------------------------------------------------------------------
-- 4. Enforce NOT NULL on definition_key now that every existing row has a key.
--    New rows must supply one (the application sets it on create/fork).
--    Guarded so re-running does not fail if already NOT NULL.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'workflow_definitions'
          AND column_name = 'definition_key'
          AND is_nullable = 'YES'
    ) THEN
        ALTER TABLE workflow_definitions
            ALTER COLUMN definition_key SET NOT NULL;
    END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 5. Lineage index — the hot path is "all versions+stages for a lineage in a
--    tenant" (GET /definitions/{key}/lineage) and the immutability/promote
--    lookups. Excludes soft-deleted rows to keep the index lean.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_workflow_definitions_tenant_key
    ON workflow_definitions (tenant_id, definition_key)
    WHERE deleted_at IS NULL;
