'use client';

/**
 * Compact, live-ticking SLA status strip for the consultation detail right-rail.
 *
 * The response SLA is the most time-sensitive fact on a consultation but the
 * full panel lives further down the page. This ribbon surfaces it in the sticky
 * rail: a % elapsed ring, the live "due in …" countdown, a breach-risk badge,
 * and the ack / escalation state.
 *
 * Unlike the service-desk ribbon this needs NO extra fetch — the ack + response
 * SLA clock is projected directly onto the `Consultation` (see the `sla_*`
 * fields). When no clock ever materialised (`sla_started_at` absent) it renders
 * a NEUTRAL "clock not started" state, never an error. Fully bilingual + RTL
 * (numeral-localized via {@link useLexFormat}); reuses the existing
 * `consultation.sla.*` copy for the tier + ack labels.
 */

import { useEffect, useState } from 'react';
import { AlarmClock, AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useLexFormat } from '@/lib/lex/ksa';
import type { Consultation } from '@/lib/lex/consultations';
import { useConsultationLabels } from '../../_components/labels';
import { useConsultationDetailLabels } from './detail-extra-labels';

export interface ConsultationSlaRibbonProps {
  consultation: Consultation;
  className?: string;
}

/* Tiny dependency-free ticker so the countdown + elapsed math stay live. */
function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

type SlaTier = 'onTrack' | 'atRisk' | 'breached';

interface TierVisual {
  variant: NonNullable<BadgeProps['variant']>;
  text: string;
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

const RING_RADIUS = 16;
const RING_CIRC = 2 * Math.PI * RING_RADIUS;

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function toTs(value?: string | null): number | null {
  if (!value) return null;
  const ts = new Date(value).getTime();
  return Number.isNaN(ts) ? null : ts;
}

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
        <circle cx="20" cy="20" r={RING_RADIUS} fill="none" stroke="hsl(var(--muted))" strokeWidth="4" />
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
      {strip ? <span className={cn('absolute inset-y-0 start-0 w-1', strip)} aria-hidden /> : null}
      {children}
    </section>
  );
}

export function ConsultationSlaRibbon({ consultation, className }: ConsultationSlaRibbonProps) {
  const t = useConsultationDetailLabels().sla;
  const slaLabels = useConsultationLabels().sla;
  const f = useLexFormat();
  const now = useNow(30_000);

  const startMs = toTs(consultation.sla_started_at);
  const dueMs = toTs(consultation.sla_response_due_at);
  const clockUsable = startMs !== null && dueMs !== null;

  // --- No clock yet: neutral informative state (never an error) -----------
  if (!clockUsable) {
    return (
      <RibbonShell ariaLabel={t.ariaLabel} className={cn('bg-muted/30', className)}>
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
          <Clock className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-overline font-semibold uppercase tracking-caps-xwide text-muted-foreground">
            {t.eyebrow}
          </p>
          <p className="truncate text-sm font-medium text-foreground">{t.notStartedTitle}</p>
          <p className="text-xs leading-5 text-muted-foreground">{t.notStartedBody}</p>
        </div>
      </RibbonShell>
    );
  }

  const span = Math.max(1, dueMs! - startMs!);
  const elapsedFraction = clamp01((now - startMs!) / span);
  const remainingFraction = (dueMs! - now) / span; // may be negative

  const breached = consultation.sla_breached === true || remainingFraction <= 0;
  const tier: SlaTier = breached ? 'breached' : remainingFraction <= 0.2 ? 'atRisk' : 'onTrack';
  const visual = TIER_VISUALS[tier];
  const TierIcon = visual.icon;

  const overdue = breached;
  const relativeDue = f.formatRelative(consultation.sla_response_due_at, new Date(now));
  const dueText = `${overdue ? t.overduePrefix : t.duePrefix} ${relativeDue}`.trim();
  const dueTitle = f.formatDual(consultation.sla_response_due_at);

  const elapsedPct = f.formatPercent(elapsedFraction, { maximumFractionDigits: 0 });
  const statusText =
    tier === 'breached' ? slaLabels.breached : tier === 'atRisk' ? slaLabels.dueSoon : slaLabels.onTrack;

  const ackDone = consultation.sla_ack_done === true;
  const ackText = ackDone
    ? slaLabels.acknowledged
    : consultation.sla_ack_due_at
      ? `${slaLabels.ackDue} ${f.formatRelative(consultation.sla_ack_due_at, new Date(now))}`.trim()
      : slaLabels.pending;

  const escalation = consultation.sla_escalation_level ?? 0;

  return (
    <RibbonShell strip={visual.strip} ariaLabel={`${t.ariaLabel} — ${statusText}`} className={className}>
      <ElapsedRing
        fraction={elapsedFraction}
        colorClass={visual.text}
        centerLabel={elapsedPct}
        ariaLabel={`${elapsedPct} ${t.elapsedSuffix}`}
      />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
          <p className="text-overline font-semibold uppercase tracking-caps-xwide text-muted-foreground">
            {t.eyebrow}
          </p>
          <Badge variant={visual.variant} size="sm" className="gap-1">
            <TierIcon className="h-3 w-3" aria-hidden />
            {statusText}
          </Badge>
        </div>

        <p className={cn('mt-0.5 truncate text-sm font-semibold tabular-nums', visual.text)} title={dueTitle}>
          {dueText}
        </p>

        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            {ackDone ? (
              <CheckCircle2 className="h-3 w-3 text-success-600 dark:text-success-300" aria-hidden />
            ) : (
              <Clock className="h-3 w-3" aria-hidden />
            )}
            <span className="tabular-nums">{ackText}</span>
          </span>
          {escalation > 0 ? (
            <>
              <span aria-hidden>·</span>
              <span className="font-medium tabular-nums text-warning-700 dark:text-warning-300">
                {slaLabels.escalationLevel(escalation)}
              </span>
            </>
          ) : null}
        </div>
      </div>
    </RibbonShell>
  );
}
