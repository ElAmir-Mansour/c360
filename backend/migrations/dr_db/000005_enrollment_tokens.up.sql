-- Durable backstop for DR agent enrollment-token replay protection.
--
-- Redis is the primary low-latency JTI claim path, but this table survives a
-- Redis flush/restart and prevents a previously consumed token from being
-- exchanged again.

CREATE TABLE IF NOT EXISTS dr_enrollment_token (
    jti UUID PRIMARY KEY,
    agent_id UUID NOT NULL REFERENCES dr_agent(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL,
    purpose TEXT NOT NULL CHECK (purpose IN ('enroll','rotate')),
    issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    consumed_from_ip INET,
    CHECK (expires_at > issued_at)
);

CREATE INDEX IF NOT EXISTS idx_dr_enrollment_token_agent
    ON dr_enrollment_token (tenant_id, agent_id, issued_at DESC);

CREATE INDEX IF NOT EXISTS idx_dr_enrollment_token_unconsumed
    ON dr_enrollment_token (expires_at)
    WHERE consumed_at IS NULL;

-- Durable mTLS denylist for retired DR agent certificates. Rotation should
-- revoke the old thumbprint without disabling the agent row that now owns the
-- replacement certificate.
CREATE TABLE IF NOT EXISTS dr_agent_cert_revocation (
    thumbprint TEXT PRIMARY KEY,
    agent_id UUID NOT NULL REFERENCES dr_agent(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL,
    cert_serial TEXT NOT NULL DEFAULT '',
    revoked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    reason TEXT NOT NULL DEFAULT 'unspecified'
);

CREATE INDEX IF NOT EXISTS idx_dr_agent_cert_revocation_agent
    ON dr_agent_cert_revocation (tenant_id, agent_id, revoked_at DESC);

CREATE INDEX IF NOT EXISTS idx_dr_agent_cert_revocation_revoked_at
    ON dr_agent_cert_revocation (revoked_at);

ALTER TABLE dr_enrollment_token ENABLE ROW LEVEL SECURITY;
ALTER TABLE dr_enrollment_token FORCE ROW LEVEL SECURITY;

ALTER TABLE dr_agent_cert_revocation ENABLE ROW LEVEL SECURITY;
ALTER TABLE dr_agent_cert_revocation FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON dr_enrollment_token;
DROP POLICY IF EXISTS tenant_insert ON dr_enrollment_token;
DROP POLICY IF EXISTS tenant_update ON dr_enrollment_token;
DROP POLICY IF EXISTS tenant_delete ON dr_enrollment_token;

DROP POLICY IF EXISTS tenant_isolation ON dr_agent_cert_revocation;
DROP POLICY IF EXISTS tenant_insert ON dr_agent_cert_revocation;
DROP POLICY IF EXISTS tenant_update ON dr_agent_cert_revocation;
DROP POLICY IF EXISTS tenant_delete ON dr_agent_cert_revocation;

CREATE POLICY tenant_isolation ON dr_enrollment_token
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_insert ON dr_enrollment_token
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_update ON dr_enrollment_token
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_delete ON dr_enrollment_token
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_isolation ON dr_agent_cert_revocation
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_insert ON dr_agent_cert_revocation
    FOR INSERT
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_update ON dr_agent_cert_revocation
    FOR UPDATE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
    WITH CHECK ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

CREATE POLICY tenant_delete ON dr_agent_cert_revocation
    FOR DELETE
    USING ((current_setting('app.bypass_rls', true) = 'on' OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
