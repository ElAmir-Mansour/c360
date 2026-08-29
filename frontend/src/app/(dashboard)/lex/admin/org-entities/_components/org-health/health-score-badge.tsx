'use client';

/**
 * HealthScoreBadge — the big 0..100 data-quality score for the org registry.
 *
 * Color follows the score band (>=85 green, >=60 amber, else red) and a
 * one-line verdict explains it. Self-contained and presentational: the parent
 * supplies the already-localized verdict string for the resolved band.
 *
 * Designed to read well both inline in the Health & QA panel and (compact) in a
 * page header; pass `size="sm"` for the latter.
 */
import { ShieldCheck, ShieldAlert, ShieldX, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export type HealthBand = 'green' | 'amber' | 'red';

/** Resolve the score band from the numeric score. */
export function scoreBand(score: number): HealthBand {
  if (score >= 85) return 'green';
  if (score >= 60) return 'amber';
  return 'red';
}

interface BandTheme {
  icon: LucideIcon;
  ring: string;
  text: string;
  bg: string;
  bar: string;
}

const BAND_THEME: Record<HealthBand, BandTheme> = {
  green: {
    icon: ShieldCheck,
    ring: 'ring-primary/25',
    text: 'text-primary',
    bg: 'bg-primary/5',
    bar: 'bg-primary',
  },
  amber: {
    icon: ShieldAlert,
    ring: 'ring-warning-300/60',
    text: 'text-warning-700 dark:text-warning-300',
    bg: 'bg-warning-50',
    bar: 'bg-warning-500',
  },
  red: {
    icon: ShieldX,
    ring: 'ring-error-300/60',
    text: 'text-error-600',
    bg: 'bg-error-50',
    bar: 'bg-error-500',
  },
};

interface HealthScoreBadgeProps {
  score: number;
  /** Already-localized one-line verdict for the resolved band. */
  verdict: string;
  /** Localized "Data-quality score" caption. */
  scoreLabel: string;
  /** Localized "/ 100" suffix. */
  outOfLabel: string;
  size?: 'default' | 'sm';
  className?: string;
}

export function HealthScoreBadge({
  score,
  verdict,
  scoreLabel,
  outOfLabel,
  size = 'default',
  className,
}: HealthScoreBadgeProps) {
  const band = scoreBand(score);
  const theme = BAND_THEME[band];
  const Icon = theme.icon;
  const compact = size === 'sm';
  const pct = Math.max(0, Math.min(100, score));

  return (
    <div
      className={cn(
        'flex items-center gap-4 rounded-xl border ring-1',
        theme.bg,
        theme.ring,
        compact ? 'p-3' : 'p-4',
        className,
      )}
    >
      <div
        className={cn(
          'grid shrink-0 place-items-center rounded-full',
          theme.bg,
          theme.text,
          compact ? 'h-10 w-10' : 'h-14 w-14',
        )}
        aria-hidden
      >
        <Icon className={cn(compact ? 'h-5 w-5' : 'h-7 w-7')} />
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {scoreLabel}
        </p>
        <div className="flex items-baseline gap-1.5">
          <span
            className={cn('font-bold tabular-nums', theme.text, compact ? 'text-2xl' : 'text-4xl')}
          >
            {score}
          </span>
          <span className="text-sm text-muted-foreground">{outOfLabel}</span>
        </div>
        {!compact ? (
          <>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={cn('h-full rounded-full transition-[inline-size]', theme.bar)}
                style={{ inlineSize: `${pct}%` }}
              />
            </div>
            <p className={cn('mt-2 text-sm font-medium', theme.text)}>{verdict}</p>
          </>
        ) : (
          <p className={cn('truncate text-xs font-medium', theme.text)}>{verdict}</p>
        )}
      </div>
    </div>
  );
}
