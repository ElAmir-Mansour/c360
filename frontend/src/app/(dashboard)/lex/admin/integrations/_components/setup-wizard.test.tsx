import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import { SetupWizard } from './setup-wizard';
import { integrationLabels } from '../_labels';
import type { CatalogEntry, FieldSpec, IntegrationEndpoint } from '@/lib/lex/integrations';

const t = integrationLabels.en;

const {
  getCatalogResultMock,
  getSchemaMock,
  createIntegrationMock,
  testConnectionMock,
  updateIntegrationMock,
  syncNowMock,
  showSuccessMock,
  showWarningMock,
  showBackendErrorMock,
} = vi.hoisted(() => ({
  getCatalogResultMock: vi.fn(),
  getSchemaMock: vi.fn(),
  createIntegrationMock: vi.fn(),
  testConnectionMock: vi.fn(),
  updateIntegrationMock: vi.fn(),
  syncNowMock: vi.fn(),
  showSuccessMock: vi.fn(),
  showWarningMock: vi.fn(),
  showBackendErrorMock: vi.fn(),
}));

vi.mock('@/lib/toast', () => ({
  showSuccess: showSuccessMock,
  showWarning: showWarningMock,
  showBackendError: showBackendErrorMock,
}));

vi.mock('@/lib/lex/integrations', async () => {
  const actual = await vi.importActual<typeof import('@/lib/lex/integrations')>(
    '@/lib/lex/integrations',
  );
  return {
    ...actual,
    getCatalogResult: getCatalogResultMock,
    getSchema: getSchemaMock,
    createIntegration: createIntegrationMock,
    testConnection: testConnectionMock,
    updateIntegration: updateIntegrationMock,
    syncNow: syncNowMock,
  };
});

// Use a non-gov-gated, sync-incapable kind to keep the happy path short: 'sso'.
const schema: FieldSpec[] = [
  {
    key: 'issuer',
    label: { en: 'Issuer', ar: 'المُصدِّر' },
    type: 'url',
    required: true,
    secret: false,
  },
];

const catalog: CatalogEntry[] = [
  {
    kind: 'sso',
    maturity: 'production',
    prerequisite_steps: [],
    callback_templates: {},
    ksa_tags: [],
    self_serve: true,
  },
];

const created: IntegrationEndpoint = {
  id: 'ep-new',
  tenant_id: 't-1',
  kind: 'sso',
  code: 'sso-1',
  name: 'Corporate SSO',
  description: '',
  status: 'planned',
  config: { issuer: 'https://idp.example.com' },
  metadata: {},
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

beforeEach(() => {
  getCatalogResultMock.mockReset();
  getSchemaMock.mockReset();
  createIntegrationMock.mockReset();
  testConnectionMock.mockReset();
  updateIntegrationMock.mockReset();
  syncNowMock.mockReset();
  showSuccessMock.mockReset();
  showWarningMock.mockReset();
  showBackendErrorMock.mockReset();

  getCatalogResultMock.mockResolvedValue({ entries: catalog, degraded: false });
  getSchemaMock.mockResolvedValue(schema);
  createIntegrationMock.mockResolvedValue(created);
  testConnectionMock.mockResolvedValue({
    endpoint_id: 'ep-new',
    reachable: true,
    detail: 'ok',
    sample_count: 0,
    latency_millis: 12,
    steps: [],
  });
  updateIntegrationMock.mockResolvedValue({ ...created, status: 'active' });
  syncNowMock.mockResolvedValue({ guarded: false, report: { mode: 'delta', processed: 1 } });
});

describe('SetupWizard', () => {
  it('walks prereq -> credentials and CREATES the endpoint', async () => {
    const user = userEvent.setup();
    const onFinish = vi.fn();
    renderWithQuery(
      <SetupWizard kind="sso" onFinish={onFinish} onChangeKind={vi.fn()} />,
    );

    // Step 1: prerequisites (none) -> continue. The active step heading is an h2.
    expect(
      await screen.findByRole('heading', { level: 2, name: t.wizardStepPrereq }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: new RegExp(t.wizardNext, 'i') }));

    // Step 2: credentials — fill identity + the schema field, then create.
    await user.type(await screen.findByLabelText(/Display name/i), 'Corporate SSO');
    await user.type(screen.getByLabelText(/Code/i), 'sso-1');
    await user.type(await screen.findByLabelText(/Issuer/i), 'https://idp.example.com');

    await user.click(screen.getByRole('button', { name: t.create }));

    await waitFor(() =>
      expect(createIntegrationMock).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'sso', code: 'sso-1', name: 'Corporate SSO' }),
      ),
    );
    expect(showSuccessMock).toHaveBeenCalledWith(t.toastCreated);

    // After creation the wizard auto-advances to the Test step.
    expect(
      await screen.findByRole('heading', { level: 2, name: t.wizardStepTest }),
    ).toBeInTheDocument();
  });

  it('surfaces an error toast when creation fails', async () => {
    createIntegrationMock.mockRejectedValue(new Error('create failed'));
    const user = userEvent.setup();
    renderWithQuery(
      <SetupWizard kind="sso" onFinish={vi.fn()} onChangeKind={vi.fn()} />,
    );

    await screen.findByRole('heading', { level: 2, name: t.wizardStepPrereq });
    await user.click(screen.getByRole('button', { name: new RegExp(t.wizardNext, 'i') }));

    await user.type(await screen.findByLabelText(/Display name/i), 'Corporate SSO');
    await user.type(screen.getByLabelText(/Code/i), 'sso-1');
    await user.click(screen.getByRole('button', { name: t.create }));

    await waitFor(() => expect(showBackendErrorMock).toHaveBeenCalled());
    expect(showSuccessMock).not.toHaveBeenCalledWith(t.toastCreated);
  });

  it('renders the stepper rail with every step', async () => {
    renderWithQuery(<SetupWizard kind="sso" onFinish={vi.fn()} onChangeKind={vi.fn()} />);
    // Prereq appears twice (rail + active heading); the rest only in the rail.
    expect((await screen.findAllByText(t.wizardStepPrereq)).length).toBeGreaterThan(0);
    expect(screen.getByText(t.wizardStepCredentials)).toBeInTheDocument();
    expect(screen.getByText(t.wizardStepTest)).toBeInTheDocument();
    expect(screen.getByText(t.wizardStepEnable)).toBeInTheDocument();
    expect(screen.getByText(t.wizardStepSync)).toBeInTheDocument();
  });

  it('warns when the live catalog metadata is degraded', async () => {
    getCatalogResultMock.mockResolvedValue({ entries: [], degraded: true });
    renderWithQuery(<SetupWizard kind="sso" onFinish={vi.fn()} onChangeKind={vi.fn()} />);

    expect(await screen.findByText(t.catalogErrorTitle)).toBeInTheDocument();
    expect(screen.getByText(t.catalogErrorBody)).toBeInTheDocument();
  });
});
