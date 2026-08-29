-- Case task automation idempotency.
--
-- Automation-created legal_case_tasks carry metadata.automation_key. This partial
-- unique index guarantees one live task per tenant/case/event key while leaving
-- manually created tasks and legacy rows unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS idx_legal_case_tasks_automation_key_unique
    ON legal_case_tasks (tenant_id, case_id, (metadata->>'automation_key'))
    WHERE deleted_at IS NULL AND metadata ? 'automation_key';
