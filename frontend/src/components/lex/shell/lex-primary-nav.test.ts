import { describe, expect, it } from 'vitest';

import {
  LEX_PRIMARY_NAV,
  LEX_PRIMARY_NAV_MORE,
  activePrimaryHref,
  hasRoleSpecificPrimaryNav,
  isMorePathActive,
  primaryNavForRole,
} from './lex-primary-nav';

describe('lex primary nav', () => {
  it('matches the approved flat nav set with unique hrefs', () => {
    expect(LEX_PRIMARY_NAV.map((i) => i.id)).toEqual([
      'dashboard',
      'requests',
      'litigation',
      'investigations',
      'contracts',
      'consultations',
      'reports',
      'report_builder',
      'knowledge',
      'settings',
    ]);
    const hrefs = LEX_PRIMARY_NAV.map((i) => i.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it('carries a non-empty EN + AR label for every item', () => {
    for (const item of LEX_PRIMARY_NAV) {
      expect(item.labelEn.trim().length).toBeGreaterThan(0);
      expect(item.labelAr.trim().length).toBeGreaterThan(0);
      expect(item.labelAr).not.toEqual(item.labelEn);
    }
  });

  it('resolves the active item by longest-prefix, with /lex Dashboard exact-only', () => {
    expect(activePrimaryHref('/lex')).toBe('/lex');
    // A deep domain route lights up its domain item…
    expect(activePrimaryHref('/lex/cases/abc-123')).toBe('/lex/cases');
    expect(activePrimaryHref('/lex/service-desk/new')).toBe('/lex/service-desk');
    // …including the workspace control panel under Contracts (longest-prefix).
    expect(activePrimaryHref('/lex/contracts/control')).toBe('/lex/contracts');
    expect(activePrimaryHref('/lex/reports/analytics')).toBe('/lex/reports/analytics');
    // Dashboard does NOT light up on a non-primary child route.
    expect(activePrimaryHref('/lex/calendar')).toBeUndefined();
  });
});

describe('lex primary nav — Contracts Manager persona', () => {
  it('uses the approved ordered destinations and existing routes', () => {
    const items = primaryNavForRole('legal-contracts-manager');

    expect(items.map((item) => item.labelEn)).toEqual([
      'Dashboard',
      'My Tasks',
      'Requests',
      'Contracts',
      'Consultations',
      'Reports',
      'Knowledge Base',
      'Support',
    ]);
    expect(items.map((item) => item.href)).toEqual([
      '/lex/contracts/control',
      '/lex/tasks',
      '/lex/service-desk',
      '/lex/contracts',
      '/lex/consultations',
      '/lex/reports',
      '/lex/library',
      '/lex/inbox?view=sent',
    ]);
    expect(items.every((item) => item.labelAr.trim().length > 0)).toBe(true);
    expect(items.find((item) => item.id === 'knowledge')).toBe(
      LEX_PRIMARY_NAV.find((item) => item.id === 'knowledge'),
    );
    expect(hasRoleSpecificPrimaryNav('legal-contracts-manager')).toBe(true);
  });

  it('resolves the role dashboard before the broader contracts prefix', () => {
    const items = primaryNavForRole('legal-contracts-manager');

    expect(activePrimaryHref('/lex/contracts/control', items)).toBe(
      '/lex/contracts/control',
    );
    expect(activePrimaryHref('/lex/contracts/control/assignment', items)).toBe(
      '/lex/contracts/control',
    );
    expect(activePrimaryHref('/lex/contracts/contract-1', items)).toBe(
      '/lex/contracts',
    );
    expect(activePrimaryHref('/lex/tasks', items)).toBe('/lex/tasks');
  });

  it('leaves personas without a walkthrough specialization on the shared navigation contract', () => {
    expect(primaryNavForRole('legal-advisor')).toBe(LEX_PRIMARY_NAV);
    expect(primaryNavForRole(null)).toBe(LEX_PRIMARY_NAV);
  });
});

describe('lex primary nav — walkthrough personas', () => {
  it('matches the Business Entity sidebar contract', () => {
    const items = primaryNavForRole('legal-requester');
    expect(items.map((item) => item.labelEn)).toEqual([
      'Dashboard',
      'My Tasks',
      'My Requests',
    ]);
    expect(items.map((item) => item.href)).toEqual([
      '/lex',
      '/lex/tasks',
      '/lex/service-desk',
    ]);
  });

  it('matches the Legal Director sidebar contract', () => {
    const items = primaryNavForRole('legal-director');
    expect(items.map((item) => item.labelEn)).toEqual([
      'Dashboard',
      'My Tasks',
      'Reports',
      'Knowledge Hub',
    ]);
    expect(items.map((item) => item.href)).toEqual([
      '/lex',
      '/lex/tasks',
      '/lex/reports',
      '/lex/knowledge-hub',
    ]);
  });

  it('matches the Cases Manager operational navigation and support inbox', () => {
    const items = primaryNavForRole('legal-cases-manager');
    expect(items.map((item) => item.labelEn)).toEqual([
      'Dashboard',
      'My Tasks',
      'Requests',
      'Cases',
      'Investigations',
      'Reports',
      'Knowledge Base',
      'Support',
    ]);
    expect(items.map((item) => item.href)).toEqual([
      '/lex/cases/control',
      '/lex/tasks',
      '/lex/service-desk',
      '/lex/cases',
      '/lex/investigations',
      '/lex/reports',
      '/lex/library',
      '/lex/inbox?view=sent',
    ]);
  });

  it('treats query-backed Support destinations as active by pathname', () => {
    const cases = primaryNavForRole('legal-cases-manager');
    expect(activePrimaryHref('/lex/inbox', cases)).toBe('/lex/inbox?view=sent');
    expect(activePrimaryHref('/lex/inbox/request-1', cases)).toBe('/lex/inbox?view=sent');
  });

  it('marks all four published demo roles as specialized', () => {
    for (const role of [
      'legal-requester',
      'legal-director',
      'legal-cases-manager',
      'legal-contracts-manager',
    ]) {
      expect(hasRoleSpecificPrimaryNav(role)).toBe(true);
    }
  });
});

describe('lex primary nav — More overflow menu', () => {
  const moreLeaves = LEX_PRIMARY_NAV_MORE.flatMap((s) => s.items);

  it('has labelled sections and bilingual leaves with unique hrefs', () => {
    expect(LEX_PRIMARY_NAV_MORE.length).toBeGreaterThan(0);
    for (const section of LEX_PRIMARY_NAV_MORE) {
      expect(section.labelEn.trim().length).toBeGreaterThan(0);
      expect(section.labelAr.trim().length).toBeGreaterThan(0);
      expect(section.items.length).toBeGreaterThan(0);
      for (const item of section.items) {
        expect(item.labelEn.trim().length).toBeGreaterThan(0);
        expect(item.labelAr.trim().length).toBeGreaterThan(0);
        expect(item.labelAr).not.toEqual(item.labelEn);
        expect(item.href.startsWith('/lex')).toBe(true);
      }
    }
    const hrefs = moreLeaves.map((i) => i.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it('never duplicates a flat primary-bar destination', () => {
    const flat = new Set(LEX_PRIMARY_NAV.map((i) => i.href));
    for (const leaf of moreLeaves) {
      expect(flat.has(leaf.href)).toBe(false);
    }
  });

  it('marks the More trigger active for its own routes but not flat ones', () => {
    expect(isMorePathActive('/lex/calendar')).toBe(true);
    expect(isMorePathActive('/lex/drafting/anything')).toBe(true);
    expect(isMorePathActive('/lex/cases')).toBe(false);
    expect(isMorePathActive('/lex')).toBe(false);
  });
});
