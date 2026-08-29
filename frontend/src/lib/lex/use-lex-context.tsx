'use client';

/**
 * Lex (Watheeq) PERSONA CONTEXT — the single client-side source of truth for the
 * active legal persona, the user's available legal roles, the granular effective
 * permissions, capabilities, persona landing and access state.
 *
 * Source of truth: docs/ClarioWatheeq/Lex_Codebase_RBAC_Map.md §4/§5/§6/§14.
 *
 * Responsibilities:
 *   1. Fetch `GET /api/v1/lex/me` (react-query, cached per session) once the
 *      auth store has hydrated an authenticated session.
 *   2. CRITICAL — merge the response `effective_permissions` into the auth
 *      store's permission source (setExternalPermissions) so the Phase-1
 *      granular sidebar + every page/action gate evaluate true at runtime for a
 *      legal-role user. The keys come from `/lex/me`, NOT the JWT.
 *   3. Expose `switchPersona(slug)` which POSTs `/api/v1/lex/persona` and
 *      refreshes the cached context (and re-merges the new effective perms).
 *
 * Backend authorization remains authoritative; this is a UX layer only.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { useAuthStore, setExternalPermissions } from '@/stores/auth-store';
import { fetchLexMe, switchLexPersona } from './me';
import type {
  LegalRoleSummary,
  LexAccessState,
  LexCapabilities,
  LexMeResponse,
} from './types';

/** react-query key for the persona context. Exported so tests / invalidators reuse it. */
export const LEX_ME_QUERY_KEY = ['lex', 'me'] as const;

/** Shape exposed to consumers (role badge, persona switcher, capabilities sheet, home). */
export interface LexContextValue {
  /** The active persona, or null when the user holds no legal role. */
  activeRole: LegalRoleSummary | null;
  /** Every legal role the user holds (length > 1 ⇒ show the persona switcher). */
  availableRoles: LegalRoleSummary[];
  /** Boolean capability map for the active persona. */
  capabilities: LexCapabilities;
  /** Granular `lex:<domain>:<verb>` keys for the active persona. */
  effectivePermissions: string[];
  /** Backend-recommended landing for the active persona (may be a future route). */
  personaLanding: string;
  /** Whether the user has a usable lex persona. */
  accessState: LexAccessState;
  /** Monotonic permission version from the backend (cache-bust hint). */
  permissionVersion: string;
  /** True while the initial `/me` fetch is in flight. */
  loading: boolean;
  /** True while a persona switch is in flight. */
  switching: boolean;
  /** Fetch / switch error, if any. */
  error: unknown;
  /**
   * Switch the active persona. Resolves with the refreshed context. Rejects
   * (e.g. 403 PERSONA_NOT_AVAILABLE) when the requested role is not held — the
   * caller decides how to surface that.
   */
  switchPersona: (roleSlug: string) => Promise<LexMeResponse>;
  /** Force a re-fetch of `/lex/me` (rarely needed; switch already refreshes). */
  refresh: () => Promise<unknown>;
}

const EMPTY_ROLES: LegalRoleSummary[] = [];
const EMPTY_CAPS: LexCapabilities = {};
const EMPTY_PERMS: string[] = [];

const DEFAULT_VALUE: LexContextValue = {
  activeRole: null,
  availableRoles: EMPTY_ROLES,
  capabilities: EMPTY_CAPS,
  effectivePermissions: EMPTY_PERMS,
  personaLanding: '/lex',
  accessState: 'NO_LEX_ROLE_ASSIGNED',
  permissionVersion: '',
  loading: false,
  switching: false,
  error: null,
  switchPersona: async () => {
    throw new Error('LexContextProvider is not mounted');
  },
  refresh: async () => undefined,
};

const LexContext = createContext<LexContextValue>(DEFAULT_VALUE);

/**
 * Push the active persona's effective permissions into the auth store's merge
 * source. Centralised so the query `onSuccess`, the mutation `onSuccess`, and
 * the unmount cleanup all stay consistent. A null/absent payload clears them.
 */
function hydratePermissions(me: LexMeResponse | undefined | null): void {
  setExternalPermissions(me?.effective_permissions ?? []);
}

interface LexContextProviderProps {
  children: ReactNode;
  /**
   * Test seam: when provided, the provider treats the session as
   * authenticated+hydrated regardless of the auth store, so the context can be
   * unit-tested offline without a real session.
   */
  forceEnabled?: boolean;
}

export function LexContextProvider({ children, forceEnabled }: LexContextProviderProps) {
  const queryClient = useQueryClient();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isHydrated = useAuthStore((s) => s.isHydrated);

  // Only fetch once we have an authenticated, hydrated session — never on the
  // login screen or before bootstrap settles (avoids a guaranteed 401 round-trip).
  const enabled = forceEnabled ?? (isAuthenticated && isHydrated);

  const query = useQuery({
    queryKey: LEX_ME_QUERY_KEY,
    queryFn: fetchLexMe,
    enabled,
    // Persona context rarely changes mid-session; cache it and don't refetch on
    // focus (the QueryProvider already disables focus refetch globally).
    staleTime: 5 * 60 * 1000,
    // A non-lex user gets NO_LEX_ROLE_ASSIGNED (a 200), and a user with no lex
    // entitlement may 403 — don't hammer either; the global retry policy already
    // skips 401/403/404.
  });

  const mutation = useMutation({
    mutationFn: (roleSlug: string) => switchLexPersona(roleSlug),
    onSuccess: (me) => {
      // Seed the cache with the refreshed context so consumers update without a
      // second round-trip, and re-merge the new persona's effective perms.
      queryClient.setQueryData(LEX_ME_QUERY_KEY, me);
      hydratePermissions(me);
    },
  });

  const me = query.data;

  // Merge effective permissions into the auth store whenever the fetched context
  // changes. Effect (not render) so we never mutate shared module state during
  // render. Cleared on disable/unmount so a logout or a non-lex route reverts to
  // pure-JWT behaviour.
  useEffect(() => {
    if (!enabled) {
      setExternalPermissions([]);
      return;
    }
    hydratePermissions(me);
  }, [enabled, me]);

  useEffect(() => {
    return () => {
      // On unmount, drop the hydrated perms so they can't leak past the lex shell.
      setExternalPermissions([]);
    };
  }, []);

  const switchPersona = useCallback(
    (roleSlug: string) => mutation.mutateAsync(roleSlug),
    [mutation],
  );

  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey: LEX_ME_QUERY_KEY }),
    [queryClient],
  );

  const value = useMemo<LexContextValue>(
    () => ({
      activeRole: me?.active_legal_role ?? null,
      availableRoles: me?.available_legal_roles ?? EMPTY_ROLES,
      capabilities: me?.capabilities ?? EMPTY_CAPS,
      effectivePermissions: me?.effective_permissions ?? EMPTY_PERMS,
      personaLanding: me?.persona_landing ?? '/lex',
      accessState: me?.access_state ?? 'NO_LEX_ROLE_ASSIGNED',
      permissionVersion: me?.permission_version ?? '',
      loading: enabled && query.isLoading,
      switching: mutation.isPending,
      error: query.error ?? mutation.error ?? null,
      switchPersona,
      refresh,
    }),
    [
      me,
      enabled,
      query.isLoading,
      query.error,
      mutation.isPending,
      mutation.error,
      switchPersona,
      refresh,
    ],
  );

  return <LexContext.Provider value={value}>{children}</LexContext.Provider>;
}

/**
 * Read the Lex persona context. Returns the {@link DEFAULT_VALUE} (no active
 * role) when no provider is mounted, so a stray consumer never throws — but the
 * lex shell always mounts {@link LexContextProvider}.
 */
export function useLexContext(): LexContextValue {
  return useContext(LexContext);
}

/** Test helper: prime react-query's cache with a fixed `/lex/me` payload. */
export function seedLexMe(client: QueryClient, me: LexMeResponse): void {
  client.setQueryData(LEX_ME_QUERY_KEY, me);
}
