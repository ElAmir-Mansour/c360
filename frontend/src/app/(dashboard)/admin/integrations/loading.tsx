import { PageLoader } from '@/components/common/page-loader';

// Integrations landing: a grid of connector catalogue tiles (no data table).
export default function Loading() {
  return <PageLoader kpis={6} rows={0} />;
}
