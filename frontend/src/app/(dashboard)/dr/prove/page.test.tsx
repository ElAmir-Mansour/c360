import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import type {
  DRAttestationLedgerEntry,
  DRAttestationLedgerVerifyResult,
} from '@/types/clario-dr';

// ---------------------------------------------------------------------------
// next/navigation — the page (via useDRSelection) reads useSearchParams etc.
// ---------------------------------------------------------------------------
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => '/dr/prove',
  useSearchParams: () => new URLSearchParams('group=g1'),
}));

// ---------------------------------------------------------------------------
// Auth gating — mutable so individual tests can flip the dr:write verdict.
// ---------------------------------------------------------------------------
const { hasPermissionMock } = vi.hoisted(() => ({
  hasPermissionMock: vi.fn<(perm: string) => boolean>(() => true),
}));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ hasPermission: hasPermissionMock, user: { id: 'u1' } }),
}));

// ---------------------------------------------------------------------------
// Shared evidence-action hook — spy on the wired mutations.
// ---------------------------------------------------------------------------
const {
  ledgerProofMock,
  anchorLedgerMock,
  assessBcmMock,
  setSelectedSeqMock,
  setProofMock,
} = vi.hoisted(() => ({
  ledgerProofMock: vi.fn(),
  anchorLedgerMock: vi.fn(),
  assessBcmMock: vi.fn(),
  setSelectedSeqMock: vi.fn(),
  setProofMock: vi.fn(),
}));

vi.mock('@/app/(dashboard)/dr/_hooks/use-dr-actions', () => ({
  useEvidenceActions: () => ({
    ledgerProof: ledgerProofMock,
    proofLoading: false,
    ledgerProofError: null,
    proof: null,
    setProof: setProofMock,
    selectedSeq: null,
    setSelectedSeq: setSelectedSeqMock,

    anchorLedger: anchorLedgerMock,
    anchorLoading: false,
    anchorLedgerError: null,
    checkpoint: null,

    assessBcm: assessBcmMock,
    assessingBcm: false,
    assessBcmError: null,
    latestBcmAssessment: null,
  }),
}));

// ---------------------------------------------------------------------------
// Shared selection hook — return a stable selected group.
// ---------------------------------------------------------------------------
vi.mock('@/app/(dashboard)/dr/_lib/dr-selection', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/(dashboard)/dr/_lib/dr-selection')>();
  return {
    ...actual,
    useDRSelection: () => ({
      groupId: 'g1',
      streamId: null,
      activeGroupId: 'g1',
      activeStreamId: null,
      setGroup: vi.fn(),
      setStream: vi.fn(),
    }),
  };
});

// ---------------------------------------------------------------------------
// Shared query hooks — feed the page realistic data with no network.
// ---------------------------------------------------------------------------
const LEDGER_ENTRIES: DRAttestationLedgerEntry[] = [
  {
    id: 'entry-1',
    tenant_id: 't1',
    seq: 1,
    entry_type: 'failover_attestation',
    subject_id: 'run-aaaa-1111',
    payload: { result: 'healthy', run_id: 'run-aaaa-1111' },
    payload_hash: 'payloadhash000000000000000000000001',
    prev_hash: '',
    entry_hash: 'entryhash0000000000000000000000000001',
    anchored_root: null,
    created_at: '2026-06-10T10:00:00.000Z',
  },
  {
    id: 'entry-2',
    tenant_id: 't1',
    seq: 2,
    entry_type: 'drill_attestation',
    subject_id: 'run-bbbb-2222',
    payload: { result: 'healthy', run_id: 'run-bbbb-2222' },
    payload_hash: 'payloadhash000000000000000000000002',
    prev_hash: 'entryhash0000000000000000000000000001',
    entry_hash: 'entryhash0000000000000000000000000002',
    anchored_root: null,
    created_at: '2026-06-11T10:00:00.000Z',
  },
];

const VERIFY_INTACT: DRAttestationLedgerVerifyResult = {
  intact: true,
  entries_checked: 2,
  head_hash: 'entryhash0000000000000000000000000002',
  reason: 'chain intact',
};

vi.mock('@/app/(dashboard)/dr/_hooks/use-dr-queries', () => ({
  useDRPosture: () => ({
    data: { groups: [{ group_id: 'g1', name: 'Payments core' }] },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useDRAttestationLedger: () => ({ data: LEDGER_ENTRIES, isLoading: false, error: null, refetch: vi.fn() }),
  useDRLedgerVerify: () => ({ data: VERIFY_INTACT, isLoading: false, error: null, refetch: vi.fn() }),
  useDRBCMPacks: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
  useDRFailoverRuns: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
  useDRGroupSummary: () => ({
    data: { group_id: 'g1', name: 'Payments core' },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

// Import AFTER the mocks are registered.
import DRProvePage from './page';

describe('DRProvePage', () => {
  beforeEach(() => {
    hasPermissionMock.mockReset();
    hasPermissionMock.mockReturnValue(true);
    ledgerProofMock.mockReset();
    anchorLedgerMock.mockReset();
    assessBcmMock.mockReset();
    setSelectedSeqMock.mockReset();
    setProofMock.mockReset();
  });

  it('renders the attestation ledger via AuditTrailTable from the mocked query', () => {
    renderWithQuery(<DRProvePage />);

    // PageHeader.
    expect(screen.getByRole('heading', { name: 'Prove' })).toBeInTheDocument();

    // AuditTrailTable rendered the real ledger entries (subject ids + types).
    // The desktop data table renders an accessible <caption> from the labels.
    expect(
      screen.getAllByText(/Attestation ledger/i).length,
    ).toBeGreaterThan(0);
    // Subject ids from the ledger entries are present (rendered by AuditTrailTable).
    expect(screen.getAllByText('run-aaaa-1111').length).toBeGreaterThan(0);
    expect(screen.getAllByText('run-bbbb-2222').length).toBeGreaterThan(0);
    // Entry-type labels resolved by AuditTrailTable's DEFAULT_ENTRY_TYPE_META.
    expect(screen.getAllByText('Failover attestation').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Drill attestation').length).toBeGreaterThan(0);
  });

  it('fires the wired proof mutation when an inclusion-proof action is clicked (dr:write granted)', () => {
    renderWithQuery(<DRProvePage />);

    // The attestation actions panel (inside the write gate) exposes per-row
    // "Proof" buttons. With dr:write granted, the fieldset is not disabled.
    const proofButtons = screen.getAllByRole('button', { name: /^Proof$/ });
    expect(proofButtons.length).toBeGreaterThan(0);

    fireEvent.click(proofButtons[0]);

    // The panel calls onSelectSeq(seq) then onFetchProof(seq) -> evidence.ledgerProof(seq).
    expect(ledgerProofMock).toHaveBeenCalledTimes(1);
    expect(ledgerProofMock).toHaveBeenCalledWith(expect.any(Number));
    expect(setSelectedSeqMock).toHaveBeenCalled();
  });

  it('fires the wired anchor mutation when "Anchor ledger" is clicked (dr:write granted)', () => {
    renderWithQuery(<DRProvePage />);

    // Verification is intact + there are unanchored entries -> anchor is enabled.
    const anchorButton = screen.getByRole('button', { name: /Anchor ledger/i });
    expect(anchorButton).not.toBeDisabled();

    fireEvent.click(anchorButton);

    expect(anchorLedgerMock).toHaveBeenCalledTimes(1);
  });

  it('gates the anchor write action behind dr:write (denied path disables the control)', async () => {
    hasPermissionMock.mockReturnValue(false);

    const user = userEvent.setup();
    renderWithQuery(<DRProvePage />);

    // The DRWriteGate renders an explanatory read-only notice...
    expect(screen.getAllByText('Read-only access').length).toBeGreaterThan(0);

    // ...and disables every descendant control by wrapping them in a disabled
    // <fieldset>. The anchor button must therefore be disabled, and a real user
    // click (which respects the disabled state) must not fire the mutation.
    const anchorButton = screen.getByRole('button', { name: /Anchor ledger/i });
    expect(anchorButton).toBeDisabled();

    await user.click(anchorButton);
    expect(anchorLedgerMock).not.toHaveBeenCalled();

    // The read-only ledger itself is still rendered (read access preserved).
    expect(screen.getAllByText('run-aaaa-1111').length).toBeGreaterThan(0);
  });
});
