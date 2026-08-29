/**
 * ClarioDR records — shared formatting helpers
 * ============================================
 *
 * Pure, locale-aware formatters used by the Phase-3 records components
 * (audit trail, post-implementation review, integrations). Kept dependency-free
 * and side-effect-free so they are trivially unit-testable and shared between
 * the table/stacked-card renderers.
 *
 * All formatting is content-agnostic: callers pass the active locale (from
 * `useLocale()`), so the same component renders correctly under `en` (LTR) and
 * `ar` (RTL) without hardcoded copy.
 */

import type { AppLocale } from '@/lib/i18n';

/**
 * Maps an app locale to a BCP-47 tag for `Intl` formatters. The platform only
 * ships `en`/`ar`; `ar` uses the Western-digit `ar-u-nu-latn` variant so RTO/RPO
 * numerics stay legible in dense recovery tables.
 */
const INTL_LOCALE: Record<AppLocale, string> = {
  en: 'en-US',
  ar: 'ar-u-nu-latn',
};

function intlLocale(locale: AppLocale): string {
  return INTL_LOCALE[locale] ?? 'en-US';
}

/** Shorten a 64-char hex hash to a `head…tail` form for dense cells. */
export function shortenHash(hash: string | null | undefined, head = 8, tail = 6): string {
  if (!hash) {
    return '—';
  }
  const trimmed = hash.trim();
  if (trimmed.length <= head + tail + 1) {
    return trimmed;
  }
  return `${trimmed.slice(0, head)}…${trimmed.slice(-tail)}`;
}

/**
 * Format a duration in whole seconds as a compact `1h 02m 03s` style string.
 * Used for RTO/RPO objective-vs-actual comparisons. Zero/negative renders `0s`.
 */
export function formatDuration(totalSeconds: number | null | undefined): string {
  if (totalSeconds == null || Number.isNaN(totalSeconds) || totalSeconds <= 0) {
    return '0s';
  }
  const seconds = Math.round(totalSeconds);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const parts: string[] = [];
  if (h > 0) {
    parts.push(`${h}h`);
  }
  if (m > 0 || h > 0) {
    parts.push(h > 0 ? `${String(m).padStart(2, '0')}m` : `${m}m`);
  }
  parts.push(h > 0 || m > 0 ? `${String(s).padStart(2, '0')}s` : `${s}s`);
  return parts.join(' ');
}

/** Locale-aware absolute timestamp (date + time, short). */
export function formatTimestamp(
  value: string | Date | null | undefined,
  locale: AppLocale,
): string {
  if (!value) {
    return '—';
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return new Intl.DateTimeFormat(intlLocale(locale), {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

/** Locale-aware integer (used for sequence numbers, counts). */
export function formatInteger(value: number | null | undefined, locale: AppLocale): string {
  if (value == null || Number.isNaN(value)) {
    return '—';
  }
  return new Intl.NumberFormat(intlLocale(locale)).format(value);
}

/** Locale-aware percentage from a 0–1 ratio, rounded to whole percent. */
export function formatRatioPercent(
  ratio: number | null | undefined,
  locale: AppLocale,
): string {
  if (ratio == null || Number.isNaN(ratio)) {
    return '—';
  }
  return new Intl.NumberFormat(intlLocale(locale), {
    style: 'percent',
    maximumFractionDigits: 0,
  }).format(ratio);
}
