/**
 * [1] SLA Compliance Trend — a quarterly LINE chart of the on-time resolution
 * rate (`rate_pct`) drawn against the policy TARGET as a dashed reference line,
 * with the below-target region shaded so a single glance shows whether the team
 * is clearing the bar each quarter.
 *
 * PERF CONTRACT
 *  - PURE + memoized: the component is wrapped in `React.memo`; the only local
 *    transform (mapping `SlaTrendPoint[]` → recharts rows + the static y-series
 *    config) lives in `useMemo` keyed on its props. It does NOT touch the raw
 *    dashboard or recompute `deriveAnalyticsSeries` — it consumes the already
 *    derived `slaTrend` slice handed down as a prop.
 *  - REUSES the shared `<LineChart>` wrapper, which code-splits recharts via a
 *    dynamic import of `line-chart-impl`. No chart lib is imported here.
 *  - No inline object/array literals in the hot path beyond what `useMemo`
 *    produces; series colors come from the shared `_lib/palette`.
 *
 * The "shade the below-target region" requirement is satisfied without a second
 * chart library: a CSS band is absolutely positioned behind the line chart from
 * the card baseline up to the target's vertical position (target / axis-max),
 * tinted with the negative tone. It mirrors + flips correctly under RTL because
 * the band spans the full width and the axis is mirrored by the locale `dir`.
 */

'use client';

import { memo, useMemo } from 'react';
import { LineChart } from '@/components/shared/charts/line-chart';
import { useLocale } from '@/components/providers/locale-provider';
import { useLexFormat } from '@/lib/lex/ksa';
import type { SlaTrendPoint } from './_lib/analytics-series';
import { TONE } from './_lib/palette';
import { AnalyticsChartCard } from './analytics-chart-card';

/* ---- Bilingual, in-file labels (no shared analytics-labels.ts edits) ---- */
const LABELS = {
  en: {
    title: 'SLA Compliance Trend',
    description: 'Quarterly on-time resolution rate vs the policy target.',
    empty: 'No quarterly SLA data for the selected window.',
    rate: 'On-time rate',
    target: 'Target',
    current: 'Current',
    belowBand: 'Below target',
    quarterReceived: (n: string) => `${n} received`,
  },
  ar: {
    title: 'اتجاه الالتزام باتفاقية مستوى الخدمة',
    description: 'معدل الإنجاز في الوقت المحدد ربع السنوي مقابل المستهدف.',
    empty: 'لا توجد بيانات ربع سنوية لاتفاقية مستوى الخدمة للنطاق المحدد.',
    rate: 'معدل الالتزام',
    target: 'المستهدف',
    current: 'الحالي',
    belowBand: 'دون المستهدف',
    quarterReceived: (n: string) => `${n} واردة`,
  },
} as const;

/** Y-axis ceiling for the rate chart (rate_pct is a 0..100 percentage). */
const AXIS_MAX = 100;

export interface SlaTrendChartProps {
  /** Already-derived slice from `deriveAnalyticsSeries().slaTrend`. */
  data: SlaTrendPoint[];
  /** Shimmer state while the dashboard query is in flight. */
  loading?: boolean;
  /** Optional column-span / layout classes forwarded to the card. */
  className?: string;
}

interface TrendRow extends Record<string, unknown> {
  quarter: string;
  rate: number;
  target: number;
}

function SlaTrendChartImpl({ data, loading = false, className }: SlaTrendChartProps) {
  const { locale } = useLocale();
  const f = useLexFormat();
  const labels = locale === 'ar' ? LABELS.ar : LABELS.en;

  /* All per-chart transforms in a single useMemo keyed on the prop slice. */
  const view = useMemo(() => {
    const rows: TrendRow[] = data.map((p) => ({
      quarter: p.quarter,
      rate: Number(p.ratePct.toFixed(1)),
      target: Number(p.targetPct.toFixed(1)),
    }));

    // Target band: take the latest quarter's target (they are normally uniform);
    // fall back to the first point or 0 when the slice is empty.
    const targetPct = data.length > 0 ? data[data.length - 1].targetPct : 0;
    // Vertical fraction of the plot the BELOW-target region occupies (0..1).
    const belowFraction = Math.max(0, Math.min(1, targetPct / AXIS_MAX));

    const latest = data.length > 0 ? data[data.length - 1] : null;

    return { rows, targetPct, belowFraction, latest };
  }, [data]);

  /* Series config is derived from labels (locale-dependent) but otherwise
   * static — memoized so the LineChart's `yKeys` reference stays stable. */
  const yKeys = useMemo(
    () => [
      { key: 'rate', label: labels.rate, color: TONE.brand },
      { key: 'target', label: labels.target, color: TONE.muted, dashed: true },
    ],
    [labels.rate, labels.target],
  );

  const isEmpty = view.rows.length === 0;

  // Formatters are stable per-locale (useLexFormat is memoized on locale), so
  // closing over them here does not churn the memoized chart unnecessarily.
  const yFormatter = (value: number) => f.formatPercent(value, { fromPercent: true, maximumFractionDigits: 0 });
  const tooltipFormatter = (value: number) =>
    f.formatPercent(value, { fromPercent: true, maximumFractionDigits: 1 });

  const currentChip = view.latest
    ? `${labels.current} ${f.formatPercent(view.latest.ratePct, { fromPercent: true, maximumFractionDigits: 1 })}`
    : null;
  const targetChip = `${labels.target} ${f.formatPercent(view.targetPct, { fromPercent: true, maximumFractionDigits: 0 })}`;

  const actions = (
    <div className="flex items-center gap-2">
      {currentChip ? (
        <span
          className="inline-flex items-center gap-1.5 rounded-pill px-2 py-0.5 text-[11px] font-medium"
          style={{
            backgroundColor: 'hsl(var(--chart-1) / 0.12)',
            color: TONE.brand,
          }}
        >
          <span className="size-1.5 rounded-full" style={{ backgroundColor: TONE.brand }} aria-hidden />
          {currentChip}
        </span>
      ) : null}
      <span className="inline-flex items-center gap-1.5 rounded-pill px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
        <span className="h-px w-3" style={{ borderTop: `2px dashed ${TONE.muted}` }} aria-hidden />
        {targetChip}
      </span>
    </div>
  );

  return (
    <AnalyticsChartCard
      title={labels.title}
      description={labels.description}
      actions={actions}
      loading={loading}
      empty={isEmpty}
      emptyMessage={labels.empty}
      className={className}
    >
      {/* Plot wrapper hosts the below-target shaded band BEHIND the line chart. */}
      <div className="relative h-[280px] w-full">
        {/* Below-target region: from baseline up to the target line. Decorative. */}
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 rounded-b-card"
          style={{
            height: `${view.belowFraction * 100}%`,
            background: 'linear-gradient(to top, hsl(var(--status-error) / 0.10), hsl(var(--status-error) / 0.02))',
          }}
          aria-hidden
        />
        {/* Dashed target rule at the band ceiling, for a crisp threshold edge. */}
        <div
          className="pointer-events-none absolute inset-x-0"
          style={{
            bottom: `${view.belowFraction * 100}%`,
            borderTop: `1.5px dashed ${TONE.muted}`,
          }}
          aria-hidden
        />
        <LineChart
          data={view.rows}
          xKey="quarter"
          yKeys={yKeys}
          height={280}
          yFormatter={yFormatter}
          tooltipFormatter={tooltipFormatter}
          showLegend
          showGrid
        />
      </div>
    </AnalyticsChartCard>
  );
}

/**
 * PERF: `React.memo` — re-renders only when `data`/`loading`/`className` change.
 * The page hands down a referentially-stable `slaTrend` slice (memoized in the
 * Foundation's single `deriveAnalyticsSeries` pass), so steady-state re-renders
 * of the dashboard never re-render this chart.
 */
export const SlaTrendChart = memo(SlaTrendChartImpl);
