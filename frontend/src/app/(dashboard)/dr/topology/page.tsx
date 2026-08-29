'use client';

import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/common/page-header';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { EmptyState } from '@/components/common/empty-state';
import { Network } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import {
  useDRBootPlan,
  useDRBootRun,
  useDRGroups,
  useDRSites,
  useDRStreams,
  useDRTopology,
  useDRTopologyFailoverTarget,
} from '../_hooks/use-dr-queries';
import { useBootActions, useTopologyActions } from '../_hooks/use-dr-actions';
import { useDRSelection } from '../_lib/dr-selection';
import { GroupPicker } from './_components/group-picker';
import { TopologyGraphPanel } from './_components/topology-graph-panel';
import { FailoverTargetPanel } from './_components/failover-target-panel';
import { BootPlanPanel } from './_components/boot-plan-panel';
import { BootRunPanel } from './_components/boot-run-panel';
import { useTopologyPageLabels } from './_components/topology-page-labels';

/**
 * TOPOLOGY & BOOT (/dr/topology) — recovery-topology + isolated-boot authoring.
 *
 * For a `?group=`-selected protection group (shared `useDRSelection`, defaulting
 * to the first group) this route:
 *   - renders the directed replication topology via the design-system `NodeMap`
 *     (real `topologyToGraph` mapper) and lets a `dr:write` operator author a
 *     dependency edge (`addDRTopologyEdge`, react-hook-form + zod);
 *   - shows the server-ranked failover target for that topology
 *     (`fetchDRTopologyFailoverTarget`);
 *   - lets the operator define the tiered boot services (`defineDRBootServices`)
 *     with a boot-plan view (`fetchDRBootPlan`), and start + track an isolated
 *     boot run (`startDRBootRun` → `fetchDRBootRun`).
 *
 * Every write control is gated on `dr:write` via the shared `DRWriteGate`. The
 * boot run started here is tracked live by polling `useDRBootRun(latestBootRunId)`.
 * Console chrome (posture banner, command bar, sub-nav) is mounted by
 * `dr/layout.tsx`; this page renders only its own content. Bilingual + RTL-safe.
 */
export default function DRTopologyPage() {
  const labels = useTopologyPageLabels();
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('dr:write');

  const groupsQuery = useDRGroups();
  const groups = groupsQuery.data ?? [];

  const { activeGroupId, setGroup } = useDRSelection({ groups });

  const topologyQuery = useDRTopology(activeGroupId);
  const failoverTargetQuery = useDRTopologyFailoverTarget(activeGroupId);
  const bootPlanQuery = useDRBootPlan(activeGroupId);
  const sitesQuery = useDRSites();
  const streamsQuery = useDRStreams();

  const topologyActions = useTopologyActions();
  const bootActions = useBootActions();

  // Track the boot run started from this page (or a freshly-defined one) so the
  // live boot-run view mounts on its real run id without a list endpoint. The
  // boot run is settled-aware: once terminal, slow the poll cadence.
  const [trackedRunId, setTrackedRunId] = useState<string | null>(null);
  useEffect(() => {
    if (bootActions.latestBootRunId) setTrackedRunId(bootActions.latestBootRunId);
  }, [bootActions.latestBootRunId]);

  // Reset the tracked run when the operator switches groups (a run belongs to
  // the group it was started for).
  useEffect(() => {
    setTrackedRunId(null);
  }, [activeGroupId]);

  const bootRunDetail = bootActions.latestBootRun;
  const settled =
    bootRunDetail != null &&
    ['completed', 'failed', 'rolled_back'].includes(bootRunDetail.run.status);
  const bootRunQuery = useDRBootRun(trackedRunId, settled ? 60_000 : 15_000);

  const groupsLoading = groupsQuery.isLoading && groups.length === 0;
  const groupsErrored = Boolean(groupsQuery.error) && groups.length === 0;

  if (groupsLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title={labels.pageTitle} description={labels.loadingDescription} />
        <LoadingSkeleton variant="card" count={2} />
      </div>
    );
  }

  if (groupsErrored) {
    return (
      <div className="space-y-6">
        <PageHeader title={labels.pageTitle} description={labels.errorDescription} />
        <ErrorState message={labels.loadError} onRetry={() => void groupsQuery.refetch()} />
      </div>
    );
  }

  // Prefer the freshly-started/defined run from the action (immediate repaint);
  // fall back to the polled query for re-opening a previously started run.
  const bootRun = bootRunDetail ?? bootRunQuery.data ?? null;

  return (
    <div className="space-y-6">
      <PageHeader title={labels.pageTitle} description={labels.pageDescription} />

      <GroupPicker groups={groups} activeGroupId={activeGroupId} onSelectGroup={setGroup} />

      {!activeGroupId ? (
        <EmptyState
          icon={Network}
          title={labels.noGroupSelected}
          description={labels.noGroupSelectedHint}
          size="compact"
        />
      ) : (
        <>
          <TopologyGraphPanel
            topology={topologyQuery.data ?? null}
            sites={sitesQuery.data ?? []}
            streams={streamsQuery.data ?? []}
            loading={topologyQuery.isLoading}
            error={topologyQuery.error}
            canWrite={canWrite}
            addEdgePending={topologyActions.addTopologyEdgePending}
            onAddEdge={(payload) => topologyActions.addTopologyEdge(activeGroupId, payload)}
            onRetry={() => void topologyQuery.refetch()}
          />

          <FailoverTargetPanel selection={failoverTargetQuery.data ?? null} />

          <BootPlanPanel
            bootPlan={bootPlanQuery.data ?? null}
            loading={bootPlanQuery.isLoading}
            error={bootPlanQuery.error}
            canWrite={canWrite}
            defineServicesPending={bootActions.defineBootServicesPending}
            onDefineServices={(payload) => bootActions.defineBootServices(activeGroupId, payload)}
            startBootRunPending={bootActions.startBootRunPending}
            onStartBootRun={(policy) => bootActions.startBootRun(activeGroupId, policy)}
            onRetry={() => void bootPlanQuery.refetch()}
          />

          <BootRunPanel bootRun={bootRun} />
        </>
      )}
    </div>
  );
}
