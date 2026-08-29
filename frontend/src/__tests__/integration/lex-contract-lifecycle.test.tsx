import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import LexContractDetailPage from '@/app/(dashboard)/lex/contracts/[id]/page';
import { ContractFormDialog } from '@/app/(dashboard)/lex/contracts/_components/contract-form-dialog';
import type {
  FileUploadRecord,
  LexApprovalPolicy,
  LexContractDetail,
  LexContractRecord,
  LexContractVersion,
  UserDirectoryEntry,
} from '@/types/suites';

const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const REVIEWER_ID = '22222222-2222-4222-8222-222222222222';
const FILE_ID = '33333333-3333-4333-8333-333333333333';
const CONTRACT_ID = 'contract-1';

const {
  analyzeContractMock,
  createContractMock,
  getContractBriefMock,
  getContractTimelineMock,
  fileUploadMock,
  getContractMock,
  listSignaturesMock,
  listContractVersionsMock,
  listApprovalPoliciesMock,
  recommendApprovalPolicyMock,
  routeState,
  runComplianceMock,
  showApiErrorMock,
  showSuccessMock,
  startContractReviewMock,
  updateContractMock,
  uploadAttachmentMock,
  usersListMock,
} = vi.hoisted(() => ({
  analyzeContractMock: vi.fn(),
  createContractMock: vi.fn(),
  getContractBriefMock: vi.fn(),
  getContractTimelineMock: vi.fn(),
  fileUploadMock: vi.fn(),
  getContractMock: vi.fn(),
  listSignaturesMock: vi.fn(),
  listContractVersionsMock: vi.fn(),
  listApprovalPoliciesMock: vi.fn(),
  recommendApprovalPolicyMock: vi.fn(),
  routeState: { contractId: 'contract-1' },
  runComplianceMock: vi.fn(),
  showApiErrorMock: vi.fn(),
  showSuccessMock: vi.fn(),
  startContractReviewMock: vi.fn(),
  updateContractMock: vi.fn(),
  uploadAttachmentMock: vi.fn(),
  usersListMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => `/lex/contracts/${routeState.contractId}`,
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ id: routeState.contractId }),
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    hasPermission: () => true,
    hasAnyPermission: () => true,
    hasAllPermissions: () => true,
    isHydrated: true,
    isAuthenticated: true,
    user: { id: OWNER_ID },
  }),
}));

vi.mock('@/lib/toast', () => ({
  showSuccess: showSuccessMock,
  showApiError: showApiErrorMock,
}));

// The create flow registers the uploaded document in the review-desk `draft`
// attachment slot. The review-desk client talks straight to axios (it is
// deliberately not routed through enterpriseApi), so stub only that call.
vi.mock(
  '@/app/(dashboard)/lex/contracts/[id]/_components/review-desk/review-desk-api',
  async () => {
    const actual = await vi.importActual<
      typeof import('@/app/(dashboard)/lex/contracts/[id]/_components/review-desk/review-desk-api')
    >('@/app/(dashboard)/lex/contracts/[id]/_components/review-desk/review-desk-api');
    return {
      ...actual,
      reviewDeskApi: {
        ...actual.reviewDeskApi,
        uploadAttachment: uploadAttachmentMock,
      },
    };
  },
);

vi.mock('@/lib/enterprise', async () => {
  const actual = await vi.importActual<typeof import('@/lib/enterprise')>('@/lib/enterprise');

  return {
    ...actual,
    enterpriseApi: {
      ...actual.enterpriseApi,
      users: {
        ...actual.enterpriseApi.users,
        list: usersListMock,
      },
      files: {
        ...actual.enterpriseApi.files,
        upload: fileUploadMock,
      },
      lex: {
        ...actual.enterpriseApi.lex,
        analyzeContract: analyzeContractMock,
        createContract: createContractMock,
        getContractBrief: getContractBriefMock,
        getContractTimeline: getContractTimelineMock,
        getContract: getContractMock,
        listSignatures: listSignaturesMock,
        listApprovalPolicies: listApprovalPoliciesMock,
        listContractVersions: listContractVersionsMock,
        recommendApprovalPolicy: recommendApprovalPolicyMock,
        runCompliance: runComplianceMock,
        startContractReview: startContractReviewMock,
        updateContract: updateContractMock,
      },
    },
  };
});

const directoryUsers: UserDirectoryEntry[] = [
  {
    id: OWNER_ID,
    first_name: 'Ada',
    last_name: 'Lovelace',
    email: 'ada@example.com',
    status: 'active',
    roles: [],
  },
  {
    id: REVIEWER_ID,
    first_name: 'Grace',
    last_name: 'Hopper',
    email: 'grace@example.com',
    status: 'active',
    roles: [],
  },
];

const contractVersions: LexContractVersion[] = [
  {
    id: 'version-2',
    tenant_id: 'tenant-1',
    contract_id: CONTRACT_ID,
    version: 2,
    file_id: FILE_ID,
    file_name: 'msa-v2.pdf',
    file_size_bytes: 4096,
    content_hash: 'hash-v2',
    extracted_text: 'Version 2 extracted text',
    change_summary: 'Updated limitation of liability.',
    uploaded_by: OWNER_ID,
    uploaded_at: '2026-03-09T09:00:00Z',
  },
];

const approvalPolicies: LexApprovalPolicy[] = [
  {
    id: 'policy-finance-high',
    tenant_id: 'tenant-1',
    name: 'High-value procurement DoA',
    description: 'Routes Procurement service agreements above USD 100k.',
    status: 'active',
    priority: 50,
    contract_type: 'service_agreement',
    department: 'Procurement',
    min_value: 100000,
    max_value: null,
    currency: 'USD',
    mode: 'parallel',
    quorum: 'n_of_m',
    quorum_n: 2,
    approvers: [
      { type: 'role', ref: 'finance_director', label: 'Finance Director' },
      { type: 'user', ref: REVIEWER_ID, label: 'Grace Hopper' },
    ],
    form_fields: [],
    require_authority_evidence: true,
    required_role: 'finance_director',
    required_authority_amount: 150000,
    metadata: {},
    created_by: OWNER_ID,
    updated_by: null,
    created_at: '2026-03-01T09:00:00Z',
    updated_at: '2026-03-10T09:00:00Z',
  },
  {
    id: 'policy-draft',
    tenant_id: 'tenant-1',
    name: 'Draft procurement DoA',
    description: 'A draft policy that should not be selectable.',
    status: 'draft',
    priority: 10,
    contract_type: 'service_agreement',
    department: 'Procurement',
    min_value: null,
    max_value: null,
    currency: 'USD',
    mode: 'sequential',
    quorum: 'all',
    quorum_n: null,
    approvers: [{ type: 'role', ref: 'legal', label: 'Legal' }],
    form_fields: [],
    require_authority_evidence: false,
    required_role: null,
    required_authority_amount: null,
    metadata: {},
    created_by: OWNER_ID,
    updated_by: null,
    created_at: '2026-03-01T09:00:00Z',
    updated_at: '2026-03-10T09:00:00Z',
  },
];

const contractDetail: LexContractDetail = {
  contract: {
    id: CONTRACT_ID,
    tenant_id: 'tenant-1',
    title: 'Master Services Agreement',
    contract_number: 'LEX-2026-001',
    type: 'service_agreement',
    description: 'Primary services agreement for the Acme account.',
    party_a_name: 'Clario360',
    party_a_entity: 'Clario360 Ltd',
    party_b_name: 'Acme Vendor',
    party_b_entity: 'Acme Vendor LLC',
    party_b_contact: 'legal@acme.example',
    total_value: 150000,
    currency: 'USD',
    payment_terms: 'Net 30',
    effective_date: '2026-01-01T00:00:00Z',
    expiry_date: '2026-12-31T00:00:00Z',
    renewal_date: '2026-11-30T00:00:00Z',
    auto_renew: false,
    renewal_notice_days: 30,
    signed_date: '2026-01-02T00:00:00Z',
    status: 'active',
    previous_status: 'pending_signature',
    status_changed_at: '2026-01-02T10:00:00Z',
    status_changed_by: OWNER_ID,
    owner_user_id: OWNER_ID,
    owner_name: 'Ada Lovelace',
    legal_reviewer_id: REVIEWER_ID,
    legal_reviewer_name: 'Grace Hopper',
    risk_score: 62,
    risk_level: 'medium',
    analysis_status: 'completed',
    last_analyzed_at: '2026-03-10T08:30:00Z',
    document_file_id: FILE_ID,
    document_text: 'Version 2 extracted text',
    current_version: 2,
    parent_contract_id: null,
    workflow_instance_id: 'workflow-1',
    department: 'Procurement',
    tags: ['msa', 'vendor'],
    metadata: {},
    created_by: OWNER_ID,
    created_at: '2026-01-01T09:00:00Z',
    updated_at: '2026-03-10T08:30:00Z',
    deleted_at: null,
  },
  clauses: [
    {
      id: 'clause-1',
      tenant_id: 'tenant-1',
      contract_id: CONTRACT_ID,
      clause_type: 'limitation_of_liability',
      title: 'Limitation of Liability',
      content: 'Liability is capped at annual fees.',
      section_reference: '4.2',
      page_number: 12,
      risk_level: 'high',
      risk_score: 78,
      risk_keywords: ['liability cap'],
      analysis_summary: 'Cap excludes indirect damages but remains commercially aggressive.',
      recommendations: ['Renegotiate aggregate liability cap'],
      compliance_flags: ['value_threshold'],
      review_status: 'pending',
      reviewed_by: null,
      reviewed_at: null,
      review_notes: null,
      extraction_confidence: 0.97,
      created_at: '2026-03-10T08:30:00Z',
      updated_at: '2026-03-10T08:30:00Z',
    },
  ],
  latest_analysis: {
    id: 'analysis-1',
    tenant_id: 'tenant-1',
    contract_id: CONTRACT_ID,
    contract_version: 2,
    overall_risk: 'medium',
    risk_score: 62,
    clause_count: 12,
    high_risk_clause_count: 2,
    missing_clauses: ['data_protection'],
    key_findings: [
      {
        title: 'Liability cap below target',
        description: 'Aggregate liability cap is below enterprise policy.',
        severity: 'high',
        clause_reference: '4.2',
        recommendation: 'Increase liability cap to 2x annual fees.',
      },
    ],
    recommendations: ['Escalate to legal reviewer'],
    compliance_flags: [
      {
        code: 'VALUE_THRESHOLD',
        title: 'High-value review required',
        description: 'Contracts above the threshold require an explicit review workflow.',
        severity: 'medium',
      },
    ],
    extracted_parties: [
      {
        name: 'Clario360',
        role: 'provider',
        source: 'signature block',
      },
    ],
    extracted_dates: [
      {
        label: 'Effective date',
        value: '2026-01-01T00:00:00Z',
        source: 'section 1',
      },
    ],
    extracted_amounts: [
      {
        label: 'Contract value',
        currency: 'USD',
        value: 150000,
        source: 'commercial schedule',
      },
    ],
    analysis_duration_ms: 845,
    analyzed_by: 'lex-service',
    analyzed_at: '2026-03-10T08:30:00Z',
    created_at: '2026-03-10T08:30:00Z',
  },
  version_count: 2,
};

const uploadedFile: FileUploadRecord = {
  id: FILE_ID,
  tenant_id: 'tenant-1',
  original_name: 'msa.txt',
  sanitized_name: 'msa.txt',
  content_type: 'text/plain',
  size_bytes: 128,
  checksum_sha256: 'sha-256-1',
  encrypted: false,
  virus_scan_status: 'clean',
  uploaded_by: OWNER_ID,
  suite: 'lex',
  entity_type: 'contract',
  entity_id: null,
  tags: ['contract', 'service_agreement'],
  version_number: 1,
  is_public: false,
  lifecycle_policy: 'standard',
  expires_at: null,
  created_at: '2026-03-10T09:00:00Z',
  updated_at: '2026-03-10T09:00:00Z',
};

const createdContract: LexContractRecord = {
  id: 'contract-2',
  tenant_id: 'tenant-1',
  title: 'New Vendor MSA',
  contract_number: 'LEX-20260310-ABCD1234',
  type: 'service_agreement',
  description: 'Fresh MSA for vendor onboarding.',
  party_a_name: 'Clario360',
  party_a_entity: null,
  party_b_name: 'Acme Vendor',
  party_b_entity: null,
  party_b_contact: null,
  total_value: null,
  currency: 'SAR',
  payment_terms: null,
  effective_date: null,
  expiry_date: null,
  renewal_date: null,
  auto_renew: false,
  renewal_notice_days: 30,
  signed_date: null,
  status: 'draft',
  previous_status: null,
  status_changed_at: null,
  status_changed_by: null,
  owner_user_id: OWNER_ID,
  owner_name: 'Ada Lovelace',
  legal_reviewer_id: null,
  legal_reviewer_name: null,
  risk_score: null,
  risk_level: 'none',
  analysis_status: 'pending',
  last_analyzed_at: null,
  document_file_id: FILE_ID,
  document_text: 'Agreement text for deterministic analysis.',
  current_version: 1,
  parent_contract_id: null,
  workflow_instance_id: null,
  department: null,
  tags: ['vendor', 'msa'],
  metadata: {},
  created_by: OWNER_ID,
  created_at: '2026-03-10T10:00:00Z',
  updated_at: '2026-03-10T10:00:00Z',
  deleted_at: null,
};

beforeEach(() => {
  routeState.contractId = CONTRACT_ID;
  showSuccessMock.mockReset();
  showApiErrorMock.mockReset();
  getContractBriefMock.mockReset();
  getContractTimelineMock.mockReset();
  getContractMock.mockReset();
  listSignaturesMock.mockReset();
  listContractVersionsMock.mockReset();
  listApprovalPoliciesMock.mockReset();
  recommendApprovalPolicyMock.mockReset();
  runComplianceMock.mockReset();
  analyzeContractMock.mockReset();
  startContractReviewMock.mockReset();
  usersListMock.mockReset();
  fileUploadMock.mockReset();
  createContractMock.mockReset();
  updateContractMock.mockReset();
  uploadAttachmentMock.mockReset();

  getContractBriefMock.mockResolvedValue(null);
  getContractTimelineMock.mockResolvedValue(null);
  getContractMock.mockResolvedValue(contractDetail);
  listSignaturesMock.mockResolvedValue({
    data: [],
    meta: {
      page: 1,
      per_page: 5,
      total: 0,
      total_pages: 0,
    },
  });
  listContractVersionsMock.mockResolvedValue(contractVersions);
  listApprovalPoliciesMock.mockResolvedValue(approvalPolicies);
  recommendApprovalPolicyMock.mockResolvedValue({
    policy: approvalPolicies[0],
    matched: true,
    reason: 'Matched service agreement, Procurement, and USD value threshold.',
  });
  runComplianceMock.mockResolvedValue({
    tenant_id: 'tenant-1',
    score: 93,
    alerts_created: 1,
    alerts: [],
    calculated_at: '2026-03-10T11:00:00Z',
  });
  analyzeContractMock.mockResolvedValue(contractDetail.latest_analysis);
  startContractReviewMock.mockResolvedValue({
    workflow_instance_id: 'workflow-2',
    task_id: 'task-2',
  });
  usersListMock.mockResolvedValue({
    data: directoryUsers,
    meta: {
      page: 1,
      per_page: 200,
      total: directoryUsers.length,
      total_pages: 1,
    },
  });
  fileUploadMock.mockResolvedValue(uploadedFile);
  createContractMock.mockResolvedValue(createdContract);
  updateContractMock.mockResolvedValue(createdContract);
  uploadAttachmentMock.mockResolvedValue({
    id: 'attachment-1',
    contract_id: createdContract.id,
    slot: 'draft',
    file_id: FILE_ID,
    file_name: 'msa.txt',
  });
});

describe('Lex contract lifecycle', () => {
  it('renders detail data and posts compliance runs through the Lex client wiring', async () => {
    const user = userEvent.setup();

    renderWithQuery(<LexContractDetailPage />);

    expect(await screen.findByText('Master Services Agreement')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Analysis & Clauses' }));

    expect(await screen.findByText('Limitation of Liability')).toBeInTheDocument();
    expect(screen.getByText('Liability cap below target')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Run Compliance' }));

    await waitFor(() => {
      expect(runComplianceMock).toHaveBeenCalledWith({ contract_ids: [CONTRACT_ID] });
    });
    expect(showSuccessMock).toHaveBeenCalledWith(
      'Compliance checks completed.',
      '1 alert created for this contract.',
    );
  });

  it('starts a review with a recommended persisted approval policy', async () => {
    const user = userEvent.setup();
    getContractMock.mockResolvedValue({
      ...contractDetail,
      contract: {
        ...contractDetail.contract,
        workflow_instance_id: null,
      },
    });

    renderWithQuery(<LexContractDetailPage />);

    expect(await screen.findByText('Master Services Agreement')).toBeInTheDocument();

    const startWorkflowButton = (await screen.findAllByRole('button', { name: /Start Review Workflow/i })).find(
      (button) => !button.hasAttribute('disabled'),
    );
    expect(startWorkflowButton).toBeDefined();
    await user.click(startWorkflowButton!);

    const dialog = await screen.findByRole('dialog', { name: 'Start Review Workflow' });
    await user.click(within(dialog).getByRole('radio', { name: /Catalog policy/i }));

    expect(await within(dialog).findByText('High-value procurement DoA')).toBeInTheDocument();
    expect(within(dialog).queryByText('Draft procurement DoA')).not.toBeInTheDocument();
    expect(within(dialog).getByText(/2 of 2/i)).toBeInTheDocument();
    expect(within(dialog).getByText('Finance Director')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: /Recommend Policy/i }));

    expect(await within(dialog).findByText('Recommended policy')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Apply Recommendation' }));

    await user.type(
      within(dialog).getByLabelText('Task description'),
      'Review obligations and approve the routed policy.',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Start Review' }));

    await waitFor(() => {
      expect(startContractReviewMock).toHaveBeenCalledWith(
        CONTRACT_ID,
        expect.objectContaining({
          approval_policy_id: 'policy-finance-high',
          approver_role: 'legal',
          description: 'Review obligations and approve the routed policy.',
        }),
      );
    });
    const payload = startContractReviewMock.mock.calls[0][1];
    expect(payload.approval_policy).toBeUndefined();
    expect(recommendApprovalPolicyMock).toHaveBeenCalledWith(CONTRACT_ID);
  });

  it('uploads the initial document and creates a contract with the saved owner context', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();

    renderWithQuery(<ContractFormDialog open onOpenChange={vi.fn()} onSaved={onSaved} />);

    const dialog = await screen.findByRole('dialog', { name: 'Create Contract' });

    await user.type(
      within(dialog).getByPlaceholderText('Master Services Agreement'),
      'New Vendor MSA',
    );
    await user.type(
      within(dialog).getByPlaceholderText(
        'Commercial scope, renewal expectations, service obligations, and key legal posture.',
      ),
      'Fresh MSA for vendor onboarding.',
    );
    await user.type(within(dialog).getByPlaceholderText('Clario360 Ltd.'), 'Clario360');
    await user.type(within(dialog).getByPlaceholderText('Acme Holdings'), 'Acme Vendor');
    // Requesting department is required (Othaim PRD) — the submit handler
    // blocks the mutation when it is empty.
    await user.type(within(dialog).getByLabelText(/Requesting department/i), 'Procurement');

    fireEvent.change(within(dialog).getByLabelText(/Contract file/i), {
      target: {
        files: [new File(['agreement'], 'msa.txt', { type: 'text/plain' })],
      },
    });

    // Note: the dialog's .txt prefill (prefillExtractedTextFromFile) is inert
    // under jsdom — File.text()/arrayBuffer() are not implemented — so typing
    // into the extracted-text area is deterministic here.
    await user.type(
      within(dialog).getByPlaceholderText(
        'Paste contract text to enable deterministic analysis immediately after upload.',
      ),
      'Agreement text for deterministic analysis.',
    );
    await user.type(within(dialog).getByPlaceholderText('Initial signed draft'), 'Initial draft');
    await user.clear(within(dialog).getByPlaceholderText('msa, vendor, renewal'));
    await user.type(within(dialog).getByPlaceholderText('msa, vendor, renewal'), 'vendor, msa');

    const submitButton = within(dialog).getByRole('button', { name: 'Create contract' });
    await waitFor(() => {
      expect(submitButton).toBeEnabled();
    });
    await user.click(submitButton);

    await waitFor(() => {
      expect(fileUploadMock).toHaveBeenCalledWith(
        expect.any(File),
        {
          suite: 'lex',
          entity_type: 'contract',
          tags: 'contract,service_agreement,vendor,msa',
          lifecycle_policy: 'standard',
        },
        expect.any(Function),
      );
    });

    await waitFor(() => {
      expect(createContractMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'New Vendor MSA',
          description: 'Fresh MSA for vendor onboarding.',
          party_a_name: 'Clario360',
          party_b_name: 'Acme Vendor',
          owner_user_id: OWNER_ID,
          owner_name: 'Ada Lovelace',
          currency: 'SAR',
          department: 'Procurement',
          tags: ['vendor', 'msa'],
          document: {
            file_id: FILE_ID,
            file_name: 'msa.txt',
            file_size_bytes: 128,
            content_hash: 'sha-256-1',
            extracted_text: 'Agreement text for deterministic analysis.',
            change_summary: 'Initial draft',
          },
        }),
      );
    });

    // The uploaded document is registered into the review-desk draft slot.
    await waitFor(() => {
      expect(uploadAttachmentMock).toHaveBeenCalledWith(
        'contract-2',
        expect.objectContaining({
          slot: 'draft',
          file_id: FILE_ID,
          file_name: 'msa.txt',
          file_size_bytes: 128,
          content_hash: 'sha-256-1',
          notes: 'Initial draft',
        }),
      );
    });

    expect(showSuccessMock).toHaveBeenCalledWith(
      'Contract created.',
      'The contract record is now available in Clario Lex.',
    );
    expect(onSaved).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'contract-2',
        owner_user_id: OWNER_ID,
      }),
    );
  }, 60000);
});
