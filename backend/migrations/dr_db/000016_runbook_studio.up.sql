-- Runbook Studio (ClarioDR capability #11, DESIGN_DataStream_DR.md §6 gated
-- failover, §14.3 Recovery Asset Registry analogue). This is the HUMAN-AUTHORED,
-- editable orchestration layer — the Cutover analogue — that COMPLEMENTS the
-- machine-maintained registry runbook (internal/dr/registry, which AUTO-GENERATES
-- a recovery runbook from consistency_group assets). Where the registry projects
-- the §6 FSM from assets, the studio lets an operator author an arbitrary task
-- DAG, run it live, and track elapsed-vs-planned against the real critical path.
--
-- dr_studio_runbook  : a named, editable orchestration runbook (a graph of tasks)
--                      optionally bound to a consistency group. status draft|
--                      published|archived. A runbook may be IMPORTED from a
--                      registry-generated step list (source_runbook = 'registry').
-- dr_studio_task     : one node of the runbook's task DAG. rich task TYPES
--                      (manual|automated|approval_gate|comms|milestone), an owner/
--                      team, a planned_duration, instructions, an automation action
--                      reference (automated tasks), and predecessors[] (the edges
--                      of the DAG — task ids in the SAME runbook). The application
--                      layer guarantees acyclicity via DFS cycle detection on every
--                      author-time mutation.
-- dr_studio_run      : one LIVE execution of a runbook. status pending|running|
--                      completed|failed|aborted. Records the planned critical-path
--                      duration captured at start and the projected/actual finish.
-- dr_studio_task_run : per-task execution state within a run. status pending|
--                      runnable|running|complete|skipped|failed|blocked. The engine
--                      recomputes the runnable frontier (all predecessors complete)
--                      as operators/automation complete/skip/fail tasks.

CREATE TABLE IF NOT EXISTS dr_studio_runbook (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    -- optional binding to a consistency group the runbook orchestrates. Free of a
    -- hard FK so a runbook can be authored as a template before a group exists; the
    -- service validates the group when one is supplied.
    group_id UUID,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft','published','archived')),
    -- 'authored' (built from scratch) or 'registry' (materialized from a
    -- registry-generated step list as an editable starting template).
    source_runbook TEXT NOT NULL DEFAULT 'authored'
        CHECK (source_runbook IN ('authored','registry')),
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_dr_studio_runbook_group
    ON dr_studio_runbook (group_id);

CREATE TABLE IF NOT EXISTS dr_studio_task (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    runbook_id UUID NOT NULL REFERENCES dr_studio_runbook(id) ON DELETE CASCADE,
    -- stable author-facing key, unique per runbook, used by predecessors[] when an
    -- editor references a task before its UUID is known and by the registry import
    -- to preserve step identity (e.g. 'boot_member:<site_id>').
    task_key TEXT NOT NULL,
    name TEXT NOT NULL,
    task_type TEXT NOT NULL
        CHECK (task_type IN ('manual','automated','approval_gate','comms','milestone')),
    -- a milestone or comms task may be optional (not required for run completion).
    required BOOLEAN NOT NULL DEFAULT true,
    owner TEXT NOT NULL DEFAULT '',
    team TEXT NOT NULL DEFAULT '',
    instructions TEXT NOT NULL DEFAULT '',
    -- planned wall-clock duration in seconds; the critical-path / projected-finish
    -- math sums these along the longest dependency chain. >= 0.
    planned_duration_seconds INT NOT NULL DEFAULT 0
        CHECK (planned_duration_seconds >= 0),
    -- for AUTOMATED tasks: the registered action/script the Executor runs. For
    -- APPROVAL_GATE tasks: the permission required to sign off (default dr:failover).
    automation_action TEXT NOT NULL DEFAULT '',
    -- the DAG edges: task ids in the SAME runbook that must complete before this
    -- task becomes runnable. Acyclicity enforced in the application layer.
    predecessors UUID[] NOT NULL DEFAULT '{}',
    -- arbitrary structured parameters (comms recipients, automation args, ...).
    params JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (runbook_id, task_key)
);

CREATE INDEX IF NOT EXISTS idx_dr_studio_task_runbook
    ON dr_studio_task (runbook_id);

CREATE TABLE IF NOT EXISTS dr_studio_run (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    runbook_id UUID NOT NULL REFERENCES dr_studio_runbook(id) ON DELETE CASCADE,
    mode TEXT NOT NULL DEFAULT 'live'
        CHECK (mode IN ('live','rehearsal')),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','running','completed','failed','aborted')),
    -- the planned critical-path duration (seconds) computed over the task DAG at
    -- run start; the baseline projected-finish math is measured against this.
    planned_critical_path_seconds INT NOT NULL DEFAULT 0,
    started_by UUID,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    -- actual elapsed seconds at completion (completed_at - started_at).
    actual_duration_seconds INT,
    last_error TEXT,
    -- driver lease for the optional background timeout/projection loop
    -- (FOR UPDATE SKIP LOCKED), mirroring the failover.Driver pattern.
    claimed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dr_studio_run_runbook
    ON dr_studio_run (runbook_id, started_at DESC);

-- partial index for the background projection loop: only non-terminal runs.
CREATE INDEX IF NOT EXISTS idx_dr_studio_run_driver
    ON dr_studio_run (status, claimed_at)
    WHERE status IN ('pending','running');

CREATE TABLE IF NOT EXISTS dr_studio_task_run (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    run_id UUID NOT NULL REFERENCES dr_studio_run(id) ON DELETE CASCADE,
    -- the authored task this execution row tracks. ON DELETE CASCADE is safe
    -- because a run cannot start over a runbook whose tasks are being edited
    -- (the service snapshots the DAG into task-run rows at start).
    task_id UUID NOT NULL REFERENCES dr_studio_task(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','runnable','running','complete','skipped','failed','blocked')),
    -- who acted on the task (operator who completed/skipped, approver, ...).
    acted_by UUID,
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    -- elapsed seconds for this task once it reaches a terminal state.
    actual_duration_seconds INT,
    -- automation outcome / failure reason / approval note.
    detail JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- one execution row per (run, task).
    UNIQUE (run_id, task_id)
);

CREATE INDEX IF NOT EXISTS idx_dr_studio_task_run_run
    ON dr_studio_task_run (run_id, status);

-- Tenant isolation: all four tables are request-path readable/writable and carry
-- RLS, with the app.bypass_rls backstop for the (optional) leader-singleton
-- projection loop, mirroring the §7 system-path rule and the dr_db convention.
ALTER TABLE dr_studio_runbook ENABLE ROW LEVEL SECURITY;
ALTER TABLE dr_studio_runbook FORCE ROW LEVEL SECURITY;
ALTER TABLE dr_studio_task ENABLE ROW LEVEL SECURITY;
ALTER TABLE dr_studio_task FORCE ROW LEVEL SECURITY;
ALTER TABLE dr_studio_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE dr_studio_run FORCE ROW LEVEL SECURITY;
ALTER TABLE dr_studio_task_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE dr_studio_task_run FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON dr_studio_runbook;
DROP POLICY IF EXISTS tenant_insert ON dr_studio_runbook;
DROP POLICY IF EXISTS tenant_update ON dr_studio_runbook;
DROP POLICY IF EXISTS tenant_delete ON dr_studio_runbook;

DROP POLICY IF EXISTS tenant_isolation ON dr_studio_task;
DROP POLICY IF EXISTS tenant_insert ON dr_studio_task;
DROP POLICY IF EXISTS tenant_update ON dr_studio_task;
DROP POLICY IF EXISTS tenant_delete ON dr_studio_task;

DROP POLICY IF EXISTS tenant_isolation ON dr_studio_run;
DROP POLICY IF EXISTS tenant_insert ON dr_studio_run;
DROP POLICY IF EXISTS tenant_update ON dr_studio_run;
DROP POLICY IF EXISTS tenant_delete ON dr_studio_run;

DROP POLICY IF EXISTS tenant_isolation ON dr_studio_task_run;
DROP POLICY IF EXISTS tenant_insert ON dr_studio_task_run;
DROP POLICY IF EXISTS tenant_update ON dr_studio_task_run;
DROP POLICY IF EXISTS tenant_delete ON dr_studio_task_run;

CREATE POLICY tenant_isolation ON dr_studio_runbook
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_insert ON dr_studio_runbook
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_update ON dr_studio_runbook
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_delete ON dr_studio_runbook
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_isolation ON dr_studio_task
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_insert ON dr_studio_task
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_update ON dr_studio_task
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_delete ON dr_studio_task
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_isolation ON dr_studio_run
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_insert ON dr_studio_run
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_update ON dr_studio_run
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_delete ON dr_studio_run
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_isolation ON dr_studio_task_run
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_insert ON dr_studio_task_run
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_update ON dr_studio_task_run
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_delete ON dr_studio_task_run
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
