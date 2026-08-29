"use client";
import { memo, useEffect, useState } from "react";
import { ChartContainer } from "./chart-container";
import { formatNumber } from "@/lib/format-number";
import { statusVar } from "@/lib/design-tokens";
import { cn } from "@/lib/utils";

/** Settle delay before animating to the live value (kicks the CSS transition). */
const GAUGE_SETTLE_MS = 50;

interface GaugeChartProps {
  value: number;
  max?: number;
  thresholds?: { good: number; warning: number };
  label?: string;
  loading?: boolean;
  size?: number;
  showValue?: boolean;
  format?: "percentage" | "number";
  className?: string;
}

/**
 * Gauge state color rides the reserved status ramp via the design-tokens JS
 * mirror — a gauge communicates state (good / warning / error), never
 * categorical identity, so it must not borrow the --chart-* series ramp.
 */
function getColor(value: number, max: number, thresholds: { good: number; warning: number }): string {
  const pct = (value / max) * 100;
  if (pct >= thresholds.good) return statusVar("success");
  if (pct >= thresholds.warning) return statusVar("warning");
  return statusVar("error");
}

function GaugeChartImpl({
  value,
  max = 100,
  thresholds = { good: 80, warning: 60 },
  label,
  loading = false,
  size = 200,
  showValue = true,
  format = "percentage",
  className,
}: GaugeChartProps) {
  const [animatedValue, setAnimatedValue] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => setAnimatedValue(value), GAUGE_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [value]);

  const radius = (size - 20) / 2;
  const circumference = Math.PI * radius; // half circle
  const pct = Math.min(Math.max(animatedValue / max, 0), 1);
  const strokeDashoffset = circumference * (1 - pct);
  const color = getColor(value, max, thresholds);
  const displayValue = format === "percentage"
    ? `${Math.round((value / max) * 100)}%`
    : formatNumber(value);

  return (
    <ChartContainer loading={loading} empty={false} height={size} className={cn("flex items-center justify-center", className)}>
      <div className="relative flex flex-col items-center">
        <svg width={size} height={size / 2 + 20} style={{ overflow: "visible" }}>
          {/* Background arc */}
          <path
            d={`M 10 ${size / 2} A ${radius} ${radius} 0 0 1 ${size - 10} ${size / 2}`}
            fill="none"
            stroke="hsl(var(--muted))"
            strokeWidth={12}
            strokeLinecap="round"
          />
          {/* Value arc */}
          <path
            d={`M 10 ${size / 2} A ${radius} ${radius} 0 0 1 ${size - 10} ${size / 2}`}
            fill="none"
            stroke={color}
            strokeWidth={12}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            style={{
              // Token-wired motion: slow duration + decelerate easing, so the
              // sweep matches the rest of the design system (no magic 0.3s).
              transition:
                "stroke-dashoffset var(--ds-duration-slow) var(--ds-ease-decelerate), stroke var(--ds-duration-slow) var(--ds-ease-decelerate)",
            }}
          />
        </svg>
        {showValue && (
          <div className="absolute bottom-0 flex flex-col items-center">
            <span className="text-h3 font-bold tabular-nums" style={{ color }}>{displayValue}</span>
            {label && <span className="mt-1 text-caption text-muted-foreground">{label}</span>}
          </div>
        )}
      </div>
    </ChartContainer>
  );
}

export const GaugeChart = memo(GaugeChartImpl);
