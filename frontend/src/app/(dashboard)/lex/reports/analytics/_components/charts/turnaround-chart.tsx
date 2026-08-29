/**
 * [6] Turnaround Comparison — horizontal BAR chart.
 *
 * Compares the three operational throughput stages of the legal department by
 * their AVERAGE handling time (hours):
 *   - contract review        (avg_review_duration_hours)
 *   - consultation completion (avg_completion_time_hours)
 *   - request processing      (avg_request_processing_hours)
 *
 * A horizontal bar makes the (often long, bilingual) stage labels readable and
 * the relative durations comparable at a glance. Each bar is colored from the
 * shared categorical ramp so the same stage is the same color anywhere it is
 * referenced. Sample sizes (how many measured items produced each average) are
 * surfaced as a caption under each stage so the reader knows the average's
 * statistical weight.
 *
 * PERF CONTRACT
 *   - PURE + `React.memo`: re-renders only when its precomputed slice / sample
 *     map / loading / className change.
 *   - The ONLY local transform (slice → recharts rows + per-bar cell colors) is
 *     a single `useMemo` keyed on `data` + the resolved label set + `samples`.
 *     It does NOT re-walk the raw dashboard nor recompute
 *     `deriveAnalyticsSeries` — it consumes the already-derived `turnaround`
 *     slice handed down as a prop.
 *   - REUSES the shared `<BarChart>` wrapper, which code-splits recharts via a
 *     dynamic import of `bar-chart-impl`. No chart library is imported here.
 *   - Series config + geometry constants are hoisted / memoized so no new
 *     object/array literal churns in the hot path.
 *
 * RTL: the shared `<BarChart>` axes mirror under the card's locale `dir`
 * (stamped by `<AnalyticsChartCard>`); all copy + sample captions come from the
 * in-file bilingual label set, and numbers/hours go through `useLexFormat` so
 * Arabic mode renders Arabic-Indic digits.
 */

'use client';

import { memo, useMemo } from 'react';
import { BarChart } from '@/components/shared/charts/bar-chart';
import { useLocale } from '@/components/providers/locale-provider';
import { useLexFormat } from '@/lib/lex/ksa';
import type { TurnaroundPoint } from './_lib/analytics-series';
import { seriesVar } from './_lib/palette';
import { AnalyticsChartCard } from './analytics-chart-card';

/* ---- Bilingual, in-file labels (no shared analytics-labels.ts edits) ---- */
const COPY = {
  en: {
    title: 'Turnaround Comparison',
    description: 'Average handling time across the three throughput stages.',
    empty: 'No turnaround data for the selected window.',
    hoursAxis: 'Average hours',
    /** Per-stage display label, keyed on the derived `TurnaroundPoint.key`. */
    stage: {
      contract_review: 'Contract review',
      consultation_completion: 'Consultation completion',
      request_processing: 'Request processing',
    } as Record<TurnaroundPoint['key'], string>,
    /** "n = 12" style sample-size chip. */
    sample: (n: string) => `n = ${n}`,
    noSample: 'no sample',
    hoursUnit: 'h',
  },
  ar: {
    title: 'مقارنة زمن الإنجاز',
    description: 'متوسط زمن المعالجة عبر مراحل الإنتاجية الثلاث.',
    empty: 'لا توجد بيانات زمن إنجاز للنطاق المحدد.',
    hoursAxis: 'متوسط الساعات',
    stage: {
      contract_review: 'مراجعة العقود',
      consultation_completion: 'إنجاز الاستشارات',
      request_processing: 'معالجة الطلبات',
    } as Record<TurnaroundPoint['key'], string>,
    sample: (n: string) => `ن = ${n}`,
    noSample: 'لا توجد عينة',
    hoursUnit: 'س',
  },
} as const;

const CHART_HEIGHT = 240;
/** Stable render order of the three stages. */
const STAGE_ORDER: ReadonlyArray<TurnaroundPoint['key']> = [
  'contract_review',
  'consultation_completion',
  'request_processing',
];

/** Per-stage sample sizes (how many measured items each average is built from). */
export type TurnaroundSamples = Partial<Record<TurnaroundPoint['key'], number>>;

export interface TurnaroundChartProps {
  /** Already-derived slice from `deriveAnalyticsSeries().turnaround`. */
  data: TurnaroundPoint[];
  /**
   * Optional sample-size map (review / completion / request counts) so each
   * average can be annotated with its statistical weight. Sourced from the
   * dashboard's `*_sample_size` fields by the page; absent → no chip.
   */
  samples?: TurnaroundSamples;
  /** Shimmer state while the dashboard query is in flight. */
  loading?: boolean;
  /** Optional column-span / layout classes forwarded to the card. */
  className?: string;
}

interface TurnaroundRow extends Record<string, unknown> {
  /** Localized stage label used as the category axis tick. */
  stage: string;
  /** Average hours (rounded to 1dp). */
  hours: number;
  /** Stable key for color lookup + sample annotation. */
  key: TurnaroundPoint['key'];
  /** Sample size for this stage, or null when unknown. */
  sample: number | null;
}

function TurnaroundChartImpl({ data, samples, loading = false, className }: TurnaroundChartProps) {
  const { locale } = useLocale();
  const f = useLexFormat();
  const copy = locale === 'ar' ? COPY.ar : COPY.en;

  /* All per-chart transforms in a single useMemo keyed on the inputs that
   * change its output: the derived slice, the resolved labels, the samples. */
  const view = useMemo(() => {
    // Index the (small, fixed) slice by key so render order is stable and
    // independent of the slice's array order.
    const byKey = new Map<TurnaroundPoint['key'], number>();
    for (const p of data) byKey.set(p.key, p.hours || 0);

    const rows: TurnaroundRow[] = STAGE_ORDER.map((key) => {
      const sample = samples?.[key];
      return {
        stage: copy.stage[key],
        hours: Number((byKey.get(key) ?? 0).toFixed(1)),
        key,
        sample: typeof sample === 'number' ? sample : null,
      };
    });

    // One categorical color per bar, in render order, from the shared ramp.
    const cellColors = STAGE_ORDER.map((_, i) => seriesVar(i));

    const hasAny = rows.some((r) => r.hours > 0);

    return { rows, cellColors, hasAny };
  }, [data, samples, copy.stage]);

  /* Single y-series config (hours). Memoized so the wrapper's `yKeys`
   * reference stays stable across re-renders (color is a token, not locale). */
  const yKeys = useMemo(
    () => [{ key: 'hours', label: copy.hoursAxis, color: seriesVar(0) }],
    [copy.hoursAxis],
  );

  const isEmpty = !view.hasAny;

  // Hours value formatter for both axis ticks and the tooltip. Stable per
  // locale (useLexFormat is memoized on locale).
  const hoursFormatter = (value: number) =>
    `${f.formatNumber(value, { maximumFractionDigits: 1 })} ${copy.hoursUnit}`;
  // The horizontal-layout numeric axis is the X axis; its formatter is typed to
  // accept `string | number`, so widen the input before delegating.
  const xHoursFormatter = (value: string | number) => hoursFormatter(Number(value));

  return (
    <AnalyticsChartCard
      title={copy.title}
      description={copy.description}
      loading={loading}
      empty={!loading && isEmpty}
      emptyMessage={copy.empty}
      minBodyHeight={CHART_HEIGHT + 56}
      className={className}
    >
      <div className="flex h-full flex-col gap-3">
        <BarChart
          data={view.rows}
          xKey="stage"
          yKeys={yKeys}
          cellColors={view.cellColors}
          layout="horizontal"
          height={CHART_HEIGHT}
          xFormatter={xHoursFormatter}
          yFormatter={hoursFormatter}
          showGrid
          showLegend={false}
          empty={isEmpty}
          emptyMessage={copy.empty}
        />

        {/* Sample-size captions: surface each average's statistical weight so a
            "fast" stage built on a tiny sample is not over-read. */}
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
          {view.rows.map((row, i) => (
            <span
              key={row.key}
              className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground"
            >
              <span
                className="inline-block h-2 w-2 rounded-pill"
                style={{ backgroundColor: view.cellColors[i] }}
                aria-hidden
              />
              <span className="font-medium text-foreground">{row.stage}</span>
              <span className="tabular-nums">
                (
                {row.sample == null
                  ? copy.noSample
                  : copy.sample(f.formatNumber(row.sample))}
                )
              </span>
            </span>
          ))}
        </div>
      </div>
    </AnalyticsChartCard>
  );
}

/**
 * PERF: `React.memo` — re-renders only when `data`/`samples`/`loading`/
 * `className` change. The page hands down a referentially-stable `turnaround`
 * slice (memoized in the Foundation's single `deriveAnalyticsSeries` pass), so
 * steady-state dashboard re-renders never re-render this chart.
 */
export const TurnaroundChart = memo(TurnaroundChartImpl);
