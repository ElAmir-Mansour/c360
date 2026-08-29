// Server-only module: `next/headers` (cookies) is unavailable in the browser,
// which keeps this from being imported into a client bundle. Named `.server.ts`
// by convention; consumed only by server components (the route guard + landing).
import { cookies } from 'next/headers';
import { COOKIES } from '@/lib/constants';
import { getServerApiUrl } from '@/lib/env';
import type {
  RecoverProductView,
  RecoverSubSolution,
  RecoverSubSolutionSlug,
} from '@/types/recover';
import { RECOVER_SUB_SOLUTION_SLUGS } from '@/types/recover';

/**
 * Server-side resolver for the Recover product view.
 *
 * This is the authoritative source for the SERVER-SIDE route guard: a tenant's
 * per-sub-solution entitlement is resolved live by the backend licensing engine
 * (`GET /api/recover/products`) and is never inferred from the client. The
 * access token is read from the httpOnly cookie and forwarded as a bearer; the
 * browser's in-memory token is never required.
 *
 * The result is a discriminated outcome so callers (the guard, the landing page)
 * can render real loading/error/denied states instead of guessing:
 *  - `ok`            → products resolved; gate on `sub_solutions[].entitlement.active`
 *  - `unauthenticated` → no session cookie (middleware normally redirects first)
 *  - `unavailable`   → licensing engine unreachable / 5xx (fail-closed; show retry)
 */
export type RecoverProductsOutcome =
  | { status: 'ok'; products: RecoverProductView }
  | { status: 'unauthenticated' }
  | { status: 'unavailable'; httpStatus?: number };

const PRODUCTS_PATH = '/api/recover/products';
const REQUEST_TIMEOUT_MS = 8000;

interface ProductsEnvelope {
  data?: RecoverProductView;
}

/**
 * Fetches `GET /api/recover/products` with the caller's session, returning a
 * typed outcome. Never throws — a transport failure surfaces as `unavailable`
 * so the guard fails closed (rejects) rather than silently granting access.
 */
export async function fetchRecoverProducts(): Promise<RecoverProductsOutcome> {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(COOKIES.ACCESS)?.value;
  if (!accessToken) {
    return { status: 'unauthenticated' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${getServerApiUrl()}${PRODUCTS_PATH}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
      cache: 'no-store',
      signal: controller.signal,
    });

    if (response.status === 401 || response.status === 403) {
      return { status: 'unauthenticated' };
    }
    if (!response.ok) {
      return { status: 'unavailable', httpStatus: response.status };
    }

    const body = (await response.json()) as ProductsEnvelope;
    const products = body.data;
    if (!products || !Array.isArray(products.sub_solutions)) {
      return { status: 'unavailable', httpStatus: response.status };
    }
    return { status: 'ok', products };
  } catch {
    // Network failure / timeout / abort — fail closed.
    return { status: 'unavailable' };
  } finally {
    clearTimeout(timer);
  }
}

/** Type guard for a valid Recover sub-solution slug. */
export function isRecoverSubSolutionSlug(
  value: string,
): value is RecoverSubSolutionSlug {
  return (RECOVER_SUB_SOLUTION_SLUGS as readonly string[]).includes(value);
}

/** Looks up a sub-solution in a product view by slug. */
export function findSubSolution(
  products: RecoverProductView,
  slug: RecoverSubSolutionSlug,
): RecoverSubSolution | undefined {
  return products.sub_solutions.find((s) => s.id === slug);
}

/**
 * Server-side entitlement decision for one sub-solution.
 *
 *  - `granted`         → render the workspace
 *  - `denied`          → authenticated but the tenant is not licensed (or has not
 *                        activated) this sub-solution → reject (not just hide)
 *  - `unauthenticated` → no session
 *  - `unavailable`     → licensing engine unreachable → fail closed
 */
export type RecoverGuardDecision =
  | { status: 'granted'; subSolution: RecoverSubSolution }
  | { status: 'denied'; subSolution?: RecoverSubSolution }
  | { status: 'unauthenticated' }
  | { status: 'unavailable' };

/**
 * Resolves whether the calling tenant may access a sub-solution workspace.
 *
 * Access is granted only when the licensing engine reports the sub-solution as
 * `active` for the tenant. This is enforced server-side: an unentitled tenant
 * who navigates directly to the route is REJECTED here, before any workspace
 * component renders — the nav merely hiding the link is not the control.
 */
export async function resolveRecoverGuard(
  slug: RecoverSubSolutionSlug,
): Promise<RecoverGuardDecision> {
  const outcome = await fetchRecoverProducts();
  switch (outcome.status) {
    case 'unauthenticated':
      return { status: 'unauthenticated' };
    case 'unavailable':
      return { status: 'unavailable' };
    case 'ok': {
      const subSolution = findSubSolution(outcome.products, slug);
      if (subSolution && subSolution.entitlement.active) {
        return { status: 'granted', subSolution };
      }
      return { status: 'denied', subSolution };
    }
  }
}
