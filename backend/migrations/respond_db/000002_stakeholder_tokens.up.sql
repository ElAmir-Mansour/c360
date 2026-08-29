CREATE TABLE IF NOT EXISTS respond_stakeholder_token (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    incident_id UUID NOT NULL REFERENCES respond_incident(id) ON DELETE RESTRICT,
    token_hash BYTEA NOT NULL UNIQUE,
    scope TEXT NOT NULL DEFAULT 'status' CHECK (scope IN ('status')),
    expires_at TIMESTAMPTZ,
    next_update_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_respond_stakeholder_token_incident
    ON respond_stakeholder_token (tenant_id, incident_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_respond_stakeholder_token_hash_active
    ON respond_stakeholder_token (token_hash)
    WHERE revoked_at IS NULL;

ALTER TABLE respond_stakeholder_token ENABLE ROW LEVEL SECURITY;
ALTER TABLE respond_stakeholder_token FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON respond_stakeholder_token;
DROP POLICY IF EXISTS tenant_insert ON respond_stakeholder_token;
DROP POLICY IF EXISTS tenant_update ON respond_stakeholder_token;
DROP POLICY IF EXISTS tenant_delete ON respond_stakeholder_token;

CREATE POLICY tenant_isolation ON respond_stakeholder_token
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_insert ON respond_stakeholder_token
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_update ON respond_stakeholder_token
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
CREATE POLICY tenant_delete ON respond_stakeholder_token
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
