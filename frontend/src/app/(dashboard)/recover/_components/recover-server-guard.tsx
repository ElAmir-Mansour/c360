import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import {
  resolveRecoverGuard,
  type RecoverGuardDecision,
} from '@/lib/recover/products.server';
import type { RecoverSubSolutionSlug } from '@/types/recover';
import {
  RecoverAccessDenied,
  RecoverEntitlementUnavailable,
} from './recover-guard-states';

interface RecoverServerGuardProps {
  slug: RecoverSubSolutionSlug;
  children: ReactNode;
}

/**
 * SERVER-SIDE entitlement guard for a Recover sub-solution workspace.
 *
 * Runs on the server before any workspace component renders. It resolves the
 * tenant's live licensing entitlement (`GET /api/recover/products`) and:
 *  - GRANTS  → renders the workspace.
 *  - DENIES  → renders the "not licensed / request access" surface (HTTP-level
 *              rejection: the unentitled tenant never sees the workspace, even
 *              if they navigate directly to the URL — hiding the nav link is not
 *              the control).
 *  - UNAVAILABLE → fails CLOSED with an "entitlement unavailable" surface.
 *  - UNAUTHENTICATED → redirects to login (defense in depth; middleware would
 *              normally have redirected an anonymous request already).
 *
 * Each sub-solution layout wraps its `children` in this guard, so the guarantee
 * holds for the workspace landing page and every nested route beneath it.
 */
export async function RecoverServerGuard({
  slug,
  children,
}: RecoverServerGuardProps) {
  const decision: RecoverGuardDecision = await resolveRecoverGuard(slug);

  switch (decision.status) {
    case 'granted':
      return <>{children}</>;
    case 'denied':
      return <RecoverAccessDenied slug={slug} subSolution={decision.subSolution} />;
    case 'unavailable':
      return <RecoverEntitlementUnavailable slug={slug} />;
    case 'unauthenticated':
      redirect(`/login?redirect=/recover/${slug}`);
  }
}
