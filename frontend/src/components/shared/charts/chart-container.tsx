"use client";
import { useMemo } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { EmptyState } from "@/components/common/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/components/providers/locale-provider";
import { registerMessages } from "@/lib/i18n/registry";
import { shapeDigits, useFormat, type AppFormatter } from "@/lib/format/index";
import type { AppLocale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * The 'charts' i18n namespace — status-surface copy shared by every chart
 * impl (loading / error / empty / retry), resolved via `useT('charts')`.
 */
registerMessages("charts", {
  en: {
    loading: "Loading chart…",
    errorTitle: "Couldn't load this chart",
    retry: "Retry",
    empty: "No data available",
  },
  ar: {
    loading: "جارٍ تحميل الرسم البياني…",
    errorTitle: "تعذّر تحميل هذا الرسم البياني",
    retry: "إعادة المحاولة",
    empty: "لا توجد بيانات متاحة",
  },
});

interface ChartContainerProps {
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  empty?: boolean;
  emptyMessage?: string;
  /** Optional secondary line under the empty-state title. */
  emptyDescription?: string;
  /** Title line of the error state (the raw `error` renders as description). */
  errorTitle?: string;
  /**
   * Explicit pixel height for the plot region. The container ALWAYS resolves to
   * a concrete height so recharts' <ResponsiveContainer height="100%"> has a
   * measurable parent. Parents MUST NOT wrap this in a flex/grid track that
   * collapses to 0 (e.g. `flex-1` without `min-h-0`, or an `h-full` ancestor
   * chain that bottoms out at an auto-height body). If you need the chart to
   * fill a flex parent, give that parent a fixed/`min-h-` height instead of
   * relying on this component to grow.
   */
  height?: number;
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
}

/** Shared status-surface shell: centers content over the resolved plot height. */
function ChartStatus({
  children,
  role,
  ariaLive,
}: {
  children: React.ReactNode;
  role: "alert" | "status";
  ariaLive?: "polite" | "assertive";
}) {
  return (
    <div
      role={role}
      aria-live={ariaLive}
      className="flex h-full w-full flex-col items-center justify-center overflow-hidden text-center"
    >
      {children}
    </div>
  );
}

/**
 * ChartSkeleton — the chart-shaped loading state (rising bars + a baseline
 * axis), composed from the canonical `Skeleton` primitive so it speaks the
 * platform-wide shimmer language (token `bg-muted` fill + reduced-motion-safe
 * pulse/shimmer). It is the fill-height, in-plot adaptation of
 * `Skeleton.Chart` (whose card chrome + fixed body height can't stretch to an
 * arbitrary plot region). Purely decorative; the live region lives on the
 * wrapper in ChartContainer.
 */
function ChartSkeleton() {
  // Deterministic heights so SSR/client markup matches (no random hydration drift).
  const bars = [42, 64, 50, 78, 58, 88, 70, 96, 62, 80];
  return (
    <div className="flex h-full w-full flex-col gap-3 p-1" aria-hidden>
      <div className="flex flex-1 items-end justify-between gap-2">
        {bars.map((h, i) => (
          <Skeleton
            key={i}
            className="flex-1 rounded-b-none rounded-t-input"
            style={{ height: `${h}%`, animationDelay: `${i * 80}ms` }}
          />
        ))}
      </div>
      {/* baseline axis line — rides the border token like the live grid */}
      <div className="h-px w-full bg-border" />
      {/* x-axis tick stubs */}
      <div className="flex items-center justify-between gap-2">
        {bars.map((_, i) => (
          <Skeleton
            key={i}
            className="h-2 max-w-8 flex-1 rounded-pill"
            style={{ animationDelay: `${i * 80}ms` }}
          />
        ))}
      </div>
    </div>
  );
}

export function ChartContainer({
  loading = false,
  error,
  onRetry,
  empty = false,
  emptyMessage,
  emptyDescription,
  errorTitle,
  height = 300,
  title,
  subtitle,
  children,
  className,
}: ChartContainerProps) {
  // Locale-resolved defaults; explicit props always win.
  const t = useT("charts");
  const resolvedEmptyMessage = emptyMessage ?? t("empty");
  const resolvedErrorTitle = errorTitle ?? t("errorTitle");
  return (
    <div className={cn("w-full", className)}>
      {(title || subtitle) && (
        <div className="mb-3">
          {title && <h3 className="text-h4 font-semibold text-foreground">{title}</h3>}
          {subtitle && <p className="text-body-sm text-muted-foreground">{subtitle}</p>}
        </div>
      )}
      {/*
        The plot region ALWAYS carries an explicit, non-collapsing height so that
        recharts' ResponsiveContainer (height="100%") can measure a real parent.
        minHeight matches height to defend against an ancestor flex/grid track
        squeezing it to 0.
      */}
      <div style={{ height, minHeight: height }} className="relative w-full">
        {loading ? (
          <ChartStatus role="status" ariaLive="polite">
            <span className="sr-only">{t("loading")}</span>
            <ChartSkeleton />
          </ChartStatus>
        ) : error ? (
          <ChartStatus role="alert" ariaLive="assertive">
            <EmptyState
              size="compact"
              icon={AlertCircle}
              title={resolvedErrorTitle}
              description={error}
              action={
                onRetry
                  ? { label: t("retry"), onClick: onRetry, icon: RefreshCw }
                  : undefined
              }
              className="h-full px-2 py-4"
            />
          </ChartStatus>
        ) : empty ? (
          <ChartStatus role="status" ariaLive="polite">
            <EmptyState
              size="compact"
              illustration="chart"
              title={resolvedEmptyMessage}
              description={emptyDescription}
              className="h-full px-2 py-4"
            />
          </ChartStatus>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

/**
 * Locale-bound formatter set shaped for the shared chart props: every member
 * plugs directly into the impls' `xFormatter` / `yFormatter` /
 * `tooltipFormatter` slots so axis ticks and tooltip values render
 * Arabic-Indic digits, ar-SA grouping, and the Umm al-Qura-aware date layer in
 * Arabic mode.
 */
export interface ChartLocaleFormatters {
  locale: AppLocale;
  /** The full formatting bundle for anything bespoke. */
  format: AppFormatter;
  /** Numeric axis ticks — compact notation ("12.4K" / Arabic-Indic equivalent). */
  tick: (value: number) => string;
  /** Grouped number (tooltip values, totals). */
  number: (value: number) => string;
  /** Percentage from a 0..1 fraction. */
  percent: (value: number) => string;
  /** Compact SAR-first currency (pass a code to override SAR). */
  currency: (value: number, currency?: string) => string;
  /** Short localized date for time axes (defaults to day + short month). */
  date: (
    value: string | number | Date,
    options?: Intl.DateTimeFormatOptions,
  ) => string;
  /** Category/axis label passthrough with locale digit shaping. */
  label: (value: string | number) => string;
}

/**
 * useChartLocaleFormatters — the locale formatters the chart layer accepts.
 *
 *   const cf = useChartLocaleFormatters();
 *   <LineChart yFormatter={cf.tick} tooltipFormatter={(v) => cf.number(v)}
 *              xFormatter={(v) => cf.date(v)} … />
 *
 * Memoized per locale so the reference is stable across renders.
 */
export function useChartLocaleFormatters(): ChartLocaleFormatters {
  const format = useFormat();
  return useMemo<ChartLocaleFormatters>(
    () => ({
      locale: format.locale,
      format,
      tick: (value) => format.formatCompact(value),
      number: (value) => format.formatNumber(value),
      percent: (value) => format.formatPercent(value, { maximumFractionDigits: 1 }),
      currency: (value, currency) =>
        format.formatCurrencyCompact(value, currency ? { currency } : undefined),
      date: (value, options) =>
        format.formatDate(value, options ?? { day: "numeric", month: "short" }),
      label: (value) =>
        typeof value === "number"
          ? format.formatNumber(value)
          : shapeDigits(value, format.locale),
    }),
    [format],
  );
}

/**
 * isEmptyChartData — shared emptiness test for the chart impls.
 *
 * Treats BOTH "no rows" and "all values are zero (or missing)" as empty, so an
 * all-zero series shows the clear empty message instead of a flat, confusing
 * baseline. Pass the row array and the numeric keys to inspect.
 */
export function isEmptyChartData(
  data: ReadonlyArray<Record<string, unknown>> | ReadonlyArray<object>,
  valueKeys: ReadonlyArray<string>,
): boolean {
  if (!data || data.length === 0) return true;
  if (valueKeys.length === 0) return false;
  const hasNonZero = data.some((row) =>
    valueKeys.some((k) => {
      const v = (row as Record<string, unknown>)[k];
      return typeof v === "number" && Number.isFinite(v) && v !== 0;
    }),
  );
  return !hasNonZero;
}
