'use client';

import { useEffect, useRef, useState } from 'react';

interface UsePollingOperationOptions<T> {
  enabled: boolean;
  intervalMs?: number;
  fetcher: () => Promise<T>;
  isDone: (value: T) => boolean;
  onData?: (value: T) => void;
  onError?: (error: Error) => void;
}

interface UsePollingOperationResult<T> {
  data: T | null;
  error: string | null;
  isPolling: boolean;
  start: () => void;
  stop: () => void;
}

// A single fetch blip must not permanently freeze a polling dialog; only halt
// after this many consecutive failures so callers can surface a retry.
const MAX_CONSECUTIVE_FAILURES = 3;

export function usePollingOperation<T>({
  enabled,
  intervalMs = 3000,
  fetcher,
  isDone,
  onData,
  onError,
}: UsePollingOperationOptions<T>): UsePollingOperationResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPolling, setIsPolling] = useState(enabled);
  const intervalRef = useRef<number | null>(null);
  const pendingRef = useRef(false);
  const failuresRef = useRef(0);

  // Mirror the callbacks/predicate in refs so the polling effect depends only
  // on [intervalMs, isPolling]. Callers pass fresh inline `fetcher`/`onData`
  // closures every render; if those were effect deps the interval would tear
  // down and re-arm (firing an immediate tick) on every parent render.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const isDoneRef = useRef(isDone);
  isDoneRef.current = isDone;
  const onDataRef = useRef(onData);
  onDataRef.current = onData;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    setIsPolling(enabled);
  }, [enabled]);

  useEffect(() => {
    if (!isPolling) {
      return;
    }

    const tick = async () => {
      if (pendingRef.current) {
        return;
      }
      pendingRef.current = true;
      try {
        const next = await fetcherRef.current();
        failuresRef.current = 0;
        setData(next);
        setError(null);
        onDataRef.current?.(next);
        if (isDoneRef.current(next)) {
          setIsPolling(false);
        }
      } catch (err) {
        // Tolerate transient failures — keep polling and only stop after
        // MAX_CONSECUTIVE_FAILURES so one dropped request can't hang the UI.
        const message = err instanceof Error ? err.message : 'Operation failed';
        failuresRef.current += 1;
        setError(message);
        onErrorRef.current?.(err instanceof Error ? err : new Error(message));
        if (failuresRef.current >= MAX_CONSECUTIVE_FAILURES) {
          setIsPolling(false);
        }
      } finally {
        pendingRef.current = false;
      }
    };

    void tick();
    intervalRef.current = window.setInterval(() => {
      void tick();
    }, intervalMs);

    return () => {
      if (intervalRef.current !== null) {
        window.clearInterval(intervalRef.current);
      }
    };
  }, [intervalMs, isPolling]);

  return {
    data,
    error,
    isPolling,
    start: () => {
      failuresRef.current = 0;
      setError(null);
      setIsPolling(true);
    },
    stop: () => setIsPolling(false),
  };
}
