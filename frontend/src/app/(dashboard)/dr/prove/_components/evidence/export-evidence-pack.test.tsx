import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import type {
  DRAttestationLedgerEntry,
  DRAttestationLedgerVerifyResult,
  DRFailoverRun,
  DRFailoverStep,
} from '@/types/clario-dr';

// ---------------------------------------------------------------------------
// Mock the real ClarioDR data layer — steps + attestation are fetched on open.
// (We do NOT invent endpoints: these are the real exported functions.)
// ---------------------------------------------------------------------------
const { fetchStepsMock, fetchAttestationMock } = vi.hoisted(() => ({
  fetchStepsMock: vi.fn(),
  fetchAttestationMock: vi.fn(),
}));

vi.mock('@/lib/clario-dr', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/clario-dr')>();
  return {
    ...actual,
    fetchDRFailoverSteps: fetchStepsMock,
    fetchDRFailoverAttestation: fetchAttestationMock,
  };
});

// Silence the sonner-backed toast layer in the export handlers.
vi.mock('@/lib/toast', () => ({
  showSuccess: vi.fn(),
  showError: vi.fn(),
}));

import { ExportEvidencePack } from './export-evidence-pack';

// ---------------------------------------------------------------------------
// Real-shaped fixtures.
// ---------------------------------------------------------------------------
const RUN: DRFailoverRun = {
  id: 'run-export-1',
  tenant_id: 'tenant-1',
  group_id: 'grp-1',
  mode: 'live',
  status: 'COMPLETED',
  recovery_point_id: 'rp-1',
  rto_objective_seconds: 900,
  initiated_by: 'op@clario.dev',
  approved_by: 'boss@clario.dev',
  initiated_at: '2026-06-15T09:00:00.000Z',
  completed_at: '2026-06-15T09:12:00.000Z',
  rto_actual_seconds: 720,
  last_error: null,
  claimed_at: null,
  updated_at: '2026-06-15T09:12:00.000Z',
};

const ACTIVE_RUN: DRFailoverRun = {
  ...RUN,
  id: 'run-active-2',
  status: 'EXECUTING',
  completed_at: null,
  rto_actual_seconds: null,
};

const STEPS: DRFailoverStep[] = [
  {
    id: 's1',
    run_id: RUN.id,
    step: 'gate1.validate',
    status: 'passed',
    started_at: '2026-06-15T09:01:00.000Z',
    finished_at: '2026-06-15T09:02:00.000Z',
  },
];

const LEDGER: DRAttestationLedgerEntry[] = [
  {
    id: 'e1',
    tenant_id: 'tenant-1',
    seq: 1,
    entry_type: 'failover_attestation',
    subject_id: RUN.id,
    payload: { run_id: RUN.id },
    payload_hash: 'ph-1',
    prev_hash: '',
    entry_hash: 'eh-1',
    anchored_root: 'merkle-root',
    created_at: '2026-06-15T09:12:10.000Z',
  },
];

const VERIFY: DRAttestationLedgerVerifyResult = {
  intact: true,
  entries_checked: 1,
  head_hash: 'eh-1',
  reason: 'chain intact',
};

describe('ExportEvidencePack', () => {
  beforeEach(() => {
    fetchStepsMock.mockReset().mockResolvedValue(STEPS);
    fetchAttestationMock.mockReset().mockRejectedValue(new Error('no attestation'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the export action and offers only terminal runs in the picker', () => {
    renderWithQuery(
      <ExportEvidencePack
        runs={[RUN, ACTIVE_RUN]}
        ledgerEntries={LEDGER}
        verification={VERIFY}
        groupName="Payments core"
        generatedBy="op@clario.dev"
      />,
    );

    expect(screen.getByText('One-click evidence pack')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Export evidence pack/i })).toBeInTheDocument();
    // The run selector defaults to the (only) terminal run.
    expect(screen.getByText(/run-export-1 ·/)).toBeInTheDocument();
  });

  it('shows an empty state when there are no terminal runs', () => {
    renderWithQuery(
      <ExportEvidencePack runs={[ACTIVE_RUN]} ledgerEntries={LEDGER} verification={VERIFY} />,
    );
    expect(
      screen.getByText(/can be exported as an evidence pack here/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Export evidence pack/i })).not.toBeInTheDocument();
  });

  it('opens the dialog, assembles the pack from fetched steps, and wires the JSON download', async () => {
    const createObjectURL = vi.fn<(obj: Blob | MediaSource) => string>(() => 'blob:mock-url');
    const revokeObjectURL = vi.fn<(url: string) => void>();
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, configurable: true });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    const user = userEvent.setup();
    renderWithQuery(
      <ExportEvidencePack
        runs={[RUN]}
        ledgerEntries={LEDGER}
        verification={VERIFY}
        groupName="Payments core"
        generatedBy="op@clario.dev"
      />,
    );

    await user.click(screen.getByRole('button', { name: /Export evidence pack/i }));

    // The real steps fetch is invoked for the selected run.
    await waitFor(() => expect(fetchStepsMock).toHaveBeenCalledWith(RUN.id));

    const dialog = await screen.findByRole('dialog');
    // The assembled pack is previewed (branded heading + RTO verdict + run id).
    await waitFor(() =>
      expect(within(dialog).getByText('ClarioDR recovery evidence pack')).toBeInTheDocument(),
    );
    expect(within(dialog).getAllByText('RTO met').length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText(RUN.id).length).toBeGreaterThan(0);

    // Download JSON -> Blob created, anchor clicked, object URL revoked.
    const downloadButton = within(dialog).getByRole('button', { name: /Download JSON/i });
    expect(downloadButton).not.toBeDisabled();
    await user.click(downloadButton);

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blobArg = createObjectURL.mock.calls[0][0] as Blob;
    expect(blobArg).toBeInstanceOf(Blob);
    expect(blobArg).toBeDefined();
    expect(blobArg.type).toBe('application/json');
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
  });

  it('opens a print window with the standalone report on "Print / Save as PDF"', async () => {
    const printMock = vi.fn();
    const writeMock = vi.fn();
    const printWindow = {
      document: { open: vi.fn(), write: writeMock, close: vi.fn() },
      focus: vi.fn(),
      print: printMock,
      addEventListener: (event: string, cb: () => void) => {
        if (event === 'load') cb();
      },
    } as unknown as Window;
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(printWindow);

    const user = userEvent.setup();
    renderWithQuery(
      <ExportEvidencePack runs={[RUN]} ledgerEntries={LEDGER} verification={VERIFY} />,
    );

    await user.click(screen.getByRole('button', { name: /Export evidence pack/i }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() =>
      expect(within(dialog).getByText('ClarioDR recovery evidence pack')).toBeInTheDocument(),
    );

    await user.click(within(dialog).getByRole('button', { name: /Print \/ Save as PDF/i }));

    expect(openSpy).toHaveBeenCalled();
    expect(writeMock).toHaveBeenCalledTimes(1);
    expect(writeMock.mock.calls[0][0]).toContain('<!DOCTYPE html>');
    expect(printMock).toHaveBeenCalledTimes(1);
  });
});
