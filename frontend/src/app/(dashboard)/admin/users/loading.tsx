import { PageLoader } from '@/components/common/page-loader';

// Users landing: three KPI tiles above the paginated user table.
export default function Loading() {
  return <PageLoader kpis={3} rows={8} />;
}
