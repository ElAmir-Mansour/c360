import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import { SecretRotationDialog } from './secret-rotation-dialog';
import { detailOpsLabels } from '../_lib/detail-ops-labels';
import type { FieldSpec, IntegrationEndpoint } from '@/lib/lex/integrations';

const OLD_SECRET = 'the-old-client-secret-do-not-leak';

const { getSchemaMock, rotateSecretMock, testConnectionMock, showSuccessMock, showBackendErrorMock } =
  vi.hoisted(() => ({
    getSchemaMock: vi.fn(),
    rotateSecretMock: vi.fn(),
    testConnectionMock: vi.fn(),
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
    getSchema: getSchemaMock,
    rotateSecret: rotateSecretMock,
    testConnection: testConnectionMock,
  };
});

const secretSpec: FieldSpec = {
  key: 'client_secret',
  label: { en: 'Client secret', ar: 'سر العميل' },
  type: 'secret',
  required: true,
  secret: true,
};

const endpoint: IntegrationEndpoint = {
  id: 'ep-1',
  tenant_id: 't-1',
  kind: 'najiz',
  code: 'najiz-prod',
  name: 'Najiz',
  description: '',
  // Config arrives masked AND carries the literal secret only as the sentinel —
  // we deliberately stash the plaintext nowhere the dialog can read it.
  status: 'active',
  config: { client_secret: '__redacted__' },
  metadata: {},
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

beforeEach(() => {
  getSchemaMock.mockReset();
  rotateSecretMock.mockReset();
  testConnectionMock.mockReset();
  showSuccessMock.mockReset();
  showBackendErrorMock.mockReset();
  getSchemaMock.mockResolvedValue([secretSpec]);
  rotateSecretMock.mockResolvedValue({ ...endpoint });
  testConnectionMock.mockResolvedValue({ reachable: true, detail: 'ok' });
});

describe('SecretRotationDialog', () => {
  it('opens a write-only dialog that never displays the old secret', async () => {
    const user = userEvent.setup();
    const { container } = renderWithQuery(<SecretRotationDialog endpoint={endpoint} canManage />);

    await user.click(screen.getByRole('button', { name: detailOpsLabels.en.rotateOpen }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(detailOpsLabels.en.rotateDialogTitle)).toBeInTheDocument();

    // The old/current secret must never appear in the DOM.
    expect(container.innerHTML).not.toContain(OLD_SECRET);
    expect(screen.queryByDisplayValue(OLD_SECRET)).toBeNull();
    expect(screen.queryByDisplayValue('__redacted__')).toBeNull();
  });

  it('rotates with the new value and reports success', async () => {
    const user = userEvent.setup();
    renderWithQuery(<SecretRotationDialog endpoint={endpoint} canManage />);

    await user.click(screen.getByRole('button', { name: detailOpsLabels.en.rotateOpen }));
    await screen.findByRole('dialog');

    // Pick the secret field.
    await user.click(screen.getByRole('combobox'));
    await user.click(await screen.findByRole('option', { name: 'Client secret' }));

    // The new-value input is a password (write-only).
    const input = await screen.findByLabelText(detailOpsLabels.en.rotateNewValue);
    expect(input).toHaveAttribute('type', 'password');
    await user.type(input, 'brand-new-secret');

    await user.click(screen.getByRole('button', { name: detailOpsLabels.en.rotateConfirm }));

    await waitFor(() =>
      expect(rotateSecretMock).toHaveBeenCalledWith('ep-1', 'client_secret', 'brand-new-secret'),
    );
    expect(showSuccessMock).toHaveBeenCalledWith(detailOpsLabels.en.toastSecretRotated);
  });

  it('surfaces a toast when rotation fails', async () => {
    rotateSecretMock.mockRejectedValue(new Error('rotate failed'));
    const user = userEvent.setup();
    renderWithQuery(<SecretRotationDialog endpoint={endpoint} canManage />);

    await user.click(screen.getByRole('button', { name: detailOpsLabels.en.rotateOpen }));
    await screen.findByRole('dialog');
    await user.click(screen.getByRole('combobox'));
    await user.click(await screen.findByRole('option', { name: 'Client secret' }));
    await user.type(await screen.findByLabelText(detailOpsLabels.en.rotateNewValue), 'x');
    await user.click(screen.getByRole('button', { name: detailOpsLabels.en.rotateConfirm }));

    await waitFor(() => expect(showBackendErrorMock).toHaveBeenCalled());
    expect(showSuccessMock).not.toHaveBeenCalled();
  });

  it('disables the trigger when the operator cannot manage', () => {
    renderWithQuery(<SecretRotationDialog endpoint={endpoint} canManage={false} />);
    expect(screen.getByRole('button', { name: detailOpsLabels.en.rotateOpen })).toBeDisabled();
  });

  it('shows a no-secrets message when the schema has none', async () => {
    getSchemaMock.mockResolvedValue([]);
    const user = userEvent.setup();
    renderWithQuery(<SecretRotationDialog endpoint={endpoint} canManage />);

    await user.click(screen.getByRole('button', { name: detailOpsLabels.en.rotateOpen }));
    expect(await screen.findByText(detailOpsLabels.en.rotateNoSecrets)).toBeInTheDocument();
  });
});
