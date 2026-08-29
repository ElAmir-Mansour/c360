-- =============================================================================
-- Connector invocations driven BY a live cutover/rollback RUN (Wave 6, P10a).
--
-- Before this migration a migrate_connector_invocation could only be produced by
-- the manual `POST /connectors/{id}/invoke` endpoint (Wave 1) — connectors were
-- never invoked as part of a real cutover/rollback execution. Wave 6 emits an
-- AUTOMATED task into the generated wave/rollback runbook whose automation_action
-- targets migrate's own connector-invocation webhook; the DR Runbook Studio engine
-- Executor POSTs the task context to that webhook when the task runs, and the
-- webhook resolves + invokes the configured connector.
--
-- These columns record the RUN provenance of such an invocation so the evidence
-- report can attribute a connector call to the exact DR run + task that drove it,
-- and so the webhook can be idempotent per (run, task). All are nullable/defaulted
-- so the existing manual-invocation path is unchanged (source='manual').
-- =============================================================================

ALTER TABLE migrate_connector_invocation
    ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual'
        CHECK (source IN ('manual', 'cutover_run', 'rollback_run')),
    ADD COLUMN IF NOT EXISTS dr_run_id UUID,
    ADD COLUMN IF NOT EXISTS dr_task_id UUID,
    ADD COLUMN IF NOT EXISTS task_key TEXT NOT NULL DEFAULT '';

-- A run-driven invocation is looked up (for idempotency + audit) by the DR run +
-- task that produced it. The manual path leaves both NULL, so a partial index
-- keeps this specific to run-driven rows.
CREATE INDEX IF NOT EXISTS idx_migrate_connector_invocation_run
    ON migrate_connector_invocation (tenant_id, dr_run_id, dr_task_id)
    WHERE dr_run_id IS NOT NULL;

-- The evidence report lists a window's connector invocations chronologically.
CREATE INDEX IF NOT EXISTS idx_migrate_connector_invocation_window
    ON migrate_connector_invocation (tenant_id, window_id, created_at);
