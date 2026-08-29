import { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Offline regression guard for the "no data yet" 404 path.
 *
 * `GET /selfdr/assessments/latest` and `GET /streams/{id}/forecast` legitimately
 * 404 before any assessment / forecast has been produced. The hooks must resolve
 * that 404 to `null` (query SUCCESS with null data) so the consuming panels show
 * their graceful empty state — NOT surface a hard query error. Any non-404 error
 * (auth, 5xx, network) must still reject so the error UI shows.
 *
 * No network: the `@/lib/clario-dr` fetch fns are fully mocked.
 */
vi.mock('@/lib/clario-dr', () => ({
  fetchDRSelfDRLatestAssessment: vi.fn(),
  fetchDRStreamForecast: vi.fn(),
}));

import * as drApi from '@/lib/clario-dr';
import { useDRSelfDRLatest, useDRStreamForecast } from './use-dr-queries';

const api = vi.mocked(drApi);

function notFound() {
  return { status: 404, code: 'NOT_FOUND', message: 'self-DR assessment not found' };
}

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

describe('useDRSelfDRLatest (404 → null)', () => {
  it('resolves a 404 to null without erroring the query', async () => {
    api.fetchDRSelfDRLatestAssessment.mockRejectedValue(notFound());
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useDRSelfDRLatest(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
    expect(result.current.isError).toBe(false);
  });

  it('still surfaces a non-404 failure as a query error', async () => {
    api.fetchDRSelfDRLatestAssessment.mockRejectedValue({
      status: 500,
      code: 'INTERNAL',
      message: 'boom',
    });
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useDRSelfDRLatest(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('passes a real assessment payload straight through', async () => {
    api.fetchDRSelfDRLatestAssessment.mockResolvedValue({ id: 'a-1' } as never);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useDRSelfDRLatest(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ id: 'a-1' });
  });
});

describe('useDRStreamForecast (404 → null)', () => {
  it('resolves a 404 to null without erroring the query', async () => {
    api.fetchDRStreamForecast.mockRejectedValue({
      status: 404,
      code: 'NOT_FOUND',
      message: 'forecast not found',
    });
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useDRStreamForecast('stream-1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
    expect(result.current.isError).toBe(false);
    expect(api.fetchDRStreamForecast).toHaveBeenCalledWith('stream-1');
  });

  it('stays disabled (never fetches) while the stream id is null', () => {
    const { result } = renderHook(() => useDRStreamForecast(null), {
      wrapper: makeWrapper().wrapper,
    });
    expect(result.current.fetchStatus).toBe('idle');
    expect(api.fetchDRStreamForecast).not.toHaveBeenCalled();
  });
});
