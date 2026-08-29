-- =============================================================================
-- HUMAN-SCALE — PRE-BREACH SLA REMINDERS: ROW-LEVEL AT-RISK MARKER.
--
-- PROBLEM this closes: the SLA monitor's overdue candidate query gates on the
-- FLAT sla_deadline < now, so a task only becomes a candidate AFTER it has
-- breached — the tiered policy's lower notify/reminder tiers (which fall BEFORE
-- breach) were structurally unreachable, and users only learned once late. These
-- two columns let the monitor stamp an APPROACHING-breach marker so approaching
-- work is queryable (GetAtRiskTasks / the inbox at-risk KPI) and the pre-breach
-- reminder / at_risk events can fire on time.
--
--   at_risk        BOOLEAN  — true once a pre-breach reminder tier has fired and
--                             the task has not yet breached.
--   at_risk_since  TIMESTAMPTZ — first instant the task was seen at risk (set
--                             once, so repeated monitor cycles do not reset it).
--
-- (Renumbered to 000011 to avoid a version collision with the parallel
-- 000010_candidate_groups migration.)
--
-- Additive, reversible, idempotent: ADD COLUMN IF NOT EXISTS on the EXISTING
-- workflow_tasks table (no new table, no policy change — workflow_tasks already
-- FORCEs RLS via migration 000008, and adding columns inherits that policy). The
-- partial index mirrors idx_workflow_tasks_sla so the cross-tenant at-risk scan
-- is cheap. Requires no data migration; the down migration drops only what this
-- file adds. The migration role must have BYPASSRLS.
-- =============================================================================

ALTER TABLE workflow_tasks
    ADD COLUMN IF NOT EXISTS at_risk BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE workflow_tasks
    ADD COLUMN IF NOT EXISTS at_risk_since TIMESTAMPTZ;

-- The monitor's at-risk candidate query is "at_risk rows that have not breached
-- and are still open". A partial index keeps it small (mirrors the sla index).
CREATE INDEX IF NOT EXISTS idx_workflow_tasks_at_risk
    ON workflow_tasks (at_risk_since)
    WHERE at_risk = true AND sla_breached = false AND status IN ('pending', 'claimed');
