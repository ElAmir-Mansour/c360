import { PageLoader } from '@/components/common/page-loader';

// Notifications landing: delivery KPI tiles + charts dashboard (no primary table).
export default function Loading() {
  return <PageLoader kpis={4} withChart rows={0} />;
}
