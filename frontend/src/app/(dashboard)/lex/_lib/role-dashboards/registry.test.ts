import { describe, expect, it } from 'vitest';
import { ROLE_DASHBOARDS, GENERIC_DASHBOARD, KPI_CATALOG, dashboardConfigForRole } from './registry';
import { ROLE_DASHBOARD_DICTIONARIES } from './i18n';

const LEGAL_ROLES = [
  'legal-requester', 'legal-dept-manager', 'legal-bu-ceo', 'legal-ceo', 'legal-director',
  'legal-cases-manager', 'legal-contracts-manager', 'legal-case-supervisor', 'legal-contracts-supervisor',
  'legal-officer', 'legal-advisor', 'legal-shared-services-manager', 'legal-auditor', 'legal-system-admin',
];

describe('role dashboard registry', () => {
  it('defines a bespoke dashboard for every one of the 14 legal roles', () => {
    for (const slug of LEGAL_ROLES) {
      expect(ROLE_DASHBOARDS[slug], `missing config for ${slug}`).toBeDefined();
    }
    expect(Object.keys(ROLE_DASHBOARDS)).toHaveLength(LEGAL_ROLES.length);
  });

  it('every config references only catalogued KPI keys and has 3-5 KPIs', () => {
    const configs = [...Object.values(ROLE_DASHBOARDS), GENERIC_DASHBOARD];
    for (const cfg of configs) {
      expect(cfg.kpis.length).toBeGreaterThanOrEqual(3);
      expect(cfg.kpis.length).toBeLessThanOrEqual(5);
      for (const key of cfg.kpis) {
        expect(KPI_CATALOG[key], `KPI ${key} not catalogued`).toBeDefined();
      }
      // Every config has a two-column body with at least one panel each.
      expect(cfg.left.length).toBeGreaterThan(0);
      expect(cfg.right.length).toBeGreaterThan(0);
    }
  });

  it('every catalogued KPI has an href and a valid tone kind', () => {
    const tones = new Set(['neutral', 'goodHighPct', 'badWhenPositive', 'criticalWhenPositive']);
    for (const [key, spec] of Object.entries(KPI_CATALOG)) {
      expect(spec.href, `${key} missing href`).toMatch(/^\/lex/);
      expect(tones.has(spec.tone), `${key} bad tone ${spec.tone}`).toBe(true);
      expect(spec.format === 'count' || spec.format === 'percent').toBe(true);
    }
  });

  it('resolves underscore slugs and falls back to generic for unknown roles', () => {
    expect(dashboardConfigForRole('legal_dept_manager')).toBe(ROLE_DASHBOARDS['legal-dept-manager']);
    expect(dashboardConfigForRole('super-admin')).toBe(GENERIC_DASHBOARD);
    expect(dashboardConfigForRole(null)).toBe(GENERIC_DASHBOARD);
  });

  it('keeps Contracts Manager dashboard statistics in contracts and consultations', () => {
    const manager = ROLE_DASHBOARDS['legal-contracts-manager'];

    expect(manager.kpis).toEqual([
      'activeContracts',
      'contractsUnderReview',
      'expiringContracts',
      'highRiskContracts',
      'consultations',
    ]);
    // The Task Management band is server-scoped to the tasks this manager
    // assigned or received, so it carries no cross-domain portfolio data and
    // does not widen the surface this test guards.
    expect(manager.left).toEqual([
      expect.objectContaining({ kind: 'managerTasks' }),
      expect.objectContaining({ kind: 'listPanel', source: 'myWork' }),
    ]);
    expect(manager.right).toEqual([
      expect.objectContaining({ kind: 'barChart', source: 'contractStatusMix' }),
    ]);
    // The actual containment guarantee: no widget may pull case, settlement,
    // obligation, or compliance portfolio totals onto this dashboard.
    const widgets = [...manager.left, ...manager.right, ...(manager.full ?? [])];
    for (const widget of widgets) {
      if (widget.kind !== 'barChart') continue;
      expect(widget.source).not.toBe('workloadByArea');
      expect(widget.source).not.toBe('resolutionRates');
    }
  });

  it('mounts Task Management on every legal-side manager, never on the business tier', () => {
    for (const role of [
      'legal-cases-manager',
      'legal-contracts-manager',
      'legal-shared-services-manager',
      'legal-case-supervisor',
      'legal-contracts-supervisor',
    ]) {
      const config = ROLE_DASHBOARDS[role];
      expect(
        [...config.left, ...config.right, ...(config.full ?? [])].some(
          (widget) => widget.kind === 'managerTasks',
        ),
        `${role} must mount the Task Management band`,
      ).toBe(true);
    }
    // legal-dept-manager is a BUSINESS-tier requesting manager: the legal
    // team's internal task board is not theirs to see.
    for (const role of ['legal-dept-manager', 'legal-requester', 'legal-bu-ceo', 'legal-ceo']) {
      const config = ROLE_DASHBOARDS[role];
      if (!config) continue;
      expect(
        [...config.left, ...config.right, ...(config.full ?? [])].some(
          (widget) => widget.kind === 'managerTasks',
        ),
        `${role} must not mount the Task Management band`,
      ).toBe(false);
    }
  });

  it('mounts an in-place decision queue only on the Cases Manager dashboard', () => {
    const casesManager = ROLE_DASHBOARDS['legal-cases-manager'];

    expect(casesManager.left[0]).toEqual({
      kind: 'decisionQueue',
      titleKey: 'panel.pendingDecisions',
    });
    for (const [role, config] of Object.entries(ROLE_DASHBOARDS)) {
      if (role === 'legal-cases-manager') continue;
      expect(
        [...config.left, ...config.right, ...(config.full ?? [])].some(
          (widget) => widget.kind === 'decisionQueue',
        ),
        `${role} must not mount the Cases Manager decision queue`,
      ).toBe(false);
    }
  });

  it('registers team performance only in the legal-director right column', () => {
    const director = ROLE_DASHBOARDS['legal-director'];

    expect(director.subtitleKey).toBe('subtitle.director');
    expect(director.kpis).toEqual([
      'openMatters',
      'activeContracts',
      'activeLitigations',
      'pendingApprovals',
      'complianceScore',
    ]);
    expect(director.left.map((widget) => widget.kind)).toEqual([
      'alertsFeed',
      'listPanel',
    ]);
    expect(director.right.map((widget) => widget.kind)).toEqual([
      'donut',
      'barChart',
      'teamPerformance',
    ]);
    expect(director.right.at(-1)).toEqual({
      kind: 'teamPerformance',
      titleKey: 'panel.teamPerformance',
    });

    for (const [role, config] of Object.entries(ROLE_DASHBOARDS)) {
      if (role === 'legal-director') continue;
      expect(
        [...config.left, ...config.right, ...(config.full ?? [])].some(
          (widget) => widget.kind === 'teamPerformance',
        ),
        `${role} must not inherit legal-director workforce data`,
      ).toBe(false);
    }
    expect(
      [...GENERIC_DASHBOARD.left, ...GENERIC_DASHBOARD.right].some(
        (widget) => widget.kind === 'teamPerformance',
      ),
    ).toBe(false);
  });

  it('keeps the team-performance registry label in exact English/Arabic parity', () => {
    expect(Object.keys(ROLE_DASHBOARD_DICTIONARIES.en).sort()).toEqual(
      Object.keys(ROLE_DASHBOARD_DICTIONARIES.ar).sort(),
    );
    expect(ROLE_DASHBOARD_DICTIONARIES.en['panel.teamPerformance']).toBe(
      'Team Performance',
    );
    expect(ROLE_DASHBOARD_DICTIONARIES.ar['panel.teamPerformance']).toBe(
      'أداء الفريق',
    );
  });
});
