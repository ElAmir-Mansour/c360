'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, RefreshCcw } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { dataSuiteApi, type ContradictionScan } from '@/lib/data-suite';
import { Spinner } from '@/components/ui/spinner';
import { useDataLabels } from '@/app/(dashboard)/data/_lib/data-i18n';

// Poll cadence + give-up bound, mirroring the attachments-field scan-poll fix:
// a stalled backend surfaces a retry affordance instead of an eternal spinner.
const POLL_INTERVAL_MS = 3000;
const POLL_MAX_FAILURES = 5;

interface ContradictionScanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete?: () => void;
}

export function ContradictionScanDialog({
  open,
  onOpenChange,
  onComplete,
}: ContradictionScanDialogProps) {
  const labels = useDataLabels();
  const [scan, setScan] = useState<ContradictionScan | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumping this re-runs the scan effect without depending on `onComplete`.
  const [attempt, setAttempt] = useState(0);

  // Mirror onComplete in a ref so the poll chain always calls the latest
  // callback WITHOUT listing it as an effect dependency. The parent passes a
  // fresh inline arrow every render; depending on it here tore down and
  // re-ran the effect on every parent render, kicking off a brand-new backend
  // scan each time (a self-feeding loop).
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    if (!open) {
      setScan(null);
      setError(null);
      return;
    }

    let cancelled = false;
    let timer: number | null = null;
    let failures = 0;
    setError(null);

    const start = async () => {
      let initial: ContradictionScan;
      try {
        initial = await dataSuiteApi.scanContradictions();
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : labels.contradictions.scanError);
        return;
      }
      if (cancelled) {
        return;
      }
      setScan(initial);

      const poll = async () => {
        if (!initial.id || cancelled) {
          return;
        }
        let current: ContradictionScan;
        try {
          current = await dataSuiteApi.getContradictionScan(initial.id);
        } catch {
          // Tolerate transient poll failures; only give up (and surface a
          // retry) after several consecutive misses so the spinner can't hang.
          if (cancelled) return;
          failures += 1;
          if (failures >= POLL_MAX_FAILURES) {
            setError(labels.contradictions.scanError);
            return;
          }
          timer = window.setTimeout(() => void poll(), POLL_INTERVAL_MS);
          return;
        }
        if (cancelled) {
          return;
        }
        failures = 0;
        setScan(current);
        if (current.status === 'completed' || current.status === 'failed') {
          onCompleteRef.current?.();
          return;
        }
        timer = window.setTimeout(() => void poll(), POLL_INTERVAL_MS);
      };

      timer = window.setTimeout(() => void poll(), POLL_INTERVAL_MS);
    };

    void start();

    return () => {
      cancelled = true;
      if (timer) {
        window.clearTimeout(timer);
      }
    };
  }, [open, attempt, labels.contradictions.scanError]);

  const progress = scan ? (scan.status === 'running' ? Math.min(90, scan.models_scanned * 10) : 100) : 10;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{labels.contradictions.scanTitle}</DialogTitle>
        </DialogHeader>
        {error ? (
          <div className="space-y-3 rounded-lg border border-rose-200 bg-rose-50 p-4 dark:border-rose-900/50 dark:bg-rose-950/30">
            <div className="flex items-center gap-2 text-rose-700 dark:text-rose-300">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <p className="text-sm">{error}</p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setScan(null);
                setError(null);
                setAttempt((n) => n + 1);
              }}
            >
              <RefreshCcw className="me-1.5 h-4 w-4" />
              {labels.contradictions.retryScan}
            </Button>
          </div>
        ) : !scan ? (
          <div className="flex items-center gap-3 rounded-lg border bg-muted/20 p-4">
            <Spinner />
            <div className="text-sm">{labels.contradictions.startingScan}</div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="text-sm capitalize">{labels.contradictions.scanStatus(scan.status)}</div>
            <Progress value={progress} />
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Metric label={labels.contradictions.mModelsScanned} value={scan.models_scanned.toLocaleString()} />
              <Metric label={labels.contradictions.mPairsCompared} value={scan.model_pairs_compared.toLocaleString()} />
              <Metric label={labels.contradictions.mFound} value={scan.contradictions_found.toLocaleString()} />
              <Metric label={labels.contradictions.mTriggeredBy} value={scan.triggered_by} />
            </div>
          </div>
        )}
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
