import { PageLoader } from '@/components/common/page-loader';

/**
 * Route-level loading UI for Legal-Ops Analytics. Renders the shared page
 * skeleton with a 6-tile KPI strip placeholder so the header height matches the
 * resolved page (no layout shift when data lands).
 */
export default function Loading() {
  return <PageLoader kpis={6} />;
}
