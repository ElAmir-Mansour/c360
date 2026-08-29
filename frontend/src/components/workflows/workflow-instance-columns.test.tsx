import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { getWorkflowInstanceColumns } from './workflow-instance-columns';
import type { WorkflowInstance } from '@/types/models';

function instance(overrides: Partial<WorkflowInstance> = {}): WorkflowInstance {
  return {
    id: 'instance-1',
    definition_id: 'def-1',
    definition_name: 'Lex Legal Request Approval',
    status: 'running',
    started_at: '2026-08-01T09:00:00Z',
    started_by: 'user-someone-else',
    ...overrides,
  } as WorkflowInstance;
}

/** Render the row-actions cell for one instance and open its menu. */
async function openRowActions(
  row: WorkflowInstance,
  canControl?: (i: WorkflowInstance) => boolean,
): Promise<void> {
  const columns = getWorkflowInstanceColumns({
    onView: vi.fn(),
    onCancel: vi.fn(),
    onRetry: vi.fn(),
    canControl,
  });
  const actions = columns.find((column) => column.id === 'actions');
  if (!actions?.cell || typeof actions.cell !== 'function') {
    throw new Error('actions column missing a cell renderer');
  }
  const cell = actions.cell as (ctx: { row: { original: WorkflowInstance } }) => JSX.Element;
  render(cell({ row: { original: row } }));
  await userEvent.click(screen.getByRole('button', { name: 'Row actions' }));
}

describe('getWorkflowInstanceColumns row actions', () => {
  it('offers cancel on a running instance the viewer may control', async () => {
    await openRowActions(instance(), () => true);
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });

  it('withholds cancel from a viewer who may not control the instance', async () => {
    // A contracts manager looking at another department's running approval: the
    // engine would 403 the call, so the action must not be offered at all.
    await openRowActions(instance(), () => false);
    expect(screen.queryByText('Cancel')).not.toBeInTheDocument();
    expect(screen.getByText('View Details')).toBeInTheDocument();
  });

  it('withholds retry on a failed instance the viewer may not control', async () => {
    await openRowActions(instance({ status: 'failed' }), () => false);
    expect(screen.queryByText('Retry')).not.toBeInTheDocument();
  });

  it('offers retry on a failed instance the viewer may control', async () => {
    await openRowActions(instance({ status: 'failed' }), () => true);
    expect(screen.getByText('Retry')).toBeInTheDocument();
  });

  it('permits control by default so existing callers are unaffected', async () => {
    await openRowActions(instance());
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });
});
