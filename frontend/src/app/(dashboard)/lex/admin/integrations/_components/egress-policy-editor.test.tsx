import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import { EgressPolicyEditor, isValidEgressField } from './egress-policy-editor';
import { governanceLabels } from '../_lib/governance-labels';
import type { EgressPolicy } from '@/lib/lex/integrations';

const { getEgressPolicyMock, putEgressPolicyMock, showSuccessMock, showBackendErrorMock } =
  vi.hoisted(() => ({
    getEgressPolicyMock: vi.fn(),
    putEgressPolicyMock: vi.fn(),
    showSuccessMock: vi.fn(),
    showBackendErrorMock: vi.fn(),
  }));

vi.mock('@/lib/toast', () => ({
  showSuccess: showSuccessMock,
  showBackendError: showBackendErrorMock,
}));

vi.mock('@/lib/lex/integrations', async () => {
  const actual = await vi.importActual<typeof import('@/lib/lex/integrations')>(
    '@/lib/lex/integrations',
  );
  return {
    ...actual,
    getEgressPolicy: getEgressPolicyMock,
    putEgressPolicy: putEgressPolicyMock,
  };
});

const policy: EgressPolicy = {
  allowed_regions: ['sa-central'],
  allowed_egress_fields: ['case_number'],
  blocked_count: 3,
  updated_at: '2026-06-20T09:00:00Z',
};

beforeEach(() => {
  getEgressPolicyMock.mockReset();
  putEgressPolicyMock.mockReset();
  showSuccessMock.mockReset();
  showBackendErrorMock.mockReset();
  getEgressPolicyMock.mockResolvedValue(policy);
  putEgressPolicyMock.mockResolvedValue({ ...policy, blocked_count: 3 });
});

describe('isValidEgressField', () => {
  it('accepts field keys and rejects hosts/URLs/whitespace/wildcards', () => {
    expect(isValidEgressField('case_number')).toBe(true);
    expect(isValidEgressField('party.email')).toBe(true);
    expect(isValidEgressField('https://evil.example.com')).toBe(false);
    expect(isValidEgressField('evil.example.com/data')).toBe(false);
    expect(isValidEgressField('two words')).toBe(false);
    expect(isValidEgressField('*')).toBe(false);
    expect(isValidEgressField('')).toBe(false);
    expect(isValidEgressField('  ')).toBe(false);
  });
});

describe('EgressPolicyEditor', () => {
  it('renders the loaded policy and blocked count', async () => {
    renderWithQuery(<EgressPolicyEditor endpointId="ep-1" canManage />);

    expect(await screen.findByText('case_number')).toBeInTheDocument();
    expect(
      screen.getByText(governanceLabels.en.egressBlockedCount.replace('{n}', '3')),
    ).toBeInTheDocument();
  });

  it('rejects a malformed egress field and does not add it', async () => {
    const user = userEvent.setup();
    renderWithQuery(<EgressPolicyEditor endpointId="ep-1" canManage />);

    await screen.findByText('case_number');

    const input = screen.getByPlaceholderText(governanceLabels.en.egressFieldsPlaceholder);
    await user.type(input, 'https://evil.example.com');
    await user.click(screen.getByRole('button', { name: governanceLabels.en.egressFieldsAdd }));

    // The canonical invalid-field message is surfaced from the governance bundle.
    expect(screen.getByRole('alert')).toHaveTextContent(governanceLabels.en.egressFieldInvalid);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    // The malformed value never becomes a chip.
    expect(screen.queryByText('https://evil.example.com')).toBeNull();
  });

  it('adds a valid field and saves the policy', async () => {
    const user = userEvent.setup();
    renderWithQuery(<EgressPolicyEditor endpointId="ep-1" canManage />);

    await screen.findByText('case_number');

    const input = screen.getByPlaceholderText(governanceLabels.en.egressFieldsPlaceholder);
    await user.type(input, 'party.email');
    await user.click(screen.getByRole('button', { name: governanceLabels.en.egressFieldsAdd }));

    expect(await screen.findByText('party.email')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: governanceLabels.en.egressSave }));

    await waitFor(() =>
      expect(putEgressPolicyMock).toHaveBeenCalledWith('ep-1', {
        allowed_regions: ['sa-central'],
        allowed_egress_fields: ['case_number', 'party.email'],
      }),
    );
    expect(showSuccessMock).toHaveBeenCalledWith(governanceLabels.en.egressToastSaved);
  });

  it('surfaces a toast when the save fails', async () => {
    putEgressPolicyMock.mockRejectedValue(new Error('save failed'));
    const user = userEvent.setup();
    renderWithQuery(<EgressPolicyEditor endpointId="ep-1" canManage />);

    await screen.findByText('case_number');

    const input = screen.getByPlaceholderText(governanceLabels.en.egressFieldsPlaceholder);
    await user.type(input, 'party.email');
    await user.click(screen.getByRole('button', { name: governanceLabels.en.egressFieldsAdd }));
    await user.click(screen.getByRole('button', { name: governanceLabels.en.egressSave }));

    await waitFor(() => expect(showBackendErrorMock).toHaveBeenCalled());
    expect(showSuccessMock).not.toHaveBeenCalled();
  });

  it('warns when no regions are allowed (hard block) and shows the in-Kingdom note', async () => {
    getEgressPolicyMock.mockResolvedValue({ ...policy, allowed_regions: [] });
    renderWithQuery(<EgressPolicyEditor endpointId="ep-1" canManage />);

    expect(await screen.findByText(governanceLabels.en.egressEmptyRegionsWarn)).toBeInTheDocument();
    expect(screen.getByText(governanceLabels.en.egressInKingdomTitle)).toBeInTheDocument();
  });

  it('renders the Arabic/RTL surface under the ar locale', async () => {
    getEgressPolicyMock.mockResolvedValue(policy);
    const { container } = renderWithQuery(<EgressPolicyEditor endpointId="ep-1" canManage />, {
      locale: 'ar',
    });

    expect(await screen.findByText('case_number')).toBeInTheDocument();
    expect(container.querySelector('[dir="rtl"]')).not.toBeNull();
  });
});
