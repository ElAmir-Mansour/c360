import { describe, expect, it } from 'vitest';

import { resolveContractsControlLabels } from './labels';

/**
 * Structural fingerprint of a label bundle: every leaf key mapped to its kind
 * ('string' | 'function'). Two locales must produce an IDENTICAL fingerprint so
 * neither locale can silently miss a key or diverge in shape (a function on one
 * side, a string on the other) — the bilingual contract lex depends on.
 */
function fingerprint(value: unknown, path = ''): Record<string, string> {
  if (typeof value === 'function') return { [path]: 'function' };
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .reduce<Record<string, string>>((acc, [key, child]) => {
        Object.assign(acc, fingerprint(child, path ? `${path}.${key}` : key));
        return acc;
      }, {});
  }
  return { [path]: typeof value };
}

describe('contracts-control labels', () => {
  const en = resolveContractsControlLabels('en');
  const ar = resolveContractsControlLabels('ar');

  it('exposes identical key structure across en and ar', () => {
    expect(fingerprint(ar)).toEqual(fingerprint(en));
  });

  it('translates static leaf strings (no english leaking into arabic)', () => {
    expect(ar.page.title).not.toEqual(en.page.title);
    expect(ar.recentContracts.title).not.toEqual(en.recentContracts.title);
    expect(ar.byType.contractsTitle).not.toEqual(en.byType.contractsTitle);
    expect(ar.page.title.trim().length).toBeGreaterThan(0);
    expect(en.page.title.trim().length).toBeGreaterThan(0);
  });

  it('interpolates function labels in both locales', () => {
    expect(en.kpis.shareOfPortfolio('40')).toContain('40');
    expect(ar.kpis.shareOfPortfolio('40')).toContain('40');
    expect(en.byType.ofTotal('12')).toContain('12');
    expect(ar.byType.ofTotal('12')).toContain('12');
  });
});
