/**
 * [9] Period-over-Period Variance — BULLET bars + delta + inline sparkline.
 *
 * For the four headline legal-affairs metrics (cases, contracts, consultations,
 * SLA on-time rate) this answers "how are we trending versus the previous
 * comparison window?". Each metric row shows:
 *   - the CURRENT value (big, tabular),
 *   - a BULLET-style bar: a filled measure bar for the current value sitting on a
 *     muted qualitative track, with a vertical PREVIOUS-period marker so you can
 *     read the current-vs-previous gap geometrically,
 *   - a colored up/down DELTA % chip (semantic: improvement = positive tone, even
 *     when "down is good" for lower-is-better metrics),
 *   - a tiny hand-rolled inline-SVG SPARKLINE tracing previous → current.
 *
 * CUSTOM render (no chart library): hand-rolled flex/CSS bullet bars + raw
 * inline `<svg>` sparklines. This deliberately avoids recharts +
 * `ResponsiveContainer` (lib weight + reflow + the known blank-render class),
 * mirroring the cyber MITRE heatmap's pure-SVG/div approach.
 *
 * PERF CONTRACT:
 *   - Pure + `React.memo`; consumes the precomputed `VariancePoint[]` slice from
 *     `deriveAnalyticsSeries()` — never re-walks the raw dashboard.
 *   - All geometry (per-row scale, bullet measure %, marker %, sparkline path) is
 *     computed in ONE `useMemo` keyed on the `variance` slice reference.
 *   - No inline object/array literals recreated each render in the hot path:
 *     metric metadata is a hoisted module constant; sub-rows are memoized.
 *
 * RTL: the component reads `direction`; bullet measure bars are anchored to the
 * inline-START edge via logical flex, the previous-marker is positioned with
 * `insetInlineStart`, and the sparkline `<svg>` is horizontally mirrored in
 * Arabic (`scaleX(-1)`) so "earlier → later" still reads start → end.
 */

'use client';

import { memo, useMemo } from 'react';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { useLocale } from '@/components/providers/locale-provider';
import { useLexFormat } from '@/lib/lex/ksa';
import { cn } from '@/lib/utils';
import type { VariancePoint } from './_lib/analytics-series';
import { TONE, TRACK_COLOR } from './_lib/palette';
import { AnalyticsChartCard } from './analytics-chart-card';

/* ------------------------------------------------------------------ *
 * In-file bilingual labels (local — avoids touching analytics-labels.ts).
 * ------------------------------------------------------------------ */
const COPY = {
  en: {
    title: 'Period-over-Period Variance',
    description: 'Current window versus the previous comparison window.',
    current: 'Current',
    previous: 'Previous',
    flat: 'No change',
    noBaseline: 'No comparison window',
    versus: 'vs previous',
    empty: 'No comparison data for this window.',
    metrics: {
      cases: 'Cases',
      contracts: 'Contracts',
      consultations: 'Consultations',
      sla: 'SLA on-time rate',
    },
  },
  ar: {
    title: 'تباين الفترة مقابل الفترة',
    description: 'الفترة الحالية مقارنةً بفترة المقارنة السابقة.',
    current: 'الحالية',
    previous: 'السابقة',
    flat: 'لا تغيير',
    noBaseline: 'لا توجد فترة للمقارنة',
    versus: 'مقابل السابقة',
    empty: 'لا توجد بيانات للمقارنة لهذه الفترة.',
    metrics: {
      cases: 'القضايا',
      contracts: 'العقود',
      consultations: 'الاستشارات',
      sla: 'نسبة الالتزام بمستوى الخدمة',
    },
  },
} as const;

const CHART_HEIGHT = 300;

/** Metric ids we render, in display order. Hoisted so it's never re-created. */
const METRIC_ORDER = ['cases', 'contracts', 'consultations', 'sla'] as const;
type MetricKey = (typeof METRIC_ORDER)[number];

/** Which metrics are a percent (0..100) rather than a count. */
const PERCENT_METRICS = new Set<MetricKey>(['sla']);

/** Sparkline viewBox geometry (constant; the path scales into it). */
const SPARK_W = 64;
const SPARK_H = 22;
const SPARK_PAD = 3;

/** Minimum visible measure-bar width % so a tiny non-zero value stays legible. */
const MIN_MEASURE_PCT = 2;

export interface PeriodVarianceChartProps {
  /** Precomputed current-vs-previous comparison rows from `deriveAnalyticsSeries()`. */
  variance: VariancePoint[];
  /** Render the card body as a shimmer. */
  loading?: boolean;
}

/* ------------------------------------------------------------------ *
 * Per-row derived geometry (pure; computed once in the parent useMemo).
 * ------------------------------------------------------------------ */
interface VarianceRow {
  key: MetricKey;
  isPercent: boolean;
  current: number;
  previous: number | null;
  deltaPct: number | null;
  /** True when an INCREASE is good for this metric (counts up = more work seen). */
  /** Direction of "good": improvement tone is derived from delta sign + lowerIsBetter. */
  lowerIsBetter: boolean;
  /** Trend tone: 'positive' | 'negative' | 'flat' | 'none' (no baseline). */
  trend: 'positive' | 'negative' | 'flat' | 'none';
  /** 0..100 measure-bar fill for the CURRENT value within the row scale. */
  measurePct: number;
  /** 0..100 position of the PREVIOUS-period marker (null when no baseline). */
  markerPct: number | null;
  /** Two-point sparkline path (previous → current) within SPARK viewBox. */
  sparkPath: string;
  /** Endpoint dot coords for the sparkline (current value). */
  sparkDotX: number;
  sparkDotY: number;
}

function trendOf(deltaPct: number | null, lowerIsBetter: boolean): VarianceRow['trend'] {
  if (deltaPct == null) return 'none';
  if (deltaPct === 0) return 'flat';
  const rising = deltaPct > 0;
  // Improvement when the change moves in the "good" direction for the metric.
  const improving = lowerIsBetter ? !rising : rising;
  return improving ? 'positive' : 'negative';
}

function toneFor(trend: VarianceRow['trend']): string {
  if (trend === 'positive') return TONE.positive;
  if (trend === 'negative') return TONE.negative;
  return TONE.muted;
}

function buildRows(variance: VariancePoint[]): VarianceRow[] {
  const byKey = new Map<string, VariancePoint>();
  for (const p of variance) byKey.set(p.key, p);

  return METRIC_ORDER.map((key) => {
    const p = byKey.get(key);
    const isPercent = PERCENT_METRICS.has(key);
    const current = p?.current ?? 0;
    const previous = p?.previous ?? null;
    const deltaPct = p?.deltaPct ?? null;
    const lowerIsBetter = p?.lowerIsBetter ?? false;
    const trend = trendOf(deltaPct, lowerIsBetter);

    // Row scale: percent metrics fix the axis at 100; count metrics scale to the
    // larger of current/previous so the longer bar (almost) fills the track.
    const scaleMax = isPercent
      ? 100
      : Math.max(current, previous ?? 0, 1);
    const pctOf = (v: number) =>
      v <= 0 ? 0 : Math.min(100, Math.max(MIN_MEASURE_PCT, (v / scaleMax) * 100));

    const measurePct = pctOf(current);
    const markerPct = previous == null ? null : Math.min(100, (previous / scaleMax) * 100);

    // Two-point sparkline (previous → current). When there's no baseline we draw
    // a flat single-level line so the row still reads as "steady / unknown".
    const innerW = SPARK_W - SPARK_PAD * 2;
    const innerH = SPARK_H - SPARK_PAD * 2;
    const sparkMax = Math.max(current, previous ?? current, 1);
    const yFor = (v: number) => SPARK_PAD + innerH - (v / sparkMax) * innerH;
    const x0 = SPARK_PAD;
    const x1 = SPARK_PAD + innerW;
    const y0 = previous == null ? yFor(current) : yFor(previous);
    const y1 = yFor(current);
    const sparkPath = `M ${x0} ${round(y0)} L ${x1} ${round(y1)}`;

    return {
      key,
      isPercent,
      current,
      previous,
      deltaPct,
      lowerIsBetter,
      trend,
      measurePct,
      markerPct,
      sparkPath,
      sparkDotX: x1,
      sparkDotY: round(y1),
    };
  });
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function PeriodVarianceChartImpl({ variance, loading = false }: PeriodVarianceChartProps) {
  const { locale, direction } = useLocale();
  const f = useLexFormat();
  const copy = locale === 'ar' ? COPY.ar : COPY.en;
  const isRtl = direction === 'rtl';

  const rows = useMemo(() => buildRows(variance), [variance]);

  // Empty when no metric has any current value AND no baseline exists anywhere.
  const isEmpty = useMemo(
    () => rows.every((r) => r.current === 0 && r.previous == null),
    [rows],
  );

  return (
    <AnalyticsChartCard
      title={copy.title}
      description={copy.description}
      loading={loading}
      empty={!loading && isEmpty}
      emptyMessage={copy.empty}
      minBodyHeight={CHART_HEIGHT}
    >
      <ul className="flex h-full flex-col justify-center gap-4">
        {rows.map((row) => (
          <VarianceRowView
            key={row.key}
            row={row}
            label={copy.metrics[row.key]}
            copy={copy}
            f={f}
            isRtl={isRtl}
          />
        ))}
      </ul>
    </AnalyticsChartCard>
  );
}

/* ------------------------------------------------------------------ *
 * One metric row (memoized; pure props in → DOM out).
 * ------------------------------------------------------------------ */
type VarianceCopy = (typeof COPY)['en'] | (typeof COPY)['ar'];

interface VarianceRowViewProps {
  row: VarianceRow;
  label: string;
  copy: VarianceCopy;
  f: ReturnType<typeof useLexFormat>;
  isRtl: boolean;
}

function VarianceRowViewImpl({ row, label, copy, f, isRtl }: VarianceRowViewProps) {
  const tone = toneFor(row.trend);

  // Headline value: percent metrics render with a trailing %, counts as numbers.
  const currentLabel = row.isPercent
    ? f.formatPercent(row.current, { fromPercent: true, maximumFractionDigits: 1 })
    : f.formatNumber(row.current);
  const previousLabel =
    row.previous == null
      ? null
      : row.isPercent
        ? f.formatPercent(row.previous, { fromPercent: true, maximumFractionDigits: 1 })
        : f.formatNumber(row.previous);

  // Delta chip copy: signed magnitude of the % change (already signed in source).
  const deltaLabel =
    row.deltaPct == null
      ? copy.noBaseline
      : row.deltaPct === 0
        ? copy.flat
        : f.formatPercent(Math.abs(row.deltaPct), {
            fromPercent: true,
            maximumFractionDigits: 1,
          });

  const DeltaIcon =
    row.deltaPct == null || row.deltaPct === 0
      ? Minus
      : row.deltaPct > 0
        ? ArrowUpRight
        : ArrowDownRight;

  return (
    <li className="flex flex-col gap-2">
      {/* Top line: metric label · current value · delta chip */}
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate text-xs font-medium text-muted-foreground">{label}</span>
        <div className="flex items-baseline gap-2">
          <span className="text-base font-semibold tabular-nums text-foreground">
            {currentLabel}
          </span>
          <span
            className="inline-flex items-center gap-0.5 rounded-pill px-1.5 py-0.5 text-[11px] font-medium tabular-nums"
            style={{ color: tone, backgroundColor: 'color-mix(in srgb, currentColor 14%, transparent)' }}
            title={`${deltaLabel} ${copy.versus}`}
          >
            <DeltaIcon className="h-3 w-3" aria-hidden />
            {deltaLabel}
          </span>
        </div>
      </div>

      {/* Bullet bar + sparkline */}
      <div className="flex items-center gap-3">
        <BulletBar
          measurePct={row.measurePct}
          markerPct={row.markerPct}
          color={tone}
          previousTitle={
            previousLabel ? `${copy.previous}: ${previousLabel}` : copy.noBaseline
          }
        />
        <Sparkline
          path={row.sparkPath}
          dotX={row.sparkDotX}
          dotY={row.sparkDotY}
          color={tone}
          isRtl={isRtl}
        />
      </div>
    </li>
  );
}

const VarianceRowView = memo(VarianceRowViewImpl);

/* ------------------------------------------------------------------ *
 * Bullet bar — muted qualitative track, a filled measure bar (current), and a
 * vertical previous-period marker. Logical/RTL-safe positioning.
 * ------------------------------------------------------------------ */
interface BulletBarProps {
  /** 0..100 current measure fill. */
  measurePct: number;
  /** 0..100 previous marker position, or null when no baseline. */
  markerPct: number | null;
  color: string;
  previousTitle: string;
}

function BulletBarImpl({ measurePct, markerPct, color, previousTitle }: BulletBarProps) {
  return (
    <div
      className="relative h-3 flex-1 overflow-hidden rounded-pill"
      style={{ backgroundColor: TRACK_COLOR }}
    >
      {/* Measure bar (current) — anchored to inline-start, grows toward end. */}
      <div
        className="absolute inset-y-0 start-0 rounded-pill motion-safe:transition-[width] motion-safe:duration-slow"
        style={{ width: `${measurePct}%`, backgroundColor: color }}
        aria-hidden
      />
      {/* Previous-period marker — a vertical tick positioned by logical inset. */}
      {markerPct == null ? null : (
        <span
          className="absolute inset-y-[-2px] w-[2px] rounded-pill bg-foreground/70"
          style={{ insetInlineStart: `calc(${markerPct}% - 1px)` }}
          title={previousTitle}
          aria-label={previousTitle}
          role="img"
        />
      )}
    </div>
  );
}

const BulletBar = memo(BulletBarImpl);

/* ------------------------------------------------------------------ *
 * Inline-SVG sparkline (previous → current). Mirrored horizontally in RTL so
 * the time axis still reads earlier → later toward the inline-end edge.
 * ------------------------------------------------------------------ */
interface SparklineProps {
  path: string;
  dotX: number;
  dotY: number;
  color: string;
  isRtl: boolean;
}

function SparklineImpl({ path, dotX, dotY, color, isRtl }: SparklineProps) {
  return (
    <svg
      width={SPARK_W}
      height={SPARK_H}
      viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
      className="shrink-0 overflow-visible"
      style={isRtl ? { transform: 'scaleX(-1)' } : undefined}
      aria-hidden
      focusable="false"
    >
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={dotX} cy={dotY} r={2.25} fill={color} />
    </svg>
  );
}

const Sparkline = memo(SparklineImpl);

export const PeriodVarianceChart = memo(PeriodVarianceChartImpl);
