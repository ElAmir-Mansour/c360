import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import { RunbookProgressBar, type RunbookGate } from './runbook-progress-bar';

const gates: RunbookGate[] = [
  { key: 'validate', label: 'Validate' },
  { key: 'approve', label: 'Approve' },
  { key: 'execute', label: 'Execute' },
  { key: 'attest', label: 'Attest' },
];

const stateLabels = {
  done: 'Cleared',
  current: 'In progress',
  awaitingApproval: 'Awaiting approval',
  failed: 'Failed',
  pending: 'Pending',
};

describe('RunbookProgressBar', () => {
  it('maps the AWAITING_APPROVAL failover state to the approve gate paused for sign-off', () => {
    renderWithQuery(
      <RunbookProgressBar
        gates={gates}
        status="AWAITING_APPROVAL"
        ariaLabel="Recovery progress"
        stateLabels={stateLabels}
      />,
    );

    // Validate is cleared; Approve is paused awaiting human sign-off.
    expect(screen.getByLabelText('Validate: Cleared')).toBeInTheDocument();
    expect(screen.getByLabelText('Approve: Awaiting approval')).toBeInTheDocument();
    expect(screen.getByLabelText('Execute: Pending')).toBeInTheDocument();

    const meter = screen.getByRole('meter', { name: 'Recovery progress' });
    // 1 of 4 gates cleared = 25%.
    expect(meter).toHaveAttribute('aria-valuenow', '25');
  });

  it('marks all gates cleared for a COMPLETED run', () => {
    renderWithQuery(
      <RunbookProgressBar
        gates={gates}
        status="COMPLETED"
        ariaLabel="Recovery progress"
        stateLabels={stateLabels}
      />,
    );

    expect(screen.getByLabelText('Attest: Cleared')).toBeInTheDocument();
    expect(screen.getByRole('meter', { name: 'Recovery progress' })).toHaveAttribute(
      'aria-valuenow',
      '100',
    );
  });

  it('shows the failed gate for a terminal ROLLED_BACK run', () => {
    renderWithQuery(
      <RunbookProgressBar
        gates={gates}
        status="ROLLED_BACK"
        ariaLabel="Recovery progress"
        stateLabels={stateLabels}
      />,
    );

    expect(screen.getByLabelText('Validate: Failed')).toBeInTheDocument();
  });

  it('honours an explicit task-level fraction over the gate-derived width', () => {
    renderWithQuery(
      <RunbookProgressBar
        gates={gates}
        status="EXECUTING"
        fraction={0.6}
        ariaLabel="Recovery progress"
        stateLabels={stateLabels}
      />,
    );

    expect(screen.getByRole('meter', { name: 'Recovery progress' })).toHaveAttribute(
      'aria-valuenow',
      '60',
    );
  });
});
