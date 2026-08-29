import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LOCALE,
  getDocumentLocaleAttributes,
  getLocaleDirection,
  normalizeLocale,
  resolveAppLocale,
  resolveLocaleFromAcceptLanguage,
} from './i18n';
import { getMessages, listMessageKeys, MESSAGES, readMessage } from './i18n/messages';

describe('i18n locale helpers', () => {
  it('defaults document attributes to Arabic and RTL', () => {
    expect(DEFAULT_LOCALE).toBe('ar');
    expect(getDocumentLocaleAttributes()).toEqual({ lang: 'ar', dir: 'rtl' });
  });

  it('normalizes supported region variants', () => {
    expect(normalizeLocale('ar-SA')).toBe('ar');
    expect(normalizeLocale('en_US')).toBe('en');
  });

  it('resolves the highest-priority supported Accept-Language locale', () => {
    expect(resolveLocaleFromAcceptLanguage('fr-CA, en-US;q=0.6, ar;q=0.8')).toBe('ar');
    expect(resolveAppLocale(['ar-SA;q=0.7'])).toBe('ar');
  });

  it('falls back after unsupported candidates', () => {
    expect(resolveAppLocale(['fr-CA'], 'en')).toBe('en');
  });

  it('maps locale direction from normalized locale values', () => {
    expect(getLocaleDirection('ar-SA')).toBe('rtl');
    expect(getLocaleDirection('en-US')).toBe('ltr');
  });

  it('keeps Arabic and English shell dictionaries on the same keys', () => {
    expect(listMessageKeys(MESSAGES.ar)).toEqual(listMessageKeys(MESSAGES.en));
  });

  it('reads localized shell copy from the catalog', () => {
    expect(readMessage(getMessages('ar'), 'shell.skipToMain')).toBe(
      'تخطي إلى المحتوى الرئيسي',
    );
    expect(readMessage(getMessages('en'), 'shell.skipToMain')).toBe('Skip to main content');
  });
});
