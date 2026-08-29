/**
 * [8] Contract Pipeline FUNNEL — a hand-rolled SVG funnel (NO chart library, NO
 * ResponsiveContainer).
 *
 * Renders the contract lifecycle (`draft → internal_review → legal_review →
 * negotiation → pending_signature → active`) as a vertically stacked funnel:
 * each stage is a horizontally-tapering trapezoid whose top edge matches the
 * previous stage's bottom edge and whose bottom edge is sized by that stage's
 * share of the funnel HEAD. The result reads as a true funnel narrowing toward
 * "active", with each stage labelled by its count and its % of the TOTAL
 * contracts that entered the pipeline.
 *
 * CUSTOM render (mirrors the cyber MITRE heatmap / litigation-posture pattern):
 *   - Inline `<svg>` with hand-computed trapezoid `<polygon>`s — no recharts, no
 *     `ResponsiveContainer`, so there is no library weight, no reflow loop, and
 *     none of the known recharts blank-render risk. The SVG uses a fixed
 *     `viewBox` and `preserveAspectRatio` so it scales fluidly to the card
 *     without measuring the DOM.
 *
 * PERFORMANCE
 *   - Pure + `React.memo` over the precomputed `ContractFunnelStage[]` slice from
 *     the page's single-pass `deriveAnalyticsSeries()` — this view NEVER re-walks
 *     the raw dashboard.
 *   - All geometry (trapezoid polygon points, the head value, the grand total,
 *     and each stage's %-of-total) is a single `useMemo` keyed on the slice. The
 *     SVG viewBox dimensions, the lifecycle palette, and the label table are
 *     module constants, so nothing is rebuilt per render in the hot path.
 *
 * i18n / RTL
 *   - Bilingual labels live in an in-file `{ en, ar }` table resolved via
 *     `useLocale()` (the shared `analytics-labels.ts` is intentionally NOT
 *     touched). Stage names are looked up by their normalized lifecycle key,
 *     falling back to the raw API label.
 *   - Every number/percent passes through `useLexFormat()` (Arabic-Indic digits
 *     in ar). The SVG funnel is symmetric so it is direction-agnostic; the
 *     stage rows that flank it use logical props and reverse in Arabic so the
 *     count/percent column always sits on the inline-end edge.
 */

'use client';

import { memo, useMemo } from 'react';
import { useLocale } from '@/components/providers/locale-provider';
import { useLexFormat } from '@/lib/lex/ksa';
import { cn } from '@/lib/utils';
import { seriesVar, TRACK_COLOR } from './_lib/palette';
import type { ContractFunnelStage } from './_lib/analytics-series';
import { AnalyticsChartCard } from './analytics-chart-card';

/* ------------------------------------------------------------------ *
 * Bilingual labels (in-file; resolved via the active locale).
 * ------------------------------------------------------------------ */

interface FunnelStrings {
  title: string;
  description: string;
  /** Stage labels keyed by normalized lifecycle key; unknown keys fall back to the raw label. */
  stages: Record<string, string>;
  ofTotal: string;
  head: string;
  empty: string;
  /** Accessible row description: stage = count (pct of total). */
  row: (stage: string, count: string, pct: string) => string;
}

const LABELS: Record<'en' | 'ar', FunnelStrings> = {
  en: {
    title: 'Contract Pipeline',
    description:
      'Contracts at each lifecycle stage, draft through active — the funnel narrows as agreements progress to signature.',
    stages: {
      draft: 'Draft',
      internal_review: 'Internal Review',
      legal_review: 'Legal Review',
      negotiation: 'Negotiation',
      pending_signature: 'Pending Signature',
      active: 'Active',
    },
    ofTotal: 'of total',
    head: 'Entered pipeline',
    empty: 'No contract-pipeline data for this window.',
    row: (stage, count, pct) => `${stage}: ${count} (${pct} of total)`,
  },
  ar: {
    title: 'مسار العقود',
    description:
      'العقود في كل مرحلة من دورة حياتها، من المسودة حتى التفعيل — يضيق المسار كلما تقدّمت الاتفاقيات نحو التوقيع.',
    stages: {
      draft: 'مسودة',
      internal_review: 'مراجعة داخلية',
      legal_review: 'مراجعة قانونية',
      negotiation: 'تفاوض',
      pending_signature: 'بانتظار التوقيع',
      active: 'سارٍ',
    },
    ofTotal: 'من الإجمالي',
    head: 'دخلت المسار',
    empty: 'لا توجد بيانات لمسار العقود لهذه الفترة.',
    row: (stage, count, pct) => `${stage}: ${count} (${pct} من الإجمالي)`,
  },
};

/* ------------------------------------------------------------------ *
 * Static SVG geometry (module constants — never rebuilt per render).
 * A fixed viewBox keeps the funnel resolution-independent; the card scales it.
 * ------------------------------------------------------------------ */
const VB_WIDTH = 100; // viewBox width units
const STAGE_HEIGHT = 26; // vertical units per stage band
const STAGE_GAP = 4; // vertical gap between bands
const MIN_TOP_WIDTH = 8; // narrowest the funnel mouth is allowed to taper to (units)
const CHART_HEIGHT = 320;

export interface ContractFunnelChartProps {
  /** Precomputed lifecycle-ordered stages from `deriveAnalyticsSeries()`. */
  data: ContractFunnelStage[];
  /** Render the card body as a shimmer while the dashboard query is in flight. */
  loading?: boolean;
  /** Optional extra classes on the chart card (e.g. column spans). */
  className?: string;
}

interface FunnelGeom {
  /** One renderable band per stage, top→bottom. */
  bands: Array<{
    key: string;
    /** Stage count. */
    value: number;
    /** Share of the funnel head, 0..1 (drives the taper width). */
    headShare: number;
    /** Share of the grand total, 0..1 (the labelled "%"). */
    totalShare: number;
    /** Series fill for this stage. */
    color: string;
    /** Trapezoid polygon points, in viewBox units. */
    points: string;
    /** Vertical center of the band (for the inline label baseline), viewBox units. */
    midY: number;
  }>;
  /** Funnel head value (first non-zero stage). */
  head: number;
  /** Grand total of all stages. */
  total: number;
  /** Total SVG height in viewBox units. */
  vbHeight: number;
}

function ContractFunnelChartImpl({ data, loading = false, className }: ContractFunnelChartProps) {
  const { locale, direction } = useLocale();
  const f = useLexFormat();
  const strings = LABELS[locale === 'ar' ? 'ar' : 'en'];
  const isRtl = direction === 'rtl';

  /* Single-pass geometry: head, total, and per-stage trapezoid points. Keyed on
     the derived slice so it only recomputes when the data changes. */
  const geom = useMemo<FunnelGeom>(() => {
    // The derived `share` is already "value / funnelHead". Recover the head from
    // the first stage that carries a positive share (== the head stage itself),
    // and the grand total by summing every stage's value.
    let head = 0;
    let total = 0;
    for (const stage of data) {
      total += stage.value;
      if (head === 0 && stage.share > 0 && stage.value > 0) {
        head = Math.round(stage.value / stage.share);
      }
    }
    if (head <= 0) head = Math.max(1, total);

    // Map each stage's head-share onto a top-width fraction. The first stage
    // opens the full mouth; later stages taper toward MIN_TOP_WIDTH so even a
    // zero/near-zero tail stage stays visible as a sliver.
    const widthFor = (headShare: number) =>
      MIN_TOP_WIDTH + (VB_WIDTH - MIN_TOP_WIDTH) * Math.min(Math.max(headShare, 0), 1);

    const bands = data.map((stage, i) => {
      const topShare = i === 0 ? 1 : data[i - 1].share;
      const topWidth = widthFor(topShare);
      const bottomWidth = widthFor(stage.share);
      const y = i * (STAGE_HEIGHT + STAGE_GAP);
      const halfTop = topWidth / 2;
      const halfBottom = bottomWidth / 2;
      const cx = VB_WIDTH / 2;
      // Trapezoid: top-left, top-right, bottom-right, bottom-left.
      const points = [
        `${cx - halfTop},${y}`,
        `${cx + halfTop},${y}`,
        `${cx + halfBottom},${y + STAGE_HEIGHT}`,
        `${cx - halfBottom},${y + STAGE_HEIGHT}`,
      ].join(' ');
      return {
        key: stage.key,
        value: stage.value,
        headShare: Math.min(Math.max(stage.share, 0), 1),
        totalShare: total > 0 ? stage.value / total : 0,
        color: seriesVar(i),
        points,
        midY: y + STAGE_HEIGHT / 2,
      };
    });

    const vbHeight =
      data.length > 0 ? data.length * STAGE_HEIGHT + (data.length - 1) * STAGE_GAP : STAGE_HEIGHT;

    return { bands, head, total, vbHeight };
  }, [data]);

  const isEmpty = geom.total <= 0;

  return (
    <AnalyticsChartCard
      title={strings.title}
      description={strings.description}
      loading={loading}
      empty={!loading && isEmpty}
      emptyMessage={strings.empty}
      className={className}
      minBodyHeight={CHART_HEIGHT}
    >
      <div className="flex h-full flex-col gap-4">
        {/* Head summary: total contracts that entered the pipeline. */}
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-bold tabular-nums text-foreground">
            {f.formatNumber(geom.head)}
          </span>
          <span className="text-xs text-muted-foreground">{strings.head}</span>
        </div>

        {/* Funnel + flanking stage rows. The SVG is symmetric, so it is
            direction-agnostic; the label rows flip via flex-row-reverse in RTL. */}
        <div
          className={cn(
            'flex flex-1 items-stretch gap-4',
            isRtl ? 'flex-row-reverse' : 'flex-row',
          )}
        >
          {/* The SVG funnel */}
          <svg
            viewBox={`0 0 ${VB_WIDTH} ${geom.vbHeight}`}
            preserveAspectRatio="none"
            className="h-full w-[58%] shrink-0"
            role="img"
            aria-label={strings.title}
          >
            {geom.bands.map((band) => (
              <polygon
                key={band.key}
                points={band.points}
                fill={band.value > 0 ? band.color : TRACK_COLOR}
                fillOpacity={band.value > 0 ? 0.92 : 0.5}
                stroke="hsl(var(--card))"
                strokeWidth={0.6}
                className="motion-safe:transition-opacity motion-safe:duration-slow"
              />
            ))}
          </svg>

          {/* Stage legend rows, aligned to the funnel bands. */}
          <ul className="flex flex-1 flex-col justify-between gap-1 py-0.5">
            {geom.bands.map((band) => {
              const name = strings.stages[band.key] ?? band.key;
              const countLabel = f.formatNumber(band.value);
              const pctLabel = f.formatPercent(band.totalShare, { maximumFractionDigits: 1 });
              return (
                <li
                  key={band.key}
                  title={strings.row(name, countLabel, pctLabel)}
                  className={cn(
                    'flex items-center justify-between gap-2 text-xs motion-safe:animate-fade-up',
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      className="inline-block h-2.5 w-2.5 shrink-0 rounded-pill"
                      style={{ backgroundColor: band.value > 0 ? band.color : TRACK_COLOR }}
                      aria-hidden
                    />
                    <span className="truncate font-medium text-foreground">{name}</span>
                  </span>
                  <span className="flex shrink-0 items-baseline gap-1.5 text-end">
                    <span className="text-sm font-semibold tabular-nums text-foreground">
                      {countLabel}
                    </span>
                    <span className="text-[11px] tabular-nums text-muted-foreground">
                      {pctLabel}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>

        {/* Footer caption clarifying the % basis. */}
        <p className="text-[11px] text-muted-foreground">{strings.ofTotal}</p>
      </div>
    </AnalyticsChartCard>
  );
}

/** Memoized pure funnel view over its derived slice. */
export const ContractFunnelChart = memo(ContractFunnelChartImpl);

export default ContractFunnelChart;
