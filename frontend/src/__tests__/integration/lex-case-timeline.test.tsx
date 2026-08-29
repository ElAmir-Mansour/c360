import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import LexCaseTimelinePage from '@/app/(dashboard)/lex/case-timeline/page';
import LexCaseTimelinePortfolioPage from '@/app/(dashboard)/lex/case-timeline/portfolio/page';
import type { PaginatedResponse } from '@/types/api';
import type {
  DeadlineObligation,
  HoldHistoryEntry,
  LegalCaseDelayEvent,
  MatterTimeline,
  MatterTimelineSummary,
} from '@/lib/lex/settlements';

const {
  createDeadlineMock,
  editDelayEventMock,
  getTimelineMock,
  listDeadlinesMock,
  listDelayEventsMock,
  listHoldHistoryMock,
  listMatterTimelinesMock,
  recordDelayEventMock,
  reopenDelayEventMock,
  resolveDelayEventMock,
  routerPushMock,
  routerReplaceMock,
  routeState,
  searchMattersMock,
  setExternalHoldMock,
  updateTimelineMock,
  usersListMock,
} = vi.hoisted(() => ({
  createDeadlineMock: vi.fn(),
  editDelayEventMock: vi.fn(),
  getTimelineMock: vi.fn(),
  listDeadlinesMock: vi.fn(),
  listDelayEventsMock: vi.fn(),
  listHoldHistoryMock: vi.fn(),
  listMatterTimelinesMock: vi.fn(),
  recordDelayEventMock: vi.fn(),
  reopenDelayEventMock: vi.fn(),
  resolveDelayEventMock: vi.fn(),
  routerPushMock: vi.fn(),
  routerReplaceMock: vi.fn(),
  routeState: { pathname: '/lex/case-timeline', search: 'matterId=matter-1' },
  searchMattersMock: vi.fn(),
  setExternalHoldMock: vi.fn(),
  updateTimelineMock: vi.fn(),
  usersListMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: routerPushMock,
    replace: routerReplaceMock,
    back: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => routeState.pathname,
  useSearchParams: () => new URLSearchParams(routeState.search),
  useParams: () => ({}),
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    hasPermission: (permission: string) =>
      ['lex:read', 'lex:write', 'lex:case:view', 'lex:case:edit'].includes(permission),
    hasAnyPermission: (permissions: string[]) =>
      permissions.some((permission) =>
        ['lex:read', 'lex:write', 'lex:case:view', 'lex:case:edit'].includes(permission),
      ),
    hasAllPermissions: (permissions: string[]) =>
      permissions.every((permission) =>
        ['lex:read', 'lex:write', 'lex:case:view', 'lex:case:edit'].includes(permission),
      ),
    isAuthenticated: true,
    isHydrated: true,
    user: {
      id: 'legal-user-1',
      permissions: ['lex:read', 'lex:write', 'lex:case:view', 'lex:case:edit'],
    },
  }),
}));

vi.mock('@/lib/enterprise/api', () => ({
  enterpriseApi: {
    users: {
      list: usersListMock,
    },
  },
}));

vi.mock('@/lib/lex/settlements', async () => {
  const actual = await vi.importActual<typeof import('@/lib/lex/settlements')>(
    '@/lib/lex/settlements',
  );

  return {
    ...actual,
    settlementsApi: {
      ...actual.settlementsApi,
      createDeadline: createDeadlineMock,
      editDelayEvent: editDelayEventMock,
      getTimeline: getTimelineMock,
      listDeadlines: listDeadlinesMock,
      listDelayEvents: listDelayEventsMock,
      listHoldHistory: listHoldHistoryMock,
      listMatterTimelines: listMatterTimelinesMock,
      recordDelayEvent: recordDelayEventMock,
      reopenDelayEvent: reopenDelayEventMock,
      resolveDelayEvent: resolveDelayEventMock,
      searchMatters: searchMattersMock,
      setExternalHold: setExternalHoldMock,
      updateTimeline: updateTimelineMock,
    },
  };
});

function paginated<T>(data: T[], meta?: Partial<PaginatedResponse<T>['meta']>): PaginatedResponse<T> {
  return {
    data,
    meta: {
      page: 1,
      per_page: data.length || 20,
      total: data.length,
      total_pages: 1,
      ...meta,
    },
  };
}

const matterOptions = paginated([
  {
    id: 'matter-1',
    title: 'Alpha Construction Claim',
    matter_number: 'MAT-2026-001',
    status: 'on_hold',
  },
  {
    id: 'matter-2',
    title: 'Beta Supplier Dispute',
    matter_number: 'MAT-2026-002',
    status: 'open',
  },
]);

const timeline = {
  matter_id: 'matter-1',
  tenant_id: 'tenant-1',
  matter_number: 'MAT-2026-001',
  title: 'Alpha Construction Claim',
  status: 'on_hold',
  opened_at: '2026-05-01T08:00:00Z',
  due_date: '2026-09-15T08:00:00Z',
  closed_at: null,
  estimated_duration_days: 90,
  estimated_completion_date: '2026-08-01T08:00:00Z',
  external_hold: true,
  external_hold_category: 'court',
  external_hold_since: '2026-06-05T08:00:00Z',
  closure_reason: null,
  updated_at: '2026-06-20T08:00:00Z',
  delay_events: [],
  open_delay_days: 12,
} satisfies MatterTimeline;

const delayEvent = {
  id: 'delay-1',
  tenant_id: 'tenant-1',
  matter_id: 'matter-1',
  category: 'court',
  reason: 'Court expert report pending',
  opened_at: '2026-06-05T08:00:00Z',
  resolved_at: null,
  resolved: false,
  metadata: {},
  created_by: 'legal-user-1',
  created_at: '2026-06-05T08:00:00Z',
  updated_at: '2026-06-05T08:00:00Z',
  deleted_at: null,
} satisfies LegalCaseDelayEvent;

const deadline = {
  id: 'deadline-1',
  tenant_id: 'tenant-1',
  title: 'File expert response',
  description: 'Response filing deadline.',
  type: 'contractual',
  status: 'open',
  priority: 'high',
  contract_id: null,
  contract_title: null,
  matter_id: 'matter-1',
  matter_title: 'Alpha Construction Claim',
  clause_id: null,
  owner_user_id: 'legal-user-1',
  owner_name: 'Fatima Legal',
  due_date: '2026-07-02T08:00:00Z',
  completed_at: null,
  reminder_enabled: true,
  reminder_lead_days: [7, 1],
  escalation_enabled: false,
  escalation_lead_days: [],
  escalation_target: null,
  last_reminder_at: null,
  tags: [],
  metadata: {},
  created_by: 'legal-user-1',
  created_at: '2026-06-05T08:00:00Z',
  updated_at: '2026-06-05T08:00:00Z',
  deleted_at: null,
  days_until_due: 5,
} satisfies DeadlineObligation;

const holdHistory = [
  {
    id: 'hold-1',
    tenant_id: 'tenant-1',
    matter_id: 'matter-1',
    action: 'set',
    category: 'court',
    reason: 'Awaiting court expert report',
    created_by: 'legal-user-1',
    created_at: '2026-06-05T08:00:00Z',
  },
] satisfies HoldHistoryEntry[];

const portfolioRows = [
  {
    matter_id: 'matter-1',
    matter_number: 'MAT-2026-001',
    title: 'Alpha Construction Claim',
    status: 'on_hold',
    external_hold: true,
    external_hold_category: 'court',
    external_hold_since: '2026-06-05T08:00:00Z',
    estimated_completion_date: '2026-08-01T08:00:00Z',
    due_date: '2026-09-15T08:00:00Z',
    open_delay_days: 12,
    updated_at: '2026-06-20T08:00:00Z',
  },
  {
    matter_id: 'matter-2',
    matter_number: 'MAT-2026-002',
    title: 'Beta Supplier Dispute',
    status: 'open',
    external_hold: false,
    external_hold_category: null,
    external_hold_since: null,
    estimated_completion_date: '2026-07-04T08:00:00Z',
    due_date: '2026-07-10T08:00:00Z',
    open_delay_days: 3,
    updated_at: '2026-06-18T08:00:00Z',
  },
] satisfies MatterTimelineSummary[];

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  routeState.pathname = '/lex/case-timeline';
  routeState.search = 'matterId=matter-1';

  searchMattersMock.mockResolvedValue(matterOptions);
  getTimelineMock.mockResolvedValue(timeline);
  listDelayEventsMock.mockResolvedValue(paginated([delayEvent]));
  listDeadlinesMock.mockResolvedValue(paginated([deadline]));
  listHoldHistoryMock.mockResolvedValue(holdHistory);
  listMatterTimelinesMock.mockResolvedValue(paginated(portfolioRows, { per_page: 20 }));
  usersListMock.mockResolvedValue(
    paginated([
      {
        id: 'legal-user-1',
        first_name: 'Fatima',
        last_name: 'Legal',
        email: 'fatima@example.com',
        status: 'active',
        roles: [],
      },
    ]),
  );
});

describe('Lex case timeline integration', () => {
  it('hydrates a deep-linked matter and renders the shared timeline panel data', async () => {
    renderWithQuery(<LexCaseTimelinePage />);

    expect(await screen.findByText('Alpha Construction Claim (MAT-2026-001)')).toBeInTheDocument();
    expect(await screen.findByText('File expert response')).toBeInTheDocument();
    expect(screen.getByText('Court expert report pending')).toBeInTheDocument();
    expect(screen.getByText('Awaiting court expert report')).toBeInTheDocument();

    await waitFor(() => {
      expect(searchMattersMock).toHaveBeenCalledWith('');
      expect(getTimelineMock).toHaveBeenCalledWith('matter-1');
      expect(listDelayEventsMock).toHaveBeenCalledWith(
        'matter-1',
        { page: 1, per_page: 20 },
        expect.objectContaining({ sort: 'opened_at', sort_dir: 'desc' }),
      );
      expect(listDeadlinesMock).toHaveBeenCalledWith('matter-1');
      expect(listHoldHistoryMock).toHaveBeenCalledWith('matter-1');
      expect(usersListMock).toHaveBeenCalledWith({ page: 1, per_page: 200 });
    });
  });

  it('renders portfolio triage rows and re-queries when switching delay tabs', async () => {
    const user = userEvent.setup();
    routeState.pathname = '/lex/case-timeline/portfolio';
    routeState.search = '';

    renderWithQuery(<LexCaseTimelinePortfolioPage />);

    expect(await screen.findByText('Alpha Construction Claim')).toBeInTheDocument();
    expect(screen.getByText('Beta Supplier Dispute')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /view timeline/i })[0]).toHaveAttribute(
      'href',
      '/lex/case-timeline?matterId=matter-1',
    );

    await waitFor(() => {
      expect(listMatterTimelinesMock).toHaveBeenCalledWith({
        on_hold: true,
        page: 1,
        per_page: 20,
        sort: 'updated_at',
        sort_dir: 'desc',
      });
    });

    await user.click(screen.getByRole('tab', { name: /matters with open delays/i }));

    await waitFor(() => {
      expect(listMatterTimelinesMock).toHaveBeenCalledWith({
        min_open_delay_days: 1,
        page: 1,
        per_page: 20,
        sort: 'open_delay_days',
        sort_dir: 'desc',
      });
    });
  });
});
