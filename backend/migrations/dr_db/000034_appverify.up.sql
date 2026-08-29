-- Application-aware recovery verification results (internal/dr/appverify). The
-- appverify executor proves a recovered workload is usable at the APPLICATION
-- layer (accepts connections, exposes expected state, passes a smoke operation),
-- and it is already load-bearing: the failover VALIDATING->ATTESTED gate
-- (internal/dr/service WorkloadHealthValidator.validateApplications) plans and
-- runs an app-verification plan per recovered workload and refuses to attest a run
-- whose app checks fail. Those results are recorded in the health-gate
-- failover_step.detail and broadcast on datastream.dr.failover.recovery.validated.
--
-- This table is the DEDICATED, queryable projection of those results so app
-- verification history is first-class (per group / per workload / over time)
-- rather than buried inside each run's step detail, and so derived consumers
-- (e.g. the assurance app-verification evidence feeder) have a real source. It is
-- populated by an idempotent reconcile consumer (the ResultProjector) that
-- consumes recovery.validated and upserts one row per recovered workload per run;
-- nothing on the hot failover path writes here.
--
-- group_id and run_id are intentionally NOT foreign keys: this is an async derived
-- projection, so it must not fail to record because a group or run row was
-- archived/removed between validation and projection.
--
-- Tenant isolation: tenant_id + per-operation RLS with the app.bypass_rls backstop,
-- matching the §7 system-path rule and the dr_db convention.

CREATE TABLE IF NOT EXISTS dr_appverify_result (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    -- the consistency group whose recovered workload was verified.
    group_id UUID NOT NULL,
    -- the failover run the verification was part of (free text: a result can be
    -- projected even after the run row is archived).
    run_id TEXT NOT NULL,
    -- the recovered member/site whose application was verified.
    site_id TEXT NOT NULL,
    -- the verified workload's identity and kind (postgres, kafka, generic_http...).
    workload_id TEXT NOT NULL DEFAULT '',
    workload_kind TEXT NOT NULL DEFAULT '',
    -- passed is true only when every planned check passed.
    passed BOOLEAN NOT NULL DEFAULT false,
    -- check tallies (denormalised for cheap listing/trend views).
    checks_total INT NOT NULL DEFAULT 0,
    checks_passed INT NOT NULL DEFAULT 0,
    required_total INT NOT NULL DEFAULT 0,
    required_passed INT NOT NULL DEFAULT 0,
    -- the ids of checks that did not pass (the actionable gap list).
    failed_checks JSONB NOT NULL DEFAULT '[]'::jsonb,
    duration_ms BIGINT NOT NULL DEFAULT 0,
    finished_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- the full appverify.Result (per-check detail) for drill-down / auditor trace.
    result JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- one projected result per recovered workload per run (idempotent re-delivery).
    UNIQUE (run_id, site_id)
);

CREATE INDEX IF NOT EXISTS idx_dr_appverify_result_group
    ON dr_appverify_result (tenant_id, group_id, finished_at DESC);

CREATE INDEX IF NOT EXISTS idx_dr_appverify_result_workload
    ON dr_appverify_result (tenant_id, workload_kind, finished_at DESC);

ALTER TABLE dr_appverify_result ENABLE ROW LEVEL SECURITY;
ALTER TABLE dr_appverify_result FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON dr_appverify_result;
DROP POLICY IF EXISTS tenant_insert ON dr_appverify_result;
DROP POLICY IF EXISTS tenant_update ON dr_appverify_result;
DROP POLICY IF EXISTS tenant_delete ON dr_appverify_result;

CREATE POLICY tenant_isolation ON dr_appverify_result
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_insert ON dr_appverify_result
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_update ON dr_appverify_result
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_delete ON dr_appverify_result
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
