import { PageLoader } from '@/components/common/page-loader';

/**
 * Route-segment fallback that mirrors the Workflow Analytics layout:
 * header → 4 KPI tiles → status chart → workload table.
 */
export default function Loading() {
  return <PageLoader kpis={4} withChart rows={6} />;
}
