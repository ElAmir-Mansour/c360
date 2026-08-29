'use client';

/**
 * Case lifecycle stepper — a COMPACT, wrapping, audit-grade view of the
 * litigation-case FSM happy path (intake → phase 1 → phase 2 → open →
 * under procedure → closed).
 *
 * Design (mirrors the service-desk `RequestLifecycleStepper`):
 *  - A single wrapping row of small state marks: completed = check in a filled
 *    dot, current = filled pulsing dot, future = hollow dot; concise stage
 *    label beside each.
 *  - RTL-correct: ordering flows with the inherited inline base direction,
 *    connectors are direction-agnostic hairlines, spacing uses logical gaps.
 *  - Timing from the append-only case audit (`listCaseAudit`): each stage is
 *    stamped with the timestamp it was ENTERED (earliest transition whose
 *    `to_status` maps into that stage). The CURRENT stage shows an inline
 *    "entered {relative}" caption; COMPLETED stages expose the absolute dual
 *    date + dwell duration on hover. If audit fails to load the stepper still
 *    renders — just without timing.
 *  - Off-path `on_hold` / `cancelled` are surfaced as a header chip + a terminal
 *    hint, and (when audit is available) the stages actually reached are marked
 *    visited so you can see how far the case got before leaving the happy path.
 *
 * Reuses the page's existing `['lex-case-audit', caseId]` query cache — no extra
 * fetch. Bilingual via `useCaseDetailExtraLabels().stepper`.
 */

import { Fragment, useMemo } from 'react';
import { Check } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useLexFormat } from '@/lib/lex/ksa';
import { casesApi, type CaseStatus } from '@/lib/lex/cases';
import { useCaseDetailExtraLabels, type CaseDetailExtraLabels } from './case-detail-labels';

/** Ordered happy-path step keys. */
const STEP_KEYS = ['intake', 'phase1', 'phase2', 'open', 'under_procedure', 'closed'] as const;

type StepKey = (typeof STEP_KEYS)[number];

/** Map a raw FSM status onto its happy-path step index. Off-path states
 * (`on_hold` / `cancelled`) return -1. */
function statusToStepIndex(status: CaseStatus | string): number {
  switch (status) {
    case 'intake':
      return 0;
    case 'phase1':
      return 1;
    case 'phase2':
      return 2;
    case 'open':
      return 3;
    case 'under_procedure':
      return 4;
    case 'closed':
      return 5;
    default:
      return -1; // on_hold | cancelled
  }
}

/** Humanize a positive millisecond span into up to the two largest non-zero
 * units (day / hour / minute), localized via `units` + `formatNumber`. */
function humanizeDuration(
  ms: number,
  formatNumber: (value: number) => string,
  units: CaseDetailExtraLabels['stepper']['units'],
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

export interface CaseLifecycleStepperProps {
  status: CaseStatus;
  caseId: string;
}

export function CaseLifecycleStepper({ status, caseId }: CaseLifecycleStepperProps) {
  const t = useCaseDetailExtraLabels().stepper;
  const f = useLexFormat();

  const currentIndex = statusToStepIndex(status);
  const offPath = currentIndex === -1;
  const terminalLabel =
    status === 'on_hold' ? t.terminalOnHold : status === 'cancelled' ? t.terminalCancelled : null;

  // Reuses the page's case-audit query cache (append-only spine). Treat audit as
  // auxiliary so a transient read error does not break the stepper.
  const auditQuery = useQuery({
    queryKey: ['lex-case-audit', caseId],
    queryFn: () => casesApi.listCaseAudit(caseId),
    enabled: Boolean(caseId),
    retry: false,
  });

  // Derive, per happy-path stage index, the earliest timestamp it was ENTERED,
  // plus when (if ever) the case went off-path.
  const { enteredAt, terminalAt } = useMemo(() => {
    const map = new Map<number, number>(); // stepIndex -> epoch ms (earliest)
    let terminal: number | null = null;
    for (const entry of auditQuery.data ?? []) {
      if (!entry.to_status || !entry.created_at) continue;
      const ts = new Date(entry.created_at).getTime();
      if (!Number.isFinite(ts)) continue;
      const idx = statusToStepIndex(entry.to_status);
      if (idx === -1) {
        if (
          (entry.to_status === 'on_hold' || entry.to_status === 'cancelled') &&
          (terminal === null || ts < terminal)
        ) {
          terminal = ts;
        }
        continue;
      }
      const existing = map.get(idx);
      if (existing === undefined || ts < existing) {
        map.set(idx, ts);
      }
    }
    return { enteredAt: map, terminalAt: terminal };
  }, [auditQuery.data]);

  /** Dwell time in a completed stage = gap until the next stage that has a
   * recorded entry timestamp. Returns null when not derivable. */
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

  const terminalRelative = offPath && terminalAt !== null ? f.formatRelative(terminalAt) : '';
  const terminalHint = status === 'on_hold' ? t.hintOnHold : t.hintCancelled;

  return (
    <TooltipProvider delayDuration={200}>
      <div className="rounded-2xl border bg-card/60 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <p className="text-xs font-semibold uppercase tracking-caps-xwide text-muted-foreground">
            {t.title}
          </p>
          {offPath && terminalLabel ? (
            <div className="flex items-center gap-2">
              <Badge variant={status === 'cancelled' ? 'secondary' : 'warning'}>
                {terminalLabel}
              </Badge>
              {terminalRelative ? (
                <span className="text-caption text-muted-foreground">
                  {t.entered(terminalRelative)}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>

        <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-3" aria-label={t.title}>
          {STEP_KEYS.map((key: StepKey, idx) => {
            const isDone = !offPath && idx < currentIndex;
            const isCurrent = !offPath && idx === currentIndex;
            const enteredMs = enteredAt.get(idx);
            const wasVisited = offPath && enteredMs !== undefined;

            const reachedBoundary = offPath ? wasVisited : idx <= currentIndex;

            const showCurrentCaption = isCurrent && enteredMs !== undefined;
            const currentRelative = showCurrentCaption ? f.formatRelative(enteredMs!) : '';

            const hasTip = (isDone || wasVisited) && enteredMs !== undefined;
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
                        : wasVisited
                          ? 'border-transparent bg-muted-foreground/60 text-background'
                          : offPath
                            ? 'border-dashed border-border bg-muted'
                            : 'border-border bg-background',
                  )}
                  aria-hidden
                >
                  {isDone || wasVisited ? (
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
                        : isDone || wasVisited
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

        {offPath ? <p className="mt-3 text-xs text-muted-foreground">{terminalHint}</p> : null}
      </div>
    </TooltipProvider>
  );
}
