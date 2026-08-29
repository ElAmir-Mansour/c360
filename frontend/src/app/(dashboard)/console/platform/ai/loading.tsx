import { PageLoader } from '@/components/common/page-loader';

/**
 * Route-segment loading skeleton for Platform AI Governance — header → 4-tile KPI row → table. Rendered instantly
 * on navigation into this segment so the header height/KPI grid land before the
 * data resolves (no layout shift). Server-safe; composed from the shared
 * skeleton primitives via <PageLoader>.
 */
export default function Loading() {
  return <PageLoader kpis={4} rows={6} />;
}
