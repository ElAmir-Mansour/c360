import { PageLoader } from '@/components/common/page-loader';

/**
 * Route-segment loading skeleton for Drafting — header → table. Rendered instantly
 * on navigation into this segment so the header height/KPI grid land before the
 * data resolves (no layout shift). Server-safe; composed from the shared
 * skeleton primitives via <PageLoader>.
 */
export default function Loading() {
  return <PageLoader kpis={0} rows={6} />;
}
