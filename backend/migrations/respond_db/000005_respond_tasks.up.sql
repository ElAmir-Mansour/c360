CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS respond_task_template (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID,
    scope TEXT NOT NULL CHECK (scope IN ('global','tenant')),
    template_key TEXT NOT NULL CHECK (length(trim(template_key)) > 0),
    incident_type TEXT NOT NULL CHECK (length(trim(incident_type)) > 0),
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    description TEXT NOT NULL DEFAULT '',
    version INT NOT NULL DEFAULT 1 CHECK (version > 0),
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (
        (scope = 'global' AND tenant_id IS NULL) OR
        (scope = 'tenant' AND tenant_id IS NOT NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_respond_task_template_global_key_version
    ON respond_task_template (template_key, version)
    WHERE scope = 'global';

CREATE UNIQUE INDEX IF NOT EXISTS idx_respond_task_template_tenant_key_version
    ON respond_task_template (tenant_id, template_key, version)
    WHERE scope = 'tenant';

CREATE INDEX IF NOT EXISTS idx_respond_task_template_incident_type
    ON respond_task_template (scope, tenant_id, incident_type, active);

CREATE TABLE IF NOT EXISTS respond_task_template_step (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id UUID NOT NULL REFERENCES respond_task_template(id) ON DELETE CASCADE,
    step_key TEXT NOT NULL CHECK (length(trim(step_key)) > 0),
    position INT NOT NULL CHECK (position >= 0),
    title TEXT NOT NULL CHECK (length(trim(title)) > 0),
    description TEXT NOT NULL DEFAULT '',
    task_type TEXT NOT NULL CHECK (task_type IN ('manual','automated','approval_gate','comms','milestone')),
    required BOOLEAN NOT NULL DEFAULT true,
    owner_role TEXT NOT NULL DEFAULT '',
    team TEXT NOT NULL DEFAULT '',
    due_offset_seconds INT NOT NULL DEFAULT 0 CHECK (due_offset_seconds >= 0),
    planned_duration_seconds INT NOT NULL DEFAULT 0 CHECK (planned_duration_seconds >= 0),
    automation_action TEXT NOT NULL DEFAULT '',
    params JSONB NOT NULL DEFAULT '{}'::jsonb,
    predecessors TEXT[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (template_id, step_key),
    UNIQUE (template_id, position)
);

CREATE INDEX IF NOT EXISTS idx_respond_task_template_step_template
    ON respond_task_template_step (template_id, position);

CREATE TABLE IF NOT EXISTS respond_incident_task (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    incident_id UUID NOT NULL REFERENCES respond_incident(id) ON DELETE RESTRICT,
    template_step_id UUID REFERENCES respond_task_template_step(id) ON DELETE SET NULL,
    task_key TEXT NOT NULL CHECK (length(trim(task_key)) > 0),
    title TEXT NOT NULL CHECK (length(trim(title)) > 0),
    description TEXT NOT NULL DEFAULT '',
    task_type TEXT NOT NULL CHECK (task_type IN ('manual','automated','approval_gate','comms','milestone')),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','runnable','running','complete','skipped','failed','blocked')),
    required BOOLEAN NOT NULL DEFAULT true,
    position INT NOT NULL DEFAULT 0 CHECK (position >= 0),
    owner_id UUID,
    owner_role TEXT NOT NULL DEFAULT '',
    team TEXT NOT NULL DEFAULT '',
    due_at TIMESTAMPTZ,
    planned_duration_seconds INT NOT NULL DEFAULT 0 CHECK (planned_duration_seconds >= 0),
    automation_action TEXT NOT NULL DEFAULT '',
    params JSONB NOT NULL DEFAULT '{}'::jsonb,
    scope JSONB NOT NULL DEFAULT '{}'::jsonb,
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    actual_duration_seconds INT CHECK (actual_duration_seconds IS NULL OR actual_duration_seconds >= 0),
    acted_by UUID,
    created_by UUID NOT NULL,
    row_version INT NOT NULL DEFAULT 1 CHECK (row_version > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (incident_id, task_key),
    UNIQUE (tenant_id, incident_id, id)
);

CREATE INDEX IF NOT EXISTS idx_respond_incident_task_incident_order
    ON respond_incident_task (tenant_id, incident_id, position, created_at, id);

CREATE INDEX IF NOT EXISTS idx_respond_incident_task_status
    ON respond_incident_task (tenant_id, incident_id, status, due_at);

CREATE INDEX IF NOT EXISTS idx_respond_incident_task_owner
    ON respond_incident_task (tenant_id, incident_id, owner_id)
    WHERE owner_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS respond_incident_task_dependency (
    tenant_id UUID NOT NULL,
    incident_id UUID NOT NULL,
    task_id UUID NOT NULL,
    depends_on_task_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (task_id, depends_on_task_id),
    CHECK (task_id <> depends_on_task_id),
    FOREIGN KEY (tenant_id, incident_id, task_id)
        REFERENCES respond_incident_task(tenant_id, incident_id, id)
        ON DELETE CASCADE,
    FOREIGN KEY (tenant_id, incident_id, depends_on_task_id)
        REFERENCES respond_incident_task(tenant_id, incident_id, id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_respond_task_dependency_incident
    ON respond_incident_task_dependency (tenant_id, incident_id, task_id);

CREATE INDEX IF NOT EXISTS idx_respond_task_dependency_predecessor
    ON respond_incident_task_dependency (tenant_id, incident_id, depends_on_task_id);

CREATE TABLE IF NOT EXISTS respond_incident_task_assignment (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    incident_id UUID NOT NULL,
    task_id UUID NOT NULL,
    assignee_id UUID,
    assignee_role TEXT NOT NULL DEFAULT '',
    team TEXT NOT NULL DEFAULT '',
    assigned_by UUID NOT NULL,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    note TEXT NOT NULL DEFAULT '',
    FOREIGN KEY (tenant_id, incident_id, task_id)
        REFERENCES respond_incident_task(tenant_id, incident_id, id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_respond_task_assignment_task
    ON respond_incident_task_assignment (tenant_id, incident_id, task_id, assigned_at DESC);

CREATE TABLE IF NOT EXISTS respond_incident_task_status_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    incident_id UUID NOT NULL,
    task_id UUID NOT NULL,
    from_status TEXT CHECK (from_status IS NULL OR from_status IN ('pending','runnable','running','complete','skipped','failed','blocked')),
    to_status TEXT NOT NULL CHECK (to_status IN ('pending','runnable','running','complete','skipped','failed','blocked')),
    changed_by UUID NOT NULL,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    note TEXT NOT NULL DEFAULT '',
    detail JSONB NOT NULL DEFAULT '{}'::jsonb,
    FOREIGN KEY (tenant_id, incident_id, task_id)
        REFERENCES respond_incident_task(tenant_id, incident_id, id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_respond_task_status_history_task
    ON respond_incident_task_status_history (tenant_id, incident_id, task_id, changed_at DESC);

CREATE OR REPLACE FUNCTION respond_task_history_no_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'respond task history is append-only';
END;
$$;

DROP TRIGGER IF EXISTS trg_respond_task_assignment_no_update ON respond_incident_task_assignment;
CREATE TRIGGER trg_respond_task_assignment_no_update
    BEFORE UPDATE ON respond_incident_task_assignment
    FOR EACH ROW EXECUTE FUNCTION respond_task_history_no_mutation();

DROP TRIGGER IF EXISTS trg_respond_task_assignment_no_delete ON respond_incident_task_assignment;
CREATE TRIGGER trg_respond_task_assignment_no_delete
    BEFORE DELETE ON respond_incident_task_assignment
    FOR EACH ROW EXECUTE FUNCTION respond_task_history_no_mutation();

DROP TRIGGER IF EXISTS trg_respond_task_status_no_update ON respond_incident_task_status_history;
CREATE TRIGGER trg_respond_task_status_no_update
    BEFORE UPDATE ON respond_incident_task_status_history
    FOR EACH ROW EXECUTE FUNCTION respond_task_history_no_mutation();

DROP TRIGGER IF EXISTS trg_respond_task_status_no_delete ON respond_incident_task_status_history;
CREATE TRIGGER trg_respond_task_status_no_delete
    BEFORE DELETE ON respond_incident_task_status_history
    FOR EACH ROW EXECUTE FUNCTION respond_task_history_no_mutation();

INSERT INTO respond_task_template (id, scope, template_key, incident_type, name, description, version, active)
VALUES
    ('10000000-0000-4000-8000-000000000001', 'global', 'payment-outage', 'payment-outage',
     'Payment outage response', 'Coordinated response graph for card, wallet, or settlement payment outages.', 1, true),
    ('10000000-0000-4000-8000-000000000002', 'global', 'region-failover', 'region-failover',
     'Region failover response', 'Coordinated response graph for regional service evacuation and recovery verification.', 1, true)
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description,
    active = EXCLUDED.active,
    updated_at = now();

INSERT INTO respond_task_template_step (
    id, template_id, step_key, position, title, description, task_type, required,
    owner_role, team, due_offset_seconds, planned_duration_seconds, automation_action,
    params, predecessors
)
VALUES
    ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
     'open-command-bridge', 10, 'Open command bridge',
     'Create the response bridge, confirm commander/scribe coverage, and pin the incident reference.',
     'manual', true, 'incident_commander', 'incident-command', 300, 300, '',
     '{"channel":"incident-command"}'::jsonb, '{}'),
    ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001',
     'freeze-risky-deployments', 20, 'Freeze risky deployments',
     'Pause payment-adjacent deploys and record the change-freeze owner.',
     'manual', true, 'technical_lead', 'payments-platform', 600, 300, '',
     '{"change_window":"incident-freeze"}'::jsonb, ARRAY['open-command-bridge']),
    ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001',
     'assess-payment-impact', 30, 'Assess payment impact',
     'Quantify affected payment methods, regions, transaction decline rate, and settlement exposure.',
     'manual', true, 'technical_lead', 'payments-platform', 900, 600, '',
     '{"metrics":["auth_decline_rate","capture_latency","settlement_queue_depth"]}'::jsonb, ARRAY['open-command-bridge']),
    ('20000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001',
     'notify-stakeholders', 40, 'Send stakeholder update',
     'Publish the first stakeholder update with impact, workaround, and next-update time.',
     'comms', true, 'communications_lead', 'communications', 1200, 300, '',
     '{"audience":"internal-executive-and-customer-success"}'::jsonb, ARRAY['assess-payment-impact']),
    ('20000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001',
     'decision-rollback-or-failover', 50, 'Decide rollback or failover path',
     'Commander records the mitigation decision after impact and deployment risk are understood.',
     'approval_gate', true, 'incident_commander', 'incident-command', 1500, 300, 'respond:incident:transition',
     '{"decision_options":["rollback","processor-failover","traffic-shift","feature-disable"]}'::jsonb,
     ARRAY['freeze-risky-deployments','assess-payment-impact']),
    ('20000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000001',
     'execute-mitigation', 60, 'Execute selected mitigation',
     'Run the selected mitigation and record commands, ticket references, and observed outcome.',
     'manual', true, 'technical_lead', 'payments-platform', 2400, 900, '',
     '{"requires_decision":"decision-rollback-or-failover"}'::jsonb, ARRAY['decision-rollback-or-failover']),
    ('20000000-0000-4000-8000-000000000007', '10000000-0000-4000-8000-000000000001',
     'verify-recovery', 70, 'Verify payment recovery',
     'Confirm payment success rate, queue drain, and customer-facing recovery signals.',
     'manual', true, 'resolver', 'payments-platform', 3000, 600, '',
     '{"success_metrics":["auth_success_rate","queue_depth","synthetic_checkout"]}'::jsonb, ARRAY['execute-mitigation']),
    ('20000000-0000-4000-8000-000000000008', '10000000-0000-4000-8000-000000000001',
     'send-resolution-update', 80, 'Send resolution update',
     'Publish resolution state, residual risk, and post-incident review expectations.',
     'comms', false, 'communications_lead', 'communications', 3600, 300, '',
     '{"audience":"stakeholders"}'::jsonb, ARRAY['verify-recovery']),
    ('20000000-0000-4000-8000-000000000101', '10000000-0000-4000-8000-000000000002',
     'confirm-regional-impact', 10, 'Confirm regional impact',
     'Confirm affected region, entrypoint symptoms, data-plane health, and blast radius.',
     'manual', true, 'technical_lead', 'platform', 300, 300, '',
     '{"scope":"regional"}'::jsonb, '{}'),
    ('20000000-0000-4000-8000-000000000102', '10000000-0000-4000-8000-000000000002',
     'prepare-failover-comms', 20, 'Prepare failover communications',
     'Prepare internal and stakeholder wording before traffic movement starts.',
     'comms', false, 'communications_lead', 'communications', 600, 300, '',
     '{"audience":"internal-and-stakeholder"}'::jsonb, ARRAY['confirm-regional-impact']),
    ('20000000-0000-4000-8000-000000000103', '10000000-0000-4000-8000-000000000002',
     'approve-region-failover', 30, 'Approve region failover',
     'Commander approves regional failover after impact, data health, and rollback path are confirmed.',
     'approval_gate', true, 'incident_commander', 'incident-command', 900, 300, 'respond:incident:transition',
     '{"decision_options":["failover","hold","partial-traffic-shift"]}'::jsonb, ARRAY['confirm-regional-impact']),
    ('20000000-0000-4000-8000-000000000104', '10000000-0000-4000-8000-000000000002',
     'shift-regional-traffic', 40, 'Shift regional traffic',
     'Execute the approved traffic movement and capture router, DNS, and load-balancer evidence.',
     'automated', true, 'technical_lead', 'platform', 1500, 900, 'respond.region_failover.shift_traffic',
     '{"requires_decision":"approve-region-failover"}'::jsonb, ARRAY['approve-region-failover']),
    ('20000000-0000-4000-8000-000000000105', '10000000-0000-4000-8000-000000000002',
     'verify-failover-health', 50, 'Verify failover health',
     'Confirm traffic, data freshness, synthetic journeys, and error budget after failover.',
     'manual', true, 'resolver', 'platform', 2400, 600, '',
     '{"success_metrics":["traffic_distribution","replication_lag","synthetic_journey"]}'::jsonb, ARRAY['shift-regional-traffic']),
    ('20000000-0000-4000-8000-000000000106', '10000000-0000-4000-8000-000000000002',
     'publish-failover-state', 60, 'Publish failover state',
     'Publish operational state, customer impact, and next validation checkpoint.',
     'comms', false, 'communications_lead', 'communications', 3000, 300, '',
     '{"audience":"stakeholders"}'::jsonb, ARRAY['verify-failover-health'])
ON CONFLICT (template_id, step_key) DO UPDATE
SET position = EXCLUDED.position,
    title = EXCLUDED.title,
    description = EXCLUDED.description,
    task_type = EXCLUDED.task_type,
    required = EXCLUDED.required,
    owner_role = EXCLUDED.owner_role,
    team = EXCLUDED.team,
    due_offset_seconds = EXCLUDED.due_offset_seconds,
    planned_duration_seconds = EXCLUDED.planned_duration_seconds,
    automation_action = EXCLUDED.automation_action,
    params = EXCLUDED.params,
    predecessors = EXCLUDED.predecessors;

ALTER TABLE respond_task_template ENABLE ROW LEVEL SECURITY;
ALTER TABLE respond_task_template FORCE ROW LEVEL SECURITY;
ALTER TABLE respond_task_template_step ENABLE ROW LEVEL SECURITY;
ALTER TABLE respond_task_template_step FORCE ROW LEVEL SECURITY;
ALTER TABLE respond_incident_task ENABLE ROW LEVEL SECURITY;
ALTER TABLE respond_incident_task FORCE ROW LEVEL SECURITY;
ALTER TABLE respond_incident_task_dependency ENABLE ROW LEVEL SECURITY;
ALTER TABLE respond_incident_task_dependency FORCE ROW LEVEL SECURITY;
ALTER TABLE respond_incident_task_assignment ENABLE ROW LEVEL SECURITY;
ALTER TABLE respond_incident_task_assignment FORCE ROW LEVEL SECURITY;
ALTER TABLE respond_incident_task_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE respond_incident_task_status_history FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS template_select ON respond_task_template;
DROP POLICY IF EXISTS template_insert ON respond_task_template;
DROP POLICY IF EXISTS template_update ON respond_task_template;
DROP POLICY IF EXISTS template_delete ON respond_task_template;

DROP POLICY IF EXISTS template_step_select ON respond_task_template_step;
DROP POLICY IF EXISTS template_step_insert ON respond_task_template_step;
DROP POLICY IF EXISTS template_step_update ON respond_task_template_step;
DROP POLICY IF EXISTS template_step_delete ON respond_task_template_step;

DROP POLICY IF EXISTS tenant_isolation ON respond_incident_task;
DROP POLICY IF EXISTS tenant_insert ON respond_incident_task;
DROP POLICY IF EXISTS tenant_update ON respond_incident_task;
DROP POLICY IF EXISTS tenant_delete ON respond_incident_task;

DROP POLICY IF EXISTS tenant_isolation ON respond_incident_task_dependency;
DROP POLICY IF EXISTS tenant_insert ON respond_incident_task_dependency;
DROP POLICY IF EXISTS tenant_update ON respond_incident_task_dependency;
DROP POLICY IF EXISTS tenant_delete ON respond_incident_task_dependency;

DROP POLICY IF EXISTS tenant_isolation ON respond_incident_task_assignment;
DROP POLICY IF EXISTS tenant_insert ON respond_incident_task_assignment;
DROP POLICY IF EXISTS tenant_update ON respond_incident_task_assignment;
DROP POLICY IF EXISTS tenant_delete ON respond_incident_task_assignment;

DROP POLICY IF EXISTS tenant_isolation ON respond_incident_task_status_history;
DROP POLICY IF EXISTS tenant_insert ON respond_incident_task_status_history;
DROP POLICY IF EXISTS tenant_update ON respond_incident_task_status_history;
DROP POLICY IF EXISTS tenant_delete ON respond_incident_task_status_history;

CREATE POLICY template_select ON respond_task_template
    USING (
        current_setting('app.bypass_rls', true) = 'on'
        OR scope = 'global'
        OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
    );
CREATE POLICY template_insert ON respond_task_template
    FOR INSERT
    WITH CHECK (
        current_setting('app.bypass_rls', true) = 'on'
        OR (scope = 'tenant' AND tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    );
CREATE POLICY template_update ON respond_task_template
    FOR UPDATE
    USING (
        current_setting('app.bypass_rls', true) = 'on'
        OR (scope = 'tenant' AND tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    )
    WITH CHECK (
        current_setting('app.bypass_rls', true) = 'on'
        OR (scope = 'tenant' AND tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    );
CREATE POLICY template_delete ON respond_task_template
    FOR DELETE
    USING (
        current_setting('app.bypass_rls', true) = 'on'
        OR (scope = 'tenant' AND tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    );

CREATE POLICY template_step_select ON respond_task_template_step
    USING (
        current_setting('app.bypass_rls', true) = 'on'
        OR EXISTS (
            SELECT 1 FROM respond_task_template t
            WHERE t.id = template_id
              AND (t.scope = 'global' OR t.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
        )
    );
CREATE POLICY template_step_insert ON respond_task_template_step
    FOR INSERT
    WITH CHECK (
        current_setting('app.bypass_rls', true) = 'on'
        OR EXISTS (
            SELECT 1 FROM respond_task_template t
            WHERE t.id = template_id
              AND t.scope = 'tenant'
              AND t.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
        )
    );
CREATE POLICY template_step_update ON respond_task_template_step
    FOR UPDATE
    USING (
        current_setting('app.bypass_rls', true) = 'on'
        OR EXISTS (
            SELECT 1 FROM respond_task_template t
            WHERE t.id = template_id
              AND t.scope = 'tenant'
              AND t.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
        )
    )
    WITH CHECK (
        current_setting('app.bypass_rls', true) = 'on'
        OR EXISTS (
            SELECT 1 FROM respond_task_template t
            WHERE t.id = template_id
              AND t.scope = 'tenant'
              AND t.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
        )
    );
CREATE POLICY template_step_delete ON respond_task_template_step
    FOR DELETE
    USING (
        current_setting('app.bypass_rls', true) = 'on'
        OR EXISTS (
            SELECT 1 FROM respond_task_template t
            WHERE t.id = template_id
              AND t.scope = 'tenant'
              AND t.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
        )
    );

CREATE POLICY tenant_isolation ON respond_incident_task
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_insert ON respond_incident_task
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_update ON respond_incident_task
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_delete ON respond_incident_task
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_isolation ON respond_incident_task_dependency
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_insert ON respond_incident_task_dependency
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_update ON respond_incident_task_dependency
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_delete ON respond_incident_task_dependency
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_isolation ON respond_incident_task_assignment
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_insert ON respond_incident_task_assignment
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_update ON respond_incident_task_assignment
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_delete ON respond_incident_task_assignment
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_isolation ON respond_incident_task_status_history
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_insert ON respond_incident_task_status_history
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_update ON respond_incident_task_status_history
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_delete ON respond_incident_task_status_history
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
