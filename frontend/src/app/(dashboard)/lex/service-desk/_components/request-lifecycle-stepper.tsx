'use client';

/**
 * #7 Lifecycle stepper — a COMPACT, wrapping, audit-grade view of the
 * legal-request FSM happy path (draft → submitted → approval → approved →
 * routed → in_execution → delivered → closed).
 *
 * Design:
 *  - A single wrapping row of small state marks (no misleading big ordinals):
 *      completed = check in a filled dot, current = filled pulsing dot,
 *      future   = hollow dot. Concise stage label sits beside each dot.
 *  - RTL-correct: ordering flows with the inherited inline base direction
 *    (logical flex row), connectors are direction-agnostic hairlines, and
 *    spacing uses logical gaps — no hardcoded left/right.
 *  - Timing from the append-only spine audit (`listRequestAudit`): each stage
 *    is stamped with the timestamp it was ENTERED (earliest transition whose
 *    `to_status` maps into that stage; the two `pending_*_approval` sub-states
 *    collapse onto the single "approval" stage). The CURRENT stage shows an
 *    inline "entered {relative}" caption; COMPLETED stages expose the absolute
 *    dual date + dwell duration on hover. If audit fails to load the stepper
 *    still renders — just without timing.
 *  - Terminal `returned`/`cancelled` are off-path: a header chip + the terminal
 *    hint, and (when audit is available) the stages actually reached are marked
 *    as visited so you can see how far the request got before leaving.
 *
 * Bilingual: stage/terminal copy via `useDetailExtraLabels().stepper`; the new
 * timing strings via `useLifecycleStepperLabels()`.
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
import { lexRequestsApi, type RequestStatus } from '@/lib/lex/requests';
import { useDetailExtraLabels } from './detail-extra-labels';
import {
  useLifecycleStepperLabels,
  type LifecycleStepperTimingLabels,
} from './request-lifecycle-stepper-labels';

/** Ordered happy-path step keys. */
const STEP_KEYS = [
  'draft',
  'submitted',
  'approval',
  'approved',
  'routed',
  'in_execution',
  'delivered',
  'closed',
] as const;

type StepKey = (typeof STEP_KEYS)[number];

/** Map a raw FSM status onto its happy-path step index (the two approval
 * sub-states collapse onto the single "approval" step). Off-path terminal
 * states (returned/cancelled) return -1. */
function statusToStepIndex(status: RequestStatus): number {
  switch (status) {
    case 'draft':
      return 0;
    case 'submitted':
      return 1;
    case 'pending_requester_approval':
    case 'pending_provider_approval':
      return 2;
    case 'approved':
      return 3;
    case 'routed':
      return 4;
    case 'in_execution':
      return 5;
    case 'delivered':
      return 6;
    case 'closed':
      return 7;
    default:
      return -1; // returned | cancelled
  }
}

/** Humanize a positive millisecond span into up to the two largest non-zero
 * units (day / hour / minute), localized via `units` + `formatNumber`. */
function humanizeDuration(
  ms: number,
  formatNumber: (value: number) => string,
  units: LifecycleStepperTimingLabels['units'],
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

interface RequestLifecycleStepperProps {
  status: RequestStatus;
  requestId: string;
}

export function RequestLifecycleStepper({ status, requestId }: RequestLifecycleStepperProps) {
  const labels = useDetailExtraLabels();
  const timing = useLifecycleStepperLabels();
  const f = useLexFormat();
  const t = labels.stepper;

  const currentIndex = statusToStepIndex(status);
  const offPath = currentIndex === -1;
  const terminalLabel =
    status === 'returned'
      ? t.terminalReturned
      : status === 'cancelled'
        ? t.terminalCancelled
        : null;

  // Append-only spine audit is auxiliary; any transient read error must not
  // break the lifecycle stepper, so keep this soft and render from status alone.
  const auditQuery = useQuery({
    queryKey: ['lex-request-audit', requestId],
    queryFn: () => lexRequestsApi.listRequestAudit(requestId),
    enabled: Boolean(requestId),
    retry: false,
  });

  // Derive, per happy-path stage index, the earliest timestamp it was ENTERED,
  // plus when (if ever) the request went terminal.
  const { enteredAt, terminalAt } = useMemo(() => {
    const map = new Map<number, number>(); // stepIndex -> epoch ms (earliest)
    let terminal: number | null = null;
    for (const entry of auditQuery.data ?? []) {
      if (!entry.to_status || !entry.created_at) continue;
      const ts = new Date(entry.created_at).getTime();
      if (!Number.isFinite(ts)) continue;
      const idx = statusToStepIndex(entry.to_status as RequestStatus);
      if (idx === -1) {
        if (
          (entry.to_status === 'returned' || entry.to_status === 'cancelled') &&
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
        return humanizeDuration(next - start, (n) => f.formatNumber(n), timing.units);
      }
    }
    return null;
  };

  const terminalRelative =
    offPath && terminalAt !== null ? f.formatRelative(terminalAt) : '';

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
                  {timing.entered(terminalRelative)}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>

        <ol
          className="flex flex-wrap items-center gap-x-1.5 gap-y-3"
          aria-label={t.title}
        >
          {STEP_KEYS.map((key: StepKey, idx) => {
            const isDone = !offPath && idx < currentIndex;
            const isCurrent = !offPath && idx === currentIndex;
            const enteredMs = enteredAt.get(idx);
            const wasVisited = offPath && enteredMs !== undefined;

            // Connector before this dot is "traversed" once the transition into
            // it has happened (or, off-path, once the stage was reached).
            const reachedBoundary = offPath ? wasVisited : idx <= currentIndex;

            const showCurrentCaption = isCurrent && enteredMs !== undefined;
            const currentRelative = showCurrentCaption ? f.formatRelative(enteredMs!) : '';

            // A completed / visited stage with a known entry time gets a hover
            // tooltip: absolute dual date + dwell duration.
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
                      {timing.entered(currentRelative)}
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
                <li
                  className="inline-flex min-w-0"
                  aria-current={isCurrent ? 'step' : undefined}
                >
                  {hasTip ? (
                    <Tooltip>
                      <TooltipTrigger asChild>{content}</TooltipTrigger>
                      <TooltipContent side="bottom" className="max-w-xs text-caption">
                        <p className="font-medium">{timing.enteredOn(f.formatDual(enteredMs!))}</p>
                        {duration ? (
                          <p className="text-muted-foreground">{timing.timeInStage(duration)}</p>
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

        {offPath ? <p className="mt-3 text-xs text-muted-foreground">{t.terminalHint}</p> : null}
      </div>
    </TooltipProvider>
  );
}

export type { RequestLifecycleStepperProps };
