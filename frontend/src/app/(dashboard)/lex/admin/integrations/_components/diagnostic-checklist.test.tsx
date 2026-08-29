import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import type { TestResult } from '@/lib/lex/integrations';
import { detailOpsLabels } from '../_lib/detail-ops-labels';
import { DiagnosticChecklist } from './diagnostic-checklist';

const { testConnectionMock, showSuccessMock, showBackendErrorMock } = vi.hoisted(() => ({
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
    testConnection: testConnectionMock,
  };
});

const t = detailOpsLabels.en;

const stagedResult: TestResult = {
  endpoint_id: 'ep-1',
  reachable: true,
  detail: 'All checks ran.',
  sample_count: 5,
  latency_millis: 120,
  steps: [
    {
      key: 'reachable',
      label: { en: 'Reachable', ar: 'قابل للوصول' },
      status: 'ok',
      latency_ms: 30,
    },
    {
      key: 'authorized',
      label: { en: 'Authorized', ar: 'مُصرّح' },
      status: 'warn',
      detail: 'Scope is narrow.',
      hint: { en: 'Grant the read scope to the service account.', ar: 'امنح نطاق القراءة' },
    },
  ],
};

beforeEach(() => {
  testConnectionMock.mockReset();
  showSuccessMock.mockReset();
  showBackendErrorMock.mockReset();
});

describe('DiagnosticChecklist', () => {
  it('shows the not-run-yet state and a run trigger for managers', () => {
    renderWithQuery(<DiagnosticChecklist endpointId="ep-1" canManage />);
    expect(screen.getByText(t.diagnosticsEmpty)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t.diagnosticsRun })).toBeInTheDocument();
  });

  it('renders the staged step checklist with remediation hint for warn/fail steps', async () => {
    const user = userEvent.setup();
    testConnectionMock.mockResolvedValue(stagedResult);
    renderWithQuery(<DiagnosticChecklist endpointId="ep-1" canManage />);

    await user.click(screen.getByRole('button', { name: t.diagnosticsRun }));

    await waitFor(() => expect(testConnectionMock).toHaveBeenCalledWith('ep-1'));

    // Overall verdict + per-step labels.
    expect(await screen.findByText(t.diagnosticsReachable)).toBeInTheDocument();
    expect(screen.getByText('Reachable')).toBeInTheDocument();
    expect(screen.getByText('Authorized')).toBeInTheDocument();
    // Remediation hint surfaces only for the warn step.
    expect(screen.getByText('Grant the read scope to the service account.')).toBeInTheDocument();
    expect(screen.getByText(t.diagnosticHintLabel, { exact: false })).toBeInTheDocument();
  });

  it('routes test failures to a toast and shows the unsupported state', async () => {
    const user = userEvent.setup();
    testConnectionMock.mockRejectedValue(new Error('422 unsupported'));
    renderWithQuery(<DiagnosticChecklist endpointId="ep-1" canManage />);

    await user.click(screen.getByRole('button', { name: t.diagnosticsRun }));

    await waitFor(() => expect(showBackendErrorMock).toHaveBeenCalled());
    expect(await screen.findByText(t.diagnosticsUnsupported)).toBeInTheDocument();
  });

  it('disables the trigger while a test is in flight (no double-submit)', async () => {
    const user = userEvent.setup();
    let resolve: (v: TestResult) => void = () => undefined;
    testConnectionMock.mockReturnValue(new Promise<TestResult>((r) => (resolve = r)));
    renderWithQuery(<DiagnosticChecklist endpointId="ep-1" canManage />);

    await user.click(screen.getByRole('button', { name: t.diagnosticsRun }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: t.diagnosticsRunning })).toBeDisabled(),
    );
    resolve(stagedResult);
  });

  it('hides the trigger and shows a read-only note for non-managers', () => {
    renderWithQuery(<DiagnosticChecklist endpointId="ep-1" canManage={false} />);
    expect(screen.queryByRole('button', { name: t.diagnosticsRun })).toBeNull();
    expect(screen.getByText(t.manageOnlyNote)).toBeInTheDocument();
  });

  it('renders the Arabic/RTL surface under the ar locale', () => {
    const { container } = renderWithQuery(<DiagnosticChecklist endpointId="ep-1" canManage />, {
      locale: 'ar',
    });
    expect(screen.getByText(detailOpsLabels.ar.diagnosticsEmpty)).toBeInTheDocument();
    expect(container.querySelector('[dir="rtl"]')).not.toBeNull();
  });
});
