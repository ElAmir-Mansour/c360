import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import { ContractDraftingWorkspace } from '@/app/(dashboard)/lex/contracts/new/_components/contract-drafting-workspace';

const {
  createContractMock,
  startContractReviewMock,
  listRequestsMock,
  routerPushMock,
  showApiErrorMock,
} = vi.hoisted(() => ({
  createContractMock: vi.fn(),
  startContractReviewMock: vi.fn(),
  listRequestsMock: vi.fn(),
  routerPushMock: vi.fn(),
  showApiErrorMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPushMock, replace: vi.fn(), back: vi.fn() }),
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    hasPermission: () => true,
    hasAnyPermission: () => true,
    isHydrated: true,
    user: { id: 'u-1', email: 'sara@clario.dev', first_name: 'Sara', last_name: 'Owner' },
  }),
}));

vi.mock('@/lib/lex/requests', () => ({
  lexRequestsApi: { listRequests: listRequestsMock },
}));

vi.mock('@/lib/toast', () => ({
  showApiError: showApiErrorMock,
  showSuccess: vi.fn(),
}));

vi.mock('@/lib/enterprise', async () => {
  const actual = await vi.importActual<typeof import('@/lib/enterprise')>('@/lib/enterprise');
  return {
    ...actual,
    enterpriseApi: {
      ...actual.enterpriseApi,
      lex: {
        ...actual.enterpriseApi.lex,
        createContract: createContractMock,
        startContractReview: startContractReviewMock,
      },
    },
  };
});

beforeEach(() => {
  createContractMock.mockReset();
  startContractReviewMock.mockReset();
  routerPushMock.mockReset();
  showApiErrorMock.mockReset();
  listRequestsMock.mockReset();
  listRequestsMock.mockResolvedValue({
    data: [],
    meta: { page: 1, per_page: 100, total: 0, total_pages: 0 },
  });
});

/**
 * Drive the five-step wizard to the final "Review & Submit" step with the
 * minimum set of fields each step's `canAdvance()` gate requires.
 */
async function fillWizardToFinalStep(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText(/Contract Title/), 'Technology Services Agreement');
  await user.type(screen.getByLabelText(/Contract ID/), 'CNT-2026-001');
  await user.click(screen.getByRole('button', { name: /Next Step/ }));

  const legalNames = await screen.findAllByLabelText(/Legal Name/);
  await user.type(legalNames[0], 'Abdullah Al Othaim Investment');
  await user.type(legalNames[1], 'Vendor Co');
  await user.click(screen.getByRole('button', { name: /Next Step/ }));

  await user.type(await screen.findByLabelText(/Start Date/), '2026-01-01T09:00');
  await user.type(screen.getByLabelText(/End Date/), '2026-12-31T09:00');
  await user.click(screen.getByRole('button', { name: /Next Step/ }));

  await user.click(await screen.findByRole('button', { name: /Next Step/ }));

  return screen.findByRole('button', { name: /Submit for Approval/ });
}

describe('ContractDraftingWorkspace — create + submit-for-review recovery', () => {
  /**
   * REGRESSION (feedback item 2, "contract creation still showing error").
   *
   * `POST /lex/contracts` is NOT idempotent: `contract_number` is unique per
   * tenant and an approved source request can only be consumed once. The wizard
   * creates the contract and then starts the review in a single mutation, so a
   * failure in the SECOND call used to leave a real contract row behind while
   * reporting an error — and every retry re-POSTed the same draft, which the
   * backend answers with a permanent 409. The user is then stuck on an error
   * they can never clear.
   */
  it('does not re-create the contract when the review step fails and the user retries', async () => {
    const user = userEvent.setup();
    createContractMock.mockResolvedValue({ id: 'contract-1', title: 'Technology Services Agreement' });
    startContractReviewMock.mockRejectedValue(
      Object.assign(new Error('workflow repositories are not configured'), { status: 500 }),
    );

    renderWithQuery(<ContractDraftingWorkspace />);
    const submit = await fillWizardToFinalStep(user);

    await user.click(submit);
    await waitFor(() => expect(showApiErrorMock).toHaveBeenCalledTimes(1));
    expect(createContractMock).toHaveBeenCalledTimes(1);
    expect(startContractReviewMock).toHaveBeenCalledTimes(1);

    // Retry: only the failed review step may run again. A second POST /contracts
    // would 409 on the duplicate contract number and strand the user for good.
    await user.click(await screen.findByRole('button', { name: /Submit for Approval/ }));
    await waitFor(() => expect(startContractReviewMock).toHaveBeenCalledTimes(2));
    expect(createContractMock).toHaveBeenCalledTimes(1);
    expect(startContractReviewMock).toHaveBeenLastCalledWith('contract-1', expect.anything());
  });

  it('tells the user the contract was saved when only the review step failed', async () => {
    const user = userEvent.setup();
    createContractMock.mockResolvedValue({ id: 'contract-1', title: 'Technology Services Agreement' });
    startContractReviewMock.mockRejectedValue(new Error('boom'));

    renderWithQuery(<ContractDraftingWorkspace />);
    const submit = await fillWizardToFinalStep(user);
    await user.click(submit);

    const notice = await screen.findByRole('status');
    expect(notice).toHaveTextContent(/saved/i);
    expect(screen.getByRole('link', { name: /Open the saved draft/i })).toHaveAttribute(
      'href',
      '/lex/contracts/contract-1/draft',
    );
  });

  it('recovers once the review step succeeds on retry', async () => {
    const user = userEvent.setup();
    createContractMock.mockResolvedValue({ id: 'contract-1', title: 'Technology Services Agreement' });
    startContractReviewMock
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ workflow_instance_id: 'wf-1' });

    renderWithQuery(<ContractDraftingWorkspace />);
    const submit = await fillWizardToFinalStep(user);

    await user.click(submit);
    await waitFor(() => expect(showApiErrorMock).toHaveBeenCalledTimes(1));

    await user.click(await screen.findByRole('button', { name: /Submit for Approval/ }));
    await waitFor(() =>
      expect(routerPushMock).toHaveBeenCalledWith('/lex/contracts/contract-1/approval'),
    );
    expect(createContractMock).toHaveBeenCalledTimes(1);
  });
});

/**
 * Drive the wizard to the "Terms & Clauses" step, where the Clause Library and
 * the Custom Clause control live.
 */
async function goToTermsStep(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText(/Contract Title/), 'Technology Services Agreement');
  await user.type(screen.getByLabelText(/Contract ID/), 'CNT-2026-001');
  await user.click(screen.getByRole('button', { name: /Next Step/ }));

  const legalNames = await screen.findAllByLabelText(/Legal Name/);
  await user.type(legalNames[0], 'Abdullah Al Othaim Investment');
  await user.type(legalNames[1], 'Vendor Co');
  await user.click(screen.getByRole('button', { name: /Next Step/ }));

  // Step 2 is "Terms & Clauses" — it carries the dates AND the Clause Library.
  // Fill the dates here (the step's advance gate needs them) but stay put.
  await user.type(await screen.findByLabelText(/Start Date/), '2026-01-01T09:00');
  await user.type(screen.getByLabelText(/End Date/), '2026-12-31T09:00');

  return screen.findByTestId('add-custom-clause');
}

/**
 * REGRESSION: "Adding Custom Clause is not working."
 *
 * The Custom Clause button carried NO onClick at all — it was inert chrome.
 * Beyond the missing handler, `selectedClauses` filtered the static CLAUSES
 * constant, so even once a custom clause existed it would have been dropped
 * from the live preview and from the risk indicator.
 */
describe('ContractDraftingWorkspace — custom clauses', () => {
  it('opens the composer when Custom Clause is clicked', async () => {
    const user = userEvent.setup();
    renderWithQuery(<ContractDraftingWorkspace />);
    const addButton = await goToTermsStep(user);

    expect(screen.queryByLabelText(/Clause title/)).not.toBeInTheDocument();
    await user.click(addButton);
    expect(await screen.findByLabelText(/Clause title/)).toBeVisible();
  });

  it('adds the clause, selects it, and shows it in the live preview', async () => {
    const user = userEvent.setup();
    renderWithQuery(<ContractDraftingWorkspace />);
    const addButton = await goToTermsStep(user);

    await user.click(addButton);
    await user.type(await screen.findByLabelText(/Clause title/), 'Data Protection');
    await user.click(screen.getByRole('button', { name: /^Add$/ }));

    // Present in the library, ticked by default, and mirrored into the preview
    // (which is what proves selectedClauses no longer filters only CLAUSES).
    const checkbox = await screen.findByRole('checkbox', { name: /Data Protection/ });
    expect(checkbox).toBeChecked();
    expect(screen.getAllByText('Data Protection').length).toBeGreaterThan(1);

    // Composer closes and resets after a successful add.
    expect(screen.queryByLabelText(/Clause title/)).not.toBeInTheDocument();
  });

  it('rejects a duplicate title instead of creating an indistinguishable clause', async () => {
    const user = userEvent.setup();
    renderWithQuery(<ContractDraftingWorkspace />);
    const addButton = await goToTermsStep(user);

    await user.click(addButton);
    await user.type(await screen.findByLabelText(/Clause title/), 'Confidentiality');

    expect(await screen.findByText(/already exists/i)).toBeVisible();
    expect(screen.getByRole('button', { name: /^Add$/ })).toBeDisabled();
  });

  it('removes a custom clause without disturbing the built-in library', async () => {
    const user = userEvent.setup();
    renderWithQuery(<ContractDraftingWorkspace />);
    const addButton = await goToTermsStep(user);

    await user.click(addButton);
    await user.type(await screen.findByLabelText(/Clause title/), 'Data Protection');
    await user.click(screen.getByRole('button', { name: /^Add$/ }));
    await screen.findByRole('checkbox', { name: /Data Protection/ });

    await user.click(screen.getByRole('button', { name: /Remove clause Data Protection/ }));

    await waitFor(() =>
      expect(screen.queryByRole('checkbox', { name: /Data Protection/ })).not.toBeInTheDocument(),
    );
    // Built-ins are untouched and carry no remove control.
    expect(screen.getByRole('checkbox', { name: /Confidentiality/ })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Remove clause Confidentiality/ }),
    ).not.toBeInTheDocument();
  });

  it('persists the custom clause title in the created contract payload', async () => {
    const user = userEvent.setup();
    createContractMock.mockResolvedValue({ id: 'contract-1', title: 'Technology Services Agreement' });
    startContractReviewMock.mockResolvedValue({ workflow_instance_id: 'wf-1' });

    renderWithQuery(<ContractDraftingWorkspace />);
    const addButton = await goToTermsStep(user);

    await user.click(addButton);
    await user.type(await screen.findByLabelText(/Clause title/), 'Data Protection');
    await user.click(screen.getByRole('button', { name: /^Add$/ }));

    // Terms → Documents → Review.
    await user.click(screen.getByRole('button', { name: /Next Step/ }));
    await user.click(await screen.findByRole('button', { name: /Next Step/ }));
    await user.click(await screen.findByRole('button', { name: /Submit for Approval/ }));

    await waitFor(() => expect(createContractMock).toHaveBeenCalledTimes(1));
    const payload = createContractMock.mock.calls[0][0];
    // A bare uuid in selected_clauses would be unreadable downstream, so the
    // authored title must travel with it.
    expect(payload.metadata.custom_clauses).toEqual([
      expect.objectContaining({ title: 'Data Protection', risk: 'medium' }),
    ]);
    expect(payload.metadata.selected_clauses).toContain(
      payload.metadata.custom_clauses[0].id,
    );
  });
});
