import { describe, expect, it } from 'vitest';
import {
  DASHBOARD_FALLBACK_POLL_MS,
  getDashboardRefetchInterval,
} from './use-dashboard-realtime-data';

describe('dashboard realtime fallback policy', () => {
  it('polls slowly only when realtime is unavailable', () => {
    expect(getDashboardRefetchInterval(undefined, 0, false)).toBe(false);
    expect(getDashboardRefetchInterval(undefined, 0, true)).toBe(
      DASHBOARD_FALLBACK_POLL_MS,
    );
  });

  it('honors an explicit interval without polling permission-denied queries', () => {
    expect(getDashboardRefetchInterval(undefined, 15_000, false)).toBe(15_000);
    expect(
      getDashboardRefetchInterval(
        { status: 403, code: 'FORBIDDEN', message: 'permission denied' },
        15_000,
        true,
      ),
    ).toBe(false);
  });
});
