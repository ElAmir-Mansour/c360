import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import type {
  LexContractRecord,
  LexRenderedSignatureText,
  LexSignatureEnvelope,
} from '@/types/suites';

const ENVELOPE_ID = 'env-1';
const RECIPIENT_ID = 'rcp-1';

const {
  authState,
  searchParamsState,
  listSignaturesMock,
  listContractsMock,
  getContractMock,
  listFilesMock,
  getSignatureMock,
  createSignatureMock,
  recordSignatureRecipientActionMock,
  recordSignatureCustodyMock,
  recordSignatureProviderEventMock,
  getSignatureRecipientRenderingMock,
  sendSignatureMock,
  cancelSignatureMock,
  showApiErrorMock,
  showSuccessMock,
} = vi.hoisted(() => ({
  authState: { canWrite: true },
  searchParamsState: { value: new URLSearchParams() },
  listSignaturesMock: vi.fn(),
  listContractsMock: vi.fn(),
  getContractMock: vi.fn(),
  listFilesMock: vi.fn(),
  getSignatureMock: vi.fn(),
  createSignatureMock: vi.fn(),
  recordSignatureRecipientActionMock: vi.fn(),
  recordSignatureCustodyMock: vi.fn(),
  recordSignatureProviderEventMock: vi.fn(),
  getSignatureRecipientRenderingMock: vi.fn(),
  sendSignatureMock: vi.fn(),
  cancelSignatureMock: vi.fn(),
  showApiErrorMock: vi.fn(),
  showSuccessMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => '/lex/signatures',
  useSearchParams: () => searchParamsState.value,
  useParams: () => ({}),
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    // Signatures are contract execution (RBAC §9): the page guard reads
    // lex:contract:view (always granted here) and write controls gate on
    // lex:contract:edit (follows authState.canWrite).
    hasPermission: (permission: string) =>
      permission === 'lex:contract:edit' ? authState.canWrite : true,
    isHydrated: true,
    isAuthenticated: true,
    user: { id: 'user-1' },
  }),
}));

vi.mock('@/lib/toast', () => ({
  showSuccess: showSuccessMock,
  showApiError: showApiErrorMock,
}));

vi.mock('@/components/shared/forms/tenant-user-picker', () => ({
  TenantUserPicker: ({
    ariaLabel,
    onChange,
    value,
  }: {
    ariaLabel: string;
    onChange: (userId: string, option?: { value: string; label: string; description?: string }) => void;
    value: string;
  }) => (
    <input
      type="button"
      aria-label={ariaLabel}
      value={value ? 'Mariam Manager — manager@almashura.demo' : 'Select internal user'}
      onClick={() =>
        onChange(
          value ? '' : 'manager-user-id',
          value
            ? undefined
            : {
                value: 'manager-user-id',
                label: 'Mariam Manager',
                description: 'manager@almashura.demo',
              },
        )
      }
    />
  ),
}));

vi.mock('@/lib/enterprise', async () => {
  const actual = await vi.importActual<typeof import('@/lib/enterprise')>('@/lib/enterprise');
  return {
    ...actual,
    enterpriseApi: {
      ...actual.enterpriseApi,
      files: {
        ...actual.enterpriseApi.files,
        list: listFilesMock,
      },
      lex: {
        ...actual.enterpriseApi.lex,
        listSignatures: listSignaturesMock,
        listContracts: listContractsMock,
        getContract: getContractMock,
        getSignature: getSignatureMock,
        createSignature: createSignatureMock,
        recordSignatureRecipientAction: recordSignatureRecipientActionMock,
        recordSignatureCustody: recordSignatureCustodyMock,
        recordSignatureProviderEvent: recordSignatureProviderEventMock,
        getSignatureRecipientRendering: getSignatureRecipientRenderingMock,
        sendSignature: sendSignatureMock,
        cancelSignature: cancelSignatureMock,
      },
    },
  };
});

import LexSignaturesPage from '@/app/(dashboard)/lex/signatures/page';

const envelope: LexSignatureEnvelope = {
  id: ENVELOPE_ID,
  tenant_id: 'tenant-1',
  target_type: 'contract',
  contract_id: 'contract-9',
  contract_title: 'Master Services Agreement',
  contract_number: 'LEX-2026-001',
  title: 'MSA — signature',
  subject: 'Please sign the MSA',
  message: 'Kindly apply your signature.',
  language: 'bilingual',
  provider: 'native',
  method: 'otp',
  status: 'sent',
  recipient_count: 1,
  signed_count: 0,
  due_at: null,
  expires_at: null,
  sent_at: '2026-06-10T09:00:00Z',
  completed_at: null,
  evidence_metadata: {},
  recipients: [
    {
      id: RECIPIENT_ID,
      envelope_id: ENVELOPE_ID,
      name: 'Layla Al-Harbi',
      email: 'layla@counterparty.com',
      role: 'Authorised signatory',
      signing_order: 1,
      status: 'sent',
      provider: 'native',
      method: 'otp',
      evidence_metadata: {},
      created_at: '2026-06-10T09:00:00Z',
      updated_at: '2026-06-10T09:00:00Z',
    },
  ],
  events: [],
  custody_evidence: [],
  created_by: 'user-1',
  created_at: '2026-06-10T09:00:00Z',
  updated_at: '2026-06-10T09:00:00Z',
};

const contract: LexContractRecord = {
  id: 'contract-9',
  tenant_id: 'tenant-1',
  title: 'Master Services Agreement',
  contract_number: 'LEX-2026-001',
  type: 'service_agreement',
  description: 'Supplier master services contract',
  party_a_name: 'Apex Bank',
  party_b_name: 'Layla Holdings',
  currency: 'SAR',
  auto_renew: false,
  renewal_notice_days: 30,
  status: 'pending_signature',
  owner_user_id: 'user-1',
  owner_name: 'Ada Okafor',
  risk_level: 'low',
  analysis_status: 'completed',
  document_text: '',
  current_version: 1,
  tags: [],
  metadata: {},
  created_by: 'user-1',
  created_at: '2026-07-01T00:00:00Z',
  updated_at: '2026-07-02T00:00:00Z',
};

const rendering: LexRenderedSignatureText = {
  language: 'bilingual',
  primary: {
    language: 'en',
    subject: 'Please sign the MSA',
    message: 'Kindly apply your signature.',
    legal_consent: 'I consent to sign electronically.',
  },
  secondary: {
    language: 'ar',
    subject: 'يرجى التوقيع',
    message: 'يرجى التوقيع إلكترونيًا.',
    legal_consent: 'أوافق على التوقيع إلكترونيًا.',
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  authState.canWrite = true;
  searchParamsState.value = new URLSearchParams();
  listSignaturesMock.mockResolvedValue({
    data: [envelope],
    meta: { page: 1, per_page: 25, total: 1, total_pages: 1 },
  });
  listContractsMock.mockResolvedValue({
    data: [contract],
    meta: { page: 1, per_page: 12, total: 1, total_pages: 1 },
  });
  getContractMock.mockResolvedValue({
    contract,
    clauses: [],
    latest_analysis: null,
    version_count: 1,
  });
  listFilesMock.mockResolvedValue({
    data: [
      {
        id: 'file-7',
        original_name: 'msa-signed.pdf',
        name: 'msa-signed.pdf',
        entity_type: 'signature',
        status: 'available',
        size_bytes: 20480,
        checksum_sha256: 'sha-content',
      },
    ],
    meta: { page: 1, per_page: 100, total: 1, total_pages: 1 },
  });
  getSignatureMock.mockResolvedValue(envelope);
  createSignatureMock.mockResolvedValue({ ...envelope, id: 'env-new', status: 'draft' });
  recordSignatureRecipientActionMock.mockResolvedValue(envelope);
  recordSignatureCustodyMock.mockResolvedValue(envelope);
  recordSignatureProviderEventMock.mockResolvedValue(envelope);
  getSignatureRecipientRenderingMock.mockResolvedValue(rendering);
});

// The shared DataTable renders both a desktop table and a mobile card view
// (toggled purely by CSS), so each row cell appears twice in jsdom. Resolve the
// first matching detail trigger to act on the row deterministically.
async function findFirstOpenTrigger(): Promise<HTMLElement> {
  const triggers = await screen.findAllByRole('button', { name: /Open signature envelope MSA/i });
  return triggers[0];
}

describe('Lex signature envelope console', () => {
  it('creates an envelope through createSignature with ordered recipients', async () => {
    const user = userEvent.setup();
    renderWithQuery(<LexSignaturesPage />);

    await user.click(await screen.findByRole('button', { name: /New Envelope/i }));

    const dialog = await screen.findByRole('dialog');
    await user.click(await within(dialog).findByRole('button', { name: /Master Services Agreement/i }));
    await user.type(within(dialog).getByPlaceholderText(/Master Services Agreement — signature/i), 'MSA — signature');
    await user.type(within(dialog).getByPlaceholderText('Layla Al-Harbi'), 'Layla Al-Harbi');

    await user.click(within(dialog).getByRole('button', { name: /Create envelope/i }));

    await waitFor(() => {
      expect(createSignatureMock).toHaveBeenCalledTimes(1);
    });
    const payload = createSignatureMock.mock.calls[0][0];
    expect(payload.contract_id).toBe('contract-9');
    expect(payload.title).toBe('MSA — signature');
    expect(payload.recipients).toHaveLength(1);
    expect(payload.recipients[0]).toMatchObject({ name: 'Layla Al-Harbi', signing_order: 1 });
  });

  it('opens a contract-prefilled creation flow and binds an internal signer by user ID', async () => {
    searchParamsState.value = new URLSearchParams('create=1&contract_id=contract-9');
    const user = userEvent.setup();

    renderWithQuery(<LexSignaturesPage />);

    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(getContractMock).toHaveBeenCalledWith('contract-9'));
    expect((await within(dialog).findAllByText('Master Services Agreement')).length).toBeGreaterThan(0);

    await user.type(
      within(dialog).getByPlaceholderText(/Master Services Agreement — signature/i),
      'MSA — manager signature',
    );
    await user.click(within(dialog).getByRole('button', { name: /Internal platform user/i }));
    await user.click(within(dialog).getByRole('button', { name: /Create envelope/i }));

    await waitFor(() => expect(createSignatureMock).toHaveBeenCalledTimes(1));
    expect(createSignatureMock.mock.calls[0][0]).toMatchObject({
      contract_id: 'contract-9',
      title: 'MSA — manager signature',
      recipients: [
        expect.objectContaining({
          user_id: 'manager-user-id',
          name: 'Mariam Manager',
          email: 'manager@almashura.demo',
          signing_order: 1,
        }),
      ],
    });
  });

  it('opens the detail sheet and records a recipient action through the Lex client', async () => {
    const user = userEvent.setup();
    renderWithQuery(<LexSignaturesPage />);

    await user.click(await findFirstOpenTrigger());

    await waitFor(() => {
      expect(getSignatureMock).toHaveBeenCalledWith(ENVELOPE_ID);
    });

    expect((await screen.findAllByText('Layla Al-Harbi')).length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: /^Record action$/i }));

    const actionDialog = await screen.findByRole('dialog', { name: /Record action — Layla Al-Harbi/i });
    await user.click(within(actionDialog).getByRole('button', { name: /^Record action$/i }));

    await waitFor(() => {
      expect(recordSignatureRecipientActionMock).toHaveBeenCalledTimes(1);
    });
    expect(recordSignatureRecipientActionMock).toHaveBeenCalledWith(
      ENVELOPE_ID,
      expect.objectContaining({ recipient_id: RECIPIENT_ID, action: 'sign' }),
    );
  });

  it('records custody evidence through recordSignatureCustody', async () => {
    const user = userEvent.setup();
    renderWithQuery(<LexSignaturesPage />);

    await user.click(await findFirstOpenTrigger());
    await waitFor(() => expect(getSignatureMock).toHaveBeenCalledWith(ENVELOPE_ID));

    await user.click(await screen.findByRole('button', { name: /Record custody/i }));

    const custodyDialog = await screen.findByRole('dialog', { name: /Record custody evidence/i });
    await user.click(within(custodyDialog).getByRole('combobox', { name: /Stored signed artefact/i }));
    await user.click(await screen.findByRole('option', { name: /msa-signed\.pdf/i }));

    await user.click(within(custodyDialog).getByRole('button', { name: /^Record custody$/i }));

    await waitFor(() => {
      expect(recordSignatureCustodyMock).toHaveBeenCalledTimes(1);
    });
    expect(recordSignatureCustodyMock).toHaveBeenCalledWith(
      ENVELOPE_ID,
      expect.objectContaining({
        file_id: 'file-7',
        file_name: 'msa-signed.pdf',
        file_size_bytes: 20480,
        content_hash: 'sha-content',
      }),
    );
  });

  it('renders the recipient signing view from getSignatureRecipientRendering', async () => {
    const user = userEvent.setup();
    renderWithQuery(<LexSignaturesPage />);

    await user.click(await findFirstOpenTrigger());
    await waitFor(() => expect(getSignatureMock).toHaveBeenCalledWith(ENVELOPE_ID));

    await user.click(await screen.findByRole('button', { name: /View rendering/i }));

    await waitFor(() => {
      expect(getSignatureRecipientRenderingMock).toHaveBeenCalledWith(ENVELOPE_ID, RECIPIENT_ID);
    });
    expect(await screen.findByText('I consent to sign electronically.')).toBeInTheDocument();
  });

  it('hides write actions when the user lacks lex:write', async () => {
    authState.canWrite = false;
    renderWithQuery(<LexSignaturesPage />);

    expect((await screen.findAllByText('MSA — signature')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /New Envelope/i })).not.toBeInTheDocument();
  });

  it('renders the localized Arabic signatures surface in RTL under locale "ar"', async () => {
    const { container } = renderWithQuery(<LexSignaturesPage />, { locale: 'ar' });

    expect(await screen.findByRole('heading', { name: 'مظاريف التوقيع' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'مظروف جديد' })).toBeInTheDocument();
    expect(container.querySelector('div[dir="rtl"][lang="ar"]')).not.toBeNull();
  });
});
