/**
 * Arabic-aware text normalization + match finding for the in-PDF search of the
 * reference-library viewer. The corpus is Arabic-first, so a naive
 * case-insensitive substring match fails constantly: the same word appears with
 * and without tashkeel (harakat), with different alef/ya/ta-marbuta forms, with
 * tatweel elongation, and — inside PDF text layers — with Arabic-Indic vs Latin
 * digits. This module folds all of that away so a user searching "قضاء" or
 * "قضاۤء" or "القضاء" matches the rendered glyphs regardless of diacritics.
 *
 * Everything here is PURE (no DOM, no pdfjs) so it is exhaustively unit-tested
 * (`pdf-arabic.test.ts`) and shared by both the highlight pass (which needs
 * index mapping back into the ORIGINAL span text) and the per-page match index.
 */

/** Combining marks (harakat / shadda / sukun / superscript alef / Quranic) + tatweel. */
const ARABIC_DIACRITICS =
  /[ؐ-ًؚ-ٰٟۖ-ۜ۟-۪ۨ-ۭـ]/g;

const ARABIC_INDIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const EASTERN_ARABIC_INDIC_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

/** Fold a single character to its canonical searchable form (may be ''). */
function foldChar(ch: string): string {
  // Strip combining diacritics + tatweel entirely.
  if (ARABIC_DIACRITICS.test(ch)) {
    ARABIC_DIACRITICS.lastIndex = 0;
    return '';
  }
  ARABIC_DIACRITICS.lastIndex = 0;

  switch (ch) {
    // Alef variants → bare alef.
    case 'آ': // آ
    case 'أ': // أ
    case 'إ': // إ
    case 'ٱ': // ٱ
      return 'ا'; // ا
    // Alef maksura → ya (common OCR / typography variance).
    case 'ى':
      return 'ي'; // ي
    // Ta marbuta → ha.
    case 'ة':
      return 'ه'; // ه
    // Standalone hamza forms → drop (matches with or without the seat).
    case 'ؤ': // ؤ
      return 'و'; // و
    case 'ئ': // ئ
      return 'ي'; // ي
    default:
      break;
  }

  // Arabic-Indic → Latin digits so "38" matches "٣٨".
  const ai = ARABIC_INDIC_DIGITS.indexOf(ch);
  if (ai >= 0) return String(ai);
  const eai = EASTERN_ARABIC_INDIC_DIGITS.indexOf(ch);
  if (eai >= 0) return String(eai);

  return ch.toLowerCase();
}

/**
 * Normalize a string AND return a map from every index in the normalized
 * output back to the index of the source character that produced it. The map is
 * what lets the highlight pass wrap the correct ORIGINAL substring even though
 * folding can delete characters (diacritics) or is length-preserving otherwise.
 */
export function normalizeWithMap(input: string): {
  normalized: string;
  /** `map[i]` = index in `input` of the char that produced normalized[i]. */
  map: number[];
} {
  const source = input.normalize('NFKC');
  let normalized = '';
  const map: number[] = [];
  for (let i = 0; i < source.length; i += 1) {
    const folded = foldChar(source[i]);
    for (let j = 0; j < folded.length; j += 1) {
      normalized += folded[j];
      map.push(i);
    }
  }
  return { normalized, map };
}

/** Plain normalization (no index map) for building per-page search indices. */
export function normalizeArabic(input: string): string {
  return normalizeWithMap(input).normalized;
}

export interface MatchRange {
  /** Inclusive start index into the ORIGINAL (un-normalized) source string. */
  start: number;
  /** Exclusive end index into the ORIGINAL source string. */
  end: number;
}

/**
 * Find every (non-overlapping) occurrence of `query` inside `text`, comparing
 * with Arabic folding, and return ranges expressed in ORIGINAL `text` indices.
 * Returns `[]` for an empty/whitespace query or when nothing matches.
 */
export function findMatchRanges(text: string, query: string): MatchRange[] {
  const q = normalizeArabic(query).trim();
  if (!q) return [];
  const { normalized, map } = normalizeWithMap(text);
  if (!normalized) return [];

  const ranges: MatchRange[] = [];
  let from = 0;
  // Search on collapsed-whitespace? No — keep positions exact for mapping.
  while (from <= normalized.length - q.length) {
    const idx = normalized.indexOf(q, from);
    if (idx < 0) break;
    const startOrig = map[idx];
    // End maps to the char AFTER the last matched normalized char.
    const lastNorm = idx + q.length - 1;
    const endOrig = map[lastNorm] + 1;
    ranges.push({ start: startOrig, end: endOrig });
    from = idx + q.length;
  }
  return ranges;
}

/** Whether `text` contains `query` (Arabic-folded). */
export function textContainsQuery(text: string, query: string): boolean {
  const q = normalizeArabic(query).trim();
  if (!q) return false;
  return normalizeArabic(text).includes(q);
}

/** Count folded occurrences of `query` in `text`. */
export function countMatches(text: string, query: string): number {
  return findMatchRanges(text, query).length;
}
