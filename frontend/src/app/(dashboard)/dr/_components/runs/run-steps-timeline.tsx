'use client';

import { CheckCircle2, CircleDashed, Loader2, XCircle, type LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { DRFailoverStep } from '@/types/clario-dr';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { type DRBilingual, resolveDRBilingual } from '../../_lib/dr-i18n';
import { useRunWarRoomLabels } from './run-war-room-labels';

/**
 * Step-status display labels (keyed by normalized lower-case status token), one
 * bilingual bundle resolved against the active locale. Unmapped tokens fall back
 * to the humanized token (underscores → spaces), preserving the legacy English
 * behaviour while giving Arabic operators professional MSA copy.
 */
const STEP_STATUS_LABELS: DRBilingual<Record<string, string>> = {
  en: {
    completed: 'completed',
    succeeded: 'succeeded',
    passed: 'passed',
    failed: 'failed',
    error: 'error',
    running: 'running',
    executing: 'executing',
    in_progress: 'in progress',
    pending: 'pending',
    skipped: 'skipped',
  },
  ar: {
    completed: 'مكتمل',
    succeeded: 'ناجح',
    passed: 'اجتاز',
    failed: 'فشل',
    error: 'خطأ',
    running: 'قيد التشغيل',
    executing: 'قيد التنفيذ',
    in_progress: 'قيد التقدّم',
    pending: 'معلّق',
    skipped: 'متخطّى',
  },
};

/**
 * Ordered gate-step timeline for the live execution view.
 *
 * Renders the REAL `DRFailoverStep[]` rows the failover driver emits — step
 * name, status, and start/finish timestamps — as a vertical timeline. No
 * fabricated steps; an empty list renders an honest empty state.
 */
export function RunStepsTimeline({ steps }: { steps: DRFailoverStep[] }) {
  const labels = useRunWarRoomLabels();
  const { locale } = useLocaleOrDefault();
  const statusLabels = resolveDRBilingual(STEP_STATUS_LABELS, locale);
  const stepStatusLabel = (status?: string | null): string => {
    const normalized = normalizeStatus(status);
    return statusLabels[normalized] ?? normalized.replace(/_/g, ' ');
  };

  const ordered = [...steps].sort(
    (left, right) => timestampMs(left.started_at) - timestampMs(right.started_at),
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle className="text-base">{labels.stepsTitle}</CardTitle>
          <CardDescription>{labels.stepsDescription}</CardDescription>
        </div>
        <Badge variant="outline">
          {ordered.length} {labels.stepsBadge}
        </Badge>
      </CardHeader>
      <CardContent>
        {ordered.length === 0 ? (
          <div className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-4 text-sm text-muted-foreground">
            <CircleDashed className="h-4 w-4 shrink-0" />
            <span>{labels.stepsEmpty}</span>
          </div>
        ) : (
          <ol className="space-y-3">
            {ordered.map((step, index) => {
              const meta = stepMeta(step.status);
              const Icon = meta.icon;
              return (
                <li key={step.id} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <span
                      className={cn(
                        'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border',
                        meta.ring,
                      )}
                    >
                      <Icon className={cn('h-4 w-4', meta.text, meta.spin && 'animate-spin')} />
                    </span>
                    {index < ordered.length - 1 ? (
                      <span className="mt-1 w-px flex-1 bg-border" aria-hidden />
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1 pb-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium">{step.step}</span>
                      <Badge variant={meta.variant} className="normal-case">
                        {stepStatusLabel(step.status)}
                      </Badge>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground" dir="ltr">
                      {formatDateTime(step.started_at, labels.stepNotAvailable)}
                      {step.finished_at
                        ? ` -> ${formatDateTime(step.finished_at, labels.stepNotAvailable)}`
                        : ''}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

interface StepMeta {
  icon: LucideIcon;
  ring: string;
  text: string;
  spin: boolean;
  variant: 'default' | 'secondary' | 'destructive' | 'warning' | 'outline' | 'success';
}

function stepMeta(status?: string | null): StepMeta {
  const normalized = normalizeStatus(status);
  if (normalized === 'completed' || normalized === 'succeeded' || normalized === 'passed') {
    return { icon: CheckCircle2, ring: 'border-primary bg-primary/10', text: 'text-primary', spin: false, variant: 'success' };
  }
  if (normalized === 'failed' || normalized === 'error') {
    return { icon: XCircle, ring: 'border-error-100 bg-error-50 dark:border-error-700/50 dark:bg-error-700/25', text: 'text-error-700 dark:text-error-300', spin: false, variant: 'destructive' };
  }
  if (normalized === 'running' || normalized === 'executing' || normalized === 'in_progress') {
    return { icon: Loader2, ring: 'border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/25', text: 'text-warning-700 dark:text-warning-300', spin: true, variant: 'warning' };
  }
  return { icon: CircleDashed, ring: 'border-border bg-muted', text: 'text-muted-foreground', spin: false, variant: 'outline' };
}

function normalizeStatus(status?: string | null) {
  return (status ?? 'pending').toLowerCase().replace(/\s+/g, '_');
}

function formatDateTime(value: string | Date | null | undefined, naLabel: string) {
  if (!value) return naLabel;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return naLabel;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date);
}

function timestampMs(value?: string | Date | null) {
  if (!value) return 0;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}
