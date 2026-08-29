export const KPI_GRID_CLASS =
  'grid grid-cols-[repeat(auto-fit,minmax(min(100%,15rem),1fr))] gap-4 [&>*]:min-h-[170px]';

interface PendingTaskKpiState {
  permissionDenied: boolean;
  isLoading: boolean;
  hasError: boolean;
  pending?: number;
  overdue?: number;
}

/** Keep an actionable task KPI, but let the task list own the zero state. */
export function shouldShowPendingTaskKpi(state: PendingTaskKpiState): boolean {
  return (
    !state.permissionDenied &&
    (state.isLoading || state.hasError || (state.pending ?? 0) > 0 || (state.overdue ?? 0) > 0)
  );
}
