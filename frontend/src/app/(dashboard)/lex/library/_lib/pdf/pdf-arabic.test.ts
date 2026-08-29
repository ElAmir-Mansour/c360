import { describe, it, expect } from 'vitest';
import {
  normalizeArabic,
  normalizeWithMap,
  findMatchRanges,
  countMatches,
  textContainsQuery,
} from './pdf-arabic';

describe('normalizeArabic', () => {
  it('strips tashkeel (harakat)', () => {
    // قَضَاء (fatha on ق and ض) → قضاء
    expect(normalizeArabic('قَضَاء')).toBe('قضاء');
  });

  it('folds alef variants to bare alef', () => {
    expect(normalizeArabic('أإآٱ')).toBe('اااا');
  });

  it('folds alef-maksura → ya and ta-marbuta → ha', () => {
    expect(normalizeArabic('المحاماة')).toBe('المحاماه');
    expect(normalizeArabic('مصطفى')).toBe('مصطفي');
  });

  it('maps Arabic-Indic digits to Latin', () => {
    expect(normalizeArabic('العدد ٣٨')).toBe('العدد 38');
    expect(normalizeArabic('۴۲')).toBe('42');
  });

  it('removes tatweel elongation', () => {
    expect(normalizeArabic('كــتـاب')).toBe('كتاب');
  });

  it('lowercases latin', () => {
    expect(normalizeArabic('Qadaa')).toBe('qadaa');
  });
});

describe('normalizeWithMap', () => {
  it('maps every normalized index back to its source index', () => {
    // بَاب  → leading fatha is dropped, shifting the map.
    const src = 'بَاب'; // ب + fatha + ا + ب
    const { normalized, map } = normalizeWithMap(src);
    expect(normalized).toBe('باب');
    expect(map).toEqual([0, 2, 3]);
  });
});

describe('findMatchRanges', () => {
  it('returns ranges in ORIGINAL indices, preserving the source substring', () => {
    const text = 'نظام المحاماة';
    const ranges = findMatchRanges(text, 'محاماة');
    expect(ranges).toHaveLength(1);
    expect(text.slice(ranges[0].start, ranges[0].end)).toBe('محاماة');
  });

  it('matches across dropped diacritics with correct offsets', () => {
    // بَاب قضاء (fatha after first letter) — the match must still land on قضاء.
    const text = 'بَاب قضاء';
    const ranges = findMatchRanges(text, 'قضاء');
    expect(ranges).toHaveLength(1);
    expect(text.slice(ranges[0].start, ranges[0].end)).toBe('قضاء');
  });

  it('matches Arabic-Indic digits against Latin query', () => {
    const text = 'العدد ٣٨';
    const ranges = findMatchRanges(text, '38');
    expect(ranges).toHaveLength(1);
    expect(text.slice(ranges[0].start, ranges[0].end)).toBe('٣٨');
  });

  it('finds multiple non-overlapping occurrences', () => {
    expect(countMatches('باب باب باب', 'باب')).toBe(3);
  });

  it('returns [] for empty / whitespace queries', () => {
    expect(findMatchRanges('نص', '')).toEqual([]);
    expect(findMatchRanges('نص', '   ')).toEqual([]);
  });

  it('is diacritic-insensitive via textContainsQuery', () => {
    expect(textContainsQuery('قَضَاء', 'قضاء')).toBe(true);
    expect(textContainsQuery('نص آخر', 'مفقود')).toBe(false);
  });
});
