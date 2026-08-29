-- 000004_cutover_execution: Wave 3 — cutover runbook EXECUTION (P7) + rollback
-- EXECUTION (P8) on top of the Wave-2 DR bridge.
--
-- Wave 2 GENERATED runbooks in the DR Runbook Studio and recorded the binding.
-- Wave 3 STARTS those runbooks as live DR runs, proxies per-task actions, ties
-- the go/no-go + validation gates to the REAL run state, and executes a ROLLBACK
-- runbook with full trigger provenance. The DR engine remains the system of
-- record for runs/tasks; migrate_db only records the linkage + provenance.

-- ---------------------------------------------------------------------------
-- Cutover window: record WHEN the live DR run was started and by WHOM, so the
-- previously write-only dr_run_id link gains an auditable start event. (The run
-- id itself was added in 000003 and is populated by LinkWindowRun.)
-- ---------------------------------------------------------------------------
ALTER TABLE migrate_cutover_window
    ADD COLUMN IF NOT EXISTS run_started_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS run_started_by UUID;

-- ---------------------------------------------------------------------------
-- Rollback execution provenance. ExecuteRollback records WHO triggered the
-- rollback and WHY (the trigger-decision provenance the design mandates), the
-- isolated rollback DR runbook it generated, and the DR run it started. A window
-- can be rolled back more than once across its history (e.g. a retry after a
-- failed rollback), so this is an append-only-per-attempt table keyed by id.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS migrate_rollback_run (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    program_id UUID NOT NULL REFERENCES migrate_program(id) ON DELETE CASCADE,
    window_id UUID NOT NULL REFERENCES migrate_cutover_window(id) ON DELETE CASCADE,
    wave_id UUID NOT NULL REFERENCES migrate_wave(id) ON DELETE CASCADE,
    rollback_plan_id UUID REFERENCES migrate_rollback_plan(id) ON DELETE SET NULL,
    -- binding_id links to the migrate_runbook_binding row (role='rollback') that
    -- owns the generated DR rollback runbook for this attempt.
    binding_id UUID REFERENCES migrate_runbook_binding(id) ON DELETE SET NULL,
    -- The isolated DR rollback runbook + the live run started for it (opaque refs
    -- into dr_db, like every other dr_* id here — no FK across databases).
    dr_runbook_id UUID NOT NULL,
    dr_run_id UUID NOT NULL,
    -- Trigger-decision provenance: who pressed the button and why.
    triggered_by UUID NOT NULL,
    reason TEXT NOT NULL DEFAULT '',
    -- status tracks the rollback run lifecycle as observed from the DR engine.
    status TEXT NOT NULL DEFAULT 'running'
        CHECK (status IN ('running','completed','failed','aborted')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_migrate_rollback_run_window
    ON migrate_rollback_run (tenant_id, window_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_migrate_rollback_run_dr_run
    ON migrate_rollback_run (tenant_id, dr_run_id);

ALTER TABLE migrate_rollback_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE migrate_rollback_run FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_select ON migrate_rollback_run FOR SELECT
    USING ((current_setting('app.bypass_rls', true) = 'on'
        OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_insert ON migrate_rollback_run FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on'
        OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_update ON migrate_rollback_run FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on'
        OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on'
        OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_delete ON migrate_rollback_run FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on'
        OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
