import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import type { DRRunbookTask } from '@/types/clario-dr';
import { AddTaskDialog } from './add-task-dialog';

/**
 * Add-runbook-task dialog tests.
 *
 * Proves the dialog builds a real {@link DRRunbookAddTaskRequest} from a zod-valid
 * form (default type `manual` + required ride along; the seeded duration is sent),
 * that an existing task is selectable as a predecessor by its real id, that a
 * blank task key blocks submission (no `onAddTask`), and an Arabic / RTL render.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => '/dr/runbooks/rb-1',
  useSearchParams: () => new URLSearchParams(''),
}));

const EXISTING_TASK: DRRunbookTask = {
  id: 'task-detect',
  tenant_id: 't1',
  runbook_id: 'rb-1',
  task_key: 'detect',
  name: 'Detect outage',
  task_type: 'manual',
  required: true,
  owner: 'ops',
  team: 'platform',
  instructions: 'Confirm the outage.',
  planned_duration_seconds: 60,
  automation_action: '',
  predecessors: [],
  created_at: '2026-06-14T09:00:00Z',
  updated_at: '2026-06-14T09:00:00Z',
};

describe('AddTaskDialog', () => {
  it('calls onAddTask with a zod-valid DRRunbookAddTaskRequest payload', async () => {
    const user = userEvent.setup();
    const onAddTask = vi.fn();

    renderWithQuery(
      <AddTaskDialog
        open
        onOpenChange={vi.fn()}
        existingTasks={[EXISTING_TASK]}
        onAddTask={onAddTask}
        submitting={false}
      />,
    );

    await user.type(screen.getByPlaceholderText('quiesce-primary-db'), 'quiesce-db');
    await user.type(
      screen.getByPlaceholderText('Quiesce primary database'),
      'Quiesce database',
    );

    // Pick the existing task as a predecessor (selected by its real id).
    await user.click(screen.getByLabelText(/Detect outage/));

    // Fill the optional owner so the payload carries it (otherwise it is omitted).
    await user.type(screen.getByLabelText('Owner'), 'ops');

    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onAddTask).toHaveBeenCalledTimes(1));
    expect(onAddTask).toHaveBeenCalledWith({
      task_key: 'quiesce-db',
      name: 'Quiesce database',
      task_type: 'manual',
      required: true,
      planned_duration_seconds: 300,
      predecessors: ['task-detect'],
      owner: 'ops',
    });
  });

  it('blocks submission and does not call onAddTask when the task key is blank', async () => {
    const user = userEvent.setup();
    const onAddTask = vi.fn();

    renderWithQuery(
      <AddTaskDialog
        open
        onOpenChange={vi.fn()}
        existingTasks={[]}
        onAddTask={onAddTask}
        submitting={false}
      />,
    );

    // Leave the task key blank, only fill the name — zod must reject.
    await user.type(screen.getByPlaceholderText('Quiesce primary database'), 'Quiesce database');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.getByPlaceholderText('quiesce-primary-db')).toBeInvalid());
    expect(onAddTask).not.toHaveBeenCalled();
  });

  it('renders the full MSA Arabic surface for locale "ar" (RTL)', () => {
    renderWithQuery(
      <AddTaskDialog
        open
        onOpenChange={vi.fn()}
        existingTasks={[]}
        onAddTask={vi.fn()}
        submitting={false}
      />,
      { locale: 'ar' },
    );

    expect(screen.getByText('إضافة مهمة إلى الكتيّب')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'حفظ' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'إلغاء' })).toBeInTheDocument();
  });
});
