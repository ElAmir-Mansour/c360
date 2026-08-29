import { PageLoader } from '@/components/common/page-loader';

/**
 * Route-segment fallback that mirrors the Platform Overview layout:
 * header → 4 KPI tiles → service-health table.
 */
export default function Loading() {
  return <PageLoader kpis={4} rows={6} />;
}
