'use client';

import { Spinner } from '@/components/ui/spinner';
import { useDataLabels } from '@/app/(dashboard)/data/_lib/data-i18n';

interface QueryExecutionStatusProps {
  state: 'idle' | 'running' | 'success' | 'error';
  message?: string;
}

export function QueryExecutionStatus({
  state,
  message,
}: QueryExecutionStatusProps) {
  const labels = useDataLabels();
  if (state === 'idle') {
    return null;
  }

  return (
    <div className="rounded-lg border bg-muted/20 p-3 text-sm">
      <div className="flex items-center gap-2">
        {state === 'running' ? <Spinner size="sm" /> : null}
        <span className="font-medium">{labels.analytics.execState[state]}</span>
      </div>
      {message ? <div className="mt-1 text-muted-foreground">{message}</div> : null}
    </div>
  );
}
