-- Adds an explicit per-workload effort estimate so wave critical-path
-- computation can use real operator-supplied durations instead of a
-- global constant. A value of 0 means "not estimated": the service then
-- derives a duration from the workload's strategy, tier, and readiness
-- remediation gap (all real per-workload model attributes).
ALTER TABLE migrate_workload
    ADD COLUMN IF NOT EXISTS estimated_effort_hours NUMERIC(8,2) NOT NULL DEFAULT 0
        CHECK (estimated_effort_hours >= 0 AND estimated_effort_hours <= 100000);

COMMENT ON COLUMN migrate_workload.estimated_effort_hours IS
    'Operator-supplied execution effort estimate in hours for cutover/migration of this workload. 0 = derive from strategy/tier/readiness.';
