'use client';

import {
  CheckCircle2,
  CircleStop,
  Loader2,
  RefreshCw,
  RotateCcw,
  Sparkles,
  TriangleAlert,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { usePleadingGenerationLabels } from './pleading-generation-labels';
import type { PleadingGenerationView } from './use-pleading-generation';

interface PleadingGenerationPanelProps {
  generation: PleadingGenerationView;
  onRetry: () => void;
  onCancel: () => void;
  onResume: () => void;
  onDismiss?: () => void;
  compact?: boolean;
}

export function PleadingGenerationPanel({
  generation,
  onRetry,
  onCancel,
  onResume,
  onDismiss,
  compact = false,
}: PleadingGenerationPanelProps) {
  const labels = usePleadingGenerationLabels();
  const active = ['queued', 'running', 'retrying', 'cancelling'].includes(
    generation.status,
  );
  const disconnected = generation.status === 'disconnected';
  const failed = generation.status === 'failed';
  const cancelled = generation.status === 'cancelled';
  const completed = generation.status === 'completed';

  const title =
    generation.status === 'queued'
      ? labels.queued
      : generation.status === 'running'
        ? labels.running
        : generation.status === 'retrying'
          ? labels.retrying
          : generation.status === 'cancelling'
            ? labels.cancelling
            : disconnected
              ? labels.disconnected
              : failed
                ? labels.failed
                : cancelled
                  ? labels.cancelled
                  : labels.completed;

  const Icon = completed
    ? CheckCircle2
    : failed || disconnected
      ? TriangleAlert
      : cancelled
        ? CircleStop
        : Sparkles;

  return (
    <div
      className={cn(
        'rounded-xl border p-3',
        completed &&
          'border-success-200 bg-success-50/70 dark:border-success-800 dark:bg-success-950/30',
        (failed || disconnected) &&
          'border-error-200 bg-error-50/70 dark:border-error-800 dark:bg-error-950/30',
        cancelled && 'border-border bg-muted/30',
        active &&
          'border-info-200 bg-info-50/70 dark:border-info-800 dark:bg-info-950/30',
      )}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-3">
        <Icon
          className={cn(
            'mt-0.5 h-4 w-4 shrink-0',
            active && 'text-info-700',
            completed && 'text-success-700',
            (failed || disconnected) && 'text-error-700',
          )}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">{title}</p>
              {active || disconnected ? (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {labels.backgroundHint}
                </p>
              ) : null}
            </div>
            {onDismiss && !active ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                aria-label={labels.dismiss}
                onClick={onDismiss}
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </Button>
            ) : null}
          </div>

          {active || disconnected ? (
            <div className="mt-3 space-y-1.5">
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="text-muted-foreground">
                  {generation.section
                    ? `${labels.currentSection}: ${generation.section}`
                    : title}
                </span>
                <span className="font-medium tabular-nums">
                  {labels.progress(generation.progress)}
                </span>
              </div>
              <Progress
                value={generation.progress}
                className="h-2"
                aria-label={labels.progress(generation.progress)}
              />
            </div>
          ) : null}

          {generation.error || generation.status === 'failed' ? (
            <p className="mt-2 text-sm text-error-700" role="alert">
              {generation.error || labels.unknownError}
            </p>
          ) : null}

          {generation.streamedBody && !compact ? (
            <div className="mt-3 rounded-lg border bg-background/80 p-3">
              <p className="text-overline font-semibold uppercase text-muted-foreground">
                {labels.streamedDraft}
              </p>
              <p
                className="mt-2 max-h-36 overflow-y-auto whitespace-pre-wrap text-sm"
                dir="auto"
              >
                {generation.streamedBody}
              </p>
            </div>
          ) : null}

          <div className="mt-3 flex flex-wrap justify-end gap-2">
            {disconnected ? (
              <Button type="button" size="sm" variant="outline" onClick={onResume}>
                <RefreshCw className="me-1.5 h-3.5 w-3.5" aria-hidden />
                {labels.resume}
              </Button>
            ) : null}
            {(failed || cancelled) && generation.canRetry ? (
              <Button type="button" size="sm" variant="outline" onClick={onRetry}>
                <RotateCcw className="me-1.5 h-3.5 w-3.5" aria-hidden />
                {labels.retry}
              </Button>
            ) : null}
            {(active || disconnected) && generation.status !== 'cancelling' ? (
              <Button type="button" size="sm" variant="outline" onClick={onCancel}>
                <CircleStop className="me-1.5 h-3.5 w-3.5" aria-hidden />
                {labels.cancel}
              </Button>
            ) : null}
            {generation.status === 'retrying' ||
            generation.status === 'cancelling' ? (
              <Loader2 className="h-4 w-4 animate-spin self-center" aria-hidden />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
