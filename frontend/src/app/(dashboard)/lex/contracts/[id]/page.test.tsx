import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import LexContractDetailPage from '@/app/(dashboard)/lex/contracts/[id]/page';
import { contractDetailLabels } from '@/app/(dashboard)/lex/contracts/_lib/contracts-labels';
import { supportLabels } from '@/app/(dashboard)/lex/inbox/_lib/support-i18n';
import type { LexContractDetail, LexContractRecord } from '@/types/suites';

const {
  authState,
  getContractMock,
  getContractBriefMock,
  listContractVersionsMock,
  listSignaturesMock,
  getContractTimelineMock,
} = vi.hoisted(() => ({
  authState: {
    permissions: new Set<string>(),
  },
  getContractMock: vi.fn(),
  getContractBriefMock: vi.fn(),
  listContractVersionsMock: vi.fn(),
  listSignaturesMock: vi.fn(),
  getContractTimelineMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/lex/contracts/contract-1',
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ id: 'contract-1' }),
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    hasPermission: (permission: string) => authState.permissions.has(permission),
    hasAnyPermission: (permissions: string[]) =>
      permissions.some((permission) => authState.permissions.has(permission)),
    isHydrated: true,
    isAuthenticated: true,
    user: { id: 'u-1' },
  }),
}));

vi.mock('@/lib/enterprise', async () => {
  const actual = await vi.importActual<typeof import('@/lib/enterprise')>('@/lib/enterprise');
  return {
    ...actual,
    enterpriseApi: {
      ...actual.enterpriseApi,
      lex: {
        ...actual.enterpriseApi.lex,
        getContract: getContractMock,
        getContractBrief: getContractBriefMock,
        listContractVersions: listContractVersionsMock,
        listSignatures: listSignaturesMock,
        getContractTimeline: getContractTimelineMock,
      },
    },
  };
});

const contract: LexContractRecord = {
  id: 'contract-1',
  tenant_id: 'tenant-1',
  title: 'Master Services Agreement',
  contract_number: 'LEX-2026-001',
  type: 'service_agreement',
  description: 'Primary commercial agreement.',
  party_a_name: 'Clario360 Ltd.',
  party_b_name: 'Acme Holdings',
  total_value: 125000,
  currency: 'SAR',
  auto_renew: false,
  renewal_notice_days: 30,
  status: 'active',
  owner_user_id: 'u-1',
  owner_name: 'Sara Owner',
  risk_level: 'medium',
  analysis_status: 'complete',
  document_text: '',
  current_version: 1,
  tags: ['msa'],
  metadata: {},
  created_by: 'u-1',
  created_at: '2026-06-01T09:00:00Z',
  updated_at: '2026-06-02T09:00:00Z',
} as unknown as LexContractRecord;

const detail: LexContractDetail = {
  contract,
  clauses: [],
  latest_analysis: null,
  version_count: 1,
};

beforeEach(() => {
  authState.permissions = new Set([
    'lex:contract:view',
    'lex:contract:add',
    'lex:contract:edit',
    'lex:contract:close',
  ]);
  getContractMock.mockReset();
  getContractBriefMock.mockReset();
  listContractVersionsMock.mockReset();
  listSignaturesMock.mockReset();
  getContractTimelineMock.mockReset();

  getContractMock.mockResolvedValue(detail);
  getContractBriefMock.mockResolvedValue(null);
  listContractVersionsMock.mockResolvedValue([]);
  listSignaturesMock.mockResolvedValue({
    data: [],
    meta: { page: 1, per_page: 5, total: 0, total_pages: 0 },
  });
  getContractTimelineMock.mockResolvedValue({ generated_at: '2026-06-02T09:00:00Z', events: [] });
});

describe('Lex contract detail', () => {
  it('renders the loaded English surface under the default locale', async () => {
    renderWithQuery(<LexContractDetailPage />);

    // The contract title becomes the page header once loaded.
    expect(await screen.findByText(contract.title)).toBeInTheDocument();
    // Localized lifecycle + action labels render.
    expect(screen.getByText(contractDetailLabels.en.stepper.title)).toBeInTheDocument();
    expect(screen.getByText(contractDetailLabels.en.lifecycleActions.title)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: contractDetailLabels.en.actions.runCompliance }),
    ).toBeInTheDocument();
  });

  it('renders the Arabic/RTL surface under the ar locale', async () => {
    renderWithQuery(<LexContractDetailPage />, { locale: 'ar' });

    expect(await screen.findByText(contract.title)).toBeInTheDocument();
    expect(screen.getByText(contractDetailLabels.ar.stepper.title)).toBeInTheDocument();
    expect(screen.getByText(contractDetailLabels.ar.lifecycleActions.title)).toBeInTheDocument();

    const rtlRoot = document.querySelector('[dir="rtl"][lang="ar"]');
    expect(rtlRoot).not.toBeNull();
  });

  it('lets an add-only creator start review without exposing edit or status approval', async () => {
    authState.permissions = new Set(['lex:contract:view', 'lex:contract:add']);
    getContractMock.mockResolvedValue({
      ...detail,
      contract: { ...contract, status: 'draft' },
    });

    renderWithQuery(<LexContractDetailPage />);

    expect(await screen.findByText(contract.title)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: contractDetailLabels.en.lifecycleActions.startReview }),
    ).toBeEnabled();
    expect(
      screen.getByRole('button', { name: contractDetailLabels.en.lifecycleActions.changeStatus }),
    ).toBeDisabled();
    expect(
      screen.queryByRole('button', { name: contractDetailLabels.en.actions.edit }),
    ).not.toBeInTheDocument();
  });

  it('does not offer review submission to an add-only viewer of another user draft', async () => {
    authState.permissions = new Set(['lex:contract:view', 'lex:contract:add']);
    getContractMock.mockResolvedValue({
      ...detail,
      contract: { ...contract, status: 'draft', created_by: 'u-2' },
    });

    renderWithQuery(<LexContractDetailPage />);

    expect(await screen.findByText(contract.title)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: contractDetailLabels.en.lifecycleActions.startReview }),
    ).toBeDisabled();
  });

  it('links to the participant workflow route and direct prefilled signature creation', async () => {
    const user = userEvent.setup();
    const workflowId = 'workflow-123';
    getContractMock.mockResolvedValue({
      ...detail,
      contract: { ...contract, workflow_instance_id: workflowId },
    });

    renderWithQuery(<LexContractDetailPage />);
    expect(await screen.findByText(contract.title)).toBeInTheDocument();

    const signatureLink = screen.getByRole('link', {
      name: contractDetailLabels.en.lifecycleActions.signatureQueue,
    });
    expect(signatureLink).toHaveAttribute(
      'href',
      '/lex/signatures?create=1&contract_id=contract-1',
    );

    await user.click(screen.getByRole('tab', { name: contractDetailLabels.en.tabs.workflow }));
    expect(await screen.findByRole('link', { name: new RegExp(workflowId) })).toHaveAttribute(
      'href',
      `/workflows/${workflowId}`,
    );
  });

  // §2 of LEX-SUPPORT-CONTEXT-AND-APPROVAL — the support action is mounted on
  // the record and binds the composer to THIS contract. The assertion rides the
  // real seam: the button dispatches the composer's open event carrying the
  // context the header passed explicitly, which is what makes the nested
  // lifecycle routes bind correctly too.
  it('binds the ask-for-support action to this contract', async () => {
    authState.permissions.add('lex:support:create');
    const user = userEvent.setup();
    const seen: unknown[] = [];
    const handler = (event: Event) => seen.push((event as CustomEvent).detail);
    window.addEventListener('clario360:lex-support:open', handler);

    try {
      renderWithQuery(<LexContractDetailPage />);
      expect(await screen.findByText(contract.title)).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: supportLabels.en.ask }));

      expect(seen).toEqual([{ subjectType: 'contract', subjectId: 'contract-1' }]);
    } finally {
      window.removeEventListener('clario360:lex-support:open', handler);
    }
  });

  it('hides the ask-for-support action without lex:support:create', async () => {
    renderWithQuery(<LexContractDetailPage />);

    expect(await screen.findByText(contract.title)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: supportLabels.en.ask }),
    ).not.toBeInTheDocument();
  });

  it('does not offer generic activation while a contract is pending signature', async () => {
    const user = userEvent.setup();
    getContractMock.mockResolvedValue({
      ...detail,
      contract: { ...contract, status: 'pending_signature', signed_date: null },
    });

    renderWithQuery(<LexContractDetailPage />);
    expect(await screen.findByText(contract.title)).toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: contractDetailLabels.en.lifecycleActions.changeStatus }),
    );

    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('Cancelled')).toBeInTheDocument();
    expect(within(dialog).queryByText('Active')).not.toBeInTheDocument();
  });
});
