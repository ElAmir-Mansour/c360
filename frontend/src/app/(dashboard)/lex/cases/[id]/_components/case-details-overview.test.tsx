import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CaseDetailsOverview } from './case-details-overview';
import type { LegalCase } from '@/lib/lex/cases';

vi.mock('../../_components/tabs/sessions/use-case-users', () => ({
  useCaseUsers: () => ({
    nameOf: (id: string) =>
      ({ manager: 'Ahmad Mahmoud', supervisor: 'Latifa Al-Sudairy', officer: 'Omar Al-Rashid' })[
        id
      ] ?? id,
  }),
}));

const legalCase: LegalCase = {
  id: 'case-1',
  tenant_id: 'tenant-1',
  case_number: 'CASE-2024-045',
  case_type: 'commercial_litigation',
  company_status: 'plaintiff',
  competent_court: 'Commercial Court in Riyadh',
  chamber: '5th Commercial Circuit',
  filing_date: '2024-02-22T00:00:00.000Z',
  claim_amount: 2_450_000,
  court_fees: 12_500,
  legal_fees: 185_000,
  currency: 'SAR',
  expected_resolution_date: '2024-09-30T00:00:00.000Z',
  title: { ar: 'مطالبة تعويض', en: 'Compensation claim' },
  description: '',
  status: 'under_procedure',
  priority: 'high',
  section_manager_id: 'manager',
  supervisor_id: 'supervisor',
  handling_officer_id: 'officer',
  created_by: 'creator',
  created_at: '2024-02-22T00:00:00.000Z',
  updated_at: '2024-05-02T00:00:00.000Z',
};

describe('CaseDetailsOverview', () => {
  it('renders structured financial, date, chamber, and assigned-team data', () => {
    render(
      <CaseDetailsOverview
        legalCase={legalCase}
        hearings={[
          {
            id: 'hearing-1',
            case_id: legalCase.id,
            hearing_date: '2024-04-06T10:00:00.000Z',
            notes: '',
            created_at: '2024-03-01T00:00:00.000Z',
            updated_at: '2024-03-01T00:00:00.000Z',
          },
        ]}
        title="Compensation claim"
        statusLabel="Under procedure"
        canWrite
        onEdit={vi.fn()}
      />,
    );

    expect(screen.getByText(/Financial details|التفاصيل المالية/)).toBeInTheDocument();
    expect(screen.getByText('5th Commercial Circuit')).toBeInTheDocument();
    expect(screen.getByText(/2,450,000|٢٬٤٥٠٬٠٠٠/)).toBeInTheDocument();
    expect(screen.getByText('Ahmad Mahmoud')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Edit case details|تعديل تفاصيل القضية/ }),
    ).toBeInTheDocument();
  });

  it('keeps a legacy free-text court visible when no reference court is linked', () => {
    render(
      <CaseDetailsOverview
        legalCase={legalCase}
        hearings={[]}
        title="Compensation claim"
        statusLabel="Under procedure"
        canWrite={false}
        onEdit={vi.fn()}
      />,
    );

    expect(screen.getByText('Commercial Court in Riyadh')).toBeInTheDocument();
  });

  it('prefers the linked reference court over the legacy free text', () => {
    render(
      <CaseDetailsOverview
        legalCase={{
          ...legalCase,
          court_id: 'court-1',
          court: {
            id: 'court-1',
            tenant_id: legalCase.tenant_id,
            code: 'RIYADH_COMMERCIAL',
            name: { en: 'Riyadh Commercial Court', ar: 'المحكمة التجارية بالرياض' },
            active: true,
            is_system: true,
            sort: 1,
            created_at: legalCase.created_at,
            updated_at: legalCase.updated_at,
          },
        }}
        hearings={[]}
        title="Compensation claim"
        statusLabel="Under procedure"
        canWrite={false}
        onEdit={vi.fn()}
      />,
    );

    // This suite renders without a LocaleProvider, so the resolver falls back
    // to the default locale — accept either side of the bilingual court name.
    expect(
      screen.getByText(/Riyadh Commercial Court|المحكمة التجارية بالرياض/),
    ).toBeInTheDocument();
    expect(screen.queryByText('Commercial Court in Riyadh')).not.toBeInTheDocument();
  });
});
