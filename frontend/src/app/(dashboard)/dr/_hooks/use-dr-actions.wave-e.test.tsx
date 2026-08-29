import { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Unit tests for the Wave E action hooks in `use-dr-actions.ts`
 * (`useRunbookStudioActions`, `useTopologyActions`, `useBootActions`,
 * `useGameDayActions`).
 *
 * They prove REAL wiring (not stubs): each `mutate` fn calls the matching
 * `@/lib/clario-dr` function with the correct args, and on success fires the exact
 * `['clario-dr', ...]` invalidation keys the matching query hooks register (so a
 * write refreshes the right cache entry) and surfaces the latest result.
 */

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/clario-dr', () => ({
  createDRRunbook: vi.fn(),
  updateDRRunbook: vi.fn(),
  addDRRunbookTask: vi.fn(),
  startDRRunbookRun: vi.fn(),
  actOnDRRunbookTask: vi.fn(),
  addDRTopologyEdge: vi.fn(),
  defineDRBootServices: vi.fn(),
  startDRBootRun: vi.fn(),
  createDRGameDayScenario: vi.fn(),
  runDRGameDayScenario: vi.fn(),
}));

import * as drApi from '@/lib/clario-dr';
import {
  useBootActions,
  useGameDayActions,
  useRunbookStudioActions,
  useTopologyActions,
} from './use-dr-actions';

const api = vi.mocked(drApi);

let invalidateSpy: ReturnType<typeof vi.spyOn>;

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  invalidateSpy = vi
    .spyOn(QueryClient.prototype, 'invalidateQueries')
    .mockResolvedValue(undefined);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

function invalidatedKeys(): unknown[][] {
  const calls = invalidateSpy.mock.calls as unknown[][];
  return calls
    .map((call) => (call[0] as { queryKey?: unknown[] } | undefined)?.queryKey)
    .filter((key): key is unknown[] => Array.isArray(key));
}

function expectInvalidated(key: unknown[]) {
  const keys = invalidatedKeys();
  const match = keys.some((k) => JSON.stringify(k) === JSON.stringify(key));
  expect(
    match,
    `expected invalidateQueries with ${JSON.stringify(key)}; got ${JSON.stringify(keys)}`,
  ).toBe(true);
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  invalidateSpy?.mockRestore();
});

describe('useRunbookStudioActions', () => {
  it('createRunbook calls createDRRunbook, surfaces the new id, and invalidates the runbook key', async () => {
    api.createDRRunbook.mockResolvedValue({
      runbook: { id: 'rb-1', name: 'Tier-1' },
      tasks: [],
    } as never);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useRunbookStudioActions(), { wrapper });

    act(() => result.current.createRunbook({ name: 'Tier-1' }));

    await waitFor(() => expect(result.current.latestRunbookId).toBe('rb-1'));
    expect(api.createDRRunbook).toHaveBeenCalledWith({ name: 'Tier-1' });
    expectInvalidated(['clario-dr', 'runbook', 'rb-1']);
  });

  it('addTask calls addDRRunbookTask and invalidates the runbook key for the task runbook_id', async () => {
    api.addDRRunbookTask.mockResolvedValue({
      id: 't-1',
      name: 'Quiesce',
      runbook_id: 'rb-9',
    } as never);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useRunbookStudioActions(), { wrapper });

    act(() => result.current.addTask('rb-9', { task_key: 'quiesce', name: 'Quiesce' }));

    await waitFor(() => expect(result.current.latestTask).toMatchObject({ id: 't-1' }));
    expect(api.addDRRunbookTask).toHaveBeenCalledWith('rb-9', {
      task_key: 'quiesce',
      name: 'Quiesce',
    });
    expectInvalidated(['clario-dr', 'runbook', 'rb-9']);
  });

  it('startRun invalidates both the runbook-run and runbook keys and surfaces the run id', async () => {
    api.startDRRunbookRun.mockResolvedValue({
      run: { id: 'run-1', runbook_id: 'rb-1' },
      tasks: [],
      task_runs: [],
      frontier: [],
      projection: {},
    } as never);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useRunbookStudioActions(), { wrapper });

    act(() => result.current.startRun('rb-1', { mode: 'drill' }));

    await waitFor(() => expect(result.current.latestRunId).toBe('run-1'));
    expect(api.startDRRunbookRun).toHaveBeenCalledWith('rb-1', { mode: 'drill' });
    expectInvalidated(['clario-dr', 'runbook-run', 'run-1']);
    expectInvalidated(['clario-dr', 'runbook', 'rb-1']);
  });

  it('actOnTask calls actOnDRRunbookTask with the action and invalidates the runbook-run key', async () => {
    api.actOnDRRunbookTask.mockResolvedValue({
      run: { id: 'run-2', runbook_id: 'rb-1' },
      tasks: [],
      task_runs: [],
      frontier: [],
      projection: {},
    } as never);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useRunbookStudioActions(), { wrapper });

    act(() => result.current.actOnTask('run-2', 'task-7', 'complete', { note: 'done' }));

    await waitFor(() =>
      expect(result.current.latestRunState).toMatchObject({ run: { id: 'run-2' } }),
    );
    expect(api.actOnDRRunbookTask).toHaveBeenCalledWith('run-2', 'task-7', 'complete', {
      note: 'done',
    });
    expectInvalidated(['clario-dr', 'runbook-run', 'run-2']);
  });
});

describe('useTopologyActions', () => {
  it('addTopologyEdge calls addDRTopologyEdge and invalidates topology + failover-target for the group', async () => {
    api.addDRTopologyEdge.mockResolvedValue({
      group_id: 'grp-1',
      nodes: [],
      edges: [],
    } as never);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useTopologyActions(), { wrapper });

    act(() =>
      result.current.addTopologyEdge('grp-1', {
        from_site_id: 'site-a',
        to_site_id: 'site-b',
        stream_id: 'stream-1',
      }),
    );

    await waitFor(() =>
      expect(result.current.latestTopology).toMatchObject({ group_id: 'grp-1' }),
    );
    expect(api.addDRTopologyEdge).toHaveBeenCalledWith('grp-1', {
      from_site_id: 'site-a',
      to_site_id: 'site-b',
      stream_id: 'stream-1',
    });
    expectInvalidated(['clario-dr', 'topology', 'grp-1']);
    expectInvalidated(['clario-dr', 'topology-failover-target', 'grp-1']);
  });
});

describe('useBootActions', () => {
  it('defineBootServices calls defineDRBootServices and invalidates the boot-plan key', async () => {
    api.defineDRBootServices.mockResolvedValue({ group_id: 'grp-1', tiers: [] } as never);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useBootActions(), { wrapper });

    act(() =>
      result.current.defineBootServices('grp-1', {
        services: [{ name: 'api', probe_kind: 'http', probe_target: '/healthz' }],
      }),
    );

    await waitFor(() =>
      expect(result.current.latestBootPlan).toMatchObject({ group_id: 'grp-1' }),
    );
    expectInvalidated(['clario-dr', 'boot-plan', 'grp-1']);
  });

  it('startBootRun calls startDRBootRun and invalidates the boot-run + boot-plan keys', async () => {
    api.startDRBootRun.mockResolvedValue({
      run: { id: 'boot-1', group_id: 'grp-1' },
      services: [],
    } as never);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useBootActions(), { wrapper });

    act(() => result.current.startBootRun('grp-1', 'isolated'));

    await waitFor(() => expect(result.current.latestBootRunId).toBe('boot-1'));
    expect(api.startDRBootRun).toHaveBeenCalledWith('grp-1', 'isolated');
    expectInvalidated(['clario-dr', 'boot-run', 'boot-1']);
    expectInvalidated(['clario-dr', 'boot-plan', 'grp-1']);
  });
});

describe('useGameDayActions', () => {
  it('createScenario calls createDRGameDayScenario and invalidates the scenario list', async () => {
    api.createDRGameDayScenario.mockResolvedValue({
      id: 'sc-1',
      name: 'Region loss',
    } as never);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useGameDayActions(), { wrapper });

    act(() =>
      result.current.createScenario({
        group_id: 'grp-1',
        name: 'Region loss',
        scope: 'group',
        steps: [],
      }),
    );

    await waitFor(() =>
      expect(result.current.latestScenario).toMatchObject({ id: 'sc-1' }),
    );
    expectInvalidated(['clario-dr', 'gameday-scenarios']);
  });

  it('runScenario calls runDRGameDayScenario, surfaces the scorecard run id, and invalidates scenarios + scorecard', async () => {
    api.runDRGameDayScenario.mockResolvedValue({
      run: { id: 'gd-run-1', safety_verdict: 'safe' },
      steps: [],
    } as never);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useGameDayActions(), { wrapper });

    act(() => result.current.runScenario('sc-1'));

    await waitFor(() => expect(result.current.latestRunId).toBe('gd-run-1'));
    // `mutationFn: runDRGameDayScenario` is point-free, so react-query appends a
    // mutation-context arg; assert only the leading scenario id it is called with.
    expect(api.runDRGameDayScenario.mock.calls[0]?.[0]).toBe('sc-1');
    expectInvalidated(['clario-dr', 'gameday-scenarios']);
    expectInvalidated(['clario-dr', 'gameday-scorecard', 'gd-run-1']);
  });
});
