'use client';

import { useMemo } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { type DRBilingual, resolveDRBilingual } from '../_lib/dr-i18n';
import { PageHeader } from '@/components/common/page-header';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { useAuth } from '@/hooks/use-auth';
import type {
  DRFailoverRun,
  DRRecoveryPoint,
  DRTopology,
  DRTopologyFailoverSelection,
} from '@/types/clario-dr';
import { useDRSelection } from '../_lib/dr-selection';
import { DRSetupEmptyState } from '../_components/empty/dr-setup-empty-state';
import { DRActionGateNotice } from '../_components/empty/dr-action-gate-notice';
import {
  useDRBootPlan,
  useDRFailbackRuns,
  useDRFailoverRuns,
  useDRGroupRecoveryPoints,
  useDRGroupSummary,
  useDRJournalBookmarks,
  useDRJournalTimeline,
  useDRLedgerVerify,
  useDRPosture,
  useDRReplicationSummary,
  useDRTopology,
  useDRTopologyFailoverTarget,
} from '../_hooks/use-dr-queries';
import {
  useFailoverActions,
  useRecoveryActions,
  type DRFailbackSites,
} from '../_hooks/use-dr-actions';
import { DRExecutionActionsPanel } from '../_components/dr-execution-actions';
import {
  FailoverOperations,
  gateIndexForRun,
  selectActiveFailoverRun,
} from '../_components/recover/failover-operations';
import { ConsistencyPointCard } from '../_components/recover/consistency-point-card';

/**
 * Code-splitting (#20b): the recovery workbench and its action panel are the
 * recover route's heaviest modules. Loading them with `next/dynamic` moves their
 * bundles into separate chunks that stream in after the route shell (the gated
 * execution panel + failover-runs table paint first), with a skeleton placeholder
 * for parity. SSR stays ON (default) — these are interactive panels, not viz.
 */
const WORKBENCH_SKELETON = <LoadingSkeleton variant="card" count={2} />;

const DRRecoveryWorkbench = dynamic(
  () => import('../_components/dr-recovery-workbench').then((m) => m.DRRecoveryWorkbench),
  { loading: () => WORKBENCH_SKELETON },
);
const DRRecoveryActionsPanel = dynamic(
  () => import('../_components/dr-recovery-actions').then((m) => m.DRRecoveryActionsPanel),
  { loading: () => WORKBENCH_SKELETON },
);

/**
 * Feature-local bilingual copy for the Recover route's own chrome (the page
 * header + write-gating reasons). Adopts the foundation's `DRBilingual<T>` shape
 * and resolves against the active locale (English fallback) via
 * {@link useRecoverPageLabels}, so the route's English-asserting tests stay green
 * under the `renderWithQuery` `en` default. The rendered sub-panels own their own
 * copy; only the strings authored in this file live here.
 */
interface RecoverPageCopy {
  title: string;
  description: string;
  noWriteReason: string;
  noGroupReason: string;
}

const recoverPageLabels: DRBilingual<RecoverPageCopy> = {
  en: {
    title: 'Recover',
    description:
      'Gated failover and failback execution, isolated boot, and the recovery-point workbench for the selected protection group.',
    noWriteReason: 'Requires the dr:write permission',
    noGroupReason: 'Select a protection group first',
  },
  ar: {
    title: 'الاسترداد',
    description:
      'تنفيذ مُحكَم لتجاوز الفشل والإحالة العكسية، والإقلاع المعزول، وطاولة عمل نقاط الاسترداد لمجموعة الحماية المحدّدة.',
    noWriteReason: 'يتطلّب صلاحية الكتابة (dr:write)',
    noGroupReason: 'اختَر مجموعة حماية أولًا',
  },
};

/** Resolve the bilingual Recover-route copy against the active locale (en fallback). */
function useRecoverPageLabels(): RecoverPageCopy {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveDRBilingual(recoverPageLabels, locale), [locale]);
}

/**
 * Recover route (`/dr/recover`) — the operational heart of the console.
 *
 * Consolidates the monolith's "Failover runs" and "Recovery workbench" tabs:
 *
 *  - Execution: create / approve / cancel failover, plan / approve-cutback /
 *    advance failback, start isolated boot (`useFailoverActions` via
 *    `DRExecutionActionsPanel`), plus the failover-runs table + four-gate visual
 *    (`FailoverOperations`) with row-level deep-links into the live execution
 *    view at `/dr/runs/[id]`.
 *  - Recovery workbench: validate / seal / materialize recovery points, create /
 *    delete journal bookmarks, start / finalize instant recovery, and trigger an
 *    app-consistent point (`useRecoveryActions` via `DRRecoveryWorkbench` +
 *    `DRRecoveryActionsPanel`).
 *
 * Selection (`?group=` / `?stream=`) comes from `useDRSelection`; every write
 * action is gated on `dr:write` (the panels self-disable, and we hard-disable the
 * callbacks when the permission is absent so no mutation can fire).
 */
export default function DRRecoverPage() {
  const router = useRouter();
  const labels = useRecoverPageLabels();
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('dr:write');

  const postureQuery = useDRPosture();
  const replicationQuery = useDRReplicationSummary();
  const failoverRunsQuery = useDRFailoverRuns();
  const failbackRunsQuery = useDRFailbackRuns();
  const ledgerVerificationQuery = useDRLedgerVerify();

  const groups = useMemo(() => postureQuery.data?.groups ?? [], [postureQuery.data?.groups]);
  const replication = replicationQuery.data ?? null;

  // Provisional selection (without the group summary) so we can fetch it.
  const provisionalSelection = useDRSelection({ groups, replication });
  const activeGroupId = provisionalSelection.activeGroupId;

  const groupSummaryQuery = useDRGroupSummary(activeGroupId);
  const groupSummary = groupSummaryQuery.data ?? null;

  // Final selection: now that the group summary is available, derive the
  // workbench stream id exactly as the monolith did.
  const { activeStreamId } = useDRSelection({ groups, groupSummary, replication });

  const recoveryPointsQuery = useDRGroupRecoveryPoints(activeGroupId);
  const journalTimelineQuery = useDRJournalTimeline(activeStreamId);
  const journalBookmarksQuery = useDRJournalBookmarks(activeStreamId);
  const bootPlanQuery = useDRBootPlan(activeGroupId);
  const topologyQuery = useDRTopology(activeGroupId);
  const topologySelectionQuery = useDRTopologyFailoverTarget(activeGroupId);

  const selectedGroup = useMemo(
    () => groups.find((group) => resolveGroupId(group) === activeGroupId) ?? null,
    [groups, activeGroupId],
  );
  const selectedGroupName = groupSummary?.name ?? selectedGroup?.name ?? null;

  const failoverRuns = useMemo<DRFailoverRun[]>(
    () => failoverRunsQuery.data ?? [],
    [failoverRunsQuery.data],
  );
  const activeRun = useMemo(() => selectActiveFailoverRun(failoverRuns), [failoverRuns]);
  const activeFailoverRun = activeRun;
  const gateIndex = gateIndexForRun(activeRun);

  const latestDetailedRecoveryPoint = useMemo(
    () => selectLatestDetailedRecoveryPoint(recoveryPointsQuery.data ?? []),
    [recoveryPointsQuery.data],
  );
  const activeRecoveryPointId =
    latestDetailedRecoveryPoint?.id ?? groupSummary?.latest_recovery_point?.id ?? null;

  const failbackSites = useMemo<DRFailbackSites>(
    () => selectFailbackSites(topologyQuery.data ?? null, topologySelectionQuery.data ?? null),
    [topologyQuery.data, topologySelectionQuery.data],
  );

  const failover = useFailoverActions({
    activeGroupId,
    activeRecoveryPointId,
    groupSummary,
    selectedGroup,
    activeFailoverRun,
    failbackSites,
  });

  const recovery = useRecoveryActions({
    activeGroupId,
    activeStreamId,
    journalTimeline: journalTimelineQuery.data ?? null,
  });

  const noWrite = () => undefined;
  const openRun = (runID: string) => router.push(`/dr/runs/${runID}`);

  const workbenchLoading =
    recoveryPointsQuery.isLoading ||
    journalTimelineQuery.isLoading ||
    journalBookmarksQuery.isLoading ||
    ledgerVerificationQuery.isLoading;

  const workbenchError =
    recoveryPointsQuery.error ??
    journalTimelineQuery.error ??
    journalBookmarksQuery.error ??
    ledgerVerificationQuery.error;

  const refetchWorkbench = () => {
    void recoveryPointsQuery.refetch();
    void journalTimelineQuery.refetch();
    void journalBookmarksQuery.refetch();
    void ledgerVerificationQuery.refetch();
  };

  // Cold-start on-ramp: once posture has loaded with zero protection groups,
  // every operational control here is permanently gated (dr:write + a group),
  // so we show the create-a-group path instead of a wall of disabled buttons.
  const postureLoaded = !postureQuery.isPending;
  const hasNoGroups = postureLoaded && groups.length === 0;

  if (hasNoGroups) {
    return (
      <div className="space-y-6">
        <PageHeader title={labels.title} description={labels.description} />
        <DRSetupEmptyState />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title={labels.title} description={labels.description} />

      {/* Inline (not tooltip-only) reason when controls are visible but gated. */}
      {!canWrite ? (
        <DRActionGateNotice reason={labels.noWriteReason} />
      ) : !activeGroupId ? (
        <DRActionGateNotice reason={labels.noGroupReason} />
      ) : null}

      <DRExecutionActionsPanel
        selectedGroupId={activeGroupId}
        selectedGroupName={selectedGroupName}
        latestRecoveryPointId={activeRecoveryPointId}
        activeFailoverRun={activeFailoverRun}
        failbackRuns={failbackRunsQuery.data ?? []}
        bootPlan={bootPlanQuery.data ?? null}
        loading={failoverRunsQuery.isLoading || failbackRunsQuery.isLoading || bootPlanQuery.isLoading}
        creatingFailover={failover.createFailoverPending}
        approvingFailover={failover.approveFailoverPending}
        cancelingFailover={failover.cancelFailoverPending}
        creatingFailback={failover.createFailbackPending}
        approvingCutback={failover.approveCutbackPending}
        advancingFailback={failover.advanceFailbackPending}
        startingBoot={failover.startBootPending}
        error={
          failoverRunsQuery.error ??
          failbackRunsQuery.error ??
          bootPlanQuery.error ??
          failover.createFailoverError ??
          failover.approveFailoverError ??
          failover.cancelFailoverError ??
          failover.createFailbackError ??
          failover.approveCutbackError ??
          failover.advanceFailbackError ??
          failover.startBootError
        }
        onCreateFailover={canWrite ? failover.createFailover : noWrite}
        onApproveFailover={canWrite ? failover.approveFailover : noWrite}
        onCancelFailover={canWrite ? failover.cancelFailover : noWrite}
        onCreateFailback={canWrite ? failover.createFailback : noWrite}
        onApproveCutback={canWrite ? failover.approveCutback : noWrite}
        onAdvanceFailback={canWrite ? failover.advanceFailback : noWrite}
        onStartBoot={canWrite ? failover.startBoot : noWrite}
        onRetry={() => {
          void failoverRunsQuery.refetch();
          void failbackRunsQuery.refetch();
          void bootPlanQuery.refetch();
        }}
      />

      <FailoverOperations
        runs={failoverRuns}
        activeRun={activeRun}
        gateIndex={gateIndex}
        groups={groups}
        error={failoverRunsQuery.error}
        onRetry={() => void failoverRunsQuery.refetch()}
        onOpenRun={openRun}
        onDeclareRun={failover.createFailover}
        canDeclareRun={canWrite && Boolean(activeGroupId)}
      />

      <DRRecoveryWorkbench
        activeStreamId={activeStreamId}
        journalBookmarks={journalBookmarksQuery.data ?? journalTimelineQuery.data?.bookmarks ?? []}
        journalTimeline={journalTimelineQuery.data ?? null}
        ledgerVerification={ledgerVerificationQuery.data ?? null}
        recoveryPoints={recoveryPointsQuery.data ?? []}
        selectedGroup={groupSummary ?? selectedGroup}
        loading={workbenchLoading}
        error={workbenchError}
        onRetry={refetchWorkbench}
        onOpenFailover={() => activeRun && openRun(activeRun.id)}
      />

      <DRRecoveryActionsPanel
        selectedGroupId={activeGroupId}
        selectedGroupName={selectedGroupName}
        activeStreamId={activeStreamId}
        recoveryPoints={recoveryPointsQuery.data ?? []}
        journalTimeline={journalTimelineQuery.data ?? null}
        journalBookmarks={journalBookmarksQuery.data ?? journalTimelineQuery.data?.bookmarks ?? []}
        selectedRecoveryPoint={latestDetailedRecoveryPoint}
        latestValidation={recovery.latestValidation}
        latestSealedPoint={recovery.latestSealedPoint}
        latestMaterializedPoint={recovery.latestMaterializedPoint}
        latestInstantSession={recovery.latestInstantSession}
        latestInstantProgress={recovery.latestInstantProgress}
        loading={workbenchLoading}
        validatingPoint={recovery.validatingPoint}
        sealingPoint={recovery.sealingPoint}
        creatingBookmark={recovery.creatingBookmark}
        deletingBookmark={recovery.deletingBookmark}
        materializingPoint={recovery.materializingPoint}
        startingInstant={recovery.startingInstant}
        finalizingInstant={recovery.finalizingInstant}
        error={
          recoveryPointsQuery.error ??
          journalTimelineQuery.error ??
          journalBookmarksQuery.error ??
          recovery.validatePointError ??
          recovery.sealPointError ??
          recovery.createBookmarkError ??
          recovery.deleteBookmarkError ??
          recovery.materializePointError ??
          recovery.startInstantError ??
          recovery.finalizeInstantError
        }
        onValidatePoint={canWrite ? recovery.validatePoint : noWrite}
        onSealPoint={canWrite ? () => recovery.sealPoint() : noWrite}
        onCreateBookmark={canWrite ? recovery.createBookmark : noWrite}
        onDeleteBookmark={canWrite ? recovery.deleteBookmark : noWrite}
        onMaterializePoint={canWrite ? recovery.materializePoint : noWrite}
        onStartInstantRecovery={canWrite ? recovery.startInstantRecovery : noWrite}
        onFinalizeInstantRecovery={canWrite ? recovery.finalizeInstantRecovery : noWrite}
        onRetry={refetchWorkbench}
      />

      <ConsistencyPointCard
        selectedGroupName={selectedGroupName}
        latestBarrier={recovery.latestConsistencyBarrier}
        pending={recovery.triggeringConsistencyPoint}
        disabledReason={
          !canWrite ? labels.noWriteReason : !activeGroupId ? labels.noGroupReason : null
        }
        onTrigger={recovery.triggerConsistencyPoint}
      />
    </div>
  );
}

/** Resolve a group's canonical id (mirrors the monolith's `groupId()`). */
function resolveGroupId(group: { id?: string; group_id?: string; groupId?: string }): string | null {
  const id = (group.group_id ?? group.groupId ?? group.id ?? '').trim();
  if (!id || id === 'null' || id === 'undefined') return null;
  return id;
}

/** Latest sealed recovery point by `sealed_at` (verbatim from the monolith). */
function selectLatestDetailedRecoveryPoint(points: DRRecoveryPoint[]): DRRecoveryPoint | null {
  return [...points].sort((left, right) => timestampMs(right.sealed_at) - timestampMs(left.sealed_at))[0] ?? null;
}

/** Topology-derived source/target site pair (verbatim from the monolith). */
function selectFailbackSites(
  topology: DRTopology | null,
  selection: DRTopologyFailoverSelection | null,
): DRFailbackSites {
  const selectedTarget = selection?.selected?.site_id ?? null;
  const sourceNode =
    topology?.nodes?.find((node) => ['source', 'primary'].includes(normalizeStatus(node.role))) ??
    topology?.nodes?.[0] ??
    null;
  const targetNode =
    topology?.nodes?.find((node) => node.site_id === selectedTarget) ??
    topology?.nodes?.find((node) => ['target', 'secondary', 'recovery'].includes(normalizeStatus(node.role))) ??
    topology?.nodes?.[1] ??
    null;

  return {
    fromSite: targetNode?.site_id ?? selectedTarget,
    toSite: sourceNode?.site_id ?? null,
  };
}

function normalizeStatus(status?: string | null) {
  return (status ?? 'empty').toLowerCase().replace(/\s+/g, '_');
}

function timestampMs(value?: string | Date | null) {
  if (!value) return 0;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}
