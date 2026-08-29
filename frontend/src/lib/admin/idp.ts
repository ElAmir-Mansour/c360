/**
 * Admin API client for tenant SSO / external identity-provider (IdP) connections
 * (Othaim PRD 12.0, WTQ-INT-04).
 *
 * These are AUTHENTICATED admin calls, so they go through the standard axios
 * instance (@/lib/api — Bearer token + CSRF + entitlement handling), NOT a BFF
 * route, mirroring the roles/tenants admin clients. The backend is
 * iam-service via the gateway prefix /api/v1/idp-connections; the tenant scope
 * is taken from the JWT server-side (never sent in the body).
 *
 * The client_secret is WRITE-ONLY: it is never returned by the API, and a blank
 * value on update preserves the stored (encrypted) secret.
 */
import { apiGet, apiPost, apiPut, apiDelete } from '@/lib/api';

export type IdPKind = 'oidc' | 'nafath' | 'saml';

/** Redacted connection as returned by the API (never carries client_secret). */
export interface IdPConnection {
  id: string;
  tenant_id: string;
  provider: string;
  display_name: string;
  kind: IdPKind;
  enabled: boolean;
  issuer: string;
  client_id: string;
  authorize_url: string;
  token_url: string;
  jwks_url: string;
  userinfo_url: string;
  redirect_url: string;
  scopes: string[];
  default_role_slug: string;
  allow_jit_provisioning: boolean;
  saml_metadata_xml: string;
  login_url: string;
  created_at: string;
  updated_at: string;
}

/** Create/update payload. Omit or blank client_secret to keep the stored one. */
export interface IdPConnectionInput {
  provider: string;
  display_name: string;
  kind: IdPKind;
  enabled: boolean;
  issuer: string;
  client_id: string;
  client_secret: string;
  authorize_url: string;
  token_url: string;
  jwks_url: string;
  userinfo_url: string;
  redirect_url: string;
  scopes: string[];
  default_role_slug: string;
  allow_jit_provisioning: boolean;
  saml_metadata_xml: string;
}

const BASE = '/api/v1/idp-connections';

export function listIdPConnections(): Promise<IdPConnection[]> {
  return apiGet<IdPConnection[]>(BASE);
}

export function getIdPConnection(provider: string): Promise<IdPConnection> {
  return apiGet<IdPConnection>(`${BASE}/${encodeURIComponent(provider)}`);
}

export function createIdPConnection(input: IdPConnectionInput): Promise<IdPConnection> {
  return apiPost<IdPConnection>(BASE, input);
}

export function updateIdPConnection(
  provider: string,
  input: IdPConnectionInput,
): Promise<IdPConnection> {
  return apiPut<IdPConnection>(`${BASE}/${encodeURIComponent(provider)}`, input);
}

export function deleteIdPConnection(provider: string): Promise<{ message: string }> {
  return apiDelete<{ message: string }>(`${BASE}/${encodeURIComponent(provider)}`);
}

/** An empty input suitable for the create form. */
export function emptyIdPConnectionInput(): IdPConnectionInput {
  return {
    provider: '',
    display_name: '',
    kind: 'oidc',
    enabled: true,
    issuer: '',
    client_id: '',
    client_secret: '',
    authorize_url: '',
    token_url: '',
    jwks_url: '',
    userinfo_url: '',
    redirect_url: '',
    scopes: ['openid', 'profile', 'email'],
    default_role_slug: 'viewer',
    allow_jit_provisioning: true,
    saml_metadata_xml: '',
  };
}

/** Map a redacted connection into an editable input (client_secret starts blank). */
export function connectionToInput(c: IdPConnection): IdPConnectionInput {
  return {
    provider: c.provider,
    display_name: c.display_name,
    kind: c.kind,
    enabled: c.enabled,
    issuer: c.issuer,
    client_id: c.client_id,
    client_secret: '',
    authorize_url: c.authorize_url,
    token_url: c.token_url,
    jwks_url: c.jwks_url,
    userinfo_url: c.userinfo_url,
    redirect_url: c.redirect_url,
    scopes: c.scopes?.length ? c.scopes : ['openid', 'profile', 'email'],
    default_role_slug: c.default_role_slug || 'viewer',
    allow_jit_provisioning: c.allow_jit_provisioning,
    saml_metadata_xml: c.saml_metadata_xml,
  };
}
