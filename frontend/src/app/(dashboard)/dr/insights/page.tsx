'use client';

import { useMemo, useRef } from 'react';
import { LineChart } from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { ErrorState } from '@/components/common/error-state';
import { EmptyState } from '@/components/common/empty-state';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { resolveDRGroupId, useDRSelection } from '../_lib/dr-selection';
import {
  useDRFailoverRuns,
  useDRGroupDrillResults,
  useDRGroupSummary,
  useDRPosture,
  useDRReplicationSummary,
} from '../_hooks/use-dr-queries';
import {
  computeOpsInsights,
  hasInsightsHistory,
  type OpsInsightsInput,
} from './_lib/insights-aggregation';
import { useInsightsLabels } from './_components/insights-labels';
import { InsightsMetricStrip } from './_components/insights-metric-strip';
import { RunPerformanceSection } from './_components/run-performance-section';
import { DrillTrendSection } from './_components/drill-trend-section';
import { RpoBreachSection } from './_components/rpo-breach-section';

/**
 * Ops-insights route (`/dr/insights`) — deep-linkable operational analytics
 * computed ONLY from real run/drill/posture history that the console already
 * fetches:
 *
 *  - `useDRFailoverRuns()` (tenant-wide history) → RTO attainment + median/p90
 *    run duration, derived via the shared `_lib/rto.ts` elapsed/breach math
 *    (there is no `met_rto` on a `DRFailoverRun`, so attainment is recomputed
 *    from the objective vs the measured actual).
 *  - `useDRGroupDrillResults(activeGroupId)` (group-scoped drill history) →
 *    drill cadence + pass-rate trend.
 *  - `useDRPosture()` / `useDRReplicationSummary()` → current RPO-breach picture
 *    (a live posture snapshot, honestly labelled as point-in-time).
 *
 * The posture banner, command bar, and console nav come from `dr/layout.tsx`;
 * this page renders only its own content. Group selection is URL-param-driven via
 * `useDRSelection`. The whole view is read-only (no write actions), so it carries
 * no `dr:write` gate — it surfaces evidence operators rely on, not mutations.
 *
 * No metric is fabricated and no `/metrics` endpoint is invented; every number
 * traces back to a real field on the fetched data shapes.
 */

/** Recency window applied to the run history before computing attainment/duration. */
const RECENT_RUN_WINDOW = 25;

export default function DRInsightsPage() {
  const labels = useInsightsLabels();

  // A single render clock so the RTO elapsed/breach math is stable within a
  // render pass (and deterministic for any in-flight run still being measured).
  const nowRef = useRef<number>(Date.now());
  const now = nowRef.current;

  // --- Selection (URL-param driven) ----------------------------------------
  const postureQuery = useDRPosture();
  const replicationQuery = useDRReplicationSummary();
  const groups = useMemo(() => postureQuery.data?.groups ?? [], [postureQuery.data?.groups]);

  const baseSelection = useDRSelection({ groups });
  const groupSummaryQuery = useDRGroupSummary(baseSelection.activeGroupId);
  const selection = useDRSelection({
    groups,
    groupSummary: groupSummaryQuery.data ?? null,
    replication: replicationQuery.data ?? null,
  });
  const { activeGroupId } = selection;

  const selectedGroupName = useMemo(() => {
    const selected =
      groups.find((group) => resolveDRGroupId(group) === activeGroupId) ?? groups[0] ?? null;
    return groupSummaryQuery.data?.name ?? selected?.name ?? null;
  }, [groups, activeGroupId, groupSummaryQuery.data?.name]);

  // --- Real history --------------------------------------------------------
  const failoverRunsQuery = useDRFailoverRuns();
  const drillResultsQuery = useDRGroupDrillResults(activeGroupId);

  const input: OpsInsightsInput = useMemo(
    () => ({
      runs: failoverRunsQuery.data ?? [],
      drillResults: drillResultsQuery.data ?? [],
      posture: postureQuery.data ?? null,
      replication: replicationQuery.data ?? null,
      runWindow: RECENT_RUN_WINDOW,
    }),
    [
      failoverRunsQuery.data,
      drillResultsQuery.data,
      postureQuery.data,
      replicationQuery.data,
    ],
  );

  const insights = useMemo(() => computeOpsInsights(input, now), [input, now]);

  // The two history sources whose absence means "nothing to show".
  const historyLoading = failoverRunsQuery.isLoading || drillResultsQuery.isLoading;
  const historyError = failoverRunsQuery.error ?? drillResultsQuery.error;

  const onRetryRuns = () => {
    void failoverRunsQuery.refetch();
  };
  const onRetryDrills = () => {
    void drillResultsQuery.refetch();
  };

  const header = (
    <PageHeader title={labels.pageTitle} description={labels.pageDescription} />
  );

  if (historyLoading) {
    return (
      <div className="space-y-6">
        {header}
        <LoadingSkeleton variant="card" count={2} />
        <LoadingSkeleton variant="chart" count={2} />
      </div>
    );
  }

  if (historyError) {
    return (
      <div className="space-y-6">
        {header}
        <ErrorState
          title={labels.errorTitle}
          message={historyError instanceof Error ? historyError.message : String(historyError)}
          onRetry={() => {
            onRetryRuns();
            onRetryDrills();
          }}
        />
      </div>
    );
  }

  if (!hasInsightsHistory(input)) {
    return (
      <div className="space-y-6">
        {header}
        <EmptyState
          icon={LineChart}
          title={labels.emptyTitle}
          description={labels.emptyDescription}
          action={{ label: labels.emptyAction, href: '/dr/rehearse' }}
          size="compact"
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}

      <Alert>
        <LineChart className="h-4 w-4" aria-hidden />
        <AlertTitle>{labels.fromRealHistoryNote}</AlertTitle>
        {selectedGroupName ? (
          <AlertDescription>{labels.groupScopeNote(selectedGroupName)}</AlertDescription>
        ) : null}
      </Alert>

      <InsightsMetricStrip insights={insights} />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <RunPerformanceSection
          series={insights.runDurationSeries}
          loading={failoverRunsQuery.isFetching && insights.runDurationSeries.length === 0}
          error={
            failoverRunsQuery.error
              ? failoverRunsQuery.error instanceof Error
                ? failoverRunsQuery.error.message
                : String(failoverRunsQuery.error)
              : undefined
          }
          onRetry={onRetryRuns}
        />
        <DrillTrendSection
          trend={insights.drillTrend}
          outcomes={insights.drillOutcomes}
          loading={drillResultsQuery.isFetching && insights.drillTrend.length === 0}
          error={
            drillResultsQuery.error
              ? drillResultsQuery.error instanceof Error
                ? drillResultsQuery.error.message
                : String(drillResultsQuery.error)
              : undefined
          }
          onRetry={onRetryDrills}
        />
      </div>

      <RpoBreachSection stats={insights.rpoBreaches} />
    </div>
  );
}
