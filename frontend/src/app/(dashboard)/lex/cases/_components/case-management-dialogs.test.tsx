import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import type { LegalCase } from '@/lib/lex/cases';
import { CaseIntakeDialog, CaseRiskRatingDialog } from './case-management-dialogs';

const { getIntakeMock, setCaseRiskRatingMock } = vi.hoisted(() => ({
  getIntakeMock: vi.fn(),
  setCaseRiskRatingMock: vi.fn(),
}));

vi.mock('@/lib/lex/cases', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/lex/cases')>();
  return {
    ...actual,
    casesApi: {
      ...actual.casesApi,
      getIntake: getIntakeMock,
      setCaseRiskRating: setCaseRiskRatingMock,
    },
  };
});

vi.mock('@/components/shared/forms/org-entity-user-picker', () => ({
  OrgEntityUserPicker: (props: { ariaLabel: string; entityId?: string }) => (
    <input
      aria-label={props.ariaLabel}
      data-testid="entity-user-picker"
      data-entity-id={props.entityId ?? ''}
    />
  ),
}));

const phase2Case: LegalCase = {
  id: 'case-1',
  tenant_id: 'tenant-1',
  case_number: 'CASE-1',
  case_type: 'commercial',
  company_status: 'plaintiff',
  title: { en: 'Case', ar: 'قضية' },
  description: '',
  status: 'phase2',
  priority: 'medium',
  metadata: { beneficiary_entity_id: 'entity-1' },
  created_by: 'user-1',
  created_at: '2026-07-01T00:00:00Z',
  updated_at: '2026-07-01T00:00:00Z',
};

const openCase: LegalCase = {
  ...phase2Case,
  status: 'open',
  metadata: {},
};

beforeEach(() => {
  getIntakeMock.mockReset();
  getIntakeMock.mockResolvedValue({
    id: 'intake-1',
    tenant_id: 'tenant-1',
    case_id: 'case-1',
    phase: 'phase2',
  });
  setCaseRiskRatingMock.mockReset();
  setCaseRiskRatingMock.mockResolvedValue({ ...openCase, risk_rating: 'medium' });
});

describe('CaseIntakeDialog Phase-2 handoff', () => {
  it('uses entity-scoped user pickers for an assigner', async () => {
    renderWithQuery(
      <CaseIntakeDialog
        legalCase={phase2Case}
        canAssign
        open
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    expect(await screen.findByText('Open and allocate the case')).toBeInTheDocument();
    const pickers = screen.getAllByTestId('entity-user-picker');
    expect(pickers).toHaveLength(3);
    for (const picker of pickers) {
      expect(picker).toHaveAttribute('data-entity-id', 'entity-1');
    }
  });

  it('hides the handoff controls from an edit-only user', async () => {
    renderWithQuery(
      <CaseIntakeDialog
        legalCase={phase2Case}
        canAssign={false}
        open
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    await waitFor(() => expect(getIntakeMock).toHaveBeenCalledWith('case-1'));
    expect(await screen.findByText(/Intake status/)).toBeInTheDocument();
    expect(screen.queryByTestId('entity-user-picker')).not.toBeInTheDocument();
    expect(screen.queryByText('Open and allocate the case')).not.toBeInTheDocument();
  });
});

describe('CaseRiskRatingDialog', () => {
  it('submits the selected graded band (Othaim PRD 8.2)', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    renderWithQuery(
      <CaseRiskRatingDialog legalCase={openCase} open onOpenChange={vi.fn()} onSaved={onSaved} />,
    );

    await user.click(await screen.findByRole('button', { name: 'Save risk rating' }));

    await waitFor(() =>
      expect(setCaseRiskRatingMock).toHaveBeenCalledWith('case-1', { rating: 'medium', reason: '' }),
    );
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it('carries the likelihood × impact matrix inputs into the payload', async () => {
    const user = userEvent.setup();
    renderWithQuery(
      <CaseRiskRatingDialog legalCase={openCase} open onOpenChange={vi.fn()} onSaved={vi.fn()} />,
    );

    await user.type(await screen.findByLabelText(/Likelihood/), '4');
    await user.type(screen.getByLabelText(/Impact/), '5');
    await user.click(screen.getByRole('button', { name: 'Save risk rating' }));

    await waitFor(() =>
      expect(setCaseRiskRatingMock).toHaveBeenCalledWith('case-1', {
        rating: 'medium',
        reason: '',
        likelihood: 4,
        impact: 5,
      }),
    );
  });
});
