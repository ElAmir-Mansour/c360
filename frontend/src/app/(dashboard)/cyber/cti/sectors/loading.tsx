import { PageLoader } from '@/components/common/page-loader';

export default function Loading() {
  return <PageLoader kpis={4} withChart rows={6} />;
}
