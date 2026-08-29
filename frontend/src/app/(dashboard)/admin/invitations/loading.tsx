import { PageLoader } from '@/components/common/page-loader';

// Invitations landing: four KPI tiles above the invitations table.
export default function Loading() {
  return <PageLoader kpis={4} rows={6} />;
}
