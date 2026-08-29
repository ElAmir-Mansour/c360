CREATE TABLE IF NOT EXISTS respond_stakeholder_update_dispatch (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    incident_id UUID NOT NULL REFERENCES respond_incident(id) ON DELETE RESTRICT,
    reason TEXT NOT NULL CHECK (reason IN ('periodic','triggered','manual')),
    channel TEXT NOT NULL CHECK (length(trim(channel)) > 0),
    recipient_ref TEXT NOT NULL DEFAULT '',
    subject TEXT NOT NULL CHECK (length(trim(subject)) > 0),
    body TEXT NOT NULL CHECK (length(trim(body)) > 0),
    incident_row_version INT NOT NULL CHECK (incident_row_version > 0),
    timeline_event_count INT NOT NULL CHECK (timeline_event_count >= 0),
    source_timeline_event_id UUID REFERENCES respond_incident_timeline_event(id) ON DELETE RESTRICT,
    next_update_at TIMESTAMPTZ,
    status TEXT NOT NULL CHECK (status IN ('sent','failed')),
    receipt_ref TEXT NOT NULL DEFAULT '',
    dispatched_by UUID NOT NULL,
    dispatched_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_respond_stakeholder_update_incident_time
    ON respond_stakeholder_update_dispatch (tenant_id, incident_id, dispatched_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_respond_stakeholder_update_source_event
    ON respond_stakeholder_update_dispatch (tenant_id, source_timeline_event_id)
    WHERE source_timeline_event_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS respond_incident_approval (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    incident_id UUID NOT NULL REFERENCES respond_incident(id) ON DELETE RESTRICT,
    action TEXT NOT NULL CHECK (length(trim(action)) > 0),
    action_key TEXT NOT NULL DEFAULT '',
    requested_by UUID NOT NULL,
    requested_at TIMESTAMPTZ NOT NULL,
    required_role TEXT CHECK (
        required_role IS NULL OR required_role IN (
            'incident_commander',
            'communications_lead',
            'technical_lead',
            'subject_matter_expert',
            'scribe',
            'stakeholder_liaison',
            'resolver'
        )
    ),
    decision TEXT NOT NULL DEFAULT 'pending' CHECK (decision IN ('pending','approved','rejected','cancelled')),
    decided_by UUID,
    decided_at TIMESTAMPTZ,
    decision_reason TEXT NOT NULL DEFAULT '',
    workflow_system TEXT NOT NULL DEFAULT '',
    workflow_instance_id TEXT NOT NULL DEFAULT '',
    workflow_task_id TEXT NOT NULL DEFAULT '',
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (
        (decision = 'pending' AND decided_by IS NULL AND decided_at IS NULL)
        OR
        (decision <> 'pending' AND decided_by IS NOT NULL AND decided_at IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_respond_incident_approval_incident_time
    ON respond_incident_approval (tenant_id, incident_id, requested_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_respond_incident_approval_action
    ON respond_incident_approval (tenant_id, incident_id, action, action_key, decision, decided_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_respond_incident_approval_pending_action
    ON respond_incident_approval (tenant_id, incident_id, action, action_key)
    WHERE decision = 'pending';

ALTER TABLE respond_stakeholder_update_dispatch ENABLE ROW LEVEL SECURITY;
ALTER TABLE respond_stakeholder_update_dispatch FORCE ROW LEVEL SECURITY;
ALTER TABLE respond_incident_approval ENABLE ROW LEVEL SECURITY;
ALTER TABLE respond_incident_approval FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON respond_stakeholder_update_dispatch;
DROP POLICY IF EXISTS tenant_insert ON respond_stakeholder_update_dispatch;
DROP POLICY IF EXISTS tenant_update ON respond_stakeholder_update_dispatch;
DROP POLICY IF EXISTS tenant_delete ON respond_stakeholder_update_dispatch;

DROP POLICY IF EXISTS tenant_isolation ON respond_incident_approval;
DROP POLICY IF EXISTS tenant_insert ON respond_incident_approval;
DROP POLICY IF EXISTS tenant_update ON respond_incident_approval;
DROP POLICY IF EXISTS tenant_delete ON respond_incident_approval;

CREATE POLICY tenant_isolation ON respond_stakeholder_update_dispatch
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_insert ON respond_stakeholder_update_dispatch
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_update ON respond_stakeholder_update_dispatch
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_delete ON respond_stakeholder_update_dispatch
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_isolation ON respond_incident_approval
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_insert ON respond_incident_approval
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_update ON respond_incident_approval
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_delete ON respond_incident_approval
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
