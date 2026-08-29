-- Reverse of 000001_init_schema.up.sql. Drop in dependency order; CASCADE on the
-- leaf FKs is implied by the table-drop ordering.
DROP TABLE IF EXISTS event_outbox;
DROP TABLE IF EXISTS automation_approval_gates;
DROP TABLE IF EXISTS automation_run_steps;
DROP TABLE IF EXISTS automation_runs;
DROP TABLE IF EXISTS automation_rules;
DROP TABLE IF EXISTS automations;
DROP TABLE IF EXISTS automation_runbook_steps;
DROP TABLE IF EXISTS automation_runbooks;
