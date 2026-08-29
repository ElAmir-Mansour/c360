import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import type { DRRunbookPlan } from '@/types/clario-dr';

/**
 * `/dr/runbooks/[id]` runbook authoring tests.
 *
 * Proves the page renders the authored plan via the DS `RunbookTaskFlow`, that
 * opening Add task and submitting fires `addTask(runbookId, payload)` with a
 * zod-valid `DRRunbookAddTaskRequest`, and that the authoring controls are gated
 * behind `dr:write` (disabled, no dialogs / actions). Plus an Arabic render.
 */

const RUNBOOK_ID = 'rb-1';

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => `/dr/runbooks/${RUNBOOK_ID}`,
  useParams: () => ({ id: RUNBOOK_ID }),
  useSearchParams: () => new URLSearchParams(''),
}));

let canWrite = true;
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    hasPermission: (perm: string) => (perm === 'dr:write' ? canWrite : true),
    user: { id: 'u1' },
  }),
}));

const PLAN: DRRunbookPlan = {
  runbook: {
    id: RUNBOOK_ID,
    tenant_id: 't1',
    group_id: 'group-erp',
    name: 'Tier-1 regional failover',
    description: 'Recovers the Tier-1 ERP estate.',
    status: 'draft',
    source: 'studio',
    created_by: 'u1',
    created_at: '2026-06-14T09:00:00Z',
    updated_at: '2026-06-14T09:00:00Z',
  },
  tasks: [
    {
      id: 'task-detect',
      tenant_id: 't1',
      runbook_id: RUNBOOK_ID,
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
    },
  ],
};

vi.mock('../../_hooks/use-dr-queries', () => ({
  useDRRunbook: () => ({ data: PLAN, isLoading: false, error: null, refetch: vi.fn() }),
}));

const addTaskMock = vi.fn();
vi.mock('../../_hooks/use-dr-actions', () => ({
  useRunbookStudioActions: () => ({
    createRunbook: vi.fn(),
    createRunbookPending: false,
    createRunbookError: null,
    latestRunbook: null,
    latestRunbookId: null,
    updateRunbook: vi.fn(),
    updateRunbookPending: false,
    updateRunbookError: null,
    addTask: addTaskMock,
    addTaskPending: false,
    addTaskError: null,
    latestTask: null,
    startRun: vi.fn(),
    startRunPending: false,
    startRunError: null,
    latestRunId: null,
    actOnTask: vi.fn(),
    actOnTaskPending: false,
    actOnTaskError: null,
    latestRunState: null,
  }),
}));

import DRRunbookAuthorPage from './page';

beforeEach(() => {
  canWrite = true;
  vi.clearAllMocks();
});

afterEach(() => cleanup());

describe('DRRunbookAuthorPage', () => {
  it('renders the authored plan through the design-system task flow', () => {
    renderWithQuery(<DRRunbookAuthorPage />);
    expect(screen.getAllByText('Tier-1 regional failover').length).toBeGreaterThan(0);
    expect(screen.getByText('Detect outage')).toBeInTheDocument();
  });

  it('add task opens the dialog and fires addTask with a zod-valid payload', async () => {
    const user = userEvent.setup();
    renderWithQuery(<DRRunbookAuthorPage />);

    await user.click(screen.getByRole('button', { name: /Add task/ }));

    await user.type(screen.getByPlaceholderText('quiesce-primary-db'), 'quiesce-db');
    await user.type(
      screen.getByPlaceholderText('Quiesce primary database'),
      'Quiesce database',
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(addTaskMock).toHaveBeenCalledTimes(1));
    expect(addTaskMock).toHaveBeenCalledWith(RUNBOOK_ID, {
      task_key: 'quiesce-db',
      name: 'Quiesce database',
      task_type: 'manual',
      required: true,
      planned_duration_seconds: 300,
      predecessors: [],
    });
  });

  it('gates the authoring controls behind dr:write — Add task is disabled', async () => {
    canWrite = false;
    const user = userEvent.setup();
    renderWithQuery(<DRRunbookAuthorPage />);

    const addTask = screen.getByRole('button', { name: /Add task/ });
    expect(addTask).toBeDisabled();
    await user.click(addTask);
    expect(addTaskMock).not.toHaveBeenCalled();
  });

  it('renders the full MSA Arabic surface for locale "ar" (RTL)', () => {
    renderWithQuery(<DRRunbookAuthorPage />, { locale: 'ar' });
    expect(screen.getByRole('button', { name: /إضافة مهمة/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /بدء التشغيل/ })).toBeInTheDocument();
  });
});
