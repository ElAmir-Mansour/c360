import { PageLoader } from '@/components/common/page-loader';

// AI governance landing: KPI tiles above the model registry table.
export default function Loading() {
  return <PageLoader kpis={4} rows={6} />;
}
