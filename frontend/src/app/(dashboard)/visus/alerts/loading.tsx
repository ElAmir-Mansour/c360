import { PageLoader } from '@/components/common/page-loader';

/**
 * Route-segment loading skeleton for Visus Alerts — header → 2-tile KPI row → table. Rendered instantly
 * on navigation into this segment so the header height/KPI grid land before the
 * data resolves (no layout shift). Server-safe; composed from the shared
 * skeleton primitives via <PageLoader>.
 */
export default function Loading() {
  return <PageLoader kpis={2} rows={6} />;
}
