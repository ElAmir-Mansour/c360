import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import type {
  DRAttestationLedgerEntry,
  DRAttestationLedgerInclusionProof,
  DRAttestationLedgerVerifyResult,
} from '@/types/clario-dr';

// ---------------------------------------------------------------------------
// next/navigation — the route renders Links; provide a stable router shim.
// ---------------------------------------------------------------------------
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => '/dr/prove/ledger',
  useSearchParams: () => new URLSearchParams(''),
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
// Shared evidence-action hook — spy on the wired mutations + proof state.
// `proof` / `selectedSeq` are mutable so a test can simulate a loaded proof.
// ---------------------------------------------------------------------------
const {
  ledgerProofMock,
  anchorLedgerMock,
  setSelectedSeqMock,
  setProofMock,
  evidenceState,
} = vi.hoisted(() => ({
  ledgerProofMock: vi.fn(),
  anchorLedgerMock: vi.fn(),
  setSelectedSeqMock: vi.fn(),
  setProofMock: vi.fn(),
  evidenceState: {
    proof: null as DRAttestationLedgerInclusionProof | null,
    selectedSeq: null as number | null,
    proofLoading: false,
    anchorLoading: false,
    checkpoint: null,
  },
}));

vi.mock('@/app/(dashboard)/dr/_hooks/use-dr-actions', () => ({
  useEvidenceActions: () => ({
    ledgerProof: ledgerProofMock,
    proofLoading: evidenceState.proofLoading,
    ledgerProofError: null,
    proof: evidenceState.proof,
    setProof: setProofMock,
    selectedSeq: evidenceState.selectedSeq,
    setSelectedSeq: setSelectedSeqMock,

    anchorLedger: anchorLedgerMock,
    anchorLoading: evidenceState.anchorLoading,
    anchorLedgerError: null,
    checkpoint: evidenceState.checkpoint,

    assessBcm: vi.fn(),
    assessingBcm: false,
    assessBcmError: null,
    latestBcmAssessment: null,
  }),
}));

// ---------------------------------------------------------------------------
// Shared query hooks — feed the explorer realistic ledger data with no network.
// `useDRAttestationLedger` records the filters it was called with so a test can
// assert that applying a filter scopes the query.
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
    anchored_root: 'anchorroot00000000000000000000000aaa',
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

const { ledgerHookSpy } = vi.hoisted(() => ({
  ledgerHookSpy: vi.fn(),
}));

vi.mock('@/app/(dashboard)/dr/_hooks/use-dr-queries', () => ({
  useDRAttestationLedger: (filters?: unknown) => {
    ledgerHookSpy(filters);
    return { data: LEDGER_ENTRIES, isLoading: false, isFetching: false, error: null, refetch: vi.fn() };
  },
  useDRLedgerVerify: () => ({
    data: VERIFY_INTACT,
    isLoading: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

// Import AFTER the mocks are registered.
import DRLedgerExplorerPage from './page';

describe('DRLedgerExplorerPage', () => {
  beforeEach(() => {
    hasPermissionMock.mockReset();
    hasPermissionMock.mockReturnValue(true);
    ledgerProofMock.mockReset();
    anchorLedgerMock.mockReset();
    setSelectedSeqMock.mockReset();
    setProofMock.mockReset();
    ledgerHookSpy.mockReset();
    evidenceState.proof = null;
    evidenceState.selectedSeq = null;
    evidenceState.proofLoading = false;
    evidenceState.anchorLoading = false;
    evidenceState.checkpoint = null;
  });

  it('renders the ledger entries (via AuditTrailTable) and the chain-verify verdict', () => {
    renderWithQuery(<DRLedgerExplorerPage />);

    // Page header.
    expect(
      screen.getByRole('heading', { name: /Attestation ledger explorer/i }),
    ).toBeInTheDocument();

    // Real subject ids rendered by AuditTrailTable + the proof companion table.
    expect(screen.getAllByText('run-aaaa-1111').length).toBeGreaterThan(0);
    expect(screen.getAllByText('run-bbbb-2222').length).toBeGreaterThan(0);

    // Entry-type labels resolved by AuditTrailTable's DEFAULT_ENTRY_TYPE_META.
    expect(screen.getAllByText('Failover attestation').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Drill attestation').length).toBeGreaterThan(0);

    // Ledger-wide verify verdict (intact).
    expect(screen.getByText('Chain intact')).toBeInTheDocument();
    expect(screen.getByText('chain intact')).toBeInTheDocument();
  });

  it('applies a subject filter and re-scopes the ledger query', async () => {
    const user = userEvent.setup();
    renderWithQuery(<DRLedgerExplorerPage />);

    // First call: default filters (limit 50, no type/subject).
    expect(ledgerHookSpy).toHaveBeenCalled();
    ledgerHookSpy.mockClear();

    const subjectInput = screen.getByPlaceholderText(/Subject id contains/i);
    await user.type(subjectInput, 'run-aaaa');

    const applyButton = screen.getByRole('button', { name: /Apply filters/i });
    await user.click(applyButton);

    // The query hook is re-invoked with the subject in the server filters.
    const lastCall = ledgerHookSpy.mock.calls.at(-1)?.[0];
    expect(lastCall).toMatchObject({ subject: 'run-aaaa', limit: 50 });

    // The active-filter chip surfaces the applied subject.
    expect(screen.getByText('Subject: run-aaaa')).toBeInTheDocument();
  });

  it('applies a client-side seq-range filter over the fetched window', async () => {
    const user = userEvent.setup();
    renderWithQuery(<DRLedgerExplorerPage />);

    // Restrict to seq >= 2 -> only the second entry remains.
    const seqFrom = screen.getByLabelText('Seq from');
    await user.type(seqFrom, '2');
    await user.click(screen.getByRole('button', { name: /Apply filters/i }));

    // seq 1's subject is filtered out; seq 2's subject remains.
    expect(screen.queryByText('run-aaaa-1111')).not.toBeInTheDocument();
    expect(screen.getAllByText('run-bbbb-2222').length).toBeGreaterThan(0);
  });

  it('fires the wired proof mutation when a per-entry "Verify proof" action is clicked', () => {
    renderWithQuery(<DRLedgerExplorerPage />);

    const proofButtons = screen.getAllByRole('button', { name: /Verify proof/i });
    expect(proofButtons.length).toBeGreaterThan(0);

    fireEvent.click(proofButtons[0]);

    // Page handler selects the seq, clears any stale proof, then fetches.
    expect(setSelectedSeqMock).toHaveBeenCalledWith(expect.any(Number));
    expect(setProofMock).toHaveBeenCalled();
    expect(ledgerProofMock).toHaveBeenCalledTimes(1);
    expect(ledgerProofMock).toHaveBeenCalledWith(expect.any(Number));
  });

  it('renders the inclusion-proof Merkle path and verified badge when a proof is loaded', () => {
    evidenceState.selectedSeq = 2;
    evidenceState.proof = {
      seq: 2,
      leaf_index: 1,
      leaf_hash: 'leafhash00000000000000000000000000002',
      path: [
        { hash: 'sibling0000000000000000000000000000a', left: true },
        { hash: 'sibling0000000000000000000000000000b', left: false },
      ],
      root: 'merkleroot0000000000000000000000000z',
      from_seq: 1,
      to_seq: 2,
    };

    renderWithQuery(<DRLedgerExplorerPage />);

    const proofRegion = screen.getByRole('region', { name: /Inclusion proof/i });
    // Verified badge (well-formed proof within a consistent window).
    expect(within(proofRegion).getByText('Inclusion verified')).toBeInTheDocument();
    // The two Merkle sibling nodes are listed with their hashes + ordering.
    expect(within(proofRegion).getByText('sibling0000000000000000000000000000a')).toBeInTheDocument();
    expect(within(proofRegion).getByText('sibling0000000000000000000000000000b')).toBeInTheDocument();
    expect(within(proofRegion).getByText('Left sibling')).toBeInTheDocument();
    expect(within(proofRegion).getByText('Right sibling')).toBeInTheDocument();
  });

  it('fires the anchor mutation when "Anchor now" is clicked (dr:write granted)', () => {
    renderWithQuery(<DRLedgerExplorerPage />);

    // Verification intact + one unanchored entry (seq 2) -> anchor enabled.
    const anchorButton = screen.getByRole('button', { name: /Anchor now/i });
    expect(anchorButton).not.toBeDisabled();

    fireEvent.click(anchorButton);
    expect(anchorLedgerMock).toHaveBeenCalledTimes(1);
  });

  it('gates the anchor action behind dr:write (denied path disables and shows a notice)', async () => {
    hasPermissionMock.mockReturnValue(false);

    const user = userEvent.setup();
    renderWithQuery(<DRLedgerExplorerPage />);

    // The read-only notice is shown and the anchor control is disabled.
    expect(
      screen.getByText(/Anchoring ledger checkpoints to WORM storage requires the dr:write permission/i),
    ).toBeInTheDocument();

    const anchorButton = screen.getByRole('button', { name: /Anchor now/i });
    expect(anchorButton).toBeDisabled();

    await user.click(anchorButton);
    expect(anchorLedgerMock).not.toHaveBeenCalled();

    // Read access to the ledger is preserved.
    expect(screen.getAllByText('run-aaaa-1111').length).toBeGreaterThan(0);
  });
});
