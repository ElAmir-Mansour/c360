-- =============================================================================
-- VERSIONING / LIFECYCLE HARDENING — deterministic, unique runtime-active version.
--
-- Camunda/Flowable/Temporal treat version lifecycle as table-stakes. This wave
-- reconciles the stage(dev/staging/prod) and status(draft/active/…/archived) FSMs
-- so that, for a given definition lineage (definition_key), at most ONE version
-- is the RUNTIME-SELECTED active version — the prod-promoted active one — and the
-- selection is DETERMINISTIC (prod > staging > dev, tie-break version DESC, never
-- by name).
--
-- The service layer already enforces the "one prod-active version per lineage"
-- rule inside the promote transaction (PromotionService cross-check). This
-- migration adds DEFENSE IN DEPTH at the database:
--
--   1. a PARTIAL UNIQUE INDEX guaranteeing at most one (tenant_id, definition_key)
--      row is simultaneously stage='prod' AND status='active' AND not soft-deleted
--      — so even a direct-SQL or racing writer cannot create a second prod-active
--      version of a lineage (the invariant runtime selection relies on).
--   2. a supporting index for the deterministic runtime-active lookup
--      (tenant_id, definition_key) over live active rows, so
--      GetRuntimeActiveByDefinitionKey / GetActiveByTriggerTopic's DISTINCT ON
--      resolve the single canonical version without a lineage scan.
--
-- This migration is ADDITIVE, REVERSIBLE and IDEMPOTENT: it adds only indexes, no
-- columns, no tables, no data migration. It touches the EXISTING
-- workflow_definitions table (whose RLS is governed by 000008) and adds no policy.
--
-- NOTE ON IDEMPOTENCE OF THE UNIQUE INDEX: a database that ALREADY violates the
-- invariant (two prod-active rows in one lineage — only possible on legacy data
-- created before the service cross-check) would fail the CREATE UNIQUE INDEX. That
-- is intentional and fail-closed: the operator resolves the duplicate (archive one
-- version) before the invariant can be enforced. The partial predicate keeps the
-- index tiny (only prod-active live rows).
-- =============================================================================

-- 1. At most ONE prod-promoted active version per lineage.
CREATE UNIQUE INDEX IF NOT EXISTS uq_workflow_definitions_one_prod_active
    ON workflow_definitions (tenant_id, definition_key)
    WHERE stage = 'prod' AND status = 'active' AND deleted_at IS NULL;

-- 2. Support the deterministic runtime-active selection (active rows per lineage).
CREATE INDEX IF NOT EXISTS idx_workflow_definitions_lineage_active
    ON workflow_definitions (tenant_id, definition_key, version DESC)
    WHERE status = 'active' AND deleted_at IS NULL;
