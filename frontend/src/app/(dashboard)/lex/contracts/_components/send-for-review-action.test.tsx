import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import type { LexContract } from '@/types/suites';

const {
  usersListMock,
  startContractReviewMock,
  showSuccessMock,
  showErrorMock,
  hasAnyPermissionMock,
} = vi.hoisted(() => ({
  usersListMock: vi.fn(),
  startContractReviewMock: vi.fn(),
  showSuccessMock: vi.fn(),
  showErrorMock: vi.fn(),
  hasAnyPermissionMock: vi.fn(),
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    hasAnyPermission: hasAnyPermissionMock,
    isHydrated: true,
    user: { id: 'u-1' },
  }),
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
      lex: {
        ...actual.enterpriseApi.lex,
        startContractReview: startContractReviewMock,
      },
    },
  };
});

vi.mock('@/lib/toast', () => ({
  showSuccess: showSuccessMock,
  showError: showErrorMock,
  showInfo: vi.fn(),
  showWarning: vi.fn(),
}));

import {
  SendForReviewDialog,
  isSodConflictError,
  sendForReviewLabels,
} from './send-for-review-action';

function makeContract(overrides: Partial<LexContract>): LexContract {
  return {
    id: 'c-1',
    title: 'Master Services Agreement',
    status: 'draft',
    type: 'service',
    risk_level: 'medium',
    workflow_instance_id: null,
    owner_user_id: 'u-1',
    owner_name: 'Ada Lex',
    created_by: 'u-1',
    created_at: '2026-06-01T09:00:00Z',
    updated_at: '2026-06-02T09:00:00Z',
    ...overrides,
  } as unknown as LexContract;
}

const eligibleA = makeContract({ id: 'c-1', title: 'Master Services Agreement' });
const eligibleB = makeContract({ id: 'c-2', title: 'Vendor NDA' });
const inReview = makeContract({
  id: 'c-3',
  title: 'Lease Renewal',
  workflow_instance_id: 'wf-9',
});
const contracts = [eligibleA, eligibleB, inReview];

function fillValidForm() {
  fireEvent.change(screen.getByLabelText(sendForReviewLabels.en.taskDescription), {
    target: { value: 'Please review the indemnity clauses.' },
  });
  fireEvent.change(screen.getByLabelText(sendForReviewLabels.en.approverRole), {
    target: { value: 'legal-director' },
  });
}

beforeEach(() => {
  usersListMock.mockReset();
  startContractReviewMock.mockReset();
  showSuccessMock.mockReset();
  showErrorMock.mockReset();
  hasAnyPermissionMock.mockReset();
  hasAnyPermissionMock.mockReturnValue(true);
  usersListMock.mockResolvedValue({
    data: [{ id: 'u-2', email: 'sara@clario.dev', first_name: 'Sara', last_name: 'Approver' }],
    meta: { page: 1, per_page: 200, total: 1, total_pages: 1 },
  });
});

describe('isSodConflictError', () => {
  it('recognizes the middleware SOD_CONFLICT code on a 403', () => {
    expect(
      isSodConflictError({
        status: 403,
        code: 'SOD_CONFLICT',
        message: 'you authored this record and cannot approve or close it (separation of duties)',
      }),
    ).toBe(true);
  });

  it('recognizes a service-level 403 FORBIDDEN naming separation of duties', () => {
    expect(
      isSodConflictError({
        status: 403,
        code: 'FORBIDDEN',
        message: 'you authored this contract and cannot decide its review (separation of duties)',
      }),
    ).toBe(true);
    expect(
      isSodConflictError({
        status: 403,
        code: 'FORBIDDEN',
        message: 'Separation-of-duties check failed',
      }),
    ).toBe(true);
  });

  it('rejects other 403s, non-403 statuses, and non-object errors', () => {
    expect(
      isSodConflictError({ status: 403, code: 'FORBIDDEN', message: 'missing permission' }),
    ).toBe(false);
    expect(isSodConflictError({ status: 409, code: 'SOD_CONFLICT', message: 'x' })).toBe(false);
    expect(isSodConflictError(null)).toBe(false);
    expect(isSodConflictError('separation of duties')).toBe(false);
  });
});

describe('sendForReviewLabels', () => {
  it('keeps the English and Arabic bundles key-parallel', () => {
    expect(Object.keys(sendForReviewLabels.ar).sort()).toEqual(
      Object.keys(sendForReviewLabels.en).sort(),
    );
  });
});

describe('SendForReviewDialog', () => {
  it('renders the English form and partitions contracts already in review', async () => {
    renderWithQuery(
      <SendForReviewDialog
        open
        onOpenChange={vi.fn()}
        contracts={contracts}
        selectedIds={['c-1', 'c-2', 'c-3']}
        onDone={vi.fn()}
      />,
    );

    expect(
      await screen.findByRole('heading', { name: sendForReviewLabels.en.title }),
    ).toBeInTheDocument();
    expect(screen.getByText(sendForReviewLabels.en.description(3))).toBeInTheDocument();
    // Two eligible, one skipped because it already carries a workflow instance.
    expect(screen.getByText(sendForReviewLabels.en.eligible(2))).toBeInTheDocument();
    expect(screen.getByText(sendForReviewLabels.en.alreadyInReview(1))).toBeInTheDocument();
    expect(screen.getByText(inReview.title)).toBeInTheDocument();
  });

  it('renders the Arabic surface RTL under the ar locale', async () => {
    renderWithQuery(
      <SendForReviewDialog
        open
        onOpenChange={vi.fn()}
        contracts={contracts}
        selectedIds={['c-1']}
        onDone={vi.fn()}
      />,
      { locale: 'ar' },
    );

    expect(
      await screen.findByRole('heading', { name: sendForReviewLabels.ar.title }),
    ).toBeInTheDocument();
    expect(document.querySelector('[dir="rtl"][lang="ar"]')).not.toBeNull();
  });

  it('renders nothing for a persona without a contract write verb', () => {
    hasAnyPermissionMock.mockReturnValue(false);
    renderWithQuery(
      <SendForReviewDialog
        open
        onOpenChange={vi.fn()}
        contracts={contracts}
        selectedIds={['c-1']}
        onDone={vi.fn()}
      />,
    );

    expect(hasAnyPermissionMock).toHaveBeenCalledWith([
      'lex:contract:add',
      'lex:contract:edit',
    ]);
    expect(screen.queryByText(sendForReviewLabels.en.title)).not.toBeInTheDocument();
  });

  it('disables send until a description and an approver are provided', async () => {
    renderWithQuery(
      <SendForReviewDialog
        open
        onOpenChange={vi.fn()}
        contracts={contracts}
        selectedIds={['c-1']}
        onDone={vi.fn()}
      />,
    );

    const send = await screen.findByRole('button', { name: sendForReviewLabels.en.send });
    expect(send).toBeDisabled();
    fillValidForm();
    expect(send).toBeEnabled();
  });

  it('submits sequentially and explains an SoD 403 inline instead of toasting an error', async () => {
    const onDone = vi.fn();
    startContractReviewMock.mockImplementation((id: string) => {
      if (id === 'c-2') {
        return Promise.reject({
          status: 403,
          code: 'SOD_CONFLICT',
          message:
            'you authored this record and cannot approve or close it (separation of duties)',
        });
      }
      return Promise.resolve({ id: 'wf-1' });
    });

    renderWithQuery(
      <SendForReviewDialog
        open
        onOpenChange={vi.fn()}
        contracts={contracts}
        selectedIds={['c-1', 'c-2', 'c-3']}
        onDone={onDone}
      />,
    );

    await screen.findByRole('heading', { name: sendForReviewLabels.en.title });
    fillValidForm();
    fireEvent.click(screen.getByRole('button', { name: sendForReviewLabels.en.send }));

    // Partial-failure summary: one sent, one blocked by SoD — rendered as a
    // friendly explanation, never an error toast.
    expect(await screen.findByText(sendForReviewLabels.en.summaryTitle)).toBeInTheDocument();
    expect(screen.getByText(sendForReviewLabels.en.succeeded(1))).toBeInTheDocument();
    expect(screen.getByText(sendForReviewLabels.en.sodTitle)).toBeInTheDocument();
    expect(screen.getByText(sendForReviewLabels.en.sodExplanation)).toBeInTheDocument();
    expect(showErrorMock).not.toHaveBeenCalled();
    expect(showSuccessMock).toHaveBeenCalledWith(sendForReviewLabels.en.successPartial(1, 1));
    expect(onDone).toHaveBeenCalledTimes(1);

    // Only the two eligible contracts were submitted, in list order, with the
    // shared payload; the in-review contract was never sent.
    expect(startContractReviewMock).toHaveBeenCalledTimes(2);
    expect(startContractReviewMock.mock.calls.map(([id]) => id)).toEqual(['c-1', 'c-2']);
    expect(startContractReviewMock.mock.calls[0][1]).toMatchObject({
      approver_role: 'legal-director',
      description: 'Please review the indemnity clauses.',
      sla_hours: 48,
    });
  });

  it('toasts an error and lists genuine faults when every send fails', async () => {
    const onDone = vi.fn();
    startContractReviewMock.mockRejectedValue({
      status: 500,
      code: 'INTERNAL',
      message: 'workflow engine unavailable',
    });

    renderWithQuery(
      <SendForReviewDialog
        open
        onOpenChange={vi.fn()}
        contracts={[eligibleA]}
        selectedIds={['c-1']}
        onDone={onDone}
      />,
    );

    await screen.findByRole('heading', { name: sendForReviewLabels.en.title });
    fillValidForm();
    fireEvent.click(screen.getByRole('button', { name: sendForReviewLabels.en.send }));

    expect(await screen.findByText(sendForReviewLabels.en.failedTitle)).toBeInTheDocument();
    expect(screen.getByText(/workflow engine unavailable/)).toBeInTheDocument();
    await waitFor(() => expect(showErrorMock).toHaveBeenCalledWith(sendForReviewLabels.en.allFailed));
    expect(showSuccessMock).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });
});
