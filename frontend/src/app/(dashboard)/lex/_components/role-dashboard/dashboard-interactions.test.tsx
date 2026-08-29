import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';

import type { RoleDashboardModel } from '../../_lib/role-dashboards/use-role-dashboard-data';

import { DistributionDonut } from './distribution-donut';
import { EscalationSeverityChart } from './escalation-severity-chart';
import { MetricBarChart } from './metric-bar-chart';
import { RoleDashboard } from './role-dashboard';

const { useRoleDashboardDataMock } = vi.hoisted(() => ({
  useRoleDashboardDataMock: vi.fn(),
}));

vi.mock('../../_lib/role-dashboards/use-role-dashboard-data', () => ({
  useRoleDashboardData: useRoleDashboardDataMock,
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    user: { first_name: 'Maha', email: 'maha@example.com' },
    hasPermission: () => false,
  }),
}));

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({
    children,
    href,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const hiddenKpi = {
  value: null,
  isLoading: false,
  isAvailable: false,
  isError: false,
};

function genericDashboardModel(): RoleDashboardModel {
  const status = { isError: false, refetch: vi.fn() };
  return {
    kpis: new Proxy(
      {},
      { get: () => hiddenKpi },
    ) as RoleDashboardModel['kpis'],
    kpiCaptions: {},
    recentRequests: { items: [], isLoading: false, ...status },
    distribution: {
      slices: [{ key: 'contracts', value: 2 }],
      total: 2,
      isLoading: false,
      ...status,
    },
    workloadByArea: {
      bars: [{ key: 'renewals', value: 2, unit: 'count' }],
      isLoading: false,
      ...status,
    },
    contractStatusMix: {
      bars: [{ key: 'active', value: 2, unit: 'count' }],
      isLoading: false,
      ...status,
    },
    resolutionRates: {
      bars: [{ key: 'contracts', value: 80, unit: 'percent' }],
      isLoading: false,
      ...status,
    },
    escalations: {
      items: [],
      bySeverity: [{ severity: 'high', count: 2 }],
      total: 2,
      isLoading: false,
      ...status,
    },
    myWork: { items: [], isLoading: false, ...status },
    decisions: {
      items: [],
      groups: [],
      kpis: { pending: 0, dueToday: 0, overdue: 0 },
      isLoading: false,
      isPartial: false,
      isError: false,
      refetch: vi.fn(),
    },
    domainCounts: {},
    teamPerformance: {
      report: null,
      isLoading: false,
      isHidden: true,
      ...status,
    },
  };
}

beforeEach(() => {
  useRoleDashboardDataMock.mockReturnValue(genericDashboardModel());
});

describe('generic dashboard chart drill-downs', () => {
  it('opens the existing decision primitive in place for the Cases Manager', async () => {
    const user = userEvent.setup();
    const model = genericDashboardModel();
    const item = {
      id: 'case:task-1',
      kind: 'case' as const,
      title: 'CASE-2026-0042',
      requestedBy: 'Reem Al-Qahtani',
      dueAt: null,
      href: '/lex/cases/case-1',
      accentValue: 'pending',
      action: {
        type: 'case' as const,
        caseId: 'case-1',
        workflowInstanceId: 'workflow-1',
        taskId: 'task-1',
        entityLabel: 'CASE-2026-0042',
        approverRole: 'legal-cases-manager',
        evidenceId: 'DOA-1',
      },
    };
    model.decisions = {
      ...model.decisions,
      items: [item],
      groups: [{ kind: 'case', items: [item] }],
      kpis: { pending: 1, dueToday: 0, overdue: 0 },
    };
    useRoleDashboardDataMock.mockReturnValue(model);

    renderWithQuery(<RoleDashboard roleSlug="legal-cases-manager" />);
    await user.click(screen.getByRole('button', { name: 'Approve' }));

    expect(screen.getByRole('dialog')).toHaveTextContent('Decision · CASE-2026-0042');
    expect(screen.getByText('Requested by Reem Al-Qahtani')).toBeInTheDocument();
  });

  it('makes every metric bar a labelled deep link', () => {
    render(
      <MetricBarChart
        bars={[
          { key: 'renewals', value: 7, unit: 'count' },
          { key: 'sla', value: 92, unit: 'percent' },
        ]}
        labelFor={(key) => (key === 'renewals' ? 'Renewals' : 'SLA')}
        hrefFor={(key) => (key === 'renewals' ? '/lex/contracts' : '/lex/service-desk/sla-board')}
      />,
    );

    const renewalsLink = screen.getByRole('link', { name: /^Renewals:/ });
    expect(renewalsLink).toHaveAttribute('href', '/lex/contracts');
    expect(renewalsLink).toHaveAccessibleName(/^Renewals:\s*\S+/);

    const slaLink = screen.getByRole('link', { name: /^SLA:/ });
    expect(slaLink).toHaveAttribute('href', '/lex/service-desk/sla-board');
    expect(slaLink).toHaveAccessibleName(/^SLA:\s*\S+/);
  });

  it('exposes view-all links for generic aggregate and work panels', () => {
    const { container, rerender } = render(<RoleDashboard roleSlug="legal-dept-manager" />);

    expect(
      container.querySelector('a[href="/lex/inbox"]:not([aria-label])'),
    ).toBeInTheDocument();
    expect(
      container.querySelector('a[href="/lex/service-desk"]:not([aria-label])'),
    ).toBeInTheDocument();
    expect(
      container.querySelector('a[href="/lex/reports/analytics"]:not([aria-label])'),
    ).toBeInTheDocument();

    rerender(<RoleDashboard roleSlug="legal-requester" />);
    expect(
      container.querySelector('a[href="/lex/inbox"]:not([aria-label])'),
    ).toBeInTheDocument();
  });

  it('links both donut segments and their visible legend rows', () => {
    render(
      <DistributionDonut
        slices={[
          { key: 'contracts', value: 11 },
          { key: 'consultations', value: 6 },
        ]}
        total={17}
        hrefFor={(key) => `/lex/${key}`}
      />,
    );

    const links = screen.getAllByRole('link');
    const contractLinks = links.filter((link) => link.getAttribute('href') === '/lex/contracts');
    expect(contractLinks).toHaveLength(2);
    for (const link of contractLinks) {
      expect(link).toHaveAttribute('href', '/lex/contracts');
      expect(link).toHaveAccessibleName(/:\s*\S+/);
    }

    const consultationLinks = links.filter(
      (link) => link.getAttribute('href') === '/lex/consultations',
    );
    expect(consultationLinks).toHaveLength(2);
    for (const link of consultationLinks) {
      expect(link).toHaveAttribute('href', '/lex/consultations');
      expect(link).toHaveAccessibleName(/:\s*\S+/);
    }
  });

  it('makes every escalation severity row a filtered attention link', () => {
    const { container } = render(
      <div dir="rtl">
        <EscalationSeverityChart
          data={[
            { severity: 'critical', count: 5 },
            { severity: 'high', count: 6 },
          ]}
          total={11}
          labelFor={(severity) => (severity === 'critical' ? 'Critical' : 'High')}
          totalLabel="warnings"
          hrefFor={(severity) => `/lex/inbox?severity=${severity}`}
        />
      </div>,
    );

    expect(screen.getByRole('link', { name: /^Critical:/ })).toHaveAttribute(
      'href',
      '/lex/inbox?severity=critical',
    );
    expect(screen.getByRole('link', { name: /^High:/ })).toHaveAttribute(
      'href',
      '/lex/inbox?severity=high',
    );
    expect(container.querySelector('.start-0')).toBeInTheDocument();
  });
});
