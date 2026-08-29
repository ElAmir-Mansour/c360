import { describe, expect, it } from 'vitest';
import {
  buildContractRedline,
  createLexDashboardCsv,
  extractMatterSummary,
  extractObligationSummaries,
  getRenewalWarning,
  summarizeClauseLibrary,
} from '@/lib/lex-watheeq';
import type {
  LexClause,
  LexContractRecord,
  LexContractVersion,
  LexDashboard,
} from '@/types/suites';

function baseContract(overrides: Partial<LexContractRecord> = {}): LexContractRecord {
  return {
    id: 'contract-1',
    tenant_id: 'tenant-1',
    title: 'Managed Services Agreement',
    type: 'service_agreement',
    description: 'Managed services contract',
    party_a_name: 'Clario360',
    party_b_name: 'Acme',
    currency: 'SAR',
    auto_renew: true,
    renewal_notice_days: 30,
    status: 'active',
    owner_user_id: 'user-1',
    owner_name: 'Legal Owner',
    risk_level: 'low',
    analysis_status: 'completed',
    document_text: '',
    current_version: 2,
    tags: [],
    metadata: {},
    created_by: 'user-1',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
    ...overrides,
  };
}

function version(versionNumber: number, text: string): LexContractVersion {
  return {
    id: `version-${versionNumber}`,
    tenant_id: 'tenant-1',
    contract_id: 'contract-1',
    version: versionNumber,
    file_id: `file-${versionNumber}`,
    file_name: `contract-v${versionNumber}.txt`,
    file_size_bytes: text.length,
    content_hash: `sha256-${versionNumber}`,
    extracted_text: text,
    uploaded_by: 'user-1',
    uploaded_at: '2026-01-01T00:00:00Z',
  };
}

describe('lex Watheeq helpers', () => {
  it('extracts matter and obligation summaries from contract metadata', () => {
    const contract = baseContract({
      metadata: {
        matter: {
          id: 'MAT-001',
          title: 'Vendor dispute',
          status: 'open',
          owner: 'Litigation Counsel',
          priority: 'high',
        },
        obligations: [
          {
            id: 'OBL-001',
            title: 'Quarterly compliance certificate',
            status: 'due',
            owner_name: 'Compliance Lead',
            due_date: '2026-07-01',
            reminder_days: 14,
          },
        ],
      },
    });

    expect(extractMatterSummary(contract)).toEqual({
      id: 'MAT-001',
      title: 'Vendor dispute',
      status: 'open',
      owner: 'Litigation Counsel',
      priority: 'high',
    });
    expect(extractObligationSummaries(contract)).toEqual([
      {
        id: 'OBL-001',
        title: 'Quarterly compliance certificate',
        status: 'due',
        owner: 'Compliance Lead',
        dueDate: '2026-07-01',
        reminderDays: 14,
      },
    ]);
  });

  it('classifies renewal warnings against the configured notice window', () => {
    const today = new Date('2026-06-14T09:00:00Z');

    expect(
      getRenewalWarning(
        baseContract({ renewal_date: '2026-06-20T00:00:00Z', renewal_notice_days: 30 }),
        today,
      ),
    ).toMatchObject({ level: 'urgent', daysUntil: 6 });
    expect(
      getRenewalWarning(
        baseContract({ renewal_date: '2026-07-10T00:00:00Z', renewal_notice_days: 30 }),
        today,
      ),
    ).toMatchObject({ level: 'warning', daysUntil: 26 });
    expect(
      getRenewalWarning(
        baseContract({ renewal_date: '2026-06-10T00:00:00Z', renewal_notice_days: 30 }),
        today,
      ),
    ).toMatchObject({ level: 'overdue', daysUntil: -4 });
  });

  it('builds a token-level redline from adjacent contract versions', () => {
    const chunks = buildContractRedline(
      version(1, 'Payment is due within 30 days.'),
      version(2, 'Payment is due within 15 business days.'),
    );

    expect(chunks.some((chunk) => chunk.type === 'removed' && chunk.text === '30')).toBe(true);
    expect(chunks.some((chunk) => chunk.type === 'added' && chunk.text.includes('15'))).toBe(true);
    expect(chunks.some((chunk) => chunk.type === 'added' && chunk.text.includes('business'))).toBe(true);
  });

  it('summarizes bilingual clause-library readiness', () => {
    const clauses = [
      {
        id: 'clause-1',
        tenant_id: 'tenant-1',
        contract_id: 'contract-1',
        clause_type: 'confidentiality',
        title: 'Bilingual NDA',
        content: 'Confidentiality / \u0633\u0631\u064a\u0629',
        risk_level: 'low',
        risk_score: 10,
        risk_keywords: [],
        recommendations: [],
        compliance_flags: [],
        review_status: 'pending',
        extraction_confidence: 0.95,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
      {
        id: 'clause-2',
        tenant_id: 'tenant-1',
        contract_id: 'contract-1',
        clause_type: 'termination',
        title: 'Deprecated termination',
        content: 'Either party may terminate.',
        risk_level: 'medium',
        risk_score: 50,
        risk_keywords: [],
        recommendations: [],
        compliance_flags: [],
        review_status: 'rejected',
        extraction_confidence: 0.8,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    ] satisfies LexClause[];

    expect(summarizeClauseLibrary(clauses)).toEqual({
      total: 2,
      bilingualReady: 1,
      deprecated: 1,
      pendingReview: 1,
    });
  });

  it('exports dashboard KPIs and activity as CSV', () => {
    const dashboard: LexDashboard = {
      kpis: {
        active_contracts: 3,
        expiring_in_30_days: 1,
        expiring_in_7_days: 0,
        high_risk_contracts: 1,
        pending_review: 2,
        open_compliance_alerts: 4,
        total_active_value: 500000,
        compliance_score: 91,
      },
      contracts_by_type: { service_agreement: 2 },
      contracts_by_status: { active: 3 },
      expiring_contracts: [
        {
          id: 'contract-1',
          title: 'Managed Services Agreement',
          type: 'service_agreement',
          status: 'active',
          party_b_name: 'Acme',
          expiry_date: '2026-07-01T00:00:00Z',
          days_until_expiry: 17,
          owner_name: 'Legal Owner',
        },
      ],
      high_risk_contracts: [],
      recent_contracts: [],
      compliance_alerts_by_status: { open: 4 },
      total_contract_value: { by_type: { service_agreement: 500000 }, by_currency: { SAR: 500000 } },
      monthly_activity: [{ month: '2026-06', created: 2, activated: 1, expired: 0, renewed: 0 }],
      calculated_at: '2026-06-14T00:00:00Z',
    };

    expect(createLexDashboardCsv(dashboard)).toContain('KPI,active_contracts,3');
    expect(createLexDashboardCsv(dashboard)).toContain('Monthly activity,2026-06,created=2; activated=1; expired=0; renewed=0');
  });
});
