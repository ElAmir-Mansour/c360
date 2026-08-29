/**
 * [10] Matter-Type Mix TREEMAP — a hand-rolled squarified treemap (NO chart
 * library, NO ResponsiveContainer).
 *
 * Tiles the card with one rectangle per matter TYPE (the union of case + legal
 * consultation `by_type` buckets), where each tile's AREA is proportional to its
 * count, so the visual weight of "Commercial", "Labor", "Real-Estate" … reads at
 * a glance. Each tile is colored from the shared categorical ramp and stamped
 * with its label, count, and share of the total.
 *
 * CUSTOM render (mirrors the cyber MITRE heatmap pattern):
 *   - Pure absolutely-positioned `<div>` tiles laid out by a squarified
 *     treemap algorithm — NO recharts, NO `ResponsiveContainer`. The layout is
 *     computed in a normalized 0..100 × 0..100 space and projected to percentage
 *     `inset`s, so the tiles scale fluidly to the card with zero DOM measurement
 *     and none of the recharts blank-render / reflow risk.
 *
 * PERFORMANCE
 *   - Pure + `React.memo` over the precomputed, pre-sorted `TreemapNode[]` slice
 *     from the page's single-pass `deriveAnalyticsSeries()` — this view NEVER
 *     re-walks the raw dashboard.
 *   - The squarify layout + per-tile color is one `useMemo` keyed on the slice.
 *     The label table, palette and the layout constants are module constants, so
 *     nothing is rebuilt per render in the hot path.
 *
 * i18n / RTL
 *   - Bilingual labels live in an in-file `{ en, ar }` table resolved via
 *     `useLocale()` (the shared `analytics-labels.ts` is intentionally NOT
 *     touched). Type names are looked up by normalized key, falling back to the
 *     raw API label.
 *   - Every number/percent passes through `useLexFormat()` (Arabic-Indic in ar).
 *     The tile grid is mirrored in Arabic so the largest matter type anchors the
 *     inline-start (top-leading) corner in both directions.
 */

'use client';

import { memo, useMemo } from 'react';
import { useLocale } from '@/components/providers/locale-provider';
import { useLexFormat } from '@/lib/lex/ksa';
import { cn } from '@/lib/utils';
import { seriesVar } from './_lib/palette';
import type { TreemapNode } from './_lib/analytics-series';
import { AnalyticsChartCard } from './analytics-chart-card';

/* ------------------------------------------------------------------ *
 * Bilingual labels (in-file; resolved via the active locale).
 * ------------------------------------------------------------------ */

interface TreemapStrings {
  title: string;
  description: string;
  /** Type labels keyed by normalized type key; unknown keys fall back to the raw label. */
  types: Record<string, string>;
  empty: string;
  /** Accessible tile description: type = count (share). */
  tile: (type: string, count: string, share: string) => string;
}

const LABELS: Record<'en' | 'ar', TreemapStrings> = {
  en: {
    title: 'Matter-Type Mix',
    description:
      'Share of legal matters by type across cases and consultations — each tile is sized by volume.',
    types: {
      commercial: 'Commercial',
      civil: 'Civil',
      labor: 'Labor',
      labour: 'Labor',
      criminal: 'Criminal',
      administrative: 'Administrative',
      real_estate: 'Real Estate',
      corporate: 'Corporate',
      intellectual_property: 'Intellectual Property',
      contractual: 'Contractual',
      regulatory: 'Regulatory',
      tax: 'Tax',
      employment: 'Employment',
      litigation: 'Litigation',
      arbitration: 'Arbitration',
      compliance: 'Compliance',
      advisory: 'Advisory',
      general: 'General',
      other: 'Other',
    },
    empty: 'No matter-type data for this window.',
    tile: (type, count, share) => `${type}: ${count} (${share})`,
  },
  ar: {
    title: 'توزيع أنواع القضايا',
    description:
      'حصة الأعمال القانونية حسب النوع عبر القضايا والاستشارات — يُقاس حجم كل مربع بالكمية.',
    types: {
      commercial: 'تجاري',
      civil: 'مدني',
      labor: 'عمالي',
      labour: 'عمالي',
      criminal: 'جنائي',
      administrative: 'إداري',
      real_estate: 'عقاري',
      corporate: 'شركات',
      intellectual_property: 'ملكية فكرية',
      contractual: 'تعاقدي',
      regulatory: 'تنظيمي',
      tax: 'ضريبي',
      employment: 'توظيف',
      litigation: 'تقاضي',
      arbitration: 'تحكيم',
      compliance: 'امتثال',
      advisory: 'استشاري',
      general: 'عام',
      other: 'أخرى',
    },
    empty: 'لا توجد بيانات لأنواع القضايا لهذه الفترة.',
    tile: (type, count, share) => `${type}: ${count} (${share})`,
  },
};

/* ------------------------------------------------------------------ *
 * Layout constants (module-level so nothing is rebuilt per render).
 * The treemap is computed in a normalized 0..100 square then projected to %.
 * ------------------------------------------------------------------ */
const SIDE = 100; // normalized square side
const CHART_HEIGHT = 320;
/** Below this share a tile is too small to legibly carry its count line. */
const COUNT_VISIBLE_SHARE = 0.05;
/** Below this share a tile is too small to carry even its name. */
const LABEL_VISIBLE_SHARE = 0.025;

/** A laid-out treemap tile in normalized [0..100] coordinates. */
interface Tile {
  key: string;
  label: string;
  value: number;
  share: number;
  color: string;
  /** Rect in normalized units. */
  x: number;
  y: number;
  w: number;
  h: number;
}

/* ------------------------------------------------------------------ *
 * Squarified treemap layout (Bruls, Huizing, van Wijk). Pure function: areas in,
 * rects out. Operates on a working copy so the input slice is never mutated.
 * ------------------------------------------------------------------ */

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Worst aspect ratio of a row of areas laid along the shorter side `w`. */
function worstRatio(row: number[], w: number): number {
  if (row.length === 0 || w <= 0) return Infinity;
  let sum = 0;
  let min = Infinity;
  let max = -Infinity;
  for (const a of row) {
    sum += a;
    if (a < min) min = a;
    if (a > max) max = a;
  }
  const w2 = w * w;
  const sum2 = sum * sum;
  return Math.max((w2 * max) / sum2, sum2 / (w2 * min));
}

/** Lay a finished row of areas across the shorter side of `rect`, returning the
 *  leftover rect to continue tiling into. Pushes positioned rects into `out`. */
function layoutRow(
  row: Array<{ area: number; idx: number }>,
  rect: Rect,
  out: Array<Rect & { idx: number }>,
): Rect {
  let rowArea = 0;
  for (const r of row) rowArea += r.area;
  const horizontal = rect.w >= rect.h;

  if (horizontal) {
    const rowW = rect.h > 0 ? rowArea / rect.h : 0;
    let cursorY = rect.y;
    for (const r of row) {
      const h = rowArea > 0 ? (r.area / rowArea) * rect.h : 0;
      out.push({ x: rect.x, y: cursorY, w: rowW, h, idx: r.idx });
      cursorY += h;
    }
    return { x: rect.x + rowW, y: rect.y, w: rect.w - rowW, h: rect.h };
  }

  const rowH = rect.w > 0 ? rowArea / rect.w : 0;
  let cursorX = rect.x;
  for (const r of row) {
    const w = rowArea > 0 ? (r.area / rowArea) * rect.w : 0;
    out.push({ x: cursorX, y: rect.y, w, h: rowH, idx: r.idx });
    cursorX += w;
  }
  return { x: rect.x, y: rect.y + rowH, w: rect.w, h: rect.h - rowH };
}

/** Squarify `areas` (already scaled to fill `rect`'s area) into positioned rects
 *  indexed back to the source order. Iterative, single allocation per row. */
function squarify(areas: number[], rect: Rect): Array<Rect & { idx: number }> {
  const out: Array<Rect & { idx: number }> = [];
  let remaining = rect;
  let i = 0;
  let row: Array<{ area: number; idx: number }> = [];
  let rowAreas: number[] = [];

  while (i < areas.length) {
    const shortSide = Math.min(remaining.w, remaining.h);
    const area = areas[i];
    const tentative = [...rowAreas, area];
    if (row.length === 0 || worstRatio(tentative, shortSide) <= worstRatio(rowAreas, shortSide)) {
      row.push({ area, idx: i });
      rowAreas = tentative;
      i += 1;
    } else {
      remaining = layoutRow(row, remaining, out);
      row = [];
      rowAreas = [];
    }
  }
  if (row.length > 0) layoutRow(row, remaining, out);
  return out;
}

export interface MatterTypeTreemapProps {
  /** Precomputed, descending-sorted matter-type nodes from `deriveAnalyticsSeries()`. */
  data: TreemapNode[];
  /** Render the card body as a shimmer while the dashboard query is in flight. */
  loading?: boolean;
  /** Optional extra classes on the chart card (e.g. column spans). */
  className?: string;
}

function MatterTypeTreemapImpl({ data, loading = false, className }: MatterTypeTreemapProps) {
  const { locale, direction } = useLocale();
  const f = useLexFormat();
  const strings = LABELS[locale === 'ar' ? 'ar' : 'en'];
  const isRtl = direction === 'rtl';

  /* Single-pass layout: filter zero-count nodes, scale their counts to the unit
     square's area, squarify, and resolve per-tile color. Keyed on the slice. */
  const tiles = useMemo<Tile[]>(() => {
    const nodes = data.filter((n) => n.value > 0);
    if (nodes.length === 0) return [];

    let total = 0;
    for (const n of nodes) total += n.value;
    if (total <= 0) return [];

    const totalArea = SIDE * SIDE;
    const areas = nodes.map((n) => (n.value / total) * totalArea);
    const placed = squarify(areas, { x: 0, y: 0, w: SIDE, h: SIDE });

    // `placed` is index-aligned to `nodes` (squarify preserves input order).
    return placed.map((rect) => {
      const node = nodes[rect.idx];
      return {
        key: node.key,
        label: node.label,
        value: node.value,
        share: node.share,
        color: seriesVar(rect.idx),
        x: rect.x,
        y: rect.y,
        w: rect.w,
        h: rect.h,
      };
    });
  }, [data]);

  const isEmpty = tiles.length === 0;

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
      {/* The treemap canvas. Tiles are absolutely positioned as % insets of this
          box. In RTL the inline-start corner is the top-right, so we flip the
          horizontal axis to keep the largest tile on the leading edge. */}
      <div
        className="relative h-full w-full overflow-hidden rounded-xl ring-1 ring-inset ring-border/40"
        style={{ minHeight: CHART_HEIGHT }}
        role="img"
        aria-label={strings.title}
      >
        {tiles.map((tile) => {
          const name = strings.types[tile.key] ?? tile.label;
          const countLabel = f.formatNumber(tile.value);
          const shareLabel = f.formatPercent(tile.share, { maximumFractionDigits: 1 });
          const showName = tile.share >= LABEL_VISIBLE_SHARE;
          const showCount = tile.share >= COUNT_VISIBLE_SHARE;
          // Project normalized coords to % insets; flip X in RTL.
          const leftPct = isRtl ? SIDE - tile.x - tile.w : tile.x;
          return (
            <div
              key={tile.key}
              title={strings.tile(name, countLabel, shareLabel)}
              aria-label={strings.tile(name, countLabel, shareLabel)}
              className={cn(
                'absolute flex flex-col justify-end overflow-hidden p-1.5',
                'ring-1 ring-inset ring-[hsl(var(--card))]/70',
                'motion-safe:animate-fade-in motion-safe:transition-transform',
              )}
              style={{
                insetInlineStart: `${leftPct}%`,
                top: `${tile.y}%`,
                width: `${tile.w}%`,
                height: `${tile.h}%`,
                backgroundColor: tile.color,
              }}
            >
              {showName ? (
                <span className="truncate text-[11px] font-semibold leading-tight text-white drop-shadow-sm">
                  {name}
                </span>
              ) : null}
              {showCount ? (
                <span className="flex items-baseline gap-1 text-white/90">
                  <span className="text-xs font-bold tabular-nums">{countLabel}</span>
                  <span className="text-[10px] tabular-nums">{shareLabel}</span>
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    </AnalyticsChartCard>
  );
}

/** Memoized pure treemap view over its derived slice. */
export const MatterTypeTreemap = memo(MatterTypeTreemapImpl);

export default MatterTypeTreemap;
