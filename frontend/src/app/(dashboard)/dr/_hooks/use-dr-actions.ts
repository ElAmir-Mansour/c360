'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  actOnDRRunbookTask,
  addDRGroupMember,
  addDRRunbookTask,
  addDRTopologyEdge,
  advanceDRFailback,
  anchorDRAttestationLedger,
  approveDRFailbackCutback,
  approveDRFailoverRun,
  assessDRBCMPack,
  assessDRSelfDR,
  cancelDRFailoverRun,
  captureDRSelfDRBackup,
  chatDRCopilot,
  createDRAgent,
  createDRDrillSchedule,
  createDRFailoverRun,
  createDRGameDayScenario,
  createDRGroup,
  createDRJournalBookmark,
  createDRNetworkMapping,
  createDRRunbook,
  createDRSite,
  createDRStream,
  defineDRBootServices,
  deleteDRJournalBookmark,
  evaluateDRCyberVault,
  fetchDRAttestationLedgerProof,
  fetchDRCopilotSessionTranscript,
  fetchDRIaCReconstitutionPlan,
  fetchDRIaCSnapshotDiff,
  fetchDRInstantRecoveryProgress,
  finalizeDRInstantRecovery,
  generateDRSelfDROfflineBundle,
  ingestDRIaCSnapshot,
  materializeDRJournalRecoveryPoint,
  mintDRAgentEnrollmentToken,
  pauseDRStream,
  planDRFailback,
  recommendDRRecoveryTier,
  regenerateDRRegistryRunbook,
  replicateDRStorageSnapshot,
  requestDRStorageSnapshot,
  resumeDRStream,
  rotateDRBYOKKey,
  runDRGameDayScenario,
  runDRWorkloadCapture,
  sealDRRecoveryPoint,
  startDRBootRun,
  startDRInstantRecovery,
  startDRRunbookRun,
  triggerDRAppConsistentPoint,
  updateDRRunbook,
  validateDRRecoveryPoint,
  type DRAddGroupMemberRequest,
  type DRAgentEnrollmentToken,
  type DRApprovalDecisionRequest,
  type DRAttestationLedgerCheckpoint,
  type DRAttestationLedgerInclusionProof,
  type DRBCMAssessmentRunResponse,
  type DRBootPlan,
  type DRBootRunDetail,
  type DRBYOKKey,
  type DRConsistencyBarrier,
  type DRConsistencyGroup,
  type DRConsistencyGroupMember,
  type DRCopilotChatResult,
  type DRCopilotSessionTranscript,
  type DRCreateBootServicesRequest,
  type DRCreateGameDayScenarioRequest,
  type DRCreateGroupRequest,
  type DRCreateNetworkMappingRequest,
  type DRCreateRunbookRequest,
  type DRCreateSiteRequest,
  type DRCreateStreamRequest,
  type DRCyberVaultStoredPostureAssessment,
  type DRDrillSchedule,
  type DRFailoverRun,
  type DRGameDayScenario,
  type DRGameDayScorecard,
  type DRIaCDiff,
  type DRIaCReconstitutionPlan,
  type DRInstantRecoveryProgress,
  type DRInstantRecoverySession,
  type DRJournalTimeline,
  type DRNetworkMapping,
  type DRProtectedSite,
  type DRRecoveryPoint,
  type DRRecoveryTierProfile,
  type DRRecoveryTierRecommendationRequest,
  type DRReplicationStream,
  type DRReplicationSummary,
  type DRRunbookActionRequest,
  type DRRunbookAddTaskRequest,
  type DRRunbookLiveState,
  type DRRunbookPlan,
  type DRRunbookStartRunRequest,
  type DRRunbookTask,
  type DRRunbookUpdateRequest,
  type DRStorageSnapshot,
  type DRTopology,
  type DRTopologyAddEdgeRequest,
  type DRWorkloadCaptureEpoch,
  type DRSelfDRStoredArtifact,
} from '@/lib/clario-dr';

/**
 * Domain-grouped action hooks for the ClarioDR Recovery Operations Console.
 *
 * Each hook reproduces — byte-for-byte — the original monolith's `mutationFn`,
 * its `onSuccess` `queryClient.invalidateQueries` keys, the sonner toast pattern,
 * and the loading bool. Where the monolith kept the latest mutation result in
 * component state (e.g. `latestSealedRecoveryPoint`, `enrollmentToken`,
 * `ledgerProof`), that state is preserved here and surfaced on the return value,
 * so route components consume the exact same result shape.
 *
 * Mutations whose `mutationFn` reads live selection/data need that context; it is
 * passed in via each hook's `ctx` argument (`activeGroupId`, `activeStreamId`,
 * the group summary, the journal timeline, the active failover run, etc.). This
 * mirrors the closures the monolith captured.
 */

// ---------------------------------------------------------------------------
// Shared helpers (copied verbatim from the monolith).
// ---------------------------------------------------------------------------

function formatErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  return fallback;
}

function defaultRetentionUntil(): string {
  return new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
}

function normalizeStatus(status?: string | null): string {
  return (status ?? 'empty').toLowerCase().replace(/\s+/g, '_');
}

const HEALTH_LABELS: Record<string, string> = {
  healthy: 'Healthy',
  warning: 'Watch',
  critical: 'Critical',
  paused: 'Paused',
  seeding: 'Seeding',
  empty: 'Empty',
  streaming: 'Streaming',
  degraded: 'Degraded',
  error: 'Error',
  completed: 'Completed',
  passed: 'Passed',
  failed: 'Failed',
};

function labelFor(status?: string | null): string {
  const normalized = normalizeStatus(status);
  return HEALTH_LABELS[normalized] ?? normalized.replace(/_/g, ' ');
}

const REPLICATION_SUMMARY_KEY = ['clario-dr', 'replication-summary'] as const;

/**
 * Optimistically flip one stream's `status`/`health` in the cached replication
 * summary and recompute the `streams_by_status` tally — used by the pause/resume
 * mutations so the UI reflects the change before the server round-trips.
 *
 * Reads/writes ONLY real `DRReplicationSummary` / `DRStreamSummary` fields; it
 * never fabricates streams or fields. Returns a NEW summary (immutable update) so
 * react-query change detection fires, or the input unchanged when the target
 * stream is not present (nothing to do).
 */
function applyStreamStatusToSummary(
  summary: DRReplicationSummary,
  streamId: string,
  nextStatus: string,
): DRReplicationSummary {
  let changed = false;
  const streams = summary.streams.map((stream) => {
    if (stream.stream_id !== streamId) return stream;
    changed = true;
    return { ...stream, status: nextStatus, health: nextStatus };
  });
  if (!changed) return summary;

  const streamsByStatus: Record<string, number> = {};
  for (const stream of streams) {
    const key = stream.status;
    streamsByStatus[key] = (streamsByStatus[key] ?? 0) + 1;
  }

  return { ...summary, streams, streams_by_status: streamsByStatus };
}

/** Snapshot returned by the optimistic pause/resume `onMutate` for rollback. */
interface ReplicationOptimisticContext {
  previousSummary: DRReplicationSummary | undefined;
}

// ---------------------------------------------------------------------------
// Context shapes the hooks read from (subset of the monolith's derived state).
// ---------------------------------------------------------------------------

/** Group objective fields used by failover/drill creation defaults. */
interface DRGroupObjectiveCtx {
  name?: string | null;
  rto_objective_seconds?: number;
}

/** Topology-derived failback site pair (mirrors `selectFailbackSites`). */
export interface DRFailbackSites {
  fromSite: string | null;
  toSite: string | null;
}

export interface UseFailoverActionsContext {
  activeGroupId: string | null;
  activeRecoveryPointId: string | null;
  /** From `fetchDRGroupSummary` (preferred) or the posture group row. */
  groupSummary?: DRGroupObjectiveCtx | null;
  /** Posture group fallback for objective defaults. */
  selectedGroup?: DRGroupObjectiveCtx | null;
  /** Active failover run (for the default failback `failover_run_id`). */
  activeFailoverRun?: DRFailoverRun | null;
  /** Source/target site pair derived from topology + failover selection. */
  failbackSites: DRFailbackSites;
}

export interface UseRecoveryActionsContext {
  activeGroupId: string | null;
  activeStreamId: string | null;
  /** Latest journal timeline for the active stream (bookmark/materialize anchors). */
  journalTimeline?: DRJournalTimeline | null;
}

export interface UseRehearseActionsContext {
  activeGroupId: string | null;
  groupSummary?: DRGroupObjectiveCtx | null;
  selectedGroup?: DRGroupObjectiveCtx | null;
}

export interface UseReadinessActionsContext {
  activeGroupId: string | null;
  activeStreamId: string | null;
  /** Latest Self-DR assessment report, for the backup-component fallback. */
  selfDRRestoreWaves?: Array<{
    components: Array<{ id?: string; kind?: string }>;
  }>;
}

// ---------------------------------------------------------------------------
// Failover / recovery-execution actions (recover route).
// ---------------------------------------------------------------------------

export function useFailoverActions(ctx: UseFailoverActionsContext) {
  const queryClient = useQueryClient();
  const { activeGroupId, activeRecoveryPointId, groupSummary, selectedGroup, activeFailoverRun, failbackSites } = ctx;

  const createFailoverMutation = useMutation({
    mutationFn: () => {
      if (!activeGroupId) throw new Error('Select a protection group before creating a failover run.');

      return createDRFailoverRun({
        group_id: activeGroupId,
        mode: 'drill',
        recovery_point_id: activeRecoveryPointId,
        rto_objective_seconds: groupSummary?.rto_objective_seconds ?? selectedGroup?.rto_objective_seconds ?? 900,
      });
    },
    onSuccess: (run) => {
      toast.success(`Failover drill ${run.id} created`);
      void queryClient.invalidateQueries({ queryKey: ['clario-dr', 'failover-runs'] });
      void queryClient.invalidateQueries({ queryKey: ['clario-dr', 'posture'] });
      void queryClient.invalidateQueries({ queryKey: ['clario-dr', 'group-summary', activeGroupId] });
    },
    onError: (error) => {
      toast.error(formatErrorMessage(error, 'Failed to create failover drill'));
    },
  });

  const approveFailoverMutation = useMutation({
    mutationFn: ({ runID, payload }: { runID: string; payload?: DRApprovalDecisionRequest }) =>
      approveDRFailoverRun(runID, payload),
    onSuccess: (run) => {
      toast.success(`Failover run ${run.id} approved`);
      void queryClient.invalidateQueries({ queryKey: ['clario-dr', 'failover-runs'] });
      void queryClient.invalidateQueries({ queryKey: ['clario-dr', 'posture'] });
    },
    onError: (error) => {
      toast.error(formatErrorMessage(error, 'Failed to approve failover run'));
    },
  });

  const cancelFailoverMutation = useMutation({
    mutationFn: cancelDRFailoverRun,
    onSuccess: (run) => {
      toast.success(`Failover run ${run.id} cancelled`);
      void queryClient.invalidateQueries({ queryKey: ['clario-dr', 'failover-runs'] });
      void queryClient.invalidateQueries({ queryKey: ['clario-dr', 'posture'] });
    },
    onError: (error) => {
      toast.error(formatErrorMessage(error, 'Failed to cancel failover run'));
    },
  });

  const createFailbackMutation = useMutation({
    mutationFn: (failoverRunID?: string | null) => {
      if (!activeGroupId) throw new Error('Select a protection group before creating a failback plan.');
      if (!failbackSites.fromSite || !failbackSites.toSite) {
        throw new Error('Topology must include source and failover target sites before failback can be planned.');
      }

      return planDRFailback({
        group_id: activeGroupId,
        from_site: failbackSites.fromSite,
        to_site: failbackSites.toSite,
        failover_run_id: failoverRunID ?? activeFailoverRun?.id ?? null,
      });
    },
    onSuccess: (run) => {
      toast.success(`Failback plan ${run.id} created`);
      void queryClient.invalidateQueries({ queryKey: ['clario-dr', 'failback-runs'] });
    },
    onError: (error) => {
      toast.error(formatErrorMessage(error, 'Failed to create failback plan'));
    },
  });

  const approveCutbackMutation = useMutation({
    mutationFn: ({ runID, payload }: { runID: string; payload?: DRApprovalDecisionRequest }) =>
      approveDRFailbackCutback(runID, payload),
    onSuccess: (run) => {
      toast.success(`Failback cutback ${run.id} approved`);
      void queryClient.invalidateQueries({ queryKey: ['clario-dr', 'failback-runs'] });
    },
    onError: (error) => {
      toast.error(formatErrorMessage(error, 'Failed to approve failback cutback'));
    },
  });

  const advanceFailbackMutation = useMutation({
    mutationFn: advanceDRFailback,
    onSuccess: (run) => {
      toast.success(`Failback ${run.id} advanced`);
      void queryClient.invalidateQueries({ queryKey: ['clario-dr', 'failback-runs'] });
    },
    onError: (error) => {
      toast.error(formatErrorMessage(error, 'Failed to advance failback'));
    },
  });

  const startBootMutation = useMutation({
    mutationFn: () => {
      if (!activeGroupId) throw new Error('Select a protection group before starting an isolated boot.');
      return startDRBootRun(activeGroupId, 'isolated');
    },
    onSuccess: (run) => {
      toast.success(`Isolated boot run ${run.run.id} started`);
      void queryClient.invalidateQueries({ queryKey: ['clario-dr', 'boot-plan', activeGroupId] });
    },
    onError: (error) => {
      toast.error(formatErrorMessage(error, 'Failed to start isolated boot'));
    },
  });

  return {
    createFailover: () => createFailoverMutation.mutate(),
    createFailoverPending: createFailoverMutation.isPending,
    createFailoverError: createFailoverMutation.error,

    approveFailover: (runID: string, payload?: DRApprovalDecisionRequest) =>
      approveFailoverMutation.mutate({ runID, payload }),
    approveFailoverPending: approveFailoverMutation.isPending,
    approveFailoverError: approveFailoverMutation.error,

    cancelFailover: (runID: string) => cancelFailoverMutation.mutate(runID),
    cancelFailoverPending: cancelFailoverMutation.isPending,
    cancelFailoverError: cancelFailoverMutation.error,

    createFailback: (failoverRunID?: string | null) => createFailbackMutation.mutate(failoverRunID),
    createFailbackPending: createFailbackMutation.isPending,
    createFailbackError: createFailbackMutation.error,

    approveCutback: (runID: string, payload?: DRApprovalDecisionRequest) =>
      approveCutbackMutation.mutate({ runID, payload }),
    approveCutbackPending: approveCutbackMutation.isPending,
    approveCutbackError: approveCutbackMutation.error,

    advanceFailback: (runID: string) => advanceFailbackMutation.mutate(runID),
    advanceFailbackPending: advanceFailbackMutation.isPending,
    advanceFailbackError: advanceFailbackMutation.error,

    startBoot: () => startBootMutation.mutate(),
    startBootPending: startBootMutation.isPending,
    startBootError: startBootMutation.error,
  };
}

// ---------------------------------------------------------------------------
// Replication actions (protect route).
// ---------------------------------------------------------------------------

export function useReplicationActions(activeGroupId: string | null) {
  const queryClient = useQueryClient();
  const [latestPausedStreamId, setLatestPausedStreamId] = useState<string | null>(null);
  const [latestResumedStreamId, setLatestResumedStreamId] = useState<string | null>(null);

  // Pause/resume are safe, reversible state flips on an existing stream, so they
  // run OPTIMISTICALLY: onMutate snapshots the replication summary and flips the
  // target stream's status immediately; onError rolls the snapshot back. The
  // success toast + cache invalidations are preserved exactly so the server's
  // authoritative summary still reconciles the cache.
  const pauseStreamMutation = useMutation<unknown, unknown, string, ReplicationOptimisticContext>({
    mutationFn: pauseDRStream,
    onMutate: async (streamID) => {
      await queryClient.cancelQueries({ queryKey: REPLICATION_SUMMARY_KEY });
      const previousSummary = queryClient.getQueryData<DRReplicationSummary>(
        REPLICATION_SUMMARY_KEY,
      );
      if (previousSummary) {
        queryClient.setQueryData<DRReplicationSummary>(
          REPLICATION_SUMMARY_KEY,
          applyStreamStatusToSummary(previousSummary, streamID, 'paused'),
        );
      }
      return { previousSummary };
    },
    onSuccess: (_result, streamID) => {
      setLatestPausedStreamId(streamID);
      setLatestResumedStreamId(null);
      toast.success(`Replication stream ${streamID} paused`);
    },
    onError: (error, _streamID, context) => {
      if (context?.previousSummary) {
        queryClient.setQueryData(REPLICATION_SUMMARY_KEY, context.previousSummary);
      }
      toast.error(formatErrorMessage(error, 'Failed to pause replication stream'));
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['clario-dr', 'replication-summary'] });
      void queryClient.invalidateQueries({ queryKey: ['clario-dr', 'posture'] });
      void queryClient.invalidateQueries({ queryKey: ['clario-dr', 'group-summary', activeGroupId] });
    },
  });

  const resumeStreamMutation = useMutation<unknown, unknown, string, ReplicationOptimisticContext>({
    mutationFn: resumeDRStream,
    onMutate: async (streamID) => {
      await queryClient.cancelQueries({ queryKey: REPLICATION_SUMMARY_KEY });
      const previousSummary = queryClient.getQueryData<DRReplicationSummary>(
        REPLICATION_SUMMARY_KEY,
      );
      if (previousSummary) {
        queryClient.setQueryData<DRReplicationSummary>(
          REPLICATION_SUMMARY_KEY,
          applyStreamStatusToSummary(previousSummary, streamID, 'streaming'),
        );
      }
      return { previousSummary };
    },
    onSuccess: (_result, streamID) => {
      setLatestResumedStreamId(streamID);
      setLatestPausedStreamId(null);
      toast.success(`Replication stream ${streamID} resumed`);
    },
    onError: (error, _streamID, context) => {
      if (context?.previousSummary) {
        queryClient.setQueryData(REPLICATION_SUMMARY_KEY, context.previousSummary);
      }
      toast.error(formatErrorMessage(error, 'Failed to resume replication stream'));
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['clario-dr', 'replication-summary'] });
      void queryClient.invalidateQueries({ queryKey: ['clario-dr', 'posture'] });
      void queryClient.invalidateQueries({ queryKey: ['clario-dr', 'group-summary', activeGroupId] });
    },
  });

  return {
    pauseStream: (streamID: string) => pauseStreamMutation.mutate(streamID),
    pauseStreamPending: pauseStreamMutation.isPending,
    pauseStreamError: pauseStreamMutation.error,
    latestPausedStreamId,

    resumeStream: (streamID: string) => resumeStreamMutation.mutate(streamID),
    resumeStreamPending: resumeStreamMutation.isPending,
    resumeStreamError: resumeStreamMutation.error,
    latestResumedStreamId,
  };
}

// ---------------------------------------------------------------------------
// Recovery-workbench actions (recover route).
// ---------------------------------------------------------------------------

export function useRecoveryActions(ctx: UseRecoveryActionsContext) {
  const queryClient = useQueryClient();
  const { activeGroupId, activeStreamId, journalTimeline } = ctx;

  const [latestValidation, setLatestValidation] = useState<DRRecoveryPoint | null>(null);
  const [latestSealedPoint, setLatestSealedPoint] = useState<DRRecoveryPoint | null>(null);
  const [latestMaterializedPoint, setLatestMaterializedPoint] = useState<DRRecoveryPoint | null>(null);
  const [latestInstantSession, setLatestInstantSession] = useState<DRInstantRecoverySession | null>(null);
  const [latestInstantProgress, setLatestInstantProgress] = useState<DRInstantRecoveryProgress | null>(null);
  const [latestConsistencyBarrier, setLatestConsistencyBarrier] = useState<DRConsistencyBarrier | null>(null);

  const validateRecoveryPointMutation = useMutation({
    mutationFn: validateDRRecoveryPoint,
    onSuccess: (point) => {
      setLatestValidation(point);
      toast.success(`Recovery point ${point.id} validated`);
      void queryClient.invalidateQueries({ queryKey: ['clario-dr', 'group-recovery-points', activeGroupId] });
    },
    onError: (error) => {
      toast.error(formatErrorMessage(error, 'Failed to validate recovery point'));
    },
  });

  const sealRecoveryPointMutation = useMutation({
    mutationFn: () => {
      if (!activeGroupId) throw new Error('Select a protection group before sealing a recovery point.');

      return sealDRRecoveryPoint(activeGroupId, {
        retention_until: defaultRetentionUntil(),
      });
    },
    onSuccess: (point) => {
      setLatestSealedPoint(point);
      toast.success(`Recovery point ${point.id} sealed`);
      void queryClient.invalidateQueries({ queryKey: ['clario-dr', 'group-recovery-points', activeGroupId] });
      void queryClient.invalidateQueries({ queryKey: ['clario-dr', 'posture'] });
    },
    onError: (error) => {
      toast.error(formatErrorMessage(error, 'Failed to seal recovery point'));
    },
  });

  const createBookmarkMutation = useMutation({
    mutationFn: () => {
      if (!activeStreamId) throw new Error('Select a replication stream before creating a bookmark.');
      const latest = journalTimeline;
      if (!latest?.latest_seq || !latest.latest_lsn || !latest.latest_ts) {
        throw new Error('Journal timeline must include a latest APIT boundary before bookmarking.');
      }

      return createDRJournalBookmark(activeStreamId, {
        name: `operator-bookmark-${latest.latest_seq}`,
        kind: 'operator',
        at_seq: latest.latest_seq,
        at_lsn: latest.latest_lsn,
        at_ts: latest.latest_ts,
        note: 'Operator-created APIT bookmark from ClarioDR recovery workbench.',
      });
    },
    onSuccess: (bookmark) => {
      toast.success(`APIT bookmark ${bookmark.name} created`);
      void queryClient.invalidateQueries({ queryKey: ['clario-dr', 'journal-bookmarks', activeStreamId] });
      void queryClient.invalidateQueries({ queryKey: ['clario-dr', 'journal-timeline', activeStreamId] });
    },
    onError: (error) => {
      toast.error(formatErrorMessage(error, 'Failed to create APIT bookmark'));
    },
  });

  const deleteBookmarkMutation = useMutation({
    mutationFn: (bookmarkID: string) => {
      if (!activeStreamId) throw new Error('Select a replication stream before deleting a bookmark.');

      return deleteDRJournalBookmark(activeStreamId, bookmarkID);
    },
    onSuccess: () => {
      toast.success('APIT bookmark deleted');
      void queryClient.invalidateQueries({ queryKey: ['clario-dr', 'journal-bookmarks', activeStreamId] });
      void queryClient.invalidateQueries({ queryKey: ['clario-dr', 'journal-timeline', activeStreamId] });
    },
    onError: (error) => {
      toast.error(formatErrorMessage(error, 'Failed to delete APIT bookmark'));
    },
  });

  const materializeRecoveryPointMutation = useMutation({
    mutationFn: () => {
      if (!activeGroupId) throw new Error('Select a protection group before materializing a recovery point.');
      const latest = journalTimeline;
      if (!latest?.latest_seq || !latest.latest_lsn || !latest.latest_ts) {
        throw new Error('Journal timeline must include a latest APIT boundary before materialization.');
      }

      return materializeDRJournalRecoveryPoint(activeGroupId, {
        seq: latest.latest_seq,
        lsn: latest.latest_lsn,
        at: latest.latest_ts,
        retention_until: defaultRetentionUntil(),
      });
    },
    onSuccess: (point) => {
      setLatestMaterializedPoint(point);
      toast.success(`APIT recovery point ${point.id} materialized`);
      void queryClient.invalidateQueries({ queryKey: ['clario-dr', 'group-recovery-points', activeGroupId] });
      void queryClient.invalidateQueries({ queryKey: ['clario-dr', 'posture'] });
    },
    onError: (error) => {
      toast.error(formatErrorMessage(error, 'Failed to materialize APIT recovery point'));
    },
  });

  const startInstantRecoveryMutation = useMutation({
    mutationFn: (pointID: string) => startDRInstantRecovery(pointID, activeGroupId ?? undefined),
    onSuccess: async (session) => {
      setLatestInstantSession(session);
      toast.success(`Instant recovery session ${session.id} started`);
      try {
        const progress = await fetchDRInstantRecoveryProgress(session.id);
        setLatestInstantProgress(progress);
      } catch {
        setLatestInstantProgress({ session, percent_complete: session.ready_at ? 100 : 0 });
      }
    },
    onError: (error) => {
      toast.error(formatErrorMessage(error, 'Failed to start instant recovery'));
    },
  });

  const finalizeInstantRecoveryMutation = useMutation({
    mutationFn: finalizeDRInstantRecovery,
    onSuccess: (session) => {
      setLatestInstantSession(session);
      setLatestInstantProgress((progress) =>
        progress ? { ...progress, session, percent_complete: 100 } : { session, percent_complete: 100 },
      );
      toast.success(`Instant recovery session ${session.id} finalized`);
    },
    onError: (error) => {
      toast.error(formatErrorMessage(error, 'Failed to finalize instant recovery'));
    },
  });

  const triggerConsistencyPointMutation = useMutation({
    mutationFn: () => {
      if (!activeGroupId) throw new Error('Select a protection group before triggering an app-consistent point.');

      return triggerDRAppConsistentPoint(activeGroupId, {
        provider: 'script',
        script: {
          freeze_cmd: 'clario-dr freeze --scope application',
          thaw_cmd: 'clario-dr thaw --scope application',
          shell: '/bin/sh',
          timeout_sec: 60,
        },
        retention_until: defaultRetentionUntil(),
      });
    },
    onSuccess: (barrier) => {
      setLatestConsistencyBarrier(barrier);
      toast.success(`App-consistent point ${barrier.id} sealed`);
      void queryClient.invalidateQueries({ queryKey: ['clario-dr', 'consistency-barriers', activeGroupId] });
      void queryClient.invalidateQueries({ queryKey: ['clario-dr', 'group-recovery-points', activeGroupId] });
      void queryClient.invalidateQueries({ queryKey: ['clario-dr', 'posture'] });
    },
    onError: (error) => {
      toast.error(formatErrorMessage(error, 'Failed to trigger app-consistent point'));
    },
  });

  return {
    validatePoint: (pointID: string) => validateRecoveryPointMutation.mutate(pointID),
    validatingPoint: validateRecoveryPointMutation.isPending,
    validatePointError: validateRecoveryPointMutation.error,
    latestValidation,

    sealPoint: () => sealRecoveryPointMutation.mutate(),
    sealingPoint: sealRecoveryPointMutation.isPending,
    sealPointError: sealRecoveryPointMutation.error,
    latestSealedPoint,

    createBookmark: () => createBookmarkMutation.mutate(),
    creatingBookmark: createBookmarkMutation.isPending,
    createBookmarkError: createBookmarkMutation.error,

    deleteBookmark: (bookmarkID: string) => deleteBookmarkMutation.mutate(bookmarkID),
    deletingBookmark: deleteBookmarkMutation.isPending,
    deleteBookmarkError: deleteBookmarkMutation.error,

    materializePoint: () => materializeRecoveryPointMutation.mutate(),
    materializingPoint: materializeRecoveryPointMutation.isPending,
    materializePointError: materializeRecoveryPointMutation.error,
    latestMaterializedPoint,

    startInstantRecovery: (pointID: string) => startInstantRecoveryMutation.mutate(pointID),
    startingInstant: startInstantRecoveryMutation.isPending,
    startInstantError: startInstantRecoveryMutation.error,
    latestInstantSession,
    latestInstantProgress,

    finalizeInstantRecovery: (sessionID: string) => finalizeInstantRecoveryMutation.mutate(sessionID),
    finalizingInstant: finalizeInstantRecoveryMutation.isPending,
    finalizeInstantError: finalizeInstantRecoveryMutation.error,

    triggerConsistencyPoint: () => triggerConsistencyPointMutation.mutate(),
    triggeringConsistencyPoint: triggerConsistencyPointMutation.isPending,
    triggerConsistencyPointError: triggerConsistencyPointMutation.error,
    latestConsistencyBarrier,
  };
}

// ---------------------------------------------------------------------------
// Rehearse actions (rehearse route): agents + drills + game days + consistency.
// ---------------------------------------------------------------------------

export function useRehearseActions(ctx: UseRehearseActionsContext) {
  const queryClient = useQueryClient();
  const { activeGroupId, groupSummary, selectedGroup } = ctx;

  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [enrollmentToken, setEnrollmentToken] = useState<DRAgentEnrollmentToken | null>(null);
  const [latestDrillSchedule, setLatestDrillSchedule] = useState<DRDrillSchedule | null>(null);
  const [latestGameDayScorecard, setLatestGameDayScorecard] = useState<DRGameDayScorecard | null>(null);

  const createAgentMutation = useMutation({
    mutationFn: () => createDRAgent({}),
    onSuccess: (agent) => {
      setSelectedAgentId(agent.id);
      setEnrollmentToken(null);
      toast.success('DR agent record created');
      void queryClient.invalidateQueries({ queryKey: ['clario-dr', 'agents'] });
    },
    onError: () => {
      toast.error('Failed to create DR agent');
    },
  });

  const mintEnrollmentTokenMutation = useMutation({
    mutationFn: (agentID: string) => mintDRAgentEnrollmentToken(agentID, { purpose: 'enroll', ttl_seconds: 3600 }),
    onSuccess: (token) => {
      setEnrollmentToken(token);
      setSelectedAgentId(token.agent_id);
      toast.success('Agent enrollment token minted');
    },
    onError: () => {
      toast.error('Failed to mint enrollment token');
    },
  });

  const createDrillScheduleMutation = useMutation({
    mutationFn: () => {
      if (!activeGroupId) throw new Error('Select a protection group before creating a drill schedule.');

      return createDRDrillSchedule({
        group_id: activeGroupId,
        name: `${groupSummary?.name ?? selectedGroup?.name ?? activeGroupId} isolated drill`,
        cron_expr: '0 2 * * 6',
        profile: 'isolated',
        rto_objective_seconds: groupSummary?.rto_objective_seconds ?? selectedGroup?.rto_objective_seconds ?? 900,
        enabled: true,
      });
    },
    onSuccess: (schedule) => {
      setLatestDrillSchedule(schedule);
      toast.success(`Drill schedule ${schedule.name} created`);
      void queryClient.invalidateQueries({ queryKey: ['clario-dr', 'drill-schedules'] });
    },
    onError: (error) => {
      toast.error(formatErrorMessage(error, 'Failed to create drill schedule'));
    },
  });

  const runGameDayScenarioMutation = useMutation({
    mutationFn: runDRGameDayScenario,
    onSuccess: (scorecard) => {
      setLatestGameDayScorecard(scorecard);
      toast.success(`Game-day scenario ${scorecard.run.id} completed with ${scorecard.run.safety_verdict}`);
      void queryClient.invalidateQueries({ queryKey: ['clario-dr', 'gameday-scenarios'] });
    },
    onError: (error) => {
      toast.error(formatErrorMessage(error, 'Failed to run game-day scenario'));
    },
  });

  return {
    createAgent: () => createAgentMutation.mutate(),
    creatingAgent: createAgentMutation.isPending,
    createAgentError: createAgentMutation.error,

    mintToken: (agentID: string) => mintEnrollmentTokenMutation.mutate(agentID),
    mintingToken: mintEnrollmentTokenMutation.isPending,
    mintTokenError: mintEnrollmentTokenMutation.error,

    selectedAgentId,
    setSelectedAgentId,
    enrollmentToken,
    setEnrollmentToken,

    createDrillSchedule: () => createDrillScheduleMutation.mutate(),
    creatingDrillSchedule: createDrillScheduleMutation.isPending,
    createDrillScheduleError: createDrillScheduleMutation.error,
    latestDrillSchedule,

    runGameDay: (scenarioID: string) => runGameDayScenarioMutation.mutate(scenarioID),
    runningGameDayScenario: runGameDayScenarioMutation.isPending,
    runGameDayError: runGameDayScenarioMutation.error,
    latestGameDayScorecard,
  };
}

// ---------------------------------------------------------------------------
// Evidence / attestation actions (prove route).
// ---------------------------------------------------------------------------

export function useEvidenceActions(activeGroupId: string | null) {
  const queryClient = useQueryClient();

  const [selectedSeq, setSelectedSeq] = useState<number | null>(null);
  const [proof, setProof] = useState<DRAttestationLedgerInclusionProof | null>(null);
  const [checkpoint, setCheckpoint] = useState<DRAttestationLedgerCheckpoint | null>(null);
  const [latestBcmAssessment, setLatestBcmAssessment] = useState<DRBCMAssessmentRunResponse | null>(null);

  const ledgerProofMutation = useMutation({
    mutationFn: fetchDRAttestationLedgerProof,
    onSuccess: (nextProof) => {
      setProof(nextProof);
      setSelectedSeq(nextProof.seq);
      toast.success(`Ledger proof loaded for seq ${nextProof.seq}`);
    },
    onError: () => {
      toast.error('Failed to load ledger inclusion proof');
    },
  });

  const ledgerAnchorMutation = useMutation({
    mutationFn: anchorDRAttestationLedger,
    onSuccess: (nextCheckpoint) => {
      setCheckpoint(nextCheckpoint);
      toast.success('Attestation ledger anchored');
      void queryClient.invalidateQueries({ queryKey: ['clario-dr', 'attestation-ledger'] });
      void queryClient.invalidateQueries({ queryKey: ['clario-dr', 'attestation-ledger-verify'] });
    },
    onError: () => {
      toast.error('Failed to anchor attestation ledger');
    },
  });

  const assessBcmMutation = useMutation({
    mutationFn: (packKey: string) => {
      if (!activeGroupId) throw new Error('Select a protection group before assessing BCM compliance.');

      return assessDRBCMPack(packKey, activeGroupId);
    },
    onSuccess: (result) => {
      setLatestBcmAssessment(result);
      toast.success(`BCM ${result.assessment.pack_key} scored ${Math.round(result.score)}%`);
    },
    onError: (error) => {
      toast.error(formatErrorMessage(error, 'Failed to assess BCM pack'));
    },
  });

  return {
    ledgerProof: (seq: number) => ledgerProofMutation.mutate(seq),
    proofLoading: ledgerProofMutation.isPending,
    ledgerProofError: ledgerProofMutation.error,
    proof,
    setProof,
    selectedSeq,
    setSelectedSeq,

    anchorLedger: () => ledgerAnchorMutation.mutate(),
    anchorLoading: ledgerAnchorMutation.isPending,
    anchorLedgerError: ledgerAnchorMutation.error,
    checkpoint,

    assessBcm: (packKey: string) => assessBcmMutation.mutate(packKey),
    assessingBcm: assessBcmMutation.isPending,
    assessBcmError: assessBcmMutation.error,
    latestBcmAssessment,
  };
}

// ---------------------------------------------------------------------------
// Readiness actions (readiness route): sovereign + coverage + intelligence.
// ---------------------------------------------------------------------------

export function useReadinessActions(ctx: UseReadinessActionsContext) {
  const queryClient = useQueryClient();
  const { activeGroupId, activeStreamId, selfDRRestoreWaves } = ctx;

  const [latestByokKey, setLatestByokKey] = useState<DRBYOKKey | null>(null);
  const [latestVaultAssessment, setLatestVaultAssessment] = useState<DRCyberVaultStoredPostureAssessment | null>(null);
  const [latestIacDiff, setLatestIacDiff] = useState<DRIaCDiff | null>(null);
  const [latestIacPlan, setLatestIacPlan] = useState<DRIaCReconstitutionPlan | null>(null);
  const [latestStorageSnapshot, setLatestStorageSnapshot] = useState<DRStorageSnapshot | null>(null);
  const [latestWorkloadEpoch, setLatestWorkloadEpoch] = useState<DRWorkloadCaptureEpoch | null>(null);
  const [latestSelfDRArtifact, setLatestSelfDRArtifact] = useState<DRSelfDRStoredArtifact | null>(null);
  const copilot = useCopilotActions();

  const rotateByokMutation = useMutation({
    mutationFn: rotateDRBYOKKey,
    onSuccess: (key) => {
      setLatestByokKey(key);
      toast.success(`BYOK key v${key.key_version} activated`);
      void queryClient.invalidateQueries({ queryKey: ['clario-dr', 'byok-keys'] });
      void queryClient.invalidateQueries({ queryKey: ['clario-dr', 'byok-custody-log'] });
    },
    onError: (error) => {
      toast.error(formatErrorMessage(error, 'Failed to rotate BYOK key'));
    },
  });

  const evaluateVaultMutation = useMutation({
    mutationFn: (vaultID: string) => {
      if (!activeGroupId) throw new Error('Select a protection group before evaluating cyber vault posture.');

      return evaluateDRCyberVault(vaultID, activeGroupId);
    },
    onSuccess: (assessment) => {
      setLatestVaultAssessment(assessment);
      toast.success(`Cyber vault posture scored ${Math.round(assessment.Score)}%`);
      void queryClient.invalidateQueries({ queryKey: ['clario-dr', 'cyber-vaults', activeGroupId] });
      void queryClient.invalidateQueries({ queryKey: ['clario-dr', 'cyber-vault-assessments', activeGroupId] });
    },
    onError: (error) => {
      toast.error(formatErrorMessage(error, 'Failed to evaluate cyber vault'));
    },
  });

  const ingestIacMutation = useMutation({
    mutationFn: () =>
      ingestDRIaCSnapshot({
        name: activeGroupId ? `${activeGroupId}-operator-snapshot` : 'operator-iac-snapshot',
        source_kind: 'terraform_state',
        group_id: activeGroupId ?? undefined,
        artifact: JSON.stringify({
          captured_by: 'dr-operator',
          captured_at: new Date().toISOString(),
          group_id: activeGroupId,
        }),
      }),
    onSuccess: (snapshot) => {
      toast.success(`IaC snapshot ${snapshot.name} ingested`);
      void queryClient.invalidateQueries({ queryKey: ['clario-dr', 'iac-snapshots'] });
    },
    onError: (error) => {
      toast.error(formatErrorMessage(error, 'Failed to ingest IaC snapshot'));
    },
  });

  const loadIacDiffMutation = useMutation({
    mutationFn: ({ snapshotID, againstSnapshotID }: { snapshotID: string; againstSnapshotID: string }) =>
      fetchDRIaCSnapshotDiff(snapshotID, againstSnapshotID),
    onSuccess: (diff) => {
      setLatestIacDiff(diff);
      toast.success('IaC drift diff loaded');
    },
    onError: (error) => {
      toast.error(formatErrorMessage(error, 'Failed to load IaC diff'));
    },
  });

  const loadIacPlanMutation = useMutation({
    mutationFn: fetchDRIaCReconstitutionPlan,
    onSuccess: (plan) => {
      setLatestIacPlan(plan);
      toast.success(`IaC reconstitution plan has ${plan.steps.length} steps`);
    },
    onError: (error) => {
      toast.error(formatErrorMessage(error, 'Failed to load IaC plan'));
    },
  });

  const requestStorageSnapshotMutation = useMutation({
    mutationFn: requestDRStorageSnapshot,
    onSuccess: (snapshot) => {
      setLatestStorageSnapshot(snapshot);
      toast.success(`Storage snapshot ${snapshot.id} requested`);
      void queryClient.invalidateQueries({ queryKey: ['clario-dr', 'storage-volumes'] });
    },
    onError: (error) => {
      toast.error(formatErrorMessage(error, 'Failed to request storage snapshot'));
    },
  });

  const replicateStorageSnapshotMutation = useMutation({
    mutationFn: (snapshotID: string) => replicateDRStorageSnapshot(snapshotID, { target: 'recovery-vault' }),
    onSuccess: (snapshot) => {
      setLatestStorageSnapshot(snapshot);
      toast.success(`Storage snapshot ${snapshot.id} replication requested`);
      void queryClient.invalidateQueries({ queryKey: ['clario-dr', 'storage-volumes'] });
    },
    onError: (error) => {
      toast.error(formatErrorMessage(error, 'Failed to replicate storage snapshot'));
    },
  });

  const runWorkloadCaptureMutation = useMutation({
    mutationFn: runDRWorkloadCapture,
    onSuccess: (epoch) => {
      setLatestWorkloadEpoch(epoch);
      toast.success(`Workload capture epoch ${epoch.epoch} completed`);
      void queryClient.invalidateQueries({ queryKey: ['clario-dr', 'workload-captures'] });
      void queryClient.invalidateQueries({ queryKey: ['clario-dr', 'workload-capture-epochs', epoch.source_id] });
    },
    onError: (error) => {
      toast.error(formatErrorMessage(error, 'Failed to run workload capture'));
    },
  });

  const assessSelfDRMutation = useMutation({
    mutationFn: () => assessDRSelfDR(),
    onSuccess: (result) => {
      toast.success(`Self-DR assessment ${labelFor(result.verdict)} with ${result.findings.length} findings`);
      void queryClient.invalidateQueries({ queryKey: ['clario-dr', 'selfdr-latest-assessment'] });
    },
    onError: (error) => {
      toast.error(formatErrorMessage(error, 'Failed to assess Self-DR'));
    },
  });

  const captureSelfDRBackupMutation = useMutation({
    mutationFn: () => {
      const component =
        selfDRRestoreWaves?.[0]?.components[0] ??
        selfDRRestoreWaves?.flatMap((wave) => wave.components)[0];

      return captureDRSelfDRBackup({
        component_id: component?.id ?? 'dr-control-plane',
        component_kind: component?.kind ?? 'dr_service',
        location_id: 'operator-primary',
        stream_id: activeStreamId ?? undefined,
        max_rpo_seconds: 300,
        retain_days: 365,
        metadata: {
          requested_from: 'clario-dr-dashboard',
          group_id: activeGroupId ?? '',
        },
      });
    },
    onSuccess: (artifact) => {
      setLatestSelfDRArtifact(artifact);
      toast.success(`Self-DR backup artifact ${artifact.id} captured`);
      void queryClient.invalidateQueries({ queryKey: ['clario-dr', 'selfdr-artifacts'] });
    },
    onError: (error) => {
      toast.error(formatErrorMessage(error, 'Failed to capture Self-DR backup'));
    },
  });

  const generateOfflineBundleMutation = useMutation({
    mutationFn: () =>
      generateDRSelfDROfflineBundle({
        format: 'tar.gz',
        location_id: 'operator-offline',
        stream_id: activeStreamId ?? undefined,
        retain_days: 365,
        manifest_note: 'Operator-generated offline restore bundle from ClarioDR dashboard',
      }),
    onSuccess: (artifact) => {
      setLatestSelfDRArtifact(artifact);
      toast.success(`Offline restore bundle ${artifact.id} generated`);
      void queryClient.invalidateQueries({ queryKey: ['clario-dr', 'selfdr-artifacts'] });
    },
    onError: (error) => {
      toast.error(formatErrorMessage(error, 'Failed to generate offline restore bundle'));
    },
  });

  const regenerateRunbookMutation = useMutation({
    mutationFn: () => {
      if (!activeGroupId) throw new Error('Select a protection group before regenerating the runbook.');
      return regenerateDRRegistryRunbook(activeGroupId, 'isolated');
    },
    onSuccess: (result) => {
      toast.success(result.changed ? `Runbook v${result.version.version} generated` : 'Runbook already current');
      void queryClient.invalidateQueries({ queryKey: ['clario-dr', 'registry-runbook', activeGroupId] });
      void queryClient.invalidateQueries({ queryKey: ['clario-dr', 'registry-runbook-versions', activeGroupId] });
    },
    onError: (error) => {
      toast.error(formatErrorMessage(error, 'Failed to regenerate runbook'));
    },
  });

  return {
    rotateByok: () => rotateByokMutation.mutate(),
    rotatingByok: rotateByokMutation.isPending,
    rotateByokError: rotateByokMutation.error,
    latestByokKey,

    evaluateVault: (vaultID: string) => evaluateVaultMutation.mutate(vaultID),
    evaluatingVault: evaluateVaultMutation.isPending,
    evaluateVaultError: evaluateVaultMutation.error,
    latestVaultAssessment,

    ingestIac: () => ingestIacMutation.mutate(),
    ingestingIac: ingestIacMutation.isPending,
    ingestIacError: ingestIacMutation.error,

    loadIacDiff: (snapshotID: string, againstSnapshotID: string) =>
      loadIacDiffMutation.mutate({ snapshotID, againstSnapshotID }),
    loadingIacDiff: loadIacDiffMutation.isPending,
    loadIacDiffError: loadIacDiffMutation.error,
    latestIacDiff,

    loadIacPlan: (snapshotID: string) => loadIacPlanMutation.mutate(snapshotID),
    loadingIacPlan: loadIacPlanMutation.isPending,
    loadIacPlanError: loadIacPlanMutation.error,
    latestIacPlan,

    requestStorageSnapshot: (volumeID: string) => requestStorageSnapshotMutation.mutate(volumeID),
    requestingSnapshot: requestStorageSnapshotMutation.isPending,
    requestStorageSnapshotError: requestStorageSnapshotMutation.error,

    replicateStorageSnapshot: (snapshotID: string) => replicateStorageSnapshotMutation.mutate(snapshotID),
    replicatingSnapshot: replicateStorageSnapshotMutation.isPending,
    replicateStorageSnapshotError: replicateStorageSnapshotMutation.error,
    latestStorageSnapshot,

    runWorkloadCapture: (sourceID: string) => runWorkloadCaptureMutation.mutate(sourceID),
    runningCapture: runWorkloadCaptureMutation.isPending,
    runWorkloadCaptureError: runWorkloadCaptureMutation.error,
    latestWorkloadEpoch,

    assessSelfDR: () => assessSelfDRMutation.mutate(),
    assessingSelfDR: assessSelfDRMutation.isPending,
    assessSelfDRError: assessSelfDRMutation.error,

    captureBackup: () => captureSelfDRBackupMutation.mutate(),
    capturingBackup: captureSelfDRBackupMutation.isPending,
    captureBackupError: captureSelfDRBackupMutation.error,

    generateBundle: () => generateOfflineBundleMutation.mutate(),
    generatingBundle: generateOfflineBundleMutation.isPending,
    generateBundleError: generateOfflineBundleMutation.error,
    latestSelfDRArtifact,

    regenerateRunbook: () => regenerateRunbookMutation.mutate(),
    regeneratingRunbook: regenerateRunbookMutation.isPending,
    regenerateRunbookError: regenerateRunbookMutation.error,

    askCopilot: copilot.askCopilot,
    askingCopilot: copilot.askingCopilot,
    askCopilotError: copilot.askCopilotError,
    copilotResult: copilot.copilotResult,

    loadTranscript: copilot.loadTranscript,
    transcriptLoading: copilot.transcriptLoading,
    loadTranscriptError: copilot.loadTranscriptError,
    copilotTranscript: copilot.copilotTranscript,
  };
}

// ---------------------------------------------------------------------------
// DR copilot actions (intelligence plane): chat + transcript.
//
// Owns the copilot session state (latest chat result + loaded transcript) and
// threads the active `session_id` from either into each follow-up message so a
// conversation stays continuous. Surfaced standalone so any route — not just
// readiness — can mount the copilot; `useReadinessActions` delegates here to
// keep a single source of truth and an unchanged return shape.
// ---------------------------------------------------------------------------

export function useCopilotActions() {
  const [copilotResult, setCopilotResult] = useState<DRCopilotChatResult | null>(null);
  const [copilotTranscript, setCopilotTranscript] = useState<DRCopilotSessionTranscript | null>(null);

  const askCopilotMutation = useMutation({
    mutationFn: (prompt: string) =>
      chatDRCopilot({
        session_id: copilotResult?.session_id ?? copilotTranscript?.session.id ?? null,
        message: prompt,
      }),
    onSuccess: (result) => {
      setCopilotResult(result);
      toast.success('DR copilot response ready');
    },
    onError: (error) => {
      toast.error(formatErrorMessage(error, 'Failed to query DR copilot'));
    },
  });

  const copilotTranscriptMutation = useMutation({
    mutationFn: fetchDRCopilotSessionTranscript,
    onSuccess: (transcript) => {
      setCopilotTranscript(transcript);
      toast.success('DR copilot transcript loaded');
    },
    onError: (error) => {
      toast.error(formatErrorMessage(error, 'Failed to load copilot transcript'));
    },
  });

  return {
    askCopilot: (prompt: string) => askCopilotMutation.mutate(prompt),
    askingCopilot: askCopilotMutation.isPending,
    askCopilotError: askCopilotMutation.error,
    copilotResult,

    loadTranscript: (sessionID: string) => copilotTranscriptMutation.mutate(sessionID),
    transcriptLoading: copilotTranscriptMutation.isPending,
    loadTranscriptError: copilotTranscriptMutation.error,
    copilotTranscript,
  };
}

// ---------------------------------------------------------------------------
// Recovery-tier recommendation action (protect / readiness objective fit).
//
// Posts measured RTO/RPO objectives (plus criticality flags) to the recovery
// tier recommender and keeps the resulting `DRRecoveryTierProfile` so the UI
// can render the recommended strategy alongside a site's `objective_fit`.
// Read-only on the server (no list cache to invalidate); result is surfaced on
// the return value, mirroring the monolith's "latest result in state" pattern.
// ---------------------------------------------------------------------------

export function useRecoveryTierActions() {
  const [latestRecommendation, setLatestRecommendation] = useState<DRRecoveryTierProfile | null>(null);

  const recommendTierMutation = useMutation({
    mutationFn: (payload: DRRecoveryTierRecommendationRequest) => recommendDRRecoveryTier(payload),
    onSuccess: (profile) => {
      setLatestRecommendation(profile);
      toast.success(`Recommended recovery tier: ${profile.tier}`);
    },
    onError: (error) => {
      toast.error(formatErrorMessage(error, 'Failed to recommend recovery tier'));
    },
  });

  return {
    recommendTier: (payload: DRRecoveryTierRecommendationRequest) => recommendTierMutation.mutate(payload),
    recommendingTier: recommendTierMutation.isPending,
    recommendTierError: recommendTierMutation.error,
    latestRecommendation,
  };
}

// ---------------------------------------------------------------------------
// Provisioning actions (protect / inventory build-out).
//
// The create-side counterpart to the read-only `useDRSites/useDRGroups/...`
// query hooks: build the protected-site, protection-group, group-member,
// replication-stream, and group network-mapping inventory the rest of the DR
// console operates on. Every mutation fires the same sonner toast + correct
// `['clario-dr', ...]` list invalidations the matching query hooks register, so
// freshly created records appear without a manual refetch. Group-scoped creates
// (`addMember`, `createNetworkMapping`) take the `groupId` as a curried argument
// and refuse to fire without it, mirroring the guard pattern used by the other
// group-scoped action hooks. Creating a site/group/stream also touches posture
// (the inventory feeds the overview rollup), so `posture` is invalidated too.
//
// RBAC: these are write actions. Components MUST gate the trigger on
// `useAuth().hasPermission('dr:write')` (the shared `dr-write-gate`); these hooks
// intentionally do not embed the permission check so the gate stays a single,
// auditable surface.
// ---------------------------------------------------------------------------

export interface UseProvisioningActions {
  createSite: (payload: DRCreateSiteRequest) => void;
  createSitePending: boolean;
  createSiteError: unknown;
  latestSite: DRProtectedSite | null;

  createGroup: (payload: DRCreateGroupRequest) => void;
  createGroupPending: boolean;
  createGroupError: unknown;
  latestGroup: DRConsistencyGroup | null;

  addMember: (groupID: string, payload: DRAddGroupMemberRequest) => void;
  addMemberPending: boolean;
  addMemberError: unknown;
  latestMember: DRConsistencyGroupMember | null;

  createStream: (payload: DRCreateStreamRequest) => void;
  createStreamPending: boolean;
  createStreamError: unknown;
  latestStream: DRReplicationStream | null;

  createNetworkMapping: (groupID: string, payload: DRCreateNetworkMappingRequest) => void;
  createNetworkMappingPending: boolean;
  createNetworkMappingError: unknown;
  latestNetworkMapping: DRNetworkMapping | null;
}

export function useProvisioningActions(): UseProvisioningActions {
  const queryClient = useQueryClient();

  const [latestSite, setLatestSite] = useState<DRProtectedSite | null>(null);
  const [latestGroup, setLatestGroup] = useState<DRConsistencyGroup | null>(null);
  const [latestMember, setLatestMember] = useState<DRConsistencyGroupMember | null>(null);
  const [latestStream, setLatestStream] = useState<DRReplicationStream | null>(null);
  const [latestNetworkMapping, setLatestNetworkMapping] = useState<DRNetworkMapping | null>(null);

  const createSiteMutation = useMutation({
    mutationFn: (payload: DRCreateSiteRequest) => createDRSite(payload),
    onSuccess: (site) => {
      setLatestSite(site);
      toast.success(`Protected site ${site.name} created`);
      void queryClient.invalidateQueries({ queryKey: ['clario-dr', 'sites'] });
      void queryClient.invalidateQueries({ queryKey: ['clario-dr', 'posture'] });
    },
    onError: (error) => {
      toast.error(formatErrorMessage(error, 'Failed to create protected site'));
    },
  });

  const createGroupMutation = useMutation({
    mutationFn: (payload: DRCreateGroupRequest) => createDRGroup(payload),
    onSuccess: (group) => {
      setLatestGroup(group);
      toast.success(`Protection group ${group.name} created`);
      void queryClient.invalidateQueries({ queryKey: ['clario-dr', 'groups'] });
      void queryClient.invalidateQueries({ queryKey: ['clario-dr', 'posture'] });
    },
    onError: (error) => {
      toast.error(formatErrorMessage(error, 'Failed to create protection group'));
    },
  });

  const addMemberMutation = useMutation({
    mutationFn: ({ groupID, payload }: { groupID: string; payload: DRAddGroupMemberRequest }) => {
      if (!groupID) throw new Error('Select a protection group before adding a member.');
      return addDRGroupMember(groupID, payload);
    },
    onSuccess: (member) => {
      setLatestMember(member);
      toast.success('Protection group member added');
      void queryClient.invalidateQueries({ queryKey: ['clario-dr', 'group-members', member.group_id] });
      void queryClient.invalidateQueries({ queryKey: ['clario-dr', 'group-summary', member.group_id] });
      void queryClient.invalidateQueries({ queryKey: ['clario-dr', 'posture'] });
    },
    onError: (error) => {
      toast.error(formatErrorMessage(error, 'Failed to add protection group member'));
    },
  });

  const createStreamMutation = useMutation({
    mutationFn: (payload: DRCreateStreamRequest) => createDRStream(payload),
    onSuccess: (stream) => {
      setLatestStream(stream);
      toast.success(`Replication stream ${stream.id} created`);
      void queryClient.invalidateQueries({ queryKey: ['clario-dr', 'streams'] });
      void queryClient.invalidateQueries({ queryKey: ['clario-dr', 'replication-summary'] });
      void queryClient.invalidateQueries({ queryKey: ['clario-dr', 'posture'] });
    },
    onError: (error) => {
      toast.error(formatErrorMessage(error, 'Failed to create replication stream'));
    },
  });

  const createNetworkMappingMutation = useMutation({
    mutationFn: ({ groupID, payload }: { groupID: string; payload: DRCreateNetworkMappingRequest }) => {
      if (!groupID) throw new Error('Select a protection group before creating a network mapping.');
      return createDRNetworkMapping(groupID, payload);
    },
    onSuccess: (mapping) => {
      setLatestNetworkMapping(mapping);
      toast.success(`Network mapping ${mapping.profile} created`);
      void queryClient.invalidateQueries({
        queryKey: ['clario-dr', 'group-network-mappings', mapping.group_id],
      });
    },
    onError: (error) => {
      toast.error(formatErrorMessage(error, 'Failed to create network mapping'));
    },
  });

  return {
    createSite: (payload: DRCreateSiteRequest) => createSiteMutation.mutate(payload),
    createSitePending: createSiteMutation.isPending,
    createSiteError: createSiteMutation.error,
    latestSite,

    createGroup: (payload: DRCreateGroupRequest) => createGroupMutation.mutate(payload),
    createGroupPending: createGroupMutation.isPending,
    createGroupError: createGroupMutation.error,
    latestGroup,

    addMember: (groupID: string, payload: DRAddGroupMemberRequest) =>
      addMemberMutation.mutate({ groupID, payload }),
    addMemberPending: addMemberMutation.isPending,
    addMemberError: addMemberMutation.error,
    latestMember,

    createStream: (payload: DRCreateStreamRequest) => createStreamMutation.mutate(payload),
    createStreamPending: createStreamMutation.isPending,
    createStreamError: createStreamMutation.error,
    latestStream,

    createNetworkMapping: (groupID: string, payload: DRCreateNetworkMappingRequest) =>
      createNetworkMappingMutation.mutate({ groupID, payload }),
    createNetworkMappingPending: createNetworkMappingMutation.isPending,
    createNetworkMappingError: createNetworkMappingMutation.error,
    latestNetworkMapping,
  };
}

// ---------------------------------------------------------------------------
// Runbook Studio actions (Wave E — /dr runbook authoring + live run).
//
// The write-side counterpart to the `useDRRunbook` / `useDRRunbookRun` query
// hooks: author runbooks (create), edit metadata (update), append tasks, start a
// run, and act on a live task (complete/skip/fail). Each mutation fires the same
// sonner toast pattern + the exact `['clario-dr', ...]` invalidations the query
// hooks register, so an edited plan / advanced run re-renders without a manual
// refetch:
//   - `updateRunbook`/`addTask` invalidate `['clario-dr', 'runbook', runbookId]`
//     (the plan the studio editor reads via `useDRRunbook`).
//   - `startRun`/`actOnTask` invalidate `['clario-dr', 'runbook-run', runId]`
//     (the live state the war-room reads via `useDRRunbookRun`).
// `createRunbook` returns the new runbook + tasks; the new runbook id is surfaced
// on `latestRunbookId` so a freshly authored runbook can be selected without a
// (non-existent) list endpoint. `startRun` likewise surfaces the started
// `latestRunId`. The DAG-shaped result of `startRun`/`actOnTask` (the full
// `DRRunbookLiveState`) is surfaced on `latestRunState` so the war-room can paint
// the new frontier/projection immediately, before the invalidated query re-fetches.
//
// RBAC: these are write/author actions; components MUST gate the trigger on
// `useAuth().hasPermission('dr:write')` (the shared `dr-write-gate`). The hook
// itself stays permission-free so the gate remains a single auditable surface.
// ---------------------------------------------------------------------------

export interface UseRunbookStudioActions {
  createRunbook: (payload: DRCreateRunbookRequest) => void;
  createRunbookPending: boolean;
  createRunbookError: unknown;
  latestRunbook: { runbook: DRRunbookPlan['runbook']; tasks: DRRunbookTask[] } | null;
  latestRunbookId: string | null;

  updateRunbook: (runbookID: string, payload: DRRunbookUpdateRequest) => void;
  updateRunbookPending: boolean;
  updateRunbookError: unknown;

  addTask: (runbookID: string, payload: DRRunbookAddTaskRequest) => void;
  addTaskPending: boolean;
  addTaskError: unknown;
  latestTask: DRRunbookTask | null;

  startRun: (runbookID: string, payload?: DRRunbookStartRunRequest) => void;
  startRunPending: boolean;
  startRunError: unknown;
  latestRunId: string | null;

  actOnTask: (
    runID: string,
    taskID: string,
    action: 'complete' | 'skip' | 'fail',
    payload?: DRRunbookActionRequest,
  ) => void;
  actOnTaskPending: boolean;
  actOnTaskError: unknown;

  latestRunState: DRRunbookLiveState | null;
}

export function useRunbookStudioActions(): UseRunbookStudioActions {
  const queryClient = useQueryClient();

  const [latestRunbook, setLatestRunbook] = useState<
    { runbook: DRRunbookPlan['runbook']; tasks: DRRunbookTask[] } | null
  >(null);
  const [latestRunbookId, setLatestRunbookId] = useState<string | null>(null);
  const [latestTask, setLatestTask] = useState<DRRunbookTask | null>(null);
  const [latestRunId, setLatestRunId] = useState<string | null>(null);
  const [latestRunState, setLatestRunState] = useState<DRRunbookLiveState | null>(null);

  const createRunbookMutation = useMutation({
    mutationFn: (payload: DRCreateRunbookRequest) => createDRRunbook(payload),
    onSuccess: (result) => {
      setLatestRunbook(result);
      setLatestRunbookId(result.runbook.id);
      toast.success(`Runbook ${result.runbook.name} created`);
      void queryClient.invalidateQueries({
        queryKey: ['clario-dr', 'runbook', result.runbook.id],
      });
    },
    onError: (error) => {
      toast.error(formatErrorMessage(error, 'Failed to create runbook'));
    },
  });

  const updateRunbookMutation = useMutation({
    mutationFn: ({ runbookID, payload }: { runbookID: string; payload: DRRunbookUpdateRequest }) => {
      if (!runbookID) throw new Error('Select a runbook before updating it.');
      return updateDRRunbook(runbookID, payload);
    },
    onSuccess: (runbook) => {
      toast.success(`Runbook ${runbook.name} updated`);
      void queryClient.invalidateQueries({ queryKey: ['clario-dr', 'runbook', runbook.id] });
    },
    onError: (error) => {
      toast.error(formatErrorMessage(error, 'Failed to update runbook'));
    },
  });

  const addTaskMutation = useMutation({
    mutationFn: ({ runbookID, payload }: { runbookID: string; payload: DRRunbookAddTaskRequest }) => {
      if (!runbookID) throw new Error('Select a runbook before adding a task.');
      return addDRRunbookTask(runbookID, payload);
    },
    onSuccess: (task) => {
      setLatestTask(task);
      toast.success(`Runbook task ${task.name} added`);
      void queryClient.invalidateQueries({
        queryKey: ['clario-dr', 'runbook', task.runbook_id],
      });
    },
    onError: (error) => {
      toast.error(formatErrorMessage(error, 'Failed to add runbook task'));
    },
  });

  const startRunMutation = useMutation({
    mutationFn: ({ runbookID, payload }: { runbookID: string; payload?: DRRunbookStartRunRequest }) => {
      if (!runbookID) throw new Error('Select a runbook before starting a run.');
      return startDRRunbookRun(runbookID, payload);
    },
    onSuccess: (state) => {
      setLatestRunState(state);
      setLatestRunId(state.run.id);
      toast.success(`Runbook run ${state.run.id} started`);
      void queryClient.invalidateQueries({
        queryKey: ['clario-dr', 'runbook-run', state.run.id],
      });
      void queryClient.invalidateQueries({
        queryKey: ['clario-dr', 'runbook', state.run.runbook_id],
      });
    },
    onError: (error) => {
      toast.error(formatErrorMessage(error, 'Failed to start runbook run'));
    },
  });

  const actOnTaskMutation = useMutation({
    mutationFn: ({
      runID,
      taskID,
      action,
      payload,
    }: {
      runID: string;
      taskID: string;
      action: 'complete' | 'skip' | 'fail';
      payload?: DRRunbookActionRequest;
    }) => {
      if (!runID) throw new Error('Select a runbook run before acting on a task.');
      return actOnDRRunbookTask(runID, taskID, action, payload);
    },
    onSuccess: (state, variables) => {
      setLatestRunState(state);
      const actionLabel =
        variables.action === 'complete'
          ? 'completed'
          : variables.action === 'skip'
            ? 'skipped'
            : 'failed';
      toast.success(`Runbook task ${actionLabel}`);
      void queryClient.invalidateQueries({
        queryKey: ['clario-dr', 'runbook-run', state.run.id],
      });
    },
    onError: (error) => {
      toast.error(formatErrorMessage(error, 'Failed to act on runbook task'));
    },
  });

  return {
    createRunbook: (payload: DRCreateRunbookRequest) => createRunbookMutation.mutate(payload),
    createRunbookPending: createRunbookMutation.isPending,
    createRunbookError: createRunbookMutation.error,
    latestRunbook,
    latestRunbookId,

    updateRunbook: (runbookID: string, payload: DRRunbookUpdateRequest) =>
      updateRunbookMutation.mutate({ runbookID, payload }),
    updateRunbookPending: updateRunbookMutation.isPending,
    updateRunbookError: updateRunbookMutation.error,

    addTask: (runbookID: string, payload: DRRunbookAddTaskRequest) =>
      addTaskMutation.mutate({ runbookID, payload }),
    addTaskPending: addTaskMutation.isPending,
    addTaskError: addTaskMutation.error,
    latestTask,

    startRun: (runbookID: string, payload?: DRRunbookStartRunRequest) =>
      startRunMutation.mutate({ runbookID, payload }),
    startRunPending: startRunMutation.isPending,
    startRunError: startRunMutation.error,
    latestRunId,

    actOnTask: (
      runID: string,
      taskID: string,
      action: 'complete' | 'skip' | 'fail',
      payload?: DRRunbookActionRequest,
    ) => actOnTaskMutation.mutate({ runID, taskID, action, payload }),
    actOnTaskPending: actOnTaskMutation.isPending,
    actOnTaskError: actOnTaskMutation.error,

    latestRunState,
  };
}

// ---------------------------------------------------------------------------
// Topology actions (Wave E — /dr recovery topology authoring).
//
// The write-side counterpart to the `useDRTopology` / `useDRTopologyFailoverTarget`
// query hooks: add a directed replication edge between two sites in a group's
// recovery topology. `addDRTopologyEdge` returns the recomputed topology, so the
// new graph is surfaced on `latestTopology` for an immediate repaint and the
// group-scoped topology + failover-target caches are invalidated (adding an edge
// can change the ranked failover target).
//
// RBAC: write action — gate the trigger on `dr:write` via the shared
// `dr-write-gate`; the hook stays permission-free.
// ---------------------------------------------------------------------------

export interface UseTopologyActions {
  addTopologyEdge: (groupID: string, payload: DRTopologyAddEdgeRequest) => void;
  addTopologyEdgePending: boolean;
  addTopologyEdgeError: unknown;
  latestTopology: DRTopology | null;
}

export function useTopologyActions(): UseTopologyActions {
  const queryClient = useQueryClient();
  const [latestTopology, setLatestTopology] = useState<DRTopology | null>(null);

  const addTopologyEdgeMutation = useMutation({
    mutationFn: ({ groupID, payload }: { groupID: string; payload: DRTopologyAddEdgeRequest }) => {
      if (!groupID) throw new Error('Select a protection group before adding a topology edge.');
      return addDRTopologyEdge(groupID, payload);
    },
    onSuccess: (topology) => {
      setLatestTopology(topology);
      toast.success('Topology edge added');
      void queryClient.invalidateQueries({
        queryKey: ['clario-dr', 'topology', topology.group_id],
      });
      void queryClient.invalidateQueries({
        queryKey: ['clario-dr', 'topology-failover-target', topology.group_id],
      });
    },
    onError: (error) => {
      toast.error(formatErrorMessage(error, 'Failed to add topology edge'));
    },
  });

  return {
    addTopologyEdge: (groupID: string, payload: DRTopologyAddEdgeRequest) =>
      addTopologyEdgeMutation.mutate({ groupID, payload }),
    addTopologyEdgePending: addTopologyEdgeMutation.isPending,
    addTopologyEdgeError: addTopologyEdgeMutation.error,
    latestTopology,
  };
}

// ---------------------------------------------------------------------------
// Boot actions (Wave E — /dr isolated-boot plan authoring + run start).
//
// The write-side counterpart to the `useDRBootPlan` / `useDRBootRun` query hooks:
// define the tiered boot services for a group (returns the recomputed
// `DRBootPlan`), and start an isolated-boot run for a group (returns the
// `DRBootRunDetail`). `defineBootServices` invalidates the group's boot-plan
// cache; `startBootRun` surfaces the started run on `latestBootRun` (and its id on
// `latestBootRunId`) so the live boot-run view can mount on
// `['clario-dr', 'boot-run', runId]` immediately, and also invalidates the
// boot-plan cache (a run touches per-service status).
//
// RBAC: write actions — gate on `dr:write` via the shared `dr-write-gate`.
// ---------------------------------------------------------------------------

export interface UseBootActions {
  defineBootServices: (groupID: string, payload: DRCreateBootServicesRequest) => void;
  defineBootServicesPending: boolean;
  defineBootServicesError: unknown;
  latestBootPlan: DRBootPlan | null;

  startBootRun: (groupID: string, policy?: string) => void;
  startBootRunPending: boolean;
  startBootRunError: unknown;
  latestBootRun: DRBootRunDetail | null;
  latestBootRunId: string | null;
}

export function useBootActions(): UseBootActions {
  const queryClient = useQueryClient();
  const [latestBootPlan, setLatestBootPlan] = useState<DRBootPlan | null>(null);
  const [latestBootRun, setLatestBootRun] = useState<DRBootRunDetail | null>(null);
  const [latestBootRunId, setLatestBootRunId] = useState<string | null>(null);

  const defineBootServicesMutation = useMutation({
    mutationFn: ({ groupID, payload }: { groupID: string; payload: DRCreateBootServicesRequest }) => {
      if (!groupID) throw new Error('Select a protection group before defining boot services.');
      return defineDRBootServices(groupID, payload);
    },
    onSuccess: (plan) => {
      setLatestBootPlan(plan);
      toast.success('Boot services defined');
      void queryClient.invalidateQueries({
        queryKey: ['clario-dr', 'boot-plan', plan.group_id],
      });
    },
    onError: (error) => {
      toast.error(formatErrorMessage(error, 'Failed to define boot services'));
    },
  });

  const startBootRunMutation = useMutation({
    mutationFn: ({ groupID, policy }: { groupID: string; policy?: string }) => {
      if (!groupID) throw new Error('Select a protection group before starting a boot run.');
      return startDRBootRun(groupID, policy);
    },
    onSuccess: (detail) => {
      setLatestBootRun(detail);
      setLatestBootRunId(detail.run.id);
      toast.success(`Isolated boot run ${detail.run.id} started`);
      void queryClient.invalidateQueries({
        queryKey: ['clario-dr', 'boot-run', detail.run.id],
      });
      void queryClient.invalidateQueries({
        queryKey: ['clario-dr', 'boot-plan', detail.run.group_id],
      });
    },
    onError: (error) => {
      toast.error(formatErrorMessage(error, 'Failed to start boot run'));
    },
  });

  return {
    defineBootServices: (groupID: string, payload: DRCreateBootServicesRequest) =>
      defineBootServicesMutation.mutate({ groupID, payload }),
    defineBootServicesPending: defineBootServicesMutation.isPending,
    defineBootServicesError: defineBootServicesMutation.error,
    latestBootPlan,

    startBootRun: (groupID: string, policy?: string) =>
      startBootRunMutation.mutate({ groupID, policy }),
    startBootRunPending: startBootRunMutation.isPending,
    startBootRunError: startBootRunMutation.error,
    latestBootRun,
    latestBootRunId,
  };
}

// ---------------------------------------------------------------------------
// Game Day actions (Wave E — /dr/rehearse scenario authoring + run).
//
// The write-side counterpart to the `useDRGameDayScenarios` /
// `useDRGameDayScorecard` query hooks: author a game-day scenario (create) and
// run one (returns the first `DRGameDayScorecard`). `createScenario` invalidates
// the tenant-wide scenario catalogue; `runScenario` surfaces the resulting
// scorecard on `latestScorecard` (and its run id on `latestRunId`) so the
// run-scoped scorecard view can mount on `['clario-dr', 'gameday-scorecard', runId]`,
// and re-invalidates the scenario list (a run can change last-run metadata). This
// mirrors `useRehearseActions.runGameDay` but pairs it with scenario authoring on
// a single focused surface.
//
// RBAC: write actions — gate on `dr:write` via the shared `dr-write-gate`.
// ---------------------------------------------------------------------------

export interface UseGameDayActions {
  createScenario: (payload: DRCreateGameDayScenarioRequest) => void;
  createScenarioPending: boolean;
  createScenarioError: unknown;
  latestScenario: DRGameDayScenario | null;

  runScenario: (scenarioID: string) => void;
  runScenarioPending: boolean;
  runScenarioError: unknown;
  latestScorecard: DRGameDayScorecard | null;
  latestRunId: string | null;
}

export function useGameDayActions(): UseGameDayActions {
  const queryClient = useQueryClient();
  const [latestScenario, setLatestScenario] = useState<DRGameDayScenario | null>(null);
  const [latestScorecard, setLatestScorecard] = useState<DRGameDayScorecard | null>(null);
  const [latestRunId, setLatestRunId] = useState<string | null>(null);

  const createScenarioMutation = useMutation({
    mutationFn: (payload: DRCreateGameDayScenarioRequest) => createDRGameDayScenario(payload),
    onSuccess: (scenario) => {
      setLatestScenario(scenario);
      toast.success(`Game-day scenario ${scenario.name} created`);
      void queryClient.invalidateQueries({ queryKey: ['clario-dr', 'gameday-scenarios'] });
    },
    onError: (error) => {
      toast.error(formatErrorMessage(error, 'Failed to create game-day scenario'));
    },
  });

  const runScenarioMutation = useMutation({
    mutationFn: runDRGameDayScenario,
    onSuccess: (scorecard) => {
      setLatestScorecard(scorecard);
      setLatestRunId(scorecard.run.id);
      toast.success(
        `Game-day scenario ${scorecard.run.id} completed with ${scorecard.run.safety_verdict}`,
      );
      void queryClient.invalidateQueries({ queryKey: ['clario-dr', 'gameday-scenarios'] });
      void queryClient.invalidateQueries({
        queryKey: ['clario-dr', 'gameday-scorecard', scorecard.run.id],
      });
    },
    onError: (error) => {
      toast.error(formatErrorMessage(error, 'Failed to run game-day scenario'));
    },
  });

  return {
    createScenario: (payload: DRCreateGameDayScenarioRequest) =>
      createScenarioMutation.mutate(payload),
    createScenarioPending: createScenarioMutation.isPending,
    createScenarioError: createScenarioMutation.error,
    latestScenario,

    runScenario: (scenarioID: string) => runScenarioMutation.mutate(scenarioID),
    runScenarioPending: runScenarioMutation.isPending,
    runScenarioError: runScenarioMutation.error,
    latestScorecard,
    latestRunId,
  };
}
