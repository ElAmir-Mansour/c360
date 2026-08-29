import { PageLoader } from '@/components/common/page-loader';

// Roles landing: a responsive grid of role cards (no data table).
export default function Loading() {
  return <PageLoader kpis={6} rows={0} />;
}
