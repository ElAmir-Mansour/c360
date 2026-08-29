"use client";
import { memo } from "react";
import {
  LineChart as RechartsLineChart,
  Line,
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
  CURSOR_STROKE,
  GRID_DASH,
  GRID_STROKE,
  chartMargin,
  seriesColorAt,
  useChartDir,
} from "./chart-theme";
import { formatNumber } from "@/lib/format-number";

/**
 * Series-draw animation duration. recharts needs a numeric ms value (it can't
 * read CSS custom properties), so this mirrors the design-system
 * `--ds-duration-slow` token (320ms) rather than being an arbitrary magic number.
 */
const SERIES_ANIMATION_MS = 320;

interface LineSeriesConfig {
  key: string;
  label: string;
  /** Omit to inherit the categorical --chart-1..6 ramp (fixed order). */
  color?: string;
  dashed?: boolean;
}

interface LineChartProps {
  data: Array<Record<string, unknown>>;
  xKey: string;
  yKeys: LineSeriesConfig[];
  xFormatter?: (value: string | number) => string;
  yFormatter?: (value: number) => string;
  tooltipFormatter?: (value: number, name: string) => string;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  /** Selects the exact source bucket represented by a line-chart point. */
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
  animate?: boolean;
  title?: string;
  className?: string;
}

function LineChartImpl({
  data,
  xKey,
  yKeys,
  xFormatter,
  yFormatter,
  tooltipFormatter,
  loading = false,
  error,
  onRetry,
  onItemSelect,
  empty,
  emptyMessage,
  height = 300,
  showGrid = true,
  showLegend = true,
  legend,
  animate = true,
  title,
  className,
}: LineChartProps) {
  const dir = useChartDir();
  const isEmpty = empty ?? isEmptyChartData(data, yKeys.map((s) => s.key));
  const numericTickFormatter = (v: number) => formatNumber(v, { abbr: true });
  // Series colors default to the categorical token ramp, in declaration order.
  const series = yKeys.map((s, i) => ({ ...s, color: seriesColorAt(i, s.color) }));
  return (
    <ChartContainer loading={loading} error={error} onRetry={onRetry} empty={isEmpty} emptyMessage={emptyMessage} height={height} title={title} className={className}>
      <ResponsiveContainer width="100%" height="100%">
        <RechartsLineChart data={data} margin={chartMargin(dir)}>
          {showGrid && <CartesianGrid strokeDasharray={GRID_DASH} stroke={GRID_STROKE} />}
          <XAxis dataKey={xKey} tickFormatter={xFormatter} tick={{ ...AXIS_TICK_STYLE }} axisLine={false} tickLine={false} />
          {/* recharts doesn't flip for RTL — pin the value axis to the inline-start edge. */}
          <YAxis orientation={dir === "rtl" ? "right" : "left"} tickFormatter={yFormatter ?? numericTickFormatter} tick={{ ...AXIS_TICK_STYLE }} axisLine={false} tickLine={false} />
          <Tooltip
            content={<ChartTooltip labelFormatter={xFormatter} valueFormatter={tooltipFormatter} />}
            cursor={{ ...CURSOR_STROKE }}
          />
          {showLegend && <Legend content={<ChartLegend {...legend} />} />}
          {series.map((s) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={s.color}
              strokeWidth={2}
              dot={
                onItemSelect
                  ? (props) => {
                      const point = props as {
                        cx?: number;
                        cy?: number;
                        index?: number;
                        payload?: Record<string, unknown>;
                      };
                      const index = point.index ?? 0;
                      const datum = point.payload ?? data[index] ?? {};
                      return (
                        <circle
                          cx={point.cx}
                          cy={point.cy}
                          r={5}
                          fill={s.color}
                          stroke="hsl(var(--background))"
                          strokeWidth={2}
                          className="cursor-pointer outline-none focus-visible:stroke-ring"
                          role="button"
                          tabIndex={0}
                          aria-label={`${String(datum[xKey] ?? "")}: ${s.label} ${String(datum[s.key] ?? "")}`}
                          onClick={() => onItemSelect(datum, s.key, index)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              onItemSelect(datum, s.key, index);
                            }
                          }}
                        />
                      );
                    }
                  : false
              }
              strokeDasharray={s.dashed ? "5 5" : undefined}
              isAnimationActive={animate}
              animationDuration={SERIES_ANIMATION_MS}
            />
          ))}
        </RechartsLineChart>
      </ResponsiveContainer>
    </ChartContainer>
  );
}

export const LineChart = memo(LineChartImpl);
