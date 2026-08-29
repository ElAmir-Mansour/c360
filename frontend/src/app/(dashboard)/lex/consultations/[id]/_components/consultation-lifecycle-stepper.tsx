'use client';

/**
 * Compact, wrapping, audit-grade view of the consultation FSM happy path
 * (submitted → classified → routed → responded → approved → archived).
 *
 * Design mirrors the Legal Service Desk lifecycle stepper:
 *  - A single wrapping row of small state marks (completed = check in a filled
 *    dot, current = filled pulsing dot, future = hollow dot) with a concise
 *    stage label beside each.
 *  - RTL-correct: ordering flows with the inherited inline base direction;
 *    connectors are direction-agnostic hairlines; spacing uses logical gaps.
 *  - Timing from the append-only governance audit (`consultationsApi.listAudit`,
 *    shared query key with the detail page + activity feeds): each stage is
 *    stamped with the timestamp it was ENTERED (earliest transition whose
 *    `to_status` maps into that stage). The CURRENT stage shows an inline
 *    "entered {relative}" caption; COMPLETED stages expose the absolute dual
 *    date + dwell duration on hover. If audit fails to load the stepper still
 *    renders — just without timing.
 */

import { Fragment, useMemo } from 'react';
import { Check } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useLexFormat } from '@/lib/lex/ksa';
import {
  consultationsApi,
  type ConsultationStatus,
} from '@/lib/lex/consultations';
import {
  useConsultationDetailLabels,
  type ConsultationDetailExtraLabels,
} from './detail-extra-labels';

/** Ordered happy-path step keys. */
const STEP_KEYS = [
  'submitted',
  'classified',
  'routed',
  'responded',
  'approved',
  'archived',
] as const;

type StepKey = (typeof STEP_KEYS)[number];

/** Map a raw FSM status onto its happy-path step index (-1 when off-path). */
function statusToStepIndex(status: string): number {
  return (STEP_KEYS as readonly string[]).indexOf(status);
}

/** Humanize a positive millisecond span into up to two largest non-zero units. */
function humanizeDuration(
  ms: number,
  formatNumber: (value: number) => string,
  units: ConsultationDetailExtraLabels['stepper']['units'],
): string {
  if (!Number.isFinite(ms) || ms < 60_000) {
    return units.lessThanMinute;
  }
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

export interface ConsultationLifecycleStepperProps {
  status: ConsultationStatus;
  consultationId: string;
}

export function ConsultationLifecycleStepper({
  status,
  consultationId,
}: ConsultationLifecycleStepperProps) {
  const t = useConsultationDetailLabels().stepper;
  const f = useLexFormat();

  const currentIndex = statusToStepIndex(status);

  // Append-only governance audit — tolerate any error (retry:false); the stepper
  // still renders without timing.
  const auditQuery = useQuery({
    queryKey: ['lex-consultation-audit', consultationId],
    queryFn: () => consultationsApi.listAudit(consultationId),
    enabled: Boolean(consultationId),
    retry: false,
  });

  // Derive, per stage index, the earliest timestamp it was ENTERED.
  const enteredAt = useMemo(() => {
    const map = new Map<number, number>();
    for (const entry of auditQuery.data ?? []) {
      if (!entry.to_status || !entry.created_at) continue;
      const ts = new Date(entry.created_at).getTime();
      if (!Number.isFinite(ts)) continue;
      const idx = statusToStepIndex(entry.to_status);
      if (idx === -1) continue;
      const existing = map.get(idx);
      if (existing === undefined || ts < existing) map.set(idx, ts);
    }
    return map;
  }, [auditQuery.data]);

  /** Dwell time in a completed stage = gap until the next stage with a timestamp. */
  const stageDuration = (idx: number): string | null => {
    const start = enteredAt.get(idx);
    if (start === undefined) return null;
    for (let j = idx + 1; j < STEP_KEYS.length; j += 1) {
      const next = enteredAt.get(j);
      if (next !== undefined && next >= start) {
        return humanizeDuration(next - start, (n) => f.formatNumber(n), t.units);
      }
    }
    return null;
  };

  return (
    <TooltipProvider delayDuration={200}>
      <div className="rounded-2xl border bg-card/60 p-4">
        <p className="mb-3 text-xs font-semibold uppercase tracking-caps-xwide text-muted-foreground">
          {t.title}
        </p>

        <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-3" aria-label={t.title}>
          {STEP_KEYS.map((key: StepKey, idx) => {
            const isDone = idx < currentIndex;
            const isCurrent = idx === currentIndex;
            const enteredMs = enteredAt.get(idx);

            const reachedBoundary = idx <= currentIndex;
            const showCurrentCaption = isCurrent && enteredMs !== undefined;
            const currentRelative = showCurrentCaption ? f.formatRelative(enteredMs!) : '';

            const hasTip = isDone && enteredMs !== undefined;
            const duration = isDone ? stageDuration(idx) : null;

            const content = (
              <span
                className="inline-flex items-center gap-2 rounded-lg px-1 py-0.5"
                tabIndex={hasTip ? 0 : undefined}
              >
                <span
                  className={cn(
                    'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border',
                    isDone
                      ? 'border-primary bg-primary text-primary-foreground'
                      : isCurrent
                        ? 'border-primary bg-primary/15 text-primary ring-2 ring-primary/30 motion-safe:animate-pulse'
                        : 'border-border bg-background',
                  )}
                  aria-hidden
                >
                  {isDone ? (
                    <Check className="h-3 w-3" aria-hidden />
                  ) : isCurrent ? (
                    <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />
                  ) : null}
                </span>
                <span className="flex flex-col leading-tight">
                  <span
                    className={cn(
                      'text-caption',
                      isCurrent
                        ? 'font-semibold text-foreground'
                        : isDone
                          ? 'text-foreground/80'
                          : 'text-muted-foreground',
                    )}
                  >
                    {t.steps[key]}
                  </span>
                  {showCurrentCaption && currentRelative ? (
                    <span className="text-[0.6875rem] leading-tight text-primary/80">
                      {t.entered(currentRelative)}
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
                      'h-px w-4 shrink-0 rounded sm:w-6',
                      reachedBoundary ? 'bg-primary/40' : 'bg-border',
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
      </div>
    </TooltipProvider>
  );
}
