'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { type QualityResult } from '@/lib/data-suite';
import { formatMaybeDateTime, formatMaybeDurationMs } from '@/lib/data-suite/utils';
import { useDataLabels } from '@/app/(dashboard)/data/_lib/data-i18n';

interface QualityResultDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  result: QualityResult | null;
}

export function QualityResultDialog({
  open,
  onOpenChange,
  result,
}: QualityResultDialogProps) {
  const labels = useDataLabels();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{labels.quality.resultTitle}</DialogTitle>
        </DialogHeader>
        {result ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Metric label={labels.quality.mStatus} value={result.status} />
              <Metric label={labels.quality.mChecked} value={result.records_checked.toLocaleString()} />
              <Metric label={labels.quality.mFailed} value={result.records_failed.toLocaleString()} />
              <Metric label={labels.quality.mDuration} value={formatMaybeDurationMs(result.duration_ms)} />
              <Metric label={labels.quality.mCheckedAt} value={formatMaybeDateTime(result.checked_at)} />
              <Metric label={labels.quality.mPassRate} value={result.pass_rate !== null && result.pass_rate !== undefined ? `${result.pass_rate.toFixed(1)}%` : '—'} />
            </div>
            {result.failure_summary ? (
              <div className="rounded-lg border bg-muted/20 p-4 text-sm">{result.failure_summary}</div>
            ) : null}
            <div className="rounded-lg border">
              <pre className="overflow-x-auto p-4 text-xs">{JSON.stringify(result.failure_samples, null, 2)}</pre>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
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
      <div className="mt-1 text-sm font-medium">{value}</div>
    </div>
  );
}
