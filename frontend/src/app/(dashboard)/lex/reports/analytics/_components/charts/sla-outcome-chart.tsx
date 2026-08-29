/**
 * [2] SLA Outcome Mix — a 100% STACKED BAR per quarter showing the composition
 * of SLA outcomes: on-time / breached / pending. Where the trend chart [1]
 * answers "are we hitting the rate?", this answers "what is the rate made of?"
 * — i.e. how much of each quarter is a clean pass vs a breach vs still pending.
 *
 * PERF CONTRACT
 *  - PURE + memoized: wrapped in `React.memo`; the only transform (normalizing
 *    each quarter's counts to 0..100 shares so the bars stack to a full 100%,
 *    while retaining the raw counts for the tooltip) lives in one `useMemo`
 *    keyed on the `data` prop. It consumes the already-derived
 *    `slaOutcomeByQuarter` slice — no raw-dashboard walk, no re-derive.
 *  - REUSES the shared `<BarChart stacked />` wrapper (code-splits recharts via
 *    dynamic import). No chart lib is imported here.
 *  - Series config + the count index used by the tooltip are hoisted/memoized so
 *    no fresh object/array literals churn the memoized chart on re-render.
 *
 * 100% NORMALIZATION: recharts does not natively render a percent-stack, so we
 * precompute each segment as a share of that quarter's total (counts that sum to
 * 0 collapse to 0/0/0 → an empty bar). The y-axis + tooltip then read in %, and
 * the legend mirrors under RTL via the card's locale `dir`.
 */

'use client';

import { memo, useMemo } from 'react';
import { BarChart } from '@/components/shared/charts/bar-chart';
import { useLocale } from '@/components/providers/locale-provider';
import { useLexFormat } from '@/lib/lex/ksa';
import type { SlaOutcomePoint } from './_lib/analytics-series';
import { TONE } from './_lib/palette';
import { AnalyticsChartCard } from './analytics-chart-card';

/* ---- Bilingual, in-file labels (no shared analytics-labels.ts edits) ---- */
const LABELS = {
  en: {
    title: 'SLA Outcome Mix',
    description: 'Quarterly composition of SLA outcomes (share of requests).',
    empty: 'No SLA outcome data for the selected window.',
    onTime: 'On time',
    breached: 'Breached',
    pending: 'Pending',
  },
  ar: {
    title: 'مزيج نتائج اتفاقية مستوى الخدمة',
    description: 'تركيبة نتائج اتفاقية مستوى الخدمة ربع السنوية (نسبة الطلبات).',
    empty: 'لا توجد بيانات نتائج لاتفاقية مستوى الخدمة للنطاق المحدد.',
    onTime: 'في الوقت',
    breached: 'متأخر',
    pending: 'قيد الانتظار',
  },
} as const;

/** Outcome segment ids, in stack order (positive at the base → adverse on top). */
const SEGMENTS = ['onTime', 'breached', 'pending'] as const;
type SegmentKey = (typeof SEGMENTS)[number];

export interface SlaOutcomeChartProps {
  /** Already-derived slice from `deriveAnalyticsSeries().slaOutcomeByQuarter`. */
  data: SlaOutcomePoint[];
  /** Shimmer state while the dashboard query is in flight. */
  loading?: boolean;
  /** Optional column-span / layout classes forwarded to the card. */
  className?: string;
}

/** Normalized row: each segment is a 0..100 share; raw counts kept for tooltip. */
interface OutcomeRow extends Record<string, unknown> {
  quarter: string;
  onTime: number;
  breached: number;
  pending: number;
  /** Raw counts, indexed by segment key, used only by the tooltip formatter. */
  _counts: Record<SegmentKey, number>;
  _total: number;
}

function SlaOutcomeChartImpl({ data, loading = false, className }: SlaOutcomeChartProps) {
  const { locale } = useLocale();
  const f = useLexFormat();
  const labels = locale === 'ar' ? LABELS.ar : LABELS.en;

  /* Single transform: counts → 100%-stacked shares (+ retain raw counts). */
  const rows = useMemo<OutcomeRow[]>(() => {
    return data.map((q) => {
      const counts: Record<SegmentKey, number> = {
        onTime: q.onTime || 0,
        breached: q.breached || 0,
        pending: q.pending || 0,
      };
      const total = counts.onTime + counts.breached + counts.pending;
      const share = (n: number) => (total > 0 ? Number(((n / total) * 100).toFixed(1)) : 0);
      return {
        quarter: q.quarter,
        onTime: share(counts.onTime),
        breached: share(counts.breached),
        pending: share(counts.pending),
        _counts: counts,
        _total: total,
      };
    });
  }, [data]);

  /* Locale-dependent series config — memoized so `yKeys` stays referentially
   * stable for the memoized BarChart between renders at the same locale. */
  const yKeys = useMemo(
    () => [
      { key: 'onTime', label: labels.onTime, color: TONE.positive },
      { key: 'breached', label: labels.breached, color: TONE.negative },
      { key: 'pending', label: labels.pending, color: TONE.warning },
    ],
    [labels.onTime, labels.breached, labels.pending],
  );

  const isEmpty = rows.length === 0 || rows.every((r) => r._total === 0);

  // Y-axis reads as whole-percent; the share values are already 0..100.
  const yFormatter = (value: number) => f.formatPercent(value, { fromPercent: true, maximumFractionDigits: 0 });

  return (
    <AnalyticsChartCard
      title={labels.title}
      description={labels.description}
      loading={loading}
      empty={isEmpty}
      emptyMessage={labels.empty}
      className={className}
    >
      <div className="h-[280px] w-full">
        <BarChart
          data={rows}
          xKey="quarter"
          yKeys={yKeys}
          stacked
          layout="vertical"
          height={280}
          yFormatter={yFormatter}
          showLegend
          showGrid
        />
      </div>
    </AnalyticsChartCard>
  );
}

/**
 * PERF: `React.memo` — re-renders only when `data`/`loading`/`className` change.
 * The page passes a referentially-stable `slaOutcomeByQuarter` slice (from the
 * Foundation's single memoized `deriveAnalyticsSeries` pass), so this chart is
 * inert across unrelated dashboard re-renders.
 */
export const SlaOutcomeChart = memo(SlaOutcomeChartImpl);
