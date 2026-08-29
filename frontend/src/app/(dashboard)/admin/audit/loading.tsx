import { PageLoader } from '@/components/common/page-loader';

// Audit landing: stats tiles + dashboard chart above the tamper-evident log table.
export default function Loading() {
  return <PageLoader kpis={4} withChart rows={6} />;
}
