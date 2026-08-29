'use client';

/**
 * <MatterSlaRibbon> — a compact SLA status strip for the Matters detail right
 * rail, mirroring the Legal Service Desk `SlaHeroRibbon` chrome (an elapsed
 * ring + accent strip + tier badge + live "due in …" countdown).
 *
 * IMPORTANT DOMAIN DIFFERENCE (by design, NOT a bug): matters have NO SLA clock
 * endpoint. Urgency is derived entirely client-side from the matter's
 * `due_date`, `status` and `priority` via the shared `matter-sla` helpers (the
 * SAME model the list/board/detail badges use). The elapsed ring is drawn
 * against the `opened_at → due_date` window. A matter with no due date — or a
 * terminal (closed/cancelled) matter — renders a NEUTRAL "no SLA window" state,
 * never an error.
 *
 * Fully bilingual + RTL (logical classes, numerals localized via useLexFormat).
 */

import { useEffect, useState, type ReactNode } from 'react';
import { AlarmClock, AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useLexFormat } from '@/lib/lex/ksa';
import type { LexMatter } from '@/types/suites';
import {
  matterSlaTier,
  matterSlaTimingText,
  useMatterSlaLabels,
  type MatterSlaTier,
} from '../../_lib/matter-sla';
import { useMatterSlaRibbonLabels } from './matter-detail-labels';

export interface MatterSlaRibbonProps {
  matter: LexMatter;
  className?: string;
}

/** Re-render on an interval so relative time + elapsed math stay live. */
function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

interface TierVisual {
  variant: NonNullable<BadgeProps['variant']>;
  text: string;
  strip: string;
  icon: typeof Clock;
}

const TIER_VISUALS: Record<MatterSlaTier, TierVisual> = {
  on_track: {
    variant: 'success',
    text: 'text-success-600 dark:text-success-300',
    strip: 'bg-success-500/70',
    icon: CheckCircle2,
  },
  due_soon: {
    variant: 'warning',
    text: 'text-warning-700 dark:text-warning-300',
    strip: 'bg-warning-500/80',
    icon: AlarmClock,
  },
  overdue: {
    variant: 'warning',
    text: 'text-warning-700 dark:text-warning-300',
    strip: 'bg-warning-500/80',
    icon: AlertTriangle,
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
const TERMINAL_STATUSES = new Set(['closed', 'cancelled']);

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, value));
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
  children: ReactNode;
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

export function MatterSlaRibbon({ matter, className }: MatterSlaRibbonProps) {
  const labels = useMatterSlaRibbonLabels();
  const slaLabels = useMatterSlaLabels();
  const f = useLexFormat();
  const now = useNow(30_000);

  const dueMs = matter.due_date ? new Date(matter.due_date).getTime() : NaN;
  const hasWindow =
    !TERMINAL_STATUSES.has(matter.status) && Boolean(matter.due_date) && Number.isFinite(dueMs);

  // --- No live SLA window: neutral, informative state ---------------------
  if (!hasWindow) {
    return (
      <RibbonShell ariaLabel={labels.eyebrow} className={cn('bg-muted/30', className)}>
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
          <Clock className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-overline font-semibold uppercase tracking-caps-xwide text-muted-foreground">
            {labels.eyebrow}
          </p>
          <p className="truncate text-sm font-medium text-foreground">{labels.noWindowTitle}</p>
          <p className="text-xs leading-5 text-muted-foreground">{labels.noWindowBody}</p>
        </div>
      </RibbonShell>
    );
  }

  const tier = matterSlaTier(matter, now);
  const visual = TIER_VISUALS[tier];
  const TierIcon = visual.icon;

  // Elapsed ring against the opened → due window (falls back to a 0 fraction
  // when opened_at is missing/invalid).
  const startMs = matter.opened_at ? new Date(matter.opened_at).getTime() : NaN;
  const span = Number.isFinite(startMs) ? Math.max(1, dueMs - startMs) : NaN;
  const elapsedFraction = Number.isFinite(span) ? clamp01((now - startMs) / span) : 0;
  const elapsedPct = f.formatPercent(elapsedFraction, { maximumFractionDigits: 0 });

  const overdue = tier === 'overdue' || tier === 'breached';
  const relativeDue = f.formatRelative(matter.due_date!, new Date(now));
  const dueText = `${overdue ? labels.overduePrefix : labels.duePrefix} ${relativeDue}`.trim();
  const dueTitle = f.formatDual(matter.due_date!);

  const statusText = slaLabels.tier[tier];
  const timing = matterSlaTimingText(matter, slaLabels, now);

  return (
    <RibbonShell strip={visual.strip} ariaLabel={`${labels.eyebrow} — ${statusText}`} className={className}>
      <ElapsedRing
        fraction={elapsedFraction}
        colorClass={visual.text}
        centerLabel={elapsedPct}
        ariaLabel={`${elapsedPct}`}
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
        <p className={cn('mt-0.5 truncate text-sm font-semibold tabular-nums', visual.text)} title={dueTitle}>
          {dueText}
        </p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground tabular-nums">{timing}</p>
      </div>
    </RibbonShell>
  );
}

export default MatterSlaRibbon;
