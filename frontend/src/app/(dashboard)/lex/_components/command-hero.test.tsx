import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

import { renderWithQuery } from '@/__tests__/utils/render-with-query';

const testState = vi.hoisted(() => ({
  permissions: new Set<string>(),
  pendingApprovals: 3,
  dataUpdatedAt: Date.now(),
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    user: {
      first_name: 'Noura',
      email: 'noura@example.com',
      tenant_id: 'tenant-1',
    },
    hasPermission: (permission: string) =>
      testState.permissions.has(permission),
  }),
}));

vi.mock('../_lib/use-lex-command-center', () => ({
  useLexCommandKpis: () => ({
    complianceScore: { value: 88, isLoading: false, isAvailable: true },
    activeContracts: { value: 12, isLoading: false, isAvailable: true },
    openMatters: { value: 4, isLoading: false, isAvailable: true },
    overdueObligations: { value: 1, isLoading: false, isAvailable: true },
    pendingApprovals: {
      value: testState.pendingApprovals,
      isLoading: false,
      isAvailable: true,
    },
    slaBreaches: { value: 1, isLoading: false, isAvailable: true },
    openAlerts: { value: 2, isLoading: false, isAvailable: true },
  }),
  useLexOverviewDashboard: () => ({
    data: {
      kpis: { compliance_score: 88, active_contracts: 12 },
    },
    isLoading: false,
    isError: false,
    isFetching: false,
    dataUpdatedAt: testState.dataUpdatedAt,
  }),
}));

import { CommandHero } from './command-hero';

describe('CommandHero daily legal brief', () => {
  beforeEach(() => {
    localStorage.clear();
    testState.permissions = new Set([
      'lex:read',
      'lex:request:view',
      'lex:request:add',
      'lex:request:approve',
      'lex:audit:read',
    ]);
    testState.pendingApprovals = 3;
    testState.dataUpdatedAt = Date.now();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps the hero surface within the teal palette', () => {
    const { container } = renderWithQuery(
      <CommandHero onExport={vi.fn()} />,
    );

    const hero = container.querySelector('section');
    expect(hero).not.toBeNull();
    expect(hero?.className).toContain('bg-brand-primary-600');
    expect(hero?.className).toContain('border-primary/30');

    const directChildClasses = Array.from(hero?.children ?? [])
      .map((element) => element.getAttribute('class') ?? '')
      .join(' ');
    expect(directChildClasses).not.toContain('bg-brand-bright');
    expect(directChildClasses).not.toContain('bg-brand-accent');
  });

  it.each([
    [8, 'Good morning, Noura'],
    [13, 'Good afternoon, Noura'],
    [18, 'Good evening, Noura'],
    [23, 'Welcome back, Noura'],
  ])('welcomes the user for local hour %i', (hour, expectedGreeting) => {
    vi.spyOn(Date.prototype, 'getHours').mockReturnValue(hour);

    renderWithQuery(<CommandHero onExport={vi.fn()} />);

    expect(
      screen.getByRole('heading', { level: 1, name: expectedGreeting }),
    ).toBeInTheDocument();
  });

  it('prioritizes actionable approvals and shows source freshness', () => {
    renderWithQuery(<CommandHero onExport={vi.fn()} />);

    expect(screen.getByText('Your daily legal brief')).toBeInTheDocument();
    expect(
      screen.getByText('2 time-critical items need your attention today.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Active Approval Tasks')).toBeInTheDocument();

    const approvals = screen.getByRole('link', { name: 'Review approvals' });
    expect(approvals).toHaveAttribute('href', '/lex/inbox');
    expect(screen.getByRole('link', { name: 'New request' })).toHaveAttribute(
      'href',
      '/lex/service-desk/new',
    );
    expect(screen.getByText(/^Updated /)).toBeInTheDocument();
  });

  it('does not expose the approvals action to a view-only requester', () => {
    testState.permissions = new Set([
      'lex:read',
      'lex:request:view',
      'lex:request:add',
    ]);

    renderWithQuery(<CommandHero onExport={vi.fn()} />);

    expect(
      screen.queryByRole('link', { name: 'Review approvals' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'New request' }),
    ).toBeInTheDocument();
  });

  it('admits first-tier case reviewers carrying the backend edit tier', () => {
    testState.permissions = new Set(['lex:read', 'lex:case:edit']);

    renderWithQuery(<CommandHero onExport={vi.fn()} />);

    expect(
      screen.getByRole('link', { name: 'Review approvals' }),
    ).toHaveAttribute('href', '/lex/inbox');
  });
});
