/** Satisfaction is captured data, but hidden by default for this report surface. */
export function showSatisfactionMetric(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

export const SHOW_SATISFACTION_METRIC = showSatisfactionMetric(
  process.env.NEXT_PUBLIC_LEX_REPORTS_SHOW_SATISFACTION,
);
