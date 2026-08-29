import { PageLoader } from '@/components/common/page-loader';

/**
 * Route-segment fallback that mirrors the admin Tasks list layout:
 * header → 4 KPI tiles → task table.
 */
export default function Loading() {
  return <PageLoader kpis={4} rows={8} />;
}
