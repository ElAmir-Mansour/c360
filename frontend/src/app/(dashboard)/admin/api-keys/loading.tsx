import { PageLoader } from '@/components/common/page-loader';

// API keys landing: header + the API-key table (no KPI row).
export default function Loading() {
  return <PageLoader kpis={0} rows={6} />;
}
