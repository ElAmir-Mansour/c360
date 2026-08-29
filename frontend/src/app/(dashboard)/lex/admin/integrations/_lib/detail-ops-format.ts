/**
 * Pure formatting helpers for the detail-page operations surface (features 2, 3,
 * 6, 7, 9, 10). Module-local, no JSX, RTL-safe — bilingual relative time (EN via
 * date-fns default, AR via the bundled `ar` locale, mirroring
 * `health-presentation.relativeTime`) plus tolerant metadata readers.
 */
import { formatDistanceToNowStrict, parseISO, isValid } from 'date-fns';
import { ar as arLocale } from 'date-fns/locale';
import type { AppLocale } from '@/lib/i18n';

/**
 * Bilingual relative time ("3 minutes ago" / "قبل ٣ دقائق"). Returns "" for
 * nullish / unparseable input so callers can show their own "never" fallback.
 */
export function formatRelative(
  value: string | number | Date | null | undefined,
  locale: AppLocale,
): string {
  if (value === null || value === undefined || value === '') return '';
  try {
    const d =
      typeof value === 'string'
        ? parseISO(value)
        : typeof value === 'number'
          ? new Date(value)
          : value;
    if (!isValid(d)) return '';
    return formatDistanceToNowStrict(d, {
      addSuffix: true,
      locale: locale === 'ar' ? arLocale : undefined,
    });
  } catch {
    return '';
  }
}

/** Read a string value from a metadata bag, tolerating non-string types. */
export function readMetaString(
  meta: Record<string, unknown> | null | undefined,
  key: string,
): string | undefined {
  const v = meta?.[key];
  if (typeof v === 'string' && v.trim() !== '') return v;
  if (typeof v === 'number') return String(v);
  return undefined;
}

/**
 * Whether an ISO/date value lies in the past (expired). Returns false for
 * nullish / unparseable input.
 */
export function isPast(value: string | number | Date | null | undefined): boolean {
  if (value === null || value === undefined || value === '') return false;
  try {
    const d =
      typeof value === 'string'
        ? parseISO(value)
        : typeof value === 'number'
          ? new Date(value)
          : value;
    if (!isValid(d)) return false;
    return d.getTime() < Date.now();
  } catch {
    return false;
  }
}

/** Pretty-print an opaque payload bag as stable, indented JSON for display. */
export function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
