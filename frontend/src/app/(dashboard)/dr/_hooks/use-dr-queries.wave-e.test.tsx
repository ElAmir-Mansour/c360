import { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Unit tests for the Wave E foundation query hooks the runbook-studio / topology /
 * boot / game-day build agents import from `use-dr-queries.ts`.
 *
 * They prove REAL wiring (not stubs): each hook calls the matching
 * `@/lib/clario-dr` fetch fn with the id it is given and registers the exact
 * `['clario-dr', ...]` query key the matching action-hook invalidations target, so
 * a write refreshes the right cache entry. Disabled-while-null behaviour is also
 * asserted (no fetch fires until an id is present).
 */

vi.mock('@/lib/clario-dr', () => ({
  fetchDRRunbook: vi.fn(),
  fetchDRRunbookRun: vi.fn(),
  fetchDRBootRun: vi.fn(),
  fetchDRGameDayScorecard: vi.fn(),
  fetchDRDrillDiff: vi.fn(),
}));

import * as drApi from '@/lib/clario-dr';
import {
  useDRBootRun,
  useDRDrillDiff,
  useDRGameDayScorecard,
  useDRRunbook,
  useDRRunbookRun,
} from './use-dr-queries';

const api = vi.mocked(drApi);

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useDRRunbook', () => {
  it('fetches the plan under the runbook key the studio update/addTask actions invalidate', async () => {
    api.fetchDRRunbook.mockResolvedValue({
      runbook: { id: 'rb-1', name: 'Tier-1' },
      tasks: [],
    } as never);
    const { queryClient, wrapper } = makeWrapper();
    const { result } = renderHook(() => useDRRunbook('rb-1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.fetchDRRunbook).toHaveBeenCalledWith('rb-1');
    expect(queryClient.getQueryData(['clario-dr', 'runbook', 'rb-1'])).toMatchObject({
      runbook: { id: 'rb-1' },
    });
  });

  it('stays disabled while the runbook id is null', () => {
    const { result } = renderHook(() => useDRRunbook(null), {
      wrapper: makeWrapper().wrapper,
    });
    expect(result.current.fetchStatus).toBe('idle');
    expect(api.fetchDRRunbook).not.toHaveBeenCalled();
  });
});

describe('useDRRunbookRun', () => {
  it('fetches live state under the runbook-run key the startRun/actOnTask actions invalidate', async () => {
    api.fetchDRRunbookRun.mockResolvedValue({
      run: { id: 'run-1', runbook_id: 'rb-1' },
      tasks: [],
      task_runs: [],
      frontier: [],
      projection: {},
    } as never);
    const { queryClient, wrapper } = makeWrapper();
    const { result } = renderHook(() => useDRRunbookRun('run-1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.fetchDRRunbookRun).toHaveBeenCalledWith('run-1');
    expect(
      queryClient.getQueryData(['clario-dr', 'runbook-run', 'run-1']),
    ).toMatchObject({ run: { id: 'run-1' } });
  });
});

describe('useDRBootRun', () => {
  it('fetches boot-run detail under the boot-run key the startBootRun action invalidates', async () => {
    api.fetchDRBootRun.mockResolvedValue({
      run: { id: 'boot-1', group_id: 'grp-1' },
      services: [],
    } as never);
    const { queryClient, wrapper } = makeWrapper();
    const { result } = renderHook(() => useDRBootRun('boot-1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.fetchDRBootRun).toHaveBeenCalledWith('boot-1');
    expect(queryClient.getQueryData(['clario-dr', 'boot-run', 'boot-1'])).toMatchObject(
      { run: { id: 'boot-1' } },
    );
  });
});

describe('useDRGameDayScorecard', () => {
  it('fetches the scorecard by RUN id under the gameday-scorecard key the runScenario action invalidates', async () => {
    api.fetchDRGameDayScorecard.mockResolvedValue({
      run: { id: 'gd-run-1', safety_verdict: 'safe' },
      steps: [],
    } as never);
    const { queryClient, wrapper } = makeWrapper();
    const { result } = renderHook(() => useDRGameDayScorecard('gd-run-1'), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.fetchDRGameDayScorecard).toHaveBeenCalledWith('gd-run-1');
    expect(
      queryClient.getQueryData(['clario-dr', 'gameday-scorecard', 'gd-run-1']),
    ).toMatchObject({ run: { id: 'gd-run-1' } });
  });
});

describe('useDRDrillDiff', () => {
  it('fetches the drill-result diff under a result-scoped key', async () => {
    api.fetchDRDrillDiff.mockResolvedValue({
      group_id: 'grp-1',
      current_result_id: 'res-2',
      previous_result_id: 'res-1',
    } as never);
    const { queryClient, wrapper } = makeWrapper();
    const { result } = renderHook(() => useDRDrillDiff('res-2'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.fetchDRDrillDiff).toHaveBeenCalledWith('res-2');
    expect(queryClient.getQueryData(['clario-dr', 'drill-diff', 'res-2'])).toMatchObject(
      { current_result_id: 'res-2' },
    );
  });

  it('stays disabled while the result id is null', () => {
    const { result } = renderHook(() => useDRDrillDiff(null), {
      wrapper: makeWrapper().wrapper,
    });
    expect(result.current.fetchStatus).toBe('idle');
    expect(api.fetchDRDrillDiff).not.toHaveBeenCalled();
  });
});
