/**
 * Regression cover for the case-task status control.
 *
 * Feedback item 9 removed the "Required Actions" list from the Legal Position
 * tab because it duplicated this tab. That list was the ONLY caller of
 * `casesApi.updateTask`, so its removal silently took away the ability to move
 * a case task through its lifecycle. These tests pin the restored four-state
 * control so the capability cannot be dropped again.
 */

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import type { CaseTask } from '@/lib/lex/cases';
import { TasksTab } from './tasks-tab';

const { deleteTaskMock, listUsersMock, showApiErrorMock, showSuccessMock, updateTaskMock } = vi.hoisted(() => ({
  deleteTaskMock: vi.fn(),
  listUsersMock: vi.fn(),
  showApiErrorMock: vi.fn(),
  showSuccessMock: vi.fn(),
  updateTaskMock: vi.fn(),
}));

vi.mock('@/lib/lex/cases', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/lex/cases')>();
  return {
    ...actual,
    casesApi: {
      ...actual.casesApi,
      updateTask: updateTaskMock,
      deleteTask: deleteTaskMock,
    },
  };
});

vi.mock('@/lib/enterprise', () => ({
  enterpriseApi: { users: { list: listUsersMock } },
  userDisplayName: (user: { id: string }) => user.id,
}));

vi.mock('@/lib/toast', () => ({
  showApiError: showApiErrorMock,
  showSuccess: showSuccessMock,
}));

const TASK_TITLE = 'File the statement of claim';

function buildTask(overrides: Partial<CaseTask> = {}): CaseTask {
  return {
    id: 'task-1',
    case_id: 'case-1',
    title: TASK_TITLE,
    priority: 'high',
    status: 'open',
    due_date: null,
    assignee_id: null,
    ...overrides,
  } as CaseTask;
}

function renderTab(props: Partial<React.ComponentProps<typeof TasksTab>> = {}) {
  return renderWithQuery(
    <TasksTab caseId="case-1" tasks={[buildTask()]} canWrite onChanged={vi.fn()} {...props} />,
  );
}

function statusControl() {
  return screen.getByRole('combobox', { name: new RegExp(TASK_TITLE, 'i') });
}

async function chooseStatus(label: string) {
  const user = userEvent.setup();
  await user.click(statusControl());
  await user.click(screen.getByRole('option', { name: label }));
}

describe('TasksTab status control', () => {
  beforeEach(() => {
    updateTaskMock.mockReset().mockResolvedValue(buildTask({ status: 'done' }));
    deleteTaskMock.mockReset();
    listUsersMock.mockReset().mockResolvedValue({ data: [] });
    showApiErrorMock.mockReset();
    showSuccessMock.mockReset();
  });

  it.each([
    ['In progress', 'in_progress'],
    ['Done', 'done'],
    ['Cancelled', 'cancelled'],
  ] as const)('moves an open task to %s', async (label, status) => {
    renderTab();

    await chooseStatus(label);

    await waitFor(() =>
      expect(updateTaskMock).toHaveBeenCalledWith('case-1', 'task-1', { status }),
    );
  });

  it('reopens a completed task', async () => {
    renderTab({ tasks: [buildTask({ status: 'done' })] });

    await chooseStatus('Open');

    await waitFor(() =>
      expect(updateTaskMock).toHaveBeenCalledWith('case-1', 'task-1', { status: 'open' }),
    );
  });

  it('does not let a read-only viewer change status', () => {
    renderTab({ canWrite: false });
    expect(screen.queryByRole('combobox', { name: new RegExp(TASK_TITLE, 'i') })).not.toBeInTheDocument();
    expect(screen.getByText('Open')).toBeInTheDocument();
  });

  it('leaves a cancelled task terminal', () => {
    renderTab({ tasks: [buildTask({ status: 'cancelled' })] });
    expect(statusControl()).toBeDisabled();
  });

  it('disables the row control while its update is pending and refreshes after success', async () => {
    let resolveUpdate: ((task: CaseTask) => void) | undefined;
    updateTaskMock.mockReturnValueOnce(
      new Promise<CaseTask>((resolve) => {
        resolveUpdate = resolve;
      }),
    );
    const onChanged = vi.fn().mockResolvedValue(undefined);
    renderTab({ onChanged });

    await chooseStatus('In progress');
    expect(statusControl()).toBeDisabled();
    expect(statusControl()).toHaveAttribute('aria-busy', 'true');

    resolveUpdate?.(buildTask({ status: 'in_progress' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledOnce());
    expect(showSuccessMock).toHaveBeenCalledWith('Task status updated.');
  });

  it('reports an API failure without refreshing stale case data', async () => {
    const error = new Error('status update failed');
    updateTaskMock.mockRejectedValueOnce(error);
    const onChanged = vi.fn();
    renderTab({ onChanged });

    await chooseStatus('Done');

    await waitFor(() => expect(showApiErrorMock).toHaveBeenCalledOnce());
    expect(showApiErrorMock.mock.calls[0]?.[0]).toBe(error);
    expect(onChanged).not.toHaveBeenCalled();
  });
});
