CREATE TABLE IF NOT EXISTS respond_incident_pir (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    incident_id UUID NOT NULL REFERENCES respond_incident(id) ON DELETE RESTRICT,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','signed_off')),
    summary TEXT NOT NULL CHECK (length(trim(summary)) > 0),
    timeline JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(timeline) = 'array'),
    severity_history JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(severity_history) = 'array'),
    roles JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(roles) = 'array'),
    tasks JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(tasks) = 'array'),
    approvals JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(approvals) = 'array'),
    notifications JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(notifications) = 'array'),
    integrations JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(integrations) = 'array'),
    mttr_started_at TIMESTAMPTZ NOT NULL,
    mttr_resolved_at TIMESTAMPTZ NOT NULL,
    mttr_seconds INT NOT NULL CHECK (mttr_seconds >= 0),
    mttr_target_seconds INT NOT NULL CHECK (mttr_target_seconds > 0),
    mttr_met BOOLEAN NOT NULL,
    mttr_basis_severity TEXT NOT NULL CHECK (mttr_basis_severity IN ('SEV1','SEV2','SEV3','SEV4')),
    contributing_factors JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(contributing_factors) = 'array'),
    lessons_learned JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(lessons_learned) = 'array'),
    generated_by UUID NOT NULL,
    generated_at TIMESTAMPTZ NOT NULL,
    signed_off_by UUID,
    signed_off_at TIMESTAMPTZ,
    content_hash TEXT NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
    row_version INT NOT NULL DEFAULT 1 CHECK (row_version > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, incident_id),
    CHECK (
        (status = 'draft' AND signed_off_by IS NULL AND signed_off_at IS NULL)
        OR
        (status = 'signed_off' AND signed_off_by IS NOT NULL AND signed_off_at IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_respond_incident_pir_incident
    ON respond_incident_pir (tenant_id, incident_id);

CREATE INDEX IF NOT EXISTS idx_respond_incident_pir_status
    ON respond_incident_pir (tenant_id, status, generated_at DESC);

CREATE TABLE IF NOT EXISTS respond_incident_pir_action_item (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    pir_id UUID NOT NULL REFERENCES respond_incident_pir(id) ON DELETE RESTRICT,
    incident_id UUID NOT NULL REFERENCES respond_incident(id) ON DELETE RESTRICT,
    title TEXT NOT NULL CHECK (length(trim(title)) > 0),
    description TEXT NOT NULL DEFAULT '',
    owner_id UUID,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','closed','cancelled')),
    due_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (
        (status IN ('closed','cancelled') AND completed_at IS NOT NULL)
        OR
        (status IN ('open','in_progress') AND completed_at IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_respond_pir_action_item_pir
    ON respond_incident_pir_action_item (tenant_id, pir_id, status, created_at);

CREATE INDEX IF NOT EXISTS idx_respond_pir_action_item_owner
    ON respond_incident_pir_action_item (tenant_id, owner_id, status, due_at)
    WHERE owner_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS respond_incident_evidence_export (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    incident_id UUID NOT NULL REFERENCES respond_incident(id) ON DELETE RESTRICT,
    pir_id UUID REFERENCES respond_incident_pir(id) ON DELETE RESTRICT,
    format TEXT NOT NULL CHECK (format IN ('csv','pdf')),
    content_sha256 TEXT NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
    byte_size INT NOT NULL CHECK (byte_size > 0),
    timeline_event_count INT NOT NULL CHECK (timeline_event_count >= 0),
    pir_content_hash TEXT NOT NULL DEFAULT '',
    generated_by UUID NOT NULL,
    generated_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_respond_evidence_export_incident_time
    ON respond_incident_evidence_export (tenant_id, incident_id, generated_at DESC, id DESC);

CREATE OR REPLACE FUNCTION respond_evidence_export_no_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'respond evidence export audit is append-only';
END;
$$;

DROP TRIGGER IF EXISTS trg_respond_evidence_export_no_update ON respond_incident_evidence_export;
CREATE TRIGGER trg_respond_evidence_export_no_update
    BEFORE UPDATE ON respond_incident_evidence_export
    FOR EACH ROW EXECUTE FUNCTION respond_evidence_export_no_mutation();

DROP TRIGGER IF EXISTS trg_respond_evidence_export_no_delete ON respond_incident_evidence_export;
CREATE TRIGGER trg_respond_evidence_export_no_delete
    BEFORE DELETE ON respond_incident_evidence_export
    FOR EACH ROW EXECUTE FUNCTION respond_evidence_export_no_mutation();

ALTER TABLE respond_incident_pir ENABLE ROW LEVEL SECURITY;
ALTER TABLE respond_incident_pir FORCE ROW LEVEL SECURITY;
ALTER TABLE respond_incident_pir_action_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE respond_incident_pir_action_item FORCE ROW LEVEL SECURITY;
ALTER TABLE respond_incident_evidence_export ENABLE ROW LEVEL SECURITY;
ALTER TABLE respond_incident_evidence_export FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON respond_incident_pir;
DROP POLICY IF EXISTS tenant_insert ON respond_incident_pir;
DROP POLICY IF EXISTS tenant_update ON respond_incident_pir;
DROP POLICY IF EXISTS tenant_delete ON respond_incident_pir;

DROP POLICY IF EXISTS tenant_isolation ON respond_incident_pir_action_item;
DROP POLICY IF EXISTS tenant_insert ON respond_incident_pir_action_item;
DROP POLICY IF EXISTS tenant_update ON respond_incident_pir_action_item;
DROP POLICY IF EXISTS tenant_delete ON respond_incident_pir_action_item;

DROP POLICY IF EXISTS tenant_isolation ON respond_incident_evidence_export;
DROP POLICY IF EXISTS tenant_insert ON respond_incident_evidence_export;
DROP POLICY IF EXISTS tenant_update ON respond_incident_evidence_export;
DROP POLICY IF EXISTS tenant_delete ON respond_incident_evidence_export;

CREATE POLICY tenant_isolation ON respond_incident_pir
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_insert ON respond_incident_pir
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_update ON respond_incident_pir
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_delete ON respond_incident_pir
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_isolation ON respond_incident_pir_action_item
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_insert ON respond_incident_pir_action_item
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_update ON respond_incident_pir_action_item
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_delete ON respond_incident_pir_action_item
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_isolation ON respond_incident_evidence_export
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_insert ON respond_incident_evidence_export
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_update ON respond_incident_evidence_export
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_delete ON respond_incident_evidence_export
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
