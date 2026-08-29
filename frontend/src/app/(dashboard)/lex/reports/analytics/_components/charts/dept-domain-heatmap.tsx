'use client';

/**
 * [5] Department × Domain Workload HEATMAP — a hand-rolled CSS-grid / SVG-free
 * intensity matrix (NO chart library, NO ResponsiveContainer).
 *
 * rows    = legal departments (union of the three `by_department` arrays)
 * columns = [Cases, Contracts, Consultations]
 * cell    = count, tinted along the shared 4-stop severity heat ramp so a busier
 *           department×domain intersection reads hotter. Mirrors the cyber MITRE
 *           heatmap pattern (pure divs, design-token fills, sticky leading
 *           label, per-row + per-column totals + a gradient legend).
 *
 * PERFORMANCE
 *   - `React.memo` over the precomputed `DeptDomainHeatmap` slice — the page's
 *     single-pass `deriveAnalyticsSeries()` already built rows/totals/max, so
 *     this view NEVER re-walks the raw dashboard.
 *   - The only local transform (per-column totals + the legend ramp samples) is
 *     hoisted into `useMemo` keyed on the slice, and the static palette/legend
 *     stops are module constants — nothing is rebuilt per render in the hot path.
 *   - Pure divs + design-system `hsl(var(--…))` token fills (re-theme in dark
 *     mode), so there is no SVG layout/reflow and none of the recharts
 *     blank-render risk.
 *
 * i18n / RTL
 *   - Bilingual labels live in an in-file `{ en, ar }` object resolved via
 *     `useLocale()` (the shared `analytics-labels.ts` is intentionally NOT
 *     touched, to avoid merge conflicts across the 10 chart agents).
 *   - Every number passes through `useLexFormat().formatNumber` (Arabic-Indic in
 *     ar). The grid uses logical props (`start-0`, `text-start`, `pe-*`) so the
 *     department label column sits on the inline-start edge and flips to the
 *     right in Arabic mode; the legend's light→heavy order mirrors as well.
 */

import { memo, useMemo, type CSSProperties } from 'react';
import { useLocale } from '@/components/providers/locale-provider';
import { useLexFormat } from '@/lib/lex/ksa';
import { cn } from '@/lib/utils';
import { AnalyticsChartCard } from './analytics-chart-card';
import { heatVar, HAIRLINE_COLOR, TRACK_COLOR } from './_lib/palette';
import type { DeptDomainHeatmap as DeptDomainHeatmapSlice } from './_lib/analytics-series';

/* ------------------------------------------------------------------ *
 * Bilingual labels (in-file; resolved via the active locale).
 * ------------------------------------------------------------------ */

interface HeatmapStrings {
  title: string;
  description: string;
  /** Column header labels, keyed by the slice's column id. */
  columns: Record<DeptDomainHeatmapSlice['columns'][number], string>;
  department: string;
  total: string;
  empty: string;
  legendLight: string;
  legendHeavy: string;
  /** Accessible cell description: department × domain = count. */
  cell: (department: string, domain: string, count: string) => string;
}

const LABELS: Record<'en' | 'ar', HeatmapStrings> = {
  en: {
    title: 'Department × Domain Workload',
    description:
      'Matter volume per department across cases, contracts and consultations — darker cells carry the heaviest load.',
    columns: {
      cases: 'Cases',
      contracts: 'Contracts',
      consultations: 'Consultations',
    },
    department: 'Department',
    total: 'Total',
    empty: 'No departmental workload to display.',
    legendLight: 'Light',
    legendHeavy: 'Heavy',
    cell: (department, domain, count) => `${department} · ${domain}: ${count}`,
  },
  ar: {
    title: 'حِمل العمل حسب الإدارة والمجال',
    description:
      'حجم الأعمال لكل إدارة عبر القضايا والعقود والاستشارات — الخلايا الأغمق تحمل العبء الأكبر.',
    columns: {
      cases: 'القضايا',
      contracts: 'العقود',
      consultations: 'الاستشارات',
    },
    department: 'الإدارة',
    total: 'الإجمالي',
    empty: 'لا يوجد حِمل عمل للإدارات لعرضه.',
    legendLight: 'خفيف',
    legendHeavy: 'ثقيل',
    cell: (department, domain, count) => `${department} · ${domain}: ${count}`,
  },
};

/* ------------------------------------------------------------------ *
 * Static legend ramp samples (fractions of `max`). Module constant so the
 * array literal is NOT recreated on every render.
 * ------------------------------------------------------------------ */
const LEGEND_STOPS: readonly number[] = [0.15, 0.4, 0.6, 0.85, 1] as const;

export interface DeptDomainHeatmapProps {
  /** Precomputed slice from `deriveAnalyticsSeries()`. */
  data: DeptDomainHeatmapSlice;
  /** Shimmer skeleton while the dashboard query is in flight. */
  loading?: boolean;
  /** Optional extra classes on the chart card (e.g. column spans). */
  className?: string;
}

function DeptDomainHeatmapImpl({ data, loading = false, className }: DeptDomainHeatmapProps) {
  const { locale } = useLocale();
  const f = useLexFormat();
  const strings = LABELS[locale === 'ar' ? 'ar' : 'en'];

  const { departments, columns, rows, rowTotals, max } = data;

  /* Local transform: per-column totals + grand total + legend swatch colors.
     Keyed on the slice so it only recomputes when the derived data changes. */
  const { columnTotals, grandTotal, legendSwatches } = useMemo(() => {
    const colTotals = columns.map((_, ci) => {
      let sum = 0;
      for (const row of rows) sum += row[ci] ?? 0;
      return sum;
    });
    const grand = colTotals.reduce((sum, v) => sum + v, 0);
    // Resolve each legend stop to its heat color once (max is stable per slice).
    const swatches = LEGEND_STOPS.map((stop) =>
      heatVar(Math.max(1, Math.round(stop * max)), max),
    );
    return { columnTotals: colTotals, grandTotal: grand, legendSwatches: swatches };
  }, [columns, rows, max]);

  const isEmpty = departments.length === 0 || columns.length === 0;

  // Grid: [department label] [domain columns…] [row total].
  const gridTemplateColumns = `minmax(8rem, 1.6fr) repeat(${columns.length}, minmax(4rem, 1fr)) minmax(4rem, auto)`;

  return (
    <AnalyticsChartCard
      title={strings.title}
      description={strings.description}
      loading={loading}
      empty={!loading && isEmpty}
      emptyMessage={strings.empty}
      className={className}
      bodyClassName="overflow-x-auto"
    >
      <div
        role="grid"
        aria-label={strings.title}
        className="grid min-w-max gap-1 text-xs"
        style={{ gridTemplateColumns }}
      >
        {/* ---- Header row: corner + domain labels + total ---- */}
        <div
          role="columnheader"
          className="sticky start-0 z-20 flex items-end bg-card pb-2 pe-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
        >
          {strings.department}
        </div>
        {columns.map((col) => (
          <div
            key={col}
            role="columnheader"
            title={strings.columns[col]}
            className="flex items-end justify-center pb-2 text-center"
          >
            <span className="line-clamp-2 text-[11px] font-medium leading-tight text-muted-foreground">
              {strings.columns[col]}
            </span>
          </div>
        ))}
        <div
          role="columnheader"
          className="flex items-end justify-center pb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
        >
          {strings.total}
        </div>

        {/* ---- Department rows ---- */}
        {departments.map((department, rowIdx) => {
          const row = rows[rowIdx] ?? [];
          return (
            <div key={department} role="row" className="contents">
              {/* Sticky department label — sits on the inline-start edge
                  (flips to the right in Arabic via logical `start-0`). */}
              <div
                role="rowheader"
                title={department}
                className="sticky start-0 z-10 flex items-center bg-card pe-3 text-start motion-safe:animate-fade-up"
                style={{ animationDelay: `${Math.min(rowIdx * 30, 240)}ms` }}
              >
                <span className="truncate font-medium text-foreground">{department}</span>
              </div>

              {/* Cells */}
              {columns.map((col, ci) => {
                const count = row[ci] ?? 0;
                const heavy = max > 0 && count / max >= 0.5;
                const cellLabel = strings.cell(
                  department,
                  strings.columns[col],
                  f.formatNumber(count),
                );
                return (
                  <div
                    key={col}
                    role="gridcell"
                    title={cellLabel}
                    aria-label={cellLabel}
                    className={cn(
                      'flex h-11 items-center justify-center rounded-md font-semibold tabular-nums',
                      'ring-1 ring-inset duration-fast ease-standard',
                      heavy ? 'text-white' : 'text-foreground',
                    )}
                    style={
                      {
                        backgroundColor: heatVar(count, max),
                        // hairline ring bound to the design system; logical-safe.
                        '--tw-ring-color': HAIRLINE_COLOR,
                      } as CSSProperties
                    }
                  >
                    {count > 0 ? f.formatNumber(count) : ''}
                  </div>
                );
              })}

              {/* Row total */}
              <div
                role="gridcell"
                className="flex h-11 items-center justify-center rounded-md font-semibold tabular-nums text-foreground ring-1 ring-inset ring-border/50"
                style={{ backgroundColor: TRACK_COLOR }}
              >
                {f.formatNumber(rowTotals[rowIdx] ?? 0)}
              </div>
            </div>
          );
        })}

        {/* ---- Footer: per-column totals + grand total ---- */}
        <div
          role="rowheader"
          className="sticky start-0 z-10 flex items-center bg-card pe-3 pt-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
        >
          {strings.total}
        </div>
        {columns.map((col, ci) => (
          <div
            key={col}
            role="gridcell"
            className="flex h-9 items-center justify-center rounded-md font-semibold tabular-nums text-foreground ring-1 ring-inset ring-border/50"
            style={{ backgroundColor: TRACK_COLOR }}
          >
            {f.formatNumber(columnTotals[ci] ?? 0)}
          </div>
        ))}
        <div
          role="gridcell"
          className="flex h-9 items-center justify-center rounded-md font-bold tabular-nums text-foreground ring-1 ring-inset ring-border/60"
          style={{ backgroundColor: TRACK_COLOR }}
        >
          {f.formatNumber(grandTotal)}
        </div>
      </div>

      {/* ---- Heat legend: light → heavy, mirrors in RTL via logical flow ---- */}
      <div className="mt-4 flex items-center gap-3 ps-1">
        <span className="text-[11px] text-muted-foreground">{strings.legendLight}</span>
        <div
          className="flex h-2.5 w-40 overflow-hidden rounded-full ring-1 ring-inset ring-border/50"
          aria-hidden
        >
          {legendSwatches.map((color, i) => (
            <span key={i} className="h-full flex-1" style={{ backgroundColor: color }} />
          ))}
        </div>
        <span className="text-[11px] text-muted-foreground">{strings.legendHeavy}</span>
      </div>
    </AnalyticsChartCard>
  );
}

/** Memoized pure heatmap view over its derived slice. */
export const DeptDomainHeatmap = memo(DeptDomainHeatmapImpl);

export default DeptDomainHeatmap;
