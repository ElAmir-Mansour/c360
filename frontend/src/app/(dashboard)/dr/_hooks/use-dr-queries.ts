'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { isApiError } from '@/types/api';
import {
  fetchDRAgents,
  fetchDRAssuranceControls,
  fetchDRAssuranceLatest,
  fetchDRAttestationLedger,
  fetchDRBCMPacks,
  fetchDRBYOKCustodyLog,
  fetchDRBYOKKeys,
  fetchDRBootPlan,
  fetchDRBootRun,
  fetchDRCleanRoomScan,
  fetchDRConsistencyBarriers,
  fetchDRCyberVaultAssessments,
  fetchDRCyberVaults,
  fetchDRDrillDiff,
  fetchDRDrillScheduleNextRuns,
  fetchDRDrillSchedules,
  fetchDRFailbackRuns,
  fetchDRFailoverRun,
  fetchDRFailoverRuns,
  fetchDRFailoverSteps,
  fetchDRGameDayScenarios,
  fetchDRGameDayScorecard,
  fetchDRGroup,
  fetchDRGroupDrillResults,
  fetchDRGroupMembers,
  fetchDRGroupNetworkMappings,
  fetchDRGroupRecoveryPoints,
  fetchDRGroups,
  fetchDRGroupSummary,
  fetchDRIaCSnapshots,
  fetchDRJournalBookmarks,
  fetchDRJournalTimeline,
  fetchDRPosture,
  fetchDRPredictions,
  fetchDRRansomwareSignals,
  fetchDRRansomwareStreamSignals,
  fetchDRRegistryRunbook,
  fetchDRRegistryRunbookVersions,
  fetchDRRecoveryTiers,
  fetchDRRehearsalProof,
  fetchDRRunbook,
  fetchDRRunbookRun,
  fetchDRReplicationSummary,
  fetchDRSelfDRArtifacts,
  fetchDRSelfDRComponents,
  fetchDRSelfDRLatestAssessment,
  fetchDRSite,
  fetchDRSites,
  fetchDRStorageVolumes,
  fetchDRStream,
  fetchDRStreamForecast,
  fetchDRStreamRPO,
  fetchDRStreams,
  fetchDRTopology,
  fetchDRTopologyFailoverTarget,
  fetchDRWorkloadCaptureEpochs,
  fetchDRWorkloadCaptures,
  verifyDRAttestationLedger,
  type DRAgent,
  type DRAssuranceAssessmentReport,
  type DRAssuranceControlInfo,
  type DRAttestationLedgerEntry,
  type DRAttestationLedgerFilters,
  type DRAttestationLedgerVerifyResult,
  type DRBCMPack,
  type DRBYOKCustodyLog,
  type DRBYOKKey,
  type DRBootPlan,
  type DRBootRunDetail,
  type DRCleanRoomScan,
  type DRConsistencyBarrier,
  type DRConsistencyGroup,
  type DRConsistencyGroupMember,
  type DRCyberVaultAssessmentListResponse,
  type DRCyberVaultListResponse,
  type DRDrillDiff,
  type DRDrillNextRunsResponse,
  type DRDrillResult,
  type DRDrillSchedule,
  type DRFailbackRun,
  type DRFailoverRun,
  type DRFailoverStep,
  type DRGameDayScenario,
  type DRGameDayScorecard,
  type DRGroupSummary,
  type DRIaCSnapshotList,
  type DRJournalBookmark,
  type DRJournalTimeline,
  type DRNetworkMapping,
  type DRPosture,
  type DRPrediction,
  type DRProtectedSite,
  type DRRansomwareSignal,
  type DRRecoveryTierProfile,
  type DRRecoveryPoint,
  type DRRegistryRunbookVersion,
  type DRReplicationStream,
  type DRReplicationSummary,
  type DRRehearsalProof,
  type DRRehearsalProofKind,
  type DRRunbookLiveState,
  type DRRunbookPlan,
  type DRSelfDRAssessmentReport,
  type DRSelfDRComponentsResponse,
  type DRSelfDRStoredArtifact,
  type DRStorageVolume,
  type DRStreamForecast,
  type DRStreamRPO,
  type DRTopology,
  type DRTopologyFailoverSelection,
  type DRWorkloadCaptureEpoch,
  type DRWorkloadCaptureSource,
} from '@/lib/clario-dr';

/**
 * Granular `useQuery` wrappers for the ClarioDR Recovery Operations Console.
 *
 * Every query key, query fn, refetch interval, and `enabled` condition is
 * reproduced byte-for-byte from the original `/dr` monolith so that cross-route
 * cache sharing and mutation invalidations (which target the same
 * `['clario-dr', ...]` keys) keep working unchanged.
 *
 * Hooks whose key/enabled depends on a selection id take that id as an argument
 * (`activeGroupId`, `activeStreamId`, etc.); pass the value derived from
 * `useDRSelection()` so the keys stay identical to the monolith.
 */

/**
 * Resolve a 404 ("nothing exists yet") to `null` instead of letting it reject
 * the query. The "latest assessment" / "stream forecast" endpoints legitimately
 * 404 before any data has been produced; surfacing that as a hard query error
 * forces the consuming panel into an ErrorState (or crashes a downstream graph),
 * whereas a `null` payload renders the existing graceful empty/not-found copy.
 * Any other failure (auth, 5xx, network) is re-thrown so the error UI still shows.
 */
function notFoundAsNull<T>(promise: Promise<T>): Promise<T | null> {
  return promise.catch((error: unknown) => {
    if (isApiError(error) && error.status === 404) {
      return null;
    }
    throw error;
  });
}

// ---------------------------------------------------------------------------
// Tenant-wide queries (no selection dependency).
// ---------------------------------------------------------------------------

export function useDRPosture(): UseQueryResult<DRPosture> {
  return useQuery<DRPosture>({
    queryKey: ['clario-dr', 'posture'],
    queryFn: fetchDRPosture,
    refetchInterval: 60_000,
  });
}

export function useDRReplicationSummary(): UseQueryResult<DRReplicationSummary> {
  return useQuery<DRReplicationSummary>({
    queryKey: ['clario-dr', 'replication-summary'],
    queryFn: fetchDRReplicationSummary,
    refetchInterval: 45_000,
  });
}

/**
 * Concurrent failover/failback runs.
 *
 * `refetchInterval` defaults to the monolith's 45s baseline, but a caller that
 * knows a run is live (via the `use-dr-realtime` liveness helpers) may pass a
 * tighter interval (e.g. `DR_LIVE_REFETCH_MS`) so the overview keeps ticking
 * even in deployments that do not deliver the DR WebSocket topic. Passing
 * nothing preserves the original byte-for-byte cadence for every other caller.
 */
export function useDRFailoverRuns(
  refetchInterval: number | false = 45_000,
): UseQueryResult<DRFailoverRun[]> {
  return useQuery<DRFailoverRun[]>({
    queryKey: ['clario-dr', 'failover-runs'],
    queryFn: fetchDRFailoverRuns,
    refetchInterval,
  });
}

/**
 * Attestation ledger entries.
 *
 * Called with no argument it preserves the monolith's byte-for-byte key
 * (`['clario-dr', 'attestation-ledger']`) and `{ limit: 25 }` fetch, which is the
 * exact key the anchor mutation in {@link useEvidenceActions} invalidates — so the
 * Overview's ledger card keeps refreshing after an anchor.
 *
 * Called with `filters`, it scopes both the fetch and the key
 * (`['clario-dr', 'attestation-ledger', filters]`) so the dedicated `prove/ledger`
 * route can drive type/subject/limit filtering off its own cache entry without
 * disturbing the shared default. A `limit` is always sent (defaulting to 25) so a
 * filtered view never accidentally requests the unbounded ledger.
 */
export function useDRAttestationLedger(
  filters?: DRAttestationLedgerFilters,
): UseQueryResult<DRAttestationLedgerEntry[]> {
  const effectiveFilters: DRAttestationLedgerFilters = { limit: 25, ...filters };
  return useQuery<DRAttestationLedgerEntry[]>({
    queryKey: filters
      ? ['clario-dr', 'attestation-ledger', filters]
      : ['clario-dr', 'attestation-ledger'],
    queryFn: () => fetchDRAttestationLedger(effectiveFilters),
    refetchInterval: 120_000,
  });
}

export function useDRLedgerVerify(): UseQueryResult<DRAttestationLedgerVerifyResult> {
  return useQuery<DRAttestationLedgerVerifyResult>({
    queryKey: ['clario-dr', 'attestation-ledger-verify'],
    queryFn: verifyDRAttestationLedger,
    refetchInterval: 120_000,
  });
}

export function useDRBCMPacks(): UseQueryResult<DRBCMPack[]> {
  return useQuery<DRBCMPack[]>({
    queryKey: ['clario-dr', 'bcm-packs'],
    queryFn: fetchDRBCMPacks,
    refetchInterval: 300_000,
  });
}

export function useDRBYOKKeys(): UseQueryResult<DRBYOKKey[]> {
  return useQuery<DRBYOKKey[]>({
    queryKey: ['clario-dr', 'byok-keys'],
    queryFn: fetchDRBYOKKeys,
    refetchInterval: 120_000,
  });
}

export function useDRBYOKCustodyLog(): UseQueryResult<DRBYOKCustodyLog> {
  return useQuery<DRBYOKCustodyLog>({
    queryKey: ['clario-dr', 'byok-custody-log'],
    queryFn: fetchDRBYOKCustodyLog,
    refetchInterval: 300_000,
  });
}

export function useDRAgents(): UseQueryResult<DRAgent[]> {
  return useQuery<DRAgent[]>({
    queryKey: ['clario-dr', 'agents'],
    queryFn: fetchDRAgents,
    refetchInterval: 60_000,
  });
}

export function useDRAssuranceControls(): UseQueryResult<DRAssuranceControlInfo[]> {
  return useQuery<DRAssuranceControlInfo[]>({
    queryKey: ['clario-dr', 'assurance-controls'],
    queryFn: fetchDRAssuranceControls,
    refetchInterval: 300_000,
  });
}

export function useDRDrillSchedules(): UseQueryResult<DRDrillSchedule[]> {
  return useQuery<DRDrillSchedule[]>({
    queryKey: ['clario-dr', 'drill-schedules'],
    queryFn: fetchDRDrillSchedules,
    refetchInterval: 120_000,
  });
}

export function useDRFailbackRuns(): UseQueryResult<DRFailbackRun[]> {
  return useQuery<DRFailbackRun[]>({
    queryKey: ['clario-dr', 'failback-runs'],
    queryFn: fetchDRFailbackRuns,
    refetchInterval: 60_000,
  });
}

export function useDRGameDayScenarios(): UseQueryResult<DRGameDayScenario[]> {
  return useQuery<DRGameDayScenario[]>({
    queryKey: ['clario-dr', 'gameday-scenarios'],
    queryFn: fetchDRGameDayScenarios,
    refetchInterval: 120_000,
  });
}

export function useDRPredictions(): UseQueryResult<DRPrediction[]> {
  return useQuery<DRPrediction[]>({
    queryKey: ['clario-dr', 'predictions'],
    queryFn: fetchDRPredictions,
    refetchInterval: 60_000,
  });
}

export function useDRRansomwareSignals(): UseQueryResult<DRRansomwareSignal[]> {
  return useQuery<DRRansomwareSignal[]>({
    queryKey: ['clario-dr', 'ransomware-signals'],
    queryFn: () => fetchDRRansomwareSignals({ limit: 25 }),
    refetchInterval: 60_000,
  });
}

export function useDRIaCSnapshots(): UseQueryResult<DRIaCSnapshotList> {
  return useQuery<DRIaCSnapshotList>({
    queryKey: ['clario-dr', 'iac-snapshots'],
    queryFn: fetchDRIaCSnapshots,
    refetchInterval: 300_000,
  });
}

export function useDRStorageVolumes(): UseQueryResult<DRStorageVolume[]> {
  return useQuery<DRStorageVolume[]>({
    queryKey: ['clario-dr', 'storage-volumes'],
    queryFn: fetchDRStorageVolumes,
    refetchInterval: 300_000,
  });
}

export function useDRWorkloadCaptures(): UseQueryResult<DRWorkloadCaptureSource[]> {
  return useQuery<DRWorkloadCaptureSource[]>({
    queryKey: ['clario-dr', 'workload-captures'],
    queryFn: fetchDRWorkloadCaptures,
    refetchInterval: 120_000,
  });
}

export function useDRSelfDRComponents(): UseQueryResult<DRSelfDRComponentsResponse> {
  return useQuery<DRSelfDRComponentsResponse>({
    queryKey: ['clario-dr', 'selfdr-components'],
    queryFn: fetchDRSelfDRComponents,
    refetchInterval: 300_000,
  });
}

export function useDRSelfDRLatest(): UseQueryResult<DRSelfDRAssessmentReport | null> {
  return useQuery<DRSelfDRAssessmentReport | null>({
    queryKey: ['clario-dr', 'selfdr-latest-assessment'],
    // A 404 here means "no self-DR assessment has been produced yet" — resolve
    // it to null so the coverage panel renders its "No assessment returned"
    // empty state instead of a thrown ErrorState.
    queryFn: () => notFoundAsNull(fetchDRSelfDRLatestAssessment()),
    refetchInterval: 300_000,
  });
}

export function useDRSelfDRArtifacts(): UseQueryResult<DRSelfDRStoredArtifact[]> {
  return useQuery<DRSelfDRStoredArtifact[]>({
    queryKey: ['clario-dr', 'selfdr-artifacts'],
    queryFn: () => fetchDRSelfDRArtifacts(25),
    refetchInterval: 300_000,
  });
}

export function useDRRecoveryTiers(): UseQueryResult<DRRecoveryTierProfile[]> {
  return useQuery<DRRecoveryTierProfile[]>({
    queryKey: ['clario-dr', 'recovery-tiers'],
    queryFn: fetchDRRecoveryTiers,
    refetchInterval: 300_000,
  });
}

export function useDRSites(): UseQueryResult<DRProtectedSite[]> {
  return useQuery<DRProtectedSite[]>({
    queryKey: ['clario-dr', 'sites'],
    queryFn: fetchDRSites,
    refetchInterval: 120_000,
  });
}

/**
 * Tenant-wide consistency (protection) groups list — the provisioning surface's
 * primary inventory. Keyed `['clario-dr', 'groups']`, the exact key the
 * `createGroup` provisioning action invalidates on success, so a newly created
 * group appears without a manual refetch. The 120s cadence mirrors the other
 * tenant-wide inventory queries (`sites`, `streams`).
 */
export function useDRGroups(): UseQueryResult<DRConsistencyGroup[]> {
  return useQuery<DRConsistencyGroup[]>({
    queryKey: ['clario-dr', 'groups'],
    queryFn: fetchDRGroups,
    refetchInterval: 120_000,
  });
}

/**
 * Tenant-wide replication streams list. Keyed `['clario-dr', 'streams']`, the
 * exact key the `createStream` provisioning action invalidates on success.
 */
export function useDRStreams(): UseQueryResult<DRReplicationStream[]> {
  return useQuery<DRReplicationStream[]>({
    queryKey: ['clario-dr', 'streams'],
    queryFn: fetchDRStreams,
    refetchInterval: 120_000,
  });
}

// ---------------------------------------------------------------------------
// Group-scoped queries (enabled when an active group id is present).
// ---------------------------------------------------------------------------

export function useDRCyberVaults(
  activeGroupId: string | null,
): UseQueryResult<DRCyberVaultListResponse> {
  return useQuery<DRCyberVaultListResponse>({
    queryKey: ['clario-dr', 'cyber-vaults', activeGroupId],
    queryFn: () => fetchDRCyberVaults(activeGroupId!),
    enabled: Boolean(activeGroupId),
    refetchInterval: 300_000,
  });
}

export function useDRCyberVaultAssessments(
  activeGroupId: string | null,
): UseQueryResult<DRCyberVaultAssessmentListResponse> {
  return useQuery<DRCyberVaultAssessmentListResponse>({
    queryKey: ['clario-dr', 'cyber-vault-assessments', activeGroupId],
    queryFn: () => fetchDRCyberVaultAssessments(activeGroupId!),
    enabled: Boolean(activeGroupId),
    refetchInterval: 300_000,
  });
}

export function useDRGroupSummary(activeGroupId: string | null): UseQueryResult<DRGroupSummary> {
  return useQuery<DRGroupSummary>({
    queryKey: ['clario-dr', 'group-summary', activeGroupId],
    queryFn: () => fetchDRGroupSummary(activeGroupId!),
    enabled: Boolean(activeGroupId),
    refetchInterval: 60_000,
  });
}

export function useDRAssuranceLatest(
  activeGroupId: string | null,
): UseQueryResult<DRAssuranceAssessmentReport> {
  return useQuery<DRAssuranceAssessmentReport>({
    queryKey: ['clario-dr', 'assurance-latest', activeGroupId],
    queryFn: () => fetchDRAssuranceLatest(activeGroupId!),
    enabled: Boolean(activeGroupId),
    refetchInterval: 120_000,
  });
}

export function useDRBootPlan(activeGroupId: string | null): UseQueryResult<DRBootPlan> {
  return useQuery<DRBootPlan>({
    queryKey: ['clario-dr', 'boot-plan', activeGroupId],
    queryFn: () => fetchDRBootPlan(activeGroupId!),
    enabled: Boolean(activeGroupId),
    refetchInterval: 120_000,
  });
}

export function useDRConsistencyBarriers(
  activeGroupId: string | null,
): UseQueryResult<DRConsistencyBarrier[]> {
  return useQuery<DRConsistencyBarrier[]>({
    queryKey: ['clario-dr', 'consistency-barriers', activeGroupId],
    queryFn: () => fetchDRConsistencyBarriers(activeGroupId!),
    enabled: Boolean(activeGroupId),
    refetchInterval: 120_000,
  });
}

export function useDRDrillResults(activeGroupId: string | null): UseQueryResult<DRDrillResult[]> {
  return useQuery<DRDrillResult[]>({
    queryKey: ['clario-dr', 'drill-results', activeGroupId],
    queryFn: () => fetchDRGroupDrillResults(activeGroupId!),
    enabled: Boolean(activeGroupId),
    refetchInterval: 120_000,
  });
}

/**
 * Per-group drill results, exposed under the task-requested name expected by the
 * `rehearse` / `prove/compliance` build agents. Delegates to
 * {@link useDRDrillResults} so both names share the single
 * `['clario-dr', 'drill-results', activeGroupId]` cache entry (and the same
 * invalidations) rather than maintaining a parallel key.
 */
export function useDRGroupDrillResults(
  activeGroupId: string | null,
): UseQueryResult<DRDrillResult[]> {
  return useDRDrillResults(activeGroupId);
}

/**
 * Upcoming scheduled runs for a single drill schedule, enabled once a schedule id
 * is selected. `count` is optional (the API caps/derives a default server-side);
 * it is folded into the query key so distinct horizons cache independently under
 * the shared `['clario-dr', 'drill-schedule-next-runs', ...]` namespace.
 */
export function useDRDrillScheduleNextRuns(
  scheduleId: string | null,
  count?: number,
): UseQueryResult<DRDrillNextRunsResponse> {
  return useQuery<DRDrillNextRunsResponse>({
    queryKey: ['clario-dr', 'drill-schedule-next-runs', scheduleId, count ?? null],
    queryFn: () => fetchDRDrillScheduleNextRuns(scheduleId!, count),
    enabled: Boolean(scheduleId),
    refetchInterval: 120_000,
  });
}

export function useDRTopology(activeGroupId: string | null): UseQueryResult<DRTopology> {
  return useQuery<DRTopology>({
    queryKey: ['clario-dr', 'topology', activeGroupId],
    queryFn: () => fetchDRTopology(activeGroupId!),
    enabled: Boolean(activeGroupId),
    refetchInterval: 120_000,
  });
}

export function useDRTopologyFailoverTarget(
  activeGroupId: string | null,
): UseQueryResult<DRTopologyFailoverSelection> {
  return useQuery<DRTopologyFailoverSelection>({
    queryKey: ['clario-dr', 'topology-failover-target', activeGroupId],
    queryFn: () => fetchDRTopologyFailoverTarget(activeGroupId!),
    enabled: Boolean(activeGroupId),
    refetchInterval: 120_000,
  });
}

export function useDRGroupRecoveryPoints(
  activeGroupId: string | null,
): UseQueryResult<DRRecoveryPoint[]> {
  return useQuery<DRRecoveryPoint[]>({
    queryKey: ['clario-dr', 'group-recovery-points', activeGroupId],
    queryFn: () => fetchDRGroupRecoveryPoints(activeGroupId!),
    enabled: Boolean(activeGroupId),
    refetchInterval: 60_000,
  });
}

export function useDRRegistryRunbook(
  activeGroupId: string | null,
): UseQueryResult<DRRegistryRunbookVersion> {
  return useQuery<DRRegistryRunbookVersion>({
    queryKey: ['clario-dr', 'registry-runbook', activeGroupId],
    queryFn: () => fetchDRRegistryRunbook(activeGroupId!, 'isolated'),
    enabled: Boolean(activeGroupId),
    refetchInterval: 120_000,
  });
}

export function useDRRegistryRunbookVersions(
  activeGroupId: string | null,
): UseQueryResult<DRRegistryRunbookVersion[]> {
  return useQuery<DRRegistryRunbookVersion[]>({
    queryKey: ['clario-dr', 'registry-runbook-versions', activeGroupId],
    queryFn: () => fetchDRRegistryRunbookVersions(activeGroupId!),
    enabled: Boolean(activeGroupId),
    refetchInterval: 120_000,
  });
}

/**
 * A single consistency (protection) group's record, enabled once a group id is
 * present. Keyed `['clario-dr', 'group', groupId]` so it caches independently of
 * the `['clario-dr', 'groups']` list and the `['clario-dr', 'group-summary', id]`
 * rollup — this is the lightweight group entity (id/name/created_at), distinct
 * from the heavier summary the recovery surfaces consume.
 */
export function useDRGroup(groupId: string | null): UseQueryResult<DRConsistencyGroup> {
  return useQuery<DRConsistencyGroup>({
    queryKey: ['clario-dr', 'group', groupId],
    queryFn: () => fetchDRGroup(groupId!),
    enabled: Boolean(groupId),
    refetchInterval: 120_000,
  });
}

/**
 * Raw member records (site_id + boot_order) for a group, enabled once a group id
 * is present. Keyed `['clario-dr', 'group-members', groupId]`, the exact key the
 * `addMember` provisioning action invalidates so a newly added member appears
 * without a manual refetch. This is the editable boot-order list the provisioning
 * UI manages, distinct from the read-only `members` array inside the group
 * summary rollup.
 */
export function useDRGroupMembers(
  groupId: string | null,
): UseQueryResult<DRConsistencyGroupMember[]> {
  return useQuery<DRConsistencyGroupMember[]>({
    queryKey: ['clario-dr', 'group-members', groupId],
    queryFn: () => fetchDRGroupMembers(groupId!),
    enabled: Boolean(groupId),
    refetchInterval: 120_000,
  });
}

/**
 * Network mappings (primary/recovery CIDR pairs per profile) for a group, enabled
 * once a group id is present. Keyed `['clario-dr', 'group-network-mappings',
 * groupId]`, the exact key the `createNetworkMapping` provisioning action
 * invalidates on success.
 */
export function useDRGroupNetworkMappings(
  groupId: string | null,
): UseQueryResult<DRNetworkMapping[]> {
  return useQuery<DRNetworkMapping[]>({
    queryKey: ['clario-dr', 'group-network-mappings', groupId],
    queryFn: () => fetchDRGroupNetworkMappings(groupId!),
    enabled: Boolean(groupId),
    refetchInterval: 120_000,
  });
}

// ---------------------------------------------------------------------------
// Stream-scoped queries (enabled when an active stream id is present).
// ---------------------------------------------------------------------------

export function useDRJournalTimeline(
  activeStreamId: string | null,
): UseQueryResult<DRJournalTimeline> {
  return useQuery<DRJournalTimeline>({
    queryKey: ['clario-dr', 'journal-timeline', activeStreamId],
    queryFn: () => fetchDRJournalTimeline(activeStreamId!),
    enabled: Boolean(activeStreamId),
    refetchInterval: 60_000,
  });
}

export function useDRJournalBookmarks(
  activeStreamId: string | null,
): UseQueryResult<DRJournalBookmark[]> {
  return useQuery<DRJournalBookmark[]>({
    queryKey: ['clario-dr', 'journal-bookmarks', activeStreamId],
    queryFn: () => fetchDRJournalBookmarks(activeStreamId!),
    enabled: Boolean(activeStreamId),
    refetchInterval: 120_000,
  });
}

export function useDRStreamForecast(
  activeStreamId: string | null,
): UseQueryResult<DRStreamForecast | null> {
  return useQuery<DRStreamForecast | null>({
    queryKey: ['clario-dr', 'stream-forecast', activeStreamId],
    // A 404 means the stream has no forecast yet (insufficient samples) —
    // resolve to null so the intelligence plane shows its steady/empty state
    // rather than surfacing a hard error.
    queryFn: () => notFoundAsNull(fetchDRStreamForecast(activeStreamId!)),
    enabled: Boolean(activeStreamId),
    refetchInterval: 60_000,
  });
}

export function useDRStreamRansomwareSignals(
  activeStreamId: string | null,
): UseQueryResult<DRRansomwareSignal[]> {
  return useQuery<DRRansomwareSignal[]>({
    queryKey: ['clario-dr', 'stream-ransomware-signals', activeStreamId],
    queryFn: () => fetchDRRansomwareStreamSignals(activeStreamId!, 10),
    enabled: Boolean(activeStreamId),
    refetchInterval: 60_000,
  });
}

/**
 * Live RPO/lag measurement for a single replication stream, enabled once a stream
 * id is present. Keyed `['clario-dr', 'stream-rpo', streamId]`. A 60s cadence
 * mirrors the other live RPO-bearing queries (journal timeline / stream forecast)
 * so the provisioning detail pane keeps showing a current data-loss window.
 */
export function useDRStreamRPO(streamId: string | null): UseQueryResult<DRStreamRPO> {
  return useQuery<DRStreamRPO>({
    queryKey: ['clario-dr', 'stream-rpo', streamId],
    queryFn: () => fetchDRStreamRPO(streamId!),
    enabled: Boolean(streamId),
    refetchInterval: 60_000,
  });
}

/**
 * A single replication stream's record, enabled once a stream id is present.
 * Keyed `['clario-dr', 'stream', streamId]` so it caches independently of the
 * `['clario-dr', 'streams']` list and the `stream-rpo` measurement.
 */
export function useDRStream(streamId: string | null): UseQueryResult<DRReplicationStream> {
  return useQuery<DRReplicationStream>({
    queryKey: ['clario-dr', 'stream', streamId],
    queryFn: () => fetchDRStream(streamId!),
    enabled: Boolean(streamId),
    refetchInterval: 120_000,
  });
}

// ---------------------------------------------------------------------------
// Recovery-point-scoped query (enabled when an active recovery-point id is present).
// ---------------------------------------------------------------------------

export function useDRCleanRoomScan(
  activeRecoveryPointId: string | null,
): UseQueryResult<DRCleanRoomScan> {
  return useQuery<DRCleanRoomScan>({
    queryKey: ['clario-dr', 'cleanroom-scan', activeRecoveryPointId],
    queryFn: () => fetchDRCleanRoomScan(activeRecoveryPointId!),
    enabled: Boolean(activeRecoveryPointId),
    refetchInterval: 120_000,
    retry: false,
  });
}

// ---------------------------------------------------------------------------
// Capture-source-scoped query (enabled when an active capture-source id is present).
// ---------------------------------------------------------------------------

export function useDRWorkloadEpochs(
  activeCaptureSourceId: string | null,
): UseQueryResult<DRWorkloadCaptureEpoch[]> {
  return useQuery<DRWorkloadCaptureEpoch[]>({
    queryKey: ['clario-dr', 'workload-capture-epochs', activeCaptureSourceId],
    queryFn: () => fetchDRWorkloadCaptureEpochs(activeCaptureSourceId!),
    enabled: Boolean(activeCaptureSourceId),
    refetchInterval: 120_000,
  });
}

// ---------------------------------------------------------------------------
// Site-scoped query (enabled when an active protected-site id is present).
// ---------------------------------------------------------------------------

export function useDRSite(siteId: string | null): UseQueryResult<DRProtectedSite> {
  return useQuery<DRProtectedSite>({
    queryKey: ['clario-dr', 'site', siteId],
    queryFn: () => fetchDRSite(siteId!),
    enabled: Boolean(siteId),
    refetchInterval: 120_000,
  });
}

// ---------------------------------------------------------------------------
// Run drill-in (live execution view — /dr/runs/[id]).
// Not present in the monolith; added for the new drill-in route, keyed
// consistently under the shared ['clario-dr', ...] namespace.
// ---------------------------------------------------------------------------

export function useDRFailoverRun(runId: string | null): UseQueryResult<DRFailoverRun> {
  return useQuery<DRFailoverRun>({
    queryKey: ['clario-dr', 'failover-run', runId],
    queryFn: () => fetchDRFailoverRun(runId!),
    enabled: Boolean(runId),
    refetchInterval: 15_000,
  });
}

/**
 * Ordered execution steps for a single failover run — the per-step "who did what
 * when" record (`step`, `status`, `started_at`/`finished_at`, and `acted_by`
 * where the backend records it). Keyed on `['clario-dr', 'failover-run-steps',
 * runId]` to share the exact cache entry the `prove` PIR review already drives,
 * so the war-room activity feed and the PIR panel never double-fetch the same
 * run's steps. `refetchInterval` defaults to a live-friendly 15s (a settled run's
 * steps are immutable, so a slower cadence is fine via the optional override).
 */
export function useDRFailoverSteps(
  runId: string | null,
  refetchInterval: number | false = 15_000,
): UseQueryResult<DRFailoverStep[]> {
  return useQuery<DRFailoverStep[]>({
    queryKey: ['clario-dr', 'failover-run-steps', runId],
    queryFn: () => fetchDRFailoverSteps(runId!),
    enabled: Boolean(runId),
    refetchInterval,
  });
}

export function useDRRehearsalProof(
  kind: DRRehearsalProofKind | null,
  runId: string | null,
): UseQueryResult<DRRehearsalProof> {
  return useQuery<DRRehearsalProof>({
    queryKey: ['clario-dr', 'rehearsal-proof', kind, runId],
    queryFn: () => fetchDRRehearsalProof(kind!, runId!),
    enabled: Boolean(kind && runId),
    refetchInterval: 300_000,
    retry: false,
  });
}

// ---------------------------------------------------------------------------
// Runbook Studio (Wave E — /dr runbook authoring + live run drill-in).
//
// `fetchDRRunbook` returns the authored plan (`DRRunbookPlan` = runbook + tasks);
// `fetchDRRunbookRun` returns the live state (`DRRunbookLiveState` = run +
// tasks + task_runs + frontier + projection). Both are keyed under the shared
// `['clario-dr', ...]` namespace so the runbook-studio action hook's
// invalidations (`runbook`/`runbook-run` keys) refresh the exact cache entries
// these queries populate.
//
// NOTE — there is NO runbook LIST endpoint. `@/lib/clario-dr` only exposes
// `createDRRunbook` (POST /studio/runbooks), `fetchDRRunbook(id)` (GET
// /studio/runbooks/{id}) and `updateDRRunbook(id)` (PUT) — the collection has no
// GET. A `useDRRunbooks()` list hook is therefore intentionally NOT provided
// (fabricating a list endpoint is forbidden). The smallest real alternative the
// build agents should use: keep the active runbook id in the URL (the existing
// `useDRSelection` `?group=`/`?stream=` pattern — add a `?runbook=` param) and
// drive `useDRRunbook(id)` off it; the `createRunbook` action returns the new
// runbook so a freshly-authored runbook can be selected without a list. If a
// browsable catalogue is later required, a real `GET /studio/runbooks` endpoint
// must be added to `@/lib/clario-dr` (and `CLARIO_DR_ENDPOINTS.studioRunbooks`)
// first; this file should then gain a `useDRRunbooks()` keyed
// `['clario-dr', 'runbooks']`.

/**
 * A single runbook's authored plan (runbook record + ordered tasks), enabled once
 * a runbook id is present. Keyed `['clario-dr', 'runbook', runbookId]`, the exact
 * key the runbook-studio action hook invalidates after `updateRunbook`/`addTask`,
 * so an edited plan re-renders without a manual refetch. The 120s cadence mirrors
 * the other authored-inventory queries (the plan changes only on operator edits).
 */
export function useDRRunbook(runbookId: string | null): UseQueryResult<DRRunbookPlan> {
  return useQuery<DRRunbookPlan>({
    queryKey: ['clario-dr', 'runbook', runbookId],
    queryFn: () => fetchDRRunbook(runbookId!),
    enabled: Boolean(runbookId),
    refetchInterval: 120_000,
  });
}

/**
 * Live state for a single runbook run — the executing sub-DAG with per-task runs,
 * the runnable `frontier`, and the server-computed `projection` (elapsed-vs-planned
 * + on-track verdict). Enabled once a run id is present and keyed
 * `['clario-dr', 'runbook-run', runId]`, the exact key the runbook-studio action
 * hook invalidates after `startRun`/`actOnTask` so the war-room view ticks forward
 * immediately. `refetchInterval` defaults to a live-friendly 15s (mirroring
 * `useDRFailoverRun`); a settled run can be polled slower via the optional override.
 */
export function useDRRunbookRun(
  runId: string | null,
  refetchInterval: number | false = 15_000,
): UseQueryResult<DRRunbookLiveState> {
  return useQuery<DRRunbookLiveState>({
    queryKey: ['clario-dr', 'runbook-run', runId],
    queryFn: () => fetchDRRunbookRun(runId!),
    enabled: Boolean(runId),
    refetchInterval,
  });
}

// ---------------------------------------------------------------------------
// Boot run drill-in (Wave E — /dr isolated-boot live execution view).
//
// The group-scoped `useDRBootPlan(activeGroupId)` (defined above) feeds the plan
// editor; this run-scoped query feeds the live tier-by-tier boot execution view.
// Keyed `['clario-dr', 'boot-run', runId]`, sibling to the group's
// `['clario-dr', 'boot-plan', groupId]` so the two never collide.
// ---------------------------------------------------------------------------

/**
 * Live detail for a single isolated-boot run — the run record plus per-service
 * boot/health status rows. Enabled once a run id is present. `refetchInterval`
 * defaults to a live-friendly 15s (mirroring the other run drill-ins); a settled
 * run can be polled slower via the optional override.
 */
export function useDRBootRun(
  runId: string | null,
  refetchInterval: number | false = 15_000,
): UseQueryResult<DRBootRunDetail> {
  return useQuery<DRBootRunDetail>({
    queryKey: ['clario-dr', 'boot-run', runId],
    queryFn: () => fetchDRBootRun(runId!),
    enabled: Boolean(runId),
    refetchInterval,
  });
}

// ---------------------------------------------------------------------------
// Game Day scorecard + drill-result diff (Wave E — /dr/rehearse evidence).
//
// `useDRGameDayScenarios()` (the tenant-wide scenario catalogue) and
// `useDRGroupDrillResults(activeGroupId)` (per-group drill results) are defined
// above and reused unchanged. These two add the per-run / per-result detail the
// rehearse build agents drill into.
// ---------------------------------------------------------------------------

/**
 * A completed game-day run's scorecard (run rollup + per-step results), enabled
 * once a run id is present. Keyed `['clario-dr', 'gameday-scorecard', runId]`. A
 * completed scorecard is immutable, so a 5-minute cadence is sufficient.
 *
 * NOTE: `fetchDRGameDayScorecard` takes the game-day RUN id (`GET /gameday/runs/{id}`),
 * not the scenario id; the live `runScenario` action already returns the first
 * scorecard, so this query is for re-opening a prior run's scorecard by its run id.
 */
export function useDRGameDayScorecard(
  runId: string | null,
): UseQueryResult<DRGameDayScorecard> {
  return useQuery<DRGameDayScorecard>({
    queryKey: ['clario-dr', 'gameday-scorecard', runId],
    queryFn: () => fetchDRGameDayScorecard(runId!),
    enabled: Boolean(runId),
    refetchInterval: 300_000,
  });
}

/**
 * Drift diff between a drill result and its predecessor (pass/RTO/RPO/asset
 * deltas), enabled once a result id is present. Keyed
 * `['clario-dr', 'drill-diff', resultId]`. A drill result is immutable once
 * recorded, so a 5-minute cadence is sufficient.
 */
export function useDRDrillDiff(resultId: string | null): UseQueryResult<DRDrillDiff> {
  return useQuery<DRDrillDiff>({
    queryKey: ['clario-dr', 'drill-diff', resultId],
    queryFn: () => fetchDRDrillDiff(resultId!),
    enabled: Boolean(resultId),
    refetchInterval: 300_000,
  });
}
