import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import type { ApprovalTask, LegalRequest } from '@/lib/lex/requests';

import { RequestInboxContent } from './request-inbox-page';

const {
  decideApprovalTaskMock,
  listApprovalTasksMock,
  listRequestsMock,
  listServicesMock,
  listSlaClocksMock,
  setFilterMock,
  setSearchMock,
  useDataTableMock,
} = vi.hoisted(() => ({
  decideApprovalTaskMock: vi.fn(),
  listApprovalTasksMock: vi.fn(),
  listRequestsMock: vi.fn(),
  listServicesMock: vi.fn(),
  listSlaClocksMock: vi.fn(),
  setFilterMock: vi.fn(),
  setSearchMock: vi.fn(),
  useDataTableMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ hasPermission: (permission: string) => permission === 'lex:request:approve' }),
}));

vi.mock('@/hooks/use-data-table', () => ({
  useDataTable: useDataTableMock,
}));

vi.mock('@/lib/lex/requests', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/lex/requests')>();
  return {
    ...actual,
    lexRequestsApi: {
      ...actual.lexRequestsApi,
      listServices: listServicesMock,
      listRequests: listRequestsMock,
      listMyApprovalRequests: vi.fn(),
      listSlaClocks: listSlaClocksMock,
      listApprovalTasks: listApprovalTasksMock,
      decideApprovalTask: decideApprovalTaskMock,
    },
  };
});

vi.mock('@/lib/toast', () => ({
  showError: vi.fn(),
  showSuccess: vi.fn(),
}));

const REQUESTS: LegalRequest[] = [
  request('request-1', 'REQ-2026-001', 'Vendor contract review'),
  request('request-2', 'REQ-2026-002', 'Property advice'),
];

function request(id: string, requestNumber: string, title: string): LegalRequest {
  return {
    id,
    tenant_id: 'tenant-1',
    request_number: requestNumber,
    request_type: 'contract_review',
    service_id: null,
    title: { en: title, ar: title },
    description: '',
    requester_user_id: 'requester-1',
    requester_name: 'Requester',
    department: 'Procurement',
    priority: 'normal',
    status: 'pending_provider_approval',
    cycle: 1,
    requester_approval_required: false,
    provider_approval_required: true,
    workflow_instance_id: `workflow-${id}`,
    metadata: {},
    created_by: 'requester-1',
    created_at: '2026-08-01T08:00:00Z',
    updated_at: '2026-08-01T08:00:00Z',
  };
}

function approvalTask(requestId: string): ApprovalTask {
  return {
    id: `task-${requestId}`,
    tenant_id: 'tenant-1',
    instance_id: `workflow-${requestId}`,
    step_id: 'provider_approval',
    name: 'Provider approval',
    description: '',
    status: 'pending',
    assignee_id: 'approver-1',
    assignee_role: 'legal-director',
    sla_deadline: '2026-08-02T08:00:00Z',
    sla_breached: false,
    priority: 1,
    metadata: {},
    created_at: '2026-08-01T08:00:00Z',
    updated_at: '2026-08-01T08:00:00Z',
    can_decide: true,
  };
}

function emptyPage<T>() {
  return {
    data: [] as T[],
    meta: { page: 1, per_page: 100, total: 0, total_pages: 0 },
  };
}

beforeEach(() => {
  vi.clearAllMocks();

  useDataTableMock.mockReturnValue({
    tableProps: {
      data: REQUESTS,
      totalRows: REQUESTS.length,
      page: 1,
      pageSize: 8,
      onPageChange: vi.fn(),
      onPageSizeChange: vi.fn(),
      sortColumn: 'created_at',
      sortDirection: 'desc',
      onSortChange: vi.fn(),
      searchValue: '',
      onSearchChange: setSearchMock,
      activeFilters: {},
      onFilterChange: setFilterMock,
      onClearFilters: vi.fn(),
      isLoading: false,
      error: null,
      onRetry: vi.fn(),
    },
    totalRows: REQUESTS.length,
    searchValue: '',
    setSearch: setSearchMock,
    activeFilters: {},
    setFilter: setFilterMock,
  });
  listServicesMock.mockResolvedValue(emptyPage());
  listRequestsMock.mockResolvedValue(emptyPage());
  listSlaClocksMock.mockResolvedValue(emptyPage());
  listApprovalTasksMock.mockImplementation((requestId: string) =>
    Promise.resolve([approvalTask(requestId)]),
  );
  decideApprovalTaskMock.mockResolvedValue({ status: 'approved' });
});

describe('RequestInboxContent request-approval controls', () => {
  it('wires search and request-type filters to the approval queue data table', async () => {
    const user = userEvent.setup();
    renderWithQuery(<RequestInboxContent mode="approvals" />);

    expect(useDataTableMock).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: 'lex-my-approval-requests',
      }),
    );

    fireEvent.change(
      screen.getByRole('searchbox', { name: /Search by request ID/i }),
      { target: { value: 'vendor' } },
    );
    expect(setSearchMock).toHaveBeenCalledWith('vendor');

    await user.click(screen.getByRole('tab', { name: 'Contract Review' }));
    expect(setFilterMock).toHaveBeenCalledWith('request_type', 'contract_review');
  });

  it('bulk-approves every selected request through its actor-eligible approval task', async () => {
    const user = userEvent.setup();
    const { queryClient } = renderWithQuery(<RequestInboxContent mode="approvals" />);
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    await user.click(
      screen.getByRole('checkbox', { name: 'Select all requests on this page' }),
    );
    const approveSelected = screen.getByRole('button', { name: 'Approve Selected' });
    expect(approveSelected).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Reject Selected' })).toBeEnabled();

    await user.click(approveSelected);

    await waitFor(() => expect(decideApprovalTaskMock).toHaveBeenCalledTimes(2));
    for (const requestItem of REQUESTS) {
      expect(decideApprovalTaskMock).toHaveBeenCalledWith(
        requestItem.id,
        `workflow-${requestItem.id}`,
        `task-${requestItem.id}`,
        { decision: 'approve' },
      );
    }
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['lex-my-approval-requests'],
    });
  });
});
