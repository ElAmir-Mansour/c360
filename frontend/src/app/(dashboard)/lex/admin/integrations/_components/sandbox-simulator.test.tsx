import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import type { IntegrationEndpoint } from '@/lib/lex/integrations';
import { detailOpsLabels } from '../_lib/detail-ops-labels';
import { SandboxSimulator } from './sandbox-simulator';

const { sandboxInvokeMock, showSuccessMock, showBackendErrorMock } = vi.hoisted(() => ({
  sandboxInvokeMock: vi.fn(),
  showSuccessMock: vi.fn(),
  showBackendErrorMock: vi.fn(),
}));

vi.mock('@/lib/toast', () => ({
  showSuccess: showSuccessMock,
  showBackendError: showBackendErrorMock,
  showApiError: vi.fn(),
}));

vi.mock('@/lib/lex/integrations', async () => {
  const actual = await vi.importActual<typeof import('@/lib/lex/integrations')>(
    '@/lib/lex/integrations',
  );
  return { ...actual, sandboxInvoke: sandboxInvokeMock };
});

const en = detailOpsLabels.en;

const nafathEndpoint: IntegrationEndpoint = {
  id: 'ep-nafath',
  tenant_id: 'tenant-1',
  kind: 'nafath_verify',
  code: 'nafath',
  name: 'Nafath verify',
  description: '',
  status: 'planned',
  config: {},
  metadata: {},
  created_at: '2026-06-01T00:00:00Z',
  updated_at: '2026-06-01T00:00:00Z',
};

beforeEach(() => {
  sandboxInvokeMock.mockReset();
  showSuccessMock.mockReset();
  showBackendErrorMock.mockReset();
  sandboxInvokeMock.mockResolvedValue({
    success: true,
    output: { transId: 'TX-123', random: '42' },
  });
});

describe('SandboxSimulator', () => {
  it('is clearly labelled SANDBOX / not-live', () => {
    renderWithQuery(<SandboxSimulator endpoint={nafathEndpoint} canManage />);
    // The SANDBOX badge and the explicit "not live" note are present.
    expect(screen.getByText(en.sandboxBadge)).toBeInTheDocument();
    expect(screen.getByText(en.sandboxBadgeNote)).toBeInTheDocument();
    // The section has an accessible label.
    expect(screen.getByRole('region', { name: en.sandboxTitle })).toBeInTheDocument();
  });

  it('runs a mock op and highlights the Nafath number-match field', async () => {
    const user = userEvent.setup();
    renderWithQuery(<SandboxSimulator endpoint={nafathEndpoint} canManage />);

    await user.click(screen.getByRole('button', { name: new RegExp(en.sandboxRun, 'i') }));

    await waitFor(() => expect(sandboxInvokeMock).toHaveBeenCalledTimes(1));
    expect(showSuccessMock).toHaveBeenCalledWith(en.toastSandboxDone);
    // The highlighted random / number-match value renders.
    expect(await screen.findByText('42')).toBeInTheDocument();
    expect(screen.getByText(en.sandboxOk)).toBeInTheDocument();
  });

  it('toasts on a sandbox failure (no unhandled rejection)', async () => {
    sandboxInvokeMock.mockRejectedValueOnce(new Error('mock down'));
    const user = userEvent.setup();
    renderWithQuery(<SandboxSimulator endpoint={nafathEndpoint} canManage />);

    await user.click(screen.getByRole('button', { name: new RegExp(en.sandboxRun, 'i') }));
    await waitFor(() => expect(showBackendErrorMock).toHaveBeenCalledTimes(1));
  });

  it('disables Run and shows a note for read-only users', () => {
    renderWithQuery(<SandboxSimulator endpoint={nafathEndpoint} canManage={false} />);
    expect(screen.getByRole('button', { name: new RegExp(en.sandboxRun, 'i') })).toBeDisabled();
    expect(screen.getByText(en.manageOnlyNote)).toBeInTheDocument();
  });

  it('renders nothing for a non-sandbox kind', () => {
    const { container } = renderWithQuery(
      <SandboxSimulator endpoint={{ ...nafathEndpoint, kind: 'email' }} canManage />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the Arabic/RTL surface under the ar locale', () => {
    const { container } = renderWithQuery(
      <SandboxSimulator endpoint={nafathEndpoint} canManage />,
      { locale: 'ar' },
    );
    expect(screen.getByText(detailOpsLabels.ar.sandboxBadge)).toBeInTheDocument();
    expect(container.querySelector('[dir="rtl"]')).not.toBeNull();
  });
});
