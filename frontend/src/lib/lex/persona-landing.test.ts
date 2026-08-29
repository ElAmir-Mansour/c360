import { describe, it, expect } from 'vitest';
import {
  isKnownLexRoute,
  resolvePersonaLanding,
  SAFE_LEX_LANDING,
} from './persona-landing';

describe('persona-landing', () => {
  describe('isKnownLexRoute', () => {
    it('accepts a known-existing lex route', () => {
      expect(isKnownLexRoute('/lex/cases')).toBe(true);
      expect(isKnownLexRoute('/lex/cases/control')).toBe(true);
      expect(isKnownLexRoute('/lex')).toBe(true);
      expect(isKnownLexRoute('/lex/analytics/risk')).toBe(true);
      expect(isKnownLexRoute('/lex/tasks')).toBe(true);
    });

    it('rejects a design-only landing route that has no page yet', () => {
      // §6 landings that are NOT built pages — must not be treated as known.
      expect(isKnownLexRoute('/lex/command-center')).toBe(false);
      expect(isKnownLexRoute('/lex/my-work')).toBe(false);
      expect(isKnownLexRoute('/lex/oversight')).toBe(false);
      expect(isKnownLexRoute('/lex/executive')).toBe(false);
      expect(isKnownLexRoute('/lex/approvals/requests')).toBe(false);
    });

    it('rejects non-lex / empty / nullish targets', () => {
      expect(isKnownLexRoute('/dashboard')).toBe(false);
      expect(isKnownLexRoute('')).toBe(false);
      expect(isKnownLexRoute(null)).toBe(false);
      expect(isKnownLexRoute(undefined)).toBe(false);
    });

    it('matches on pathname only (ignores query/hash)', () => {
      expect(isKnownLexRoute('/lex/cases?status=open')).toBe(true);
      expect(isKnownLexRoute('/lex/cases#tab')).toBe(true);
    });
  });

  describe('resolvePersonaLanding', () => {
    it('returns the backend landing when it is a known route', () => {
      expect(resolvePersonaLanding('/lex/cases')).toBe('/lex/cases');
      expect(resolvePersonaLanding('/lex/cases/control')).toBe('/lex/cases/control');
      expect(resolvePersonaLanding('/lex/contracts/control')).toBe('/lex/contracts/control');
    });

    it('honours the canonical cases-manager control-dashboard landing', () => {
      expect(resolvePersonaLanding('/lex/cases/control')).toBe('/lex/cases/control');
    });

    it('falls back to /lex when the backend landing has no page (no 404)', () => {
      expect(resolvePersonaLanding('/lex/command-center')).toBe(SAFE_LEX_LANDING);
      expect(resolvePersonaLanding('/lex/my-work')).toBe('/lex');
      expect(resolvePersonaLanding(null)).toBe('/lex');
    });

    it('honours a permitted redirectTo over the persona landing', () => {
      expect(resolvePersonaLanding('/lex/cases', '/lex/contracts')).toBe('/lex/contracts');
    });

    it('ignores a redirectTo that is not a known lex route', () => {
      // A non-lex redirect is left to the caller's generic handling, not returned.
      expect(resolvePersonaLanding('/lex/cases', '/dashboard')).toBe('/lex/cases');
      expect(resolvePersonaLanding('/lex/command-center', '/somewhere')).toBe('/lex');
    });
  });
});
