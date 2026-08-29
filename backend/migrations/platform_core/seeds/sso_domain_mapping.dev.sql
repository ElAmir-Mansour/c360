-- =============================================================================
-- DEV SEED (NOT an auto-run migration)
-- =============================================================================
-- Maps the email domain 'clario.dev' to a test OIDC IdP connection so that
--   GET /api/v1/auth/sso/discover?domain=clario.dev
-- returns 200 {provider, authorize_url} instead of 404.
--
-- This file is intentionally placed under migrations/platform_core/seeds/ and is
-- NOT picked up by the migration runner (golang-migrate only loads *.up.sql /
-- *.down.sql numbered files in the parent migrations dir). Apply manually:
--
--   docker exec -i clario360-postgres psql -U clario -d platform_core \
--     < backend/migrations/platform_core/seeds/sso_domain_mapping.dev.sql
--
-- Idempotent: re-running is a no-op (ON CONFLICT (tenant_id, provider) DO NOTHING
-- on the INSERT; the UPDATE is naturally idempotent).
--
-- Notes:
--   * tenant_id 4f7d6246-b6b4-44e6-9f37-5de6f3943196 = "AIVOLVE SAUDI" (dev tenant).
--   * Explicit authorize_url/token_url/jwks_url/userinfo_url are set so the
--     federation service builds the authorize URL locally WITHOUT performing live
--     OIDC discovery against issuer/.well-known/openid-configuration. The dev
--     issuer host (auth.example.com) is not resolvable, so relying on discovery
--     alone returns a 502; the explicit endpoints make /sso/discover return 200.
-- =============================================================================

INSERT INTO idp_connections (
  id,
  tenant_id,
  provider,
  display_name,
  kind,
  enabled,
  issuer,
  client_id,
  authorize_url,
  token_url,
  jwks_url,
  userinfo_url,
  redirect_url,
  scopes,
  default_role_slug,
  allow_jit_provisioning,
  email_domain
)
VALUES (
  gen_random_uuid(),
  '4f7d6246-b6b4-44e6-9f37-5de6f3943196',
  'test-oidc',
  'Test OIDC Provider',
  'oidc',
  true,
  'https://auth.example.com',
  'test-client-id',
  'https://auth.example.com/authorize',
  'https://auth.example.com/token',
  'https://auth.example.com/.well-known/jwks.json',
  'https://auth.example.com/userinfo',
  'http://localhost:3002/api/auth/callback',
  '{openid,profile,email}',
  'viewer',
  true,
  'clario.dev'
)
ON CONFLICT (tenant_id, provider) DO NOTHING;

-- Ensure explicit OIDC endpoints are present even if the row was previously
-- seeded (e.g. issuer-only). Keeps existing rows working without live discovery.
UPDATE idp_connections
SET authorize_url = 'https://auth.example.com/authorize',
    token_url     = 'https://auth.example.com/token',
    jwks_url      = 'https://auth.example.com/.well-known/jwks.json',
    userinfo_url  = 'https://auth.example.com/userinfo'
WHERE tenant_id = '4f7d6246-b6b4-44e6-9f37-5de6f3943196'
  AND provider  = 'test-oidc'
  AND email_domain = 'clario.dev';
