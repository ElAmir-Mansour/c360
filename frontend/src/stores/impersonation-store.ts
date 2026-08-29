'use client';

import { create } from 'zustand';

/**
 * Holds the active impersonation ("view as tenant") grant minted by G5
 * (POST /api/v1/admin/tenants/{id}/impersonate). While `active` is true the
 * axios request interceptor (src/lib/api.ts) swaps the Authorization header to
 * use `token` instead of the operator's normal access token, so every downstream
 * call is attributed to the impersonated session and honours its `readonly`
 * claim. The grant is deliberately NOT persisted — it is short-TTL (≤15 min),
 * security-sensitive, and must die with the tab (§E.2 hard requirements).
 */
export interface ImpersonationState {
  /** Minted impersonation access token (RS256 JWT with act_as/impersonated_by). */
  token: string | null;
  tenantId: string | null;
  tenantName: string | null;
  userId: string | null;
  /** ISO-8601 hard expiry. */
  expiresAt: string | null;
  /** True while a grant is in effect and should override the normal token. */
  active: boolean;

  start: (grant: {
    token: string;
    tenantId: string;
    tenantName?: string | null;
    userId?: string | null;
    expiresAt: string;
  }) => void;
  stop: () => void;
}

const initial = {
  token: null,
  tenantId: null,
  tenantName: null,
  userId: null,
  expiresAt: null,
  active: false,
} as const;

export const useImpersonationStore = create<ImpersonationState>((set) => ({
  ...initial,

  start: (grant) =>
    set({
      token: grant.token,
      tenantId: grant.tenantId,
      tenantName: grant.tenantName ?? null,
      userId: grant.userId ?? null,
      expiresAt: grant.expiresAt,
      active: true,
    }),

  stop: () => set({ ...initial }),
}));

/**
 * Non-hook accessor for the active impersonation token, read by the axios
 * request interceptor (which runs outside React). Returns null when no grant is
 * active OR the grant has expired — so a stale token is never sent on the wire.
 */
export function getActiveImpersonationToken(): string | null {
  const { active, token, expiresAt } = useImpersonationStore.getState();
  if (!active || !token) return null;
  if (expiresAt && Date.parse(expiresAt) <= Date.now()) return null;
  return token;
}
