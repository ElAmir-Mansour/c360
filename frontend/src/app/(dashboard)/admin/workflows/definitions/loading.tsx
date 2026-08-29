import { PageLoader } from '@/components/common/page-loader';

/**
 * Route-segment fallback that mirrors the Definitions list layout:
 * header → 4 KPI tiles → definitions table.
 */
export default function Loading() {
  return <PageLoader kpis={4} rows={8} />;
}
