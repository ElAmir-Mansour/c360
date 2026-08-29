import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import type {
  DRAssuranceAssessmentReport,
  DRAssuranceControlInfo,
  DRBCMAssessmentRunResponse,
  DRBCMPack,
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
  usePathname: () => '/dr/prove/compliance',
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
// Shared evidence-action hook — spy on the BCM assess mutation. Mutable so a
// test can supply a latest assessment result.
// ---------------------------------------------------------------------------
const { assessBcmMock, latestBcmRef } = vi.hoisted(() => ({
  assessBcmMock: vi.fn(),
  latestBcmRef: { current: null as DRBCMAssessmentRunResponse | null },
}));

vi.mock('@/app/(dashboard)/dr/_hooks/use-dr-actions', () => ({
  useEvidenceActions: () => ({
    ledgerProof: vi.fn(),
    proofLoading: false,
    ledgerProofError: null,
    proof: null,
    setProof: vi.fn(),
    selectedSeq: null,
    setSelectedSeq: vi.fn(),

    anchorLedger: vi.fn(),
    anchorLoading: false,
    anchorLedgerError: null,
    checkpoint: null,

    assessBcm: assessBcmMock,
    assessingBcm: false,
    assessBcmError: null,
    latestBcmAssessment: latestBcmRef.current,
  }),
}));

// ---------------------------------------------------------------------------
// Shared selection hook — return a stable selected group.
// ---------------------------------------------------------------------------
vi.mock('@/app/(dashboard)/dr/_lib/dr-selection', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/app/(dashboard)/dr/_lib/dr-selection')>();
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
// Real-shaped fixtures.
// ---------------------------------------------------------------------------
const BCM_PACKS: DRBCMPack[] = [
  {
    key: 'nca-ecc',
    standard: 'NCA ECC',
    version: '2.0',
    authority: 'National Cybersecurity Authority',
    title: 'NCA Essential Cybersecurity Controls',
    description: 'Kingdom of Saudi Arabia essential cybersecurity controls — BC/DR domain.',
    controls: [
      {
        code: 'ECC-2-5-1',
        title: 'Recovery drill recency',
        description: 'Drills executed within the required window.',
        required_evidence: ['drill'],
        rule: { kind: 'drill_recency', window_days: 90, min_count: 1 },
        weight: 1,
        mandatory: true,
      },
    ],
  },
  {
    key: 'sama-bcm',
    standard: 'SAMA BCM',
    version: '1.0',
    authority: 'Saudi Central Bank',
    title: 'SAMA Business Continuity Management',
    description: 'SAMA business continuity management framework controls.',
    controls: [
      {
        code: 'BCM-3-1',
        title: 'RTO met',
        description: 'Recovery time objective satisfied during drills.',
        required_evidence: ['attestation'],
        rule: { kind: 'rto_met', rto_objective_seconds: 900 },
        weight: 2,
        mandatory: true,
      },
    ],
  },
];

const BCM_ASSESSMENT: DRBCMAssessmentRunResponse = {
  assessment: {
    id: 'bcm-assess-1',
    tenant_id: 't1',
    group_id: 'g1',
    pack_key: 'nca-ecc',
    standard: 'NCA ECC',
    pack_version: '2.0',
    score: 72,
    compliant: false,
    total_controls: 3,
    satisfied: 1,
    partial: 1,
    failed: 1,
    created_by: 'u1',
    created_at: '2026-06-12T09:00:00.000Z',
  },
  score: 72,
  compliant: false,
  controls: [
    {
      code: 'ECC-2-5-1',
      title: 'Recovery drill recency',
      verdict: 'failed',
      reason: 'No drill executed in the last 90 days.',
      mandatory: true,
      weight: 1,
      evidence_refs: [],
    },
    {
      code: 'ECC-2-5-2',
      title: 'Recovery point validated',
      verdict: 'satisfied',
      reason: 'Latest recovery point validated.',
      mandatory: true,
      weight: 1,
    },
  ],
  gaps: [
    {
      code: 'ECC-2-5-1',
      title: 'Recovery drill recency',
      verdict: 'failed',
      reason: 'No drill executed in the last 90 days.',
      mandatory: true,
    },
  ],
};

const ASSURANCE_CONTROLS: DRAssuranceControlInfo[] = [
  { code: 'ASR-RPO', title: 'RPO within objective', weight: 2, fail_severity: 'high' },
  { code: 'ASR-IMMUT', title: 'Immutability enabled', weight: 1, fail_severity: 'critical' },
];

const ASSURANCE_REPORT: DRAssuranceAssessmentReport = {
  assessment: {
    id: 'asr-1',
    tenant_id: 't1',
    group_id: 'g1',
    score: 80,
    verdict: 'partial',
    total_checks: 2,
    satisfied: 1,
    partial: 0,
    failed: 1,
    created_by: 'u1',
    created_at: '2026-06-13T09:00:00.000Z',
  },
  results: [],
  findings: [
    {
      code: 'ASR-IMMUT',
      title: 'Immutability enabled',
      verdict: 'failed',
      severity: 'critical',
      weight: 1,
      message: 'Object-lock immutability is not enabled on the recovery vault.',
      recommendation: 'Enable WORM object-lock with a minimum 30-day retention.',
      evidence_refs: [],
    },
  ],
  recommendations: ['Enable WORM object-lock with a minimum 30-day retention.'],
};

// Mutable query mocks so individual tests can override the data set.
const { postureRef, bcmPacksRef, assuranceControlsRef, assuranceLatestRef } = vi.hoisted(() => ({
  postureRef: { current: { groups: [{ group_id: 'g1', name: 'Payments core' }] } as unknown },
  bcmPacksRef: { current: [] as DRBCMPack[] },
  assuranceControlsRef: { current: [] as DRAssuranceControlInfo[] },
  assuranceLatestRef: { current: null as DRAssuranceAssessmentReport | null },
}));

vi.mock('@/app/(dashboard)/dr/_hooks/use-dr-queries', () => ({
  useDRPosture: () => ({ data: postureRef.current, isLoading: false, error: null, refetch: vi.fn() }),
  useDRBCMPacks: () => ({ data: bcmPacksRef.current, isLoading: false, error: null, refetch: vi.fn() }),
  useDRAssuranceControls: () => ({
    data: assuranceControlsRef.current,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useDRAssuranceLatest: () => ({
    data: assuranceLatestRef.current,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useDRGroupSummary: () => ({
    data: { group_id: 'g1', name: 'Payments core' },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

// Import AFTER the mocks are registered.
import DRCompliancePostureBoardPage from './page';

describe('DRCompliancePostureBoardPage', () => {
  beforeEach(() => {
    hasPermissionMock.mockReset();
    hasPermissionMock.mockReturnValue(true);
    assessBcmMock.mockReset();
    latestBcmRef.current = null;
    bcmPacksRef.current = BCM_PACKS;
    assuranceControlsRef.current = ASSURANCE_CONTROLS;
    assuranceLatestRef.current = ASSURANCE_REPORT;
  });

  it('renders a RAG posture card per BCM framework from real pack shapes', () => {
    renderWithQuery(<DRCompliancePostureBoardPage />);

    expect(screen.getByRole('heading', { name: 'Compliance posture' })).toBeInTheDocument();

    // Both published frameworks are rendered as cards.
    expect(screen.getByText('NCA Essential Cybersecurity Controls')).toBeInTheDocument();
    expect(screen.getByText('SAMA Business Continuity Management')).toBeInTheDocument();

    // Without an assessment, frameworks are "Not assessed" (RAG unknown, text present).
    expect(screen.getAllByText('Not assessed').length).toBeGreaterThanOrEqual(2);
  });

  it('renders the scored RAG status + gap drill-down for an assessed framework', async () => {
    // Supply a latest assessment for the NCA pack (failed control -> red, with a gap).
    latestBcmRef.current = BCM_ASSESSMENT;

    const user = userEvent.setup();
    renderWithQuery(<DRCompliancePostureBoardPage />);

    // The scored framework shows the weighted score and a non-compliant RAG.
    expect(screen.getByText('72%')).toBeInTheDocument();
    expect(screen.getAllByText('Non-compliant').length).toBeGreaterThan(0);

    // Open the "What is missing" drill-down for the assessed framework (the
    // first such trigger belongs to the scored BCM card).
    const missingTriggers = screen.getAllByRole('button', { name: /What is missing/i });
    await user.click(missingTriggers[0]);

    // The real gap (code + reason) is surfaced from the assessment fields. The
    // reason appears in both the gap row and the failing control row.
    expect(screen.getAllByText('ECC-2-5-1').length).toBeGreaterThan(0);
    expect(
      screen.getAllByText('No drill executed in the last 90 days.').length,
    ).toBeGreaterThan(0);
  });

  it('renders the internal assurance posture with its real findings drill-down', async () => {
    const user = userEvent.setup();
    renderWithQuery(<DRCompliancePostureBoardPage />);

    expect(screen.getByText('Internal DR assurance policy')).toBeInTheDocument();
    // Assurance verdict "partial" -> amber RAG, score from the stored assessment.
    expect(screen.getByText('80%')).toBeInTheDocument();

    // The assurance "what is missing" drill-down exposes the real finding. With
    // no BCM assessment in this scenario, the assurance panel owns the only
    // "what is missing" trigger on the page.
    const triggers = screen.getAllByRole('button', { name: /What is missing/i });
    await user.click(triggers[triggers.length - 1]);

    expect(screen.getByText('Immutability enabled')).toBeInTheDocument();
    expect(
      screen.getByText('Object-lock immutability is not enabled on the recovery vault.'),
    ).toBeInTheDocument();
  });

  it('fires the wired BCM assess mutation when "Assess framework" is clicked (dr:write granted)', () => {
    renderWithQuery(<DRCompliancePostureBoardPage />);

    const assessButtons = screen.getAllByRole('button', { name: /Assess framework/i });
    expect(assessButtons.length).toBeGreaterThan(0);

    fireEvent.click(assessButtons[0]);

    expect(assessBcmMock).toHaveBeenCalledTimes(1);
    expect(assessBcmMock).toHaveBeenCalledWith('nca-ecc');
  });

  it('gates the assess action behind dr:write (denied path disables the control)', async () => {
    hasPermissionMock.mockReturnValue(false);

    const user = userEvent.setup();
    renderWithQuery(<DRCompliancePostureBoardPage />);

    // The DRWriteGate renders the explanatory read-only notice...
    expect(screen.getByText('Read-only access')).toBeInTheDocument();

    // ...and wraps the framework cards in a disabled <fieldset>, so every assess
    // control is disabled and a real click does not fire the mutation.
    const assessButtons = screen.getAllByRole('button', { name: /Assess framework/i });
    expect(assessButtons[0]).toBeDisabled();

    await user.click(assessButtons[0]);
    expect(assessBcmMock).not.toHaveBeenCalled();

    // Read access is preserved: the frameworks are still rendered.
    expect(screen.getByText('NCA Essential Cybersecurity Controls')).toBeInTheDocument();
  });

  it('shows an empty state when no frameworks are published', () => {
    bcmPacksRef.current = [];

    renderWithQuery(<DRCompliancePostureBoardPage />);

    expect(screen.getByText('No control frameworks published')).toBeInTheDocument();
  });

  it('keeps the assurance panel scoped to the active group via real query data', () => {
    renderWithQuery(<DRCompliancePostureBoardPage />);

    // The assurance section is a labelled region (its <section> is named by the
    // panel's CardTitle).
    const assuranceRegion = screen.getByRole('region', { name: 'Internal DR assurance policy' });
    // The control-catalogue size is surfaced from useDRAssuranceControls.
    expect(within(assuranceRegion).getByText(/2 controls/i)).toBeInTheDocument();
  });

  it('renders the compliance posture board in Arabic under the ar locale (RTL)', () => {
    latestBcmRef.current = BCM_ASSESSMENT;

    renderWithQuery(<DRCompliancePostureBoardPage />, { locale: 'ar' });

    // Page heading + section headings resolve to professional MSA.
    expect(screen.getByRole('heading', { name: 'وضع الامتثال' })).toBeInTheDocument();
    expect(screen.getByText('أُطر الضوابط')).toBeInTheDocument();
    // The internal-assurance panel heading resolves in Arabic too.
    expect(
      screen.getByRole('region', { name: 'سياسة ضمان التعافي من الكوارث الداخلية' }),
    ).toBeInTheDocument();
    // The scored, non-compliant RAG pill shows the Arabic status word.
    expect(screen.getAllByText('غير ممتثل').length).toBeGreaterThan(0);

    // Deep Arabic resolution through nested components: the assurance "controls"
    // tally renders the MSA noun (proving the labels resolve past the page chrome
    // into the panel). The board is RTL-safe — every margin/padding the area owns
    // is a logical property (ms-/me-/ps-/pe-), so under the ar (dir=rtl) provider
    // the layout mirrors without physical-direction overrides.
    const assuranceRegion = screen.getByRole('region', {
      name: 'سياسة ضمان التعافي من الكوارث الداخلية',
    });
    expect(within(assuranceRegion).getAllByText(/الضوابط/).length).toBeGreaterThan(0);
  });
});
