import { fetchRecoverProducts } from '@/lib/recover/products.server';
import { RecoverEntitlementUnavailable } from './_components/recover-guard-states';
import { RecoverLandingView } from './_components/recover-landing-view';

/**
 * Clario Recover product landing page.
 *
 * Lists the three sub-solutions as capability cards driven by LIVE per-tenant
 * entitlement from `GET /api/recover/products`: entitled sub-solutions get a
 * primary CTA into their workspace; non-entitled ones show a "Request access"
 * affordance instead of a working link. Entitlement is resolved server-side so
 * the page never renders a workspace link the tenant cannot use; the localized
 * chrome + the REAL `GET /api/recover/analytics`-bound portfolio health strip
 * are rendered by the <RecoverLandingView> client component below.
 */
export default async function RecoverLandingPage() {
  const outcome = await fetchRecoverProducts();

  if (outcome.status === 'unauthenticated') {
    // Defense in depth — middleware normally redirects anonymous requests first.
    return <RecoverEntitlementUnavailable label="Clario Recover" />;
  }
  if (outcome.status === 'unavailable') {
    return <RecoverEntitlementUnavailable label="Clario Recover" />;
  }

  return <RecoverLandingView products={outcome.products} />;
}
