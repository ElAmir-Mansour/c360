'use client';

/**
 * <LexKpiStrip> — the canonical KPI header for every Lex list / dashboard.
 *
 * A responsive grid (1 / 2 / 3 / 4 / 5 / 6 columns by item count + breakpoint) of
 * KPI tiles built on the platform's single source of truth, `shared/KpiCard`.
 * Watheeq defaults to the flat operational treatment for fast scanning; an
 * explicit `appearance="default"` retains the legacy elevated rich card.
 *
 * Lex specifics layered on top of KpiCard:
 *   - Numeric values pass through `useLexFormat().formatNumber`, so Arabic mode
 *     renders Arabic-Indic digits and grouped separators.
 *   - Staggered fade-up entrance via each item's index (KpiCard's `index` prop).
 *   - An optional inline sparkline drawn from `spark: number[]` (pure SVG, no
 *     chart lib, RTL-mirrored so the trend reads with the text direction).
 *   - A compact `trend` descriptor `{ dir, value }` is translated into KpiCard's
 *     structured `KpiTrend` (with sensible good/bad sentiment).
 *
 * Bilingual + RTL safe: honors the active locale/direction from the locale
 * provider; callers may also force `dir` explicitly.
 */

import * as React from 'react';
import { useMemo } from 'react';
import type { LucideIcon } from 'lucide-react';
import { KpiCard, type KpiColorTheme, type KpiTrend } from '@/components/shared/kpi-card';
import type { StatTileAppearance } from '@/components/shared/stat-tile';
import { cn } from '@/lib/utils';
import { useLexFormat } from '@/lib/lex/ksa';

/** A single tile descriptor. */
interface LexKpiItemBase {
  /** Short metric caption. */
  label: string;
  /**
   * The headline value. Numbers are localized via `formatNumber`; strings are
   * rendered verbatim (use the caller's `useLexFormat` for pre-formatted money /
   * durations so they localize too).
   */
  value: number | string | undefined;
  /** Optional unit/suffix (e.g. `days`, `%`). */
  unit?: string;
  /** Palette — one of the `.kpi-theme-*` colors. */
  theme?: KpiColorTheme;
  icon?: LucideIcon;
  /** Optional toggle state announced by an actionable tile. */
  pressed?: boolean;
  /** Disables an actionable tile. */
  disabled?: boolean;
  /** Compact trend: direction + magnitude. `value` is shown as `±N`. */
  trend?: { dir: 'up' | 'down' | 'neutral'; value: number; label?: string };
  /**
   * Optional context under the headline value. Hidden by the default
   * operational appearance; shown by the explicit legacy appearance.
   */
  description?: string;
  /** Short hover explanation for how the statistic is calculated. */
  hint?: string;
  /** Optional progress ratio, 0..100, rendered as a compact rail. */
  progress?: number;
  /** Label for the compact progress rail. */
  progressLabel?: string;
  /** Footer label/value pair for secondary context. */
  detail?: string;
  detailValue?: string | number;
  /**
   * When true (default for `down`), a downward trend is treated as good
   * (e.g. fewer overdue items). Override per item when up = good.
   */
  trendGoodWhenDown?: boolean;
  /** Inline sparkline series. */
  spark?: number[];
  /** Loading shimmer for just this tile. */
  loading?: boolean;
  /** Per-item id for stable keys (falls back to label+index). */
  id?: string;
}

/**
 * A Lex KPI must always lead to the records behind its value. Keeping this as
 * a type-level invariant prevents new dashboard numbers from silently becoming
 * decorative dead ends. Use a link for URL-addressable filters and an action
 * for an in-place contributor drawer/filter.
 */
export type LexKpiItem = LexKpiItemBase &
  (
    | { href: string; onAction?: never }
    | { href?: never; onAction: () => void }
  );

export interface LexKpiStripProps {
  items: LexKpiItem[];
  /** Force a direction; otherwise inherits from the locale provider. */
  dir?: 'ltr' | 'rtl';
  /**
   * Force a column count at the largest breakpoint. When omitted, derived from
   * item count (caps at 6) for a balanced strip.
   */
  columns?: 1 | 2 | 3 | 4 | 5 | 6;
  /**
   * `operational` renders flat medium tiles in a denser, balanced grid and
   * omits long descriptions. This is the Watheeq-wide default; pass `default`
   * explicitly for the legacy elevated large-card treatment.
   */
  appearance?: StatTileAppearance;
  /**
   * Opt into the per-card brand colour wash (tinted surface + top strip). Each
   * tile draws its own colour from its `theme`, so give the items distinct
   * themes for a multi-colour strip. Operational appearance only.
   */
  accent?: boolean;
  className?: string;
}

/* Column classes for the largest (xl) breakpoint, derived from item count. The
 * smaller breakpoints always step down gracefully (2 → 3 → 4 → 6). */
const XL_COLS: Record<number, string> = {
  1: 'xl:grid-cols-1',
  2: 'xl:grid-cols-2',
  3: 'xl:grid-cols-3',
  4: 'xl:grid-cols-4',
  5: 'xl:grid-cols-5',
  6: 'xl:grid-cols-6',
};

function deriveColumns(count: number): 1 | 2 | 3 | 4 | 5 | 6 {
  if (count <= 1) return 1;
  if (count <= 2) return 2;
  if (count === 3) return 3;
  if (count === 4) return 4;
  if (count === 5) return 5;
  return 6;
}

const OPERATIONAL_COLS: Record<1 | 2 | 3 | 4 | 5 | 6, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-1 sm:grid-cols-2',
  3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
  4: 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-4',
  5: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5',
  6: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6',
};

export function LexKpiStrip({
  items,
  dir,
  columns,
  appearance = 'operational',
  accent = false,
  className,
}: LexKpiStripProps) {
  const f = useLexFormat();
  const resolvedDir = dir ?? f.direction;

  const cols = columns ?? deriveColumns(items.length);

  // Pre-localize numeric values once; strings pass through unchanged.
  const prepared = useMemo(
    () =>
      items.map((item) => ({
        item,
        display:
          typeof item.value === 'number'
            ? f.formatNumber(item.value)
            : item.value,
      })),
    [items, f],
  );

  return (
    <div
      dir={resolvedDir}
      className={cn(
        'grid',
        appearance === 'operational'
          ? cn('gap-3', OPERATIONAL_COLS[cols])
          : cn(
              'gap-4',
              cols === 1 ? 'grid-cols-1' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4',
              cols !== 1 && XL_COLS[cols],
            ),
        className,
      )}
    >
      {prepared.map(({ item, display }, index) => (
        <KpiCard
          key={item.id ?? `${item.label}-${index}`}
          title={item.label}
          value={display}
          unit={item.unit}
          icon={item.icon}
          colorTheme={item.theme}
          href={item.href}
          onAction={item.onAction}
          pressed={item.pressed}
          disabled={item.disabled}
          appearance={appearance}
          accent={accent}
          index={index}
          isLoading={item.loading}
          trend={item.trend ? toKpiTrend(item.trend, item.trendGoodWhenDown) : undefined}
          description={appearance === 'operational' ? undefined : item.description}
          hint={item.hint}
          progress={item.progress}
          progressLabel={item.progressLabel}
          detail={item.detail}
          detailValue={item.detailValue}
        >
          {item.spark && item.spark.length > 1 ? (
            <Sparkline
              data={item.spark}
              theme={item.theme}
              mirrored={resolvedDir === 'rtl'}
            />
          ) : undefined}
        </KpiCard>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------------- *
 * Trend translation: compact { dir, value } → KpiCard's structured KpiTrend.
 * ------------------------------------------------------------------------- */

function toKpiTrend(
  trend: NonNullable<LexKpiItem['trend']>,
  goodWhenDown?: boolean,
): KpiTrend {
  // Default heuristic: rising is good unless the caller marks down-as-good.
  // For neutral there is no sentiment.
  const downIsGood = goodWhenDown ?? false;
  let sentiment: KpiTrend['sentiment'] = 'neutral';
  if (trend.dir === 'up') {
    sentiment = downIsGood ? 'bad' : 'good';
  } else if (trend.dir === 'down') {
    sentiment = downIsGood ? 'good' : 'bad';
  }
  return {
    value: trend.value,
    label: trend.label ?? '',
    direction: trend.dir,
    sentiment,
  };
}

/* ------------------------------------------------------------------------- *
 * Sparkline — pure inline SVG, no chart dependency. Token-tinted, RTL-aware.
 * Respects prefers-reduced-motion (no animated draw when reduced).
 * ------------------------------------------------------------------------- */

// Status hues (red/orange/amber/emerald) keep their semantic tokens; every
// decorative hue collapses onto contrast-safe Deep Teal. Reserved status hues
// retain their semantic tokens so meaning is never conveyed by branding alone.
const SPARK_STROKE: Record<KpiColorTheme, string> = {
  red: 'stroke-error-500',
  orange: 'stroke-warning-500',
  amber: 'stroke-warning-500',
  yellow: 'stroke-warning-500',
  green: 'stroke-brand-primary-600',
  emerald: 'stroke-success-500',
  teal: 'stroke-brand-teal-700',
  cyan: 'stroke-brand-teal-700',
  sky: 'stroke-brand-primary-600',
  blue: 'stroke-brand-primary-600',
  indigo: 'stroke-brand-primary-600',
  violet: 'stroke-brand-teal-700',
  purple: 'stroke-brand-teal-700',
  pink: 'stroke-brand-teal-700',
  primary: 'stroke-primary',
};

interface SparklineProps {
  data: number[];
  theme?: KpiColorTheme;
  mirrored?: boolean;
}

function Sparkline({ data, theme = 'primary', mirrored = false }: SparklineProps) {
  const width = 72;
  const height = 24;
  const pad = 2;

  const path = useMemo(() => {
    const max = Math.max(...data);
    const min = Math.min(...data);
    const span = max - min || 1;
    const stepX = (width - pad * 2) / (data.length - 1);
    return data
      .map((v, i) => {
        const x = pad + i * stepX;
        const y = pad + (height - pad * 2) * (1 - (v - min) / span);
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(' ');
  }, [data]);

  const stroke = SPARK_STROKE[theme] ?? SPARK_STROKE.primary;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn('overflow-visible', mirrored && '-scale-x-100')}
      aria-hidden
      role="presentation"
    >
      <path
        d={path}
        fill="none"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={cn(stroke, 'opacity-90')}
      />
    </svg>
  );
}
