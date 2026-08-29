import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import { EventInspector } from './event-inspector';
import type { IntegrationEvent } from '@/lib/lex/integrations';
import { observabilityLabels } from '../_lib/observability-labels';

const {
  getEventsResultMock,
  getEventsAllResultMock,
  replayEventMock,
  showSuccessMock,
  showBackendErrorMock,
} = vi.hoisted(() => ({
  getEventsResultMock: vi.fn(),
  getEventsAllResultMock: vi.fn(),
  replayEventMock: vi.fn(),
  showSuccessMock: vi.fn(),
  showBackendErrorMock: vi.fn(),
}));

vi.mock('@/lib/lex/integrations', async () => {
  const actual = await vi.importActual<typeof import('@/lib/lex/integrations')>(
    '@/lib/lex/integrations',
  );
  return {
    ...actual,
    getEventsResult: getEventsResultMock,
    getEventsAllResult: getEventsAllResultMock,
    replayEvent: replayEventMock,
  };
});

vi.mock('@/lib/toast', () => ({
  showSuccess: showSuccessMock,
  showBackendError: showBackendErrorMock,
}));

// A genuine raw secret that MUST NEVER reach the DOM. The redacted payload is
// what the backend returns; the inspector renders ONLY that.
const RAW_SECRET = 'sk_live_super_secret_token_DO_NOT_LEAK';

const inboundEvent: IntegrationEvent = {
  id: 'evt-1',
  endpoint_id: 'ep-najiz',
  direction: 'inbound',
  kind: 'hearing.updated',
  signature_valid: true,
  status: 'processed',
  result_action: 'imported',
  payload_redacted: '{\n  "api_key": "••••••",\n  "hearing_id": "H-2026-001"\n}',
  error: '',
  occurred_at: '2026-06-20T10:00:00Z',
};

const outboundEvent: IntegrationEvent = {
  id: 'evt-2',
  endpoint_id: 'ep-najiz',
  direction: 'outbound',
  kind: 'case.synced',
  signature_valid: false,
  status: 'failed',
  result_action: 'rejected',
  payload_redacted: '{\n  "token": "[REDACTED]"\n}',
  error: 'upstream 503',
  occurred_at: '2026-06-20T11:00:00Z',
};

const en = observabilityLabels.en;

beforeEach(() => {
  getEventsResultMock.mockReset();
  getEventsAllResultMock.mockReset();
  replayEventMock.mockReset();
  showSuccessMock.mockReset();
  showBackendErrorMock.mockReset();
  getEventsResultMock.mockResolvedValue({
    events: [inboundEvent, outboundEvent],
    degraded: false,
  });
  getEventsAllResultMock.mockResolvedValue({
    events: [inboundEvent, outboundEvent],
    degraded: false,
  });
  replayEventMock.mockResolvedValue({ ok: true });
});

describe('EventInspector', () => {
  it('renders the event stream with direction, signature and status semantics', async () => {
    renderWithQuery(<EventInspector endpointId="ep-najiz" />);

    expect(await screen.findByText('hearing.updated')).toBeInTheDocument();
    expect(screen.getByText('case.synced')).toBeInTheDocument();
    // Signature validity surfaced for inbound.
    expect(screen.getByText(en.signatureValid)).toBeInTheDocument();
    // Table has header semantics.
    const table = screen.getByRole('table');
    expect(within(table).getByText(en.colDirection)).toBeInTheDocument();
    expect(within(table).getByText(en.colStatus)).toBeInTheDocument();
  });

  it('never leaks a raw secret — only the redacted payload is rendered', async () => {
    const user = userEvent.setup();
    renderWithQuery(<EventInspector endpointId="ep-najiz" />);

    await screen.findByText('hearing.updated');

    // Before AND after expansion, the raw secret must be absent from the DOM.
    expect(document.body.innerHTML).not.toContain(RAW_SECRET);

    const toggles = screen.getAllByRole('button', { name: en.showPayload });
    await user.click(toggles[0]);

    expect(await screen.findByText(en.payloadTitle)).toBeInTheDocument();
    // Redacted markers are shown; the real secret is not.
    expect(screen.getByText(/••••••/)).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(RAW_SECRET);
    expect(document.body.textContent).not.toContain(RAW_SECRET);
  });

  it('confirms before replaying an inbound event and toasts on success', async () => {
    const user = userEvent.setup();
    renderWithQuery(<EventInspector endpointId="ep-najiz" canManage />);

    await screen.findByText('hearing.updated');

    // Replay is the action button for the inbound row (first replay button).
    const replayButtons = screen.getAllByRole('button', { name: new RegExp(en.replay) });
    await user.click(replayButtons[0]);

    // A confirm dialog gates the destructive re-processing.
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(en.replayConfirmTitle)).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: en.replay }));

    await waitFor(() => expect(replayEventMock).toHaveBeenCalledWith('evt-1'));
    await waitFor(() => expect(showSuccessMock).toHaveBeenCalledWith(en.toastReplayed));
    expect(showBackendErrorMock).not.toHaveBeenCalled();
  });

  it('surfaces a user-facing error when replay fails (resilience path)', async () => {
    replayEventMock.mockRejectedValue(new Error('boom'));
    const user = userEvent.setup();
    renderWithQuery(<EventInspector endpointId="ep-najiz" canManage />);

    await screen.findByText('hearing.updated');
    const replayButtons = screen.getAllByRole('button', { name: new RegExp(en.replay) });
    await user.click(replayButtons[0]);

    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: en.replay }));

    await waitFor(() => expect(showBackendErrorMock).toHaveBeenCalled());
    expect(showSuccessMock).not.toHaveBeenCalled();
  });

  it('hides replay affordances entirely for read-only users', async () => {
    renderWithQuery(<EventInspector endpointId="ep-najiz" />);

    await screen.findByText('hearing.updated');
    expect(screen.queryByRole('button', { name: new RegExp(en.replay) })).not.toBeInTheDocument();
    expect(screen.queryByText(en.colActions)).not.toBeInTheDocument();
  });

  it('renders an empty state when no events flow', async () => {
    getEventsResultMock.mockResolvedValue({ events: [], degraded: false });
    renderWithQuery(<EventInspector endpointId="ep-najiz" />);

    expect(await screen.findByText(en.eventsEmpty)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('renders an unavailable state when the event stream read is degraded', async () => {
    getEventsResultMock.mockResolvedValue({ events: [], degraded: true });
    renderWithQuery(<EventInspector endpointId="ep-najiz" />);

    expect(await screen.findByText(en.observabilityError)).toBeInTheDocument();
    expect(screen.queryByText(en.eventsEmpty)).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
