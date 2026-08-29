"use client";
import { useId } from "react";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { cn } from "@/lib/utils";

interface TrendSparklineProps {
  data: { label: string; value: number }[];
  /** Stroke/fill color; defaults to contrast-safe Deep Teal. */
  color?: string;
  height?: number;
  showAxis?: boolean;
  className?: string;
}

const BRAND_STROKE = "#005E5E";

/**
 * Compact recharts area sparkline. Axes are hidden by default so it can sit
 * inside KPI cards and table cells; pass `showAxis` for a labelled mini chart.
 */
export function TrendSparkline({
  data,
  color = BRAND_STROKE,
  height = 40,
  showAxis = false,
  className,
}: TrendSparklineProps) {
  const gradientId = useId().replace(/:/g, "");

  if (data.length === 0) {
    return (
      <div
        className={cn("w-full", className)}
        style={{ height }}
        aria-hidden
      />
    );
  }

  return (
    <div className={cn("w-full", className)} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={data}
          margin={
            showAxis
              ? { top: 4, right: 4, left: 0, bottom: 0 }
              : { top: 2, right: 0, left: 0, bottom: 0 }
          }
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.3} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="label"
            hide={!showAxis}
            tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            hide={!showAxis}
            tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
            axisLine={false}
            tickLine={false}
            width={28}
          />
          {showAxis && (
            <Tooltip
              cursor={{ stroke: "hsl(var(--border))" }}
              contentStyle={{
                fontSize: 12,
                borderRadius: 8,
                border: "1px solid hsl(var(--border))",
                background: "hsl(var(--background))",
              }}
            />
          )}
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2}
            fill={`url(#${gradientId})`}
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
