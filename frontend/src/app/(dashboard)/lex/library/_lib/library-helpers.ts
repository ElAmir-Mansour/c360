import type { AppLocale } from '@/lib/i18n';
import type { LexReferenceDocument } from '@/types/suites';
import { findMatchRanges } from './pdf/pdf-arabic';

/**
 * Resolves the locale-primary and secondary titles for a reference document.
 * The corpus is Arabic-first, so Arabic is the primary title in `ar`; in `en`
 * the working English title leads and falls back to the Arabic when absent.
 * The returned `primary` always renders with `dir="auto"` so mixed scripts flow
 * correctly regardless of the surrounding direction.
 */
export function resolveDocTitles(
  doc: Pick<LexReferenceDocument, 'title_ar' | 'title_en'>,
  locale: AppLocale,
): { primary: string; secondary?: string } {
  const ar = doc.title_ar?.trim() ?? '';
  const en = doc.title_en?.trim() ?? '';
  if (locale === 'ar') {
    return { primary: ar || en, secondary: ar && en ? en : undefined };
  }
  return { primary: en || ar, secondary: en && ar ? ar : undefined };
}

/** Same resolution for the search-hit / citation shape (no full document). */
export function resolveHitTitles(
  hit: { title_ar: string; title_en: string },
  locale: AppLocale,
): { primary: string; secondary?: string } {
  return resolveDocTitles(hit, locale);
}

/** One run of snippet text, flagged as a search match or not. */
export interface HighlightSegment {
  text: string;
  match: boolean;
}

/**
 * Split `text` into alternating plain / matched segments for rendering an
 * Arabic-aware highlighted snippet (contents-search results, citations). Uses
 * the same folding as the in-PDF search so "قضاء" highlights regardless of
 * diacritics. Returns a single non-match segment when the query is empty.
 */
export function highlightSegments(
  text: string,
  query: string,
): HighlightSegment[] {
  if (!query.trim()) return [{ text, match: false }];
  const ranges = findMatchRanges(text, query);
  if (ranges.length === 0) return [{ text, match: false }];
  const segments: HighlightSegment[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start > cursor) {
      segments.push({ text: text.slice(cursor, range.start), match: false });
    }
    segments.push({ text: text.slice(range.start, range.end), match: true });
    cursor = range.end;
  }
  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), match: false });
  }
  return segments;
}
