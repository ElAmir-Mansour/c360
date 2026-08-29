'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { PieChart } from '@/components/shared/charts';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { formatNumber } from '@/lib/format-number';
import type { WidgetBodyProps } from './widget-body-props';
import type { VisusPieWidgetData, VisusHeatmapWidgetData } from '@/types/suites';
import { useVisusWidgetChromeLabels } from '../../../_lib/visus-i18n';

/* ─────────────────────────── shared body states ─────────────────────────── */

/** Compact error surface with a retry affordance the parent renderer wires up. */
function WidgetError({ onRetry }: { onRetry: () => void }) {
  const t = useVisusWidgetChromeLabels();
  return (
    <div
      role="alert"
      className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 py-4 text-center"
    >
      <p className="text-xs text-muted-foreground">{t.couldntLoadWidget}</p>
      <Button type="button" size="sm" variant="outline" onClick={onRetry}>
        {t.retry}
      </Button>
    </div>
  );
}

/** Muted "nothing to show" note, sized to fill the card body. */
function WidgetEmpty({ message }: { message: string }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center py-4 text-center">
      <p className="text-xs text-muted-foreground">{message}</p>
    </div>
  );
}

/**
 * Track a flex-filled container's box so a chart can size responsively. The
 * observed element is a `flex-1 min-h-0` box whose height is fixed by the grid
 * card (not by content), so feeding its measured height back into the chart is
 * stable — no resize feedback loop.
 */
function useContainerSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setSize({ width: Math.round(rect.width), height: Math.round(rect.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, ...size };
}

/* ──────────────────────────────── pie chart ─────────────────────────────── */

export function PieChartWidget({ data, isLoading, isError, onRetry }: WidgetBodyProps<VisusPieWidgetData>) {
  const t = useVisusWidgetChromeLabels();
  const { ref, width, height } = useContainerSize<HTMLDivElement>();

  const slices = data?.slices;
  // Keep the backend-supplied palette colors; the shared PieChart honours them.
  const chartData = useMemo(
    () => (slices ?? []).map((s) => ({ name: s.label, value: s.value, color: s.color })),
    [slices],
  );
  const total = useMemo(
    () => (slices ?? []).reduce((sum, s) => sum + (Number.isFinite(s.value) ? s.value : 0), 0),
    [slices],
  );

  // Error wins over a stale payload so the retry affordance is always reachable.
  if (isError) return <WidgetError onRetry={onRetry} />;

  // Responsive donut geometry: fit the smaller axis; show the side legend only
  // when the card is wide enough (and the slice count stays legible).
  const plotHeight = Math.max(Math.round(height) || 200, 140);
  const showLegend = width >= 300 && chartData.length > 0 && chartData.length <= 8 && plotHeight >= 150;
  const basis = showLegend ? plotHeight : Math.min(width || plotHeight, plotHeight);
  const outerRadius = Math.max(36, Math.min(Math.floor(basis / 2) - 14, 130));
  const innerRadius = Math.round(outerRadius * 0.6);

  return (
    <div ref={ref} className="flex min-h-0 flex-1 flex-col">
      <PieChart
        data={chartData}
        height={plotHeight}
        innerRadius={innerRadius}
        outerRadius={outerRadius}
        showLegend={showLegend}
        centerLabel={t.total}
        centerValue={formatNumber(total, { abbr: true })}
        loading={isLoading}
        // Pass `true` only when we KNOW it is empty; leave `undefined` otherwise
        // so PieChart's own all-zero detection still applies.
        empty={chartData.length === 0 || undefined}
        emptyMessage={t.noDataToDisplay}
      />
    </div>
  );
}

/* ──────────────────────────────── heatmap ───────────────────────────────── */

/** Single-hue intensity fill from the categorical chart ramp; re-themes in dark
 *  mode because var() resolves inside inline styles. */
const HEAT_HUE = '--chart-1';
const heatFill = (alpha: number) => `hsl(var(${HEAT_HUE}) / ${alpha})`;

/** Chart-shaped shimmer while the payload loads. */
function HeatmapSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5 p-1" aria-hidden>
      {Array.from({ length: 4 }).map((_, r) => (
        <div key={r} className="flex gap-1.5">
          {Array.from({ length: 6 }).map((_, c) => (
            <Skeleton key={c} className="h-7 flex-1 rounded-input" />
          ))}
        </div>
      ))}
    </div>
  );
}

// NUL joiner can't collide with a label, so `x␀y` is a safe composite cell key.
const cellKey = (x: string, y: string) => `${x}\u0000${y}`;

export function HeatmapWidget({ data, isLoading, isError, onRetry }: WidgetBodyProps<VisusHeatmapWidgetData>) {
  const t = useVisusWidgetChromeLabels();
  // Keep the raw (possibly-undefined) references so the memo deps stay stable —
  // `data?.cells ?? []` would allocate a fresh array on every render.
  const cells = data?.cells;
  const xLabels = data?.x_labels ?? [];
  const yLabels = data?.y_labels ?? [];

  const { lookup, min, max } = useMemo(() => {
    const map = new Map<string, number>();
    let lo = Infinity;
    let hi = -Infinity;
    for (const c of cells ?? []) {
      map.set(cellKey(c.x, c.y), c.value);
      if (Number.isFinite(c.value)) {
        if (c.value < lo) lo = c.value;
        if (c.value > hi) hi = c.value;
      }
    }
    return { lookup: map, min: lo === Infinity ? 0 : lo, max: hi === -Infinity ? 0 : hi };
  }, [cells]);

  if (isLoading) return <HeatmapSkeleton />;
  if (isError) return <WidgetError onRetry={onRetry} />;
  if (!cells || cells.length === 0 || xLabels.length === 0 || yLabels.length === 0) {
    return <WidgetEmpty message={t.noDataToDisplay} />;
  }

  const span = max - min;
  const normalize = (v: number) => (span > 0 ? (v - min) / span : 1);
  const gridTemplateColumns = `minmax(3rem, auto) repeat(${xLabels.length}, minmax(2.25rem, 1fr))`;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="min-h-0 flex-1 overflow-auto">
        <div role="grid" aria-label={t.heatmapAria} className="grid min-w-max gap-0.5 text-caption" style={{ gridTemplateColumns }}>
          {/* frozen corner */}
          <div role="columnheader" aria-hidden className="sticky start-0 top-0 z-20 bg-card" />
          {/* column headers (x axis) — frozen to the top */}
          {xLabels.map((x) => (
            <div
              key={`col-${x}`}
              role="columnheader"
              title={x}
              className="sticky top-0 z-10 truncate bg-card px-1 pb-1 text-center font-medium text-muted-foreground"
            >
              {x}
            </div>
          ))}

          {/* rows */}
          {yLabels.map((y) => (
            <Fragment key={`row-${y}`}>
              {/* row header (y axis) — frozen to the start edge */}
              <div
                role="rowheader"
                title={y}
                className="sticky start-0 z-10 flex items-center truncate bg-card pe-2 font-medium text-muted-foreground"
              >
                {y}
              </div>
              {xLabels.map((x) => {
                const value = lookup.get(cellKey(x, y));
                const has = value !== undefined && Number.isFinite(value);
                const norm = has ? normalize(value as number) : 0;
                const alpha = has ? 0.14 + norm * 0.86 : 0;
                const strong = has && norm > 0.55;
                return (
                  <div
                    key={`${x}-${y}`}
                    role="gridcell"
                    title={has ? `${y} · ${x}: ${formatNumber(value as number)}` : `${y} · ${x}: —`}
                    aria-label={has ? t.heatCellAria(y, x, formatNumber(value as number)) : t.heatCellNoDataAria(y, x)}
                    style={
                      has
                        ? {
                            backgroundColor: heatFill(alpha),
                            color: strong ? 'hsl(var(--primary-foreground))' : 'hsl(var(--foreground))',
                          }
                        : undefined
                    }
                    className={cn(
                      'flex h-7 items-center justify-center rounded-input px-1 tabular-nums',
                      !has && 'bg-muted/40 text-muted-foreground',
                    )}
                  >
                    {has ? formatNumber(value as number, { abbr: true }) : '·'}
                  </div>
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>

      {/* intensity legend: min → max */}
      <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border pt-2 text-caption text-muted-foreground">
        <span className="tabular-nums">{formatNumber(min, { abbr: true })}</span>
        <div className="flex items-center gap-0.5" aria-hidden>
          {[0.14, 0.32, 0.5, 0.68, 0.86, 1].map((a) => (
            <span key={a} className="h-3 w-4 rounded-sm" style={{ backgroundColor: heatFill(a) }} />
          ))}
        </div>
        <span className="tabular-nums">{formatNumber(max, { abbr: true })}</span>
      </div>
    </div>
  );
}
