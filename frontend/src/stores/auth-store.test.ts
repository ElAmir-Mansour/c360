import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  useAuthStore,
  _resetPermissionsCache,
  setExternalPermissions,
  clearExternalPermissions,
  getExternalPermissions,
} from './auth-store';
import * as authLib from '@/lib/auth';
import type { User } from '@/types/models';

// We test hasPermission in isolation by mocking getAccessToken + getTokenPayload
vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof authLib>();
  return {
    ...actual,
    getAccessToken: vi.fn(() => 'mock-token'),
    getTokenPayload: vi.fn(() => ({
      sub: 'u1',
      email: 'u@example.com',
      tenant_id: 't1',
      roles: ['analyst'],
      permissions: [],
      exp: Math.floor(Date.now() / 1000) + 900,
      iat: Math.floor(Date.now() / 1000),
      jti: 'jti1',
    })),
    setAccessToken: vi.fn(),
    clearAccessToken: vi.fn(),
    isTokenExpired: vi.fn(() => false),
  };
});

function setPermissions(permissions: string[]) {
  _resetPermissionsCache(); // clear cached perms so the new mock takes effect
  vi.mocked(authLib.getTokenPayload).mockReturnValue({
    sub: 'u1',
    email: 'u@example.com',
    tenant_id: 't1',
    roles: ['analyst'],
    permissions,
    exp: Math.floor(Date.now() / 1000) + 900,
    iat: Math.floor(Date.now() / 1000),
    jti: 'jti1',
  });
}

describe('auth-store permissions', () => {
  beforeEach(() => {
    _resetPermissionsCache();
    useAuthStore.setState({
      user: {
        id: 'u1',
        tenant_id: 't1',
        email: 'u@example.com',
        first_name: 'Test',
        last_name: 'User',
        status: 'active',
        mfa_enabled: false,
        last_login_at: null,
        roles: [],
        created_at: '',
        updated_at: '',
      },
      isAuthenticated: true,
    });
  });

  it('test_hasPermission_exactMatch: "cyber:read" in ["cyber:read"] → true', () => {
    setPermissions(['cyber:read']);
    expect(useAuthStore.getState().hasPermission('cyber:read')).toBe(true);
  });

  it('test_hasPermission_resourceWildcard: "alerts:write" in ["alerts:*"] → true', () => {
    setPermissions(['alerts:*']);
    expect(useAuthStore.getState().hasPermission('alerts:write')).toBe(true);
  });

  it('test_hasPermission_superWildcard: "anything" in ["*"] → true', () => {
    setPermissions(['*']);
    expect(useAuthStore.getState().hasPermission('anything:whatever')).toBe(true);
  });

  it('test_hasPermission_actionWildcard: "cyber:read" in ["*:read"] → true', () => {
    setPermissions(['*:read']);
    expect(useAuthStore.getState().hasPermission('cyber:read')).toBe(true);
  });

  it('test_hasPermission_noMatch: "cyber:write" in ["cyber:read"] → false', () => {
    setPermissions(['cyber:read']);
    expect(useAuthStore.getState().hasPermission('cyber:write')).toBe(false);
  });

  it('test_hasSuiteAccess_cyber: has "cyber:read" → true', () => {
    setPermissions(['cyber:read']);
    expect(useAuthStore.getState().hasSuiteAccess('cyber')).toBe(true);
  });

  it('test_hasSuiteAccess_noAccess: has only "data:read" → cyber = false', () => {
    setPermissions(['data:read']);
    expect(useAuthStore.getState().hasSuiteAccess('cyber')).toBe(false);
  });

  it('hasAnyPermission returns true when at least one matches', () => {
    setPermissions(['data:read']);
    expect(
      useAuthStore.getState().hasAnyPermission(['cyber:read', 'data:read']),
    ).toBe(true);
  });

  it('hasAllPermissions returns false when any is missing', () => {
    setPermissions(['cyber:read']);
    expect(
      useAuthStore.getState().hasAllPermissions(['cyber:read', 'data:read']),
    ).toBe(false);
  });

  // ── 3-segment (multi-segment) permission parsing (RBAC bug fix) ──

  it('test_hasPermission_threeSegment_exact: "lex:integration:read" in itself → true', () => {
    setPermissions(['lex:integration:read']);
    expect(useAuthStore.getState().hasPermission('lex:integration:read')).toBe(true);
  });

  it('test_hasPermission_threeSegment_subResourceWildcard: "lex:integration:read" in ["lex:integration:*"] → true', () => {
    setPermissions(['lex:integration:*']);
    expect(useAuthStore.getState().hasPermission('lex:integration:read')).toBe(true);
  });

  it('test_hasPermission_threeSegment_topResourceWildcard: "lex:integration:read" in ["lex:*"] → true', () => {
    setPermissions(['lex:*']);
    expect(useAuthStore.getState().hasPermission('lex:integration:read')).toBe(true);
  });

  it('test_hasPermission_threeSegment_super: "lex:integration:read" in ["*"] → true', () => {
    setPermissions(['*']);
    expect(useAuthStore.getState().hasPermission('lex:integration:read')).toBe(true);
  });

  it('test_hasPermission_threeSegment_actionSuffix: "lex:integration:read" in ["*:read"] → true', () => {
    setPermissions(['*:read']);
    expect(useAuthStore.getState().hasPermission('lex:integration:read')).toBe(true);
  });

  it('test_hasPermission_threeSegment_noFalsePrefix: "lex:integration:read" NOT granted by ["lex:integration"]', () => {
    // The old code mis-parsed this required perm to resource=lex, action=integration;
    // a held "lex:integration" must NOT grant the 3-segment read.
    setPermissions(['lex:integration']);
    expect(useAuthStore.getState().hasPermission('lex:integration:read')).toBe(false);
  });

  it('test_hasPermission_threeSegment_noCrossResource: "lex:integration:read" NOT granted by ["lex:contract:*"]', () => {
    setPermissions(['lex:contract:*']);
    expect(useAuthStore.getState().hasPermission('lex:integration:read')).toBe(false);
  });

  it('test_hasPermission_threeSegment_noWrongAction: "lex:integration:write" NOT granted by ["*:read"]', () => {
    setPermissions(['*:read']);
    expect(useAuthStore.getState().hasPermission('lex:integration:write')).toBe(false);
  });

  it('test_hasPermission_emptyPerms: returns false when no permissions held', () => {
    setPermissions([]);
    // user.roles is [] in beforeEach, so the role fallback also yields none.
    expect(useAuthStore.getState().hasPermission('lex:integration:read')).toBe(false);
  });
});

// ── Lex persona effective-permission hydration (CRITICAL) ──────────────────
// The granular lex:<domain>:<verb> keys for a legal user come from /lex/me
// (effective_permissions), NOT the JWT. setExternalPermissions merges them into
// the source hasPermission reads so the granular sidebar + page/action gates
// evaluate true at runtime, while staying additive + safe for non-lex users.
describe('auth-store external lex permission hydration', () => {
  beforeEach(() => {
    _resetPermissionsCache();
    clearExternalPermissions();
    useAuthStore.setState({
      user: {
        id: 'u1',
        tenant_id: 't1',
        email: 'u@example.com',
        first_name: 'Test',
        last_name: 'User',
        status: 'active',
        mfa_enabled: false,
        last_login_at: null,
        roles: [],
        created_at: '',
        updated_at: '',
      },
      isAuthenticated: true,
    });
  });

  afterEach(() => {
    clearExternalPermissions();
    _resetPermissionsCache();
  });

  it('merges /lex/me effective_permissions so a granular key (absent from the JWT) evaluates true', () => {
    // JWT carries only a coarse key — the granular gate must still fail first…
    setPermissions(['lex:read']);
    expect(useAuthStore.getState().hasPermission('lex:case:approve')).toBe(false);

    // …then become true once the persona context hydrates the effective perms.
    setExternalPermissions(['lex:case:view', 'lex:case:approve']);
    expect(useAuthStore.getState().hasPermission('lex:case:approve')).toBe(true);
    expect(useAuthStore.getState().hasPermission('lex:case:view')).toBe(true);
  });

  it('is additive — JWT permissions still resolve alongside the merged set', () => {
    setPermissions(['cyber:read']);
    setExternalPermissions(['lex:contract:view']);
    expect(useAuthStore.getState().hasPermission('cyber:read')).toBe(true);
    expect(useAuthStore.getState().hasPermission('lex:contract:view')).toBe(true);
  });

  it('is safe for non-lex users — empty external set leaves behaviour unchanged', () => {
    setPermissions(['data:read']);
    setExternalPermissions([]); // no lex role
    expect(useAuthStore.getState().hasPermission('data:read')).toBe(true);
    expect(useAuthStore.getState().hasPermission('lex:case:view')).toBe(false);
  });

  it('clearExternalPermissions reverts to pure-JWT behaviour (e.g. on logout)', () => {
    setPermissions(['lex:read']);
    setExternalPermissions(['lex:case:approve']);
    expect(useAuthStore.getState().hasPermission('lex:case:approve')).toBe(true);

    clearExternalPermissions();
    expect(getExternalPermissions()).toEqual([]);
    expect(useAuthStore.getState().hasPermission('lex:case:approve')).toBe(false);
  });

  it('applies merged perms even before a token is present (no JWT yet)', () => {
    vi.mocked(authLib.getAccessToken).mockReturnValueOnce('');
    _resetPermissionsCache();
    setExternalPermissions(['lex:audit:read']);
    // No token → JWT path empty, but the external set still grants the gate.
    expect(useAuthStore.getState().hasPermission('lex:audit:read')).toBe(true);
  });

  it('a no-op setExternalPermissions call keeps the resolved set stable', () => {
    setPermissions(['lex:read']);
    setExternalPermissions(['lex:case:view']);
    setExternalPermissions(['lex:case:view']); // identical → no churn
    expect(useAuthStore.getState().hasPermission('lex:case:view')).toBe(true);
  });

  it('publishes a reactive version when Watheeq permissions change', () => {
    const before = useAuthStore.getState().permissionsVersion;

    setExternalPermissions(['lex:case:view', 'workflow:read']);

    expect(useAuthStore.getState().permissionsVersion).toBeGreaterThan(before);
    const after = useAuthStore.getState().permissionsVersion;

    // An identical hydration is a no-op and must not cause render churn.
    setExternalPermissions(['workflow:read', 'lex:case:view']);
    expect(useAuthStore.getState().permissionsVersion).toBe(after);
  });
});

// ── Multi-role effective-permission union (regression: Ada lockout) ─────────
// A super-admin / tenant-admin who ALSO holds a legal role carries her `*`
// (and `dr:*`, `cyber:*`, …) ONLY in user.roles[].permissions — the JWT has
// role slugs, not permissions. Once the lex persona hydrates a NON-EMPTY
// external set, the old code dropped the role perms (they were consulted only
// in the empty-perms fallback), locking her out of every non-lex suite (403 on
// /recover requiring dr:read). hasPermission MUST now ALWAYS union
// user.roles[].permissions with the JWT + external set, while a PURE legal user
// stays correctly gated and never gains a suite she wasn't granted.
describe('auth-store multi-role effective-permission union', () => {
  // Build a minimally-valid Role with the given permission set.
  function mkRole(slug: string, permissions: string[]): User['roles'][number] {
    return {
      id: `role-${slug}`,
      tenant_id: 't1',
      name: slug,
      slug,
      description: '',
      permissions,
      is_system: false,
      created_at: '',
      updated_at: '',
    };
  }

  function setUserRoles(roles: User['roles']) {
    useAuthStore.setState((prev) => ({
      user: {
        ...(prev.user as User),
        id: prev.user?.id ?? 'u1',
        tenant_id: prev.user?.tenant_id ?? 't1',
        email: prev.user?.email ?? 'u@example.com',
        first_name: prev.user?.first_name ?? 'Test',
        last_name: prev.user?.last_name ?? 'User',
        status: prev.user?.status ?? 'active',
        mfa_enabled: prev.user?.mfa_enabled ?? false,
        last_login_at: prev.user?.last_login_at ?? null,
        created_at: prev.user?.created_at ?? '',
        updated_at: prev.user?.updated_at ?? '',
        roles,
      },
      isAuthenticated: true,
    }));
  }

  beforeEach(() => {
    _resetPermissionsCache();
    clearExternalPermissions();
    useAuthStore.setState({
      user: {
        id: 'u1',
        tenant_id: 't1',
        email: 'u@example.com',
        first_name: 'Test',
        last_name: 'User',
        status: 'active',
        mfa_enabled: false,
        last_login_at: null,
        roles: [],
        created_at: '',
        updated_at: '',
      },
      isAuthenticated: true,
    });
  });

  afterEach(() => {
    clearExternalPermissions();
    _resetPermissionsCache();
  });

  // (a) super-admin + tenant-admin + legal-director (Ada). JWT has NO perms;
  // the lex channel hydrates a non-empty external set. Her role-granted `*`
  // MUST still open every non-lex suite, AND the legal perms remain additive.
  it('archetype (a): super-admin+legal keeps `*`/dr access AND legal perms (additive)', () => {
    setUserRoles([
      mkRole('super-admin', ['*', 'siem:supervisory_view']),
      mkRole('tenant-admin', ['dr:*', 'cyber:*', 'data:*', 'lex:*']),
      mkRole('legal-director', ['lex:case:view', 'lex:case:approve']),
    ]);
    setPermissions([]); // JWT carries no permissions claim (only role slugs)
    setExternalPermissions(['lex:case:view', 'lex:case:approve']); // /lex/me

    const s = useAuthStore.getState();
    expect(s.hasPermission('dr:read')).toBe(true); // via role `*` — the fix
    expect(s.hasSuiteAccess('cyber')).toBe(true); // via role `*` / `cyber:*`
    expect(s.hasPermission('data:read')).toBe(true);
    expect(s.hasPermission('lex:case:approve')).toBe(true); // additive holds
  });

  // (b) CRITICAL over-grant guard: a PURE legal-director (roles are lex-only,
  // external is lex-only) must NEVER gain dr:read. This genuinely fails the
  // intent of over-granting — the union must not manufacture a `*`.
  it('archetype (b): pure legal-director stays gated (dr:read FALSE) but keeps legal perms', () => {
    setUserRoles([
      mkRole('legal-director', ['lex:read', 'lex:case:view', 'lex:case:approve']),
    ]);
    setPermissions([]); // JWT: no permissions claim
    setExternalPermissions(['lex:read', 'lex:case:view', 'lex:case:approve']);

    const s = useAuthStore.getState();
    expect(s.hasPermission('dr:read')).toBe(false); // still correctly 403'd
    expect(s.hasSuiteAccess('cyber')).toBe(false);
    expect(s.hasPermission('lex:case:approve')).toBe(true); // her real access
  });

  // (c) pure super-admin (no legal role, no external perms) — unchanged vs. the
  // old empty-perms fallback that already honored role `*`.
  it('archetype (c): pure super-admin `*` grants everything (unchanged)', () => {
    setUserRoles([mkRole('super-admin', ['*'])]);
    clearExternalPermissions();
    setPermissions([]); // JWT: no permissions claim

    const s = useAuthStore.getState();
    expect(s.hasPermission('dr:read')).toBe(true);
    expect(s.hasPermission('anything:whatever')).toBe(true);
  });

  // (d) additive union across a non-lex role perm + an external lex perm.
  it('archetype (d): role perm and external perm both resolve (additive)', () => {
    setUserRoles([mkRole('cyber-analyst', ['cyber:read'])]);
    setPermissions([]);
    setExternalPermissions(['lex:contract:view']);

    const s = useAuthStore.getState();
    expect(s.hasPermission('cyber:read')).toBe(true); // from role perms
    expect(s.hasPermission('lex:contract:view')).toBe(true); // from /lex/me
  });

  // Cache-invalidation regression (the critical one): with a STABLE token and an
  // UNCHANGED external set, switching the loaded profile's roles must invalidate
  // the memoized merged set. Without _cachedRoleSig in the cache key, user B
  // would inherit user A's cached `*` (token + external version both match) and
  // wrongly resolve dr:read TRUE.
  it('invalidates the memo across a user switch (no token / external change)', () => {
    // getAccessToken is the stable 'mock-token' from the module mock; make the
    // JWT perms explicitly empty (this resets the cache ONCE, before the two
    // probe calls — the cache is NOT reset between them). External set stays
    // empty for the whole test.
    setPermissions([]);
    setUserRoles([mkRole('super-admin', ['*'])]);
    expect(useAuthStore.getState().hasPermission('dr:read')).toBe(true); // caches ['*']

    // Switch to a lex-only user WITHOUT touching the token or the external set
    // and WITHOUT resetting the cache — only the role signature changes.
    setUserRoles([mkRole('legal-director', ['lex:read'])]);
    expect(useAuthStore.getState().hasPermission('dr:read')).toBe(false); // stale `*` gone
    expect(useAuthStore.getState().hasPermission('lex:read')).toBe(true);
  });
});

describe('auth-store hydration state', () => {
  beforeEach(() => {
    useAuthStore.setState({
      isHydrated: false,
      isLoading: true,
    });
  });

  it('markHydrated completes hydration without requiring a session fetch', () => {
    useAuthStore.getState().markHydrated();

    expect(useAuthStore.getState().isHydrated).toBe(true);
    expect(useAuthStore.getState().isLoading).toBe(false);
  });
});
