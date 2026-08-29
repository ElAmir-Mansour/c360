'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type SystemStatusValue = 'operational' | 'degraded' | 'unknown';

export interface UseSystemStatusResult {
  status: SystemStatusValue;
}

interface UseSystemStatusOptions {
  /** Poll interval in ms. Defaults to 60s. Pass 0 to disable polling. */
  pollIntervalMs?: number;
}

const DEFAULT_POLL_MS = 60_000;
const STATUS_ENDPOINT = '/api/status';

function isSystemStatusValue(value: unknown): value is SystemStatusValue {
  return value === 'operational' || value === 'degraded' || value === 'unknown';
}

/**
 * useSystemStatus polls the BFF `/api/status` route and exposes a coarse,
 * presentational system status. It is intentionally defensive:
 *
 *  - It never throws. Any fetch error, abort, non-2xx, or malformed payload
 *    resolves to `{ status: 'unknown' }`.
 *  - It uses a relative URL with `credentials: 'include'` so it hits the
 *    Next.js Route Handler (NOT the gateway axios instance).
 *  - It pauses polling while the document is hidden to avoid background churn.
 */
export function useSystemStatus(
  options: UseSystemStatusOptions = {},
): UseSystemStatusResult {
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_MS;
  const [status, setStatus] = useState<SystemStatusValue>('unknown');

  const isMountedRef = useRef(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = useCallback(async () => {
    if (!isMountedRef.current) return;
    if (typeof document !== 'undefined' && document.hidden) return;

    try {
      const res = await fetch(STATUS_ENDPOINT, {
        method: 'GET',
        credentials: 'include',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });

      if (!isMountedRef.current) return;

      if (!res.ok) {
        setStatus('unknown');
        return;
      }

      const body = (await res.json().catch(() => null)) as
        | { status?: unknown }
        | null;

      if (!isMountedRef.current) return;

      const next = body?.status;
      setStatus(isSystemStatusValue(next) ? next : 'unknown');
    } catch {
      // Network error / abort / parse failure — degrade silently to unknown.
      if (isMountedRef.current) setStatus('unknown');
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;

    // Initial probe.
    void fetchStatus();

    if (pollIntervalMs > 0) {
      intervalRef.current = setInterval(() => {
        void fetchStatus();
      }, pollIntervalMs);
    }

    return () => {
      isMountedRef.current = false;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [fetchStatus, pollIntervalMs]);

  return { status };
}
