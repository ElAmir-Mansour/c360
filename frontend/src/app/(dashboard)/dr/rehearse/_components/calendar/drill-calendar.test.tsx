import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import type { DRDrillResult, DRDrillSchedule } from '@/types/clario-dr';

/**
 * DrillCalendar render tests.
 *
 * The only network dependency is the per-schedule next-runs hook, which is mocked
 * to return REAL-shaped DRDrillNextRunsResponse data so the fan-out loader plots
 * occurrences. The component takes a fixed `now` prop so cron math + month grid
 * are deterministic. Mocks use the real DRDrillSchedule / DRDrillResult shapes.
 */

// Per-schedule next-runs feed: keyed by schedule id so each plots its own runs.
const NEXT_RUNS: Record<string, string[]> = {
  'sch-daily': ['2026-06-16T02:00:00Z', '2026-06-17T02:00:00Z'],
  'sch-overdue': ['2026-06-20T02:00:00Z'],
};

vi.mock('@/app/(dashboard)/dr/_hooks/use-dr-queries', () => ({
  useDRDrillScheduleNextRuns: (scheduleId: string | null) => ({
    data: scheduleId
      ? { schedule_id: scheduleId, next_runs: NEXT_RUNS[scheduleId] ?? [], count: (NEXT_RUNS[scheduleId] ?? []).length }
      : undefined,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

import { DrillCalendar } from './drill-calendar';

const NOW = Date.parse('2026-06-15T12:00:00Z');

const onTrackSchedule: DRDrillSchedule = {
  id: 'sch-daily',
  tenant_id: 'tenant-1',
  group_id: 'group-1',
  name: 'Weekly payments drill',
  // Weekly Monday 02:00. NOW (Mon 06-15 12:00) is past the met 06-15 occurrence;
  // the next (06-22) is > 72h away → on_track.
  cron_expr: '0 2 * * 1',
  profile: 'isolated',
  rto_objective_seconds: 900,
  enabled: true,
  next_run: '2026-06-22T02:00:00Z',
  last_fired_at: '2026-06-15T02:05:00Z',
  created_at: '2026-06-01T00:00:00Z',
  updated_at: '2026-06-15T02:05:00Z',
};

const overdueSchedule: DRDrillSchedule = {
  id: 'sch-overdue',
  tenant_id: 'tenant-1',
  group_id: 'group-1',
  name: 'Ledger isolated drill',
  cron_expr: '0 2 * * *',
  profile: 'isolated',
  rto_objective_seconds: 600,
  enabled: true,
  next_run: '2026-06-20T02:00:00Z',
  // Last run 5 days ago → the daily cadence has been missed → overdue.
  last_fired_at: '2026-06-10T02:05:00Z',
  created_at: '2026-06-01T00:00:00Z',
  updated_at: '2026-06-10T02:05:00Z',
};

const drillResults: DRDrillResult[] = [
  {
    id: 'res-1',
    tenant_id: 'tenant-1',
    group_id: 'group-1',
    schedule_id: 'sch-daily',
    run_id: 'run-1',
    passed: true,
    rto_achieved_seconds: 600,
    rpo_achieved_seconds: 30,
    rto_objective_seconds: 900,
    recovery_point_id: 'rp-1',
    validation_ratio: 1,
    validation_outcome: 'passed',
    steps: [],
    asset_fingerprint: {},
    observed_at: '2026-06-15T02:05:00Z',
    created_at: '2026-06-15T02:06:00Z',
  },
];

describe('DrillCalendar', () => {
  it('renders the calendar with the schedule heading and plots an upcoming run', () => {
    renderWithQuery(
      <DrillCalendar schedules={[onTrackSchedule]} drillResults={drillResults} now={NOW} />,
    );

    expect(screen.getByText('Drill calendar')).toBeInTheDocument();

    // The month grid is present and starts on the current month (June 2026).
    expect(screen.getByRole('grid', { name: 'Drill schedule calendar' })).toBeInTheDocument();
    expect(screen.getByText('June 2026')).toBeInTheDocument();

    // The next-run feed (2026-06-16 02:00) is plotted into the grid as a chip.
    expect(screen.getAllByText(/Weekly payments drill/).length).toBeGreaterThan(0);
    // The 16th day cell exists with a run-count aria description.
    expect(
      screen.getByRole('gridcell', { name: /Jun 16 — 1 drill run/ }),
    ).toBeInTheDocument();
  });

  it('surfaces the cadence attention banner and an Overdue badge for an overdue cadence', async () => {
    const user = userEvent.setup();
    renderWithQuery(
      <DrillCalendar
        schedules={[onTrackSchedule, overdueSchedule]}
        drillResults={drillResults}
        now={NOW}
      />,
    );

    // Attention banner reflects the breached cadence: one overdue schedule, the
    // other on-track (its next weekly run is > 72h away).
    expect(screen.getByText('Drill cadence breached')).toBeInTheDocument();
    expect(screen.getByText(/1 overdue, 0 due soon across 2 schedules/)).toBeInTheDocument();

    // Switch to the schedules list to read per-schedule cadence badges.
    await user.click(screen.getByRole('tab', { name: /Schedules/ }));

    const overdueName = screen.getByText('Ledger isolated drill');
    const overdueRow = overdueName.closest('li');
    expect(overdueRow).not.toBeNull();
    expect(within(overdueRow as HTMLElement).getByText('Overdue')).toBeInTheDocument();

    // The healthy schedule reads on-track in its own row.
    const onTrackName = screen.getByText('Weekly payments drill');
    const onTrackRow = onTrackName.closest('li');
    expect(within(onTrackRow as HTMLElement).getByText('On track')).toBeInTheDocument();
  });

  it('shows an all-clear banner when no schedule needs attention', () => {
    renderWithQuery(
      <DrillCalendar schedules={[onTrackSchedule]} drillResults={drillResults} now={NOW} />,
    );
    expect(screen.getByText('Drill cadence on track')).toBeInTheDocument();
  });

  it('renders an empty state when there are no schedules', () => {
    renderWithQuery(<DrillCalendar schedules={[]} drillResults={[]} now={NOW} />);
    expect(screen.getByText('No drill schedules')).toBeInTheDocument();
  });

  it('renders an error state with a retry action', async () => {
    const onRetry = vi.fn();
    const user = userEvent.setup();
    renderWithQuery(
      <DrillCalendar
        schedules={[]}
        drillResults={[]}
        now={NOW}
        error={new Error('boom')}
        onRetry={onRetry}
      />,
    );
    expect(screen.getByText('Could not load drill schedules')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders the Arabic (RTL) surface when the active locale is ar', () => {
    renderWithQuery(
      <DrillCalendar schedules={[onTrackSchedule]} drillResults={drillResults} now={NOW} />,
      { locale: 'ar' },
    );

    // Section heading + the all-clear cadence banner resolve to MSA.
    expect(screen.getByText('تقويم التمارين')).toBeInTheDocument();
    expect(screen.getByText('وتيرة التمارين ضمن المسار')).toBeInTheDocument();

    // The month grid is labelled in Arabic and its day cells use logical block
    // borders (border-e), which flip to the inline-end edge under RTL.
    const grid = screen.getByRole('grid', { name: 'تقويم جداول التمارين' });
    expect(grid).toBeInTheDocument();
    expect(grid.querySelector('.border-e')).not.toBeNull();

    // Arabic weekday headers are rendered (Sunday → الأحد).
    expect(screen.getByText('الأحد')).toBeInTheDocument();
  });

  it('renders the Arabic error + retry copy under the ar locale', async () => {
    const onRetry = vi.fn();
    const user = userEvent.setup();
    renderWithQuery(
      <DrillCalendar
        schedules={[]}
        drillResults={[]}
        now={NOW}
        error={new Error('boom')}
        onRetry={onRetry}
      />,
      { locale: 'ar' },
    );
    expect(screen.getByText('تعذّر تحميل جداول التمارين')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'إعادة المحاولة' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
