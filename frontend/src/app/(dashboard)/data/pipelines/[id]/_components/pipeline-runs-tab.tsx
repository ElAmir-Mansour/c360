'use client';

import { type PipelineRun } from '@/lib/data-suite';
import { formatMaybeCompact, formatMaybeDateTime, formatMaybeDurationMs } from '@/lib/data-suite/utils';
import { Button } from '@/components/ui/button';
import { useDataLabels } from '@/app/(dashboard)/data/_lib/data-i18n';

interface PipelineRunsTabProps {
  runs: PipelineRun[];
  onSelectRun: (run: PipelineRun) => void;
}

export function PipelineRunsTab({
  runs,
  onSelectRun,
}: PipelineRunsTabProps) {
  const labels = useDataLabels();

  if (runs.length === 0) {
    return <p className="text-sm text-muted-foreground">{labels.pipelinesDetail.noRuns}</p>;
  }

  return (
    <div className="rounded-lg border">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b text-start">
            <th className="px-3 py-2 font-medium">{labels.common.status}</th>
            <th className="px-3 py-2 font-medium">{labels.pipelinesDetail.colPhase}</th>
            <th className="px-3 py-2 font-medium">{labels.pipelinesDetail.colLoaded}</th>
            <th className="px-3 py-2 font-medium">{labels.pipelinesDetail.colDuration}</th>
            <th className="px-3 py-2 font-medium">{labels.pipelinesDetail.colCompleted}</th>
            <th className="px-3 py-2 font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.id} className="border-b">
              <td className="px-3 py-2 capitalize">{run.status}</td>
              <td className="px-3 py-2 capitalize text-muted-foreground">{run.current_phase ?? '—'}</td>
              <td className="px-3 py-2 text-muted-foreground">{formatMaybeCompact(run.records_loaded)}</td>
              <td className="px-3 py-2 text-muted-foreground">{formatMaybeDurationMs(run.duration_ms)}</td>
              <td className="px-3 py-2 text-muted-foreground">{formatMaybeDateTime(run.completed_at ?? run.started_at)}</td>
              <td className="px-3 py-2">
                <Button type="button" variant="outline" size="sm" onClick={() => onSelectRun(run)}>
                  {labels.pipelinesDetail.inspect}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
