import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import type {
  DRBCMPack,
  DRBYOKKey,
  DRCyberVault,
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
  usePathname: () => '/dr/readiness',
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
// Toast — the readiness page's `guard()` calls showWarning when denied.
// `vi.hoisted` keeps the spy available to the hoisted vi.mock factory.
// ---------------------------------------------------------------------------
const { showWarningMock } = vi.hoisted(() => ({ showWarningMock: vi.fn() }));
vi.mock('@/lib/toast', () => ({
  showWarning: showWarningMock,
  showError: vi.fn(),
  showSuccess: vi.fn(),
  showInfo: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Shared action hooks — spy on the wired readiness mutations.
// ---------------------------------------------------------------------------
const { rotateByokMock, evaluateVaultMock, assessBcmMock } = vi.hoisted(() => ({
  rotateByokMock: vi.fn(),
  evaluateVaultMock: vi.fn(),
  assessBcmMock: vi.fn(),
}));

vi.mock('@/app/(dashboard)/dr/_hooks/use-dr-actions', () => ({
  // Readiness page also pulls assessBcm from the evidence hook.
  useEvidenceActions: () => ({
    assessBcm: assessBcmMock,
    assessingBcm: false,
    assessBcmError: null,
    latestBcmAssessment: null,
  }),
  // Everything the readiness route reaches through useReadinessActions.
  useReadinessActions: () => ({
    rotateByok: rotateByokMock,
    rotatingByok: false,
    rotateByokError: null,
    latestByokKey: null,

    evaluateVault: evaluateVaultMock,
    evaluatingVault: false,
    evaluateVaultError: null,
    latestVaultAssessment: null,

    ingestIac: vi.fn(),
    ingestingIac: false,
    ingestIacError: null,
    loadIacDiff: vi.fn(),
    loadingIacDiff: false,
    loadIacDiffError: null,
    latestIacDiff: null,
    loadIacPlan: vi.fn(),
    loadingIacPlan: false,
    loadIacPlanError: null,
    latestIacPlan: null,

    requestStorageSnapshot: vi.fn(),
    requestingSnapshot: false,
    requestStorageSnapshotError: null,
    replicateStorageSnapshot: vi.fn(),
    replicatingSnapshot: false,
    replicateStorageSnapshotError: null,
    latestStorageSnapshot: null,

    runWorkloadCapture: vi.fn(),
    runningCapture: false,
    runWorkloadCaptureError: null,
    latestWorkloadEpoch: null,

    assessSelfDR: vi.fn(),
    assessingSelfDR: false,
    assessSelfDRError: null,
    captureBackup: vi.fn(),
    capturingBackup: false,
    captureBackupError: null,
    generateBundle: vi.fn(),
    generatingBundle: false,
    generateBundleError: null,
    latestSelfDRArtifact: null,

    regenerateRunbook: vi.fn(),
    regeneratingRunbook: false,
    regenerateRunbookError: null,

    askCopilot: vi.fn(),
    askingCopilot: false,
    askCopilotError: null,
    copilotResult: null,
    loadTranscript: vi.fn(),
    transcriptLoading: false,
    loadTranscriptError: null,
    copilotTranscript: null,
  }),
}));

// ---------------------------------------------------------------------------
// Shared selection hook — return a stable selected group/stream.
// ---------------------------------------------------------------------------
vi.mock('@/app/(dashboard)/dr/_lib/dr-selection', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/(dashboard)/dr/_lib/dr-selection')>();
  return {
    ...actual,
    useDRSelection: () => ({
      groupId: 'g1',
      streamId: 's1',
      activeGroupId: 'g1',
      activeStreamId: 's1',
      setGroup: vi.fn(),
      setStream: vi.fn(),
    }),
  };
});

// ---------------------------------------------------------------------------
// Realistic mock data using the real types.
// ---------------------------------------------------------------------------
const BCM_PACKS: DRBCMPack[] = [
  {
    key: 'nca-ecc',
    standard: 'NCA ECC',
    version: '2.0',
    authority: 'NCA',
    title: 'Essential Cybersecurity Controls',
    description: 'Saudi NCA Essential Cybersecurity Controls pack.',
    controls: [],
  },
];

const BYOK_KEYS: DRBYOKKey[] = [
  {
    id: 'key-1',
    tenant_id: 't1',
    key_version: 3,
    provider: 'aws_kms',
    reference: 'arn:aws:kms:me-central-1:key/abc',
    state: 'active',
    created_at: '2026-06-01T00:00:00.000Z',
    activated_at: '2026-06-01T00:00:00.000Z',
    retired_at: null,
    updated_at: '2026-06-10T00:00:00.000Z',
  },
];

const CYBER_VAULTS: DRCyberVault[] = [
  {
    id: 'vault-1',
    tenant_id: 't1',
    group_id: 'g1',
    provider: 's3_object_lock',
    name: 'Riyadh immutable vault',
    posture: {
      provider: 's3_object_lock',
      primary_region: 'me-central-1',
      immutability_enabled: true,
      vault_lock_enabled: true,
      customer_managed_key: true,
      break_glass_mfa: true,
      last_restore_test_passed: true,
      break_glass_enabled: true,
      approval: {
        require_restore_approval: true,
        restore_approvers: 2,
        require_destructive_approval: true,
        destructive_approvers: 2,
        separation_of_duties: true,
      },
      retention: { minimum_days: 30 },
      isolation: { cross_account: true, disjoint_admins: true, source_admin_denied: true },
    } as DRCyberVault['posture'],
  },
];

const q = (data: unknown) => ({ data, isLoading: false, error: null, refetch: vi.fn() });

vi.mock('@/app/(dashboard)/dr/_hooks/use-dr-queries', () => ({
  useDRPosture: () => q({ groups: [{ group_id: 'g1', name: 'Payments core' }], recovery_point_count: 4, attention: [] }),
  useDRReplicationSummary: () => q(null),
  useDRGroupSummary: () => q({ group_id: 'g1', name: 'Payments core' }),

  // Sovereign-readiness data.
  useDRBCMPacks: () => q(BCM_PACKS),
  useDRBYOKKeys: () => q(BYOK_KEYS),
  useDRBYOKCustodyLog: () => q(null),
  useDRCyberVaults: () => q({ vaults: CYBER_VAULTS, count: 1 }),
  useDRCyberVaultAssessments: () => q({ assessments: [], count: 0 }),
  useDRAttestationLedger: () => q([]),
  useDRFailoverRuns: () => q([]),

  // Coverage / Self-DR data.
  useDRIaCSnapshots: () => q(null),
  useDRStorageVolumes: () => q([]),
  useDRWorkloadCaptures: () => q([]),
  useDRWorkloadEpochs: () => q([]),
  useDRSelfDRComponents: () => q(null),
  useDRSelfDRLatest: () => q(null),
  useDRSelfDRArtifacts: () => q([]),

  // Intelligence data.
  useDRGroupRecoveryPoints: () => q([]),
  useDRPredictions: () => q([]),
  useDRRansomwareSignals: () => q([]),
  useDRStreamForecast: () => q(null),
  useDRStreamRansomwareSignals: () => q([]),
  useDRCleanRoomScan: () => q(null),
  useDRRegistryRunbook: () => q(null),
  useDRRegistryRunbookVersions: () => q([]),

  // Recovery-tier catalog (intelligence plane advisor).
  useDRRecoveryTiers: () => q([]),
  useDRSites: () => q([]),
}));

// Import AFTER the mocks are registered.
import DRReadinessPage from './page';

describe('DRReadinessPage', () => {
  beforeEach(() => {
    hasPermissionMock.mockReset();
    hasPermissionMock.mockReturnValue(true);
    rotateByokMock.mockReset();
    evaluateVaultMock.mockReset();
    assessBcmMock.mockReset();
    showWarningMock.mockReset();
  });

  it('renders the sovereign readiness sections from the mocked queries', () => {
    renderWithQuery(<DRReadinessPage />);

    expect(screen.getByRole('heading', { name: 'Readiness' })).toBeInTheDocument();

    // Inner tabs.
    expect(screen.getByRole('tab', { name: /Sovereign readiness/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Coverage & Self-DR/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Intelligence/i })).toBeInTheDocument();

    // SovereignReadinessPanel content.
    expect(screen.getByText('Readiness controls')).toBeInTheDocument();
    expect(screen.getByText('Framework coverage')).toBeInTheDocument();

    // DRSovereignActionsPanel write controls render (within the sovereign tab).
    expect(screen.getByRole('button', { name: 'Rotate BYOK key' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Evaluate cyber vault' })).toBeInTheDocument();
  });

  it('calls useReadinessActions.rotateByok when "Rotate BYOK key" is clicked (dr:write granted)', () => {
    renderWithQuery(<DRReadinessPage />);

    const rotateButton = screen.getByRole('button', { name: 'Rotate BYOK key' });
    expect(rotateButton).not.toBeDisabled();

    fireEvent.click(rotateButton);

    expect(rotateByokMock).toHaveBeenCalledTimes(1);
    expect(showWarningMock).not.toHaveBeenCalled();
  });

  it('calls useReadinessActions.evaluateVault with the vault id when "Evaluate cyber vault" is clicked (dr:write granted)', () => {
    renderWithQuery(<DRReadinessPage />);

    const evaluateButton = screen.getByRole('button', { name: 'Evaluate cyber vault' });
    // selectedVault has an id, so the action button is enabled.
    expect(evaluateButton).not.toBeDisabled();

    fireEvent.click(evaluateButton);

    expect(evaluateVaultMock).toHaveBeenCalledTimes(1);
    expect(evaluateVaultMock).toHaveBeenCalledWith('vault-1');
  });

  it('gates the BYOK rotation behind dr:write (denied path blocks the mutation and warns)', () => {
    hasPermissionMock.mockReturnValue(false);

    renderWithQuery(<DRReadinessPage />);

    // The page surfaces the read-only banner.
    expect(screen.getByText('Read-only access')).toBeInTheDocument();

    const rotateButton = screen.getByRole('button', { name: 'Rotate BYOK key' });
    fireEvent.click(rotateButton);

    // The guard short-circuits: the real mutation never fires and the operator
    // gets an explanatory warning toast.
    expect(rotateByokMock).not.toHaveBeenCalled();
    expect(showWarningMock).toHaveBeenCalledTimes(1);
    expect(showWarningMock).toHaveBeenCalledWith(
      'Write action blocked',
      'Requires the dr:write permission',
    );
  });

  it('renders the page chrome in Arabic under the ar locale (RTL surface)', () => {
    renderWithQuery(<DRReadinessPage />, { locale: 'ar' });

    // Page header + inner-tab labels resolve to professional MSA; the English
    // surface is gone (the LocaleProvider drives the RTL/Arabic resolution that
    // the root layout renders inside a `dir="rtl"` document).
    expect(screen.getByRole('heading', { name: 'الجاهزية' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'الجاهزية السيادية' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'التغطية والتعافي الذاتي' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'الذكاء' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Readiness' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Intelligence' })).not.toBeInTheDocument();
  });

  it('gates the BYOK rotation with an Arabic warning toast under the ar locale', () => {
    hasPermissionMock.mockReturnValue(false);

    renderWithQuery(<DRReadinessPage />, { locale: 'ar' });

    // The read-only banner is in Arabic.
    expect(screen.getByText('وصول للقراءة فقط')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'تدوير مفتاح BYOK' }));

    // The guard still blocks the mutation; the warning copy is the MSA wording.
    expect(rotateByokMock).not.toHaveBeenCalled();
    expect(showWarningMock).toHaveBeenCalledWith(
      'تم حظر إجراء الكتابة',
      'يتطلّب صلاحية الكتابة (dr:write)',
    );
  });
});
