-- Reverse of 000017_boundary_events.up.sql. Drops ONLY the optional operator/
-- tooling index this migration added. Boundary events + the event-based gateway
-- live entirely in the existing JSONB columns (workflow_definitions.steps and the
-- per-step config), so there is nothing else to reverse — no tables/columns were
-- added and no data was migrated.
DROP INDEX IF EXISTS idx_workflow_definitions_boundary_events;
