CREATE TABLE IF NOT EXISTS respond_service_registry (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    service_key TEXT NOT NULL CHECK (length(trim(service_key)) > 0),
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    description TEXT NOT NULL DEFAULT '',
    owner_team TEXT NOT NULL CHECK (length(trim(owner_team)) > 0),
    tier TEXT NOT NULL CHECK (tier IN ('mission_critical','business_critical','important','standard')),
    lifecycle_status TEXT NOT NULL DEFAULT 'active' CHECK (lifecycle_status IN ('active','retired')),
    owners JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(owners) = 'array'),
    row_version INT NOT NULL DEFAULT 1 CHECK (row_version > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, service_key),
    UNIQUE (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS idx_respond_service_registry_tenant_tier
    ON respond_service_registry (tenant_id, tier, service_key);

CREATE INDEX IF NOT EXISTS idx_respond_service_registry_tenant_status
    ON respond_service_registry (tenant_id, lifecycle_status, service_key);

CREATE TABLE IF NOT EXISTS respond_service_dependency (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    service_id UUID NOT NULL,
    dependency_key TEXT NOT NULL CHECK (length(trim(dependency_key)) > 0),
    dependency_kind TEXT NOT NULL DEFAULT 'hard' CHECK (dependency_kind IN ('hard','soft')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (tenant_id, service_id)
        REFERENCES respond_service_registry (tenant_id, id)
        ON DELETE CASCADE,
    UNIQUE (tenant_id, service_id, dependency_key)
);

CREATE INDEX IF NOT EXISTS idx_respond_service_dependency_service
    ON respond_service_dependency (tenant_id, service_id, dependency_key);

CREATE INDEX IF NOT EXISTS idx_respond_service_dependency_key
    ON respond_service_dependency (tenant_id, dependency_key);

CREATE TABLE IF NOT EXISTS respond_incident_impact_assessment (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    incident_id UUID NOT NULL REFERENCES respond_incident(id) ON DELETE RESTRICT,
    user_scope TEXT NOT NULL CHECK (user_scope IN ('none','individual_users','limited_user_group','large_user_group','all_users')),
    business_criticality TEXT NOT NULL CHECK (business_criticality IN ('none','non_critical','important_degraded','critical_degraded','critical_stopped')),
    revenue_impact TEXT NOT NULL CHECK (revenue_impact IN ('none','low','material','severe')),
    regulatory_exposure TEXT NOT NULL CHECK (regulatory_exposure IN ('none','unlikely','potential','confirmed')),
    affected_service_keys JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(affected_service_keys) = 'array'),
    notes TEXT NOT NULL DEFAULT '',
    assessed_by UUID NOT NULL,
    assessed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_respond_impact_assessment_incident_time
    ON respond_incident_impact_assessment (tenant_id, incident_id, assessed_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS respond_incident_severity_decision (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    incident_id UUID NOT NULL REFERENCES respond_incident(id) ON DELETE RESTRICT,
    impact_assessment_id UUID NOT NULL REFERENCES respond_incident_impact_assessment(id) ON DELETE RESTRICT,
    previous_severity TEXT NOT NULL CHECK (previous_severity IN ('SEV1','SEV2','SEV3','SEV4')),
    recommended_severity TEXT NOT NULL CHECK (recommended_severity IN ('SEV1','SEV2','SEV3','SEV4')),
    chosen_severity TEXT NOT NULL CHECK (chosen_severity IN ('SEV1','SEV2','SEV3','SEV4')),
    override_recommended BOOLEAN NOT NULL DEFAULT false,
    override_reason TEXT NOT NULL DEFAULT '',
    rule_version TEXT NOT NULL CHECK (length(trim(rule_version)) > 0),
    rule_trace JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(rule_trace) = 'object'),
    incident_row_version INT NOT NULL CHECK (incident_row_version > 0),
    decided_by UUID NOT NULL,
    decided_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (override_recommended = (chosen_severity <> recommended_severity)),
    CHECK (chosen_severity = recommended_severity OR length(trim(override_reason)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_respond_severity_decision_incident_time
    ON respond_incident_severity_decision (tenant_id, incident_id, decided_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_respond_severity_decision_assessment
    ON respond_incident_severity_decision (tenant_id, impact_assessment_id);

CREATE TABLE IF NOT EXISTS respond_incident_affected_service (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    incident_id UUID NOT NULL REFERENCES respond_incident(id) ON DELETE RESTRICT,
    service_id UUID NOT NULL,
    service_key TEXT NOT NULL CHECK (length(trim(service_key)) > 0),
    metadata_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata_snapshot) = 'object'),
    attached_by UUID NOT NULL,
    attached_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (tenant_id, service_id)
        REFERENCES respond_service_registry (tenant_id, id)
        ON DELETE RESTRICT,
    UNIQUE (tenant_id, incident_id, service_key)
);

CREATE INDEX IF NOT EXISTS idx_respond_affected_service_incident
    ON respond_incident_affected_service (tenant_id, incident_id, service_key);

CREATE INDEX IF NOT EXISTS idx_respond_affected_service_service
    ON respond_incident_affected_service (tenant_id, service_id, attached_at DESC);

ALTER TABLE respond_service_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE respond_service_registry FORCE ROW LEVEL SECURITY;
ALTER TABLE respond_service_dependency ENABLE ROW LEVEL SECURITY;
ALTER TABLE respond_service_dependency FORCE ROW LEVEL SECURITY;
ALTER TABLE respond_incident_impact_assessment ENABLE ROW LEVEL SECURITY;
ALTER TABLE respond_incident_impact_assessment FORCE ROW LEVEL SECURITY;
ALTER TABLE respond_incident_severity_decision ENABLE ROW LEVEL SECURITY;
ALTER TABLE respond_incident_severity_decision FORCE ROW LEVEL SECURITY;
ALTER TABLE respond_incident_affected_service ENABLE ROW LEVEL SECURITY;
ALTER TABLE respond_incident_affected_service FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON respond_service_registry;
DROP POLICY IF EXISTS tenant_insert ON respond_service_registry;
DROP POLICY IF EXISTS tenant_update ON respond_service_registry;
DROP POLICY IF EXISTS tenant_delete ON respond_service_registry;

DROP POLICY IF EXISTS tenant_isolation ON respond_service_dependency;
DROP POLICY IF EXISTS tenant_insert ON respond_service_dependency;
DROP POLICY IF EXISTS tenant_update ON respond_service_dependency;
DROP POLICY IF EXISTS tenant_delete ON respond_service_dependency;

DROP POLICY IF EXISTS tenant_isolation ON respond_incident_impact_assessment;
DROP POLICY IF EXISTS tenant_insert ON respond_incident_impact_assessment;
DROP POLICY IF EXISTS tenant_update ON respond_incident_impact_assessment;
DROP POLICY IF EXISTS tenant_delete ON respond_incident_impact_assessment;

DROP POLICY IF EXISTS tenant_isolation ON respond_incident_severity_decision;
DROP POLICY IF EXISTS tenant_insert ON respond_incident_severity_decision;
DROP POLICY IF EXISTS tenant_update ON respond_incident_severity_decision;
DROP POLICY IF EXISTS tenant_delete ON respond_incident_severity_decision;

DROP POLICY IF EXISTS tenant_isolation ON respond_incident_affected_service;
DROP POLICY IF EXISTS tenant_insert ON respond_incident_affected_service;
DROP POLICY IF EXISTS tenant_update ON respond_incident_affected_service;
DROP POLICY IF EXISTS tenant_delete ON respond_incident_affected_service;

CREATE POLICY tenant_isolation ON respond_service_registry
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_insert ON respond_service_registry
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_update ON respond_service_registry
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_delete ON respond_service_registry
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_isolation ON respond_service_dependency
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_insert ON respond_service_dependency
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_update ON respond_service_dependency
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_delete ON respond_service_dependency
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_isolation ON respond_incident_impact_assessment
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_insert ON respond_incident_impact_assessment
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_update ON respond_incident_impact_assessment
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_delete ON respond_incident_impact_assessment
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_isolation ON respond_incident_severity_decision
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_insert ON respond_incident_severity_decision
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_update ON respond_incident_severity_decision
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_delete ON respond_incident_severity_decision
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_isolation ON respond_incident_affected_service
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_insert ON respond_incident_affected_service
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_update ON respond_incident_affected_service
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_delete ON respond_incident_affected_service
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
