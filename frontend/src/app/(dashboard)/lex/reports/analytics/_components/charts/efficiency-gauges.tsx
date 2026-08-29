/**
 * [7] Efficiency Scorecard — a cluster of FOUR radial GAUGES.
 *
 * One half-circle gauge per operational efficiency ratio, each measured against
 * its own target band:
 *   - closed_case_ratio           (closed cases / total cases)
 *   - approved_contract_ratio     (approved contracts / total contracts)
 *   - estimated_duration_adherence (on-time clocks / resolved clocks)
 *   - sla_on_time                 (overall SLA on-time rate)
 *
 * The four gauges read as a single scorecard so leadership can see, at a glance,
 * which efficiency dimensions are clearing their bar (green), drifting
 * (amber), or failing (red). Each gauge's color band is derived from that
 * metric's OWN target (not a global threshold), and a "X of Y" / "target N%"
 * caption gives the underlying counts.
 *
 * PERF CONTRACT
 *   - PURE + `React.memo`: the scorecard re-renders only when its precomputed
 *     `gauges` slice / loading / className change. Each individual gauge tile is
 *     itself a memoized sub-component, so changing one metric does not re-render
 *     the others.
 *   - The ONLY local transform (slice → per-gauge view models: 0..100 value,
 *     target-relative thresholds, caption inputs) is a single `useMemo` keyed on
 *     `gauges` + the resolved label set. It does NOT re-walk the raw dashboard
 *     nor recompute `deriveAnalyticsSeries` — it consumes the already-derived
 *     `efficiencyGauges` slice handed down as a prop.
 *   - REUSES the shared `<GaugeChart>` wrapper, which code-splits its SVG impl
 *     via a dynamic import of `gauge-chart-impl`. No chart library is imported
 *     here; numbers are not abbreviated, they go through `useLexFormat`.
 *
 * RTL: the gauge grid is direction-agnostic (a symmetric arc + centered value);
 * all copy comes from the in-file bilingual label set and the card stamps the
 * locale `dir`, so captions flow correctly in Arabic.
 */

'use client';

import { memo, useMemo } from 'react';
import { GaugeChart } from '@/components/shared/charts/gauge-chart';
import { useLocale } from '@/components/providers/locale-provider';
import { useLexFormat } from '@/lib/lex/ksa';
import type { EfficiencyGauge } from './_lib/analytics-series';
import { AnalyticsChartCard } from './analytics-chart-card';

/* ---- Bilingual, in-file labels (no shared analytics-labels.ts edits) ---- */
const COPY = {
  en: {
    title: 'Efficiency Scorecard',
    description: 'Key efficiency ratios measured against their targets.',
    empty: 'No efficiency data for the selected window.',
    /** Per-gauge display label, keyed on the derived `EfficiencyGauge.key`. */
    metric: {
      closed_case_ratio: 'Closed cases',
      approved_contract_ratio: 'Approved contracts',
      estimated_duration_adherence: 'Duration adherence',
      sla_on_time: 'SLA on-time',
    } as Record<EfficiencyGauge['key'], string>,
    /** "12 of 30" achieved-of-total helper. */
    ofTotal: (num: string, den: string) => `${num} of ${den}`,
    /** "target 80%" band helper. */
    target: (pct: string) => `target ${pct}`,
  },
  ar: {
    title: 'بطاقة الكفاءة',
    description: 'نسب الكفاءة الرئيسية مقاسة مقابل مستهدفاتها.',
    empty: 'لا توجد بيانات كفاءة للنطاق المحدد.',
    metric: {
      closed_case_ratio: 'القضايا المغلقة',
      approved_contract_ratio: 'العقود المعتمدة',
      estimated_duration_adherence: 'الالتزام بالمدة',
      sla_on_time: 'الالتزام بمستوى الخدمة',
    } as Record<EfficiencyGauge['key'], string>,
    ofTotal: (num: string, den: string) => `${num} من ${den}`,
    target: (pct: string) => `المستهدف ${pct}`,
  },
} as const;

/** Stable render order of the four efficiency metrics. */
const METRIC_ORDER: ReadonlyArray<EfficiencyGauge['key']> = [
  'closed_case_ratio',
  'approved_contract_ratio',
  'estimated_duration_adherence',
  'sla_on_time',
];

/** Half-circle gauge diameter (px). Compact so four fit in a 2×2 grid. */
const GAUGE_SIZE = 148;
/** Card body min-height: two rows of gauges + their captions. */
const CARD_MIN_HEIGHT = 360;
/**
 * Warning band starts at 80% of the target (mirrors the Foundation's
 * `gaugeTone()` "warning at target*0.8" rule), so a metric within striking
 * distance of its goal reads amber rather than red.
 */
const WARNING_OF_TARGET = 0.8;

export interface EfficiencyGaugesProps {
  /** Already-derived slice from `deriveAnalyticsSeries().efficiencyGauges`. */
  gauges: EfficiencyGauge[];
  /** Shimmer state while the dashboard query is in flight. */
  loading?: boolean;
  /** Optional column-span / layout classes forwarded to the card. */
  className?: string;
}

/** Per-gauge view model precomputed once for the tile to render purely. */
interface GaugeView {
  key: EfficiencyGauge['key'];
  /** Achieved ratio as a 0..100 value (gauge `value`, `max=100`). */
  valuePct: number;
  /** Target band as a 0..100 value (good threshold). */
  targetPct: number;
  /** Warning threshold as a 0..100 value (= target * WARNING_OF_TARGET). */
  warningPct: number;
  /** Optional "X of Y" numerator/denominator (counts), when both present. */
  numerator?: number;
  denominator?: number;
}

function EfficiencyGaugesImpl({ gauges, loading = false, className }: EfficiencyGaugesProps) {
  const { locale } = useLocale();
  const copy = locale === 'ar' ? COPY.ar : COPY.en;

  /* Single transform pass: index the slice, then build the four view models in
   * a fixed order with target-relative thresholds. Keyed on the slice identity
   * only (labels/format are applied at the tile, not here). */
  const views = useMemo<GaugeView[]>(() => {
    const byKey = new Map<EfficiencyGauge['key'], EfficiencyGauge>();
    for (const g of gauges) byKey.set(g.key, g);

    return METRIC_ORDER.map((key) => {
      const g = byKey.get(key);
      const ratio = g?.ratio ?? 0;
      const target = g?.target ?? 0.9;
      return {
        key,
        valuePct: clampPct(ratio * 100),
        targetPct: clampPct(target * 100),
        warningPct: clampPct(target * WARNING_OF_TARGET * 100),
        numerator: g?.numerator,
        denominator: g?.denominator,
      };
    });
  }, [gauges]);

  const isEmpty = useMemo(() => gauges.length === 0, [gauges]);

  return (
    <AnalyticsChartCard
      title={copy.title}
      description={copy.description}
      loading={loading}
      empty={!loading && isEmpty}
      emptyMessage={copy.empty}
      minBodyHeight={CARD_MIN_HEIGHT}
      className={className}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {views.map((view) => (
          <GaugeTile key={view.key} view={view} label={copy.metric[view.key]} copy={copy} />
        ))}
      </div>
    </AnalyticsChartCard>
  );
}

/* ------------------------------------------------------------------ *
 * One gauge tile — its own `React.memo` so a single metric changing does not
 * re-render its siblings. Reads `useLexFormat` for locale-aware numbers/%.
 * ------------------------------------------------------------------ */

interface GaugeTileProps {
  view: GaugeView;
  label: string;
  copy: typeof COPY.en | typeof COPY.ar;
}

function GaugeTileImpl({ view, label, copy }: GaugeTileProps) {
  const f = useLexFormat();

  // Gauge color thresholds are expressed as percentages of `max` (=100), so we
  // hand the gauge the target/warning directly as 0..100 numbers.
  const thresholds = useMemo(
    () => ({ good: view.targetPct, warning: view.warningPct }),
    [view.targetPct, view.warningPct],
  );

  const targetCaption = copy.target(
    f.formatPercent(view.targetPct, { fromPercent: true, maximumFractionDigits: 0 }),
  );
  const countCaption =
    typeof view.numerator === 'number' && typeof view.denominator === 'number'
      ? copy.ofTotal(f.formatNumber(view.numerator), f.formatNumber(view.denominator))
      : null;

  // Localized percentage rendered as the gauge's center value (the shared
  // gauge's own "percentage" format uses Latin digits / no locale, so we hide
  // it and stamp our own KSA-formatted value beneath).
  const valueLabel = f.formatPercent(view.valuePct, {
    fromPercent: true,
    maximumFractionDigits: 0,
  });

  return (
    <div className="flex flex-col items-center gap-1 rounded-xl border border-border/40 bg-card/40 px-3 py-3">
      <GaugeChart
        value={view.valuePct}
        max={100}
        thresholds={thresholds}
        size={GAUGE_SIZE}
        showValue={false}
        format="percentage"
      />
      <span className="text-h3 font-bold tabular-nums leading-none text-foreground">
        {valueLabel}
      </span>
      <span className="text-center text-xs font-medium text-foreground">{label}</span>
      <span className="text-center text-[11px] tabular-nums text-muted-foreground">
        {countCaption ? `${countCaption} · ` : ''}
        {targetCaption}
      </span>
    </div>
  );
}

const GaugeTile = memo(GaugeTileImpl);

/** Clamp a number into the 0..100 gauge range (defensive). Pure. */
function clampPct(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 100) return 100;
  return value;
}

/**
 * PERF: `React.memo` — the scorecard re-renders only when `gauges`/`loading`/
 * `className` change. The page hands down a referentially-stable
 * `efficiencyGauges` slice (memoized in the Foundation's single
 * `deriveAnalyticsSeries` pass), so steady-state dashboard re-renders never
 * re-render this scorecard.
 */
export const EfficiencyGauges = memo(EfficiencyGaugesImpl);
