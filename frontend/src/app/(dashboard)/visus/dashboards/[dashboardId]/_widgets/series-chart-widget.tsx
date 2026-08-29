'use client';

import { useEffect, useRef, useState } from 'react';
import { AreaChart, BarChart, LineChart, chartVar } from '@/components/shared/charts';
import { Button } from '@/components/ui/button';
import type { WidgetBodyProps } from './widget-body-props';
import type { VisusSeries, VisusSeriesPoint, VisusSeriesWidgetData } from '@/types/suites';
import { useVisusWidgetChromeLabels } from '../../../_lib/visus-i18n';

/** Floor for the measured plot height so a short card never collapses the chart. */
const MIN_CHART_HEIGHT = 160;
/** Height used before the container is measured (and if ResizeObserver is absent). */
const FALLBACK_CHART_HEIGHT = 220;

/**
 * Series chart body — renders line, area, or bar for the three time-series widget
 * types via the shared chart wrappers (token axes/grid/tooltip + built-in
 * loading / empty / RTL states). One component, switched on `widget.type`.
 *
 * Backend payload variants (defended against here):
 *   • line_chart / area_chart → `series[].data` as `{x,y}[]`, merged by x.
 *   • bar_chart               → `categories[]` + `series[].data` as `number[]`
 *                               aligned to categories by index.
 */
export function SeriesChartWidget({
  widget,
  data,
  isLoading,
  isError,
  onRetry,
}: WidgetBodyProps<VisusSeriesWidgetData>) {
  const t = useVisusWidgetChromeLabels();
  const { ref, height } = useFillHeight();

  if (isError) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 py-6 text-center">
        <p className="text-xs text-muted-foreground">{t.couldntLoadChart}</p>
        <Button variant="outline" size="sm" onClick={onRetry}>
          {t.retry}
        </Button>
      </div>
    );
  }

  const series = data?.series ?? [];
  const yKeys = series.map((s, i) => ({ key: s.name, label: s.name, color: chartVar(i) }));
  const showLegend = series.length > 1;

  // The plot wrapper is a `flex-1 min-h-0` item, so its measured height is the
  // space the card body grants — the chart fills the card instead of a fixed box.
  if (widget.type === 'bar_chart') {
    return (
      <div ref={ref} className="min-h-0 flex-1">
        <BarChart
          data={buildBarRows(data)}
          xKey="category"
          yKeys={yKeys}
          height={height}
          showLegend={showLegend}
          loading={isLoading}
          emptyMessage={t.noDataToDisplay}
        />
      </div>
    );
  }

  const Chart = widget.type === 'area_chart' ? AreaChart : LineChart;
  return (
    <div ref={ref} className="min-h-0 flex-1">
      <Chart
        data={buildSeriesRows(series)}
        xKey="x"
        yKeys={yKeys}
        height={height}
        showLegend={showLegend}
        loading={isLoading}
        emptyMessage={t.noDataToDisplay}
      />
    </div>
  );
}

/**
 * useFillHeight — returns a ref for the plot wrapper plus a pixel height for the
 * shared charts (which need a concrete numeric height; see ChartContainer). The
 * wrapper sits in a `flex-1 min-h-0` track, so its measured height is the space
 * the card grants; feeding that back as the chart height makes the chart fill
 * the card. Falls back to a sensible fixed height before first measurement.
 */
function useFillHeight() {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(FALLBACK_CHART_HEIGHT);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const measured = entries[0]?.contentRect.height ?? 0;
      if (measured > 0) setHeight(Math.max(MIN_CHART_HEIGHT, Math.round(measured)));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return { ref, height };
}

/** Narrow a data element to the `{x,y}` point shape (vs. a bare number). */
function isSeriesPoint(point: unknown): point is VisusSeriesPoint {
  return typeof point === 'object' && point !== null && 'x' in point;
}

/** Extract a numeric y-value from either point variant, defaulting to 0. */
function pointValue(point: VisusSeriesPoint | number | undefined): number {
  if (typeof point === 'number') return Number.isFinite(point) ? point : 0;
  if (isSeriesPoint(point)) return typeof point.y === 'number' ? point.y : 0;
  return 0;
}

/**
 * Merge every series into one row array keyed by x, preserving the x order of
 * series[0] and appending any x values that only appear in later series. Each
 * row is `{ x, [seriesName]: y, … }`. Bare-number data falls back to its index
 * as the x key so a malformed payload still plots coherently.
 */
function buildSeriesRows(series: VisusSeries[]): Array<Record<string, unknown>> {
  const order: string[] = [];
  const rowByX = new Map<string, Record<string, unknown>>();

  for (const s of series) {
    s.data.forEach((point, idx) => {
      const x = isSeriesPoint(point) ? point.x : String(idx);
      let row = rowByX.get(x);
      if (!row) {
        row = { x };
        rowByX.set(x, row);
        order.push(x);
      }
      row[s.name] = pointValue(point);
    });
  }

  return order.map((x) => rowByX.get(x)!);
}

/**
 * Build bar rows from `categories` + index-aligned `series[].data`. If the
 * payload omits categories (defensive), derive them from the longest series so
 * the bars still render.
 */
function buildBarRows(data: VisusSeriesWidgetData | undefined): Array<Record<string, unknown>> {
  const series = data?.series ?? [];
  const categories =
    data?.categories && data.categories.length > 0
      ? data.categories
      : Array.from({ length: Math.max(0, ...series.map((s) => s.data.length)) }, (_, i) => i);

  return categories.map((category, idx) => ({
    category: String(category),
    ...Object.fromEntries(series.map((s) => [s.name, pointValue(s.data[idx])])),
  }));
}
