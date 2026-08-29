/**
 * Regression suite for the Legal Director dashboard CONTAINER.
 *
 * The container is the only place in the composition that touches hooks,
 * permissions or routes, so these tests pin the four things that can only go
 * wrong here:
 *
 *   1. panel state PRECEDENCE — error is evaluated before loading, so a failed
 *      slice can never present as a skeleton that resolves to nothing;
 *   2. permission masking is fail-soft, NOT an error — an ungated KPI degrades
 *      to the unavailable card and an ungated panel offers no retry;
 *   3. the two adaptations the shared model does not perform (three-tier
 *      escalations with a re-derived caption, five-slice donut) happen here so
 *      the four other role dashboards reading that model do not shift;
 *   4. the time window reaches the one source that accepts a date range.
 *
 * The shared model is mocked at its hook boundary (it owns its own 12-case
 * suite); the container's OWN sources — the windowed workforce report and the
 * six calendar streams — are mocked at the api-module boundary so react-query
 * really runs and loading/error/refetch are observed, not simulated. That is
 * the same seam `use-role-dashboard-data.test.tsx` uses.
 */

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithQuery } from '@/__tests__/utils/render-with-query';

import type {
  KpiDatum,
  KpiKey,
  RoleDashboardModel,
} from '../../_lib/role-dashboards/use-role-dashboard-data';
import type { WorkforceMetricValue, WorkforceReport } from './widgets/workforce-contract';

const testState = vi.hoisted(() => ({
  permissions: new Set<string>(),
  getWorkforceReport: vi.fn(),
  fetchHearingEvents: vi.fn(),
  fetchContractEvents: vi.fn(),
  fetchSignatureEvents: vi.fn(),
  fetchObligationEvents: vi.fn(),
  fetchSettlementMilestoneEvents: vi.fn(),
  fetchServiceSlaEvents: vi.fn(),
  model: null as RoleDashboardModel | null,
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    user: { id: 'user-1', first_name: 'Mohammed', last_name: 'Almoqhem' },
    hasPermission: (permission: string) => testState.permissions.has(permission),
  }),
}));

vi.mock('../../_lib/role-dashboards/use-role-dashboard-data', async (importActual) => {
  const actual =
    await importActual<typeof import('../../_lib/role-dashboards/use-role-dashboard-data')>();
  return { ...actual, useRoleDashboardData: () => testState.model! };
});

vi.mock('./widgets/workforce-contract', () => ({
  getWorkforceReport: testState.getWorkforceReport,
}));

vi.mock('../../calendar/_lib/calendar-events', () => ({
  fetchHearingEvents: testState.fetchHearingEvents,
  fetchContractEvents: testState.fetchContractEvents,
  fetchSignatureEvents: testState.fetchSignatureEvents,
  fetchObligationEvents: testState.fetchObligationEvents,
  fetchSettlementMilestoneEvents: testState.fetchSettlementMilestoneEvents,
  fetchServiceSlaEvents: testState.fetchServiceSlaEvents,
}));

const { LegalDirectorDashboardContainer, workforceWindowRange } = await import(
  './legal-director-dashboard-container'
);
const { LEX_DOMAINS } = await import('../../_lib/lex-domains');
const { resolveLegalDirectorDashboardLabels } = await import(
  '../../_lib/role-dashboards/legal-director-i18n'
);

const EN = resolveLegalDirectorDashboardLabels('en');
const AR = resolveLegalDirectorDashboardLabels('ar');

/* ------------------------------------------------------------------------- *
 * Fixtures
 * ------------------------------------------------------------------------- */

const SETTLED = { isError: false, refetch: vi.fn() };

const ALL_KPI_KEYS: KpiKey[] = [
  'totalRequests',
  'pendingRequests',
  'slaCompliance',
  'activeLitigations',
  'contractsUnderReview',
  'activeContracts',
  'openMatters',
  'overdueObligations',
  'pendingApprovals',
  'slaBreaches',
  'openAlerts',
  'complianceScore',
  'consultations',
  'investigations',
  'settlements',
  'expiringContracts',
  'highRiskContracts',
  'myOpenItems',
];

function kpi(value: number): KpiDatum {
  return { value, isLoading: false, isAvailable: true, isError: false };
}

function maskedKpi(): KpiDatum {
  return { value: null, isLoading: false, isAvailable: false, isError: false };
}

function count(value: number | null) {
  return { count: value, isLoading: false, isError: false, refetch: vi.fn() };
}

function baseModel(): RoleDashboardModel {
  return {
    kpis: Object.fromEntries(
      ALL_KPI_KEYS.map((key) => [key, kpi(0)]),
    ) as RoleDashboardModel['kpis'],
    kpiCaptions: {},
    recentRequests: { items: [], isLoading: false, ...SETTLED },
    distribution: { slices: [], total: 0, isLoading: false, ...SETTLED },
    workloadByArea: { bars: [], isLoading: false, ...SETTLED },
    contractStatusMix: { bars: [], isLoading: false, ...SETTLED },
    resolutionRates: { bars: [], isLoading: false, ...SETTLED },
    escalations: {
      items: [],
      bySeverity: [],
      total: 0,
      isLoading: false,
      ...SETTLED,
    },
    myWork: { items: [], isLoading: false, ...SETTLED },
    decisions: {
      items: [],
      groups: [],
      kpis: { pending: 0, dueToday: 0, overdue: 0 },
      isLoading: false,
      isPartial: false,
      ...SETTLED,
    },
    teamPerformance: { report: null, isLoading: false, isHidden: true, ...SETTLED },
    domainCounts: Object.fromEntries(
      LEX_DOMAINS.filter((domain) => domain.hasCount).map((domain) => [domain.id, count(0)]),
    ),
  };
}

const AVAILABLE = (value: number): WorkforceMetricValue => ({ value, available: true });
const MISSING: WorkforceMetricValue = {
  value: null,
  available: false,
  reason: 'aggregation_not_implemented',
};

function report(overrides: Partial<WorkforceReport> = {}): WorkforceReport {
  return {
    scope: { mode: 'org', entityIds: [], userIds: [], memberCount: 1 },
    period: {
      from: '2026-07-01',
      to: '2026-07-31',
      timezone: 'Asia/Riyadh',
      calendarSource: 'tenant',
      workingDays: AVAILABLE(22),
    },
    team: [
      {
        userId: 'member-1',
        displayName: 'Layla Al-Hashimi',
        title: { en: 'Senior Legal Counsel', ar: 'مستشارة قانونية أولى' },
        identityStatus: 'resolved',
        userStatus: 'active',
        linkedCount: 0,
        byDomain: [],
        metrics: {
          activeWorkload: AVAILABLE(14),
          loadIndexPct: AVAILABLE(93),
          utilisationPct: MISSING,
          completionRatePct: AVAILABLE(75),
          onTimePct: MISSING,
          medianCycleDays: AVAILABLE(4),
          approvalLatencyHrs: MISSING,
          obligationDischargePct: AVAILABLE(80),
          overdueCount: AVAILABLE(1),
          idleAssignmentPct: MISSING,
        },
      },
    ],
    rollup: {
      distributionGini: MISSING,
      keyPersonConcentrationPct: MISSING,
      backlogBurnPct: MISSING,
      unroutedRequests: MISSING,
      aging: {},
    },
    coverage: {
      domainsRequested: 2,
      domainsReturned: 2,
      itemsTotal: 14,
      itemsAttributed: 14,
      itemsUnattributed: 0,
      attributionPct: 100,
      rowsReturned: 1,
      rowsTruncated: 0,
      exclusions: [],
    },
    degraded: false,
    errors: [],
    ...overrides,
  };
}

function renderContainer(locale: 'en' | 'ar' = 'en') {
  return renderWithQuery(<LegalDirectorDashboardContainer />, { locale });
}

/** The KPI strip's six positions, by their visible (or accessible) label. */
function kpiPositions(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>('[data-legal-director-kpi-strip] > *'),
  );
}

/**
 * Cell text of a panel's accessible data table. Every chart in this composition
 * ships one, so it is the exact, unambiguous record of what was charted —
 * visible labels alone repeat across panels.
 */
function rowsOf(table: HTMLElement): string[][] {
  return within(table)
    .getAllByRole('row')
    .map((row) => Array.from(row.children).map((cell) => cell.textContent ?? ''));
}

beforeEach(() => {
  vi.clearAllMocks();
  testState.permissions = new Set([
    'lex:read',
    'lex:write',
    'lex:workforce:read',
    'lex:request:view',
  ]);
  testState.model = baseModel();
  testState.getWorkforceReport.mockResolvedValue(report());
  testState.fetchHearingEvents.mockResolvedValue([]);
  testState.fetchContractEvents.mockResolvedValue([]);
  testState.fetchSignatureEvents.mockResolvedValue([]);
  testState.fetchObligationEvents.mockResolvedValue([]);
  testState.fetchSettlementMilestoneEvents.mockResolvedValue([]);
  testState.fetchServiceSlaEvents.mockResolvedValue([]);
});

/* ------------------------------------------------------------------------- *
 * KPI strip (G1.3 + G6)
 * ------------------------------------------------------------------------- */

describe('LegalDirectorDashboardContainer — KPI strip', () => {
  it('maps the six approved positions to their model sources, in order', async () => {
    const model = baseModel();
    model.kpis.slaCompliance = kpi(90);
    model.kpis.complianceScore = kpi(99);
    model.kpis.activeLitigations = kpi(33);
    model.kpis.investigations = kpi(8);
    model.kpis.activeContracts = kpi(45);
    model.kpis.consultations = kpi(56);
    testState.model = model;

    const { container } = renderContainer();
    const positions = kpiPositions(container);

    expect(positions).toHaveLength(6);
    expect(positions.map((card) => card.querySelector('p')?.textContent)).toEqual([
      EN.kpis.sla,
      EN.kpis.complianceScore,
      EN.kpis.activeCases,
      EN.kpis.activeInvestigations,
      EN.kpis.activeContracts,
      EN.kpis.activeConsultations,
    ]);
    // Positions 1-2 are percentages; 3-6 are counts. Active Consultations is a
    // COUNT (56), not the mockup's unbacked "82%".
    expect(positions.map((card) => card.querySelectorAll('p')[1]?.textContent)).toEqual([
      '90%',
      '99%',
      '33',
      '8',
      '45',
      '56',
    ]);
    expect(positions.map((card) => card.getAttribute('href'))).toEqual([
      '/lex/service-desk/sla-board',
      '/lex/compliance',
      '/lex/cases',
      '/lex/investigations',
      '/lex/contracts',
      '/lex/consultations',
    ]);
  });

  it('degrades a permission-masked KPI to the unavailable card, never a skeleton', async () => {
    const model = baseModel();
    model.kpis.activeContracts = maskedKpi();
    testState.model = model;

    const { container } = renderContainer();
    const masked = kpiPositions(container)[4];

    expect(masked).toHaveAttribute(
      'aria-label',
      EN.accessibility.kpiUnavailable(EN.kpis.activeContracts),
    );
    expect(masked).not.toHaveAttribute('aria-busy');
    // The strip keeps its six positions so the grid does not reflow per persona.
    expect(kpiPositions(container)).toHaveLength(6);
  });

  it('keeps a loading KPI as a skeleton and a failed one as unavailable', async () => {
    const model = baseModel();
    model.kpis.slaCompliance = { value: null, isLoading: true, isAvailable: false, isError: false };
    model.kpis.complianceScore = {
      value: null,
      isLoading: false,
      isAvailable: false,
      isError: true,
    };
    testState.model = model;

    const { container } = renderContainer();
    const positions = kpiPositions(container);

    expect(positions[0]).toHaveAttribute('aria-busy', 'true');
    // A KPI carries no retry affordance, so a failed source shares the terminal
    // unavailable presentation rather than pretending to still be loading.
    expect(positions[1]).toHaveAttribute(
      'aria-label',
      EN.accessibility.kpiUnavailable(EN.kpis.complianceScore),
    );
    expect(positions[1]).not.toHaveAttribute('aria-busy');
  });
});

/* ------------------------------------------------------------------------- *
 * Escalation panel (G1.4)
 * ------------------------------------------------------------------------- */

describe('LegalDirectorDashboardContainer — escalations', () => {
  it('charts exactly three tiers and derives the caption from the tiers it shows', async () => {
    const model = baseModel();
    model.escalations = {
      items: [],
      bySeverity: [
        { severity: 'critical', count: 13 },
        { severity: 'high', count: 31 },
        { severity: 'medium', count: 1 },
        { severity: 'low', count: 7 },
        { severity: 'info', count: 4 },
      ],
      // The model's own total counts ALL needs-attention items, low/info included.
      total: 56,
      isLoading: false,
      ...SETTLED,
    };
    testState.model = model;

    renderContainer();
    const panel = screen.getByRole('heading', { name: EN.panels.escalations })
      .closest('section') as HTMLElement;

    // The panel's own accessible data table is the exact record of what it
    // charted: three tiers, `low` and `info` dropped.
    expect(rowsOf(within(panel).getByRole('table'))).toEqual([
      [EN.accessibility.columns.category, EN.accessibility.columns.count],
      [EN.severity.critical, '13'],
      [EN.severity.high, '31'],
      [EN.severity.medium, '1'],
    ]);
    // 13 + 31 + 1 = 45 — never 56, which would contradict the bars on screen.
    expect(within(panel).getByText(EN.values.warnings('45', false))).toBeVisible();
    expect(within(panel).getByRole('link', { name: /Open Critical: 13/ })).toHaveAttribute(
      'href',
      '/lex/inbox?severity=critical',
    );
  });

  it('renders all three bars including zero tiers so the chart shape is stable', async () => {
    const model = baseModel();
    model.escalations = {
      items: [],
      bySeverity: [{ severity: 'critical', count: 2 }],
      total: 2,
      isLoading: false,
      ...SETTLED,
    };
    testState.model = model;

    renderContainer();
    const panel = screen.getByRole('heading', { name: EN.panels.escalations })
      .closest('section') as HTMLElement;
    const rows = within(panel).getAllByRole('row');

    // Header row + one row per charted tier, zeros included.
    expect(rows).toHaveLength(4);
    expect(within(panel).getByText(EN.values.warnings('2', false))).toBeVisible();
  });

  it('shows the error state — with a working retry — even while the slice still reports loading', async () => {
    const refetch = vi.fn();
    const model = baseModel();
    model.escalations = {
      items: [],
      bySeverity: [],
      total: 0,
      // Both flags set: a loading-first gate would render a skeleton forever.
      isLoading: true,
      isError: true,
      refetch,
    };
    testState.model = model;

    renderContainer();
    const panel = screen.getByRole('heading', { name: EN.panels.escalations })
      .closest('section') as HTMLElement;

    expect(within(panel).getByText(EN.states.escalations.error)).toBeVisible();
    expect(within(panel).queryByText(EN.states.escalations.loading)).not.toBeInTheDocument();
    fireEvent.click(within(panel).getByRole('button', { name: EN.actions.retry }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('reports an empty escalation source without offering a retry', async () => {
    renderContainer();
    const panel = screen.getByRole('heading', { name: EN.panels.escalations })
      .closest('section') as HTMLElement;

    expect(within(panel).getByText(EN.states.escalations.empty)).toBeVisible();
    expect(
      within(panel).queryByRole('button', { name: EN.actions.retry }),
    ).not.toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------------- *
 * Service request donut (G1.5)
 * ------------------------------------------------------------------------- */

describe('LegalDirectorDashboardContainer — service request distribution', () => {
  it('rebuilds five legend rows from domain counts, splitting investigations out of "other"', async () => {
    const model = baseModel();
    model.domainCounts = {
      ...model.domainCounts,
      contracts: count(32),
      consultations: count(56),
      litigation_cases: count(33),
      investigations: count(13),
      settlements: count(12),
      matters: count(8),
    };
    testState.model = model;

    const { container } = renderContainer();
    const legend = Array.from(
      container.querySelectorAll<SVGCircleElement>('[data-segment]'),
    ).map((arc) => [arc.dataset.segment, arc.dataset.segmentValue]);

    expect(legend).toEqual([
      ['contracts', '32'],
      ['consultations', '56'],
      ['litigations', '33'],
      // Investigations is its own category here; the shared model folds it into
      // `others`, which four other role dashboards read.
      ['investigation', '13'],
      // settlements + matters
      ['other', '20'],
    ]);
  });

  it('keeps a zero category visible as 0 rather than dropping the legend row', async () => {
    const model = baseModel();
    model.domainCounts = {
      ...model.domainCounts,
      contracts: count(4),
      consultations: count(0),
      litigation_cases: count(0),
      investigations: count(0),
      settlements: count(0),
      matters: count(0),
    };
    testState.model = model;

    const { container } = renderContainer();

    expect(container.querySelectorAll('[data-segment]')).toHaveLength(5);
    expect(
      container.querySelector('[data-segment="consultations"]')?.getAttribute('data-segment-value'),
    ).toBe('0');
  });

  it('reports empty when no source count resolved at all', async () => {
    const model = baseModel();
    model.domainCounts = Object.fromEntries(
      Object.keys(model.domainCounts).map((id) => [id, count(null)]),
    );
    testState.model = model;

    renderContainer();
    const panel = screen.getByRole('heading', { name: EN.panels.serviceRequests })
      .closest('section') as HTMLElement;

    expect(within(panel).getByText(EN.states.serviceRequests.empty)).toBeVisible();
  });

  it('prefers the error state over the loading state for the donut slice', async () => {
    const refetch = vi.fn();
    const model = baseModel();
    model.distribution = {
      slices: [],
      total: 0,
      isLoading: true,
      isError: true,
      refetch,
    };
    testState.model = model;

    renderContainer();
    const panel = screen.getByRole('heading', { name: EN.panels.serviceRequests })
      .closest('section') as HTMLElement;

    expect(within(panel).getByText(EN.states.serviceRequests.error)).toBeVisible();
    fireEvent.click(within(panel).getByRole('button', { name: EN.actions.retry }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

/* ------------------------------------------------------------------------- *
 * Resolution rate + legal domains (G1.6)
 * ------------------------------------------------------------------------- */

describe('LegalDirectorDashboardContainer — resolution rate and domains', () => {
  it('names resolution-rate categories from the registered catalogue', async () => {
    const model = baseModel();
    model.resolutionRates = {
      bars: [
        { key: 'contracts', value: 52, unit: 'percent' },
        { key: 'litigation', value: 21, unit: 'percent' },
        { key: 'advisory', value: 6, unit: 'percent' },
        { key: 'requests', value: 19, unit: 'percent' },
      ],
      isLoading: false,
      ...SETTLED,
    };
    testState.model = model;

    renderContainer();
    const panel = screen.getByRole('heading', { name: EN.panels.resolutionRate })
      .closest('section') as HTMLElement;

    // `cat.*` is the catalogue the endpoint's own category keys already index;
    // no second set of translations is minted for the same four categories.
    expect(rowsOf(within(panel).getByRole('table'))).toEqual([
      [EN.accessibility.columns.category, EN.accessibility.columns.rate],
      ['Contracts', '52%'],
      ['Litigation', '21%'],
      ['Advisory', '6%'],
      ['Requests', '19%'],
    ]);
  });

  it('renders one tile per permitted domain, with counts only where the domain has one', async () => {
    const { container } = renderContainer();
    const tiles = Array.from(
      container.querySelectorAll<HTMLAnchorElement>('[data-legal-domains-grid] > a'),
    );

    expect(tiles).toHaveLength(LEX_DOMAINS.length);
    expect(tiles[0]).toHaveAttribute('href', '/lex/cases');
    // `drafting`, `reports` and `admin` carry no count query, so they render as
    // label-only tiles rather than a fabricated zero.
    const reportsTile = tiles.find((tile) => tile.getAttribute('href') === '/lex/reports')!;
    expect(reportsTile).toHaveTextContent(EN.domains.reports);
    expect(reportsTile.textContent).not.toMatch(/\d/);
  });

  it('hides the domains a persona may not read, and empties the panel when none remain', async () => {
    testState.permissions = new Set(['lex:workforce:read']);

    renderContainer();
    const panel = screen.getByRole('heading', { name: EN.panels.legalDomains })
      .closest('section') as HTMLElement;

    expect(within(panel).getByText(EN.states.legalDomains.empty)).toBeVisible();
    expect(
      within(panel).queryByRole('button', { name: EN.actions.retry }),
    ).not.toBeInTheDocument();
  });

  it('surfaces a failed domain count as a retryable error on the domains panel', async () => {
    const refetch = vi.fn();
    const model = baseModel();
    model.domainCounts = {
      ...model.domainCounts,
      contracts: { count: null, isLoading: true, isError: true, refetch },
    };
    testState.model = model;

    renderContainer();
    const panel = screen.getByRole('heading', { name: EN.panels.legalDomains })
      .closest('section') as HTMLElement;

    expect(within(panel).getByText(EN.states.legalDomains.error)).toBeVisible();
    fireEvent.click(within(panel).getByRole('button', { name: EN.actions.retry }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

/* ------------------------------------------------------------------------- *
 * Team workload (G2) + time window (G3)
 * ------------------------------------------------------------------------- */

describe('LegalDirectorDashboardContainer — team workload', () => {
  it('renders the live workforce report, scoped to the caller organisation', async () => {
    renderContainer();

    expect(await screen.findByText('Layla Al-Hashimi')).toBeVisible();
    expect(testState.getWorkforceReport).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'org' }),
    );
  });

  it('reports a failed workforce request as retryable rather than empty', async () => {
    testState.getWorkforceReport.mockRejectedValue(new Error('boom'));

    renderContainer();

    expect(await screen.findByText('Unable to load team performance')).toBeVisible();
    testState.getWorkforceReport.mockResolvedValue(report());
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Layla Al-Hashimi')).toBeVisible();
  });

  it('masks the panel — and its window control — when the caller cannot read the workforce', async () => {
    testState.permissions = new Set(['lex:read']);

    renderContainer();

    expect(
      await screen.findByText('No team members are available for this scope'),
    ).toBeVisible();
    expect(testState.getWorkforceReport).not.toHaveBeenCalled();
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
  });

  it('treats a forbidden workforce endpoint as a masked capability, not a failure', async () => {
    // Workforce is an optional SaaS capability: an entitlement or deployment
    // gap must degrade quietly rather than plant a retry the caller cannot use.
    testState.getWorkforceReport.mockRejectedValue({
      status: 403,
      code: 'FORBIDDEN',
      message: 'forbidden',
    });

    renderContainer();

    expect(
      await screen.findByText('No team members are available for this scope'),
    ).toBeVisible();
    expect(
      screen.queryByText('Unable to load team performance'),
    ).not.toBeInTheDocument();
  });

  it('keeps a partially forbidden report visible with its masked domain named', async () => {
    testState.getWorkforceReport.mockResolvedValue(
      report({ degraded: true, errors: [{ domain: 'contracts', kind: 'forbidden' }] }),
    );

    const { container } = renderContainer();

    // Not a stuck skeleton and not a bare "no data": the panel keeps the rows it
    // could compute and says which domain was withheld.
    expect(await screen.findByText('Layla Al-Hashimi')).toBeVisible();
    const panel = container.querySelector('[data-legal-director-team-workload]') as HTMLElement;
    expect(within(panel).getByText('Partial data')).toBeVisible();
    expect(
      within(panel).getByText('Contracts: you do not have permission to view this domain.'),
    ).toBeVisible();
    expect(
      within(panel).queryByText('No team members are available for this scope'),
    ).not.toBeInTheDocument();
  });

  it('marks a report whose measures are all unavailable, instead of showing it as data', async () => {
    const blank = report();
    blank.team[0].metrics.activeWorkload = MISSING;
    testState.getWorkforceReport.mockResolvedValue(blank);

    renderContainer();

    expect(
      await screen.findByText(
        'Some measures are unavailable because their source contract is incomplete.',
      ),
    ).toBeVisible();
  });

  it('re-requests the workforce report with the selected window, and only that source', async () => {
    const { container } = renderContainer();
    await screen.findByText('Layla Al-Hashimi');

    const calendarCallsBefore = testState.fetchHearingEvents.mock.calls.length;
    fireEvent.click(
      within(container.querySelector('[data-time-window-selector]') as HTMLElement).getByRole(
        'radio',
        { name: EN.window.today },
      ),
    );

    await waitFor(() => {
      expect(testState.getWorkforceReport).toHaveBeenCalledTimes(2);
    });
    const { from, to } = testState.getWorkforceReport.mock.calls[1][0];
    expect(from).toBe(to);
    // Five of the six dashboard sources accept no date range; the window must
    // not pretend otherwise by re-fetching them.
    expect(testState.fetchHearingEvents.mock.calls).toHaveLength(calendarCallsBefore);
  });

  it('resolves each window token to an inclusive from/to range ending today', () => {
    const now = new Date('2026-07-31T12:00:00');

    expect(workforceWindowRange('today', now)).toEqual({
      from: '2026-07-31',
      to: '2026-07-31',
    });
    expect(workforceWindowRange('7d', now)).toEqual({ from: '2026-07-24', to: '2026-07-31' });
    expect(workforceWindowRange('30d', now)).toEqual({ from: '2026-07-01', to: '2026-07-31' });
  });
});

/* ------------------------------------------------------------------------- *
 * Calendar band (G5)
 * ------------------------------------------------------------------------- */

describe('LegalDirectorDashboardContainer — schedule', () => {
  it('merges every dated source into one band', async () => {
    testState.fetchHearingEvents.mockResolvedValue([
      {
        id: 'hearing:case-1',
        type: 'hearing',
        title: 'Appeal hearing',
        date: '2026-08-03T09:00:00.000Z',
        severity: 'high',
        href: '/lex/cases/case-1',
      },
    ]);
    testState.fetchObligationEvents.mockResolvedValue([
      {
        id: 'obligation:ob-1',
        type: 'obligation',
        title: 'Insurance certificate renewal',
        date: '2026-08-04T09:00:00.000Z',
        severity: 'medium',
        href: '/lex/obligations/ob-1',
      },
    ]);

    const { container } = renderContainer();

    expect(await screen.findByText('Appeal hearing')).toBeVisible();
    expect(screen.getByText('Insurance certificate renewal')).toBeVisible();
    expect(container.querySelectorAll('[data-agenda-event]')).toHaveLength(2);
  });

  it('degrades a partial calendar outage instead of blanking the band', async () => {
    testState.fetchSignatureEvents.mockRejectedValue(new Error('signatures down'));
    testState.fetchHearingEvents.mockResolvedValue([
      {
        id: 'hearing:case-1',
        type: 'hearing',
        title: 'Appeal hearing',
        date: '2026-08-03T09:00:00.000Z',
        severity: 'high',
        href: '/lex/cases/case-1',
      },
    ]);

    renderContainer();

    expect(await screen.findByText('Appeal hearing')).toBeVisible();
    expect(screen.queryByText(EN.states.calendar.error)).not.toBeInTheDocument();
  });

  it('reports a total calendar outage as retryable', async () => {
    const failure = () => Promise.reject(new Error('calendar down'));
    testState.fetchHearingEvents.mockImplementation(failure);
    testState.fetchContractEvents.mockImplementation(failure);
    testState.fetchSignatureEvents.mockImplementation(failure);
    testState.fetchObligationEvents.mockImplementation(failure);
    testState.fetchSettlementMilestoneEvents.mockImplementation(failure);
    testState.fetchServiceSlaEvents.mockImplementation(failure);

    renderContainer();

    expect(await screen.findByText(EN.states.calendar.error)).toBeVisible();
  });
});

/* ------------------------------------------------------------------------- *
 * Locale
 * ------------------------------------------------------------------------- */

describe('LegalDirectorDashboardContainer — Arabic', () => {
  it('mirrors the composition and renders Arabic-Indic digits', async () => {
    const model = baseModel();
    model.kpis.activeLitigations = kpi(33);
    model.escalations = {
      items: [],
      bySeverity: [{ severity: 'critical', count: 13 }],
      total: 13,
      isLoading: false,
      ...SETTLED,
    };
    testState.model = model;

    const { container } = renderContainer('ar');

    expect(container.querySelector('[data-legal-director-dashboard-view]')).toHaveAttribute(
      'dir',
      'rtl',
    );
    expect(screen.getByRole('heading', { name: AR.panels.escalations })).toBeVisible();
    expect(screen.getByText('٣٣')).toBeVisible();
    expect(screen.getByText(AR.values.warnings('١٣', false))).toBeVisible();
  });
});
