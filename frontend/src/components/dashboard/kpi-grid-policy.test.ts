import { describe, expect, it } from 'vitest';
import { KPI_GRID_CLASS, shouldShowPendingTaskKpi } from './kpi-grid-policy';

describe('dashboard KPI layout policy', () => {
  it('uses auto-fit rather than reserving four empty columns', () => {
    expect(KPI_GRID_CLASS).toContain('repeat(auto-fit');
    expect(KPI_GRID_CLASS).not.toContain('lg:grid-cols-4');
  });

  it('lets the task list own the zero state while preserving actionable states', () => {
    expect(
      shouldShowPendingTaskKpi({
        permissionDenied: false,
        isLoading: false,
        hasError: false,
        pending: 0,
        overdue: 0,
      }),
    ).toBe(false);
    expect(
      shouldShowPendingTaskKpi({
        permissionDenied: false,
        isLoading: false,
        hasError: false,
        pending: 2,
        overdue: 0,
      }),
    ).toBe(true);
  });
});
