'use client';

import { Progress } from '@/components/ui/progress';
import { type PipelineRun } from '@/lib/data-suite';
import { formatMaybeCompact } from '@/lib/data-suite/utils';
import { useDataLabels } from '@/app/(dashboard)/data/_lib/data-i18n';

interface RunProgressTrackerProps {
  run: PipelineRun | null;
}

export function RunProgressTracker({
  run,
}: RunProgressTrackerProps) {
  const labels = useDataLabels();

  if (!run || run.status !== 'running') {
    return null;
  }

  const total = Math.max(run.records_extracted, run.records_transformed, run.records_loaded, 1);
  const progress = Math.min(100, Math.round((run.records_loaded / total) * 100));

  return (
    <div className="rounded-lg border bg-primary/5 p-4">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">{labels.pipelinesDetail.pipelineRunning}</span>
        <span className="capitalize text-muted-foreground">{run.current_phase ?? labels.pipelinesDetail.processing}</span>
      </div>
      <Progress className="mt-3" value={progress} />
      <div className="mt-2 text-xs text-muted-foreground">
        {labels.pipelinesDetail.loadedOf(formatMaybeCompact(run.records_loaded), formatMaybeCompact(total))}
      </div>
    </div>
  );
}
