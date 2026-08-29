import { describe, it, expect } from 'vitest';
import {
  personaHomeForRole,
  personaSectionsForVariant,
  GENERIC_HOME,
  PERSONA_HOME_BY_ROLE,
} from './persona-home';
import { isKnownLexRoute } from '@/lib/lex/persona-landing';

describe('persona-home config', () => {
  it('maps each persona role to its variant', () => {
    expect(personaHomeForRole('legal-requester').variant).toBe('requester');
    expect(personaHomeForRole('legal-officer').variant).toBe('officer');
    expect(personaHomeForRole('legal-director').variant).toBe('director');
    expect(personaHomeForRole('legal-auditor').variant).toBe('auditor');
    expect(personaHomeForRole('legal-system-admin').variant).toBe('admin');
  });

  it('falls back to the generic home for an unknown / null role', () => {
    expect(personaHomeForRole('totally-unknown')).toBe(GENERIC_HOME);
    expect(personaHomeForRole(null)).toBe(GENERIC_HOME);
    expect(personaHomeForRole(undefined)).toBe(GENERIC_HOME);
  });

  it('every quick-link href across every persona points at a known-existing lex route', () => {
    const allHomes = [...Object.values(PERSONA_HOME_BY_ROLE), GENERIC_HOME];
    for (const home of allHomes) {
      for (const link of home.quickLinks) {
        // /lex/service-desk/new is a real page but not in the top-level allow-list
        // used for landing; accept either a known route or a new-form sub-route.
        const known =
          isKnownLexRoute(link.href) || link.href.endsWith('/new');
        expect(known, `${link.id} → ${link.href}`).toBe(true);
      }
    }
  });

  it('requester / officer / advisor home leads with my-work, not the cross-domain KPIs', () => {
    const officer = personaSectionsForVariant('officer');
    expect(officer.myWork).toBe(true);
    expect(officer.crossDomainKpis).toBe(false);
  });

  it('director home renders the full cross-domain command center', () => {
    const director = personaSectionsForVariant('director');
    expect(director.crossDomainKpis).toBe(true);
    expect(director.domainTiles).toBe(true);
    expect(director.needsAttention).toBe(true);
    expect(director.contractAnalytics).toBe(true);
  });

  it('auditor home is read-oriented (KPIs + needs-attention, no my-work / analytics export)', () => {
    const auditor = personaSectionsForVariant('auditor');
    expect(auditor.crossDomainKpis).toBe(true);
    expect(auditor.myWork).toBe(false);
    expect(auditor.contractAnalytics).toBe(false);
  });

  it('generic fallback shows the full command center', () => {
    const generic = personaSectionsForVariant('generic');
    expect(generic.crossDomainKpis).toBe(true);
    expect(generic.domainTiles).toBe(true);
  });
});
