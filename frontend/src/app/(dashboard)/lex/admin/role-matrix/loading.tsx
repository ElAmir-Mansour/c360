import { PageLoader } from '@/components/common/page-loader';

/**
 * The role matrix has no KPI strip — it is a header, a legend band and a wide
 * capability×role grid — so we suppress the KPI cards and render a taller table
 * block that stands in for the matrix while the client data resolves.
 */
export default function Loading() {
  return <PageLoader kpis={0} rows={10} />;
}
