import { describe, it, expect } from 'vitest';
import {
  navigation,
  filterSectionsForRoute,
  filterRecoverNavByEntitlement,
  RECOVER_NAV_SECTION_ID,
  RECOVER_SUBSOLUTION_NAV,
  SUITES,
  SUITE_ROUTE_SEGMENTS,
} from './navigation';

const recoverSection = () =>
  navigation.find((s) => s.id === RECOVER_NAV_SECTION_ID);

const itemIds = (sectionId: string, sections = navigation) =>
  (sections.find((s) => s.id === sectionId)?.items ?? []).map((i) => i.id);

describe('Clario Recover navigation registration', () => {
  it('registers recover as a suite route segment and switcher entry gated on dr:read', () => {
    expect(SUITE_ROUTE_SEGMENTS).toContain('recover');
    const suite = SUITES.find((s) => s.segment === 'recover');
    expect(suite).toEqual(
      expect.objectContaining({
        segment: 'recover',
        href: '/recover',
        permission: 'dr:read',
      }),
    );
  });

  it('exposes the product overview plus the three sub-solution entries under /recover', () => {
    const section = recoverSection();
    expect(section).toBeDefined();
    expect(section?.permission).toBe('dr:read');
    expect((section?.items ?? []).map((i) => i.id)).toEqual([
      'recover-overview',
      'recover-it-dr',
      'recover-cloud-dr',
      'recover-cyber-recovery',
      'recover-prove',
      'recover-metastore',
      'recover-ops-console',
    ]);
    // Product + sub-solution routes live under /recover; the nested operations-console
    // entry intentionally points at the DR console (/dr).
    expect(
      (section?.items ?? [])
        .filter((i) => i.id !== 'recover-ops-console')
        .every((i) => i.href === '/recover' || i.href.startsWith('/recover/')),
    ).toBe(true);
    expect((section?.items ?? []).find((i) => i.id === 'recover-ops-console')?.href).toBe('/dr');
    // Sub-solution items point at the canonical slug routes.
    expect((section?.items ?? []).map((i) => i.href)).toEqual(
      expect.arrayContaining([
        '/recover',
        '/recover/it-dr',
        '/recover/cloud-dr',
        '/recover/cyber-recovery',
        '/recover/it-dr/metastore',
      ]),
    );
  });

  it('maps each sub-solution nav item to its stable contract slug', () => {
    expect(RECOVER_SUBSOLUTION_NAV).toEqual({
      'recover-it-dr': 'it-dr',
      'recover-cloud-dr': 'cloud-dr',
      'recover-cyber-recovery': 'cyber-recovery',
    });
  });

  it('nests the DR operations console under Recover (one product family)', () => {
    const ids = filterSectionsForRoute(navigation, '/recover/it-dr').map((s) => s.id);
    expect(ids).toContain(RECOVER_NAV_SECTION_ID);
    expect(ids).toContain('main');
    expect(ids).toContain('administration');
    // The DR operations-console sections are shown UNDER Recover (same family) so the
    // product and its operational surface read as one coherent product.
    expect(ids).toContain('resilience-operations');
    expect(ids).toContain('resilience-lifecycle');
    expect(ids).toContain('resilience-infrastructure');
    // but genuinely different suites stay hidden (Watheeq renders as lex-* group sections).
    expect(ids.filter((id) => id.startsWith('lex-'))).toEqual([]);
    expect(ids).not.toContain('security-operations');
  });

  it('shows Recover + the operations console together on /dr (same family)', () => {
    const ids = filterSectionsForRoute(navigation, '/dr/topology').map((s) => s.id);
    expect(ids).toContain(RECOVER_NAV_SECTION_ID);
    expect(ids).toContain('resilience-infrastructure');
  });

  it('hides the Recover family inside a genuinely different suite (e.g. Watheeq)', () => {
    const ids = filterSectionsForRoute(navigation, '/lex/contracts').map((s) => s.id);
    expect(ids).not.toContain(RECOVER_NAV_SECTION_ID);
    expect(ids).not.toContain('resilience-operations');
  });
});

describe('filterRecoverNavByEntitlement (live entitlement → sidebar visibility)', () => {
  it('keeps the section intact while entitlement is still loading (null)', () => {
    const filtered = filterRecoverNavByEntitlement(navigation, null);
    // Non-sub-solution items (overview, prove, ops-console) are always kept.
    expect(itemIds(RECOVER_NAV_SECTION_ID, filtered)).toEqual([
      'recover-overview',
      'recover-it-dr',
      'recover-cloud-dr',
      'recover-cyber-recovery',
      'recover-prove',
      'recover-metastore',
      'recover-ops-console',
    ]);
  });

  it('shows only entitled sub-solutions, always keeping overview/prove/ops-console', () => {
    const filtered = filterRecoverNavByEntitlement(navigation, ['it-dr']);
    expect(itemIds(RECOVER_NAV_SECTION_ID, filtered)).toEqual([
      'recover-overview',
      'recover-it-dr',
      'recover-prove',
      'recover-metastore',
      'recover-ops-console',
    ]);
  });

  it('hides every sub-solution when none are entitled (overview/prove/ops-console stay)', () => {
    const filtered = filterRecoverNavByEntitlement(navigation, []);
    expect(itemIds(RECOVER_NAV_SECTION_ID, filtered)).toEqual([
      'recover-overview',
      'recover-prove',
      'recover-metastore',
      'recover-ops-console',
    ]);
  });

  it('shows all three sub-solutions when all are entitled', () => {
    const filtered = filterRecoverNavByEntitlement(navigation, [
      'it-dr',
      'cloud-dr',
      'cyber-recovery',
    ]);
    expect(itemIds(RECOVER_NAV_SECTION_ID, filtered)).toEqual([
      'recover-overview',
      'recover-it-dr',
      'recover-cloud-dr',
      'recover-cyber-recovery',
      'recover-prove',
      'recover-metastore',
      'recover-ops-console',
    ]);
  });

  it('does not mutate any other section', () => {
    // The Watheeq suite renders as multiple lex-* group sections; snapshot them
    // all so this stays a real (non-empty) assertion.
    const lexSectionIds = navigation
      .filter((section) => section.id.startsWith('lex-'))
      .map((section) => section.id);
    expect(lexSectionIds.length).toBeGreaterThan(0);
    const before = lexSectionIds.map((id) => itemIds(id));
    const filtered = filterRecoverNavByEntitlement(navigation, []);
    expect(lexSectionIds.map((id) => itemIds(id, filtered))).toEqual(before);
  });
});
