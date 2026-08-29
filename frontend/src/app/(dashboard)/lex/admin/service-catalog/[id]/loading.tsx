import { PageLoader } from '@/components/common/page-loader';

/**
 * Service detail is a header + a detail view (metadata cards and a
 * requirements/SLA table), so we drop the KPI strip and render a table-shaped
 * placeholder for the detail body.
 */
export default function Loading() {
  return <PageLoader kpis={0} rows={6} />;
}
