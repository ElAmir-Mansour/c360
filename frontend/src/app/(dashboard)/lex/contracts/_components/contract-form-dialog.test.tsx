import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import { ContractFormDialog } from '@/app/(dashboard)/lex/contracts/_components/contract-form-dialog';
import { contractFormLabels } from '@/app/(dashboard)/lex/contracts/_lib/contracts-labels';

/** owner_user_id is validated as a real UUID by lexContractSchema. */
const TEST_USER_ID = '11111111-1111-4111-8111-111111111111';

const {
  usersListMock,
  listRequestsMock,
  createContractMock,
  filesUploadMock,
  uploadAttachmentMock,
  showApiErrorMock,
  showSuccessMock,
  showWarningMock,
} = vi.hoisted(() => ({
  usersListMock: vi.fn(),
  listRequestsMock: vi.fn(),
  createContractMock: vi.fn(),
  filesUploadMock: vi.fn(),
  uploadAttachmentMock: vi.fn(),
  showApiErrorMock: vi.fn(),
  showSuccessMock: vi.fn(),
  showWarningMock: vi.fn(),
}));

vi.mock('@/lib/toast', () => ({
  showApiError: showApiErrorMock,
  showSuccess: showSuccessMock,
  showWarning: showWarningMock,
}));

vi.mock(
  '@/app/(dashboard)/lex/contracts/[id]/_components/review-desk/review-desk-api',
  () => ({ reviewDeskApi: { uploadAttachment: uploadAttachmentMock } }),
);

// Document text extraction pulls in pdfjs, which cannot resolve its worker under
// jsdom. The extraction itself is not what these tests exercise.
vi.mock('@/lib/documents/word', () => ({
  prefillExtractedTextFromFile: vi.fn().mockResolvedValue(undefined),
  resolveUploadExtractedText: vi.fn().mockResolvedValue(''),
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ hasPermission: () => true, isHydrated: true, user: { id: TEST_USER_ID } }),
}));

vi.mock('@/lib/lex/requests', () => ({
  lexRequestsApi: { listRequests: listRequestsMock },
}));

vi.mock('@/lib/enterprise', async () => {
  const actual = await vi.importActual<typeof import('@/lib/enterprise')>('@/lib/enterprise');
  return {
    ...actual,
    enterpriseApi: {
      ...actual.enterpriseApi,
      users: {
        ...actual.enterpriseApi.users,
        list: usersListMock,
      },
      files: {
        ...actual.enterpriseApi.files,
        upload: filesUploadMock,
      },
      lex: {
        ...actual.enterpriseApi.lex,
        createContract: createContractMock,
      },
    },
  };
});

beforeEach(() => {
  usersListMock.mockReset();
  usersListMock.mockResolvedValue({
    data: [{ id: TEST_USER_ID, email: 'sara@clario.dev', first_name: 'Sara', last_name: 'Owner' }],
    meta: { page: 1, per_page: 200, total: 1, total_pages: 1 },
  });
  listRequestsMock.mockReset();
  listRequestsMock.mockResolvedValue({
    data: [],
    meta: { page: 1, per_page: 100, total: 0, total_pages: 0 },
  });
  createContractMock.mockReset();
  createContractMock.mockResolvedValue({ id: 'contract-1', title: 'Vendor Agreement' });
  filesUploadMock.mockReset();
  filesUploadMock.mockResolvedValue({
    id: 'file-1',
    original_name: 'draft.pdf',
    size_bytes: 12,
    checksum_sha256: 'abc',
  });
  uploadAttachmentMock.mockReset();
  uploadAttachmentMock.mockResolvedValue({ id: 'att-1' });
  showApiErrorMock.mockReset();
  showSuccessMock.mockReset();
  showWarningMock.mockReset();
});

describe('ContractFormDialog', () => {
  it('renders the create form in English under the default locale', async () => {
    renderWithQuery(<ContractFormDialog open onOpenChange={vi.fn()} />);

    expect(await screen.findByText(contractFormLabels.en.createTitle)).toBeInTheDocument();
    expect(screen.getByText(contractFormLabels.en.createDescription)).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(contractFormLabels.en.fields.titlePlaceholder),
    ).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: contractFormLabels.en.fields.sourceRequest })).toBeInTheDocument();
    // The submit action renders.
    expect(screen.getByRole('button', { name: contractFormLabels.en.create })).toBeInTheDocument();
  });

  it('renders the create form in Arabic under the ar locale', async () => {
    renderWithQuery(<ContractFormDialog open onOpenChange={vi.fn()} />, { locale: 'ar' });

    expect(await screen.findByText(contractFormLabels.ar.createTitle)).toBeInTheDocument();
    expect(screen.getByText(contractFormLabels.ar.createDescription)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: contractFormLabels.ar.create })).toBeInTheDocument();

    const rtlContent = document.querySelector('[dir="rtl"][lang="ar"]');
    expect(rtlContent).not.toBeNull();
  });

  /**
   * REGRESSION (feedback item 2, "contract creation still showing error").
   *
   * The initial document is stored by `POST /lex/contracts` itself (as contract
   * version 1). Copying it into the review desk's `draft` slot afterwards is a
   * SECONDARY step on a coarser permission tier (`lex:write`, while creating a
   * contract only needs `lex:contract:add`) — so roles like legal-requester get
   * a legitimate 403 there. Letting that reject the mutation reported the whole
   * creation as failed even though the contract existed, and because
   * `POST /contracts` is not idempotent every retry then hit a permanent 409.
   */
  it('reports a created contract as created when only the review-desk copy fails', async () => {
    const user = userEvent.setup();
    uploadAttachmentMock.mockRejectedValue(
      Object.assign(new Error('forbidden'), { status: 403 }),
    );
    const onOpenChange = vi.fn();
    const onSaved = vi.fn();

    renderWithQuery(
      <ContractFormDialog open onOpenChange={onOpenChange} onSaved={onSaved} />,
    );

    await screen.findByText(contractFormLabels.en.createTitle);
    await user.type(
      screen.getByPlaceholderText(contractFormLabels.en.fields.titlePlaceholder),
      'Vendor Agreement',
    );
    await user.type(
      screen.getByPlaceholderText(contractFormLabels.en.fields.contractNumberPlaceholder),
      'CNT-2026-001',
    );
    await user.type(
      screen.getByPlaceholderText(contractFormLabels.en.fields.descriptionPlaceholder),
      'Annual vendor services agreement.',
    );
    await user.type(
      screen.getByPlaceholderText(contractFormLabels.en.fields.partyAPlaceholder),
      'Al Othaim',
    );
    await user.type(
      screen.getByPlaceholderText(contractFormLabels.en.fields.counterpartyPlaceholder),
      'Vendor Co',
    );
    await user.type(
      screen.getByPlaceholderText(
        contractFormLabels.en.fields.requestingDepartmentPlaceholder,
      ),
      'Procurement',
    );
    await user.upload(
      document.getElementById('initial_document') as HTMLInputElement,
      new File(['draft'], 'draft.pdf', { type: 'application/pdf' }),
    );

    await user.click(screen.getByRole('button', { name: contractFormLabels.en.create }));

    // The creation succeeded: the dialog closes, the caller is notified, and the
    // user is warned about the skipped copy rather than shown a failure.
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(createContractMock).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(showApiErrorMock).not.toHaveBeenCalled();
    expect(showWarningMock).toHaveBeenCalledWith(
      contractFormLabels.en.toast.attachmentSkippedTitle,
      contractFormLabels.en.toast.attachmentSkippedDescription,
    );
  });

  /**
   * The renewal date is a function of the expiry date and the notice period, so
   * the user should not have to work it out — it used to be left blank, which
   * left every downstream renewal surface reading "Not set".
   */
  it('calculates the renewal date from the expiry date and the notice period', async () => {
    const user = userEvent.setup();
    renderWithQuery(<ContractFormDialog open onOpenChange={vi.fn()} />);

    await screen.findByText(contractFormLabels.en.createTitle);
    const renewalDate = document.getElementById('renewal_date') as HTMLInputElement;
    expect(renewalDate.value).toBe('');

    // Notice defaults to 30 days, so a 3 Aug 2027 expiry renews on 4 Jul 2027.
    await user.type(
      document.getElementById('expiry_date') as HTMLInputElement,
      '2027-08-03T00:00',
    );
    await waitFor(() => expect(renewalDate.value).toBe('2027-07-04T00:00'));

    // Changing the notice period moves the renewal date with it.
    const noticeDays = document.getElementById('renewal_notice_days') as HTMLInputElement;
    await user.clear(noticeDays);
    await user.type(noticeDays, '60');
    await waitFor(() => expect(renewalDate.value).toBe('2027-06-04T00:00'));
  });

  it('stops recalculating once the user enters their own renewal date', async () => {
    const user = userEvent.setup();
    renderWithQuery(<ContractFormDialog open onOpenChange={vi.fn()} />);

    await screen.findByText(contractFormLabels.en.createTitle);
    const renewalDate = document.getElementById('renewal_date') as HTMLInputElement;
    await user.type(
      document.getElementById('expiry_date') as HTMLInputElement,
      '2027-08-03T00:00',
    );
    await waitFor(() => expect(renewalDate.value).toBe('2027-07-04T00:00'));

    await user.clear(renewalDate);
    await user.type(renewalDate, '2027-05-01T00:00');

    const noticeDays = document.getElementById('renewal_notice_days') as HTMLInputElement;
    await user.clear(noticeDays);
    await user.type(noticeDays, '90');

    // The manual date survives a change to the inputs it was derived from.
    await waitFor(() => expect(noticeDays.value).toBe('90'));
    expect(renewalDate.value).toBe('2027-05-01T00:00');
  });
});
