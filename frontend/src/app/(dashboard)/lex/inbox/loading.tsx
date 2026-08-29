import { PageLoader } from '@/components/common/page-loader';

/**
 * Route-level loading skeleton for the Approvals Inbox. Three KPI tiles up top
 * (pending / due today / overdue) plus list placeholders, matching the page
 * chrome so there is no layout jump when the data resolves.
 */
export default function Loading() {
  return <PageLoader kpis={3} />;
}
