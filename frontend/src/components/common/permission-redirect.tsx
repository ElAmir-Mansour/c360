'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { safeRedirect } from '@/lib/safe-redirect';
import { ForbiddenState } from './forbidden-state';
import { LoadingSkeleton } from './loading-skeleton';

interface PermissionRedirectProps {
  permission: string;
  children: React.ReactNode;
}

/**
 * Route-level permission gate.
 *
 * Decision table once the session has resolved:
 *   - unauthenticated (no session, or one that expired while the page was open)
 *     → redirect to `/login?redirect=<path>` (carry the deep link). An expired
 *     session must log the user out of THIS page like every other route — it
 *     must never leave a misleading 403 sitting on a page the user can no longer
 *     see. A 403 only makes sense for a logged-in user who could request access.
 *   - authenticated but lacking the permission → the designed 403 experience
 *     (lock illustration + request-access CTA) IN PLACE — the URL is preserved
 *     so the page works on refresh after access is granted.
 *
 * Mirrors {@link LexAccessGuard}'s unauthenticated → /login branch so both
 * route guards behave identically on session loss.
 */
export function PermissionRedirect({ permission, children }: PermissionRedirectProps) {
  // Subscribe to `user`/`isAuthenticated` (not just the stable hasPermission fn)
  // so this component re-renders the moment the profile/permissions land — and
  // the moment a background silent-refresh failure flips the session to
  // unauthenticated. In this deployment the JWT carries no permissions claim, so
  // hasPermission() resolves from user.roles / the hydrated lex perms; without
  // depending on `user` the gate decision would be made against a not-yet-loaded
  // (or just-cleared) profile.
  const { hasPermission, isHydrated, isAuthenticated, user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  // Auth is only "resolved enough" to make a gating decision once the on-load
  // session refresh has settled (isHydrated) AND either we have a loaded profile
  // (authenticated, user present) or we've definitively concluded there is no
  // session (not authenticated). While authenticated-but-profile-still-loading,
  // we keep showing the skeleton instead of denying on an empty permission set.
  const authResolved = isHydrated && (!isAuthenticated || user !== null);

  // No / expired session → bounce to login carrying the current deep link, so
  // re-auth returns the user here. This is what makes an expired token log the
  // user out of this page instead of stranding them on a 403 they can't act on.
  useEffect(() => {
    if (!authResolved) return;
    if (!isAuthenticated) {
      const target = pathname ? `?redirect=${encodeURIComponent(safeRedirect(pathname))}` : '';
      router.replace(`/login${target}`);
    }
  }, [authResolved, isAuthenticated, pathname, router]);

  // '*:read' is the "any authenticated user" sentinel — no specific permission.
  const allowed = permission === '*:read' || hasPermission(permission);

  if (!authResolved) {
    return <LoadingSkeleton variant="card" count={3} />;
  }

  // Unauthenticated: the effect above is redirecting to /login; render nothing
  // (never the 403) while the navigation settles.
  if (!isAuthenticated) {
    return null;
  }

  if (!allowed) {
    return (
      <ForbiddenState
        permission={permission === '*:read' ? undefined : permission}
        size="page"
      />
    );
  }

  return <>{children}</>;
}
