'use client';

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { type PipelineRun, type PipelineRunLog } from '@/lib/data-suite';
import { formatMaybeBytes, formatMaybeCompact, formatMaybeDateTime, formatMaybeDurationMs } from '@/lib/data-suite/utils';
import { QualityGateResults } from '@/app/(dashboard)/data/pipelines/[id]/_components/quality-gate-results';
import { RunLogViewer } from '@/app/(dashboard)/data/pipelines/[id]/_components/run-log-viewer';
import { useDataLabels } from '@/app/(dashboard)/data/_lib/data-i18n';

interface RunDetailPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  run: PipelineRun | null;
  logs: PipelineRunLog[];
}

export function RunDetailPanel({
  open,
  onOpenChange,
  run,
  logs,
}: RunDetailPanelProps) {
  const labels = useDataLabels();
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>{labels.pipelinesDetail.runDetailTitle}</SheetTitle>
          <SheetDescription>
            {run ? labels.pipelinesDetail.runDesc(run.id, run.status) : labels.pipelinesDetail.selectRunPrompt}
          </SheetDescription>
        </SheetHeader>

        {run ? (
          <div className="mt-6 space-y-6">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Metric label={labels.common.status} value={run.status} />
              <Metric label={labels.pipelinesDetail.mCurrentPhase} value={run.current_phase ?? '—'} />
              <Metric label={labels.pipelinesDetail.mStarted} value={formatMaybeDateTime(run.started_at)} />
              <Metric label={labels.pipelinesDetail.mCompleted} value={formatMaybeDateTime(run.completed_at)} />
              <Metric label={labels.pipelinesDetail.colDuration} value={formatMaybeDurationMs(run.duration_ms)} />
              <Metric label={labels.pipelinesDetail.mBytesWritten} value={formatMaybeBytes(run.bytes_written)} />
              <Metric label={labels.pipelinesDetail.mExtracted} value={formatMaybeCompact(run.records_extracted)} />
              <Metric label={labels.pipelinesDetail.mLoaded} value={formatMaybeCompact(run.records_loaded)} />
            </div>

            <div className="space-y-3">
              <h4 className="font-medium">{labels.pipelinesDetail.qualityGatesTitle}</h4>
              <QualityGateResults results={run.quality_gate_results} />
            </div>

            <div className="space-y-3">
              <h4 className="font-medium">{labels.pipelinesDetail.executionLog}</h4>
              <RunLogViewer logs={logs} />
            </div>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function Metric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-medium capitalize">{value}</div>
    </div>
  );
}
