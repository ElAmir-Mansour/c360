import { describe, it, expect } from 'vitest';
import { suggestEmail, levenshtein } from './email-suggest';

describe('levenshtein', () => {
  it('test_levenshtein_identical: equal strings → 0', () => {
    expect(levenshtein('gmail', 'gmail')).toBe(0);
  });

  it('test_levenshtein_empty: distance to empty string equals length', () => {
    expect(levenshtein('', 'abc')).toBe(3);
    expect(levenshtein('abc', '')).toBe(3);
  });

  it('test_levenshtein_transposition: single transposition → 2 edits', () => {
    expect(levenshtein('gmial', 'gmail')).toBe(2);
  });
});

describe('suggestEmail — domain typos', () => {
  it('test_suggestEmail_gmial: gmial.com → gmail.com', () => {
    expect(suggestEmail('user@gmial.com')).toBe('user@gmail.com');
  });

  it('test_suggestEmail_hotmial: hotmial.com → hotmail.com', () => {
    expect(suggestEmail('jane@hotmial.com')).toBe('jane@hotmail.com');
  });

  it('test_suggestEmail_outlok: outlok.com → outlook.com', () => {
    expect(suggestEmail('me@outlok.com')).toBe('me@outlook.com');
  });

  it('test_suggestEmail_yahooo: yahooo.com → yahoo.com', () => {
    expect(suggestEmail('a.b@yahooo.com')).toBe('a.b@yahoo.com');
  });
});

describe('suggestEmail — TLD slips', () => {
  it('test_suggestEmail_dotCon: gmail.con → gmail.com (domain-level match)', () => {
    expect(suggestEmail('user@gmail.con')).toBe('user@gmail.com');
  });

  it('test_suggestEmail_customDomainTld: company.ogr → company.org', () => {
    expect(suggestEmail('hr@company.ogr')).toBe('hr@company.org');
  });
});

describe('suggestEmail — no suggestion', () => {
  it('test_suggestEmail_validKnownDomain: gmail.com → null', () => {
    expect(suggestEmail('user@gmail.com')).toBeNull();
  });

  it('test_suggestEmail_validCustomDomain: unrelated valid domain → null', () => {
    expect(suggestEmail('user@clario360.example')).toBeNull();
  });

  it('test_suggestEmail_noAt: missing @ → null', () => {
    expect(suggestEmail('not-an-email')).toBeNull();
  });

  it('test_suggestEmail_empty: empty / whitespace → null', () => {
    expect(suggestEmail('')).toBeNull();
    expect(suggestEmail('   ')).toBeNull();
  });

  it('test_suggestEmail_noDotDomain: domain without a dot → null', () => {
    expect(suggestEmail('user@localhost')).toBeNull();
  });

  it('test_suggestEmail_normalizesCaseAndTrim: trims + lowercases output', () => {
    expect(suggestEmail('  USER@GMIAL.COM ')).toBe('user@gmail.com');
  });
});
