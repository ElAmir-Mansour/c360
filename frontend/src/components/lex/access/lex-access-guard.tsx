'use client';

import { useEffect, useMemo } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { safeRedirect } from '@/lib/safe-redirect';
import {
  canAccessWith,
  LEX_ROUTE_PERMISSIONS,
  type PermissionRequirement,
} from '@/lib/permissions';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { LexAccessDenied } from './lex-access-denied';
import { useLexAccess } from './use-lex-access';

interface RouteRequirementResolution {
  requirement?: PermissionRequirement;
  known: boolean;
}

function hasOwnRouteRequirement(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(LEX_ROUTE_PERMISSIONS, key);
}

function resolveRouteRequirement(key: string): RouteRequirementResolution {
  if (hasOwnRouteRequirement(key)) {
    return { requirement: LEX_ROUTE_PERMISSIONS[key], known: true };
  }

  const wildcardKey = Object.keys(LEX_ROUTE_PERMISSIONS)
    .filter((candidate) => candidate.endsWith('/*') && key.startsWith(candidate.slice(0, -1)))
    .sort((a, b) => b.length - a.length)[0];

  if (wildcardKey) {
    return { requirement: LEX_ROUTE_PERMISSIONS[wildcardKey], known: true };
  }

  return { known: false };
}

export interface LexAccessGuardProps {
  /**
   * The permission requirement to enforce. When omitted, it is resolved from
   * {@link LEX_ROUTE_PERMISSIONS} using the current pathname (or an explicit
   * `routeKey`), so callers usually just wrap their page with `<LexAccessGuard>`.
   */
  requirement?: PermissionRequirement;
  /** Explicit registry key (e.g. '/lex/cases') when the pathname is dynamic. */
  routeKey?: string;
  /** Human resource name surfaced in the access-denied copy. */
  resourceName?: string;
  children: React.ReactNode;
}

/**
 * Lex route guard (§6 "Deep-link behavior", §15 Access-Denied UX).
 *
 * Decision table for a direct/deep-link visit:
 *   - unauthenticated            → redirect to `/login?redirect=<path>` (login).
 *   - authenticated + permitted  → render children.
 *   - authenticated + NOT permitted → render the {@link LexAccessDenied} view
 *     (required permission + active legal role + a "Switch persona" affordance),
 *     NOT a silent redirect to /dashboard.
 *
 * Reuses the auth store's `hasPermission` (via `useAuth`) + the shared
 * `canAccessWith` + the central `LEX_ROUTE_PERMISSIONS` registry. The backend is
 * authoritative; this is the UX layer. `/lex/me` is fetched lazily — only once
 * access is denied — so a permitted page pays no extra round-trip.
 */
export function LexAccessGuard({
  requirement,
  routeKey,
  resourceName,
  children,
}: LexAccessGuardProps) {
  const { hasPermission, isHydrated, isAuthenticated, user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  // Resolve the effective requirement: explicit prop wins, else registry lookup
  // keyed by an explicit routeKey or the live pathname. Unknown registry keys
  // are treated as denied, not as "no requirement".
  const routeResolution = useMemo<RouteRequirementResolution>(() => {
    if (requirement !== undefined) return { requirement, known: true };
    const key = routeKey ?? pathname ?? '';
    return resolveRouteRequirement(key);
  }, [requirement, routeKey, pathname]);
  const effectiveRequirement = routeResolution.requirement;

  // Mirror PermissionRedirect's resolution gate: only decide once the on-load
  // session refresh has settled AND we either have a loaded profile or have
  // definitively concluded there is no session.
  const authResolved = isHydrated && (!isAuthenticated || user !== null);
  const permitted =
    authResolved &&
    isAuthenticated &&
    routeResolution.known &&
    canAccessWith(hasPermission, effectiveRequirement);
  const deniedAuthenticated = authResolved && isAuthenticated && !permitted;

  // Only hit `/api/v1/lex/me` when we actually need the persona context to
  // render a helpful denial; never for a permitted page or an anonymous visit.
  const { me, switchPersona } = useLexAccess(deniedAuthenticated);

  useEffect(() => {
    if (!authResolved) return;
    if (!isAuthenticated) {
      const target = pathname ? `?redirect=${encodeURIComponent(safeRedirect(pathname))}` : '';
      router.replace(`/login${target}`);
    }
  }, [authResolved, isAuthenticated, pathname, router]);

  if (!authResolved) {
    return <LoadingSkeleton variant="card" count={3} />;
  }

  // Unauthenticated: the effect above is redirecting to login; render nothing.
  if (!isAuthenticated) {
    return null;
  }

  if (permitted) {
    return <>{children}</>;
  }

  // Authenticated but not permitted → explicit access-denied (no silent redirect).
  return (
    <LexAccessDenied
      requirement={effectiveRequirement}
      resourceName={resourceName}
      activeRole={me?.active_legal_role ?? null}
      availableRoles={me?.available_legal_roles ?? []}
      accessState={me?.access_state}
      onSwitchPersona={switchPersona}
    />
  );
}
