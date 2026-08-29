'use client';

import { Fragment, useMemo, type ReactNode } from 'react';
import { Check, RotateCcw, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useLexFormat } from '@/lib/lex/ksa';
import type { InvestigationAuditEntry, InvestigationStatus } from '@/lib/lex/investigations';
import { cn } from '@/lib/utils';
import {
  useInvestigationLifecycleLabels,
  type InvestigationLifecycleLabels,
} from './investigation-lifecycle-stepper-labels';

/** The five stages users need to understand; raw exception/status tokens are annotations. */
export const INVESTIGATION_LIFECYCLE_STAGES = [
  'registered',
  'active',
  'findings',
  'approval',
  'closed',
] as const;

type StageKey = (typeof INVESTIGATION_LIFECYCLE_STAGES)[number];

export interface InvestigationLifecycleStepperProps {
  status: InvestigationStatus;
  auditEntries: InvestigationAuditEntry[];
  /** The page owns endpoint wiring; this slot keeps the lifecycle narration unified. */
  actionSlot?: ReactNode;
  className?: string;
}

export function InvestigationLifecycleStepper({
  status,
  auditEntries,
  actionSlot,
  className,
}: InvestigationLifecycleStepperProps) {
  const t = useInvestigationLifecycleLabels();
  const f = useLexFormat();
  const auditState = useMemo(() => buildAuditState(status, auditEntries), [status, auditEntries]);
  const currentIndex = status === 'cancelled' ? auditState.interruptedIndex : statusToStageIndex(status);
  const isRejected = status === 'rejected';
  const isCancelled = status === 'cancelled';

  const stageDuration = (idx: number): string | null => {
    const start = auditState.enteredAt.get(idx);
    if (start === undefined) return null;
    for (let nextIndex = idx + 1; nextIndex < INVESTIGATION_LIFECYCLE_STAGES.length; nextIndex += 1) {
      const next = auditState.enteredAt.get(nextIndex);
      if (next !== undefined && next >= start) {
        return humanizeDuration(next - start, (n) => f.formatNumber(n), t.units);
      }
    }
    return null;
  };

  return (
    <TooltipProvider delayDuration={200}>
      <section
        className={cn('rounded-xl border border-border/80 bg-card p-5 shadow-none sm:p-6', className)}
        aria-labelledby="investigation-lifecycle-title"
        data-testid="investigation-lifecycle-rail"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2
            id="investigation-lifecycle-title"
            className="text-xs font-semibold uppercase tracking-caps-xwide text-muted-foreground"
          >
            {t.title}
          </h2>
          {isRejected ? (
            <Badge variant="destructive" className="gap-1.5">
              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
              {t.terminalRejected}
            </Badge>
          ) : isCancelled ? (
            <Badge variant="secondary" className="gap-1.5">
              <X className="h-3.5 w-3.5" aria-hidden />
              {t.terminalCancelled}
            </Badge>
          ) : null}
        </div>

        <ol className="mt-4 flex flex-wrap items-center gap-x-1.5 gap-y-3" aria-label={t.title}>
          {INVESTIGATION_LIFECYCLE_STAGES.map((key, idx) => {
            const isDone = idx < currentIndex || status === 'closed';
            const isCurrent = idx === currentIndex && status !== 'closed';
            const isException = isCurrent && (isRejected || isCancelled);
            const enteredMs = auditState.enteredAt.get(idx);
            const hasTip = (isDone || isCurrent) && enteredMs !== undefined;
            const duration = isDone ? stageDuration(idx) : null;
            const content = (
              <span
                className="inline-flex items-center gap-2 rounded-lg px-1 py-0.5"
                tabIndex={hasTip ? 0 : undefined}
              >
                <span
                  className={cn(
                    'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border',
                    isException
                      ? 'border-warning-500 bg-warning-100 text-warning-700 dark:bg-warning-950/50 dark:text-warning-300'
                      : isDone
                        ? 'border-primary bg-primary text-primary-foreground'
                        : isCurrent
                          ? 'border-primary bg-primary/15 text-primary ring-2 ring-primary/30 motion-safe:animate-pulse'
                          : 'border-border bg-background',
                  )}
                  aria-hidden
                >
                  {isDone ? (
                    <Check className="h-3 w-3" aria-hidden />
                  ) : isException ? (
                    <RotateCcw className="h-3 w-3" aria-hidden />
                  ) : isCurrent ? (
                    <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
                  ) : null}
                </span>
                <span className="flex flex-col leading-tight">
                  <span
                    className={cn(
                      'text-caption',
                      isCurrent || isDone ? 'font-semibold text-foreground' : 'text-muted-foreground',
                    )}
                  >
                    {t.steps[key]}
                  </span>
                  {isCurrent && enteredMs !== undefined ? (
                    <span className="text-[0.6875rem] leading-tight text-primary/80">
                      {t.entered(f.formatRelative(enteredMs))}
                    </span>
                  ) : null}
                </span>
              </span>
            );

            return (
              <Fragment key={key}>
                {idx > 0 ? (
                  <li
                    aria-hidden
                    className={cn(
                      'h-px w-4 shrink-0 rounded sm:w-8',
                      idx <= currentIndex ? 'bg-primary/50' : 'bg-border',
                    )}
                  />
                ) : null}
                <li className="inline-flex min-w-0" aria-current={isCurrent ? 'step' : undefined}>
                  {hasTip ? (
                    <Tooltip>
                      <TooltipTrigger asChild>{content}</TooltipTrigger>
                      <TooltipContent side="bottom" className="max-w-xs text-caption">
                        <p className="font-medium">{t.enteredOn(f.formatDual(enteredMs!))}</p>
                        {duration ? (
                          <p className="text-muted-foreground">{t.timeInStage(duration)}</p>
                        ) : null}
                      </TooltipContent>
                    </Tooltip>
                  ) : (
                    content
                  )}
                </li>
              </Fragment>
            );
          })}
        </ol>

        {isRejected ? (
          <p className="mt-3 text-sm text-warning-700 dark:text-warning-300">{t.rejectedHint}</p>
        ) : isCancelled ? (
          <p className="mt-3 text-sm text-muted-foreground">{t.cancelledHint}</p>
        ) : null}

        {terminalSummary(status, auditEntries, t, f.formatDual) ? (
          <p
            className="mt-4 rounded-lg border border-border/70 bg-muted/30 px-4 py-3 text-sm font-medium"
            role="status"
          >
            {terminalSummary(status, auditEntries, t, f.formatDual)}
          </p>
        ) : null}

        {actionSlot ? <div className="mt-5 border-t border-border/70 pt-5">{actionSlot}</div> : null}
      </section>
    </TooltipProvider>
  );
}

export function statusToStageIndex(status: InvestigationStatus | string): number {
  switch (status) {
    case 'registered':
      return 0;
    case 'in_progress':
      return 1;
    case 'results_recorded':
      return 2;
    case 'pending_approval':
    case 'approved':
    case 'rejected':
      return 3;
    case 'closed':
      return 4;
    default:
      return 0;
  }
}

function buildAuditState(status: InvestigationStatus, auditEntries: InvestigationAuditEntry[]) {
  const enteredAt = new Map<number, number>();
  let interruptedIndex = 0;
  for (const entry of auditEntries ?? []) {
    if (!entry.to_status || !entry.created_at) continue;
    const timestamp = new Date(entry.created_at).getTime();
    if (!Number.isFinite(timestamp)) continue;
    if (entry.to_status !== 'cancelled') {
      const idx = statusToStageIndex(entry.to_status);
      interruptedIndex = Math.max(interruptedIndex, idx);
      const existing = enteredAt.get(idx);
      if (existing === undefined || timestamp < existing) enteredAt.set(idx, timestamp);
    }
  }
  if (status !== 'cancelled') interruptedIndex = statusToStageIndex(status);
  return { enteredAt, interruptedIndex };
}

function terminalSummary(
  status: InvestigationStatus,
  auditEntries: InvestigationAuditEntry[],
  labels: InvestigationLifecycleLabels,
  formatDual: (value: string | number | Date) => string,
): string | null {
  if (status !== 'closed' && status !== 'cancelled') return null;
  const entry = [...(auditEntries ?? [])]
    .filter((item) => item.to_status === status && Number.isFinite(new Date(item.created_at).getTime()))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
  if (!entry) return labels.terminalHint;
  const actor = entry.actor_user_id?.trim() || labels.unknownActor;
  const date = formatDual(entry.created_at);
  return status === 'closed'
    ? labels.closedSummary(date, actor)
    : labels.cancelledSummary(date, actor);
}

function humanizeDuration(
  ms: number,
  formatNumber: (value: number) => string,
  units: InvestigationLifecycleLabels['units'],
): string {
  if (!Number.isFinite(ms) || ms < 60_000) return units.lessThanMinute;
  const totalMinutes = Math.floor(ms / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const parts = [
    { n: days, one: units.day, many: units.days },
    { n: hours, one: units.hour, many: units.hours },
    { n: minutes, one: units.minute, many: units.minutes },
  ]
    .filter((part) => part.n > 0)
    .slice(0, 2)
    .map((part) => `${formatNumber(part.n)} ${part.n === 1 ? part.one : part.many}`);
  return parts.length > 0 ? parts.join(' ') : units.lessThanMinute;
}
