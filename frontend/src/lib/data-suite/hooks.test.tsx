import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePollingOperation } from './hooks';

// NOTE: no waitFor() here — it polls on real timers and deadlocks under
// vi.useFakeTimers(). Advance timers inside act() and assert synchronously.
describe('usePollingOperation', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('keeps polling through a single transient failure (does not freeze)', async () => {
    const fetcher = vi
      .fn<() => Promise<{ done: boolean }>>()
      .mockRejectedValueOnce(new Error('blip'))
      .mockResolvedValue({ done: true });

    const { result } = renderHook(() =>
      usePollingOperation<{ done: boolean }>({
        enabled: true,
        intervalMs: 1000,
        fetcher,
        isDone: (v) => v.done,
      }),
    );

    // Immediate tick rejects — old code called setIsPolling(false) here, hanging
    // the dialog forever. New code tolerates it and keeps polling.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.isPolling).toBe(true);
    expect(result.current.data).toBeNull();

    // Next interval tick succeeds and reaches the terminal value.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.current.data).toEqual({ done: true });
    expect(result.current.isPolling).toBe(false);
  }, 10000);

  it('gives up after 3 consecutive failures instead of polling forever', async () => {
    const fetcher = vi.fn<() => Promise<unknown>>().mockRejectedValue(new Error('down'));

    const { result } = renderHook(() =>
      usePollingOperation<unknown>({
        enabled: true,
        intervalMs: 1000,
        fetcher,
        isDone: () => false,
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0); // tick 1
      await vi.advanceTimersByTimeAsync(1000); // tick 2
      await vi.advanceTimersByTimeAsync(1000); // tick 3 → stop
    });

    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(result.current.isPolling).toBe(false);
    expect(result.current.error).toBe('down');
  }, 10000);
});
