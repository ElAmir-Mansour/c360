-- =============================================================================
-- Round 2 maturation: append-only calendar + service-catalog audit logs +
-- optimistic-concurrency columns for legal_settlement / legal_judgments.
--
-- CONFLICT RESOLUTION (integrator): this file was de-scoped to avoid double-
-- defining objects owned by sibling Round-2 migrations:
--   * legal_request_audit_log / legal_sla_audit_log -> owned by
--     000039_spine_sla_audit_log (richer request_id/sla_clock_id schema).
--   * legal_cases.lock_version + on_hold facts        -> owned by
--     000040_legal_case_depth.
--   * objection-deadline exactly-once guard            -> owned by
--     000038_litigation_audit_and_judgment_idempotency
--     (legal_obligations.judgment_id + uq_legal_obligations_judgment_live).
-- This migration therefore owns ONLY the two calendar/service-catalog audit
-- tables and the settlement/judgment lock_version columns.
--
-- VERIFIED against migrations 000018-000037:
--   * legal_settlement (000030, SINGULAR) — has deleted_at, NO lock_version
--   * legal_judgments  (000027)           — has deleted_at, NO lock_version
--   * legal_working_calendars / legal_calendar_holidays (000018)
--   * legal_service_catalog (000022)
--
-- All audit tables follow the existing append-only *_audit_log convention
-- (legal_settlement_audit_log 000030, legal_case_classification_audit_log 000025):
-- tenant-isolation USING policy + INSERT-only WITH CHECK policy, NO UPDATE/DELETE
-- policy under FORCE ROW LEVEL SECURITY -> the ledger is immutable. Each row
-- carries before/after JSONB snapshots written INSIDE the mutation tx.
-- Idempotent throughout (IF NOT EXISTS / DO $$ guards).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- (1) legal_calendar_audit_log — working-calendar / working-hours / holiday edits.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS legal_calendar_audit_log (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID        NOT NULL,
    entity_id   UUID        NOT NULL,
    actor_id    UUID,
    action      TEXT        NOT NULL,
    from_status TEXT,
    to_status   TEXT,
    before      JSONB,
    after       JSONB,
    reason      TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_legal_calendar_audit_log_entity
    ON legal_calendar_audit_log (tenant_id, entity_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_legal_calendar_audit_log_tenant
    ON legal_calendar_audit_log (tenant_id, created_at DESC);

ALTER TABLE legal_calendar_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_calendar_audit_log FORCE ROW LEVEL SECURITY;
-- PG16 has no CREATE POLICY IF NOT EXISTS -> guard for re-run idempotency.
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='legal_calendar_audit_log' AND policyname='tenant_isolation') THEN
        CREATE POLICY tenant_isolation ON legal_calendar_audit_log
            USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='legal_calendar_audit_log' AND policyname='tenant_insert') THEN
        CREATE POLICY tenant_insert ON legal_calendar_audit_log
            FOR INSERT
            WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
    END IF;
END $$;
-- No UPDATE/DELETE policy: append-only.

-- -----------------------------------------------------------------------------
-- (2) legal_service_catalog_audit_log — service-catalog / eligibility-rule edits.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS legal_service_catalog_audit_log (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID        NOT NULL,
    entity_id   UUID        NOT NULL,
    actor_id    UUID,
    action      TEXT        NOT NULL,
    from_status TEXT,
    to_status   TEXT,
    before      JSONB,
    after       JSONB,
    reason      TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_legal_service_catalog_audit_log_entity
    ON legal_service_catalog_audit_log (tenant_id, entity_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_legal_service_catalog_audit_log_tenant
    ON legal_service_catalog_audit_log (tenant_id, created_at DESC);

ALTER TABLE legal_service_catalog_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_service_catalog_audit_log FORCE ROW LEVEL SECURITY;
-- PG16 has no CREATE POLICY IF NOT EXISTS -> guard for re-run idempotency.
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='legal_service_catalog_audit_log' AND policyname='tenant_isolation') THEN
        CREATE POLICY tenant_isolation ON legal_service_catalog_audit_log
            USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='legal_service_catalog_audit_log' AND policyname='tenant_insert') THEN
        CREATE POLICY tenant_insert ON legal_service_catalog_audit_log
            FOR INSERT
            WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
    END IF;
END $$;
-- No UPDATE/DELETE policy: append-only.

-- -----------------------------------------------------------------------------
-- (3) Optimistic-concurrency columns. DEFAULT 0 backfills existing rows; NOT NULL
--     so callers always read/write it. legal_requests already has lock_version
--     (000036) and legal_cases gets it from 000040_legal_case_depth, so neither is
--     touched here. legal_settlement depth (000044) depends on these.
-- -----------------------------------------------------------------------------
ALTER TABLE legal_settlement
    ADD COLUMN IF NOT EXISTS lock_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE legal_judgments
    ADD COLUMN IF NOT EXISTS lock_version INTEGER NOT NULL DEFAULT 0;
