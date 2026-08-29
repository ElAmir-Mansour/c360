import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import type { LegalCase } from '@/lib/lex/cases';
import type { DeadlineItem } from '../../_components/detail-workspace/workflow-metrics';
import { CaseActionBar } from './case-action-bar';
import { resolveCaseDetailExtraLabels } from './case-detail-labels';

const labels = resolveCaseDetailExtraLabels('en').actionBar;

function legalCase(status: LegalCase['status']): LegalCase {
  return {
    id: 'case-1',
    tenant_id: 'tenant-1',
    case_number: 'CASE-1',
    case_type: 'commercial',
    company_status: 'plaintiff',
    title: { en: 'Case', ar: 'قضية' },
    description: '',
    status,
    priority: 'medium',
    metadata: { beneficiary_entity_id: 'entity-1' },
    created_by: 'user-1',
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
  };
}

const overdue: DeadlineItem = {
  id: 'task-1',
  type: 'task',
  title: 'Old task',
  date: '2026-07-01T00:00:00Z',
  daysUntil: -2,
  severity: 'critical',
};

function renderBar({
  status,
  canWrite = false,
  canAssign = false,
  phase1DecisionAvailable = false,
  deadlineItems = [],
}: {
  status: LegalCase['status'];
  canWrite?: boolean;
  canAssign?: boolean;
  phase1DecisionAvailable?: boolean;
  deadlineItems?: DeadlineItem[];
}) {
  const callbacks = {
    onAssign: vi.fn(),
    onIntake: vi.fn(),
    onOpenApprovals: vi.fn(),
    onChangeStatus: vi.fn(),
    onSetStrength: vi.fn(),
    onSetRiskRating: vi.fn(),
    onOpenTab: vi.fn(),
  };
  renderWithQuery(
    <CaseActionBar
      legalCase={legalCase(status)}
      canWrite={canWrite}
      canAssign={canAssign}
      phase1DecisionAvailable={phase1DecisionAvailable}
      deadlineItems={deadlineItems}
      {...callbacks}
    />,
  );
  return callbacks;
}

describe('CaseActionBar governed intake actions', () => {
  it('opens Awaiting me for Phase 1 instead of the generic status dialog', async () => {
    const user = userEvent.setup();
    const callbacks = renderBar({
      status: 'phase1',
      canWrite: true,
      phase1DecisionAvailable: true,
      deadlineItems: [overdue],
    });

    await user.click(screen.getByRole('button', { name: labels.openApprovals }));

    expect(callbacks.onOpenApprovals).toHaveBeenCalledOnce();
    expect(callbacks.onChangeStatus).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: labels.reviewDeadlines })).not.toBeInTheDocument();
  });

  it('explains the Case Manager gate without exposing an inert decision action', () => {
    renderBar({ status: 'phase1', canWrite: true, phase1DecisionAvailable: false });

    expect(screen.getByText(labels.phase1AwaitingManagerHint)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: labels.openApprovals })).not.toBeInTheDocument();
  });

  it('offers Phase-2 handoff only to a case assigner', async () => {
    const user = userEvent.setup();
    const callbacks = renderBar({ status: 'phase2', canWrite: false, canAssign: true });

    await user.click(screen.getByRole('button', { name: labels.completeHandoff }));
    expect(callbacks.onIntake).toHaveBeenCalledOnce();
    expect(callbacks.onChangeStatus).not.toHaveBeenCalled();
  });

  it('does not expose an unusable Phase-2 action to an edit-only user', () => {
    renderBar({ status: 'phase2', canWrite: true, canAssign: false });

    expect(screen.getByText(labels.phase2Hint)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: labels.completeHandoff })).not.toBeInTheDocument();
  });
});
