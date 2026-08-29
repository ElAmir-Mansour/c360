'use client';

import { ScrollArea } from '@/components/ui/scroll-area';
import { type PipelineRunLog } from '@/lib/data-suite';
import { formatMaybeDateTime } from '@/lib/data-suite/utils';
import { useDataLabels } from '@/app/(dashboard)/data/_lib/data-i18n';

interface RunLogViewerProps {
  logs: PipelineRunLog[];
}

export function RunLogViewer({
  logs,
}: RunLogViewerProps) {
  const labels = useDataLabels();

  if (logs.length === 0) {
    return <p className="text-sm text-muted-foreground">{labels.pipelinesDetail.noLogs}</p>;
  }

  return (
    <div className="rounded-lg border">
      <ScrollArea className="h-[320px]">
        <div className="space-y-2 p-4">
          {logs.map((log) => (
            <div key={log.id} className="rounded-md border bg-muted/20 p-3 font-mono text-xs">
              <div className="flex flex-wrap gap-2 text-muted-foreground">
                <span>{formatMaybeDateTime(log.created_at)}</span>
                <span>{log.level.toUpperCase()}</span>
                <span>{log.phase}</span>
              </div>
              <div className="mt-2 text-foreground">{log.message}</div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
