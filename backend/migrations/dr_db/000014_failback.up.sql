-- ClarioDR capability #9 — FAILBACK (DESIGN_DataStream_DR.md §6 gate discipline,
-- mirrored in the reverse direction). After a failover where the workload now
-- runs at the DR site, FAIL BACK to the original (restored) primary with minimal
-- data loss: establish REVERSE replication (DR site -> original primary) to ship
-- the delta written while running at DR, track convergence, then a gated cutback.
--
-- The failback FSM mirrors the failover gate discipline (a persisted, restart-safe,
-- leader-driven state machine — NOT the workflow engine, §6 decision):
--   PLANNING -> REVERSE_SYNCING -> DELTA_CONVERGED -> AWAITING_CUTBACK_APPROVAL
--            -> CUTTING_BACK -> COMPLETED   (+ FAILED on any error)
-- Every transition is a row update inside RunInTx with an outbox event. A restart
-- re-loads the run and resumes from its persisted status. The cutback is gated on
-- an EXPLICIT human approval: the driver never claims AWAITING_CUTBACK_APPROVAL
-- (the partial index below excludes it), so it never auto-cuts.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- One row-backed instance of the gated failback FSM. from_site is the DR site
-- the workload currently runs at; to_site is the original (restored) primary the
-- reverse stream ships the delta to. reverse_stream_id is the core StreamID of
-- the DR->primary reverse replication established in REVERSE_SYNCING.
CREATE TABLE IF NOT EXISTS dr_failback_run (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    group_id UUID NOT NULL REFERENCES consistency_group(id),
    -- The failover run this failback reverses (audit linkage). Optional: a
    -- failback may be planned independently of a recorded failover row.
    failover_run_id UUID REFERENCES failover_run(id),
    -- from_site: the DR site currently authoritative (the new "source" of the
    -- reverse stream). to_site: the original/restored primary (the reverse
    -- stream's target). Both reference protected_site so the asset model is reused.
    from_site UUID NOT NULL REFERENCES protected_site(id),
    to_site UUID NOT NULL REFERENCES protected_site(id),
    -- The reverse replication stream (DR -> original primary). NULL until
    -- REVERSE_SYNCING starts it; set durably so a restart reuses the same stream.
    reverse_stream_id TEXT,
    status TEXT NOT NULL DEFAULT 'PLANNING'
        CHECK (status IN (
            'PLANNING','REVERSE_SYNCING','DELTA_CONVERGED',
            'AWAITING_CUTBACK_APPROVAL','CUTTING_BACK','COMPLETED','FAILED'
        )),
    -- Delta convergence tracking on the reverse stream. delta_bytes_remaining is
    -- the unreplicated byte backlog DR->primary; the run declares DELTA_CONVERGED
    -- only when it falls at/under converge_threshold_bytes AND a quiesce/cutover
    -- window opens. delta_seq_remaining is the same backlog in frame-count terms.
    delta_bytes_remaining BIGINT NOT NULL DEFAULT 0,
    delta_seq_remaining BIGINT NOT NULL DEFAULT 0,
    converge_threshold_bytes BIGINT NOT NULL DEFAULT 0,
    -- The reverse stream's source/target cursors, for convergence math and audit.
    source_lsn TEXT,                 -- highest LSN written at the DR site (head)
    applied_lsn TEXT,                -- highest LSN durably applied at the primary
    last_converged_at TIMESTAMPTZ,   -- when DELTA_CONVERGED was first declared
    -- The cutover window must be open before convergence is declared (quiesce of
    -- DR-side writes / maintenance window). Gated, not assumed.
    cutover_window_open BOOLEAN NOT NULL DEFAULT false,
    -- Cutback approval (the human gate). Never auto-cuts: CUTTING_BACK is only
    -- reachable after approved_by is set via the approve-cutback API.
    initiated_by UUID NOT NULL,
    approved_by UUID,
    approved_at TIMESTAMPTZ,
    -- The new replication direction recorded on COMPLETED (e.g. "primary->dr"):
    -- after cutback the original primary is authoritative again and forward
    -- replication resumes primary -> DR.
    new_direction TEXT,
    last_error TEXT,
    -- Driver lease (FOR UPDATE SKIP LOCKED), mirroring failover_run.claimed_at.
    claimed_at TIMESTAMPTZ,
    initiated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- A protected site cannot fail back into itself.
    CHECK (from_site <> to_site)
);

-- The driver claim index: excludes terminal and human-gated states exactly like
-- the failover_run partial index (§7), so AWAITING_CUTBACK_APPROVAL parks without
-- the driver busy-looping and the cutback never advances without /approve-cutback.
CREATE INDEX IF NOT EXISTS idx_failback_driver
    ON dr_failback_run (status, claimed_at)
    WHERE status NOT IN ('COMPLETED','FAILED','AWAITING_CUTBACK_APPROVAL');

CREATE INDEX IF NOT EXISTS idx_failback_run_tenant
    ON dr_failback_run (tenant_id, initiated_at DESC);

CREATE INDEX IF NOT EXISTS idx_failback_run_group
    ON dr_failback_run (group_id, initiated_at DESC);

-- Per-step durable audit + idempotency (one row per gate/step), mirroring
-- failover_step (§7). A re-claim after crash is idempotent: UNIQUE (run_id, step).
CREATE TABLE IF NOT EXISTS dr_failback_step (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID NOT NULL REFERENCES dr_failback_run(id) ON DELETE CASCADE,
    step TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('running','passed','failed')),
    detail JSONB,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ,
    UNIQUE (run_id, step)
);

CREATE INDEX IF NOT EXISTS idx_failback_step_run
    ON dr_failback_step (run_id, started_at);

-- Tenant isolation (DESIGN §7): request-path readable + RLS with the
-- app.bypass_rls backstop for the leader-singleton failback driver (which claims
-- runs across tenants via FOR UPDATE SKIP LOCKED). Per-operation policies plus
-- the bypass backstop, matching the dr_db convention exactly.
ALTER TABLE dr_failback_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE dr_failback_run FORCE ROW LEVEL SECURITY;
ALTER TABLE dr_failback_step ENABLE ROW LEVEL SECURITY;
ALTER TABLE dr_failback_step FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON dr_failback_run;
DROP POLICY IF EXISTS tenant_insert ON dr_failback_run;
DROP POLICY IF EXISTS tenant_update ON dr_failback_run;
DROP POLICY IF EXISTS tenant_delete ON dr_failback_run;

DROP POLICY IF EXISTS tenant_isolation ON dr_failback_step;
DROP POLICY IF EXISTS tenant_insert ON dr_failback_step;
DROP POLICY IF EXISTS tenant_update ON dr_failback_step;
DROP POLICY IF EXISTS tenant_delete ON dr_failback_step;

CREATE POLICY tenant_isolation ON dr_failback_run
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_insert ON dr_failback_run
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_update ON dr_failback_run
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_delete ON dr_failback_run
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

-- dr_failback_step carries no tenant_id column; it is scoped through its parent
-- run. Its policies key on the parent run's tenant (or the bypass backstop) so a
-- request-path read of another tenant's steps returns zero rows, while the
-- driver's system path (app.bypass_rls = 'on') can advance any tenant's run.
CREATE POLICY tenant_isolation ON dr_failback_step
    USING ((current_setting('app.bypass_rls', true) = 'on' OR EXISTS (
        SELECT 1 FROM dr_failback_run r
        WHERE r.id = dr_failback_step.run_id
          AND r.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)));

CREATE POLICY tenant_insert ON dr_failback_step
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR EXISTS (
        SELECT 1 FROM dr_failback_run r
        WHERE r.id = dr_failback_step.run_id
          AND r.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)));

CREATE POLICY tenant_update ON dr_failback_step
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR EXISTS (
        SELECT 1 FROM dr_failback_run r
        WHERE r.id = dr_failback_step.run_id
          AND r.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR EXISTS (
        SELECT 1 FROM dr_failback_run r
        WHERE r.id = dr_failback_step.run_id
          AND r.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)));

CREATE POLICY tenant_delete ON dr_failback_step
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR EXISTS (
        SELECT 1 FROM dr_failback_run r
        WHERE r.id = dr_failback_step.run_id
          AND r.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)));
