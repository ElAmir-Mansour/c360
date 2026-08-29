-- Policy-backed, multi-party failover approvals.
CREATE TABLE IF NOT EXISTS dr_approval_policy (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    operation TEXT NOT NULL CHECK (operation IN ('failover')),
    mode TEXT NOT NULL CHECK (mode IN ('real','drill')),
    quorum INT NOT NULL CHECK (quorum >= 1),
    require_reason BOOLEAN NOT NULL DEFAULT false,
    prevent_initiator_approval BOOLEAN NOT NULL DEFAULT false,
    require_step_up BOOLEAN NOT NULL DEFAULT false,
    step_up_max_age_seconds INT NOT NULL DEFAULT 300 CHECK (step_up_max_age_seconds > 0),
    allow_break_glass BOOLEAN NOT NULL DEFAULT true,
    break_glass_requires_reason BOOLEAN NOT NULL DEFAULT true,
    break_glass_requires_step_up BOOLEAN NOT NULL DEFAULT true,
    break_glass_min_approvers INT NOT NULL DEFAULT 2 CHECK (break_glass_min_approvers >= 1),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, operation, mode)
);

CREATE TABLE IF NOT EXISTS dr_failover_approval (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    run_id UUID NOT NULL REFERENCES failover_run(id) ON DELETE CASCADE,
    approver_id UUID NOT NULL,
    decision TEXT NOT NULL CHECK (decision IN ('approve','reject')),
    reason TEXT NOT NULL DEFAULT '',
    break_glass BOOLEAN NOT NULL DEFAULT false,
    step_up_verified_at TIMESTAMPTZ,
    decided_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, run_id, approver_id)
);
CREATE INDEX IF NOT EXISTS idx_dr_failover_approval_run_decision
    ON dr_failover_approval (tenant_id, run_id, decision, decided_at);

CREATE TABLE IF NOT EXISTS dr_break_glass_event (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    run_id UUID NOT NULL REFERENCES failover_run(id) ON DELETE CASCADE,
    approval_id UUID NOT NULL REFERENCES dr_failover_approval(id) ON DELETE RESTRICT,
    actor_id UUID NOT NULL,
    reason_hash TEXT NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, approval_id)
);
CREATE INDEX IF NOT EXISTS idx_dr_break_glass_event_run
    ON dr_break_glass_event (tenant_id, run_id, recorded_at);

CREATE OR REPLACE FUNCTION dr_failover_approval_append_only()
RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'dr_failover_approval is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_dr_failover_approval_append_only ON dr_failover_approval;
CREATE TRIGGER trg_dr_failover_approval_append_only
    BEFORE UPDATE OR DELETE ON dr_failover_approval
    FOR EACH ROW EXECUTE FUNCTION dr_failover_approval_append_only();

CREATE OR REPLACE FUNCTION dr_break_glass_event_append_only()
RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'dr_break_glass_event is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_dr_break_glass_event_append_only ON dr_break_glass_event;
CREATE TRIGGER trg_dr_break_glass_event_append_only
    BEFORE UPDATE OR DELETE ON dr_break_glass_event
    FOR EACH ROW EXECUTE FUNCTION dr_break_glass_event_append_only();

ALTER TABLE dr_approval_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE dr_approval_policy FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON dr_approval_policy;
DROP POLICY IF EXISTS tenant_insert ON dr_approval_policy;
DROP POLICY IF EXISTS tenant_update ON dr_approval_policy;
DROP POLICY IF EXISTS tenant_delete ON dr_approval_policy;
CREATE POLICY tenant_isolation ON dr_approval_policy
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_insert ON dr_approval_policy
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_update ON dr_approval_policy
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_delete ON dr_approval_policy
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

ALTER TABLE dr_failover_approval ENABLE ROW LEVEL SECURITY;
ALTER TABLE dr_failover_approval FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON dr_failover_approval;
DROP POLICY IF EXISTS tenant_insert ON dr_failover_approval;
CREATE POLICY tenant_isolation ON dr_failover_approval
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_insert ON dr_failover_approval
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

ALTER TABLE dr_break_glass_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE dr_break_glass_event FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON dr_break_glass_event;
DROP POLICY IF EXISTS tenant_insert ON dr_break_glass_event;
CREATE POLICY tenant_isolation ON dr_break_glass_event
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_insert ON dr_break_glass_event
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
