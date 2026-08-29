"use client";

import { statisticHint } from "@/lib/lex/statistic-hint";

import { TrendingDown, TrendingUp } from "lucide-react";
import { TrendSparkline } from "@/components/shared/trend-sparkline";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { LexFormatter } from "@/lib/lex/ksa";
import type { LexAnalyticsMetric } from "@/lib/lex/reports";
import { cn } from "@/lib/utils";
import type { DetailedAnalyticsLabels } from "../_lib/detailed-analytics-labels";
import {
  buildMetricSparkline,
  metricDisplayValue,
  metricIsAvailable,
} from "../_lib/detailed-analytics-view-model";

const flatCardClass =
  "rounded-2xl border border-border/80 bg-card shadow-none";

export function AnalyticsMetricCard({
  direction,
  label,
  metric,
  format,
  deltaKind,
  invert = false,
  danger = false,
  labels,
  f,
  sparkline,
  onAction,
}: {
  direction: "ltr" | "rtl";
  label: string;
  metric: LexAnalyticsMetric;
  format: (value: number) => string;
  deltaKind: "percent" | "points" | "hours" | "rating";
  invert?: boolean;
  danger?: boolean;
  labels: DetailedAnalyticsLabels;
  f: LexFormatter;
  sparkline?: Array<{ label: string; value: number }>;
  onAction: () => void;
}) {
  const delta = metricDelta(metric, deltaKind, invert, labels, f);
  const points = buildMetricSparkline(metric, sparkline);
  const stroke =
    delta?.good === false || danger
      ? "hsl(var(--destructive))"
      : "rgb(var(--ds-action-primary))";

  return (
    <Button
      type="button"
      variant="outline"
      onClick={onAction}
      aria-label={labels.drilldown.viewContributors(label)}
      title={statisticHint(label)}
      className={cn(
        flatCardClass,
        "h-auto min-h-32 w-full min-w-0 flex-col items-stretch justify-between gap-4 p-4 text-start font-normal hover:border-primary/30 hover:bg-primary/5",
      )}
      dir={direction}
      data-testid="analytics-metric-card"
    >
      <div className="flex w-full min-w-0 flex-col items-start gap-1.5">
        <p className="min-w-0 whitespace-normal text-xs font-semibold leading-tight text-muted-foreground">
          {label}
        </p>
        {delta ? (
          <Badge
            variant="outline"
            className={cn(
              "h-auto min-h-5 max-w-full shrink-0 gap-0.5 whitespace-normal rounded px-1.5 py-0.5 text-start text-[10px] leading-tight",
              delta.good === null
                ? "border-transparent bg-muted text-muted-foreground"
                : delta.good
                  ? "border-transparent bg-success-50 text-success-700"
                  : "border-transparent bg-error-50 text-error-700",
            )}
          >
            {delta.direction === "up" ? (
              <TrendingUp className="h-2.5 w-2.5" aria-hidden />
            ) : null}
            {delta.direction === "down" ? (
              <TrendingDown className="h-2.5 w-2.5" aria-hidden />
            ) : null}
            {delta.shortText}
          </Badge>
        ) : null}
      </div>
      <div className="flex w-full items-end justify-between gap-3">
        <p
          className={cn(
            "whitespace-nowrap font-bold leading-none tracking-tight",
            metricIsAvailable(metric)
              ? "text-[28px] text-foreground"
              : "text-sm text-muted-foreground",
          )}
        >
          {metricDisplayValue(metric, format, labels.metrics.unavailable)}
        </p>
        <TrendSparkline
          data={points}
          color={stroke}
          height={30}
          className="max-w-[100px] flex-1"
        />
      </div>
    </Button>
  );
}

function metricDelta(
  metric: LexAnalyticsMetric,
  kind: "percent" | "points" | "hours" | "rating",
  invert: boolean,
  labels: DetailedAnalyticsLabels,
  f: LexFormatter,
): {
  text: string;
  shortText: string;
  direction: "up" | "down" | "flat";
  good: boolean | null;
} | null {
  if (metric.previous_value == null || !metricIsAvailable(metric)) return null;
  if (!metric.previous_available) {
    return {
      text: labels.metrics.noPreviousSample,
      shortText: labels.metrics.newSincePrevious,
      direction: "flat",
      good: null,
    };
  }
  let value: number;
  let suffix = "";
  if (kind === "percent") {
    if (metric.previous_value === 0) {
      if (metric.value === 0) {
        return {
          text: `0% ${labels.metrics.versusPrevious}`,
          shortText: "0%",
          direction: "flat",
          good: null,
        };
      }
      return {
        text: labels.metrics.newSincePrevious,
        shortText: labels.metrics.newSincePrevious,
        direction: "up",
        good: !invert,
      };
    }
    value =
      ((metric.value - metric.previous_value) / metric.previous_value) * 100;
    suffix = "%";
  } else {
    value = metric.value - metric.previous_value;
    suffix =
      kind === "points"
        ? ` ${labels.metrics.points}`
        : kind === "hours"
          ? ` ${labels.metrics.hours}`
          : "";
  }
  const rounded = Number(Math.abs(value).toFixed(1));
  const direction = value > 0 ? "up" : value < 0 ? "down" : ("flat" as const);
  const good = direction === "flat" ? null : invert ? value < 0 : value > 0;
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  const compact = `${sign}${f.formatNumber(rounded)}${suffix}`;
  return {
    text: `${compact} ${labels.metrics.versusPrevious}`,
    shortText: compact,
    direction,
    good,
  };
}
