export type ActivityWindowDays = 1 | 7 | 30;

/** Inclusive UTC-day activity filter anchored to the API snapshot timestamp. */
export function isWithinActivityWindow(
  timestamp: string,
  asOf: string | null,
  days: ActivityWindowDays,
): boolean {
  const value = new Date(timestamp);
  const end = asOf ? new Date(asOf) : new Date();
  if (Number.isNaN(value.getTime()) || Number.isNaN(end.getTime())) return false;
  const start = new Date(end);
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return value >= start && value <= end;
}
