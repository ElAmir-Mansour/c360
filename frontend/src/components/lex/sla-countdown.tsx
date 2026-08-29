/**
 * <SlaCountdown> — a compact, animated "time remaining" visual for any lex
 * surface that has an SLA deadline (matters, service-desk requests, hearings,
 * approvals …). It pairs a horizontal countdown progress bar with a small
 * breach-risk ring, and reads its tier (and colours) from the SAME four-tier SLA
 * aging model the suite shares ({@link computeAgingTier} in `./sla-aging-badge`),
 * so the countdown, the badge and the list filters all agree on what "imminent"
 * or "overdue" means.
 *
 * VISUAL MODEL
 *   • The bar represents the SLA WINDOW that ends at `dueAt`. It starts wide open
 *     (full) when the deadline is comfortably ahead and DRAINS toward empty as
 *     `now` approaches `dueAt`. The window is anchored at `startAt` when supplied,
 *     otherwise inferred from the early-warning window so the bar is meaningful
 *     even without a start time.
 *   • The bar FILLS FROM THE INLINE-START edge (RTL-safe: it grows from the
 *     right in Arabic) and is coloured by tier: emerald → amber → orange → rose.
 *   • When the deadline is imminent (`stale`) or already passed (`overdue`) the
 *     bar + ring turn red and gain a `critical-pulse` glow (motion-safe only).
 *   • The breach-risk ring is a conic gauge whose sweep = elapsed fraction of the
 *     window, ringed red once breached.
 *
 * Relative time text routes through `useLexFormat().formatRelative`, so Arabic
 * mode renders Hijri-aware Arabic-Indic relative copy. Fully bilingual + RTL.
 */

'use client';

import { useMemo } from 'react';
import { AlertOctagon } from 'lucide-react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { useLexFormat } from '@/lib/lex/ksa';
import {
  type LexBilingual,
  resolveLexBilingual,
} from '@/app/(dashboard)/lex/_lib/lex-i18n';
import {
  type SlaAgingTier,
  SLA_AGING_WINDOWS,
  computeAgingTier,
} from './sla-aging-badge';

/* ------------------------------------------------------------------------- *
 * Tier → bar / ring colours. Tracks the SLA aging palette (emerald → amber →
 * orange → rose) but as solid bar fills (foreground) rather than soft pills.
 * ------------------------------------------------------------------------- */

interface TierVisual {
  /** Solid bar fill colour (the draining remaining-time portion). */
  fill: string;
  /** Ring stroke colour (CSS colour for the conic gradient). */
  ring: string;
  /** Label / accent text colour. */
  text: string;
  /** True for the breach-risk tiers that pulse + show the breach icon. */
  alarm: boolean;
}

const TIER_VISUALS: Record<SlaAgingTier, TierVisual> = {
  fresh: {
    fill: 'bg-success-500',
    // On-track ring uses Spring Teal #0DA7A8 (brand) instead of emerald; the bar
    // fill + text stay on the semantic success tokens for the healthy signal.
    ring: 'rgb(13 167 168)',
    text: 'text-success-600 dark:text-success-300',
    alarm: false,
  },
  aging: {
    fill: 'bg-warning-500',
    ring: 'rgb(245 158 11)',
    text: 'text-warning-700 dark:text-warning-300',
    alarm: false,
  },
  stale: {
    fill: 'bg-warning-500',
    ring: 'rgb(249 115 22)',
    text: 'text-warning-700 dark:text-warning-300',
    alarm: true,
  },
  overdue: {
    fill: 'bg-rose-500',
    ring: 'rgb(244 63 94)',
    text: 'text-rose-600 dark:text-rose-400',
    alarm: true,
  },
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/* ------------------------------------------------------------------------- *
 * Bilingual labels.
 * ------------------------------------------------------------------------- */

interface SlaCountdownLabels {
  /** Heading shown above the bar when `label` prop is omitted. */
  defaultLabel: string;
  /** Shown when there is no parseable deadline. */
  noDueDate: string;
  /** Prefix for the overdue relative text, e.g. "Overdue · 3 days ago". */
  overduePrefix: string;
  /** Accessible description of the whole control. */
  aria: (tier: string, timing: string) => string;
  /** Tier names (mirrors the SLA badge vocabulary). */
  tier: Record<SlaAgingTier, string>;
  /** Label for the earliest-promise (From) marker of a From–To window. */
  earliest: string;
}

const slaCountdownLabelsBundle: LexBilingual<SlaCountdownLabels> = {
  en: {
    defaultLabel: 'Time remaining',
    noDueDate: 'No deadline set',
    overduePrefix: 'Overdue',
    aria: (tier, timing) => `SLA ${tier} — ${timing}`,
    tier: {
      fresh: 'on track',
      aging: 'approaching',
      stale: 'imminent',
      overdue: 'overdue',
    },
    earliest: 'Earliest',
  },
  ar: {
    defaultLabel: 'الوقت المتبقّي',
    noDueDate: 'لا يوجد موعد نهائي',
    overduePrefix: 'متجاوز المهلة',
    aria: (tier, timing) => `اتفاقية مستوى الخدمة ${tier} — ${timing}`,
    tier: {
      fresh: 'ضمن المهلة',
      aging: 'يقترب الموعد',
      stale: 'وشيك',
      overdue: 'متجاوز المهلة',
    },
    earliest: 'الأبكر',
  },
};

function resolveSlaCountdownLabels(locale: AppLocale = 'en'): SlaCountdownLabels {
  return resolveLexBilingual(slaCountdownLabelsBundle, locale);
}

function useSlaCountdownLabels(): SlaCountdownLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveSlaCountdownLabels(locale), [locale]);
}

/* ------------------------------------------------------------------------- *
 * Window math.
 * ------------------------------------------------------------------------- */

interface CountdownGeometry {
  tier: SlaAgingTier;
  /** 0..1 fraction of the window REMAINING (drives the bar width). */
  remainingFraction: number;
  /** 0..1 fraction of the window ELAPSED (drives the ring sweep). */
  elapsedFraction: number;
  /** True once `now` is past `dueAt`. */
  breached: boolean;
}

/**
 * Derive the bar/ring geometry. The SLA window is `[startMs, dueMs]`; when no
 * start is given it is inferred as `dueMs - agingWindowDays` so the bar still
 * conveys urgency. Fractions are clamped to [0,1]; once breached the bar is
 * empty (remaining = 0) and the ring is full (elapsed = 1).
 */
function computeGeometry(
  dueMs: number,
  startMs: number | null,
  now: number,
): CountdownGeometry {
  const tier = computeAgingTier(dueMs, now) ?? 'fresh';
  const breached = now >= dueMs;

  const windowStart =
    startMs !== null && startMs < dueMs
      ? startMs
      : dueMs - SLA_AGING_WINDOWS.aging * MS_PER_DAY;
  const span = Math.max(1, dueMs - windowStart);

  const remainingFraction = breached ? 0 : Math.max(0, Math.min(1, (dueMs - now) / span));
  const elapsedFraction = breached ? 1 : Math.max(0, Math.min(1, (now - windowStart) / span));

  return { tier, remainingFraction, elapsedFraction, breached };
}

/* ------------------------------------------------------------------------- *
 * Breach-risk ring — a small conic gauge. Sweep grows with elapsed fraction.
 * ------------------------------------------------------------------------- */

interface BreachRingProps {
  elapsedFraction: number;
  color: string;
  breached: boolean;
  reducedAlarm: boolean;
}

function BreachRing({ elapsedFraction, color, breached, reducedAlarm }: BreachRingProps) {
  const deg = Math.round(elapsedFraction * 360);
  return (
    <span
      aria-hidden
      className={cn(
        'relative inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
        breached && !reducedAlarm && 'motion-safe:[animation:critical-pulse_1.8s_ease-in-out_infinite]',
      )}
      style={{
        background: `conic-gradient(${color} ${deg}deg, hsl(var(--muted)) ${deg}deg)`,
      }}
    >
      {/* Inner cutout to make it a ring. */}
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-card">
        {breached ? (
          <AlertOctagon className="h-3 w-3 text-rose-500" aria-hidden />
        ) : (
          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
        )}
      </span>
    </span>
  );
}

/* ------------------------------------------------------------------------- *
 * Public component.
 * ------------------------------------------------------------------------- */

export interface SlaCountdownProps {
  /** The SLA deadline. */
  dueAt: string | number | Date | null | undefined;
  /**
   * Optional window start (e.g. when the clock started). When omitted the
   * window is inferred from the early-warning window so the bar stays meaningful.
   */
  startAt?: string | number | Date | null;
  /**
   * Optional earliest-promise (From) instant of a From–To delivery window. When
   * supplied and it falls before `dueAt`, a small marker is drawn on the track at
   * that point. The bar still drains to `dueAt` (the enforced deadline / To bound);
   * the marker is purely informational.
   */
  fromAt?: string | number | Date | null;
  /** Caption above the bar; defaults to a localized "Time remaining". */
  label?: string;
  /** Hide the relative-time line under the bar. */
  hideTiming?: boolean;
  /** Render the breach-risk ring beside the bar. Default true. */
  showRing?: boolean;
  className?: string;
  /** Injectable clock for deterministic rendering/tests. */
  now?: number;
}

/**
 * SlaCountdown renders a draining countdown bar (fills from the inline-start
 * edge, RTL-safe) plus an optional breach-risk ring, coloured by the shared SLA
 * tier and turning red + critical-pulsing once imminent/overdue. Time text is
 * localized via `useLexFormat().formatRelative`.
 */
export function SlaCountdown({
  dueAt,
  startAt,
  fromAt,
  label,
  hideTiming = false,
  showRing = true,
  className,
  now,
}: SlaCountdownProps) {
  const labels = useSlaCountdownLabels();
  const f = useLexFormat();
  const clock = now ?? Date.now();

  const dueMs =
    dueAt == null || dueAt === '' ? NaN : dueAt instanceof Date ? dueAt.getTime() : new Date(dueAt).getTime();
  const startMs =
    startAt == null || startAt === ''
      ? null
      : startAt instanceof Date
        ? startAt.getTime()
        : new Date(startAt).getTime();

  // No parseable deadline → neutral, non-alarming placeholder.
  if (Number.isNaN(dueMs)) {
    return (
      <div className={cn('flex flex-col gap-1', className)} role="group" aria-label={labels.noDueDate}>
        <span className="text-xs font-medium text-muted-foreground">{label ?? labels.defaultLabel}</span>
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted/60" aria-hidden />
        <span className="text-[11px] text-muted-foreground">{labels.noDueDate}</span>
      </div>
    );
  }

  const geo = computeGeometry(dueMs, Number.isNaN(startMs as number) ? null : startMs, clock);
  const visual = TIER_VISUALS[geo.tier];

  // Earliest-promise (From) marker of a From–To window. Positioned on the same
  // [windowStart, dueMs] span the bar drains across, so it agrees with the fill.
  const fromMs =
    fromAt == null || fromAt === ''
      ? NaN
      : fromAt instanceof Date
        ? fromAt.getTime()
        : new Date(fromAt).getTime();
  const effStartMs = startMs !== null && !Number.isNaN(startMs) ? startMs : null;
  const markerWindowStart =
    effStartMs !== null && effStartMs < dueMs
      ? effStartMs
      : dueMs - SLA_AGING_WINDOWS.aging * MS_PER_DAY;
  const markerSpan = Math.max(1, dueMs - markerWindowStart);
  const showFromMarker = !Number.isNaN(fromMs) && fromMs < dueMs;
  const markerPct = showFromMarker
    ? `${Math.round(Math.max(0, Math.min(1, (fromMs - markerWindowStart) / markerSpan)) * 100)}%`
    : null;

  const timing = f.formatRelative(dueMs);
  const timingText = geo.breached && timing ? `${labels.overduePrefix} · ${timing}` : timing;
  const widthPct = `${Math.round(geo.remainingFraction * 100)}%`;
  const tierName = labels.tier[geo.tier];

  return (
    <div
      className={cn('flex flex-col gap-1.5', className)}
      role="group"
      aria-label={labels.aria(tierName, timingText || tierName)}
    >
      <div className="flex items-center justify-between gap-2">
        <span className={cn('text-xs font-medium', geo.breached ? visual.text : 'text-muted-foreground')}>
          {label ?? labels.defaultLabel}
        </span>
        {!hideTiming && timingText ? (
          <span className={cn('text-[11px] font-medium tabular-nums', visual.text)}>{timingText}</span>
        ) : null}
      </div>

      <div className="flex items-center gap-2.5">
        {/* Countdown bar — fills from the inline-start edge (RTL-safe via flex-row
            + the track being the parent; the fill is the leading child). */}
        <div
          className={cn(
            'relative h-2 flex-1 overflow-hidden rounded-full bg-muted/60',
            geo.breached &&
              'motion-safe:[animation:critical-pulse_1.8s_ease-in-out_infinite]',
          )}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(geo.remainingFraction * 100)}
          aria-label={labels.aria(tierName, timingText || tierName)}
        >
          <div
            className={cn(
              'h-full rounded-full transition-[width] duration-normal ease-standard',
              visual.fill,
            )}
            style={{ width: widthPct }}
          />
          {markerPct ? (
            <span
              className="absolute inset-y-0 w-0.5 -translate-x-1/2 rounded-full bg-foreground/70 rtl:translate-x-1/2"
              style={{ insetInlineStart: markerPct }}
              role="presentation"
              aria-hidden
              title={labels.earliest}
            />
          ) : null}
        </div>

        {showRing ? (
          <BreachRing
            elapsedFraction={geo.elapsedFraction}
            color={visual.ring}
            breached={geo.breached}
            reducedAlarm={false}
          />
        ) : null}
      </div>
    </div>
  );
}

export default SlaCountdown;
