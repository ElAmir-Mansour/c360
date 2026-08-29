import { PageLoader } from '@/components/common/page-loader';

// Tenants landing: header + paginated tenant table (no KPI row).
export default function Loading() {
  return <PageLoader kpis={0} rows={8} />;
}
