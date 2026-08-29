import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import type { DRRunbookLiveState } from '@/types/clario-dr';

/**
 * `/dr/runbooks/runs/[runId]` live runbook execution (war-room) tests.
 *
 * Proves the page renders the design-system `RunbookTaskFlow` from the REAL
 * `DRRunbookLiveState` (tasks + task_runs + server projection), that selecting a
 * runnable task and completing it fires `actOnTask(runId, taskId, 'complete')`,
 * that the act controls are gated behind `dr:write`, and an Arabic / RTL render.
 */

const RUN_ID = 'run-rb-1';

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => `/dr/runbooks/runs/${RUN_ID}`,
  useParams: () => ({ runId: RUN_ID }),
  useSearchParams: () => new URLSearchParams(''),
}));

let canWrite = true;
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    hasPermission: (perm: string) => (perm === 'dr:write' ? canWrite : true),
    user: { id: 'u1' },
  }),
}));

// Realtime / liveness layer is a no-op in tests (just returns a refetch interval).
vi.mock('../../../_hooks/use-dr-realtime', () => ({
  useDRRefetchInterval: () => 5_000,
  DR_BASELINE_REFETCH_MS: 45_000,
}));

// Live run state: `detect` is runnable (no preds, no run row); `quiesce` depends
// on it (pending). The projection is the real server-computed shape.
const LIVE_STATE: DRRunbookLiveState = {
  run: {
    id: RUN_ID,
    tenant_id: 't1',
    runbook_id: 'rb-1',
    mode: 'rehearsal',
    status: 'running',
    planned_critical_path_seconds: 360,
    started_by: 'u1',
    started_at: '2026-06-14T09:00:00Z',
    completed_at: null,
    actual_duration_seconds: null,
    last_error: null,
    claimed_at: null,
    updated_at: '2026-06-14T09:01:00Z',
  },
  tasks: [
    {
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
    },
    {
      id: 'task-quiesce',
      tenant_id: 't1',
      runbook_id: 'rb-1',
      task_key: 'quiesce',
      name: 'Quiesce database',
      task_type: 'automated',
      required: true,
      owner: 'dba',
      team: 'platform',
      instructions: 'Quiesce the primary database.',
      planned_duration_seconds: 300,
      automation_action: 'clario-dr quiesce',
      predecessors: ['task-detect'],
      created_at: '2026-06-14T09:00:00Z',
      updated_at: '2026-06-14T09:00:00Z',
    },
  ],
  task_runs: [],
  frontier: ['task-detect'],
  projection: {
    planned_critical_path_seconds: 360,
    elapsed_seconds: 60,
    completed_tasks: 0,
    total_tasks: 2,
    remaining_critical_path_seconds: 360,
    projected_finish_seconds: 420,
    projected_finish_at: '2026-06-14T09:07:00Z',
    on_track: false,
    variance_seconds: 60,
  },
};

vi.mock('../../../_hooks/use-dr-queries', () => ({
  useDRRunbookRun: () => ({
    data: LIVE_STATE,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

const actOnTaskMock = vi.fn();
vi.mock('../../../_hooks/use-dr-actions', () => ({
  useRunbookStudioActions: () => ({
    createRunbook: vi.fn(),
    createRunbookPending: false,
    createRunbookError: null,
    latestRunbook: null,
    latestRunbookId: null,
    updateRunbook: vi.fn(),
    updateRunbookPending: false,
    updateRunbookError: null,
    addTask: vi.fn(),
    addTaskPending: false,
    addTaskError: null,
    latestTask: null,
    startRun: vi.fn(),
    startRunPending: false,
    startRunError: null,
    latestRunId: null,
    actOnTask: actOnTaskMock,
    actOnTaskPending: false,
    actOnTaskError: null,
    latestRunState: null,
  }),
}));

import DRRunbookRunPage from './page';

beforeEach(() => {
  canWrite = true;
  vi.clearAllMocks();
});

afterEach(() => cleanup());

describe('DRRunbookRunPage (live execution)', () => {
  it('renders the task flow from the live state (tasks + projection strip)', () => {
    renderWithQuery(<DRRunbookRunPage />);

    // The DS task flow lists both authored tasks.
    expect(screen.getByText('Detect outage')).toBeInTheDocument();
    expect(screen.getByText('Quiesce database')).toBeInTheDocument();

    // The server-computed projection drives the projection strip's on-track verdict.
    const verdict = screen.getByTestId('run-projection-verdict');
    expect(verdict).toHaveAttribute('data-on-track', 'false');
  });

  it('completing a selected runnable task fires actOnTask(runId, taskId, "complete")', async () => {
    const user = userEvent.setup();
    renderWithQuery(<DRRunbookRunPage />);

    // Select the runnable task in the flow (its row is the interactive listitem).
    await user.click(screen.getByText('Detect outage'));

    const panel = screen.getByTestId('act-on-task-panel');
    expect(panel).toHaveAttribute('data-actionable', 'true');

    await user.click(within(panel).getByRole('button', { name: 'Complete' }));
    expect(actOnTaskMock).toHaveBeenCalledWith(RUN_ID, 'task-detect', 'complete', undefined);
  });

  it('gates the act controls behind dr:write — the Complete control is disabled', async () => {
    canWrite = false;
    const user = userEvent.setup();
    renderWithQuery(<DRRunbookRunPage />);

    await user.click(screen.getByText('Detect outage'));

    const panel = screen.getByTestId('act-on-task-panel');
    // The shared dr-write-gate wraps the panel in a disabled <fieldset>, natively
    // disabling every control inside it.
    const complete = within(panel).getByRole('button', { name: 'Complete' });
    expect(complete).toBeDisabled();
    await user.click(complete);
    expect(actOnTaskMock).not.toHaveBeenCalled();
  });

  it('renders the full MSA Arabic surface for locale "ar" (RTL)', () => {
    renderWithQuery(<DRRunbookRunPage />, { locale: 'ar' });

    expect(screen.getByText('تشغيل الكتيّب')).toBeInTheDocument();
    // The run mode + status badges resolve to MSA.
    expect(screen.getByText('بروفة')).toBeInTheDocument();
    expect(screen.getByText('قيد التشغيل')).toBeInTheDocument();
    // English headline must not leak in Arabic mode.
    expect(screen.queryByText('Runbook run')).not.toBeInTheDocument();
  });
});
