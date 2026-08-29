import type {
  LexAnalyticsMetric,
  LexCountBucket,
  LexLegalAdvisorPerformance,
} from "@/lib/lex/reports";

export interface AnalyticsDistributionItem {
  name: string;
  value: number;
  /** Raw service-type buckets represented by this visible segment. */
  keys: string[];
}

const UNSPECIFIED_DEPARTMENT = "unspecified";

export function departmentDisplayLabel(
  value: string,
  unspecifiedLabel: string,
): string {
  const normalized = value.trim().toLocaleLowerCase();
  return !normalized || normalized === UNSPECIFIED_DEPARTMENT
    ? unspecifiedLabel
    : value;
}

export function buildDepartmentFilterOptions(
  configuredDepartments: string[],
  distribution: LexCountBucket[],
  unspecifiedLabel: string,
): Array<{ value: string; label: string }> {
  const values = new Map<string, string>();
  for (const department of configuredDepartments) {
    const value = department.trim();
    if (value) values.set(value.toLocaleLowerCase(), value);
  }
  if (
    distribution.some(
      (item) =>
        item.count > 0 &&
        item.key.trim().toLocaleLowerCase() === UNSPECIFIED_DEPARTMENT,
    )
  ) {
    values.set(UNSPECIFIED_DEPARTMENT, UNSPECIFIED_DEPARTMENT);
  }
  return Array.from(values.values(), (value) => ({
    value,
    label: departmentDisplayLabel(value, unspecifiedLabel),
  }));
}

/** Some older gateway snapshots omitted the availability boolean while still
 * returning a finite metric value. Treat only an explicit `false` (or an
 * invalid value) as unavailable so valid totals never disappear. */
export function metricIsAvailable(
  metric: Pick<LexAnalyticsMetric, "available" | "value">,
): boolean {
  return metric.available !== false && Number.isFinite(metric.value);
}

export function metricDisplayValue(
  metric: Pick<LexAnalyticsMetric, "available" | "value">,
  format: (value: number) => string,
  unavailableLabel: string,
): string {
  return metricIsAvailable(metric) ? format(metric.value) : unavailableLabel;
}

export function formatAnalyticsMonth(
  periodStart: string,
  locale: string,
  month: "short" | "long",
): string {
  const date = new Date(periodStart);
  if (Number.isNaN(date.getTime())) return periodStart;
  return new Intl.DateTimeFormat(locale, {
    month,
    ...(month === "long" ? { year: "numeric" as const } : {}),
    timeZone: "UTC",
  }).format(date);
}

export function buildServiceDistribution(
  items: LexCountBucket[],
  resolveLabel: (value: string) => string,
  otherLabel: string,
  visibleSegments = 3,
): { items: AnalyticsDistributionItem[]; total: number } {
  const buckets = Array.from(
    items
      .reduce((map, item) => {
        const name = resolveLabel(item.key);
        const bucket = map.get(name) ?? { value: 0, keys: [] };
        bucket.value += item.count;
        bucket.keys.push(item.key);
        map.set(name, bucket);
        return map;
      }, new Map<string, { value: number; keys: string[] }>())
      .entries(),
    ([name, bucket]) => ({ name, ...bucket }),
  ).sort((a, b) => b.value - a.value);

  const visible = buckets.slice(0, visibleSegments);
  const remainder = buckets.slice(visibleSegments).reduce(
    (result, item) => ({
      value: result.value + item.value,
      keys: [...result.keys, ...item.keys],
    }),
    { value: 0, keys: [] as string[] },
  );

  return {
    items: [
      ...visible,
      ...(remainder.value > 0
        ? [{ name: otherLabel, value: remainder.value, keys: remainder.keys }]
        : []),
    ],
    total: buckets.reduce((sum, item) => sum + item.value, 0),
  };
}

export function buildMetricSparkline(
  metric: LexAnalyticsMetric,
  fallback: Array<{ label: string; value: number }> = [],
): Array<{ label: string; value: number }> {
  if (fallback.length > 1) return fallback;
  if (metric.previous_available && metric.previous_value != null) {
    return [
      { label: "previous", value: metric.previous_value },
      { label: "current", value: metric.value },
    ];
  }
  return [];
}

export function advisorWorkloadPercent(
  advisor: LexLegalAdvisorPerformance,
): number {
  if (advisor.total_requests <= 0) return 0;
  return (advisor.active_requests / advisor.total_requests) * 100;
}
