-- =============================================================================
-- Automation engine schema — automation_db (DESIGN_Workflow_Forms_Automation.md
-- §4, §7; WP-8).
--
-- An automation binds a trigger (event/schedule/threshold/manual/webhook) to a
-- set of priority-ordered rules and a multi-step runbook. Firing an automation
-- creates a durable automation_runs row that the leader-singleton orchestrator
-- (WP-11) drives step by step through an idempotent, restart-safe FSM (§6);
-- every step is appended to automation_run_steps so a completed run can be
-- replayed from recorded inputs (§4.7). Approval gates park the run in
-- AWAITING_APPROVAL until a human decision resolves the automation_approval_gates
-- row.
--
-- Tenant-scoped tables carry tenant_id and get FULL per-operation RLS (4 policies
-- + the app.bypass_rls backstop), cloned from migrations/dr_db/000001 /
-- migrations/platform_core/000002_rls. The leader-singleton run driver is the
-- ONLY component that reads across tenants, and it does so on automation_runs via
-- the documented system query path (repository.SystemClaimRunnableRuns,
-- "background-loop only; bypasses tenant RLS by design"). Like the event outbox,
-- automation_runs is therefore RLS-enabled but the driver runs with
-- app.bypass_rls = on; every request-path query filters by tenant AND sets
-- SET LOCAL app.current_tenant_id so RLS is the backstop.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- A runbook: the ordered list of steps an automation executes.
CREATE TABLE IF NOT EXISTS automation_runbooks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, name)
);

-- One ordered step in a runbook: an action or a human approval gate.
CREATE TABLE IF NOT EXISTS automation_runbook_steps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    runbook_id UUID NOT NULL REFERENCES automation_runbooks(id) ON DELETE CASCADE,
    step_index INT NOT NULL,                    -- 0-based position
    step_type TEXT NOT NULL CHECK (step_type IN ('action','approval_gate')),
    action JSONB NOT NULL DEFAULT '{}'::jsonb,  -- ActionRef{kind,config} for action steps
    approver_roles TEXT[] NOT NULL DEFAULT '{}',-- approval_gate: roles that may decide
    quorum INT NOT NULL DEFAULT 1,              -- approvals needed
    timeout_seconds INT NOT NULL DEFAULT 0,     -- 0 = no timeout
    timeout_action TEXT NOT NULL DEFAULT 'escalate'
        CHECK (timeout_action IN ('abort','escalate','auto_approve')),
    UNIQUE (runbook_id, step_index)
);

-- An automation: the trigger→rules→runbook binding.
CREATE TABLE IF NOT EXISTS automations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    name TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT true,
    trigger JSONB NOT NULL,                     -- TriggerConfig
    runbook_id UUID NOT NULL REFERENCES automation_runbooks(id),
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, name)
);
-- Trigger sources (WP-9) list enabled automations by trigger type/topic.
CREATE INDEX IF NOT EXISTS idx_automations_enabled
    ON automations (tenant_id, enabled);

-- Priority-ordered rules for an automation (FR-AUTOMATION-002).
CREATE TABLE IF NOT EXISTS automation_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    automation_id UUID NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
    priority INT NOT NULL DEFAULT 100,          -- lower = higher precedence
    when_conditions JSONB NOT NULL DEFAULT '[]'::jsonb, -- []Condition (DSL expressions)
    action JSONB NOT NULL,                      -- ActionRef
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_automation_rules_eval
    ON automation_rules (automation_id, priority);

-- The durable FSM run (§6). source_event_id is the exactly-once backstop:
-- a given trigger occurrence creates at most one run per tenant. replay_of
-- carries the lineage when a run is a replay of an earlier completed run (§4.7).
CREATE TABLE IF NOT EXISTS automation_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    automation_id UUID NOT NULL REFERENCES automations(id),
    runbook_id UUID NOT NULL REFERENCES automation_runbooks(id),
    status TEXT NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING','RUNNING','AWAITING_APPROVAL','ESCALATED',
                          'COMPLETED','FAILED','ABORTED','CANCELLED')),
    source_event_id TEXT NOT NULL,             -- stable id of the trigger occurrence
    replay_of UUID REFERENCES automation_runs(id),
    current_step INT NOT NULL DEFAULT 0,       -- index of the next step to run
    trigger JSONB NOT NULL DEFAULT '{}'::jsonb,-- recorded trigger payload (replay input)
    variables JSONB NOT NULL DEFAULT '{}'::jsonb,
    last_error TEXT,
    claimed_at TIMESTAMPTZ,                     -- driver lease (FOR UPDATE SKIP LOCKED)
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Exactly-once backstop (§4.3): a trigger occurrence fires at most one run
    -- per tenant even if the idempotency guard is unavailable.
    UNIQUE (tenant_id, source_event_id)
);
-- The leader driver's claim query. Partial index excludes the parked/escalated
-- and terminal states: an approval gate NEVER auto-advances (§6), so the driver
-- must not claim AWAITING_APPROVAL/ESCALATED runs.
CREATE INDEX IF NOT EXISTS idx_automation_runs_driver
    ON automation_runs (status, claimed_at)
    WHERE status IN ('PENDING','RUNNING');

-- Append-only execution log (§4.7). UNIQUE(run_id, step_index) makes a
-- crash-restart re-execution idempotent: the driver Ensures-not-Creates a step,
-- so a re-claimed run never double-fires an action. input records the resolved
-- config + trigger payload so a replay re-executes from recorded inputs.
CREATE TABLE IF NOT EXISTS automation_run_steps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    run_id UUID NOT NULL REFERENCES automation_runs(id) ON DELETE CASCADE,
    step_index INT NOT NULL,
    action JSONB NOT NULL DEFAULT '{}'::jsonb, -- ActionRef executed (or gate marker)
    input JSONB NOT NULL DEFAULT '{}'::jsonb,  -- recorded inputs for replay
    output JSONB NOT NULL DEFAULT '{}'::jsonb, -- target response
    status TEXT NOT NULL DEFAULT 'RUNNING'
        CHECK (status IN ('RUNNING','OK','FAILED','AWAITING','APPROVED','REJECTED','SKIPPED')),
    attempt INT NOT NULL DEFAULT 1,
    error TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ,
    UNIQUE (run_id, step_index)
);

-- The parked human-decision record for an approval_gate step (§4.5). The run
-- sits in AWAITING_APPROVAL and the driver's claim query excludes it until a
-- human decision (or the timeout sweeper) resolves this gate and moves the run
-- back to RUNNING. decisions is an append-only array of votes.
CREATE TABLE IF NOT EXISTS automation_approval_gates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    run_id UUID NOT NULL REFERENCES automation_runs(id) ON DELETE CASCADE,
    step_index INT NOT NULL,
    status TEXT NOT NULL DEFAULT 'OPEN'
        CHECK (status IN ('OPEN','APPROVED','REJECTED','ESCALATED','EXPIRED')),
    quorum INT NOT NULL DEFAULT 1,
    decisions JSONB NOT NULL DEFAULT '[]'::jsonb,
    opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deadline_at TIMESTAMPTZ,
    resolved_at TIMESTAMPTZ,
    UNIQUE (run_id, step_index)
);
-- The gate timeout sweeper scans OPEN gates with a deadline.
CREATE INDEX IF NOT EXISTS idx_approval_gates_sweep
    ON automation_approval_gates (deadline_at)
    WHERE status = 'OPEN';

-- =============================================================================
-- Row-Level Security on tenant-scoped tables.
-- Pattern cloned from migrations/dr_db/000001 / platform_core/000002_rls
-- (4 policies + app.bypass_rls backstop). The application sets
-- SET LOCAL app.current_tenant_id = '<uuid>' per request; the migration role
-- must hold BYPASSRLS. The leader run-driver reads automation_runs across
-- tenants via the documented system query path (SystemClaimRunnableRuns) with
-- app.bypass_rls = on — automation_runs still has RLS enabled so the request
-- path stays isolated.
-- =============================================================================

-- automation_runbooks
ALTER TABLE automation_runbooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_runbooks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON automation_runbooks;
DROP POLICY IF EXISTS tenant_insert ON automation_runbooks;
DROP POLICY IF EXISTS tenant_update ON automation_runbooks;
DROP POLICY IF EXISTS tenant_delete ON automation_runbooks;
CREATE POLICY tenant_isolation ON automation_runbooks
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_insert ON automation_runbooks
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_update ON automation_runbooks
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_delete ON automation_runbooks
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

-- automation_runbook_steps
ALTER TABLE automation_runbook_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_runbook_steps FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON automation_runbook_steps;
DROP POLICY IF EXISTS tenant_insert ON automation_runbook_steps;
DROP POLICY IF EXISTS tenant_update ON automation_runbook_steps;
DROP POLICY IF EXISTS tenant_delete ON automation_runbook_steps;
CREATE POLICY tenant_isolation ON automation_runbook_steps
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_insert ON automation_runbook_steps
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_update ON automation_runbook_steps
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_delete ON automation_runbook_steps
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

-- automations
ALTER TABLE automations ENABLE ROW LEVEL SECURITY;
ALTER TABLE automations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON automations;
DROP POLICY IF EXISTS tenant_insert ON automations;
DROP POLICY IF EXISTS tenant_update ON automations;
DROP POLICY IF EXISTS tenant_delete ON automations;
CREATE POLICY tenant_isolation ON automations
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_insert ON automations
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_update ON automations
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_delete ON automations
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

-- automation_rules
ALTER TABLE automation_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_rules FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON automation_rules;
DROP POLICY IF EXISTS tenant_insert ON automation_rules;
DROP POLICY IF EXISTS tenant_update ON automation_rules;
DROP POLICY IF EXISTS tenant_delete ON automation_rules;
CREATE POLICY tenant_isolation ON automation_rules
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_insert ON automation_rules
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_update ON automation_rules
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_delete ON automation_rules
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

-- automation_runs (RLS enabled; the driver bypasses via app.bypass_rls = on)
ALTER TABLE automation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_runs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON automation_runs;
DROP POLICY IF EXISTS tenant_insert ON automation_runs;
DROP POLICY IF EXISTS tenant_update ON automation_runs;
DROP POLICY IF EXISTS tenant_delete ON automation_runs;
CREATE POLICY tenant_isolation ON automation_runs
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_insert ON automation_runs
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_update ON automation_runs
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_delete ON automation_runs
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

-- automation_run_steps
ALTER TABLE automation_run_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_run_steps FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON automation_run_steps;
DROP POLICY IF EXISTS tenant_insert ON automation_run_steps;
DROP POLICY IF EXISTS tenant_update ON automation_run_steps;
DROP POLICY IF EXISTS tenant_delete ON automation_run_steps;
CREATE POLICY tenant_isolation ON automation_run_steps
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_insert ON automation_run_steps
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_update ON automation_run_steps
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_delete ON automation_run_steps
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

-- automation_approval_gates
ALTER TABLE automation_approval_gates ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_approval_gates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON automation_approval_gates;
DROP POLICY IF EXISTS tenant_insert ON automation_approval_gates;
DROP POLICY IF EXISTS tenant_update ON automation_approval_gates;
DROP POLICY IF EXISTS tenant_delete ON automation_approval_gates;
CREATE POLICY tenant_isolation ON automation_approval_gates
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_insert ON automation_approval_gates
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_update ON automation_approval_gates
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_delete ON automation_approval_gates
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

-- =============================================================================
-- Transactional event outbox: automation lifecycle events (run.started,
-- run.step.completed, run.awaiting_approval, run.completed, run.failed,
-- rule.matched) are staged in the same transaction as the state change (§8).
-- Definition copied verbatim from migrations/dr_db/000001_init_schema.up.sql
-- (mirrors platform_core/000015_event_outbox). NOT RLS-forced: the relay claims
-- rows across tenants, no tenant-facing API reads it directly.
-- =============================================================================
CREATE TABLE IF NOT EXISTS event_outbox (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id        UUID        NOT NULL UNIQUE,
    tenant_id       UUID        NOT NULL,
    topic           TEXT        NOT NULL,
    event_type      TEXT        NOT NULL,
    payload         JSONB       NOT NULL,
    status          TEXT        NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'publishing', 'published', 'failed')),
    attempts        INT         NOT NULL DEFAULT 0,
    last_error      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    claimed_at      TIMESTAMPTZ,
    published_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_event_outbox_claim
    ON event_outbox (next_attempt_at, created_at)
    WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_event_outbox_stuck
    ON event_outbox (claimed_at)
    WHERE status = 'publishing';

CREATE INDEX IF NOT EXISTS idx_event_outbox_purge
    ON event_outbox (published_at)
    WHERE status = 'published';

CREATE INDEX IF NOT EXISTS idx_event_outbox_failed
    ON event_outbox (tenant_id, created_at)
    WHERE status = 'failed';
