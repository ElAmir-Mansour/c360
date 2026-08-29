-- =============================================================================
-- Clario 360 — Passwordless / WebAuthn / Trusted-device auth backend
-- Database: platform_core
-- Adds tenant-scoped tables for WebAuthn (FIDO2) credentials, trusted-device
-- registration, and magic-link passwordless tokens, plus an email_domain
-- column on idp_connections so SSO discovery can resolve a login domain to a
-- tenant's IdP connection. RLS mirrors the platform tenant-isolation convention
-- (see 000018_idp_federation.up.sql).
-- =============================================================================

CREATE TABLE webauthn_credentials (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    credential_id TEXT NOT NULL,
    public_key    TEXT NOT NULL,
    counter       BIGINT NOT NULL DEFAULT 0,
    transports    TEXT[] NOT NULL DEFAULT '{}',
    aaguid        UUID,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at  TIMESTAMPTZ,
    UNIQUE (tenant_id, credential_id)
);
CREATE INDEX idx_webauthn_creds_user ON webauthn_credentials (user_id);

CREATE TABLE trusted_devices (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_fingerprint TEXT NOT NULL,
    device_name        VARCHAR(255) NOT NULL DEFAULT 'Unknown Device',
    device_type        VARCHAR(50)  NOT NULL DEFAULT 'web',
    ip_address         INET,
    user_agent         TEXT,
    trusted            BOOLEAN NOT NULL DEFAULT false,
    last_trusted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at         TIMESTAMPTZ,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, user_id, device_fingerprint)
);
CREATE INDEX idx_trusted_devices_user ON trusted_devices (user_id) WHERE revoked_at IS NULL;

CREATE TABLE magic_link_tokens (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    email       VARCHAR(255) NOT NULL,
    token_hash  TEXT NOT NULL,
    used        BOOLEAN NOT NULL DEFAULT false,
    used_at     TIMESTAMPTZ,
    expires_at  TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_magic_links_hash ON magic_link_tokens (token_hash) WHERE used = false;

ALTER TABLE idp_connections ADD COLUMN email_domain TEXT;
CREATE UNIQUE INDEX uq_idp_conn_tenant_domain ON idp_connections (tenant_id, email_domain) WHERE email_domain IS NOT NULL;

-- Row-Level Security: tenant isolation, mirroring the platform convention.
ALTER TABLE webauthn_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE webauthn_credentials FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON webauthn_credentials
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON webauthn_credentials
    FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON webauthn_credentials
    FOR UPDATE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON webauthn_credentials
    FOR DELETE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

ALTER TABLE trusted_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE trusted_devices FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON trusted_devices
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON trusted_devices
    FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON trusted_devices
    FOR UPDATE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON trusted_devices
    FOR DELETE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

ALTER TABLE magic_link_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE magic_link_tokens FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON magic_link_tokens
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON magic_link_tokens
    FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON magic_link_tokens
    FOR UPDATE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON magic_link_tokens
    FOR DELETE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
