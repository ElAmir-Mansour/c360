import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import LexMatterDetailPage from '@/app/(dashboard)/lex/matters/[id]/page';
import { matterLabelsBundle } from '@/app/(dashboard)/lex/matters/_components/labels';
import { supportLabels } from '@/app/(dashboard)/lex/inbox/_lib/support-i18n';
import type {
  LexContractRecord,
  LexMatter,
  LexMatterContract,
  LexObligation,
  UserDirectoryEntry,
} from '@/types/suites';

const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const MATTER_ID = 'matter-1';
const CONTRACT_ID = 'contract-9';

const {
  getMatterMock,
  listMatterObligationsMock,
  triageMatterMock,
  linkMatterContractMock,
  unlinkMatterContractMock,
  listContractsMock,
  listMattersMock,
  listMatterAuditMock,
  listMatterRelatedMock,
  listMatterDocumentsMock,
  getObligationReminderPlanMock,
  usersListMock,
  authState,
  showApiErrorMock,
  showSuccessMock,
} = vi.hoisted(() => ({
  getMatterMock: vi.fn(),
  listMatterObligationsMock: vi.fn(),
  triageMatterMock: vi.fn(),
  linkMatterContractMock: vi.fn(),
  unlinkMatterContractMock: vi.fn(),
  listContractsMock: vi.fn(),
  listMattersMock: vi.fn(),
  listMatterAuditMock: vi.fn(),
  listMatterRelatedMock: vi.fn(),
  listMatterDocumentsMock: vi.fn(),
  getObligationReminderPlanMock: vi.fn(),
  usersListMock: vi.fn(),
  authState: { canWrite: true, canAskSupport: true },
  showApiErrorMock: vi.fn(),
  showSuccessMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => `/lex/matters/${MATTER_ID}`,
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ id: MATTER_ID }),
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    // Matters now gate mutation on the domain-specific lex:case:edit verb
    // (RBAC §9). The page guard reads lex:case:view (returns true here).
    // "Ask for support" gates on the same verb the inbox uses.
    hasPermission: (permission: string) =>
      permission === 'lex:case:edit'
        ? authState.canWrite
        : permission === 'lex:support:create'
          ? authState.canAskSupport
          : true,
    hasAnyPermission: (permissions: string[]) =>
      permissions.some((permission) =>
        permission === 'lex:case:edit'
          ? authState.canWrite
          : permission === 'lex:support:create'
            ? authState.canAskSupport
            : true,
      ),
    isHydrated: true,
    isAuthenticated: true,
    user: { id: OWNER_ID },
  }),
}));

// Page-level tests exercise the link mutation contract. The Radix Select used
// by the real child dialog has its own focus scope; nesting that scope inside a
// Radix Dialog can recurse indefinitely in jsdom even though browser focus
// behavior is correct. Keep this test at the page boundary with a deterministic
// child that submits the same payload shape.
vi.mock('@/app/(dashboard)/lex/matters/_components/matter-link-contract-dialog', () => ({
  MatterLinkContractDialog: ({
    open,
    onSubmit,
  }: {
    open: boolean;
    onSubmit: (payload: { contract_id: string; relationship: string }) => void;
  }) =>
    open ? (
      <div role="dialog" aria-label="Link Contract">
        <button
          type="button"
          onClick={() => onSubmit({ contract_id: 'contract-10', relationship: 'primary' })}
        >
          Link Contract
        </button>
      </div>
    ) : null,
}));

vi.mock('@/lib/toast', () => ({
  showSuccess: showSuccessMock,
  showApiError: showApiErrorMock,
}));

vi.mock('@/lib/enterprise', async () => {
  const actual = await vi.importActual<typeof import('@/lib/enterprise')>('@/lib/enterprise');
  return {
    ...actual,
    enterpriseApi: {
      ...actual.enterpriseApi,
      users: { ...actual.enterpriseApi.users, list: usersListMock },
      lex: {
        ...actual.enterpriseApi.lex,
        getMatter: getMatterMock,
        listMatterObligations: listMatterObligationsMock,
        triageMatter: triageMatterMock,
        linkMatterContract: linkMatterContractMock,
        unlinkMatterContract: unlinkMatterContractMock,
        listContracts: listContractsMock,
        listMatters: listMattersMock,
        listMatterAudit: listMatterAuditMock,
        listMatterRelated: listMatterRelatedMock,
        listMatterDocuments: listMatterDocumentsMock,
        getObligationReminderPlan: getObligationReminderPlanMock,
      },
    },
  };
});

const directoryUsers: UserDirectoryEntry[] = [
  {
    id: OWNER_ID,
    first_name: 'Ada',
    last_name: 'Lovelace',
    email: 'ada@example.com',
    status: 'active',
    roles: [],
  },
];

const linkedContract: LexMatterContract = {
  id: 'link-1',
  tenant_id: 'tenant-1',
  matter_id: MATTER_ID,
  contract_id: CONTRACT_ID,
  contract_title: 'Acme Master Services Agreement',
  relationship: 'primary',
  created_by: OWNER_ID,
  created_at: '2026-05-02T09:00:00Z',
};

const matter: LexMatter = {
  id: MATTER_ID,
  tenant_id: 'tenant-1',
  matter_number: 'LEX-M-2026-001',
  title: 'Vendor termination dispute',
  description: 'Dispute over early termination clause.',
  type: 'dispute',
  status: 'open',
  priority: 'high',
  owner_user_id: OWNER_ID,
  owner_name: 'Ada Lovelace',
  requester_user_id: null,
  requester_name: 'Procurement Lead',
  department: 'Procurement',
  opened_at: '2026-05-01T09:00:00Z',
  due_date: '2026-07-01T09:00:00Z',
  closed_at: null,
  contracts: [linkedContract],
  tags: ['dispute'],
  metadata: {},
  created_by: OWNER_ID,
  created_at: '2026-05-01T09:00:00Z',
  updated_at: '2026-05-10T09:00:00Z',
};

const obligation: LexObligation = {
  id: 'obligation-1',
  tenant_id: 'tenant-1',
  title: 'Serve termination notice',
  description: 'Notice must be served within the contractual window.',
  type: 'notice',
  status: 'open',
  priority: 'high',
  contract_id: CONTRACT_ID,
  contract_title: 'Acme Master Services Agreement',
  matter_id: MATTER_ID,
  matter_title: 'Vendor termination dispute',
  clause_id: null,
  owner_user_id: OWNER_ID,
  owner_name: 'Ada Lovelace',
  due_date: '2026-06-20T09:00:00Z',
  completed_at: null,
  reminder_enabled: true,
  reminder_lead_days: [7, 1],
  escalation_enabled: false,
  escalation_lead_days: [],
  escalation_target: null,
  last_reminder_at: null,
  tags: [],
  metadata: {},
  created_by: OWNER_ID,
  created_at: '2026-05-02T09:00:00Z',
  updated_at: '2026-05-02T09:00:00Z',
  deleted_at: null,
  days_until_due: 30,
};

const otherContract: LexContractRecord = {
  ...({} as LexContractRecord),
  id: 'contract-10',
  tenant_id: 'tenant-1',
  title: 'Beta Vendor NDA',
  type: 'nda',
  status: 'active',
  owner_user_id: OWNER_ID,
  owner_name: 'Ada Lovelace',
  tags: [],
  metadata: {},
};

beforeEach(() => {
  authState.canWrite = true;
  authState.canAskSupport = true;
  getMatterMock.mockReset();
  listMatterObligationsMock.mockReset();
  triageMatterMock.mockReset();
  linkMatterContractMock.mockReset();
  unlinkMatterContractMock.mockReset();
  listContractsMock.mockReset();
  listMattersMock.mockReset();
  listMatterAuditMock.mockReset();
  listMatterRelatedMock.mockReset();
  listMatterDocumentsMock.mockReset();
  getObligationReminderPlanMock.mockReset();
  usersListMock.mockReset();
  showApiErrorMock.mockReset();
  showSuccessMock.mockReset();

  getMatterMock.mockResolvedValue(matter);
  listMatterObligationsMock.mockResolvedValue({
    data: [obligation],
    meta: { page: 1, per_page: 50, total: 1, total_pages: 1 },
  });
  triageMatterMock.mockResolvedValue({ ...matter, status: 'in_review' });
  linkMatterContractMock.mockResolvedValue({
    ...linkedContract,
    id: 'link-2',
    contract_id: 'contract-10',
    contract_title: 'Beta Vendor NDA',
    relationship: 'related',
  });
  unlinkMatterContractMock.mockResolvedValue(undefined);
  listContractsMock.mockResolvedValue({
    data: [otherContract],
    meta: { page: 1, per_page: 200, total: 1, total_pages: 1 },
  });
  listMattersMock.mockResolvedValue({
    data: [matter],
    meta: { page: 1, per_page: 25, total: 1, total_pages: 1 },
  });
  listMatterAuditMock.mockResolvedValue([]);
  listMatterRelatedMock.mockResolvedValue([]);
  listMatterDocumentsMock.mockResolvedValue([]);
  getObligationReminderPlanMock.mockResolvedValue({
    as_of: '2026-05-10T09:00:00Z',
    horizon_days: 30,
    total: 0,
    events: [],
  });
  usersListMock.mockResolvedValue({
    data: directoryUsers,
    meta: { page: 1, per_page: 200, total: directoryUsers.length, total_pages: 1 },
  });
});

describe('Lex matter detail', () => {
  it('renders matter metadata, linked contracts, and matter obligations', async () => {
    renderWithQuery(<LexMatterDetailPage />);

    expect(await screen.findByRole('heading', { name: 'Vendor termination dispute' })).toBeInTheDocument();
    expect(screen.getByText('LEX-M-2026-001')).toBeInTheDocument();
    expect(screen.getByText('Acme Master Services Agreement')).toBeInTheDocument();
    expect(await screen.findByText('Serve termination notice')).toBeInTheDocument();
    expect(getMatterMock).toHaveBeenCalledWith(MATTER_ID);
    expect(listMatterObligationsMock).toHaveBeenCalledWith(MATTER_ID, {
      page: 1,
      per_page: 50,
      order: 'asc',
    });
  });

  it('links a contract through the link dialog', async () => {
    renderWithQuery(<LexMatterDetailPage />);

    await screen.findByRole('heading', { name: 'Vendor termination dispute' });
    fireEvent.click(screen.getByRole('button', { name: /Link Contract/i }));

    const dialog = await screen.findByRole('dialog', { name: 'Link Contract' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Link Contract' }));

    await waitFor(() => {
      expect(linkMatterContractMock).toHaveBeenCalledWith(MATTER_ID, {
        contract_id: 'contract-10',
        relationship: 'primary',
      });
    });
    expect(showSuccessMock).toHaveBeenCalledWith('Contract linked.');
  }, 60000);

  it('unlinks a linked contract after confirmation', async () => {
    const user = userEvent.setup();
    renderWithQuery(<LexMatterDetailPage />);

    await screen.findByRole('heading', { name: 'Vendor termination dispute' });
    await user.click(screen.getByRole('button', { name: /Unlink/i }));

    const dialog = await screen.findByRole('alertdialog', { name: 'Unlink contract' });
    await user.click(within(dialog).getByRole('button', { name: 'Unlink' }));

    await waitFor(() => {
      expect(unlinkMatterContractMock).toHaveBeenCalledWith(MATTER_ID, CONTRACT_ID);
    });
    expect(showSuccessMock).toHaveBeenCalledWith('Contract unlinked.');
  }, 60000);

  it('triages the matter with the selected status and priority', async () => {
    const user = userEvent.setup();
    renderWithQuery(<LexMatterDetailPage />);

    await screen.findByRole('heading', { name: 'Vendor termination dispute' });
    // The at-risk SLA banner adds a second "Triage" quick-action alongside the
    // header action; both open the same dialog, so click the first (header) one.
    const triageButtons = screen.getAllByRole('button', { name: /Triage/i });
    await user.click(triageButtons[0]);

    const dialog = await screen.findByRole('dialog', { name: 'Triage Matter' });
    await user.click(within(dialog).getByRole('button', { name: 'Apply Triage' }));

    await waitFor(() => {
      expect(triageMatterMock).toHaveBeenCalledWith(
        MATTER_ID,
        expect.objectContaining({ status: 'open', priority: 'high' }),
      );
    });
    expect(showSuccessMock).toHaveBeenCalledWith('Matter triaged.');
  }, 60000);

  it('hides write actions when the user lacks lex:write', async () => {
    authState.canWrite = false;
    renderWithQuery(<LexMatterDetailPage />);

    await screen.findByRole('heading', { name: 'Vendor termination dispute' });
    expect(screen.queryByRole('button', { name: /Triage/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Link Contract/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Delete Matter/i })).not.toBeInTheDocument();
  });

  // §2 of LEX-SUPPORT-CONTEXT-AND-APPROVAL — the support action is mounted on
  // the record, and binds the composer to THIS matter. The assertion rides the
  // real seam: the button dispatches the composer's open event carrying the
  // context the header passed explicitly.
  it('binds the ask-for-support action to this matter', async () => {
    const user = userEvent.setup();
    const seen: unknown[] = [];
    const handler = (event: Event) => seen.push((event as CustomEvent).detail);
    window.addEventListener('clario360:lex-support:open', handler);

    try {
      renderWithQuery(<LexMatterDetailPage />);
      await screen.findByRole('heading', { name: 'Vendor termination dispute' });

      await user.click(screen.getByRole('button', { name: supportLabels.en.ask }));

      expect(seen).toEqual([{ subjectType: 'matter', subjectId: MATTER_ID }]);
    } finally {
      window.removeEventListener('clario360:lex-support:open', handler);
    }
  }, 60000);

  it('hides the ask-for-support action without lex:support:create', async () => {
    authState.canAskSupport = false;
    renderWithQuery(<LexMatterDetailPage />);

    await screen.findByRole('heading', { name: 'Vendor termination dispute' });
    expect(
      screen.queryByRole('button', { name: supportLabels.en.ask }),
    ).not.toBeInTheDocument();
  });

  it('renders the Arabic/RTL detail surface under the ar locale', async () => {
    const { container } = renderWithQuery(<LexMatterDetailPage />, { locale: 'ar' });

    expect(await screen.findByRole('heading', { name: 'Vendor termination dispute' })).toBeInTheDocument();
    expect(screen.getByText(matterLabelsBundle.ar.detail.overviewTitle)).toBeInTheDocument();
    expect(screen.getByText(matterLabelsBundle.ar.detail.obligationsTitle)).toBeInTheDocument();
    expect(container.querySelector('[dir="rtl"]')).not.toBeNull();
  });
});
