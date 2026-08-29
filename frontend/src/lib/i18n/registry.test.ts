import { describe, expect, it } from 'vitest';
import {
  createNamespacedTranslator,
  formatMessage,
  getNamespaceBundle,
  hasNamespace,
  listNamespaces,
  readNamespaceMessage,
  registerMessages,
  resolveBilingualBundle,
} from './registry';

// Each test uses a unique namespace: the registry is module-global by design.

describe('registerMessages / readNamespaceMessage', () => {
  it('resolves nested string leaves per locale', () => {
    registerMessages('test.basic', {
      en: { actions: { save: 'Save' } },
      ar: { actions: { save: 'حفظ' } },
    });

    expect(readNamespaceMessage('test.basic', 'en', 'actions.save')).toBe('Save');
    expect(readNamespaceMessage('test.basic', 'ar', 'actions.save')).toBe('حفظ');
  });

  it('falls back to the other locale side for missing/empty leaves', () => {
    registerMessages('test.fallback', {
      en: { onlyEnglish: 'English only', empty: 'filled' },
      ar: { onlyEnglish: '', empty: '' },
    });

    expect(readNamespaceMessage('test.fallback', 'ar', 'onlyEnglish')).toBe('English only');
    expect(readNamespaceMessage('test.fallback', 'ar', 'empty')).toBe('filled');
  });

  it('returns undefined for unknown namespaces, keys, and non-string leaves', () => {
    registerMessages('test.leaves', {
      en: { fn: (n: number) => `${n}`, list: ['a', 'b'] },
      ar: { fn: (n: number) => `${n}`, list: ['أ', 'ب'] },
    });

    expect(readNamespaceMessage('test.unknown-ns', 'en', 'x')).toBeUndefined();
    expect(readNamespaceMessage('test.leaves', 'en', 'missing.key')).toBeUndefined();
    expect(readNamespaceMessage('test.leaves', 'en', 'fn')).toBeUndefined();
    expect(readNamespaceMessage('test.leaves', 'en', 'list')).toBeUndefined();
  });

  it('deep-merges re-registrations (idempotent for HMR, additive per file)', () => {
    registerMessages('test.merge', {
      en: { a: 'A', nested: { one: '1' } },
      ar: { a: 'أ', nested: { one: '١' } },
    });
    registerMessages('test.merge', {
      en: { b: 'B', nested: { two: '2' } },
      ar: { b: 'ب', nested: { two: '٢' } },
    });

    expect(readNamespaceMessage('test.merge', 'en', 'a')).toBe('A');
    expect(readNamespaceMessage('test.merge', 'en', 'b')).toBe('B');
    expect(readNamespaceMessage('test.merge', 'en', 'nested.one')).toBe('1');
    expect(readNamespaceMessage('test.merge', 'en', 'nested.two')).toBe('2');
    expect(readNamespaceMessage('test.merge', 'ar', 'nested.two')).toBe('٢');
  });

  it('exposes namespace bookkeeping', () => {
    registerMessages('test.bookkeeping', { en: { x: 'x' }, ar: { x: 'س' } });

    expect(hasNamespace('test.bookkeeping')).toBe(true);
    expect(listNamespaces()).toContain('test.bookkeeping');
    expect(getNamespaceBundle<{ x: string }>('test.bookkeeping')?.ar.x).toBe('س');
    expect(getNamespaceBundle('test.never-registered')).toBeUndefined();
  });
});

describe('formatMessage', () => {
  it('interpolates {param} tokens and leaves unknown tokens verbatim', () => {
    expect(formatMessage('Showing {start}–{end} of {total}', { start: 1, end: 10, total: 42 }))
      .toBe('Showing 1–10 of 42');
    expect(formatMessage('Hello {name}', {})).toBe('Hello {name}');
    expect(formatMessage('No params')).toBe('No params');
  });
});

describe('createNamespacedTranslator', () => {
  it('resolves namespace first, then the global catalog, then the key', () => {
    registerMessages('test.translator', {
      en: { greeting: 'Hello {name}' },
      ar: { greeting: 'مرحباً {name}' },
    });

    const t = createNamespacedTranslator('test.translator', 'en');
    expect(t('greeting', { name: 'Ada' })).toBe('Hello Ada');
    // Global-catalog fallthrough: a real key from the shared catalog.
    expect(t('shell.home')).not.toBe('shell.home');
    // Unknown everywhere -> the key itself.
    expect(t('definitely.not.a.key')).toBe('definitely.not.a.key');
  });

  it('respects the ar locale', () => {
    registerMessages('test.translator-ar', {
      en: { title: 'Title' },
      ar: { title: 'العنوان' },
    });
    const t = createNamespacedTranslator('test.translator-ar', 'ar');
    expect(t('title')).toBe('العنوان');
  });
});

describe('resolveBilingualBundle', () => {
  it('resolves ar and en sides and defaults invalid locales to the app default', () => {
    const bundle = { en: { v: 'en' }, ar: { v: 'ar' } };
    expect(resolveBilingualBundle(bundle, 'en').v).toBe('en');
    expect(resolveBilingualBundle(bundle, 'ar').v).toBe('ar');
    // App default locale is ar.
    expect(resolveBilingualBundle(bundle, undefined).v).toBe('ar');
    expect(resolveBilingualBundle(bundle, 'fr').v).toBe('ar');
  });
});
