CREATE TABLE IF NOT EXISTS respond_incident_role_assignment (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    incident_id UUID NOT NULL REFERENCES respond_incident(id) ON DELETE RESTRICT,
    role TEXT NOT NULL CHECK (length(trim(role)) > 0),
    responder_id UUID NOT NULL,
    assigned_by UUID NOT NULL,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    released_by UUID,
    released_at TIMESTAMPTZ,
    release_reason TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'released')),
    source TEXT NOT NULL DEFAULT 'manual' CHECK (length(trim(source)) > 0),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    row_version INT NOT NULL DEFAULT 1 CHECK (row_version > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK ((status = 'active' AND released_at IS NULL) OR (status = 'released' AND released_at IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_respond_role_one_active_commander
    ON respond_incident_role_assignment (tenant_id, incident_id)
    WHERE role = 'incident_commander' AND status = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS idx_respond_role_unique_active_responder
    ON respond_incident_role_assignment (tenant_id, incident_id, role, responder_id)
    WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_respond_role_assignment_incident
    ON respond_incident_role_assignment (tenant_id, incident_id, status, role);

CREATE INDEX IF NOT EXISTS idx_respond_role_assignment_responder
    ON respond_incident_role_assignment (tenant_id, responder_id, status);

CREATE TABLE IF NOT EXISTS respond_incident_role_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    incident_id UUID NOT NULL REFERENCES respond_incident(id) ON DELETE RESTRICT,
    assignment_id UUID NOT NULL REFERENCES respond_incident_role_assignment(id) ON DELETE RESTRICT,
    role TEXT NOT NULL CHECK (length(trim(role)) > 0),
    responder_id UUID NOT NULL,
    actor_id UUID NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('assigned', 'released', 'reassigned')),
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_respond_role_history_incident
    ON respond_incident_role_history (tenant_id, incident_id, occurred_at, id);

CREATE INDEX IF NOT EXISTS idx_respond_role_history_assignment
    ON respond_incident_role_history (assignment_id, occurred_at);

CREATE OR REPLACE FUNCTION respond_role_history_no_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'respond incident role history is append-only';
END;
$$;

DROP TRIGGER IF EXISTS trg_respond_role_history_no_update ON respond_incident_role_history;
CREATE TRIGGER trg_respond_role_history_no_update
    BEFORE UPDATE ON respond_incident_role_history
    FOR EACH ROW EXECUTE FUNCTION respond_role_history_no_mutation();

DROP TRIGGER IF EXISTS trg_respond_role_history_no_delete ON respond_incident_role_history;
CREATE TRIGGER trg_respond_role_history_no_delete
    BEFORE DELETE ON respond_incident_role_history
    FOR EACH ROW EXECUTE FUNCTION respond_role_history_no_mutation();

CREATE TABLE IF NOT EXISTS respond_responder_directory (
    tenant_id UUID NOT NULL,
    user_id UUID NOT NULL,
    display_name TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    chat_handle TEXT NOT NULL DEFAULT '',
    team_key TEXT NOT NULL DEFAULT '',
    service_key TEXT NOT NULL DEFAULT '',
    roles JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(roles) = 'array'),
    on_call BOOLEAN NOT NULL DEFAULT false,
    escalation_rank INT NOT NULL DEFAULT 0 CHECK (escalation_rank >= 0),
    active BOOLEAN NOT NULL DEFAULT true,
    updated_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, user_id, team_key, service_key)
);

CREATE INDEX IF NOT EXISTS idx_respond_responder_directory_role
    ON respond_responder_directory USING GIN (roles);

CREATE INDEX IF NOT EXISTS idx_respond_responder_directory_team
    ON respond_responder_directory (tenant_id, team_key, active, escalation_rank);

CREATE INDEX IF NOT EXISTS idx_respond_responder_directory_service
    ON respond_responder_directory (tenant_id, service_key, active, escalation_rank);

CREATE INDEX IF NOT EXISTS idx_respond_responder_directory_on_call
    ON respond_responder_directory (tenant_id, on_call, active, escalation_rank)
    WHERE on_call = true AND active = true;

CREATE TABLE IF NOT EXISTS respond_notification_dispatch (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    incident_id UUID NOT NULL REFERENCES respond_incident(id) ON DELETE RESTRICT,
    role_assignment_id UUID REFERENCES respond_incident_role_assignment(id) ON DELETE SET NULL,
    role TEXT NOT NULL DEFAULT '',
    recipient_user_id UUID NOT NULL,
    channel TEXT NOT NULL CHECK (channel IN ('email', 'sms', 'chat', 'in_app', 'websocket', 'webhook')),
    idempotency_key TEXT NOT NULL CHECK (length(trim(idempotency_key)) > 0),
    delivery_state TEXT NOT NULL DEFAULT 'pending' CHECK (delivery_state IN ('pending', 'sent', 'failed')),
    ack_state TEXT NOT NULL DEFAULT 'not_required' CHECK (ack_state IN ('not_required', 'pending', 'acknowledged')),
    escalation_state TEXT NOT NULL DEFAULT 'none' CHECK (escalation_state IN ('none', 'waiting', 'escalated', 'stopped', 'exhausted')),
    escalation_level INT NOT NULL DEFAULT 0 CHECK (escalation_level >= 0),
    escalation_chain JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(escalation_chain) = 'array'),
    escalated_dispatch_id UUID REFERENCES respond_notification_dispatch(id) ON DELETE SET NULL,
    provider_message_id TEXT NOT NULL DEFAULT '',
    delivery_attempts INT NOT NULL DEFAULT 0 CHECK (delivery_attempts >= 0),
    last_error TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL CHECK (length(trim(title)) > 0),
    body TEXT NOT NULL CHECK (length(trim(body)) > 0),
    action_url TEXT NOT NULL DEFAULT '',
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    next_escalation_at TIMESTAMPTZ,
    escalated_at TIMESTAMPTZ,
    acknowledged_by UUID,
    acknowledged_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, idempotency_key),
    CHECK ((ack_state = 'acknowledged' AND acknowledged_at IS NOT NULL) OR ack_state <> 'acknowledged')
);

CREATE INDEX IF NOT EXISTS idx_respond_notification_incident
    ON respond_notification_dispatch (tenant_id, incident_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_respond_notification_recipient
    ON respond_notification_dispatch (tenant_id, recipient_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_respond_notification_due_escalation
    ON respond_notification_dispatch (tenant_id, next_escalation_at, id)
    WHERE ack_state = 'pending' AND escalation_state = 'waiting' AND next_escalation_at IS NOT NULL;

ALTER TABLE respond_incident_role_assignment ENABLE ROW LEVEL SECURITY;
ALTER TABLE respond_incident_role_assignment FORCE ROW LEVEL SECURITY;
ALTER TABLE respond_incident_role_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE respond_incident_role_history FORCE ROW LEVEL SECURITY;
ALTER TABLE respond_responder_directory ENABLE ROW LEVEL SECURITY;
ALTER TABLE respond_responder_directory FORCE ROW LEVEL SECURITY;
ALTER TABLE respond_notification_dispatch ENABLE ROW LEVEL SECURITY;
ALTER TABLE respond_notification_dispatch FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON respond_incident_role_assignment;
DROP POLICY IF EXISTS tenant_insert ON respond_incident_role_assignment;
DROP POLICY IF EXISTS tenant_update ON respond_incident_role_assignment;
DROP POLICY IF EXISTS tenant_delete ON respond_incident_role_assignment;

DROP POLICY IF EXISTS tenant_isolation ON respond_incident_role_history;
DROP POLICY IF EXISTS tenant_insert ON respond_incident_role_history;
DROP POLICY IF EXISTS tenant_update ON respond_incident_role_history;
DROP POLICY IF EXISTS tenant_delete ON respond_incident_role_history;

DROP POLICY IF EXISTS tenant_isolation ON respond_responder_directory;
DROP POLICY IF EXISTS tenant_insert ON respond_responder_directory;
DROP POLICY IF EXISTS tenant_update ON respond_responder_directory;
DROP POLICY IF EXISTS tenant_delete ON respond_responder_directory;

DROP POLICY IF EXISTS tenant_isolation ON respond_notification_dispatch;
DROP POLICY IF EXISTS tenant_insert ON respond_notification_dispatch;
DROP POLICY IF EXISTS tenant_update ON respond_notification_dispatch;
DROP POLICY IF EXISTS tenant_delete ON respond_notification_dispatch;

CREATE POLICY tenant_isolation ON respond_incident_role_assignment
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_insert ON respond_incident_role_assignment
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_update ON respond_incident_role_assignment
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_delete ON respond_incident_role_assignment
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_isolation ON respond_incident_role_history
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_insert ON respond_incident_role_history
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_update ON respond_incident_role_history
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_delete ON respond_incident_role_history
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_isolation ON respond_responder_directory
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_insert ON respond_responder_directory
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_update ON respond_responder_directory
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_delete ON respond_responder_directory
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_isolation ON respond_notification_dispatch
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_insert ON respond_notification_dispatch
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_update ON respond_notification_dispatch
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_delete ON respond_notification_dispatch
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
