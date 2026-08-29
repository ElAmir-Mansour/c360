import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@/components/providers/locale-provider';
import { getMessages } from '@/lib/i18n/messages';
import { lexSupportApi, type LexSupportRequest } from '@/lib/lex/support';
import { SupportRequestsPanel } from './support-requests-panel';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const openRequest: LexSupportRequest = {
  id: 'support-1',
  tenant_id: 'tenant-1',
  requester_id: 'requester-1',
  requester_entity_id: 'contracts',
  target_entity_id: 'cases',
  assignee_id: 'helper-1',
  subject: 'Help assess the evidence',
  body: 'Please review the new attachment.',
  priority: 'high',
  subject_type: 'case',
  subject_id: 'case-1',
  status: 'open',
  resolution_note: '',
  expires_at: null,
  accepted_at: null,
  closed_at: null,
  created_at: '2026-07-31T08:00:00Z',
  updated_at: '2026-07-31T08:00:00Z',
  requester: {
    id: 'requester-1',
    first_name: 'Omar',
    last_name: 'Hassan',
  },
  target_entity: {
    id: 'cases',
    code: 'CASES',
    entity_type: 'section',
    name: { en: 'Cases', ar: 'القضايا' },
  },
};

/** A request still behind the manager-approval gate, held by Sara Ali. */
const pendingRequest: LexSupportRequest = {
  ...openRequest,
  id: 'support-pending',
  subject: 'Confirm the settlement mandate',
  status: 'pending_manager_approval',
  expires_at: null,
  business_days: 2,
  approver_user_id: 'approver-1',
  approval_route: 'manager',
  approval_note: '',
  approval_decided_at: null,
  approver: { id: 'approver-1', first_name: 'Sara', last_name: 'Ali' },
  assignee: { id: 'helper-1', first_name: 'Noura', last_name: 'Saleh' },
};

/** Page shapes for a param-aware `list` mock: the approvals box is its own scope. */
function page(data: LexSupportRequest[]) {
  return { data, meta: { page: 1, per_page: 25, total: data.length, total_pages: 1 } };
}

function mockListByBox(byBox: Partial<Record<string, LexSupportRequest[]>>) {
  return vi
    .spyOn(lexSupportApi, 'list')
    .mockImplementation(async (params) => page(byBox[params.box] ?? []));
}

function renderPanel(
  options: { view?: 'incoming' | 'sent' | 'history'; locale?: 'en' | 'ar' } = {},
) {
  const { view = 'incoming', locale = 'en' } = options;
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <LocaleProvider
      locale={locale}
      direction={locale === 'ar' ? 'rtl' : 'ltr'}
      messages={getMessages(locale)}
    >
      <QueryClientProvider client={client}>
        <SupportRequestsPanel view={view} canRespond canCancel />
      </QueryClientProvider>
    </LocaleProvider>,
  );
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('SupportRequestsPanel', () => {
  it('renders non-colour status text and performs an inline assignee action', async () => {
    vi.spyOn(lexSupportApi, 'list').mockResolvedValue({
      data: [openRequest],
      meta: { page: 1, per_page: 100, total: 1, total_pages: 1 },
    });
    const accept = vi.spyOn(lexSupportApi, 'accept').mockResolvedValue({
      ...openRequest,
      status: 'accepted',
      accepted_at: '2026-07-31T09:00:00Z',
    });
    renderPanel();

    expect(await screen.findByText('Help assess the evidence')).toBeInTheDocument();
    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.getByText(/Omar Hassan/)).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Accept' }));
    expect(await screen.findByRole('dialog', { name: 'Accept support request' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(accept).toHaveBeenCalledWith('support-1'));
  });

  it('fails soft with a scoped retry state', async () => {
    vi.spyOn(lexSupportApi, 'list').mockRejectedValue(new Error('unreachable'));
    renderPanel();

    expect(await screen.findByRole('alert')).toHaveTextContent('Support requests are unavailable');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
  });

  it('loads subsequent pages without replacing the first page', async () => {
    const pageTwoRequest = { ...openRequest, id: 'support-2', subject: 'Review the contract schedule' };
    vi.spyOn(lexSupportApi, 'list').mockImplementation(async (params) => params.page === 2
      ? { data: [pageTwoRequest], meta: { page: 2, per_page: 25, total: 2, total_pages: 2 } }
      : { data: [openRequest], meta: { page: 1, per_page: 25, total: 2, total_pages: 2 } });
    renderPanel();

    expect(await screen.findByText(openRequest.subject)).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Load more' }));

    expect(await screen.findByText(pageTwoRequest.subject)).toBeInTheDocument();
    expect(screen.getByText(openRequest.subject)).toBeInTheDocument();
  });

  it('shows complete details and navigates to the linked case', async () => {
    const subjectId = '43cb6ac6-914d-4b24-a00b-86db08266897';
    const complete = {
      ...openRequest,
      subject_id: subjectId,
      body: 'Full evidence analysis\nIncluding the second line that is not clamped.',
    };
    vi.spyOn(lexSupportApi, 'list').mockResolvedValue({
      data: [complete],
      meta: { page: 1, per_page: 25, total: 1, total_pages: 1 },
    });
    vi.spyOn(lexSupportApi, 'get').mockResolvedValue(complete);
    renderPanel();

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'View full details' }));

    expect(await screen.findByRole('dialog', { name: 'Support request details' })).toBeInTheDocument();
    const dialog = screen.getByRole('dialog', { name: 'Support request details' });
    expect(within(dialog).getByText(/Including the second line/)).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: 'Open linked Case' })).toHaveAttribute(
      'href',
      `/lex/cases/${subjectId}`,
    );
  });

  it('shows the pending-approval group to the resolved approver and hides it from everyone else', async () => {
    mockListByBox({ approvals: [pendingRequest], inbox: [openRequest] });
    renderPanel();

    expect(
      await screen.findByRole('heading', { name: 'Pending my approval' }),
    ).toBeInTheDocument();
    const group = screen.getByRole('region', { name: 'Pending my approval' });
    expect(within(group).getByText('Confirm the settlement mandate')).toBeInTheDocument();
    // The colleague who would receive it is named, so the approver knows where it goes.
    expect(within(group).getByText('Noura Saleh')).toBeInTheDocument();
    expect(within(group).getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(within(group).getByRole('button', { name: 'Reject' })).toBeInTheDocument();
    // A request behind the gate carries no validity clock yet.
    expect(within(group).queryByText('Support validity')).not.toBeInTheDocument();

    cleanup();
    // A user who is nobody's approver gets an empty approvals scope from the
    // server: the group must disappear entirely, not render an empty state.
    mockListByBox({ approvals: [], inbox: [openRequest] });
    renderPanel();

    expect(await screen.findByText(openRequest.subject)).toBeInTheDocument();
    expect(screen.queryByText('Pending my approval')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
  });

  it('approves in place through the approve endpoint', async () => {
    mockListByBox({ approvals: [pendingRequest], inbox: [] });
    const approve = vi
      .spyOn(lexSupportApi, 'approve')
      .mockResolvedValue({ ...pendingRequest, status: 'open' });
    renderPanel();

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Approve' }));
    expect(
      await screen.findByRole('dialog', { name: 'Approve support request' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(approve).toHaveBeenCalledWith('support-pending'));
  });

  it('rejects in place with a note through the reject endpoint', async () => {
    mockListByBox({ approvals: [pendingRequest], inbox: [] });
    const reject = vi
      .spyOn(lexSupportApi, 'reject')
      .mockResolvedValue({ ...pendingRequest, status: 'rejected' });
    renderPanel();

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Reject' }));
    const dialog = await screen.findByRole('dialog', { name: 'Reject support request' });
    await user.type(within(dialog).getByLabelText('Note'), 'Raise this with the client first.');
    await user.click(within(dialog).getByRole('button', { name: 'Confirm' }));

    await waitFor(() =>
      expect(reject).toHaveBeenCalledWith('support-pending', 'Raise this with the client first.'),
    );
  });

  it('tells the requester the request is awaiting approval and who holds it', async () => {
    mockListByBox({ sent: [pendingRequest] });
    renderPanel({ view: 'sent' });

    expect(await screen.findByText('Confirm the settlement mandate')).toBeInTheDocument();
    expect(screen.getByText('Awaiting manager approval')).toBeInTheDocument();
    expect(screen.getByText('Awaiting approval by Sara Ali')).toBeInTheDocument();
    // The requester can still withdraw a request stuck behind the gate.
    expect(screen.getByRole('button', { name: 'Cancel request' })).toBeInTheDocument();
  });

  it('says plainly when nobody approved an auto-routed request', async () => {
    mockListByBox({
      sent: [
        {
          ...pendingRequest,
          id: 'support-auto',
          status: 'open',
          approval_route: 'auto_no_manager',
          approver_user_id: null,
          approver: null,
          approval_decided_at: '2026-07-31T08:00:00Z',
        },
      ],
    });
    renderPanel({ view: 'sent' });

    expect(
      await screen.findByText(/no manager in the org chart, so no person approved this request/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Approved by/)).not.toBeInTheDocument();
  });

  it('shows the rejection reason on a terminal rejected request', async () => {
    mockListByBox({
      all: [
        {
          ...pendingRequest,
          id: 'support-rejected',
          status: 'rejected',
          approval_note: 'Route this through procurement instead.',
          approval_decided_at: '2026-08-01T08:00:00Z',
          closed_at: '2026-08-01T08:00:00Z',
        },
      ],
    });
    renderPanel({ view: 'history' });

    expect(await screen.findByText('Rejected')).toBeInTheDocument();
    expect(screen.getByText(/Rejected by Sara Ali/)).toBeInTheDocument();
    expect(screen.getByText(/Route this through procurement instead\./)).toBeInTheDocument();
    expect(screen.getByText(/Rejection reason/)).toBeInTheDocument();
  });

  it('renders the approval gate in Arabic', async () => {
    mockListByBox({ approvals: [pendingRequest], inbox: [] });
    renderPanel({ locale: 'ar' });

    expect(await screen.findByRole('heading', { name: 'بانتظار موافقتي' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'اعتماد' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'عدم الاعتماد' })).toBeInTheDocument();
  });

  it('removes an active request and refetches at its exact expiry boundary', async () => {
    const expiring = { ...openRequest, expires_at: new Date(Date.now() + 500).toISOString() };
    const list = vi.spyOn(lexSupportApi, 'list').mockResolvedValue({
      data: [expiring],
      meta: { page: 1, per_page: 25, total: 1, total_pages: 1 },
    });
    renderPanel();

    expect(await screen.findByText(expiring.subject)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText(expiring.subject)).not.toBeInTheDocument());
    expect(list.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
