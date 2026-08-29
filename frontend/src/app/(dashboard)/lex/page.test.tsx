import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import LexPage from '@/app/(dashboard)/lex/page';
import type {
  KpiKey,
  RoleDashboardModel,
} from '@/app/(dashboard)/lex/_lib/role-dashboards/use-role-dashboard-data';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/lex',
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    hasPermission: () => true,
    isHydrated: true,
    isAuthenticated: true,
    user: { id: 'u-1', first_name: 'Khaled', email: 'khaled@apexbank.demo' },
  }),
}));

// Drive the active persona deterministically to the Legal Dept Manager.
vi.mock('@/lib/lex/use-lex-context', () => ({
  useLexContext: () => ({ activeRole: { slug: 'legal-dept-manager' }, loading: false }),
}));

// The export handler reads this; a bare stub keeps the page inert.
vi.mock('@/app/(dashboard)/lex/_lib/use-lex-command-center', () => ({
  useLexOverviewDashboard: () => ({ data: undefined, isLoading: false }),
}));

// A controlled model so the render is deterministic (the data fan-out is
// covered by the command-center hooks' own tests).
const kpi = (value: number | null) => ({
  value,
  isLoading: false,
  isAvailable: value !== null,
  isError: false,
});
/** Settled, healthy slice status (this fixture exercises the ready path only). */
const OK = { isError: false, refetch: () => {} };
const ALL_KPI_KEYS: KpiKey[] = [
  'totalRequests', 'pendingRequests', 'slaCompliance', 'activeLitigations', 'contractsUnderReview',
  'activeContracts', 'openMatters', 'overdueObligations', 'pendingApprovals', 'slaBreaches',
  'openAlerts', 'complianceScore', 'consultations', 'investigations', 'settlements',
  'expiringContracts', 'highRiskContracts', 'myOpenItems',
];

const MODEL: RoleDashboardModel = {
  kpis: Object.fromEntries(ALL_KPI_KEYS.map((k) => [k, kpi(0)])) as RoleDashboardModel['kpis'],
  kpiCaptions: { activeLitigations: { key: 'cap.hearingsScheduled', vars: { n: '3' }, tone: 'neutral' } },
  recentRequests: {
    items: [
      {
        id: 'r1',
        title: 'M&A Agreement Review',
        reference: 'REQ-5022',
        subtitle: 'Corporate Division',
        status: 'submitted',
        statusLabel: 'Under Review',
        href: '/lex/service-desk',
      },
    ],
    isLoading: false,
    ...OK,
  },
  distribution: {
    slices: [
      { key: 'contracts', value: 68 },
      { key: 'consultations', value: 42 },
      { key: 'litigations', value: 30 },
      { key: 'others', value: 16 },
    ],
    total: 156,
    isLoading: false,
    ...OK,
  },
  workloadByArea: {
    bars: [
      { key: 'sla', value: 3, unit: 'count' },
      { key: 'obligations', value: 2, unit: 'count' },
      { key: 'approvals', value: 5, unit: 'count' },
    ],
    isLoading: false,
    ...OK,
  },
  contractStatusMix: { bars: [], isLoading: false, ...OK },
  resolutionRates: { bars: [], isLoading: false, ...OK },
  escalations: {
    items: [
      {
        id: 'e1',
        title: 'Acquisition contract draft is past maximum review SLA',
        severity: 'critical',
        href: '/lex/service-desk',
      },
    ],
    bySeverity: [
      { severity: 'critical', count: 2 },
      { severity: 'high', count: 3 },
    ],
    total: 5,
    isLoading: false,
    ...OK,
  },
  myWork: { items: [], isLoading: false, ...OK },
  decisions: {
    items: [],
    groups: [],
    kpis: { pending: 0, dueToday: 0, overdue: 0 },
    isLoading: false,
    isPartial: false,
    ...OK,
  },
  teamPerformance: {
    report: null,
    isLoading: false,
    isHidden: true,
    ...OK,
  },
  domainCounts: {},
};

// The manager's KPI values (mockup figures).
MODEL.kpis.totalRequests = kpi(156);
MODEL.kpis.pendingRequests = kpi(23);
MODEL.kpis.slaCompliance = kpi(94);
MODEL.kpis.activeLitigations = kpi(18);
MODEL.kpis.contractsUnderReview = kpi(7);

vi.mock('@/app/(dashboard)/lex/_lib/role-dashboards/use-role-dashboard-data', async (importActual) => {
  const actual =
    await importActual<typeof import('@/app/(dashboard)/lex/_lib/role-dashboards/use-role-dashboard-data')>();
  return { ...actual, useRoleDashboardData: () => MODEL };
});

describe('Lex per-role landing', () => {
  it('renders the Legal Dept Manager dashboard in English', async () => {
    renderWithQuery(<LexPage />);

    expect(await screen.findByText('Welcome, Khaled')).toBeInTheDocument();
    expect(screen.getByText('Legal Dept Manager')).toBeInTheDocument();
    // The manager's KPI cards (mockup set).
    expect(screen.getByText('Total Requests')).toBeInTheDocument();
    expect(screen.getByText('SLA Compliance')).toBeInTheDocument();
    expect(screen.getByText('Contracts Under Review')).toBeInTheDocument();
    // Contextual KPI caption from real data (overrides the tone caption).
    expect(screen.getByText('3 hearings scheduled')).toBeInTheDocument();
    // Panels.
    expect(screen.getByText('Recent Service Requests Received')).toBeInTheDocument();
    expect(screen.getByText('Service Request Distribution')).toBeInTheDocument();
    expect(screen.getByText('Escalation & Risk Warnings')).toBeInTheDocument();
    // Live rows.
    expect(screen.getByText('M&A Agreement Review')).toBeInTheDocument();
    // Escalation & Risk Warnings renders as a severity bar chart: tier labels +
    // counts are directly labelled (no legend, per the dataviz rules).
    expect(screen.getByText('Critical')).toBeInTheDocument();
    expect(screen.getByText('High')).toBeInTheDocument();
  });

  it('renders the Arabic/RTL surface under the ar locale', async () => {
    renderWithQuery(<LexPage />, { locale: 'ar' });

    expect(await screen.findByText('مدير الإدارة القانونية')).toBeInTheDocument();
    expect(
      screen.getByText('تابع تدفّق الطلبات القانونية ومعدلات إنجاز الفرق واتجاهات الامتثال'),
    ).toBeInTheDocument();
    expect(screen.getByText('توزيع طلبات الخدمة')).toBeInTheDocument();
  });
});
