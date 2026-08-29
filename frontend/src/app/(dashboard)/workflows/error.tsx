'use client';

import { RouteError } from '@/components/common/route-error';
import { useWorkflowPageLabels } from './_lib/workflow-page-i18n';

export default function Error(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const labels = useWorkflowPageLabels();

  return <RouteError {...props} segment={labels.common.workflows} />;
}
