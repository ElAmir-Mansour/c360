-- =============================================================================
-- ClarioDR capability #14 — GAME-DAY (orchestrated resilience exercises /
-- controlled fault injection + scorecard). DESIGN_DataStream_DR.md §6 (drill
-- scope semantics), §8 (events), §11 (SLO board).
--
-- A game-day exercise runs an ORDERED list of steps against a DRILL / NON-PROD
-- scope only. Each step injects a CONTROLLED, REVERSIBLE fault (pause a stream,
-- induce lag, block a site) and asserts the platform RESPONDS — an expected
-- signal (lag alert, predicted-breach, ransomware, topology) fires within an
-- expected detection window. The orchestrator measures the OBSERVED detection
-- and recovery latency against the scenario's expectations and scores each step
-- pass/fail, producing an auditable SCORECARD. A hard SAFETY GUARD refuses any
-- run whose scope is production.
--
-- This complements (does NOT re-implement) the existing DR packages:
--   - internal/dr/registry  : auto-generates the recovery RUNBOOK from assets.
--   - internal/dr/failover   : the gated, durable failover FSM.
--   - internal/dr/topology   : the replication-site graph.
-- Game-day is the controlled-chaos exercise harness that scores how those
-- respond; it is benchmarked against Cutover's runbook-orchestration product.
--
-- Three tables:
--   dr_gameday_scenario     : a reusable, ordered scenario definition (steps as
--                             JSONB) bound to a target consistency group + scope.
--   dr_gameday_run          : one execution of a scenario — its lifecycle status,
--                             timing, aggregate score, and safety-guard verdict.
--   dr_gameday_step_result  : the per-step scorecard row — expected vs observed
--                             signal, measured detection/recovery latency, and
--                             pass/fail. This is the auditable evidence.
--
-- Tenant isolation: all three tables are request-path readable/writable and
-- carry RLS with the app.bypass_rls backstop for the leader-singleton
-- orchestrator loop (which claims due runs across tenants), mirroring the §7
-- system-path rule. Per-operation policies match the dr_db convention.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- A reusable game-day scenario: an ordered list of fault-injection steps with
-- per-step expectations, bound to a target consistency group and a SAFETY SCOPE.
-- scope ∈ drill | non_prod — production scope is rejected at the API and is not
-- a permitted value, so a prod target can never be persisted as a scenario.
CREATE TABLE IF NOT EXISTS dr_gameday_scenario (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    group_id UUID NOT NULL REFERENCES consistency_group(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    -- the SAFETY GUARD substrate: only drill / non-prod scopes may be stored.
    scope TEXT NOT NULL CHECK (scope IN ('drill', 'non_prod')),
    -- the ordered steps: a JSON array of {action, target, params, expect:{signal,
    -- detect_within_ms, recover_within_ms, ...}}. The orchestrator decodes and
    -- validates this; the DB stores it opaquely so the step schema can evolve.
    steps JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_dr_gameday_scenario_group
    ON dr_gameday_scenario (tenant_id, group_id);

-- One execution of a scenario. status walks
--   pending -> running -> {passed | failed | aborted}
-- pending : created, awaiting the orchestrator (or run inline).
-- running : the orchestrator is injecting faults and observing signals.
-- passed  : every step's observed signal met its expectation within window.
-- failed  : at least one step's expectation was not met (a detection/recovery
--           miss) — the exercise found a resilience gap.
-- aborted : the run was stopped (safety guard tripped, cancelled, or a fatal
--           orchestration error). Faults are ALWAYS reverted regardless.
CREATE TABLE IF NOT EXISTS dr_gameday_run (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    scenario_id UUID NOT NULL REFERENCES dr_gameday_scenario(id) ON DELETE CASCADE,
    group_id UUID NOT NULL REFERENCES consistency_group(id) ON DELETE CASCADE,
    -- denormalised from the scenario so the run records the scope it ran under
    -- (the safety verdict is permanent evidence even if the scenario is edited).
    scope TEXT NOT NULL CHECK (scope IN ('drill', 'non_prod')),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'running', 'passed', 'failed', 'aborted')),
    -- aggregate scorecard rollup, populated as steps complete.
    steps_total INT NOT NULL DEFAULT 0,
    steps_passed INT NOT NULL DEFAULT 0,
    -- 0.0000 .. 1.0000 — steps_passed / steps_total at completion.
    score NUMERIC(5,4),
    -- every injected fault was confirmed reverted (defer-based teardown ran).
    all_faults_reverted BOOLEAN NOT NULL DEFAULT false,
    -- the safety-guard verdict recorded BEFORE any fault was injected.
    safety_verdict TEXT NOT NULL DEFAULT 'pending'
        CHECK (safety_verdict IN ('pending', 'allowed', 'rejected_production')),
    last_error TEXT,
    initiated_by UUID,
    initiated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    -- driver lease for the leader-singleton orchestrator (FOR UPDATE SKIP LOCKED).
    claimed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dr_gameday_run_scenario
    ON dr_gameday_run (tenant_id, scenario_id, initiated_at DESC);

-- the orchestrator claims pending/running runs across tenants; this partial
-- index serves the leader-singleton claim (FOR UPDATE SKIP LOCKED), excluding
-- terminal runs, mirroring the failover_run driver index (§6.2 / §7).
CREATE INDEX IF NOT EXISTS idx_dr_gameday_run_driver
    ON dr_gameday_run (status, claimed_at)
    WHERE status IN ('pending', 'running');

-- The per-step scorecard: one row per executed scenario step, recording the
-- expectation, the observation, the measured latencies, and the verdict. This
-- is the auditable evidence the GET /gameday/runs/{id} scorecard renders.
CREATE TABLE IF NOT EXISTS dr_gameday_step_result (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    run_id UUID NOT NULL REFERENCES dr_gameday_run(id) ON DELETE CASCADE,
    -- 0-based position of the step within the scenario's ordered list.
    step_index INT NOT NULL,
    -- the fault action that was injected (pause_stream | induce_lag | block_site).
    action TEXT NOT NULL,
    -- the fault target (stream id, site id, …) — opaque label for the scorecard.
    target TEXT NOT NULL DEFAULT '',
    -- EXPECTED: the signal the platform should raise and the detection window.
    expected_signal TEXT NOT NULL DEFAULT '',
    detect_within_ms BIGINT NOT NULL DEFAULT 0,
    recover_within_ms BIGINT NOT NULL DEFAULT 0,
    -- OBSERVED: whether the expected signal fired, and the measured latencies.
    signal_observed BOOLEAN NOT NULL DEFAULT false,
    observed_signal TEXT NOT NULL DEFAULT '',
    -- measured detection latency: fault-injected -> signal-observed (ms). NULL if
    -- the signal never fired within the polling deadline.
    detection_latency_ms BIGINT,
    -- measured recovery latency: revert-started -> signal-cleared (ms). NULL when
    -- recovery was not observed / not expected.
    recovery_latency_ms BIGINT,
    -- the per-fault revert ran (defer-based teardown) — proven reversibility.
    fault_reverted BOOLEAN NOT NULL DEFAULT false,
    -- the step verdict: detection (and recovery, when expected) within window.
    passed BOOLEAN NOT NULL DEFAULT false,
    -- operator-facing reason for the verdict (why it passed / failed).
    detail TEXT NOT NULL DEFAULT '',
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ,
    -- a step runs once per run (idempotency on re-claim, mirroring failover_step).
    UNIQUE (run_id, step_index)
);

CREATE INDEX IF NOT EXISTS idx_dr_gameday_step_result_run
    ON dr_gameday_step_result (run_id, step_index);

-- =============================================================================
-- Row-level security. All three tables are request-path readable/writable and
-- carry RLS; the app.bypass_rls backstop lets the leader-singleton orchestrator
-- loop claim/advance runs across tenants (§7). Per-operation policies match the
-- dr_db convention used by the topology / failover tables.
-- =============================================================================
ALTER TABLE dr_gameday_scenario ENABLE ROW LEVEL SECURITY;
ALTER TABLE dr_gameday_scenario FORCE ROW LEVEL SECURITY;
ALTER TABLE dr_gameday_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE dr_gameday_run FORCE ROW LEVEL SECURITY;
ALTER TABLE dr_gameday_step_result ENABLE ROW LEVEL SECURITY;
ALTER TABLE dr_gameday_step_result FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON dr_gameday_scenario;
DROP POLICY IF EXISTS tenant_insert ON dr_gameday_scenario;
DROP POLICY IF EXISTS tenant_update ON dr_gameday_scenario;
DROP POLICY IF EXISTS tenant_delete ON dr_gameday_scenario;

DROP POLICY IF EXISTS tenant_isolation ON dr_gameday_run;
DROP POLICY IF EXISTS tenant_insert ON dr_gameday_run;
DROP POLICY IF EXISTS tenant_update ON dr_gameday_run;
DROP POLICY IF EXISTS tenant_delete ON dr_gameday_run;

DROP POLICY IF EXISTS tenant_isolation ON dr_gameday_step_result;
DROP POLICY IF EXISTS tenant_insert ON dr_gameday_step_result;
DROP POLICY IF EXISTS tenant_update ON dr_gameday_step_result;
DROP POLICY IF EXISTS tenant_delete ON dr_gameday_step_result;

CREATE POLICY tenant_isolation ON dr_gameday_scenario
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_insert ON dr_gameday_scenario
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_update ON dr_gameday_scenario
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_delete ON dr_gameday_scenario
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_isolation ON dr_gameday_run
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_insert ON dr_gameday_run
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_update ON dr_gameday_run
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_delete ON dr_gameday_run
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_isolation ON dr_gameday_step_result
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_insert ON dr_gameday_step_result
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_update ON dr_gameday_step_result
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_delete ON dr_gameday_step_result
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
