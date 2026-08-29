-- =============================================================================
-- Scheduled DR drills + drill diff (ClarioDR capability #12,
-- DESIGN_DataStream_DR.md §6.2 drill mode, §8 events, §11 SLO metrics).
--
-- This COMPLEMENTS the gated failover driver (internal/dr/failover): it does NOT
-- re-run drills. A schedule fires by REQUESTING a drill via the existing DRILL
-- code path (it emits dr.drill.scheduled to the outbox); the failover driver
-- runs the drill, and its outcome is ingested back here as a dr_drill_result so
-- consecutive results can be DIFFED to surface drift (RTO/RPO regression, newly
-- failing/passing steps, step-duration drift, asset/topology drift).
--
-- dr_drill_schedule : a recurring, non-disruptive drill cadence for a
--                     consistency group, driven by a standard 5-field cron
--                     expression. next_run is the materialised next fire time
--                     (computed by the package's cron engine and advanced by the
--                     leader-singleton scheduler after a drill is requested).
-- dr_drill_result   : the outcome the failover DRILL path produced for one fired
--                     drill — achieved RTO/RPO, the per-step timeline, pass/fail,
--                     the pinned recovery point, and the validation outcome. The
--                     diff engine compares the latest result to the previous one
--                     for the same schedule/group.
--
-- Tenant isolation follows the §7 dr_db convention: both tables carry tenant_id
-- and get per-operation RLS, with the app.bypass_rls backstop for the
-- leader-singleton scheduler loop (which scans due schedules across tenants).
-- Every request-path query filters by tenant AND runs under SET LOCAL
-- app.current_tenant_id so RLS is the backstop even if a filter is forgotten.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS dr_drill_schedule (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    group_id UUID NOT NULL REFERENCES consistency_group(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    -- a standard 5-field cron expression (minute hour dom month dow). Parsed and
    -- evaluated by the package's own NextAfter engine (no external dependency).
    cron_expr TEXT NOT NULL,
    -- the network-mapping profile the requested drill boots into; a scheduled
    -- drill is non-disruptive, so it defaults to the isolated profile (§6.2).
    profile TEXT NOT NULL DEFAULT 'isolated'
        CHECK (profile IN ('production','isolated')),
    -- the RTO objective (seconds) the requested drill attests against; falls back
    -- to the group's strictest member objective when zero at request time.
    rto_objective_seconds INT NOT NULL DEFAULT 900,
    enabled BOOLEAN NOT NULL DEFAULT true,
    -- the materialised next fire time (UTC), computed from cron_expr. The
    -- scheduler claims schedules whose next_run <= now() and advances it.
    next_run TIMESTAMPTZ NOT NULL,
    -- the last time a drill was actually requested for this schedule (NULL until
    -- the first fire); used for observability and to make a fire idempotent.
    last_fired_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, name)
);

-- the scheduler scans enabled schedules whose next_run has come due, ACROSS ALL
-- tenants, ordered by how overdue they are; this index serves that scan.
CREATE INDEX IF NOT EXISTS idx_dr_drill_schedule_due
    ON dr_drill_schedule (enabled, next_run);

CREATE INDEX IF NOT EXISTS idx_dr_drill_schedule_group
    ON dr_drill_schedule (group_id);

CREATE TABLE IF NOT EXISTS dr_drill_result (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    group_id UUID NOT NULL REFERENCES consistency_group(id) ON DELETE CASCADE,
    -- the schedule this drill was fired by (NULL for an ad-hoc drill recorded
    -- outside a schedule); diffs are computed per (group, schedule).
    schedule_id UUID REFERENCES dr_drill_schedule(id) ON DELETE SET NULL,
    -- the failover_run this result was produced by (the DRILL run the driver
    -- advanced). Free-text rather than a FK so a result can be ingested even if
    -- the run row was archived; one result per run.
    run_id TEXT NOT NULL DEFAULT '',
    passed BOOLEAN NOT NULL,
    rto_achieved_seconds INT NOT NULL DEFAULT 0,
    rpo_achieved_seconds INT NOT NULL DEFAULT 0,
    rto_objective_seconds INT NOT NULL DEFAULT 0,
    -- the pinned recovery point the drill recovered from (NULL when none).
    recovery_point_id UUID,
    -- the validation match ratio the recovered workloads achieved (0..1).
    validation_ratio NUMERIC(5,4),
    -- a free-text validation outcome string (e.g. "health green", "probe X failed").
    validation_outcome TEXT NOT NULL DEFAULT '',
    -- the per-step timeline: an ordered JSON array of
    --   {"key","title","status","duration_ms"} captured from the failover_step
    -- rows the DRILL run produced. The diff engine reads this to find newly
    -- failing/passing steps and per-step duration drift.
    steps JSONB NOT NULL DEFAULT '[]'::jsonb,
    -- a snapshot of the asset/topology fingerprint at drill time (member sites,
    -- boot order, topology edges) so a diff can surface asset/topology drift even
    -- when no step changed.
    asset_fingerprint JSONB NOT NULL DEFAULT '{}'::jsonb,
    observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (run_id)
);

-- the diff engine loads "latest then previous" for a (group[, schedule]); index
-- by the keys it orders on.
CREATE INDEX IF NOT EXISTS idx_dr_drill_result_group
    ON dr_drill_result (group_id, observed_at DESC);

CREATE INDEX IF NOT EXISTS idx_dr_drill_result_schedule
    ON dr_drill_result (schedule_id, observed_at DESC);

-- Tenant isolation: per-operation policies, app.bypass_rls backstop for the
-- leader-singleton scheduler scan, matching the §7 dr_db convention.
ALTER TABLE dr_drill_schedule ENABLE ROW LEVEL SECURITY;
ALTER TABLE dr_drill_schedule FORCE ROW LEVEL SECURITY;
ALTER TABLE dr_drill_result ENABLE ROW LEVEL SECURITY;
ALTER TABLE dr_drill_result FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON dr_drill_schedule;
DROP POLICY IF EXISTS tenant_insert ON dr_drill_schedule;
DROP POLICY IF EXISTS tenant_update ON dr_drill_schedule;
DROP POLICY IF EXISTS tenant_delete ON dr_drill_schedule;

DROP POLICY IF EXISTS tenant_isolation ON dr_drill_result;
DROP POLICY IF EXISTS tenant_insert ON dr_drill_result;
DROP POLICY IF EXISTS tenant_update ON dr_drill_result;
DROP POLICY IF EXISTS tenant_delete ON dr_drill_result;

CREATE POLICY tenant_isolation ON dr_drill_schedule
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_insert ON dr_drill_schedule
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_update ON dr_drill_schedule
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_delete ON dr_drill_schedule
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_isolation ON dr_drill_result
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_insert ON dr_drill_result
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_update ON dr_drill_result
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_delete ON dr_drill_result
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
