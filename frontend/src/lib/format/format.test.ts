import { describe, expect, it } from 'vitest';
import {
  formatCompact,
  formatNumber,
  formatPercent,
  shapeDigits,
  toArabicIndic,
  toLatinDigits,
} from './numerals';
import { formatDual, formatGregorian, formatHijri, formatRelativeAt, getHijriParts, toDate } from './datetime';
import { formatCurrency } from './currency';
import { buildCsv, csvEscape } from './csv';

describe('numerals', () => {
  it('transliterates digits both ways', () => {
    expect(toArabicIndic('2026-07-03')).toBe('٢٠٢٦-٠٧-٠٣');
    expect(toLatinDigits('٢٠٢٦')).toBe('2026');
    expect(shapeDigits(42, 'ar')).toBe('٤٢');
    expect(shapeDigits('٤٢', 'en')).toBe('42');
  });

  it('formats numbers per locale with an optional numeral override', () => {
    expect(formatNumber(1234.5, 'en')).toBe('1,234.5');
    expect(formatNumber(1234.5, 'ar')).toBe('١٬٢٣٤٫٥');
    expect(formatNumber(1234.5, 'ar', { numerals: 'latin' })).toBe('1,234.5');
    expect(formatNumber('not a number', 'en')).toBe('');
  });

  it('formats percentages and compact numbers', () => {
    expect(formatPercent(0.42, 'en')).toBe('42%');
    expect(formatCompact(12400, 'en')).toBe('12.4K');
  });
});

describe('datetime', () => {
  const date = new Date('2026-09-23T00:00:00Z');

  it('formats Gregorian and Umm al-Qura Hijri dates', () => {
    expect(formatGregorian(date, 'en')).toContain('September');
    expect(formatGregorian(date, 'ar')).toContain('سبتمبر');
    expect(formatHijri(date, 'en')).toContain('1448');
    expect(formatHijri(date, 'ar')).toContain('١٤٤٨');
  });

  it('composes the dual calendar string with the requested primary', () => {
    const dual = formatDual(date, 'en');
    expect(dual).toMatch(/September .*\(.*1448.*\)/);
    const hijriFirst = formatDual(date, 'en', { primary: 'hijri' });
    expect(hijriFirst.indexOf('1448')).toBeLessThan(hijriFirst.indexOf('September'));
  });

  it('extracts numeric hijri parts and guards invalid input', () => {
    const parts = getHijriParts(date);
    expect(parts?.year).toBe(1448);
    expect(toDate('garbage')).toBeNull();
    expect(formatGregorian(null, 'en')).toBe('');
  });

  it('formats deterministic relative time from an injected base', () => {
    const base = new Date('2026-07-03T12:00:00Z');
    expect(formatRelativeAt(new Date('2026-07-06T12:00:00Z'), 'en', base)).toBe('in 3 days');
    expect(formatRelativeAt(new Date('2026-07-03T10:00:00Z'), 'en', base)).toBe('2 hours ago');
  });
});

describe('currency', () => {
  it('defaults to SAR per locale', () => {
    expect(formatCurrency(1250, { locale: 'en' })).toContain('\u20C1');
    expect(formatCurrency(1250, { locale: 'ar' })).toContain('١٬٢٥٠');
    expect(formatCurrency('nope', { locale: 'en' })).toBe('');
  });
});

describe('csv', () => {
  it('escapes per RFC 4180', () => {
    expect(csvEscape('plain')).toBe('plain');
    expect(csvEscape('a,b')).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
  });

  it('builds a localized header row and localizes booleans', () => {
    const rows = [
      { name: 'Alpha', active: true, count: 3, when: new Date('2026-01-02T00:00:00Z') },
      { name: 'Beta, Inc', active: false, count: null, when: null },
    ];
    const columns = [
      { key: 'name', header: { en: 'Name', ar: 'الاسم' } },
      { key: 'active', header: { en: 'Active', ar: 'نشِط' } },
      { key: 'count', header: 'Count' },
      { key: 'when', header: 'When' },
    ];

    const en = buildCsv(rows, columns, { locale: 'en' }).split('\r\n');
    expect(en[0]).toBe('Name,Active,Count,When');
    expect(en[1]).toBe('Alpha,Yes,3,2026-01-02T00:00:00.000Z');
    expect(en[2]).toBe('"Beta, Inc",No,,');

    const ar = buildCsv(rows, columns, { locale: 'ar' }).split('\r\n');
    expect(ar[0]).toBe('الاسم,نشِط,Count,When');
    expect(ar[1]).toContain('نعم');
    // Numbers stay machine-readable ASCII regardless of locale.
    expect(ar[1]).toContain(',3,');
  });

  it('resolves headerKey columns through the i18n registry', () => {
    const csv = buildCsv([], [{ key: 'x', headerKey: 'export.yes' }], { locale: 'en' });
    expect(csv).toBe('Yes');
  });
});
