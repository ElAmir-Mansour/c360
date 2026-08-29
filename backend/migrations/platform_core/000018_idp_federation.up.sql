-- =============================================================================
-- Clario 360 — External Identity / SSO Federation  [WTQ-INT-04]
-- Database: platform_core
-- Adds tenant-scoped external IdP connection configs and the external-identity
-- link table that maps an IdP subject to a platform user (JIT provisioning +
-- account linking). Supports OIDC, Nafath (OIDC variant) and SAML (seam).
-- =============================================================================

CREATE TABLE IF NOT EXISTS idp_connections (
    id                     UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id              UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    provider               TEXT         NOT NULL,                       -- URL slug, e.g. 'nafath', 'azure-ad'
    display_name           TEXT         NOT NULL DEFAULT '',
    kind                   TEXT         NOT NULL DEFAULT 'oidc'
                                        CHECK (kind IN ('oidc', 'nafath', 'saml')),
    enabled                BOOLEAN      NOT NULL DEFAULT true,
    issuer                 TEXT,
    client_id              TEXT,
    client_secret          TEXT,
    authorize_url          TEXT,
    token_url              TEXT,
    jwks_url               TEXT,
    userinfo_url           TEXT,
    redirect_url           TEXT,
    scopes                 TEXT[]       NOT NULL DEFAULT '{openid,profile,email}',
    default_role_slug      TEXT         NOT NULL DEFAULT 'viewer',
    allow_jit_provisioning BOOLEAN      NOT NULL DEFAULT true,
    saml_metadata_xml      TEXT,
    created_at             TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ  NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, provider)
);

COMMENT ON TABLE idp_connections IS 'Tenant-scoped external identity-provider connection configs (WTQ-INT-04)';
COMMENT ON COLUMN idp_connections.kind IS 'Federation protocol: oidc | nafath (OIDC variant) | saml (seam)';
COMMENT ON COLUMN idp_connections.allow_jit_provisioning IS 'When true, unknown external subjects are auto-created as platform users';

CREATE INDEX IF NOT EXISTS idx_idp_connections_tenant ON idp_connections (tenant_id) WHERE enabled = true;

CREATE TRIGGER trg_idp_connections_updated_at
    BEFORE UPDATE ON idp_connections
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS external_identities (
    id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id          UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider         TEXT         NOT NULL,
    external_subject TEXT         NOT NULL,
    email            TEXT         NOT NULL DEFAULT '',
    display_name     TEXT         NOT NULL DEFAULT '',
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    last_login_at    TIMESTAMPTZ,
    -- A given external subject from a provider maps to exactly one identity per tenant.
    UNIQUE (tenant_id, provider, external_subject)
);

COMMENT ON TABLE external_identities IS 'Links an external IdP subject to a platform user (WTQ-INT-04)';

CREATE INDEX IF NOT EXISTS idx_external_identities_user ON external_identities (user_id);
CREATE INDEX IF NOT EXISTS idx_external_identities_lookup
    ON external_identities (tenant_id, provider, external_subject);

-- Row-Level Security: tenant isolation, mirroring the platform convention.
ALTER TABLE idp_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE idp_connections FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON idp_connections
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON idp_connections
    FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON idp_connections
    FOR UPDATE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON idp_connections
    FOR DELETE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

ALTER TABLE external_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_identities FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON external_identities
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON external_identities
    FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON external_identities
    FOR UPDATE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON external_identities
    FOR DELETE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
