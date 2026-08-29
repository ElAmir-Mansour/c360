-- =============================================================================
-- Lex Integration Platform (Phase 2) — inbound SCIM 2.0 server bearer tokens.
--
--   lex_scim_tokens: per-tenant, per-endpoint bearer tokens that authenticate an
--   external IdP (Entra/Okta/Keycloak) pushing to the lex inbound SCIM server
--   (/scim/v2/*). The token is NEVER stored in cleartext: only a sha256 hash of
--   the bearer value is persisted (token_hash), plus a short non-secret prefix
--   (token_prefix) so an operator can recognise WHICH token is active without
--   exposing it. The full token is returned to the operator ONCE at issue/rotate
--   time and never again — identical custody to an API key.
--
--   tenant_id FIRST; resolves the inbound SCIM bearer middleware to a tenant +
--   endpoint without a JWT (the SCIM server runs OUTSIDE the JWT chain). 4 RLS
--   policies. revoked_at supports rotation (issue new, revoke old).
--
-- Staged in _staging/ until the integrator assigns the next free migration number
-- Numbered 000063 by integrator (prior committed max = 000059).
-- =============================================================================

CREATE TABLE IF NOT EXISTS lex_scim_tokens (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID        NOT NULL,
    endpoint_id   UUID        NOT NULL REFERENCES lex_integration_endpoints(id) ON DELETE CASCADE,
    -- token_hash is sha256(hex) of the raw bearer token. Lookups hash the presented
    -- bearer and match here; the raw token is never persisted.
    token_hash    TEXT        NOT NULL,
    -- token_prefix is the first few non-secret characters of the issued token
    -- (e.g. "lexscim_ab12"), shown in the console so operators can identify it.
    token_prefix  TEXT        NOT NULL DEFAULT '',
    label         TEXT        NOT NULL DEFAULT '',
    created_by    UUID,
    last_used_at  TIMESTAMPTZ,
    expires_at    TIMESTAMPTZ,
    revoked_at    TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A given hash resolves to exactly one tenant/endpoint (global-unique by hash so
-- the unauthenticated SCIM middleware can resolve tenant from the bearer alone).
CREATE UNIQUE INDEX IF NOT EXISTS idx_lex_scim_tokens_hash_unique
    ON lex_scim_tokens (token_hash);
CREATE INDEX IF NOT EXISTS idx_lex_scim_tokens_endpoint
    ON lex_scim_tokens (tenant_id, endpoint_id, revoked_at);

ALTER TABLE lex_scim_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE lex_scim_tokens FORCE ROW LEVEL SECURITY;

-- NOTE: the inbound SCIM bearer lookup (resolve_by_hash) runs BEFORE a tenant is
-- known, so it executes as the table owner / a role that bypasses RLS (the pool
-- the SCIM server uses is not tenant-scoped at that point); once the tenant is
-- resolved the request proceeds tenant-scoped. The console issue/rotate path is
-- always tenant-scoped and honours these policies.
CREATE POLICY tenant_isolation ON lex_scim_tokens
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON lex_scim_tokens
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON lex_scim_tokens
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON lex_scim_tokens
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
