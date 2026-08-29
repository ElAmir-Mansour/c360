"use client";
import { memo, useState } from "react";
import {
  PieChart as RechartsPieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { ChartContainer, isEmptyChartData } from "./chart-container";
import { ChartLegend, type ChartLegendProps } from "./chart-legend";
import { seriesColorAt } from "./chart-theme";
import { formatNumber } from "@/lib/format-number";

interface PieDataItem {
  name: string;
  value: number;
  /** Omit to inherit the categorical --chart-1..6 ramp (fixed order). */
  color?: string;
}

interface PieChartProps {
  data: PieDataItem[];
  innerRadius?: number;
  outerRadius?: number;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  empty?: boolean;
  emptyMessage?: string;
  height?: number;
  showLegend?: boolean;
  /** Overrides forwarded to the shared ChartLegend (className, …). */
  legend?: Omit<
    ChartLegendProps,
    "items" | "payload" | "onToggle" | "onSelect" | "orientation"
  >;
  /** Selects a visible slice/legend entry, typically to open a drill-down. */
  onItemSelect?: (name: string) => void;
  centerLabel?: string;
  centerValue?: string;
  title?: string;
  className?: string;
}

function PieChartImpl({
  data, innerRadius = 60, outerRadius = 100,
  loading = false, error, onRetry, empty, emptyMessage, height = 300,
  showLegend = true, legend, onItemSelect, centerLabel, centerValue, title, className,
}: PieChartProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(new Set());

  // Resolve slice colors against the FULL data order so color follows the
  // entity — toggling a slice off never repaints the survivors.
  const resolvedData = data.map((d, i) => ({ ...d, color: seriesColorAt(i, d.color) }));
  const visibleData = resolvedData.filter((d) => !hiddenKeys.has(d.name));
  const total = visibleData.reduce((sum, d) => sum + d.value, 0);
  // All-zero slices render as a clear empty state rather than an invisible ring.
  const isEmpty = empty ?? isEmptyChartData(data, ["value"]);

  const toggleKey = (name: string) => {
    setHiddenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  return (
    <ChartContainer loading={loading} error={error} onRetry={onRetry} empty={isEmpty} emptyMessage={emptyMessage} height={height} title={title} className={className}>
      <div className="flex flex-col sm:flex-row items-center gap-4 h-full">
        <ResponsiveContainer width="100%" height={height} className="shrink-0" style={{ maxWidth: height }}>
          <RechartsPieChart>
            <Pie
              data={visibleData}
              cx="50%"
              cy="50%"
              innerRadius={innerRadius}
              outerRadius={outerRadius}
              paddingAngle={2}
              dataKey="value"
              onMouseEnter={(_, i) => setActiveIndex(i)}
              onMouseLeave={() => setActiveIndex(null)}
            >
              {visibleData.map((entry, idx) => (
                <Cell
                  key={`cell-${idx}`}
                  fill={entry.color}
                  opacity={activeIndex === null || activeIndex === idx ? 1 : 0.6}
                  strokeWidth={0}
                  aria-label={`${entry.name}: ${formatNumber(entry.value)}`}
                  className={onItemSelect ? "cursor-pointer outline-none focus-visible:opacity-70" : undefined}
                  role={onItemSelect ? "button" : undefined}
                  tabIndex={onItemSelect ? 0 : undefined}
                  onClick={() => onItemSelect?.(entry.name)}
                  onKeyDown={
                    onItemSelect
                      ? (event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            onItemSelect(entry.name);
                          }
                        }
                      : undefined
                  }
                />
              ))}
            </Pie>
            {(centerLabel || centerValue) && innerRadius > 0 && (
              <text x="50%" y="50%" textAnchor="middle" dominantBaseline="middle">
                {/* Type-scale + token inks (fill-* utilities re-theme in dark mode). */}
                {centerValue && <tspan x="50%" dy="-0.2em" className="fill-foreground text-h3 font-bold">{centerValue}</tspan>}
                {centerLabel && <tspan x="50%" dy="1.6em" className="fill-muted-foreground text-caption">{centerLabel}</tspan>}
              </text>
            )}
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.[0]) return null;
                const item = payload[0].payload as PieDataItem & { color: string };
                const pct = total > 0 ? ((item.value / total) * 100).toFixed(1) : "0";
                return (
                  <div className="rounded-card border border-border bg-card p-3 text-start text-body-sm shadow-elevation-3">
                    <div className="flex items-center gap-1.5">
                      <div className="h-2.5 w-2.5 shrink-0 rounded-pill" style={{ backgroundColor: item.color }} aria-hidden />
                      <span className="font-medium text-foreground">{item.name}</span>
                    </div>
                    <p className="mt-1 tabular-nums text-muted-foreground">{formatNumber(item.value)} ({pct}%)</p>
                  </div>
                );
              }}
            />
          </RechartsPieChart>
        </ResponsiveContainer>

        {showLegend && (
          <ChartLegend
            orientation="vertical"
            onToggle={onItemSelect ? undefined : toggleKey}
            onSelect={onItemSelect}
            items={resolvedData.map((item) => ({
              key: item.name,
              label: item.name,
              color: item.color,
              hidden: hiddenKeys.has(item.name),
              detail: `${total > 0 ? ((item.value / total) * 100).toFixed(1) : "0"}%`,
            }))}
            {...legend}
          />
        )}
      </div>
    </ChartContainer>
  );
}

export const PieChart = memo(PieChartImpl);
