'use client';

/**
 * Route-level access guard for Lex (Watheeq) page bodies.
 *
 * Source of truth: docs/ClarioWatheeq/Lex_Codebase_RBAC_Map.md §8 (route/permission
 * map), §18.3 (page-level guards). The Wave-1 foundation
 * (src/lib/permissions.ts) already exposes:
 *   - `LEX_ROUTE_PERMISSIONS` — the canonical route → PermissionRequirement registry,
 *   - `canAccessWith(hasPermission, requirement)` — the shared evaluator that
 *     delegates wildcard semantics to the authoritative `checkPermission` resolver.
 *
 * The existing `<PermissionRedirect permission="...">` only accepts a single
 * permission STRING; many Lex routes (drafting, playbooks, clause-library,
 * regulations, analytics/risk, entities, calendar, inbox, …) declare an
 * `{ anyOf: [...] }` requirement. Rather than fork/modify `PermissionRedirect`
 * (which is off-limits and string-only), this guard re-uses its EXACT hydration
 * + redirect behaviour while accepting a full {@link PermissionRequirement}.
 *
 * Behaviour mirrors PermissionRedirect:
 *   - waits for the on-load session refresh to settle (isHydrated) AND either an
 *     authenticated profile to load OR a definitive no-session conclusion before
 *     deciding — never redirects on a not-yet-loaded permission set;
 *   - shows the same `<LoadingSkeleton variant="card" count={3} />` placeholder;
 *   - unauthenticated (no session, or one that expired while the page was open)
 *     → redirect to `/login?redirect=<path>`, carrying the deep link so re-auth
 *     returns the user here. An expired session must log the user out of THIS
 *     page like every other route, never strand them on stale content;
 *   - authenticated but NOT permitted → redirect to `/dashboard` (matches
 *     PermissionRedirect; the dedicated access-denied page is a separate Wave-3
 *     concern, intentionally NOT /login).
 *
 * Backend authorization remains the security boundary; this is a UX layer only.
 */

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { safeRedirect } from '@/lib/safe-redirect';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import {
  canAccessWith,
  LEX_ROUTE_PERMISSIONS,
  type PermissionRequirement,
} from '@/lib/permissions';

interface LexRouteGuardProps {
  /**
   * Either an explicit {@link PermissionRequirement} or a key into
   * {@link LEX_ROUTE_PERMISSIONS}. When a `route` is given it takes precedence;
   * if the route key is unknown the guard fails closed (renders nothing for
   * authenticated users) so a typo can never silently widen access.
   */
  requirement?: PermissionRequirement;
  /** Route key into LEX_ROUTE_PERMISSIONS (e.g. `'/lex/cases'`). */
  route?: keyof typeof LEX_ROUTE_PERMISSIONS | string;
  children: React.ReactNode;
}

export function LexRouteGuard({ requirement, route, children }: LexRouteGuardProps) {
  const { hasPermission, isHydrated, isAuthenticated, user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  // Resolve the requirement: explicit prop wins, else look it up by route key.
  const resolved: PermissionRequirement | undefined = route
    ? (LEX_ROUTE_PERMISSIONS as Record<string, PermissionRequirement>)[route]
    : requirement;

  // Fail closed: a `route` that isn't in the registry must NOT default-allow.
  const requirementMissing = route !== undefined && resolved === undefined;

  // Auth is "resolved enough" to decide once the on-load refresh settled AND we
  // either have a loaded profile or have definitively concluded no session.
  const authResolved = isHydrated && (!isAuthenticated || user !== null);

  const allowed = !requirementMissing && canAccessWith(hasPermission, resolved);

  useEffect(() => {
    if (!authResolved) return;
    // No / expired session → bounce to login carrying the current deep link, so
    // re-auth returns the user here instead of stranding them on this page.
    if (!isAuthenticated) {
      const target = pathname ? `?redirect=${encodeURIComponent(safeRedirect(pathname))}` : '';
      router.replace(`/login${target}`);
      return;
    }
    // Authenticated but not permitted → /dashboard (access-denied is separate).
    if (!allowed) {
      router.replace('/dashboard');
    }
  }, [authResolved, isAuthenticated, allowed, pathname, router]);

  if (!authResolved) {
    return <LoadingSkeleton variant="card" count={3} />;
  }

  // Unauthenticated or denied: the effect above is redirecting; render nothing
  // while the navigation settles.
  if (!isAuthenticated || !allowed) {
    return null;
  }

  return <>{children}</>;
}
