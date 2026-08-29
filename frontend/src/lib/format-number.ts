/**
 * formatNumber — locale-aware numeric formatter for data-visualization surfaces.
 *
 * This is the single formatter used by the shared chart layer (tooltips + axis
 * tick formatters) so that tick labels, tooltip values, and legend totals all
 * render identically.
 *
 * Two modes:
 *   - default (grouped):   formatNumber(1234)               → "1,234"
 *   - abbreviated:         formatNumber(1234, {abbr:true})   → "1.2K"
 *                          formatNumber(3_400_000, {abbr})   → "3.4M"
 *
 * Locale defaults to "en-US" so SSR and client output match (avoids hydration
 * drift) unless a caller explicitly opts into a locale.
 */

export interface FormatNumberOptions {
  /** Abbreviate large magnitudes (1.2K / 3.4M / 1.5B / 2.1T). Default: false. */
  abbr?: boolean;
  /** BCP-47 locale for grouping/decimal separators. Default: "en-US". */
  locale?: string;
  /**
   * Max fractional digits for the abbreviated form. Default: 1.
   * (The grouped form keeps the value's own precision via Intl.NumberFormat.)
   */
  abbrMaxFractionDigits?: number;
}

const ABBREVIATIONS: ReadonlyArray<{ value: number; suffix: string }> = [
  { value: 1_000_000_000_000, suffix: "T" },
  { value: 1_000_000_000, suffix: "B" },
  { value: 1_000_000, suffix: "M" },
  { value: 1_000, suffix: "K" },
];

/**
 * Format a number for display.
 *
 * @param n        The value to format. Non-finite input (NaN/Infinity) returns "—".
 * @param options  See {@link FormatNumberOptions}.
 */
export function formatNumber(
  n: number,
  options: FormatNumberOptions = {},
): string {
  const { abbr = false, locale = "en-US", abbrMaxFractionDigits = 1 } = options;

  if (!Number.isFinite(n)) return "—";

  if (abbr) {
    const sign = n < 0 ? "-" : "";
    const abs = Math.abs(n);

    const match = ABBREVIATIONS.find((a) => abs >= a.value);
    if (match) {
      const scaled = abs / match.value;
      // Trim trailing ".0" so 1000 → "1K" (not "1.0K") while 1200 → "1.2K".
      const body = new Intl.NumberFormat(locale, {
        maximumFractionDigits: abbrMaxFractionDigits,
        minimumFractionDigits: 0,
      }).format(scaled);
      return `${sign}${body}${match.suffix}`;
    }
    // Below 1,000 — fall through to grouped formatting (still abbr-safe).
  }

  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: 20,
  }).format(n);
}

export default formatNumber;
