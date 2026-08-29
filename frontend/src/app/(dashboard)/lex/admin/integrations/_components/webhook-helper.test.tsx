import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import type { CatalogEntry, IntegrationEndpoint } from '@/lib/lex/integrations';
import { detailOpsLabels } from '../_lib/detail-ops-labels';
import { WebhookHelper } from './webhook-helper';

const { getCatalogResultMock, sendWebhookTestMock, showSuccessMock, showBackendErrorMock } = vi.hoisted(
  () => ({
    getCatalogResultMock: vi.fn(),
    sendWebhookTestMock: vi.fn(),
    showSuccessMock: vi.fn(),
    showBackendErrorMock: vi.fn(),
  }),
);

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ tenant: { id: 'tenant-xyz' }, hasPermission: () => true, isHydrated: true }),
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
  return {
    ...actual,
    getCatalogResult: getCatalogResultMock,
    sendWebhookTest: sendWebhookTestMock,
  };
});

const en = detailOpsLabels.en;

const endpoint: IntegrationEndpoint = {
  id: 'ep-1',
  tenant_id: 'tenant-xyz',
  kind: 'esign',
  code: 'esign',
  name: 'eSign',
  description: '',
  status: 'active',
  config: {},
  metadata: {},
  created_at: '2026-06-01T00:00:00Z',
  updated_at: '2026-06-01T00:00:00Z',
};

const catalogEntry: CatalogEntry = {
  kind: 'esign',
  maturity: 'production',
  prerequisite_steps: [],
  callback_templates: { Callback: '{base}/api/webhooks/{tenant}/{endpoint}' },
  ksa_tags: [],
  self_serve: true,
};

beforeEach(() => {
  getCatalogResultMock.mockReset();
  sendWebhookTestMock.mockReset();
  showSuccessMock.mockReset();
  showBackendErrorMock.mockReset();
  getCatalogResultMock.mockResolvedValue({ entries: [catalogEntry], degraded: false });
  sendWebhookTestMock.mockResolvedValue({ success: true, output: {}, detail: 'delivered' });
});

describe('WebhookHelper', () => {
  it('resolves and renders the inbound URL with a copy control', async () => {
    renderWithQuery(<WebhookHelper endpoint={endpoint} canManage />);

    const code = await screen.findByText(/\/api\/webhooks\/tenant-xyz\/ep-1$/);
    expect(code).toBeInTheDocument();
    // The copy button exposes an accessible label.
    expect(screen.getByRole('button', { name: en.webhookCopy })).toBeInTheDocument();
  });

  it('shows a "never received" indicator when there is no inbound event', async () => {
    renderWithQuery(<WebhookHelper endpoint={endpoint} canManage />);
    expect(await screen.findByText(en.webhookNeverReceived)).toBeInTheDocument();
  });

  it('renders an empty state when the connector exposes no inbound URLs', async () => {
    getCatalogResultMock.mockResolvedValueOnce({
      entries: [{ ...catalogEntry, callback_templates: {} }],
      degraded: false,
    });
    renderWithQuery(<WebhookHelper endpoint={endpoint} canManage />);
    expect(await screen.findByText(en.webhookNoTemplates)).toBeInTheDocument();
  });

  it('warns instead of showing no-template copy when the catalog read is degraded', async () => {
    getCatalogResultMock.mockResolvedValueOnce({ entries: [], degraded: true });
    renderWithQuery(<WebhookHelper endpoint={endpoint} canManage />);

    expect(await screen.findByText(en.webhookTitle)).toBeInTheDocument();
    expect(screen.getByText(en.opsError)).toBeInTheDocument();
    expect(screen.queryByText(en.webhookNoTemplates)).not.toBeInTheDocument();
  });

  it('sends a test event and toasts on failure (no unhandled rejection)', async () => {
    sendWebhookTestMock.mockRejectedValueOnce(new Error('send failed'));
    const user = userEvent.setup();
    renderWithQuery(<WebhookHelper endpoint={endpoint} canManage />);

    await user.click(await screen.findByRole('button', { name: new RegExp(en.webhookSendTest, 'i') }));
    await waitFor(() => expect(showBackendErrorMock).toHaveBeenCalledTimes(1));
  });

  it('hides the send-test action and shows a note for read-only users', async () => {
    renderWithQuery(<WebhookHelper endpoint={endpoint} canManage={false} />);
    await screen.findByText(en.manageOnlyNote);
    expect(screen.queryByRole('button', { name: new RegExp(en.webhookSendTest, 'i') })).toBeNull();
  });

  it('never renders a secret value in the DOM (URL helper surfaces no secrets)', async () => {
    const { container } = renderWithQuery(<WebhookHelper endpoint={endpoint} canManage />);
    await screen.findByText(/\/api\/webhooks\//);
    expect(container.innerHTML).not.toContain('__redacted__');
  });

  it('renders the Arabic/RTL surface under the ar locale', async () => {
    const { container } = renderWithQuery(<WebhookHelper endpoint={endpoint} canManage />, {
      locale: 'ar',
    });
    expect(await screen.findByText(detailOpsLabels.ar.webhookNeverReceived)).toBeInTheDocument();
    expect(container.querySelector('[dir="rtl"]')).not.toBeNull();
  });
});
