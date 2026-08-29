import { PageLoader } from '@/components/common/page-loader';

// Automation landing: tabbed console (automations / runs / runbooks) — header,
// form column and list column approximated by a compact skeleton.
export default function Loading() {
  return <PageLoader kpis={0} rows={6} />;
}
