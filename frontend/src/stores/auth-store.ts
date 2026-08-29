'use client';

import { create } from 'zustand';
import api, { apiPost, apiGet } from '@/lib/api';
import {
  getAccessToken,
  setAccessToken,
  clearAccessToken,
  getTokenPayload,
} from '@/lib/auth';
import { DEVICE_ID_HEADER, getDeviceId } from '@/hooks/use-device-trust';
import type { User, Tenant, SuiteName } from '@/types/models';
import type { LoginApiResponse, isMFARequired as IsMFARequired } from '@/types/auth';
import { isMFARequired } from '@/types/auth';
import { API_ENDPOINTS } from '@/lib/constants';
import { broadcastLogout } from '@/lib/session-expiry';
import { serializeSessionOp } from '@/lib/session-refresh';

export interface LoginResult {
  requiresMFA: boolean;
  mfaToken?: string;
}

/**
 * Options for {@link AuthState.login}. All fields are optional so existing
 * 2-arg `login(email, password)` callers remain backward-compatible.
 */
export interface LoginOptions {
  /** (#8) Maps to a longer cookie max-age intent; sent to the backend as `remember`. */
  remember?: boolean;
  /**
   * (#12) Trusted-device id. Sent as the `X-Device-Id` header (set on the axios
   * instance default) and as a `device_id` body field. When omitted, the
   * persisted device id from {@link getDeviceId} is used.
   */
  deviceId?: string;
  /**
   * (#10) Bot-challenge / CAPTCHA token. Forwarded to the BFF login request as
   * the `bot_challenge_token` body field. Omitted from the body when not set so
   * legacy callers stay backward-compatible.
   */
  botToken?: string;
}

/**
 * (#5) Serialized WebAuthn assertion — the result of
 * `navigator.credentials.get()` mapped to base64url strings. Mirrors the wire
 * shape produced by `usePasskey`'s `serializeAssertion`.
 */
export interface PasskeyAssertion {
  id: string;
  rawId: string;
  type: 'public-key';
  response: {
    clientDataJSON: string;
    authenticatorData: string;
    signature: string;
    userHandle: string | null;
  };
}

/**
 * (A3 #1) Options for {@link AuthState.loginWithPasskey}. `remember` mirrors the
 * password-login remember-me choice: forwarded to the BFF webauthn verify route
 * so the httpOnly session cookies it sets are persistent (true) or
 * session-scoped (false/omitted).
 */
export interface PasskeyLoginOptions {
  remember?: boolean;
}

/** BFF route the serialized passkey assertion is posted to (relative URL). */
const WEBAUTHN_VERIFY_ENDPOINT = '/api/auth/webauthn/verify';

/**
 * Last-sign-in metadata (#20) surfaced from the session/profile so the auth UI
 * (e.g. <LastSignInNote>) can read it without re-fetching.
 */
export interface LastSignInInfo {
  at: string | null;
  ip: string | null;
}

interface AuthState {
  user: User | null;
  tenant: Tenant | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isHydrated: boolean;
  sessionExpired: boolean;
  /**
   * Monotonic signal for permission sources that live outside Zustand (the
   * active Watheeq persona). Navigation subscribers use it to recompute as soon
   * as `/lex/me` hydrates, rather than waiting for an unrelated route change.
   */
  permissionsVersion: number;
  error: string | null;
  /** (#20) Last successful sign-in metadata, when the session exposes it. */
  lastSignIn: LastSignInInfo | null;
  /**
   * (A3 #1) Remember-me choice stashed at credentials-step success when the
   * backend demanded a second factor. The MFA verify call happens later, from a
   * different code path, so without this the choice was silently dropped and
   * verifyMFA always stored session-scoped cookies. Cleared once consumed.
   */
  pendingMfaRemember: boolean | null;

  // Actions
  login: (email: string, password: string, opts?: LoginOptions) => Promise<LoginResult>;
  loginWithPasskey: (
    assertion: PasskeyAssertion,
    opts?: PasskeyLoginOptions,
  ) => Promise<LoginResult>;
  verifyMFA: (mfaToken: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<void>;
  markHydrated: () => void;
  updateProfile: (
    data: Partial<Pick<User, 'first_name' | 'last_name' | 'email'>>,
  ) => Promise<void>;
  /** Upload/replace the current user's profile picture (a downscaled data URL). */
  updateAvatar: (avatar: string) => Promise<void>;
  /** Remove the current user's profile picture (revert to initials). */
  removeAvatar: () => Promise<void>;
  hasPermission: (permission: string) => boolean;
  hasAnyPermission: (permissions: string[]) => boolean;
  hasAllPermissions: (permissions: string[]) => boolean;
  hasSuiteAccess: (suite: SuiteName) => boolean;
  clearError: () => void;
  setSessionExpired: (value: boolean) => void;
}

const SUITE_PERMISSIONS: Record<SuiteName, string> = {
  cyber: 'cyber:read',
  data: 'data:read',
  respond: 'respond:incident:read',
  acta: 'acta:read',
  lex: 'lex:read',
  visus: 'visus:read',
};

/**
 * Resolve permissions with wildcard matching, consistent with backend logic.
 *
 * Supports arbitrary-depth, colon-delimited permissions (2, 3, or more
 * segments) — NOT just `resource:action`:
 *   - super wildcard:        `*`                            matches anything
 *   - exact match:           `lex:integration:read`         === required
 *   - prefix wildcards:      `lex:*`, `lex:integration:*`   match any
 *                            permission under that path
 *   - action-suffix wildcard:`*:read`                       matches the LAST
 *                            segment (back-compat for legacy 2-segment perms)
 *
 * The previous implementation did `const [resource, action] = required.split(':')`
 * which silently dropped the 3rd+ segment, so a required `lex:integration:read`
 * mis-parsed to resource=`lex`, action=`integration` — granting on the wrong
 * wildcards and failing exact-ish ones. This walks every prefix instead.
 */
/**
 * Lex config domains whose single elevated verb is `:manage`. Mirrors the
 * authoritative backend map (backend/internal/auth/rbac.go `lexConfigDomains`):
 * holding `lex:<config-domain>:manage` implies that domain's lower verbs. The
 * config-only System Administrator holds ONLY the `:manage` keys (no `:view`/
 * `:read` counterparts, no coarse lex:read), so without this implication every
 * read-gated admin surface bounces that persona until the server-expanded
 * `GET /lex/me` effective permissions hydrate.
 */
const LEX_CONFIG_DOMAINS = new Set([
  'sla',
  'escalation',
  'catalog',
  'notification',
  'role',
  'integration',
  'security',
]);

/**
 * Lex operational verbs whose presence on a domain implies `:view` on that same
 * domain (mirrors backend `lexOperationalVerbs` / expandGrants rule 1). They
 * never imply each other.
 */
const LEX_OPERATIONAL_VERBS = new Set(['add', 'edit', 'approve', 'close', 'assign', 'distribute']);

/**
 * The verbs each lex domain actually DEFINES, mirroring the authoritative backend
 * table (backend/internal/auth/rbac.go `lexDomainVerbs`). The lex implication
 * rules below only fire for a verb this map lists for the domain — so a slug the
 * backend never defines (e.g. the phantom `lex:integration:write`; integration
 * defines only `read`+`manage`) is NOT rescued by the `:manage` implication and
 * resolves to false unless granted exactly or via a wildcard. Keep in sync with
 * the backend table.
 */
const LEX_DOMAIN_VERBS = new Map<string, ReadonlySet<string>>([
  ['request', new Set(['view', 'add', 'edit', 'approve', 'close'])],
  ['case', new Set(['view', 'add', 'edit', 'assign', 'approve', 'close'])],
  ['investigation', new Set(['view', 'add', 'edit', 'approve', 'close'])],
  ['settlement', new Set(['view', 'add', 'edit', 'approve', 'close'])],
  ['contract', new Set(['view', 'add', 'edit', 'distribute', 'approve', 'close'])],
  ['consultation', new Set(['view', 'add', 'edit', 'approve', 'close'])],
  ['document', new Set(['view', 'add', 'edit'])],
  ['report', new Set(['read'])],
  ['notification', new Set(['view', 'edit', 'manage'])],
  ['sla', new Set(['view', 'manage'])],
  ['escalation', new Set(['view', 'manage'])],
  ['catalog', new Set(['view', 'manage'])],
  ['role', new Set(['view', 'assign', 'manage'])],
  ['audit', new Set(['read'])],
  // integration's read verb is "read", not "view" (PermLexIntegrationRead), and it
  // has no "write" verb — that absence is what closes the phantom-slug rescue.
  ['integration', new Set(['read', 'manage'])],
  ['security', new Set(['view', 'manage'])],
  ['reference', new Set(['view'])],
]);

export function checkPermission(userPermissions: string[], required: string): boolean {
  if (userPermissions.length === 0) return false;
  if (userPermissions.includes('*')) return true;
  if (userPermissions.includes(required)) return true;

  const segments = required.split(':');

  // Prefix wildcards: for `a:b:c` check `a:*` and `a:b:*` (every parent path).
  // This naturally covers the legacy 2-segment `resource:*` case.
  for (let i = 1; i < segments.length; i += 1) {
    const prefix = segments.slice(0, i).join(':');
    if (userPermissions.includes(`${prefix}:*`)) return true;
  }

  // Action-suffix wildcard (`*:read`) keyed on the LAST segment, preserving the
  // existing 2-segment behavior for multi-segment perms too.
  if (segments.length >= 2) {
    const action = segments[segments.length - 1];
    if (userPermissions.includes(`*:${action}`)) return true;
  }

  // Lex verb implication, mirroring the backend's expandGrants (rbac.go) so the
  // client resolver never disagrees with server authorization for raw
  // (unexpanded) role permission sets — e.g. before `GET /lex/me` hydrates:
  //   - `lex:<config-domain>:manage` implies the domain's lower verbs;
  //   - any operational verb on a lex domain implies `lex:<domain>:view`.
  if (segments.length === 3 && segments[0] === 'lex') {
    const [, domain, verb] = segments;
    // Gate on the backend's per-domain verb allowlist (mirrors expandGrants'
    // `verbs, known := lexDomainVerbs[domain]` check): the implication rules only
    // participate for a verb the domain actually DEFINES. A phantom verb — e.g.
    // the non-existent `lex:integration:write` — must never be granted by the
    // `:manage` implication just because the user holds `lex:integration:manage`.
    const domainVerbs = LEX_DOMAIN_VERBS.get(domain);
    if (domainVerbs?.has(verb)) {
      if (
        verb !== 'manage' &&
        LEX_CONFIG_DOMAINS.has(domain) &&
        userPermissions.includes(`lex:${domain}:manage`)
      ) {
        return true;
      }
      if (verb === 'view') {
        for (const op of LEX_OPERATIONAL_VERBS) {
          if (userPermissions.includes(`lex:${domain}:${op}`)) return true;
        }
      }
    }
  }

  return false;
}

// Cached permission extraction — avoids re-parsing JWT on every hasPermission call.
// Cache is keyed by the token string itself; invalidated when token changes.
let _cachedPermToken: string | null = null;
let _cachedPerms: string[] = [];

/**
 * Externally-hydrated permissions, MERGED (union) into the JWT permissions on
 * every read. This is how the Lex persona layer injects the granular
 * `lex:<domain>:<verb>` keys that come from `GET /api/v1/lex/me`'s
 * `effective_permissions` rather than the JWT (the JWT only carries role slugs
 * + coarse keys for legal users). See setExternalPermissions().
 *
 * Additive + safe: empty by default, so non-lex users and pre-hydration reads
 * behave EXACTLY as before. The set is process-global (not per-user) because the
 * SPA only ever holds one session; it is cleared on logout.
 */
let _externalPerms: string[] = [];
/** Monotonic version bumped whenever the external set changes — lets the cache invalidate. */
let _externalPermsVersion = 0;
let _cachedMergedVersion = -1;
/**
 * Signature of the role-derived permission set folded into the cached merge.
 * When the loaded user profile changes (login / user switch / persona role
 * change) this signature changes, invalidating a previously-cached merged set
 * even if the token AND the external-set version are unchanged. Without it, a
 * super-admin's `*` could stick in (or out of) the cache across a user switch.
 */
let _cachedRoleSig: string | null = null;

/** Reset the permission cache. Exported for tests that mock getTokenPayload. */
export function _resetPermissionsCache(): void {
  _cachedPermToken = null;
  _cachedPerms = [];
  _cachedMergedVersion = -1;
  _cachedRoleSig = null;
}

/**
 * Merge a set of externally-resolved permissions into the source `hasPermission`
 * reads (CRITICAL for the Lex persona model). Pass the granular
 * `effective_permissions` from `/lex/me` here so the Phase-1 granular sidebar
 * and every page/action gate evaluate true at runtime for a legal-role user.
 *
 * Idempotent + cheap: a no-change call (same de-duped set) does NOT bump the
 * version, so it won't churn the permission cache or trigger needless re-reads.
 * Pass `[]` (or call {@link clearExternalPermissions}) on logout / when the user
 * has no lex role to revert to pure-JWT behaviour.
 */
export function setExternalPermissions(permissions: string[]): void {
  const next = Array.from(new Set(permissions ?? [])).sort();
  if (
    next.length === _externalPerms.length &&
    next.every((p, i) => p === _externalPerms[i])
  ) {
    return; // unchanged — keep the cache warm
  }
  _externalPerms = next;
  _externalPermsVersion += 1;
  // The effective permission set is intentionally cached outside Zustand, but
  // UI consumers still need a reactive signal when it changes. The store has
  // been initialized by the time this function can be called (effects, persona
  // switches, logout), so publishing the version here is safe.
  useAuthStore.setState({ permissionsVersion: _externalPermsVersion });
}

/** Drop all externally-hydrated permissions (revert to pure-JWT behaviour). */
export function clearExternalPermissions(): void {
  setExternalPermissions([]);
}

/** Read the current external permission set (exported for tests / capability UIs). */
export function getExternalPermissions(): string[] {
  return _externalPerms;
}

/**
 * Resolve the EFFECTIVE permission set for the current session — the union of
 * ALL THREE additive sources:
 *   1. jwtPerms      — the JWT `permissions` claim (empty for legal users; the
 *                      JWT only carries role slugs for them)
 *   2. externalPerms — granular keys hydrated from `/lex/me` (the lex persona)
 *   3. rolePerms     — user.roles[].permissions from the loaded profile, the
 *                      authoritative home of a super-admin/tenant-admin `*`
 *
 * Folding rolePerms in ALWAYS (not only as an empty-set fallback) is the fix for
 * the multi-role lockout: a super-admin / tenant-admin who ALSO holds a legal
 * role no longer loses her role-granted `*` / `dr:*` just because the lex
 * channel hydrated a non-empty external set.
 *
 * Strictly additive: the set can only grow, so this never removes access and
 * never grants beyond jwtPerms ∪ externalPerms ∪ rolePerms.
 *
 * `rolePerms` is supplied by the caller (the store owns `user`; this
 * module-level helper does not). The memo cache is keyed on the token, the
 * external-set version AND a signature of `rolePerms`, so switching users
 * (new profile / different roles) invalidates a previously-cached merged set.
 */
function getEffectivePermissions(rolePerms: string[]): string[] {
  const token = getAccessToken() || null;
  const roleSig = rolePerms.length > 0 ? rolePerms.join('\u0001') : '';

  // Cache hit only when the token, the external set AND the role set all match.
  if (
    token === _cachedPermToken &&
    _cachedMergedVersion === _externalPermsVersion &&
    _cachedRoleSig === roleSig
  ) {
    return _cachedPerms;
  }

  const jwtPerms = token ? getTokenPayload(token)?.permissions ?? [] : [];
  _cachedPerms =
    jwtPerms.length > 0 || _externalPerms.length > 0 || rolePerms.length > 0
      ? Array.from(new Set([...jwtPerms, ..._externalPerms, ...rolePerms]))
      : [];
  _cachedPermToken = token;
  _cachedMergedVersion = _externalPermsVersion;
  _cachedRoleSig = roleSig;
  return _cachedPerms;
}

/**
 * (#12) Resolve the device id (explicit override or the persisted one) and set
 * it as the `X-Device-Id` default header on the axios instance so it rides along
 * on subsequent authenticated calls. Returns the resolved id (or null) so the
 * caller can also include it as a `device_id` body field. No-op safe on SSR.
 */
function applyDeviceHeader(explicit?: string): string | null {
  const deviceId = explicit ?? getDeviceId();
  if (deviceId) {
    api.defaults.headers.common[DEVICE_ID_HEADER] = deviceId;
  }
  return deviceId;
}

/**
 * (#20) Best-effort extraction of last-sign-in metadata from a user/session
 * payload. Accepts a number of likely backend field shapes; returns null when
 * nothing usable is present.
 */
function extractLastSignIn(source: unknown): LastSignInInfo | null {
  if (!source || typeof source !== 'object') return null;
  const obj = source as Record<string, unknown>;
  const pickString = (...keys: string[]): string | null => {
    for (const key of keys) {
      const value = obj[key];
      if (typeof value === 'string' && value.length > 0) return value;
    }
    return null;
  };
  const at = pickString(
    'last_login_at',
    'last_sign_in_at',
    'previous_login_at',
    'last_seen_at',
  );
  const ip = pickString('last_login_ip', 'last_sign_in_ip', 'previous_login_ip');
  if (!at && !ip) return null;
  return { at, ip };
}

async function hydrateSessionFromBFF(): Promise<{
  user: User;
  tenant: Tenant;
  accessToken: string;
} | null> {
  try {
    // GET /api/auth/session is a Next.js BFF route — must use a relative URL
    // so it resolves to localhost:3000, not the backend gateway.
    //
    // Serialized: when the access token is expired this route ALSO rotates the
    // single-use refresh cookie, so running it alongside a token renewal would
    // replay a spent token and trip the backend's reuse detection (which
    // revokes every session for the user). See lib/session-refresh.ts.
    // Timeout-bounded because the op runs while holding the cross-tab lock —
    // an unbounded hang here would stall auth in every open tab.
    const resp = await serializeSessionOp(() => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15_000);
      return fetch(API_ENDPOINTS.BFF_SESSION, {
        credentials: 'include',
        signal: controller.signal,
      }).finally(() => clearTimeout(timer));
    });
    if (!resp.ok) return null;
    const sessionData = (await resp.json()) as {
      user: User;
      tenant: Tenant;
      access_token: string;
      expires_at: string;
    };
    return {
      user: sessionData.user,
      tenant: sessionData.tenant,
      accessToken: sessionData.access_token,
    };
  } catch {
    return null;
  }
}

async function storeSessionInBFF(
  accessToken: string,
  refreshToken: string,
  remember?: boolean,
): Promise<void> {
  // POST /api/auth/session is a Next.js BFF route — must use a relative URL.
  // (#8) `remember` is forwarded so the BFF can extend the refresh-cookie
  // max-age. The field is optional/back-compatible: omitted when undefined.
  const resp = await fetch(API_ENDPOINTS.BFF_SESSION, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      access_token: accessToken,
      refresh_token: refreshToken,
      ...(remember !== undefined ? { remember } : {}),
    }),
  });
  if (!resp.ok) {
    throw new Error(`Failed to store session: ${resp.status}`);
  }
}

/**
 * In-flight guard for the on-load session refresh. Because the auth bootstrap
 * (AuthProvider mount) and the focus/visibility silent-refresh can both call
 * refreshSession(), and React effects may double-fire, we dedupe concurrent
 * calls onto a single promise. This is what makes hydration DETERMINISTIC:
 * `isHydrated` can only flip true from the settlement of one canonical refresh,
 * never from an overlapping call that resolves earlier with a partial/empty
 * session.
 */
let _refreshInFlight: Promise<void> | null = null;

async function clearSessionInBFF(): Promise<void> {
  try {
    // DELETE /api/auth/session clears httpOnly cookies
    const response = await fetch(API_ENDPOINTS.BFF_SESSION, { method: 'DELETE' });
    if (!response.ok) {
      // Non-fatal — continue logout even if cookie clearing fails
    }
  } catch {
    // Non-fatal
  }
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  tenant: null,
  isAuthenticated: false,
  isLoading: false,
  isHydrated: false,
  sessionExpired: false,
  permissionsVersion: 0,
  error: null,
  lastSignIn: null,
  pendingMfaRemember: null,

  clearError: () => set({ error: null }),

  setSessionExpired: (value: boolean) => set({ sessionExpired: value }),

  markHydrated: () => set({ isHydrated: true, isLoading: false }),

  login: async (
    email: string,
    password: string,
    opts?: LoginOptions,
  ): Promise<LoginResult> => {
    set({ isLoading: true, error: null, sessionExpired: false });
    try {
      // (#12) Attach the trusted-device id as a header for this and subsequent
      // calls, and include it in the body for backends that read it there.
      const deviceId = applyDeviceHeader(opts?.deviceId);

      const resp = await apiPost<LoginApiResponse>(API_ENDPOINTS.AUTH_LOGIN, {
        email,
        password,
        // (#8) Carry the remember-me intent so the BFF/backend can extend the
        // refresh/session cookie max-age. Defaults to false for legacy callers.
        remember: opts?.remember ?? false,
        ...(deviceId ? { device_id: deviceId } : {}),
        // (#10) Forward the bot-challenge/CAPTCHA token when present. Omitted for
        // legacy callers that don't supply one.
        ...(opts?.botToken ? { bot_challenge_token: opts.botToken } : {}),
      });

      if (isMFARequired(resp)) {
        // (A3 #1) Stash the remember choice for the upcoming verifyMFA call so
        // "keep me signed in" survives the MFA hop instead of being dropped.
        set({ isLoading: false, pendingMfaRemember: opts?.remember ?? false });
        return { requiresMFA: true, mfaToken: resp.mfa_token };
      }

      // Full login — store tokens
      await storeSessionInBFF(resp.access_token, resp.refresh_token, opts?.remember);
      setAccessToken(resp.access_token);

      // Fetch full user profile if not included in response
      let user = resp.user;
      if (!user) {
        user = await apiGet<User>(API_ENDPOINTS.USERS_ME);
      }

      set({
        user,
        isAuthenticated: true,
        isLoading: false,
        error: null,
        sessionExpired: false,
        lastSignIn: extractLastSignIn(user),
        pendingMfaRemember: null,
      });

      return { requiresMFA: false };
    } catch (err) {
      const msg = extractErrorMessage(err);
      set({ isLoading: false, error: msg });
      throw err;
    }
  },

  loginWithPasskey: async (
    assertion: PasskeyAssertion,
    opts?: PasskeyLoginOptions,
  ): Promise<LoginResult> => {
    set({ isLoading: true, error: null, sessionExpired: false });
    try {
      // (#5) Post the serialized assertion to the BFF verify route. The BFF sets
      // the httpOnly session cookies on success; we mirror the password-login
      // success path (setAccessToken → user/isAuthenticated). A 404/501 (route
      // not wired) surfaces as a typed ApiError the caller treats as
      // "passkey unavailable".
      const deviceId = applyDeviceHeader();
      const resp = await fetch(WEBAUTHN_VERIFY_ENDPOINT, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(deviceId ? { [DEVICE_ID_HEADER]: deviceId } : {}),
        },
        body: JSON.stringify({
          ...assertion,
          ...(deviceId ? { device_id: deviceId } : {}),
          // (A3 #1) Remember-me rides along so the BFF verify route can decide
          // between persistent and session-scoped cookies (default: session).
          remember: opts?.remember ?? false,
        }),
      });

      if (!resp.ok) {
        // 404/501 = the capability isn't wired (BFF normalizes those); any other
        // status is a verification failure passed through by the BFF — a
        // distinct, non-hiding condition for the button to surface.
        const unavailable = resp.status === 404 || resp.status === 501;
        const err = {
          status: resp.status,
          code: unavailable ? 'PASSKEY_UNAVAILABLE' : `HTTP_${resp.status}`,
          message: unavailable
            ? 'Passkey sign-in is unavailable.'
            : 'Passkey sign-in failed.',
        };
        set({ isLoading: false, error: err.message });
        throw err;
      }

      const data = (await resp.json()) as {
        access_token?: string;
        refresh_token?: string;
        mfa_required?: boolean;
        mfa_token?: string;
        user?: User;
      };

      // Symmetric with password login: a passkey can still require MFA.
      if (data.mfa_required === true && data.mfa_token) {
        // (A3 #1) Same stash as password login: remember must survive the hop.
        set({ isLoading: false, pendingMfaRemember: opts?.remember ?? false });
        return { requiresMFA: true, mfaToken: data.mfa_token };
      }

      if (data.access_token) {
        // The BFF verify route already set the cookies; persist via the BFF
        // session route only if a refresh token was returned in the body.
        if (data.refresh_token) {
          await storeSessionInBFF(data.access_token, data.refresh_token, opts?.remember);
        }
        setAccessToken(data.access_token);
      }

      let user = data.user;
      if (!user) {
        user = await apiGet<User>(API_ENDPOINTS.USERS_ME);
      }

      set({
        user,
        isAuthenticated: true,
        isLoading: false,
        error: null,
        sessionExpired: false,
        lastSignIn: extractLastSignIn(user),
        pendingMfaRemember: null,
      });

      return { requiresMFA: false };
    } catch (err) {
      const msg = extractErrorMessage(err);
      set({ isLoading: false, error: msg });
      throw err;
    }
  },

  verifyMFA: async (mfaToken: string, code: string): Promise<void> => {
    set({ isLoading: true, error: null });
    try {
      // (#12) Keep the device id flowing through the second auth factor too.
      const deviceId = applyDeviceHeader();
      const resp = await apiPost<{
        access_token: string;
        refresh_token: string;
        expires_at: string;
        token_type: string;
        user: User;
      }>(API_ENDPOINTS.AUTH_VERIFY_MFA, {
        mfa_token: mfaToken,
        code,
        ...(deviceId ? { device_id: deviceId } : {}),
      });

      // (A3 #1) Honor the remember-me choice captured when the credentials step
      // (password or passkey) reported MFA-required — previously dropped here,
      // which silently downgraded "keep me signed in" to session cookies.
      await storeSessionInBFF(
        resp.access_token,
        resp.refresh_token,
        get().pendingMfaRemember ?? false,
      );
      setAccessToken(resp.access_token);

      let user = resp.user;
      if (!user) {
        user = await apiGet<User>(API_ENDPOINTS.USERS_ME);
      }

      set({
        user,
        isAuthenticated: true,
        isLoading: false,
        error: null,
        lastSignIn: extractLastSignIn(user),
        pendingMfaRemember: null,
      });
    } catch (err) {
      const msg = extractErrorMessage(err);
      set({ isLoading: false, error: msg });
      throw err;
    }
  },

  logout: async (): Promise<void> => {
    try {
      await apiPost(API_ENDPOINTS.AUTH_LOGOUT);
    } catch {
      // Continue logout even if server-side revocation fails
    }
    await clearSessionInBFF();
    clearAccessToken();
    // Drop any lex persona permissions hydrated into the merge source so a
    // subsequent (different) user never inherits the previous session's perms.
    clearExternalPermissions();
    set({
      user: null,
      tenant: null,
      isAuthenticated: false,
      sessionExpired: false,
      error: null,
      lastSignIn: null,
      pendingMfaRemember: null,
    });
    // Tell every other open tab to log out too, then redirect this one.
    broadcastLogout();
    if (typeof window !== 'undefined') {
      window.location.href = '/login';
    }
  },

  refreshSession: async (): Promise<void> => {
    // Dedupe concurrent / double-fired refreshes onto one canonical promise so
    // hydration is deterministic: the access token + user profile land together,
    // and `isHydrated` only flips true once that single refresh has SETTLED
    // (success OR definitive failure). A second overlapping caller awaits the
    // same in-flight promise instead of racing it to an early/empty resolution.
    if (_refreshInFlight) {
      return _refreshInFlight;
    }

    set({ isLoading: true });

    _refreshInFlight = (async () => {
      try {
        const session = await hydrateSessionFromBFF();
        if (session) {
          // Set the in-memory access token BEFORE the store update so that any
          // synchronous permission read triggered by the resulting re-render
          // (e.g. PermissionRedirect) observes a token that is consistent with
          // the user/profile being committed in the same set().
          setAccessToken(session.accessToken);
          // (#12) Re-attach the device header after a cold rehydrate.
          applyDeviceHeader();
          set({
            user: session.user,
            tenant: session.tenant,
            isAuthenticated: true,
            isHydrated: true,
            isLoading: false,
            error: null,
            lastSignIn: extractLastSignIn(session.user),
          });
        } else {
          // Definitive failure (no session / refresh rejected). Resolve to an
          // unauthenticated-but-hydrated state so guards stop showing the
          // skeleton and route accordingly.
          set({
            user: null,
            tenant: null,
            isAuthenticated: false,
            isHydrated: true,
            isLoading: false,
          });
        }
      } catch {
        set({
          user: null,
          tenant: null,
          isAuthenticated: false,
          isHydrated: true,
          isLoading: false,
        });
      } finally {
        _refreshInFlight = null;
      }
    })();

    return _refreshInFlight;
  },

  updateProfile: async (
    data: Partial<Pick<User, 'first_name' | 'last_name' | 'email'>>,
  ): Promise<void> => {
    set({ isLoading: true, error: null });
    try {
      const updated = await apiPutLazy<User>(API_ENDPOINTS.USERS_ME, data);
      set({ user: updated, isLoading: false });
    } catch (err) {
      const msg = extractErrorMessage(err);
      set({ isLoading: false, error: msg });
      throw err;
    }
  },

  updateAvatar: async (avatar: string): Promise<void> => {
    set({ isLoading: true, error: null });
    try {
      // Returns the full updated user (incl. avatar_url) so every avatar surface
      // — settings, header chip, sidebar footer, comment threads — refreshes at once.
      const updated = await apiPutLazy<User>(API_ENDPOINTS.USERS_ME_AVATAR, { avatar });
      set({ user: updated, isLoading: false });
    } catch (err) {
      const msg = extractErrorMessage(err);
      set({ isLoading: false, error: msg });
      throw err;
    }
  },

  removeAvatar: async (): Promise<void> => {
    set({ isLoading: true, error: null });
    try {
      const updated = await apiDeleteLazy<User>(API_ENDPOINTS.USERS_ME_AVATAR);
      set({ user: updated, isLoading: false });
    } catch (err) {
      const msg = extractErrorMessage(err);
      set({ isLoading: false, error: msg });
      throw err;
    }
  },

  hasPermission: (permission: string): boolean => {
    // The effective set ALWAYS unions the user's role-granted permissions with
    // the JWT + external (lex persona) perms. Role perms are the authoritative
    // source for a super-admin / tenant-admin `*` (the JWT carries only role
    // slugs), so they must be folded in unconditionally — not only when the
    // JWT/external set happens to be empty. Additive: this can only surface
    // access the user's assigned roles already grant server-side.
    const rolePerms = (get().user?.roles ?? []).flatMap((r) => r.permissions);
    return checkPermission(getEffectivePermissions(rolePerms), permission);
  },

  hasAnyPermission: (permissions: string[]): boolean => {
    return permissions.some((p) => get().hasPermission(p));
  },

  hasAllPermissions: (permissions: string[]): boolean => {
    return permissions.every((p) => get().hasPermission(p));
  },

  hasSuiteAccess: (suite: SuiteName): boolean => {
    return get().hasPermission(SUITE_PERMISSIONS[suite]);
  },
}));

// Lazy import to avoid circular dependency (apiPut lives in api.ts which imports auth-store indirectly)
async function apiPutLazy<T>(url: string, data?: unknown): Promise<T> {
  const { apiPut: put } = await import('@/lib/api');
  return put<T>(url, data);
}

async function apiDeleteLazy<T>(url: string): Promise<T> {
  const { apiDelete: del } = await import('@/lib/api');
  return del<T>(url);
}

function extractErrorMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) {
    return (err as { message: string }).message;
  }
  return 'An unexpected error occurred';
}
