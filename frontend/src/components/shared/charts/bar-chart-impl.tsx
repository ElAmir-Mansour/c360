"use client";
import { memo } from "react";
import {
  BarChart as RechartsBarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { ChartContainer, isEmptyChartData } from "./chart-container";
import { ChartTooltip } from "./chart-tooltip";
import { ChartLegend, type ChartLegendProps } from "./chart-legend";
import {
  AXIS_TICK_STYLE,
  CURSOR_FILL,
  GRID_DASH,
  GRID_STROKE,
  chartMargin,
  seriesColorAt,
  useChartDir,
} from "./chart-theme";
import { formatNumber } from "@/lib/format-number";

interface BarSeriesConfig {
  key: string;
  label: string;
  /** Omit to inherit the categorical --chart-1..6 ramp (fixed order). */
  color?: string;
}

interface BarChartProps {
  data: Array<Record<string, unknown>>;
  xKey: string;
  yKeys: BarSeriesConfig[];
  /** Per-bar colors applied to the first yKey series. Length must match data. */
  cellColors?: string[];
  layout?: "vertical" | "horizontal";
  stacked?: boolean;
  xFormatter?: (value: string | number) => string;
  yFormatter?: (value: number) => string;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  /** Selects the exact source bucket represented by a bar. */
  onItemSelect?: (
    datum: Record<string, unknown>,
    seriesKey: string,
    index: number,
  ) => void;
  empty?: boolean;
  emptyMessage?: string;
  height?: number;
  showGrid?: boolean;
  showLegend?: boolean;
  /** Overrides forwarded to the shared ChartLegend (justify, className, …). */
  legend?: Omit<ChartLegendProps, "items" | "payload" | "onToggle">;
  barRadius?: number;
  title?: string;
  className?: string;
}

function BarChartImpl({
  data, xKey, yKeys, cellColors, layout = "vertical", stacked = false,
  xFormatter, yFormatter, loading = false, error, onRetry, onItemSelect, empty, emptyMessage,
  height = 300, showGrid = true, showLegend = true, legend, barRadius = 4, title, className,
}: BarChartProps) {
  const dir = useChartDir();
  const isRTL = dir === "rtl";
  const horizontal = layout === "horizontal";
  // Treat all-zero (or value-less) series as empty so we surface a clear message
  // instead of a flat, ambiguous baseline.
  const isEmpty = empty ?? isEmptyChartData(data, yKeys.map((s) => s.key));
  // Default numeric-axis ticks to the shared abbreviated formatter (1.2K / 3.4M).
  const numericTickFormatter = (v: number) => formatNumber(v, { abbr: true });
  // Series colors default to the categorical token ramp, in declaration order.
  const series = yKeys.map((s, i) => ({ ...s, color: seriesColorAt(i, s.color) }));
  // Rounded data-ends sit on the value end of the bar: top for columns, the
  // growth end for horizontal bars (mirrored under RTL, where bars anchor at
  // the right edge via the reversed numeric axis).
  const radius: [number, number, number, number] = horizontal
    ? isRTL
      ? [barRadius, 0, 0, barRadius]
      : [0, barRadius, barRadius, 0]
    : [barRadius, barRadius, 0, 0];
  return (
    <ChartContainer loading={loading} error={error} onRetry={onRetry} empty={isEmpty} emptyMessage={emptyMessage} height={height} title={title} className={className}>
      <ResponsiveContainer width="100%" height="100%">
        <RechartsBarChart data={data} layout={horizontal ? "vertical" : "horizontal"} margin={chartMargin(dir)}>
          {showGrid && <CartesianGrid strokeDasharray={GRID_DASH} stroke={GRID_STROKE} />}
          {/*
            RTL mirroring (recharts doesn't flip on its own):
            - the value axis moves to the inline-start edge (visual right);
            - horizontal bars reverse the numeric x-axis so bars anchor beside
              their category labels instead of growing away from them.
          */}
          <XAxis
            dataKey={!horizontal ? xKey : undefined}
            type={horizontal ? "number" : "category"}
            reversed={horizontal && isRTL}
            tickFormatter={xFormatter ?? (horizontal ? numericTickFormatter : undefined)}
            tick={{ ...AXIS_TICK_STYLE }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            dataKey={horizontal ? xKey : undefined}
            type={horizontal ? "category" : "number"}
            orientation={isRTL ? "right" : "left"}
            tickFormatter={yFormatter ?? (horizontal ? undefined : numericTickFormatter)}
            tick={{ ...AXIS_TICK_STYLE }}
            axisLine={false}
            tickLine={false}
            width={horizontal ? 100 : 40}
          />
          <Tooltip content={<ChartTooltip valueFormatter={yFormatter} />} cursor={{ ...CURSOR_FILL }} />
          {showLegend && <Legend content={<ChartLegend {...legend} />} />}
          {series.map((s, seriesIdx) => (
            <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} stackId={stacked ? "stack" : undefined} radius={radius}>
              {(onItemSelect || (seriesIdx === 0 && cellColors && cellColors.length === data.length)) &&
                data.map((datum, i) => (
                  <Cell
                    key={i}
                    fill={seriesIdx === 0 ? cellColors?.[i] : undefined}
                    className={onItemSelect ? "cursor-pointer outline-none focus-visible:opacity-70" : undefined}
                    role={onItemSelect ? "button" : undefined}
                    tabIndex={onItemSelect ? 0 : undefined}
                    aria-label={
                      onItemSelect
                        ? `${String(datum[xKey] ?? "")}: ${String(datum[s.key] ?? "")}`
                        : undefined
                    }
                    onClick={onItemSelect ? () => onItemSelect(datum, s.key, i) : undefined}
                    onKeyDown={
                      onItemSelect
                        ? (event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              onItemSelect(datum, s.key, i);
                            }
                          }
                        : undefined
                    }
                  />
                ))}
            </Bar>
          ))}
        </RechartsBarChart>
      </ResponsiveContainer>
    </ChartContainer>
  );
}

export const BarChart = memo(BarChartImpl);
