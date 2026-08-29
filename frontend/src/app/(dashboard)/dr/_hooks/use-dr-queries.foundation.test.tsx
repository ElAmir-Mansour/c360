import { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Unit tests for the foundation query hooks that the ledger + compliance build
 * agents (`prove/ledger`, `prove/compliance`, `rehearse`) import from
 * `use-dr-queries.ts`.
 *
 * They prove REAL wiring (not stubs): each hook calls the matching
 * `@/lib/clario-dr` fetch fn and registers the exact `['clario-dr', ...]` query
 * key the cross-route cache + mutation invalidations depend on. The default
 * attestation-ledger key is asserted byte-for-byte because the anchor mutation in
 * `useEvidenceActions` invalidates that literal key.
 */

vi.mock('@/lib/clario-dr', () => ({
  fetchDRAttestationLedger: vi.fn(),
  fetchDRDrillScheduleNextRuns: vi.fn(),
  fetchDRGroupDrillResults: vi.fn(),
}));

import * as drApi from '@/lib/clario-dr';
import {
  useDRAttestationLedger,
  useDRDrillScheduleNextRuns,
  useDRGroupDrillResults,
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

describe('useDRAttestationLedger', () => {
  it('fetches with a default limit under the bare attestation-ledger key when no filters are passed', async () => {
    api.fetchDRAttestationLedger.mockResolvedValue([{ seq: 1 }] as never);
    const { queryClient, wrapper } = makeWrapper();
    const { result } = renderHook(() => useDRAttestationLedger(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.fetchDRAttestationLedger).toHaveBeenCalledWith({ limit: 25 });
    // Byte-for-byte key that the anchor mutation invalidates.
    expect(
      queryClient.getQueryData(['clario-dr', 'attestation-ledger']),
    ).toEqual([{ seq: 1 }]);
  });

  it('scopes the key by filters and merges a default limit when filters omit one', async () => {
    api.fetchDRAttestationLedger.mockResolvedValue([{ seq: 9 }] as never);
    const { queryClient, wrapper } = makeWrapper();
    const filters = { type: 'failover' };
    const { result } = renderHook(() => useDRAttestationLedger(filters), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.fetchDRAttestationLedger).toHaveBeenCalledWith({
      limit: 25,
      type: 'failover',
    });
    expect(
      queryClient.getQueryData(['clario-dr', 'attestation-ledger', filters]),
    ).toEqual([{ seq: 9 }]);
    // The default (bare) key must NOT be populated by a filtered call.
    expect(
      queryClient.getQueryData(['clario-dr', 'attestation-ledger']),
    ).toBeUndefined();
  });

  it('lets caller-supplied limit override the default', async () => {
    api.fetchDRAttestationLedger.mockResolvedValue([] as never);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(
      () => useDRAttestationLedger({ limit: 100, subject: 'group-1' }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.fetchDRAttestationLedger).toHaveBeenCalledWith({
      limit: 100,
      subject: 'group-1',
    });
  });
});

describe('useDRGroupDrillResults', () => {
  it('fetches group drill results under the shared drill-results key', async () => {
    api.fetchDRGroupDrillResults.mockResolvedValue([{ id: 'res-1' }] as never);
    const { queryClient, wrapper } = makeWrapper();
    const { result } = renderHook(() => useDRGroupDrillResults('grp-1'), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.fetchDRGroupDrillResults).toHaveBeenCalledWith('grp-1');
    expect(
      queryClient.getQueryData(['clario-dr', 'drill-results', 'grp-1']),
    ).toEqual([{ id: 'res-1' }]);
  });

  it('stays disabled while the group id is null', async () => {
    const { result } = renderHook(() => useDRGroupDrillResults(null), {
      wrapper: makeWrapper().wrapper,
    });

    expect(result.current.fetchStatus).toBe('idle');
    expect(api.fetchDRGroupDrillResults).not.toHaveBeenCalled();
  });
});

describe('useDRDrillScheduleNextRuns', () => {
  it('fetches next runs under a schedule+count scoped key when a schedule id is present', async () => {
    api.fetchDRDrillScheduleNextRuns.mockResolvedValue({
      schedule_id: 'sch-1',
      next_runs: ['2026-07-01T00:00:00Z'],
      count: 1,
    } as never);
    const { queryClient, wrapper } = makeWrapper();
    const { result } = renderHook(
      () => useDRDrillScheduleNextRuns('sch-1', 3),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.fetchDRDrillScheduleNextRuns).toHaveBeenCalledWith('sch-1', 3);
    expect(
      queryClient.getQueryData([
        'clario-dr',
        'drill-schedule-next-runs',
        'sch-1',
        3,
      ]),
    ).toMatchObject({ schedule_id: 'sch-1', count: 1 });
  });

  it('keys count as null when omitted, distinct from a numbered horizon', async () => {
    api.fetchDRDrillScheduleNextRuns.mockResolvedValue({
      schedule_id: 'sch-2',
      next_runs: [],
      count: 0,
    } as never);
    const { queryClient, wrapper } = makeWrapper();
    const { result } = renderHook(
      () => useDRDrillScheduleNextRuns('sch-2'),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.fetchDRDrillScheduleNextRuns).toHaveBeenCalledWith(
      'sch-2',
      undefined,
    );
    expect(
      queryClient.getQueryData([
        'clario-dr',
        'drill-schedule-next-runs',
        'sch-2',
        null,
      ]),
    ).toMatchObject({ schedule_id: 'sch-2' });
  });

  it('stays disabled while the schedule id is null', async () => {
    const { result } = renderHook(() => useDRDrillScheduleNextRuns(null), {
      wrapper: makeWrapper().wrapper,
    });

    expect(result.current.fetchStatus).toBe('idle');
    expect(api.fetchDRDrillScheduleNextRuns).not.toHaveBeenCalled();
  });
});
