import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LocaleProvider } from '@/components/providers/locale-provider';
import { Button } from '@/components/ui/button';
import { getMessages } from '@/lib/i18n/messages';
import type { InvestigationAuditEntry } from '@/lib/lex/investigations';
import {
  INVESTIGATION_LIFECYCLE_STAGES,
  InvestigationLifecycleStepper,
  statusToStageIndex,
} from './investigation-lifecycle-stepper';

function renderInEnglish(node: ReactNode) {
  return render(
    <LocaleProvider locale="en" direction="ltr" messages={getMessages('en')}>
      {node}
    </LocaleProvider>,
  );
}

const closedAudit: InvestigationAuditEntry[] = [
  {
    id: 'audit-close',
    tenant_id: 'tenant-1',
    investigation_id: 'inv-1',
    action: 'status_updated',
    from_status: 'approved',
    to_status: 'closed',
    actor_user_id: 'reviewer-22',
    created_at: '2026-07-12T10:30:00.000Z',
  },
];

describe('InvestigationLifecycleStepper', () => {
  it('collapses all raw statuses onto five visible stages', () => {
    expect(INVESTIGATION_LIFECYCLE_STAGES).toHaveLength(5);
    expect(statusToStageIndex('registered')).toBe(0);
    expect(statusToStageIndex('in_progress')).toBe(1);
    expect(statusToStageIndex('results_recorded')).toBe(2);
    expect(statusToStageIndex('pending_approval')).toBe(3);
    expect(statusToStageIndex('approved')).toBe(3);
    expect(statusToStageIndex('rejected')).toBe(3);
    expect(statusToStageIndex('closed')).toBe(4);
  });

  it('renders the supplied action in the lifecycle rail', () => {
    renderInEnglish(
      <InvestigationLifecycleStepper
        status="in_progress"
        auditEntries={[]}
        actionSlot={<Button type="button">Record findings</Button>}
      />,
    );

    expect(screen.getByTestId('investigation-lifecycle-rail')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Record findings' })).toBeInTheDocument();
    expect(screen.getByText('Registered')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Findings')).toBeInTheDocument();
    expect(screen.getByText('Approval')).toBeInTheDocument();
    expect(screen.getByText('Closed')).toBeInTheDocument();
  });

  it('annotates rejection on the approval stage', () => {
    renderInEnglish(
      <InvestigationLifecycleStepper status="rejected" auditEntries={[]} />,
    );

    expect(screen.getByText('Rejected')).toBeInTheDocument();
    expect(screen.getByText(/Returned for rework/)).toBeInTheDocument();
    expect(screen.getByText('Approval').closest('li')).toHaveAttribute('aria-current', 'step');
  });

  it('states terminal time and actor from the audit trail', () => {
    renderInEnglish(
      <InvestigationLifecycleStepper status="closed" auditEntries={closedAudit} />,
    );

    expect(screen.getByRole('status')).toHaveTextContent(/Closed on .* by reviewer-22\./);
  });
});
