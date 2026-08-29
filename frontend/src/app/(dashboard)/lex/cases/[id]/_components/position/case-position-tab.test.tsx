import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import type { CaseParty, LegalCase } from '@/lib/lex/cases';
import {
  CasePositionTab,
  resolveOpposingParty,
} from './case-position-tab';

const { updateCaseMock } = vi.hoisted(() => ({
  updateCaseMock: vi.fn(),
}));

vi.mock('@/lib/lex/cases', async () => {
  const actual = await vi.importActual<typeof import('@/lib/lex/cases')>(
    '@/lib/lex/cases',
  );
  return {
    ...actual,
    casesApi: {
      ...actual.casesApi,
      updateCase: updateCaseMock,
    },
  };
});

vi.mock('@/lib/toast', () => ({
  showSuccess: vi.fn(),
  showApiError: vi.fn(),
}));

const legalCase: LegalCase = {
  id: 'case-1',
  tenant_id: 'tenant-1',
  case_number: 'CASE-2026-045',
  case_type: 'commercial',
  company_status: 'plaintiff',
  competent_court: 'Riyadh Commercial Court',
  title: { en: 'Horizon compensation claim', ar: 'دعوى التعويض ضد هورايزون' },
  description: '',
  risk_likelihood: 2,
  risk_impact: 2,
  status: 'under_procedure',
  priority: 'high',
  metadata: {},
  created_by: 'user-1',
  created_at: '2026-07-01T00:00:00Z',
  updated_at: '2026-07-20T00:00:00Z',
  parties: [
    {
      id: 'party-1',
      case_id: 'case-1',
      role: 'defendant',
      name: 'Horizon LLC',
      created_at: '2026-07-01T00:00:00Z',
      updated_at: '2026-07-01T00:00:00Z',
    },
    {
      id: 'party-2',
      case_id: 'case-1',
      role: 'lawyer',
      name: 'Khalid Legal Office',
      created_at: '2026-07-01T00:00:00Z',
      updated_at: '2026-07-01T00:00:00Z',
    },
  ],
  tasks: [
    {
      id: 'task-1',
      case_id: 'case-1',
      title: 'Pay the court filing fee',
      priority: 'high',
      status: 'open',
      due_date: '2026-08-01T00:00:00Z',
      created_at: '2026-07-01T00:00:00Z',
      updated_at: '2026-07-01T00:00:00Z',
    },
  ],
};

beforeEach(() => {
  updateCaseMock.mockReset();
  updateCaseMock.mockResolvedValue(legalCase);
});

describe('CasePositionTab', () => {
  it('persists a changed company role through the legal-case endpoint', async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn().mockResolvedValue(undefined);

    renderWithQuery(
      <CasePositionTab
        legalCase={legalCase}
        caseId={legalCase.id}
        canWrite
        onChanged={onChanged}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Defendant (company)' }));

    await waitFor(() => {
      expect(updateCaseMock).toHaveBeenCalledWith('case-1', {
        company_status: 'defendant',
      });
      expect(onChanged).toHaveBeenCalledOnce();
    });
  });

  it('does not duplicate the canonical Tasks tab inside Legal Position', () => {
    renderWithQuery(
      <CasePositionTab
        legalCase={legalCase}
        caseId={legalCase.id}
        canWrite
        onChanged={vi.fn()}
      />,
    );

    expect(screen.queryByText('Pay the court filing fee')).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('shows the competent court without ever falling back to a court number', () => {
    renderWithQuery(
      <CasePositionTab
        legalCase={{ ...legalCase, court_number: 'COURT-2026-118' }}
        caseId={legalCase.id}
        canWrite
        onChanged={vi.fn()}
      />,
    );

    expect(screen.getByText('Riyadh Commercial Court')).toBeInTheDocument();
    expect(screen.queryByText('COURT-2026-118')).not.toBeInTheDocument();
    // The circuit row has no recorded value once the court number stops
    // standing in for it.
    expect(screen.getAllByText('Not recorded').length).toBeGreaterThan(0);
  });

  it('prefers the linked reference court over the legacy free text', () => {
    renderWithQuery(
      <CasePositionTab
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
        caseId={legalCase.id}
        canWrite
        onChanged={vi.fn()}
      />,
    );

    expect(screen.getByText('Riyadh Commercial Court (reference)')).toBeInTheDocument();
  });

  it('disables mutations for a read-only user', () => {
    renderWithQuery(
      <CasePositionTab
        legalCase={legalCase}
        caseId={legalCase.id}
        canWrite={false}
        onChanged={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Defendant (company)' })).toBeDisabled();
  });
});

describe('resolveOpposingParty', () => {
  const parties = legalCase.parties as CaseParty[];

  it('selects the defendant for a plaintiff case', () => {
    expect(resolveOpposingParty(parties, 'plaintiff')?.name).toBe('Horizon LLC');
  });

  it('selects the plaintiff for a defendant case', () => {
    const plaintiff: CaseParty = { ...parties[0], id: 'party-3', role: 'plaintiff' };
    expect(resolveOpposingParty([...parties, plaintiff], 'defendant')?.id).toBe('party-3');
  });
});
