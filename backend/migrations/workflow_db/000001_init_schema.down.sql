-- Reverse of 000001_init_schema.up.sql. Tables are dropped in reverse
-- dependency order so foreign keys never block a drop. Indexes are removed
-- implicitly with their owning table. The pgcrypto extension is intentionally
-- left in place (other databases/objects may depend on it).

DROP TABLE IF EXISTS event_outbox;
DROP TABLE IF EXISTS workflow_timers;
DROP TABLE IF EXISTS workflow_tasks;
DROP TABLE IF EXISTS workflow_step_executions;
DROP TABLE IF EXISTS workflow_trigger_executions;
DROP TABLE IF EXISTS workflow_instances;
DROP TABLE IF EXISTS workflow_templates;
DROP TABLE IF EXISTS workflow_definitions;
