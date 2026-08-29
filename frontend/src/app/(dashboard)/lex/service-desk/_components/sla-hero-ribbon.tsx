'use client';

/**
 * <SlaHeroRibbon> — a compact, live-ticking SLA status strip for the Legal
 * Service Desk request-detail hero / right-rail.
 *
 * WHY IT EXISTS: the SLA is the most time-sensitive fact on a legal service
 * request, but today it is buried in a tab that reads empty for most of a
 * request's life. This ribbon surfaces it up top: a % elapsed ring, the live
 * "due in …" countdown, a breach-risk badge, and the ack / escalation state.
 *
 * IMPORTANT DOMAIN FACT (by design, NOT a bug): the SLA clock is created at
 * COMPLETENESS CONFIRMATION (execution phase). For every pre-execution status
 * (draft / submitted / pending_*_approval / approved / routed) there is NO clock
 * yet; the clock endpoint returns `null` for an existing request whose clock has
 * not started. That case renders a NEUTRAL, informative "clock not started"
 * state — never an error — optionally showing the promised turnaround when
 * `slaTargetSeconds` is known.
 *
 * The single-clock endpoint returns the raw {@link SLAClock} with no precomputed
 * "remaining", so elapsed / remaining are derived client-side against a
 * self-ticking `now` ({@link useNow}). Fully bilingual + RTL (logical classes,
 * numeral-localized via {@link useLexFormat}).
 */

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlarmClock, AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useLexFormat, type LexFormatter } from '@/lib/lex/ksa';
import {
  lexRequestsApi,
  requestCanHaveSlaClock,
  type RequestStatus,
  type SLAClock,
} from '@/lib/lex/requests';
import { useSlaHeroRibbonLabels, type SlaHeroRibbonLabels } from './sla-hero-ribbon-labels';
import { useReviewRoundLabels } from './review-rounds';

export interface SlaHeroRibbonProps {
  requestId: string;
  status: RequestStatus;
  /** From execution `state.sla_target_seconds`; used only as pre-execution context. */
  slaTargetSeconds?: number | null;
  className?: string;
}

/* ------------------------------------------------------------------------- *
 * Tiny dependency-free ticker. Re-renders on an interval so `formatRelative`
 * and the elapsed math stay live. `Date.now()` is only ever read lazily (in the
 * state initializer + interval callback), never at module scope.
 * ------------------------------------------------------------------------- */
function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/* ------------------------------------------------------------------------- *
 * Breach-risk tier → badge variant / accent colours / icon.
 * ------------------------------------------------------------------------- */
type SlaTier = 'onTrack' | 'atRisk' | 'breached';

interface TierVisual {
  variant: NonNullable<BadgeProps['variant']>;
  /** Accent text colour, applied to the ring stroke (via currentColor) + icons. */
  text: string;
  /** Left accent strip. */
  strip: string;
  icon: typeof Clock;
}

const TIER_VISUALS: Record<SlaTier, TierVisual> = {
  onTrack: {
    variant: 'success',
    text: 'text-success-600 dark:text-success-300',
    strip: 'bg-success-500/70',
    icon: CheckCircle2,
  },
  atRisk: {
    variant: 'warning',
    text: 'text-warning-700 dark:text-warning-300',
    strip: 'bg-warning-500/80',
    icon: AlarmClock,
  },
  breached: {
    variant: 'destructive',
    text: 'text-destructive',
    strip: 'bg-destructive/70',
    icon: AlertTriangle,
  },
};

/** Ring geometry (40px box, r=16). */
const RING_RADIUS = 16;
const RING_CIRC = 2 * Math.PI * RING_RADIUS;

/** Assumed length of a working day when narrating the pre-execution target. */
const WORKING_DAY_HOURS = 8;

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

/** Narrate `slaTargetSeconds` as working hours/days (8h working-day assumption). */
function describeTarget(
  labels: SlaHeroRibbonLabels,
  f: LexFormatter,
  seconds: number,
): string | null {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const hours = seconds / 3600;
  if (hours < WORKING_DAY_HOURS) {
    return labels.pending.targetHours(f.formatNumber(Math.max(1, Math.round(hours))));
  }
  const days = hours / WORKING_DAY_HOURS;
  const rounded = Math.round(days * 10) / 10;
  return labels.pending.targetDays(f.formatNumber(rounded));
}

/* ------------------------------------------------------------------------- *
 * Small inline-SVG elapsed ring — no external deps. Clockwise sweep from top,
 * stroke = currentColor so the wrapping tier text-colour drives it.
 * ------------------------------------------------------------------------- */
function ElapsedRing({
  fraction,
  colorClass,
  centerLabel,
  ariaLabel,
}: {
  fraction: number;
  colorClass: string;
  centerLabel: string;
  ariaLabel: string;
}) {
  const offset = RING_CIRC * (1 - clamp01(fraction));
  return (
    <span
      className={cn('relative grid h-10 w-10 shrink-0 place-items-center', colorClass)}
      role="img"
      aria-label={ariaLabel}
    >
      <svg viewBox="0 0 40 40" className="h-10 w-10 -rotate-90" aria-hidden focusable="false">
        <circle
          cx="20"
          cy="20"
          r={RING_RADIUS}
          fill="none"
          stroke="hsl(var(--muted))"
          strokeWidth="4"
        />
        <circle
          cx="20"
          cy="20"
          r={RING_RADIUS}
          fill="none"
          stroke="currentColor"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={RING_CIRC}
          strokeDashoffset={offset}
          className="transition-[stroke-dashoffset] duration-normal ease-standard"
        />
      </svg>
      <span className="absolute text-[10px] font-semibold tabular-nums text-foreground" aria-hidden>
        {centerLabel}
      </span>
    </span>
  );
}

/* ------------------------------------------------------------------------- *
 * Shared shell so loading / pending / active share chrome + accent strip.
 * ------------------------------------------------------------------------- */
function RibbonShell({
  strip,
  ariaLabel,
  className,
  children,
}: {
  strip?: string;
  ariaLabel?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      role="group"
      aria-label={ariaLabel}
      className={cn(
        'relative flex items-center gap-3 overflow-hidden rounded-xl border bg-card/60 px-4 py-3 ps-5 shadow-elevation-1',
        className,
      )}
    >
      {strip ? (
        <span className={cn('absolute inset-y-0 start-0 w-1', strip)} aria-hidden />
      ) : null}
      {children}
    </section>
  );
}

export function SlaHeroRibbon({
  requestId,
  status,
  slaTargetSeconds,
  className,
}: SlaHeroRibbonProps) {
  const labels = useSlaHeroRibbonLabels();
  const roundLabels = useReviewRoundLabels();
  const f = useLexFormat();
  const now = useNow(30_000);

  // The clock is created at completeness confirmation; before that there is
  // nothing to fetch, so render the pending state without a redundant request.
  const clockExpected = requestCanHaveSlaClock(status);

  const clockQuery = useQuery({
    queryKey: ['lex-sla-clock', requestId],
    queryFn: () => lexRequestsApi.getRequestClock(requestId),
    retry: false,
    enabled: Boolean(requestId) && clockExpected,
  });

  // --- Loading: slim skeleton --------------------------------------------
  if (clockExpected && clockQuery.isLoading) {
    return (
      <RibbonShell className={className}>
        <span className="h-10 w-10 shrink-0 rounded-full bg-muted motion-safe:animate-pulse" aria-hidden />
        <div className="min-w-0 flex-1 space-y-2" aria-hidden>
          <div className="h-3 w-24 rounded bg-muted motion-safe:animate-pulse" />
          <div className="h-3 w-40 rounded bg-muted motion-safe:animate-pulse" />
        </div>
      </RibbonShell>
    );
  }

  const clock: SLAClock | undefined = clockExpected ? (clockQuery.data ?? undefined) : undefined;

  // Parse the window; a malformed clock degrades to the pending presentation.
  const startMs = clock ? new Date(clock.clock_started_at).getTime() : NaN;
  const dueMs = clock ? new Date(clock.turnaround_due_at).getTime() : NaN;
  const clockUsable = clock != null && Number.isFinite(startMs) && Number.isFinite(dueMs);

  // --- No clock yet: PRE-EXECUTION informative state (by design) ----------
  if (!clockUsable) {
    const targetText =
      typeof slaTargetSeconds === 'number' ? describeTarget(labels, f, slaTargetSeconds) : null;
    return (
      <RibbonShell ariaLabel={labels.ariaLabel} className={cn('bg-muted/30', className)}>
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
          <Clock className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-overline font-semibold uppercase tracking-caps-xwide text-muted-foreground">
            {labels.eyebrow}
          </p>
          <p className="truncate text-sm font-medium text-foreground">{labels.pending.title}</p>
          <p className="text-xs leading-5 text-muted-foreground">{labels.pending.body}</p>
          {targetText ? (
            <p className="mt-0.5 text-xs font-medium tabular-nums text-muted-foreground">{targetText}</p>
          ) : null}
        </div>
      </RibbonShell>
    );
  }

  // A return ends the department-owned clock for this round. Keep that stopped
  // cycle visible in the persistent rail so an elapsed deadline cannot be
  // mistaken for a breach while the request sits with the requester.
  if (clock!.outcome === 'stopped') {
    return (
      <RibbonShell
        strip="bg-muted-foreground/40"
        ariaLabel={`${labels.ariaLabel} — ${roundLabels.slaStopped}`}
        className={cn('bg-muted/30', className)}
      >
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
          <Clock className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-overline font-semibold uppercase tracking-caps-xwide text-muted-foreground">
            {labels.eyebrow}
          </p>
          <p className="text-sm font-semibold text-foreground">
            {roundLabels.roundHeading(f.formatNumber(clock!.cycle))} · {roundLabels.slaStopped}
          </p>
          <p className="text-xs leading-5 text-muted-foreground">
            {roundLabels.slaStoppedHint}
          </p>
        </div>
      </RibbonShell>
    );
  }

  // --- Clock present: live ribbon ----------------------------------------
  const span = Math.max(1, dueMs - startMs);
  const elapsedFraction = clamp01((now - startMs) / span);
  const remainingFraction = (dueMs - now) / span; // may be negative

  const tier: SlaTier = clock!.breached
    ? 'breached'
    : remainingFraction <= 0.2
      ? 'atRisk'
      : 'onTrack';
  const visual = TIER_VISUALS[tier];
  const TierIcon = visual.icon;

  const overdue = clock!.breached || remainingFraction <= 0;
  const relativeDue = f.formatRelative(clock!.turnaround_due_at, new Date(now));
  const dueText = `${overdue ? labels.overduePrefix : labels.duePrefix} ${relativeDue}`.trim();
  const dueTitle = f.formatDual(clock!.turnaround_due_at);

  const elapsedPct = f.formatPercent(elapsedFraction, { maximumFractionDigits: 0 });
  const statusText =
    tier === 'breached'
      ? labels.status.breached
      : tier === 'atRisk'
        ? labels.status.atRisk
        : labels.status.onTrack;

  const ackText = clock!.ack_done
    ? labels.ack.done
    : `${labels.ack.duePrefix} ${f.formatRelative(clock!.ack_due_at, new Date(now))}`.trim();

  const escalated = clock!.escalation_level > 0;

  return (
    <RibbonShell
      strip={visual.strip}
      ariaLabel={`${labels.ariaLabel} — ${statusText}`}
      className={className}
    >
      <ElapsedRing
        fraction={elapsedFraction}
        colorClass={visual.text}
        centerLabel={elapsedPct}
        ariaLabel={`${elapsedPct} ${labels.elapsedSuffix}`}
      />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
          <p className="text-overline font-semibold uppercase tracking-caps-xwide text-muted-foreground">
            {labels.eyebrow}
          </p>
          <Badge variant={visual.variant} size="sm" className="gap-1">
            <TierIcon className="h-3 w-3" aria-hidden />
            {statusText}
          </Badge>
        </div>

        <p
          className={cn('mt-0.5 truncate text-sm font-semibold tabular-nums', visual.text)}
          title={dueTitle}
        >
          {dueText}
        </p>

        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            {clock!.ack_done ? (
              <CheckCircle2 className="h-3 w-3 text-success-600 dark:text-success-300" aria-hidden />
            ) : (
              <Clock className="h-3 w-3" aria-hidden />
            )}
            <span className="tabular-nums">{ackText}</span>
          </span>
          {escalated ? (
            <>
              <span aria-hidden>·</span>
              <span className="font-medium tabular-nums text-warning-700 dark:text-warning-300">
                {labels.escalationLevel(f.formatNumber(clock!.escalation_level))}
              </span>
            </>
          ) : null}
        </div>
      </div>
    </RibbonShell>
  );
}

export default SlaHeroRibbon;
