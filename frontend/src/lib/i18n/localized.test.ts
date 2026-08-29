import { describe, expect, it } from 'vitest';
import {
  isLocalizedText,
  resolveLocalized,
  normalizeLocalized,
  normalizeOptions,
} from './localized';
import type { LocalizedText } from '@/types/forms';

describe('resolveLocalized', () => {
  it('returns a bare legacy string as-is for either locale', () => {
    expect(resolveLocalized('Approve', 'en')).toBe('Approve');
    expect(resolveLocalized('Approve', 'ar')).toBe('Approve');
  });

  it('returns "" for undefined/null', () => {
    expect(resolveLocalized(undefined, 'en')).toBe('');
    expect(resolveLocalized(null, 'ar')).toBe('');
  });

  it('resolves the requested locale from an object', () => {
    const value: LocalizedText = { ar: 'موافقة', en: 'Approve' };
    expect(resolveLocalized(value, 'ar')).toBe('موافقة');
    expect(resolveLocalized(value, 'en')).toBe('Approve');
  });

  it('falls back en -> ar when requested locale empty (mirrors Go Localize)', () => {
    expect(resolveLocalized({ ar: '', en: 'Only EN' }, 'ar')).toBe('Only EN');
    expect(resolveLocalized({ ar: 'فقط عربي', en: '' }, 'en')).toBe('فقط عربي');
    expect(resolveLocalized({ ar: '', en: '' }, 'en')).toBe('');
  });
});

describe('normalizeLocalized', () => {
  it('assigns a bare string to BOTH locales (mirrors Go UnmarshalJSON bare string)', () => {
    expect(normalizeLocalized('Hi')).toEqual({ ar: 'Hi', en: 'Hi' });
  });

  it('fills out a partial object with empty sides', () => {
    expect(normalizeLocalized({ ar: 'م', en: '' })).toEqual({ ar: 'م', en: '' });
  });

  it('returns empty pair for nullish', () => {
    expect(normalizeLocalized(undefined)).toEqual({ ar: '', en: '' });
    expect(normalizeLocalized(null)).toEqual({ ar: '', en: '' });
  });
});

describe('normalizeOptions', () => {
  it('maps a legacy string option to {value,label:{ar,en}}', () => {
    expect(normalizeOptions(['approve', 'reject'])).toEqual([
      { value: 'approve', label: { ar: 'approve', en: 'approve' } },
      { value: 'reject', label: { ar: 'reject', en: 'reject' } },
    ]);
  });

  it('passes through canonical FormOptions, normalizing labels', () => {
    expect(
      normalizeOptions([{ value: 'red', label: { ar: 'أحمر', en: 'Red' } }]),
    ).toEqual([{ value: 'red', label: { ar: 'أحمر', en: 'Red' } }]);
  });

  it('returns [] for nullish/empty', () => {
    expect(normalizeOptions(undefined)).toEqual([]);
    expect(normalizeOptions([])).toEqual([]);
  });
});

describe('isLocalizedText', () => {
  it('distinguishes objects from bare strings', () => {
    expect(isLocalizedText({ ar: 'x', en: 'y' })).toBe(true);
    expect(isLocalizedText('x')).toBe(false);
    expect(isLocalizedText(undefined)).toBe(false);
  });
});
