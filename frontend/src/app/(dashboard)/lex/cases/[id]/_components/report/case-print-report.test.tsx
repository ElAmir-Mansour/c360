import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import type { LegalCase } from '@/lib/lex/cases';
import { CasePrintReport, CaseReportButton } from './case-print-report';

const printMock = vi.fn();

const legalCase: LegalCase = {
  id: 'case-1',
  tenant_id: 'tenant-1',
  case_number: 'CASE-2026-045',
  case_type: 'commercial',
  company_status: 'plaintiff',
  competent_court: 'Riyadh Commercial Court',
  title: { en: 'Horizon compensation claim', ar: 'دعوى التعويض ضد هورايزون' },
  description: 'Contract compensation dispute.',
  risk_likelihood: 2,
  risk_impact: 2,
  status: 'under_procedure',
  priority: 'high',
  created_by: 'user-1',
  created_at: '2026-07-01T00:00:00Z',
  updated_at: '2026-07-20T00:00:00Z',
};

beforeEach(() => {
  printMock.mockReset();
  Object.defineProperty(window, 'print', {
    configurable: true,
    value: printMock,
  });
});

describe('case report export', () => {
  it('opens the browser print dialog from the main-report action', async () => {
    const user = userEvent.setup();
    renderWithQuery(<CaseReportButton />);

    await user.click(screen.getByRole('button', { name: /complete case report/i }));

    expect(printMock).toHaveBeenCalledOnce();
  });

  it('renders a printable report from the live case aggregates', () => {
    renderWithQuery(
      <CasePrintReport
        legalCase={legalCase}
        title="Horizon compensation claim"
        parties={[
          {
            id: 'party-1',
            case_id: 'case-1',
            role: 'defendant',
            name: 'Horizon LLC',
            created_at: legalCase.created_at,
            updated_at: legalCase.updated_at,
          },
        ]}
        tasks={[]}
        hearings={[]}
        pleadings={[]}
        experts={[]}
        judgments={[]}
      />,
    );

    expect(
      screen.getByRole('article', {
        name: /litigation case.*horizon compensation claim/i,
        hidden: true,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText('Horizon LLC')).toBeInTheDocument();
    expect(screen.getByText('Riyadh Commercial Court')).toBeInTheDocument();
  });

  it('omits the retired court number and keeps the legacy free-text court', () => {
    renderWithQuery(
      <CasePrintReport
        legalCase={{ ...legalCase, court_number: 'COURT-2026-118' }}
        title="Horizon compensation claim"
        parties={[]}
        tasks={[]}
        hearings={[]}
        pleadings={[]}
        experts={[]}
        judgments={[]}
      />,
    );

    expect(screen.queryByText(/court number/i)).not.toBeInTheDocument();
    expect(screen.queryByText('COURT-2026-118')).not.toBeInTheDocument();
    expect(screen.getByText('Riyadh Commercial Court')).toBeInTheDocument();
  });

  it('prints the linked reference court in place of the legacy free text', () => {
    renderWithQuery(
      <CasePrintReport
        legalCase={{
          ...legalCase,
          court_id: 'court-1',
          court: {
            id: 'court-1',
            tenant_id: legalCase.tenant_id,
            code: 'RIYADH_COMMERCIAL',
            name: { en: 'Riyadh Commercial Court (reference)', ar: 'المحكمة التجارية بالرياض' },
            active: true,
            is_system: true,
            sort: 1,
            created_at: legalCase.created_at,
            updated_at: legalCase.updated_at,
          },
        }}
        title="Horizon compensation claim"
        parties={[]}
        tasks={[]}
        hearings={[]}
        pleadings={[]}
        experts={[]}
        judgments={[]}
      />,
    );

    expect(screen.getByText('Riyadh Commercial Court (reference)')).toBeInTheDocument();
  });
});
