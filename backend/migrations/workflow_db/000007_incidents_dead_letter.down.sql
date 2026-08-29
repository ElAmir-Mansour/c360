-- Reverse of 000007_incidents_dead_letter.up.sql. Drops only what that migration
-- created and restores the original instance/step status CHECK constraints (the
-- pre-'incident' allowlist). Safe as long as no rows still carry the 'incident'
-- status; the drop-and-re-add of the CHECK would otherwise be rejected by any
-- surviving 'incident' row, which is the correct fail-closed behaviour.
DROP INDEX IF EXISTS idx_workflow_dead_letter_instance;
DROP INDEX IF EXISTS idx_workflow_dead_letter_tenant_created;
DROP TABLE IF EXISTS workflow_dead_letter;

DROP INDEX IF EXISTS idx_workflow_incident_overrides_tenant_status;
DROP INDEX IF EXISTS idx_workflow_incident_overrides_incident;
DROP TABLE IF EXISTS workflow_incident_overrides;

DROP INDEX IF EXISTS idx_workflow_incidents_open;
DROP INDEX IF EXISTS uq_workflow_incidents_open_step;
DROP INDEX IF EXISTS idx_workflow_incidents_instance;
DROP INDEX IF EXISTS idx_workflow_incidents_tenant;
DROP TABLE IF EXISTS workflow_incidents;

ALTER TABLE workflow_step_executions DROP CONSTRAINT IF EXISTS workflow_step_executions_status_check;
ALTER TABLE workflow_step_executions
    ADD CONSTRAINT workflow_step_executions_status_check
    CHECK (status IN ('pending', 'running', 'completed', 'failed', 'skipped', 'cancelled'));

ALTER TABLE workflow_instances DROP CONSTRAINT IF EXISTS workflow_instances_status_check;
ALTER TABLE workflow_instances
    ADD CONSTRAINT workflow_instances_status_check
    CHECK (status IN ('running', 'completed', 'failed', 'cancelled', 'suspended'));
