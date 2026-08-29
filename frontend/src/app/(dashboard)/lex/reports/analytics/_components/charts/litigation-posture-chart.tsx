/**
 * [4] Litigation Posture — DIVERGING horizontal bar.
 *
 * Shows the firm's adversarial stance across the litigation portfolio: how many
 * cases it is the PLAINTIFF (claimant / مدعٍ) in versus the DEFENDANT
 * (respondent / مدعى عليه) in. Plaintiff cases grow from a shared center axis in
 * one direction, defendant cases in the opposite direction — a classic diverging
 * bar that makes "are we mostly suing or being sued?" legible at a glance.
 *
 * CUSTOM render (no chart library): hand-rolled flex/CSS bars off a center
 * spine. This deliberately avoids recharts + `ResponsiveContainer` for the
 * custom charts (lib weight + reflow + the known blank-render class), mirroring
 * the cyber MITRE heatmap's pure-div approach. Bars are sized by inline `width`
 * percentages computed in a single `useMemo`.
 *
 * PERF CONTRACT:
 *   - Pure + `React.memo`; consumes the precomputed `LitigationPosture` slice —
 *     no re-walk of the raw dashboard.
 *   - Geometry (max, two width %s, plus the "other" share) is a single `useMemo`
 *     keyed on the four scalar inputs only.
 *
 * RTL: the component reads `direction` and assigns the plaintiff side to the
 * inline-START edge and the defendant side to the inline-END edge using
 * `flex-row` / `flex-row-reverse`, so in Arabic the spine mirrors correctly and
 * each side's bar grows away from the center toward its own edge.
 */

'use client';

import { memo, useMemo } from 'react';
import { useLocale } from '@/components/providers/locale-provider';
import { useLexFormat } from '@/lib/lex/ksa';
import { cn } from '@/lib/utils';
import type { LitigationPosture } from './_lib/analytics-series';
import { TONE, TRACK_COLOR } from './_lib/palette';
import { AnalyticsChartCard } from './analytics-chart-card';

/* ------------------------------------------------------------------ *
 * In-file bilingual labels (local to avoid touching analytics-labels.ts).
 * ------------------------------------------------------------------ */
const COPY = {
  en: {
    title: 'Litigation Posture',
    description: 'Cases where the firm acts as plaintiff versus defendant.',
    plaintiff: 'Plaintiff',
    defendant: 'Defendant',
    other: 'Other / unspecified role',
    casesUnit: 'cases',
    empty: 'No litigation-posture data for this window.',
  },
  ar: {
    title: 'الموقف التقاضي',
    description: 'القضايا التي تكون فيها الجهة مدعية مقابل كونها مدعى عليها.',
    plaintiff: 'مدّعٍ',
    defendant: 'مدّعى عليه',
    other: 'دور آخر / غير محدد',
    casesUnit: 'قضية',
    empty: 'لا توجد بيانات للموقف التقاضي لهذه الفترة.',
  },
} as const;

const CHART_HEIGHT = 240;
/** Minimum visible width % for a non-zero bar so a "1 vs 200" sliver stays visible. */
const MIN_BAR_PCT = 3;

export interface LitigationPostureChartProps {
  /** Precomputed plaintiff/defendant/other split from `deriveAnalyticsSeries()`. */
  posture: LitigationPosture;
  /** Render the card body as a shimmer. */
  loading?: boolean;
}

function LitigationPostureChartImpl({ posture, loading = false }: LitigationPostureChartProps) {
  const { locale, direction } = useLocale();
  const f = useLexFormat();
  const copy = locale === 'ar' ? COPY.ar : COPY.en;
  const isRtl = direction === 'rtl';

  // Single-pass geometry: scale both bars against the larger side so the longer
  // one fills (almost) the full half-width and the spine stays centered.
  const geom = useMemo(() => {
    const { plaintiff, defendant, other, total } = posture;
    const max = Math.max(plaintiff, defendant, 1);
    const pctFor = (v: number) =>
      v <= 0 ? 0 : Math.max(MIN_BAR_PCT, (v / max) * 100);
    const safeTotal = total > 0 ? total : 0;
    return {
      plaintiff,
      defendant,
      other,
      total: safeTotal,
      plaintiffPct: pctFor(plaintiff),
      defendantPct: pctFor(defendant),
      plaintiffShare: safeTotal > 0 ? plaintiff / safeTotal : 0,
      defendantShare: safeTotal > 0 ? defendant / safeTotal : 0,
    };
  }, [posture]);

  const isEmpty = geom.plaintiff <= 0 && geom.defendant <= 0;

  return (
    <AnalyticsChartCard
      title={copy.title}
      description={copy.description}
      loading={loading}
      empty={!loading && isEmpty}
      emptyMessage={copy.empty}
      minBodyHeight={CHART_HEIGHT}
    >
      <div className="flex h-full flex-col justify-center gap-6">
        {/* Legend row */}
        <div className="flex items-center justify-center gap-6 text-xs">
          <LegendDot color={TONE.info} label={copy.plaintiff} />
          <LegendDot color={TONE.negative} label={copy.defendant} />
        </div>

        {/* Diverging spine: plaintiff grows toward the inline-START edge, defendant
            toward the inline-END edge. flex-row-reverse in RTL keeps "plaintiff
            first" reading on the start side. */}
        <div className={cn('flex items-stretch gap-0', isRtl ? 'flex-row-reverse' : 'flex-row')}>
          {/* Plaintiff half — bar anchored to the spine, growing outward */}
          <div className="flex flex-1 flex-col items-end gap-2">
            <DivergingBar
              valueLabel={f.formatNumber(geom.plaintiff)}
              shareLabel={f.formatPercent(geom.plaintiffShare)}
              caption={copy.plaintiff}
              widthPct={geom.plaintiffPct}
              color={TONE.info}
              align="end"
            />
          </div>

          {/* Center spine */}
          <div
            className="mx-1 w-px shrink-0 self-stretch"
            style={{ backgroundColor: 'hsl(var(--border))' }}
            aria-hidden
          />

          {/* Defendant half */}
          <div className="flex flex-1 flex-col items-start gap-2">
            <DivergingBar
              valueLabel={f.formatNumber(geom.defendant)}
              shareLabel={f.formatPercent(geom.defendantShare)}
              caption={copy.defendant}
              widthPct={geom.defendantPct}
              color={TONE.negative}
              align="start"
            />
          </div>
        </div>

        {/* "Other / unspecified role" footnote when present */}
        {geom.other > 0 ? (
          <p className="text-center text-[11px] text-muted-foreground">
            {copy.other}: <span className="tabular-nums">{f.formatNumber(geom.other)}</span>{' '}
            {copy.casesUnit}
          </p>
        ) : null}
      </div>
    </AnalyticsChartCard>
  );
}

/* ------------------------------------------------------------------ *
 * Presentational sub-parts (memoized; pure props in → DOM out).
 * ------------------------------------------------------------------ */

interface DivergingBarProps {
  valueLabel: string;
  shareLabel: string;
  caption: string;
  /** 0..100 bar fill within its half. */
  widthPct: number;
  color: string;
  /** Which spine edge the bar is anchored to (logical: 'end' = toward center spine on the start half). */
  align: 'start' | 'end';
}

function DivergingBarImpl({ valueLabel, shareLabel, caption, widthPct, color, align }: DivergingBarProps) {
  const anchorClass = align === 'end' ? 'items-end' : 'items-start';
  const trackJustify = align === 'end' ? 'justify-end' : 'justify-start';
  return (
    <div className={cn('flex w-full flex-col gap-1.5', anchorClass)}>
      <div className="flex w-full items-baseline gap-1.5 text-xs" >
        <span className="text-sm font-semibold tabular-nums text-foreground">{valueLabel}</span>
        <span className="text-[11px] tabular-nums text-muted-foreground">({shareLabel})</span>
      </div>
      {/* Track + fill. The fill is anchored to the spine edge so bars diverge. */}
      <div className={cn('flex w-full', trackJustify)}>
        <div
          className="h-7 w-full overflow-hidden rounded-md"
          style={{ backgroundColor: TRACK_COLOR }}
        >
          <div
            className={cn('flex h-full', trackJustify)}
            style={{ marginInlineStart: align === 'start' ? 0 : 'auto' }}
          >
            <div
              className="h-full rounded-md motion-safe:transition-[width] motion-safe:duration-slow"
              style={{ width: `${widthPct}%`, backgroundColor: color }}
              role="img"
              aria-label={`${caption}: ${valueLabel} (${shareLabel})`}
            />
          </div>
        </div>
      </div>
      <span className="text-[11px] font-medium text-muted-foreground">{caption}</span>
    </div>
  );
}

const DivergingBar = memo(DivergingBarImpl);

function LegendDotImpl({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
      <span
        className="inline-block h-2.5 w-2.5 rounded-pill"
        style={{ backgroundColor: color }}
        aria-hidden
      />
      {label}
    </span>
  );
}

const LegendDot = memo(LegendDotImpl);

export const LitigationPostureChart = memo(LitigationPostureChartImpl);
