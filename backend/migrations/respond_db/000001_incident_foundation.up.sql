CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS respond_incident_reference_counter (
    tenant_id UUID NOT NULL,
    ref_year INT NOT NULL,
    last_number INT NOT NULL CHECK (last_number > 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, ref_year)
);

CREATE TABLE IF NOT EXISTS respond_incident (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    reference TEXT NOT NULL,
    title TEXT NOT NULL CHECK (length(trim(title)) > 0),
    description TEXT NOT NULL DEFAULT '',
    severity TEXT NOT NULL CHECK (severity IN ('SEV1','SEV2','SEV3','SEV4')),
    status TEXT NOT NULL CHECK (status IN (
        'Declared','Triaged','Mobilizing','Investigating','Mitigating',
        'Mitigated','Resolved','Closed','Cancelled'
    )),
    declared_by UUID NOT NULL,
    declared_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    detected_at TIMESTAMPTZ,
    mitigated_at TIMESTAMPTZ,
    resolved_at TIMESTAMPTZ,
    closed_at TIMESTAMPTZ,
    impacted_services JSONB NOT NULL DEFAULT '[]'::jsonb,
    row_version INT NOT NULL DEFAULT 1 CHECK (row_version > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, reference)
);

CREATE INDEX IF NOT EXISTS idx_respond_incident_tenant_status
    ON respond_incident (tenant_id, status, declared_at DESC);

CREATE INDEX IF NOT EXISTS idx_respond_incident_tenant_severity
    ON respond_incident (tenant_id, severity, declared_at DESC);

CREATE INDEX IF NOT EXISTS idx_respond_incident_tenant_reference
    ON respond_incident (tenant_id, reference);

CREATE TABLE IF NOT EXISTS respond_incident_timeline_event (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    incident_id UUID NOT NULL REFERENCES respond_incident(id) ON DELETE RESTRICT,
    actor_id UUID NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    event_type TEXT NOT NULL CHECK (length(trim(event_type)) > 0),
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_respond_timeline_incident_time
    ON respond_incident_timeline_event (tenant_id, incident_id, occurred_at, id);

CREATE INDEX IF NOT EXISTS idx_respond_timeline_type_time
    ON respond_incident_timeline_event (tenant_id, incident_id, event_type, occurred_at);

CREATE INDEX IF NOT EXISTS idx_respond_timeline_actor_time
    ON respond_incident_timeline_event (tenant_id, incident_id, actor_id, occurred_at);

CREATE OR REPLACE FUNCTION respond_timeline_no_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'respond incident timeline is append-only';
END;
$$;

DROP TRIGGER IF EXISTS trg_respond_timeline_no_update ON respond_incident_timeline_event;
CREATE TRIGGER trg_respond_timeline_no_update
    BEFORE UPDATE ON respond_incident_timeline_event
    FOR EACH ROW EXECUTE FUNCTION respond_timeline_no_mutation();

DROP TRIGGER IF EXISTS trg_respond_timeline_no_delete ON respond_incident_timeline_event;
CREATE TRIGGER trg_respond_timeline_no_delete
    BEFORE DELETE ON respond_incident_timeline_event
    FOR EACH ROW EXECUTE FUNCTION respond_timeline_no_mutation();

ALTER TABLE respond_incident_reference_counter ENABLE ROW LEVEL SECURITY;
ALTER TABLE respond_incident_reference_counter FORCE ROW LEVEL SECURITY;
ALTER TABLE respond_incident ENABLE ROW LEVEL SECURITY;
ALTER TABLE respond_incident FORCE ROW LEVEL SECURITY;
ALTER TABLE respond_incident_timeline_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE respond_incident_timeline_event FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON respond_incident_reference_counter;
DROP POLICY IF EXISTS tenant_insert ON respond_incident_reference_counter;
DROP POLICY IF EXISTS tenant_update ON respond_incident_reference_counter;
DROP POLICY IF EXISTS tenant_delete ON respond_incident_reference_counter;

DROP POLICY IF EXISTS tenant_isolation ON respond_incident;
DROP POLICY IF EXISTS tenant_insert ON respond_incident;
DROP POLICY IF EXISTS tenant_update ON respond_incident;
DROP POLICY IF EXISTS tenant_delete ON respond_incident;

DROP POLICY IF EXISTS tenant_isolation ON respond_incident_timeline_event;
DROP POLICY IF EXISTS tenant_insert ON respond_incident_timeline_event;
DROP POLICY IF EXISTS tenant_update ON respond_incident_timeline_event;
DROP POLICY IF EXISTS tenant_delete ON respond_incident_timeline_event;

CREATE POLICY tenant_isolation ON respond_incident_reference_counter
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_insert ON respond_incident_reference_counter
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_update ON respond_incident_reference_counter
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_delete ON respond_incident_reference_counter
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_isolation ON respond_incident
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_insert ON respond_incident
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_update ON respond_incident
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_delete ON respond_incident
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_isolation ON respond_incident_timeline_event
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_insert ON respond_incident_timeline_event
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_update ON respond_incident_timeline_event
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_delete ON respond_incident_timeline_event
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

