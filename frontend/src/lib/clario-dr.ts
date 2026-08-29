import { apiDelete, apiGet, apiPost, apiPut } from '@/lib/api';
import type { ApiResponse as DataEnvelope } from '@/types/api';
import type {
  DRAgent,
  DRAgentEnrollRequest,
  DRAgentEnrollResponse,
  DRAgentEnrollmentToken,
  DRAgentEnrollmentTokenRequest,
  DRAddGroupMemberRequest,
  DRAssuranceAssessmentReport,
  DRAssuranceControlInfo,
  DRAssuranceEvaluateResponse,
  DRAttestation,
  DRAttestationLedgerCheckpoint,
  DRAttestationLedgerEntry,
  DRAttestationLedgerFilters,
  DRAttestationLedgerInclusionProof,
  DRAttestationLedgerVerifyResult,
  DRBootPlan,
  DRBootRunDetail,
  DRConsistencyBarrier,
  DRBCMAssessmentReport,
  DRBCMAssessmentRunResponse,
  DRBCMPack,
  DRBYOKCustodyLog,
  DRBYOKEnrollRequest,
  DRBYOKKey,
  DRCleanRoomScan,
  DRCopilotChatRequest,
  DRCopilotChatResult,
  DRCopilotSessionTranscript,
  DRCreateBootServicesRequest,
  DRCreateDrillScheduleRequest,
  DRConsistencyGroup,
  DRConsistencyGroupMember,
  DRCreateAgentRequest,
  DRCreateFailoverRunRequest,
  DRCreateFailbackRunRequest,
  DRCreateGameDayScenarioRequest,
  DRCreateJournalBookmarkRequest,
  DRCreateGroupRequest,
  DRCreateNetworkMappingRequest,
  DRCreateRunbookRequest,
  DRCreateSiteRequest,
  DRCreateStreamRequest,
  DRCyberVault,
  DRCyberVaultAssessmentListResponse,
  DRCyberVaultListResponse,
  DRCyberVaultPosture,
  DRCyberVaultStoredPostureAssessment,
  DRDrillDiff,
  DRDrillNextRunsResponse,
  DRDrillResult,
  DRDrillSchedule,
  DRApprovalDecisionRequest,
  DRFailoverRun,
  DRFailoverStep,
  DRFailbackRun,
  DRFailbackStep,
  DRGameDayScenario,
  DRGameDayScorecard,
  DRGroupSummary,
  DRIaCDiff,
  DRIaCIngestSnapshotRequest,
  DRIaCReconstitutionPlan,
  DRIaCSnapshot,
  DRIaCSnapshotList,
  DRInstantRecoveryProgress,
  DRInstantRecoverySession,
  DRIntegration,
  DRCreateIntegrationRequest,
  DRUpdateIntegrationRequest,
  DRIntegrationTestResult,
  DRJournalBookmark,
  DRJournalResolveRequest,
  DRJournalResolution,
  DRJournalTimeline,
  DRJournalTargetRequest,
  DRMaterializeJournalRecoveryPointRequest,
  DRNetworkMapping,
  DRPosture,
  DRProtectedSite,
  DRRecoveryPoint,
  DRRecoveryTierProfile,
  DRRecoveryTierRecommendationRequest,
  DRPrediction,
  DRRegistryRegenerateResult,
  DRRegistryRunbookProfile,
  DRRegistryRunbookVersion,
  DRRegisterStorageVolumeRequest,
  DRRegisterWorkloadCaptureRequest,
  DRReplicateStorageSnapshotRequest,
  DRReplicationStream,
  DRReplicationSummary,
  DRRehearsalProof,
  DRRehearsalProofKind,
  DRRansomwareSignal,
  DRRansomwareSignalFilters,
  DRRunbookActionRequest,
  DRRunbookAddTaskRequest,
  DRRunbookLiveState,
  DRRunbookPlan,
  DRRunbookStartRunRequest,
  DRRunbookTask,
  DRRunbookUpdateRequest,
  DRSealRecoveryPointRequest,
  DRSelfDRAssessResponse,
  DRSelfDRAssessmentReport,
  DRSelfDRBackupRequest,
  DRSelfDRComponentsResponse,
  DRSelfDROfflineBundleRequest,
  DRSelfDRProfile,
  DRSelfDRStoredArtifact,
  DRStorageSnapshot,
  DRStorageVolume,
  DRStreamRPO,
  DRStreamForecast,
  DRTopology,
  DRTopologyAddEdgeRequest,
  DRTopologyFailoverSelection,
  DRTriggerConsistencyPointRequest,
  DRWorkloadCaptureEpoch,
  DRWorkloadCaptureSource,
} from '@/types/clario-dr';

export type * from '@/types/clario-dr';

const DR_API_BASE = '/api/v1/dr';

const pathID = (value: string | number) => {
  const normalized = String(value).trim();
  if (!normalized || normalized === 'null' || normalized === 'undefined') {
    throw new Error('A valid DR resource identifier is required.');
  }
  return encodeURIComponent(normalized);
};

export const CLARIO_DR_ENDPOINTS = {
  posture: `${DR_API_BASE}/posture`,
  replicationSummary: `${DR_API_BASE}/replication/summary`,

  sites: `${DR_API_BASE}/sites`,
  site: (siteID: string) => `${DR_API_BASE}/sites/${pathID(siteID)}`,

  groupSummary: (groupID: string) =>
    `${DR_API_BASE}/groups/${pathID(groupID)}/summary`,
  groups: `${DR_API_BASE}/groups`,
  group: (groupID: string) => `${DR_API_BASE}/groups/${pathID(groupID)}`,
  groupMembers: (groupID: string) =>
    `${DR_API_BASE}/groups/${pathID(groupID)}/members`,
  groupRecoveryPoints: (groupID: string) =>
    `${DR_API_BASE}/groups/${pathID(groupID)}/recovery-points`,
  groupNetworkMappings: (groupID: string) =>
    `${DR_API_BASE}/groups/${pathID(groupID)}/network-mappings`,
  groupJournalMaterialize: (groupID: string) =>
    `${DR_API_BASE}/groups/${pathID(groupID)}/journal/materialize`,
  groupConsistencyBarriers: (groupID: string) =>
    `${DR_API_BASE}/groups/${pathID(groupID)}/consistency-barriers`,
  groupAppConsistentPoint: (groupID: string) =>
    `${DR_API_BASE}/groups/${pathID(groupID)}/app-consistent-point`,
  groupTopology: (groupID: string) =>
    `${DR_API_BASE}/groups/${pathID(groupID)}/topology`,
  groupTopologyEdges: (groupID: string) =>
    `${DR_API_BASE}/groups/${pathID(groupID)}/topology/edges`,
  groupTopologyFailoverTarget: (groupID: string) =>
    `${DR_API_BASE}/groups/${pathID(groupID)}/topology/failover-target`,
  groupBootPlan: (groupID: string) =>
    `${DR_API_BASE}/groups/${pathID(groupID)}/boot-plan`,
  groupBootServices: (groupID: string) =>
    `${DR_API_BASE}/groups/${pathID(groupID)}/boot-services`,
  groupBootRuns: (groupID: string) =>
    `${DR_API_BASE}/groups/${pathID(groupID)}/boot-runs`,
  groupDrillResults: (groupID: string) =>
    `${DR_API_BASE}/groups/${pathID(groupID)}/drill-results`,
  groupRegistryRunbook: (groupID: string) =>
    `${DR_API_BASE}/groups/${pathID(groupID)}/runbook`,
  groupRegistryRunbookVersions: (groupID: string) =>
    `${DR_API_BASE}/groups/${pathID(groupID)}/runbook/versions`,
  groupRegistryRunbookRegenerate: (groupID: string) =>
    `${DR_API_BASE}/groups/${pathID(groupID)}/runbook/regenerate`,

  streams: `${DR_API_BASE}/streams`,
  stream: (streamID: string) => `${DR_API_BASE}/streams/${pathID(streamID)}`,
  streamRPO: (streamID: string) =>
    `${DR_API_BASE}/streams/${pathID(streamID)}/rpo`,
  streamForecast: (streamID: string) =>
    `${DR_API_BASE}/streams/${pathID(streamID)}/forecast`,
  streamPause: (streamID: string) =>
    `${DR_API_BASE}/streams/${pathID(streamID)}/pause`,
  streamResume: (streamID: string) =>
    `${DR_API_BASE}/streams/${pathID(streamID)}/resume`,
  streamJournalTimeline: (streamID: string) =>
    `${DR_API_BASE}/streams/${pathID(streamID)}/journal/timeline`,
  streamJournalResolve: (streamID: string) =>
    `${DR_API_BASE}/streams/${pathID(streamID)}/journal/resolve`,
  streamJournalBookmarks: (streamID: string) =>
    `${DR_API_BASE}/streams/${pathID(streamID)}/journal/bookmarks`,
  streamJournalBookmark: (streamID: string, bookmarkID: string) =>
    `${DR_API_BASE}/streams/${pathID(streamID)}/journal/bookmarks/${pathID(bookmarkID)}`,

  recoveryPoint: (recoveryPointID: string) =>
    `${DR_API_BASE}/recovery-points/${pathID(recoveryPointID)}`,
  recoveryPointValidate: (recoveryPointID: string) =>
    `${DR_API_BASE}/recovery-points/${pathID(recoveryPointID)}/validate`,
  recoveryPointInstantRecovery: (recoveryPointID: string) =>
    `${DR_API_BASE}/recovery-points/${pathID(recoveryPointID)}/instant-recovery`,
  recoveryPointCleanRoom: (recoveryPointID: string) =>
    `${DR_API_BASE}/recovery-points/${pathID(recoveryPointID)}/cleanroom`,
  recoveryPointCleanRoomScan: (recoveryPointID: string) =>
    `${DR_API_BASE}/recovery-points/${pathID(recoveryPointID)}/cleanroom-scan`,

  agents: `${DR_API_BASE}/agents`,
  agent: (agentID: string) => `${DR_API_BASE}/agents/${pathID(agentID)}`,
  agentEnrollmentToken: (agentID: string) =>
    `${DR_API_BASE}/agents/${pathID(agentID)}/enrollment-token`,
  agentEnroll: `${DR_API_BASE}/agents/enroll`,

  failoverRuns: `${DR_API_BASE}/failover-runs`,
  failoverRun: (runID: string) =>
    `${DR_API_BASE}/failover-runs/${pathID(runID)}`,
  failoverRunSteps: (runID: string) =>
    `${DR_API_BASE}/failover-runs/${pathID(runID)}/steps`,
  failoverRunAttestation: (runID: string) =>
    `${DR_API_BASE}/failover-runs/${pathID(runID)}/attestation`,
  failoverRunApprove: (runID: string) =>
    `${DR_API_BASE}/failover-runs/${pathID(runID)}/approve`,
  failoverRunCancel: (runID: string) =>
    `${DR_API_BASE}/failover-runs/${pathID(runID)}/cancel`,
  rehearsalProof: (kind: DRRehearsalProofKind, runID: string) =>
    `${DR_API_BASE}/rehearsal-proofs/${kind}/${pathID(runID)}`,

  failbackRuns: `${DR_API_BASE}/failback-runs`,
  failbackRun: (runID: string) =>
    `${DR_API_BASE}/failback-runs/${pathID(runID)}`,
  failbackRunSteps: (runID: string) =>
    `${DR_API_BASE}/failback-runs/${pathID(runID)}/steps`,
  failbackApproveCutback: (runID: string) =>
    `${DR_API_BASE}/failback-runs/${pathID(runID)}/approve-cutback`,
  failbackAdvance: (runID: string) =>
    `${DR_API_BASE}/failback-runs/${pathID(runID)}/advance`,

  instantSession: (sessionID: string) =>
    `${DR_API_BASE}/instant-sessions/${pathID(sessionID)}`,
  instantSessionChunk: (sessionID: string, index: number) =>
    `${DR_API_BASE}/instant-sessions/${pathID(sessionID)}/chunks/${pathID(index)}`,
  instantSessionFinalize: (sessionID: string) =>
    `${DR_API_BASE}/instant-sessions/${pathID(sessionID)}/finalize`,

  bootRun: (runID: string) => `${DR_API_BASE}/boot-runs/${pathID(runID)}`,

  drillSchedules: `${DR_API_BASE}/drill-schedules`,
  drillScheduleNextRuns: (scheduleID: string) =>
    `${DR_API_BASE}/drill-schedules/${pathID(scheduleID)}/next-runs`,
  drillResultDiff: (resultID: string) =>
    `${DR_API_BASE}/drill-results/${pathID(resultID)}/diff`,

  gamedayScenarios: `${DR_API_BASE}/gameday/scenarios`,
  gamedayScenarioRuns: (scenarioID: string) =>
    `${DR_API_BASE}/gameday/scenarios/${pathID(scenarioID)}/runs`,
  gamedayRun: (runID: string) =>
    `${DR_API_BASE}/gameday/runs/${pathID(runID)}`,

  studioRunbooks: `${DR_API_BASE}/studio/runbooks`,
  studioRunbook: (runbookID: string) =>
    `${DR_API_BASE}/studio/runbooks/${pathID(runbookID)}`,
  studioRunbookTasks: (runbookID: string) =>
    `${DR_API_BASE}/studio/runbooks/${pathID(runbookID)}/tasks`,
  studioRunbookRuns: (runbookID: string) =>
    `${DR_API_BASE}/studio/runbooks/${pathID(runbookID)}/runs`,
  studioRun: (runID: string) =>
    `${DR_API_BASE}/studio/runs/${pathID(runID)}`,
  studioRunTaskAction: (runID: string, taskID: string, action: 'complete' | 'skip' | 'fail') =>
    `${DR_API_BASE}/studio/runs/${pathID(runID)}/tasks/${pathID(taskID)}:${action}`,

  recoveryTiers: `${DR_API_BASE}/recovery-tiers`,
  recoveryTier: (tier: string) =>
    `${DR_API_BASE}/recovery-tiers/${pathID(tier)}`,
  recoveryTierRecommend: `${DR_API_BASE}/recovery-tiers/recommend`,

  cyberVaults: `${DR_API_BASE}/cyber-vaults`,
  cyberVault: (vaultID: string) =>
    `${DR_API_BASE}/cyber-vaults/${pathID(vaultID)}`,
  cyberVaultEvaluate: (vaultID: string) =>
    `${DR_API_BASE}/cyber-vaults/${pathID(vaultID)}/evaluate`,
  cyberVaultAssessments: `${DR_API_BASE}/cyber-vaults/assessments`,
  cyberVaultLatestAssessment: (vaultID: string) =>
    `${DR_API_BASE}/cyber-vaults/${pathID(vaultID)}/assessments/latest`,

  predictions: `${DR_API_BASE}/predictions`,
  ransomwareSignals: `${DR_API_BASE}/ransomware/signals`,
  ransomwareStreamSignals: (streamID: string) =>
    `${DR_API_BASE}/ransomware/streams/${pathID(streamID)}/signals`,

  iacSnapshots: `${DR_API_BASE}/iac-snapshots`,
  iacSnapshot: (snapshotID: string) =>
    `${DR_API_BASE}/iac-snapshots/${pathID(snapshotID)}`,
  iacSnapshotDiff: (snapshotID: string) =>
    `${DR_API_BASE}/iac-snapshots/${pathID(snapshotID)}/diff`,
  iacSnapshotReconstitutionPlan: (snapshotID: string) =>
    `${DR_API_BASE}/iac-snapshots/${pathID(snapshotID)}/reconstitution-plan`,

  storageVolumes: `${DR_API_BASE}/storage-volumes`,
  storageVolume: (volumeID: string) =>
    `${DR_API_BASE}/storage-volumes/${pathID(volumeID)}`,
  storageVolumeSnapshots: (volumeID: string) =>
    `${DR_API_BASE}/storage-volumes/${pathID(volumeID)}/snapshots`,
  storageSnapshot: (snapshotID: string) =>
    `${DR_API_BASE}/storage-snapshots/${pathID(snapshotID)}`,
  storageSnapshotReplicate: (snapshotID: string) =>
    `${DR_API_BASE}/storage-snapshots/${pathID(snapshotID)}/replicate`,

  workloadCaptures: `${DR_API_BASE}/workload-captures`,
  workloadCaptureRun: (sourceID: string) =>
    `${DR_API_BASE}/workload-captures/${pathID(sourceID)}/run`,
  workloadCaptureEpochs: (sourceID: string) =>
    `${DR_API_BASE}/workload-captures/${pathID(sourceID)}/epochs`,

  copilotChat: `${DR_API_BASE}/copilot/chat`,
  copilotSession: (sessionID: string) =>
    `${DR_API_BASE}/copilot/sessions/${pathID(sessionID)}`,

  attestationLedger: `${DR_API_BASE}/attestation-ledger`,
  attestationLedgerVerify: `${DR_API_BASE}/attestation-ledger/verify`,
  attestationLedgerAnchor: `${DR_API_BASE}/attestation-ledger/anchor`,
  attestationLedgerProof: (seq: number) =>
    `${DR_API_BASE}/attestation-ledger/${pathID(seq)}/proof`,

  bcmPacks: `${DR_API_BASE}/bcm/packs`,
  bcmPack: (key: string) => `${DR_API_BASE}/bcm/packs/${pathID(key)}`,
  bcmPackAssess: (key: string) =>
    `${DR_API_BASE}/bcm/packs/${pathID(key)}/assess`,
  bcmAssessment: (assessmentID: string) =>
    `${DR_API_BASE}/bcm/assessments/${pathID(assessmentID)}`,

  byokKeys: `${DR_API_BASE}/byok/keys`,
  byokKeyRotate: `${DR_API_BASE}/byok/keys/rotate`,
  byokCustodyLog: `${DR_API_BASE}/byok/keys/custody-log`,

  assuranceControls: `${DR_API_BASE}/assurance/controls`,
  assuranceGroupEvaluate: (groupID: string) =>
    `${DR_API_BASE}/assurance/groups/${pathID(groupID)}/evaluate`,
  assuranceGroupLatest: (groupID: string) =>
    `${DR_API_BASE}/assurance/groups/${pathID(groupID)}/latest`,
  assuranceAssessment: (assessmentID: string) =>
    `${DR_API_BASE}/assurance/assessments/${pathID(assessmentID)}`,

  selfDRComponents: `${DR_API_BASE}/selfdr/components`,
  selfDRAssess: `${DR_API_BASE}/selfdr/assess`,
  selfDRLatestAssessment: `${DR_API_BASE}/selfdr/assessments/latest`,
  selfDRAssessment: (assessmentID: string) =>
    `${DR_API_BASE}/selfdr/assessments/${pathID(assessmentID)}`,
  selfDRArtifacts: `${DR_API_BASE}/selfdr/artifacts`,
  selfDRBackups: `${DR_API_BASE}/selfdr/backups`,
  selfDROfflineBundle: `${DR_API_BASE}/selfdr/offline-bundle`,

  integrations: `${DR_API_BASE}/integrations`,
  integration: (integrationID: string) =>
    `${DR_API_BASE}/integrations/${pathID(integrationID)}`,
  integrationTest: (integrationID: string) =>
    `${DR_API_BASE}/integrations/${pathID(integrationID)}/test`,
} as const;

type DRQueryParams = Record<string, string | number | boolean | null | undefined>;

function withQuery(url: string, params?: DRQueryParams): string {
  if (!params) {
    return url;
  }
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      search.append(key, String(value));
    }
  }
  const query = search.toString();
  return query ? `${url}?${query}` : url;
}

async function fetchDRData<T>(
  url: string,
  params?: Record<string, unknown> | object,
): Promise<T> {
  const envelope = await apiGet<DataEnvelope<T>>(url, params);
  return envelope.data;
}

async function postDRData<T>(url: string, data?: unknown): Promise<T> {
  const envelope = await apiPost<DataEnvelope<T>>(url, data);
  return envelope.data;
}

async function putDRData<T>(url: string, data?: unknown): Promise<T> {
  const envelope = await apiPut<DataEnvelope<T>>(url, data);
  return envelope.data;
}

async function postDRNoContent(url: string, data?: unknown): Promise<void> {
  await apiPost<void>(url, data);
}

async function deleteDRNoContent(url: string): Promise<void> {
  await apiDelete<void>(url);
}

export function fetchDRPosture(): Promise<DRPosture> {
  return fetchDRData<DRPosture>(CLARIO_DR_ENDPOINTS.posture);
}

export function fetchDRReplicationSummary(): Promise<DRReplicationSummary> {
  return fetchDRData<DRReplicationSummary>(CLARIO_DR_ENDPOINTS.replicationSummary);
}

export function fetchDRSites(): Promise<DRProtectedSite[]> {
  return fetchDRData<DRProtectedSite[]>(CLARIO_DR_ENDPOINTS.sites);
}

export function fetchDRSite(siteID: string): Promise<DRProtectedSite> {
  return fetchDRData<DRProtectedSite>(CLARIO_DR_ENDPOINTS.site(siteID));
}

export function createDRSite(payload: DRCreateSiteRequest): Promise<DRProtectedSite> {
  return postDRData<DRProtectedSite>(CLARIO_DR_ENDPOINTS.sites, payload);
}

export function fetchDRGroupSummary(groupID: string): Promise<DRGroupSummary> {
  return fetchDRData<DRGroupSummary>(CLARIO_DR_ENDPOINTS.groupSummary(groupID));
}

export function fetchDRGroups(): Promise<DRConsistencyGroup[]> {
  return fetchDRData<DRConsistencyGroup[]>(CLARIO_DR_ENDPOINTS.groups);
}

export function fetchDRGroup(groupID: string): Promise<DRConsistencyGroup> {
  return fetchDRData<DRConsistencyGroup>(CLARIO_DR_ENDPOINTS.group(groupID));
}

export function createDRGroup(
  payload: DRCreateGroupRequest,
): Promise<DRConsistencyGroup> {
  return postDRData<DRConsistencyGroup>(CLARIO_DR_ENDPOINTS.groups, payload);
}

export function fetchDRGroupMembers(
  groupID: string,
): Promise<DRConsistencyGroupMember[]> {
  return fetchDRData<DRConsistencyGroupMember[]>(
    CLARIO_DR_ENDPOINTS.groupMembers(groupID),
  );
}

export function addDRGroupMember(
  groupID: string,
  payload: DRAddGroupMemberRequest,
): Promise<DRConsistencyGroupMember> {
  return postDRData<DRConsistencyGroupMember>(
    CLARIO_DR_ENDPOINTS.groupMembers(groupID),
    payload,
  );
}

export function fetchDRGroupRecoveryPoints(
  groupID: string,
): Promise<DRRecoveryPoint[]> {
  return fetchDRData<DRRecoveryPoint[]>(
    CLARIO_DR_ENDPOINTS.groupRecoveryPoints(groupID),
  );
}

export function sealDRRecoveryPoint(
  groupID: string,
  payload?: DRSealRecoveryPointRequest,
): Promise<DRRecoveryPoint> {
  return postDRData<DRRecoveryPoint>(
    CLARIO_DR_ENDPOINTS.groupRecoveryPoints(groupID),
    payload,
  );
}

export function materializeDRJournalRecoveryPoint(
  groupID: string,
  payload: DRMaterializeJournalRecoveryPointRequest,
): Promise<DRRecoveryPoint> {
  return postDRData<DRRecoveryPoint>(
    CLARIO_DR_ENDPOINTS.groupJournalMaterialize(groupID),
    payload,
  );
}

export function fetchDRGroupNetworkMappings(
  groupID: string,
): Promise<DRNetworkMapping[]> {
  return fetchDRData<DRNetworkMapping[]>(
    CLARIO_DR_ENDPOINTS.groupNetworkMappings(groupID),
  );
}

export function createDRNetworkMapping(
  groupID: string,
  payload: DRCreateNetworkMappingRequest,
): Promise<DRNetworkMapping> {
  return postDRData<DRNetworkMapping>(
    CLARIO_DR_ENDPOINTS.groupNetworkMappings(groupID),
    payload,
  );
}

export function fetchDRStreams(): Promise<DRReplicationStream[]> {
  return fetchDRData<DRReplicationStream[]>(CLARIO_DR_ENDPOINTS.streams);
}

export function fetchDRStream(streamID: string): Promise<DRReplicationStream> {
  return fetchDRData<DRReplicationStream>(CLARIO_DR_ENDPOINTS.stream(streamID));
}

export function createDRStream(
  payload: DRCreateStreamRequest,
): Promise<DRReplicationStream> {
  return postDRData<DRReplicationStream>(CLARIO_DR_ENDPOINTS.streams, payload);
}

export function fetchDRStreamRPO(streamID: string): Promise<DRStreamRPO> {
  return fetchDRData<DRStreamRPO>(CLARIO_DR_ENDPOINTS.streamRPO(streamID));
}

export function pauseDRStream(streamID: string): Promise<void> {
  return postDRNoContent(CLARIO_DR_ENDPOINTS.streamPause(streamID));
}

export function resumeDRStream(streamID: string): Promise<void> {
  return postDRNoContent(CLARIO_DR_ENDPOINTS.streamResume(streamID));
}

export function fetchDRJournalTimeline(streamID: string): Promise<DRJournalTimeline> {
  return fetchDRData<DRJournalTimeline>(
    CLARIO_DR_ENDPOINTS.streamJournalTimeline(streamID),
  );
}

export function resolveDRJournal(
  streamID: string,
  target: DRJournalResolveRequest,
): Promise<DRJournalResolution> {
  return fetchDRData<DRJournalResolution>(
    CLARIO_DR_ENDPOINTS.streamJournalResolve(streamID),
    target,
  );
}

export function fetchDRJournalBookmarks(
  streamID: string,
): Promise<DRJournalBookmark[]> {
  return fetchDRData<DRJournalBookmark[]>(
    CLARIO_DR_ENDPOINTS.streamJournalBookmarks(streamID),
  );
}

export function createDRJournalBookmark(
  streamID: string,
  payload: DRCreateJournalBookmarkRequest,
): Promise<DRJournalBookmark> {
  return postDRData<DRJournalBookmark>(
    CLARIO_DR_ENDPOINTS.streamJournalBookmarks(streamID),
    payload,
  );
}

export function deleteDRJournalBookmark(
  streamID: string,
  bookmarkID: string,
): Promise<void> {
  return deleteDRNoContent(
    CLARIO_DR_ENDPOINTS.streamJournalBookmark(streamID, bookmarkID),
  );
}

export function fetchDRRecoveryPoint(
  recoveryPointID: string,
): Promise<DRRecoveryPoint> {
  return fetchDRData<DRRecoveryPoint>(
    CLARIO_DR_ENDPOINTS.recoveryPoint(recoveryPointID),
  );
}

export function validateDRRecoveryPoint(
  recoveryPointID: string,
): Promise<DRRecoveryPoint> {
  return postDRData<DRRecoveryPoint>(
    CLARIO_DR_ENDPOINTS.recoveryPointValidate(recoveryPointID),
  );
}

export function startDRInstantRecovery(
  recoveryPointID: string,
  groupID?: string,
): Promise<DRInstantRecoverySession> {
  return postDRData<DRInstantRecoverySession>(
    CLARIO_DR_ENDPOINTS.recoveryPointInstantRecovery(recoveryPointID),
    groupID ? { group_id: groupID } : undefined,
  );
}

export function fetchDRInstantRecoveryProgress(
  sessionID: string,
): Promise<DRInstantRecoveryProgress> {
  return fetchDRData<DRInstantRecoveryProgress>(
    CLARIO_DR_ENDPOINTS.instantSession(sessionID),
  );
}

export function finalizeDRInstantRecovery(
  sessionID: string,
): Promise<DRInstantRecoverySession> {
  return postDRData<DRInstantRecoverySession>(
    CLARIO_DR_ENDPOINTS.instantSessionFinalize(sessionID),
  );
}

export function fetchDRAgents(): Promise<DRAgent[]> {
  return fetchDRData<DRAgent[]>(CLARIO_DR_ENDPOINTS.agents);
}

export function fetchDRAgent(agentID: string): Promise<DRAgent> {
  return fetchDRData<DRAgent>(CLARIO_DR_ENDPOINTS.agent(agentID));
}

export function createDRAgent(payload: DRCreateAgentRequest): Promise<DRAgent> {
  return postDRData<DRAgent>(CLARIO_DR_ENDPOINTS.agents, payload);
}

export function mintDRAgentEnrollmentToken(
  agentID: string,
  payload?: DRAgentEnrollmentTokenRequest,
): Promise<DRAgentEnrollmentToken> {
  return postDRData<DRAgentEnrollmentToken>(
    CLARIO_DR_ENDPOINTS.agentEnrollmentToken(agentID),
    payload,
  );
}

export function enrollDRAgent(
  payload: DRAgentEnrollRequest,
): Promise<DRAgentEnrollResponse> {
  return postDRData<DRAgentEnrollResponse>(CLARIO_DR_ENDPOINTS.agentEnroll, payload);
}

export function fetchDRFailoverRuns(): Promise<DRFailoverRun[]> {
  return fetchDRData<DRFailoverRun[]>(CLARIO_DR_ENDPOINTS.failoverRuns);
}

export function fetchDRFailoverRun(runID: string): Promise<DRFailoverRun> {
  return fetchDRData<DRFailoverRun>(CLARIO_DR_ENDPOINTS.failoverRun(runID));
}

export function createDRFailoverRun(
  payload: DRCreateFailoverRunRequest,
): Promise<DRFailoverRun> {
  return postDRData<DRFailoverRun>(CLARIO_DR_ENDPOINTS.failoverRuns, payload);
}

export function approveDRFailoverRun(
  runID: string,
  payload?: DRApprovalDecisionRequest,
): Promise<DRFailoverRun> {
  return postDRData<DRFailoverRun>(CLARIO_DR_ENDPOINTS.failoverRunApprove(runID), payload);
}

export function cancelDRFailoverRun(runID: string): Promise<DRFailoverRun> {
  return postDRData<DRFailoverRun>(CLARIO_DR_ENDPOINTS.failoverRunCancel(runID));
}

export function fetchDRFailoverSteps(runID: string): Promise<DRFailoverStep[]> {
  return fetchDRData<DRFailoverStep[]>(
    CLARIO_DR_ENDPOINTS.failoverRunSteps(runID),
  );
}

export function fetchDRFailoverAttestation(runID: string): Promise<DRAttestation> {
  return fetchDRData<DRAttestation>(
    CLARIO_DR_ENDPOINTS.failoverRunAttestation(runID),
  );
}

export function fetchDRRehearsalProof(
  kind: DRRehearsalProofKind,
  runID: string,
): Promise<DRRehearsalProof> {
  return fetchDRData<DRRehearsalProof>(
    CLARIO_DR_ENDPOINTS.rehearsalProof(kind, runID),
  );
}

export function fetchDRFailbackRuns(): Promise<DRFailbackRun[]> {
  return fetchDRData<DRFailbackRun[]>(CLARIO_DR_ENDPOINTS.failbackRuns);
}

export function fetchDRFailbackRun(runID: string): Promise<DRFailbackRun> {
  return fetchDRData<DRFailbackRun>(CLARIO_DR_ENDPOINTS.failbackRun(runID));
}

export function fetchDRFailbackSteps(runID: string): Promise<DRFailbackStep[]> {
  return fetchDRData<DRFailbackStep[]>(
    CLARIO_DR_ENDPOINTS.failbackRunSteps(runID),
  );
}

export function planDRFailback(
  payload: DRCreateFailbackRunRequest,
): Promise<DRFailbackRun> {
  return postDRData<DRFailbackRun>(CLARIO_DR_ENDPOINTS.failbackRuns, payload);
}

export function approveDRFailbackCutback(
  runID: string,
  payload?: DRApprovalDecisionRequest,
): Promise<DRFailbackRun> {
  return postDRData<DRFailbackRun>(
    CLARIO_DR_ENDPOINTS.failbackApproveCutback(runID),
    payload,
  );
}

export function advanceDRFailback(runID: string): Promise<DRFailbackRun> {
  return postDRData<DRFailbackRun>(CLARIO_DR_ENDPOINTS.failbackAdvance(runID));
}

export function fetchDRConsistencyBarriers(
  groupID: string,
): Promise<DRConsistencyBarrier[]> {
  return fetchDRData<DRConsistencyBarrier[]>(
    CLARIO_DR_ENDPOINTS.groupConsistencyBarriers(groupID),
  );
}

export function triggerDRAppConsistentPoint(
  groupID: string,
  payload?: DRTriggerConsistencyPointRequest,
): Promise<DRConsistencyBarrier> {
  return postDRData<DRConsistencyBarrier>(
    CLARIO_DR_ENDPOINTS.groupAppConsistentPoint(groupID),
    payload,
  );
}

export function fetchDRTopology(groupID: string): Promise<DRTopology> {
  return fetchDRData<DRTopology>(CLARIO_DR_ENDPOINTS.groupTopology(groupID));
}

export function addDRTopologyEdge(
  groupID: string,
  payload: DRTopologyAddEdgeRequest,
): Promise<DRTopology> {
  return postDRData<DRTopology>(
    CLARIO_DR_ENDPOINTS.groupTopologyEdges(groupID),
    payload,
  );
}

export function fetchDRTopologyFailoverTarget(
  groupID: string,
): Promise<DRTopologyFailoverSelection> {
  return fetchDRData<DRTopologyFailoverSelection>(
    CLARIO_DR_ENDPOINTS.groupTopologyFailoverTarget(groupID),
  );
}

export function fetchDRBootPlan(groupID: string): Promise<DRBootPlan> {
  return fetchDRData<DRBootPlan>(CLARIO_DR_ENDPOINTS.groupBootPlan(groupID));
}

export function defineDRBootServices(
  groupID: string,
  payload: DRCreateBootServicesRequest,
): Promise<DRBootPlan> {
  return postDRData<DRBootPlan>(
    CLARIO_DR_ENDPOINTS.groupBootServices(groupID),
    payload,
  );
}

export function startDRBootRun(
  groupID: string,
  policy?: string,
): Promise<DRBootRunDetail> {
  return postDRData<DRBootRunDetail>(
    CLARIO_DR_ENDPOINTS.groupBootRuns(groupID),
    policy ? { policy } : undefined,
  );
}

export function fetchDRBootRun(runID: string): Promise<DRBootRunDetail> {
  return fetchDRData<DRBootRunDetail>(CLARIO_DR_ENDPOINTS.bootRun(runID));
}

export function fetchDRDrillSchedules(): Promise<DRDrillSchedule[]> {
  return fetchDRData<DRDrillSchedule[]>(CLARIO_DR_ENDPOINTS.drillSchedules);
}

export function createDRDrillSchedule(
  payload: DRCreateDrillScheduleRequest,
): Promise<DRDrillSchedule> {
  return postDRData<DRDrillSchedule>(CLARIO_DR_ENDPOINTS.drillSchedules, payload);
}

export function fetchDRDrillScheduleNextRuns(
  scheduleID: string,
  count?: number,
): Promise<DRDrillNextRunsResponse> {
  return fetchDRData<DRDrillNextRunsResponse>(
    CLARIO_DR_ENDPOINTS.drillScheduleNextRuns(scheduleID),
    count ? { n: count } : undefined,
  );
}

export function fetchDRGroupDrillResults(
  groupID: string,
): Promise<DRDrillResult[]> {
  return fetchDRData<DRDrillResult[]>(
    CLARIO_DR_ENDPOINTS.groupDrillResults(groupID),
  );
}

export function fetchDRDrillDiff(resultID: string): Promise<DRDrillDiff> {
  return fetchDRData<DRDrillDiff>(CLARIO_DR_ENDPOINTS.drillResultDiff(resultID));
}

export function fetchDRGameDayScenarios(): Promise<DRGameDayScenario[]> {
  return fetchDRData<DRGameDayScenario[]>(CLARIO_DR_ENDPOINTS.gamedayScenarios);
}

export function createDRGameDayScenario(
  payload: DRCreateGameDayScenarioRequest,
): Promise<DRGameDayScenario> {
  return postDRData<DRGameDayScenario>(
    CLARIO_DR_ENDPOINTS.gamedayScenarios,
    payload,
  );
}

export function runDRGameDayScenario(
  scenarioID: string,
): Promise<DRGameDayScorecard> {
  return postDRData<DRGameDayScorecard>(
    CLARIO_DR_ENDPOINTS.gamedayScenarioRuns(scenarioID),
  );
}

export function fetchDRGameDayScorecard(
  runID: string,
): Promise<DRGameDayScorecard> {
  return fetchDRData<DRGameDayScorecard>(CLARIO_DR_ENDPOINTS.gamedayRun(runID));
}

export function createDRRunbook(
  payload: DRCreateRunbookRequest,
): Promise<{ runbook: DRRunbookPlan['runbook']; tasks: DRRunbookTask[] }> {
  return postDRData<{ runbook: DRRunbookPlan['runbook']; tasks: DRRunbookTask[] }>(
    CLARIO_DR_ENDPOINTS.studioRunbooks,
    payload,
  );
}

export function fetchDRRunbook(runbookID: string): Promise<DRRunbookPlan> {
  return fetchDRData<DRRunbookPlan>(CLARIO_DR_ENDPOINTS.studioRunbook(runbookID));
}

export function updateDRRunbook(
  runbookID: string,
  payload: DRRunbookUpdateRequest,
): Promise<DRRunbookPlan['runbook']> {
  return putDRData<DRRunbookPlan['runbook']>(
    CLARIO_DR_ENDPOINTS.studioRunbook(runbookID),
    payload,
  );
}

export function addDRRunbookTask(
  runbookID: string,
  payload: DRRunbookAddTaskRequest,
): Promise<DRRunbookTask> {
  return postDRData<DRRunbookTask>(
    CLARIO_DR_ENDPOINTS.studioRunbookTasks(runbookID),
    payload,
  );
}

export function startDRRunbookRun(
  runbookID: string,
  payload?: DRRunbookStartRunRequest,
): Promise<DRRunbookLiveState> {
  return postDRData<DRRunbookLiveState>(
    CLARIO_DR_ENDPOINTS.studioRunbookRuns(runbookID),
    payload,
  );
}

export function fetchDRRunbookRun(runID: string): Promise<DRRunbookLiveState> {
  return fetchDRData<DRRunbookLiveState>(CLARIO_DR_ENDPOINTS.studioRun(runID));
}

export function actOnDRRunbookTask(
  runID: string,
  taskID: string,
  action: 'complete' | 'skip' | 'fail',
  payload?: DRRunbookActionRequest,
): Promise<DRRunbookLiveState> {
  return postDRData<DRRunbookLiveState>(
    CLARIO_DR_ENDPOINTS.studioRunTaskAction(runID, taskID, action),
    payload,
  );
}

export function fetchDRRecoveryTiers(): Promise<DRRecoveryTierProfile[]> {
  return fetchDRData<DRRecoveryTierProfile[]>(CLARIO_DR_ENDPOINTS.recoveryTiers);
}

export function fetchDRRecoveryTier(tier: string): Promise<DRRecoveryTierProfile> {
  return fetchDRData<DRRecoveryTierProfile>(CLARIO_DR_ENDPOINTS.recoveryTier(tier));
}

export function recommendDRRecoveryTier(
  payload: DRRecoveryTierRecommendationRequest,
): Promise<DRRecoveryTierProfile> {
  return postDRData<DRRecoveryTierProfile>(
    CLARIO_DR_ENDPOINTS.recoveryTierRecommend,
    payload,
  );
}

export function fetchDRCyberVaults(
  groupID: string,
): Promise<DRCyberVaultListResponse> {
  return fetchDRData<DRCyberVaultListResponse>(CLARIO_DR_ENDPOINTS.cyberVaults, {
    group: groupID,
  });
}

export function upsertDRCyberVault(
  groupID: string,
  posture: DRCyberVaultPosture | { posture: DRCyberVaultPosture },
): Promise<DRCyberVault> {
  return postDRData<DRCyberVault>(
    withQuery(CLARIO_DR_ENDPOINTS.cyberVaults, { group: groupID }),
    posture,
  );
}

export function updateDRCyberVault(
  vaultID: string,
  groupID: string,
  posture: DRCyberVaultPosture | { posture: DRCyberVaultPosture },
): Promise<DRCyberVault> {
  return putDRData<DRCyberVault>(
    withQuery(CLARIO_DR_ENDPOINTS.cyberVault(vaultID), { group: groupID }),
    posture,
  );
}

export function evaluateDRCyberVault(
  vaultID: string,
  groupID: string,
): Promise<DRCyberVaultStoredPostureAssessment> {
  return postDRData<DRCyberVaultStoredPostureAssessment>(
    withQuery(CLARIO_DR_ENDPOINTS.cyberVaultEvaluate(vaultID), { group: groupID }),
  );
}

export function fetchDRCyberVaultAssessments(
  groupID: string,
): Promise<DRCyberVaultAssessmentListResponse> {
  return fetchDRData<DRCyberVaultAssessmentListResponse>(
    CLARIO_DR_ENDPOINTS.cyberVaultAssessments,
    { group: groupID },
  );
}

export function fetchDRCyberVaultLatestAssessment(
  vaultID: string,
): Promise<DRCyberVaultStoredPostureAssessment> {
  return fetchDRData<DRCyberVaultStoredPostureAssessment>(
    CLARIO_DR_ENDPOINTS.cyberVaultLatestAssessment(vaultID),
  );
}

export function fetchDRAttestationLedger(
  filters?: DRAttestationLedgerFilters,
): Promise<DRAttestationLedgerEntry[]> {
  return fetchDRData<DRAttestationLedgerEntry[]>(
    CLARIO_DR_ENDPOINTS.attestationLedger,
    filters,
  );
}

export function verifyDRAttestationLedger(): Promise<DRAttestationLedgerVerifyResult> {
  return fetchDRData<DRAttestationLedgerVerifyResult>(
    CLARIO_DR_ENDPOINTS.attestationLedgerVerify,
  );
}

export function anchorDRAttestationLedger(): Promise<DRAttestationLedgerCheckpoint> {
  return postDRData<DRAttestationLedgerCheckpoint>(
    CLARIO_DR_ENDPOINTS.attestationLedgerAnchor,
  );
}

export function fetchDRAttestationLedgerProof(
  seq: number,
): Promise<DRAttestationLedgerInclusionProof> {
  return fetchDRData<DRAttestationLedgerInclusionProof>(
    CLARIO_DR_ENDPOINTS.attestationLedgerProof(seq),
  );
}

export function fetchDRBCMPacks(): Promise<DRBCMPack[]> {
  return fetchDRData<DRBCMPack[]>(CLARIO_DR_ENDPOINTS.bcmPacks);
}

export function fetchDRBCMPack(key: string): Promise<DRBCMPack> {
  return fetchDRData<DRBCMPack>(CLARIO_DR_ENDPOINTS.bcmPack(key));
}

export function assessDRBCMPack(
  key: string,
  groupID: string,
): Promise<DRBCMAssessmentRunResponse> {
  return postDRData<DRBCMAssessmentRunResponse>(
    withQuery(CLARIO_DR_ENDPOINTS.bcmPackAssess(key), { group: groupID }),
  );
}

export function fetchDRBCMAssessment(
  assessmentID: string,
): Promise<DRBCMAssessmentReport> {
  return fetchDRData<DRBCMAssessmentReport>(
    CLARIO_DR_ENDPOINTS.bcmAssessment(assessmentID),
  );
}

export function fetchDRBYOKKeys(): Promise<DRBYOKKey[]> {
  return fetchDRData<DRBYOKKey[]>(CLARIO_DR_ENDPOINTS.byokKeys);
}

export function enrollDRBYOKKey(payload: DRBYOKEnrollRequest): Promise<DRBYOKKey> {
  return postDRData<DRBYOKKey>(CLARIO_DR_ENDPOINTS.byokKeys, payload);
}

export function rotateDRBYOKKey(): Promise<DRBYOKKey> {
  return postDRData<DRBYOKKey>(CLARIO_DR_ENDPOINTS.byokKeyRotate);
}

export function fetchDRBYOKCustodyLog(): Promise<DRBYOKCustodyLog> {
  return fetchDRData<DRBYOKCustodyLog>(CLARIO_DR_ENDPOINTS.byokCustodyLog);
}

export function fetchDRAssuranceControls(): Promise<DRAssuranceControlInfo[]> {
  return fetchDRData<DRAssuranceControlInfo[]>(
    CLARIO_DR_ENDPOINTS.assuranceControls,
  );
}

export function evaluateDRAssuranceGroup(
  groupID: string,
): Promise<DRAssuranceEvaluateResponse> {
  return postDRData<DRAssuranceEvaluateResponse>(
    CLARIO_DR_ENDPOINTS.assuranceGroupEvaluate(groupID),
  );
}

export function fetchDRAssuranceLatest(
  groupID: string,
): Promise<DRAssuranceAssessmentReport> {
  return fetchDRData<DRAssuranceAssessmentReport>(
    CLARIO_DR_ENDPOINTS.assuranceGroupLatest(groupID),
  );
}

export function fetchDRAssuranceAssessment(
  assessmentID: string,
): Promise<DRAssuranceAssessmentReport> {
  return fetchDRData<DRAssuranceAssessmentReport>(
    CLARIO_DR_ENDPOINTS.assuranceAssessment(assessmentID),
  );
}

export function fetchDRPredictions(): Promise<DRPrediction[]> {
  return fetchDRData<DRPrediction[]>(CLARIO_DR_ENDPOINTS.predictions);
}

export function fetchDRStreamForecast(
  streamID: string,
): Promise<DRStreamForecast> {
  return fetchDRData<DRStreamForecast>(
    CLARIO_DR_ENDPOINTS.streamForecast(streamID),
  );
}

export function fetchDRRegistryRunbook(
  groupID: string,
  profile?: DRRegistryRunbookProfile,
): Promise<DRRegistryRunbookVersion> {
  return fetchDRData<DRRegistryRunbookVersion>(
    CLARIO_DR_ENDPOINTS.groupRegistryRunbook(groupID),
    profile ? { profile } : undefined,
  );
}

export function fetchDRRegistryRunbookVersions(
  groupID: string,
): Promise<DRRegistryRunbookVersion[]> {
  return fetchDRData<DRRegistryRunbookVersion[]>(
    CLARIO_DR_ENDPOINTS.groupRegistryRunbookVersions(groupID),
  );
}

export function regenerateDRRegistryRunbook(
  groupID: string,
  profile?: DRRegistryRunbookProfile,
): Promise<DRRegistryRegenerateResult> {
  return postDRData<DRRegistryRegenerateResult>(
    withQuery(CLARIO_DR_ENDPOINTS.groupRegistryRunbookRegenerate(groupID), {
      profile,
    }),
  );
}

export function fetchDRRansomwareSignals(
  filters?: DRRansomwareSignalFilters,
): Promise<DRRansomwareSignal[]> {
  return fetchDRData<DRRansomwareSignal[]>(
    CLARIO_DR_ENDPOINTS.ransomwareSignals,
    filters,
  );
}

export function fetchDRRansomwareStreamSignals(
  streamID: string,
  limit?: number,
): Promise<DRRansomwareSignal[]> {
  return fetchDRData<DRRansomwareSignal[]>(
    CLARIO_DR_ENDPOINTS.ransomwareStreamSignals(streamID),
    limit ? { limit } : undefined,
  );
}

export function fetchDRCleanRoomScan(
  recoveryPointID: string,
): Promise<DRCleanRoomScan> {
  return fetchDRData<DRCleanRoomScan>(
    CLARIO_DR_ENDPOINTS.recoveryPointCleanRoom(recoveryPointID),
  );
}

export function runDRCleanRoomScan(
  recoveryPointID: string,
): Promise<DRCleanRoomScan> {
  return postDRData<DRCleanRoomScan>(
    CLARIO_DR_ENDPOINTS.recoveryPointCleanRoomScan(recoveryPointID),
  );
}

export function chatDRCopilot(
  payload: DRCopilotChatRequest,
): Promise<DRCopilotChatResult> {
  return postDRData<DRCopilotChatResult>(
    CLARIO_DR_ENDPOINTS.copilotChat,
    payload,
  );
}

export function fetchDRCopilotSessionTranscript(
  sessionID: string,
): Promise<DRCopilotSessionTranscript> {
  return fetchDRData<DRCopilotSessionTranscript>(
    CLARIO_DR_ENDPOINTS.copilotSession(sessionID),
  );
}

export function fetchDRIaCSnapshots(): Promise<DRIaCSnapshotList> {
  return fetchDRData<DRIaCSnapshotList>(CLARIO_DR_ENDPOINTS.iacSnapshots);
}

export function ingestDRIaCSnapshot(
  payload: DRIaCIngestSnapshotRequest,
): Promise<DRIaCSnapshot> {
  return postDRData<DRIaCSnapshot>(CLARIO_DR_ENDPOINTS.iacSnapshots, payload);
}

export function fetchDRIaCSnapshot(
  snapshotID: string,
): Promise<DRIaCSnapshot> {
  return fetchDRData<DRIaCSnapshot>(CLARIO_DR_ENDPOINTS.iacSnapshot(snapshotID));
}

export function fetchDRIaCSnapshotDiff(
  snapshotID: string,
  againstSnapshotID: string,
): Promise<DRIaCDiff> {
  return fetchDRData<DRIaCDiff>(
    CLARIO_DR_ENDPOINTS.iacSnapshotDiff(snapshotID),
    { against: againstSnapshotID },
  );
}

export function fetchDRIaCReconstitutionPlan(
  snapshotID: string,
): Promise<DRIaCReconstitutionPlan> {
  return fetchDRData<DRIaCReconstitutionPlan>(
    CLARIO_DR_ENDPOINTS.iacSnapshotReconstitutionPlan(snapshotID),
  );
}

export function fetchDRStorageVolumes(): Promise<DRStorageVolume[]> {
  return fetchDRData<DRStorageVolume[]>(CLARIO_DR_ENDPOINTS.storageVolumes);
}

export function registerDRStorageVolume(
  payload: DRRegisterStorageVolumeRequest,
): Promise<DRStorageVolume> {
  return postDRData<DRStorageVolume>(CLARIO_DR_ENDPOINTS.storageVolumes, payload);
}

export function fetchDRStorageVolume(
  volumeID: string,
): Promise<DRStorageVolume> {
  return fetchDRData<DRStorageVolume>(
    CLARIO_DR_ENDPOINTS.storageVolume(volumeID),
  );
}

export function fetchDRStorageVolumeSnapshots(
  volumeID: string,
): Promise<DRStorageSnapshot[]> {
  return fetchDRData<DRStorageSnapshot[]>(
    CLARIO_DR_ENDPOINTS.storageVolumeSnapshots(volumeID),
  );
}

export function requestDRStorageSnapshot(
  volumeID: string,
): Promise<DRStorageSnapshot> {
  return postDRData<DRStorageSnapshot>(
    CLARIO_DR_ENDPOINTS.storageVolumeSnapshots(volumeID),
  );
}

export function fetchDRStorageSnapshot(
  snapshotID: string,
): Promise<DRStorageSnapshot> {
  return fetchDRData<DRStorageSnapshot>(
    CLARIO_DR_ENDPOINTS.storageSnapshot(snapshotID),
  );
}

export function replicateDRStorageSnapshot(
  snapshotID: string,
  payload: DRReplicateStorageSnapshotRequest,
): Promise<DRStorageSnapshot> {
  return postDRData<DRStorageSnapshot>(
    CLARIO_DR_ENDPOINTS.storageSnapshotReplicate(snapshotID),
    payload,
  );
}

export function fetchDRWorkloadCaptures(): Promise<DRWorkloadCaptureSource[]> {
  return fetchDRData<DRWorkloadCaptureSource[]>(
    CLARIO_DR_ENDPOINTS.workloadCaptures,
  );
}

export function registerDRWorkloadCapture(
  payload: DRRegisterWorkloadCaptureRequest,
): Promise<DRWorkloadCaptureSource> {
  return postDRData<DRWorkloadCaptureSource>(
    CLARIO_DR_ENDPOINTS.workloadCaptures,
    payload,
  );
}

export function runDRWorkloadCapture(
  sourceID: string,
): Promise<DRWorkloadCaptureEpoch> {
  return postDRData<DRWorkloadCaptureEpoch>(
    CLARIO_DR_ENDPOINTS.workloadCaptureRun(sourceID),
  );
}

export function fetchDRWorkloadCaptureEpochs(
  sourceID: string,
): Promise<DRWorkloadCaptureEpoch[]> {
  return fetchDRData<DRWorkloadCaptureEpoch[]>(
    CLARIO_DR_ENDPOINTS.workloadCaptureEpochs(sourceID),
  );
}

export function fetchDRSelfDRComponents(): Promise<DRSelfDRComponentsResponse> {
  return fetchDRData<DRSelfDRComponentsResponse>(
    CLARIO_DR_ENDPOINTS.selfDRComponents,
  );
}

export function assessDRSelfDR(
  profile?: DRSelfDRProfile,
): Promise<DRSelfDRAssessResponse> {
  return postDRData<DRSelfDRAssessResponse>(
    CLARIO_DR_ENDPOINTS.selfDRAssess,
    profile,
  );
}

export function fetchDRSelfDRLatestAssessment(): Promise<DRSelfDRAssessmentReport> {
  return fetchDRData<DRSelfDRAssessmentReport>(
    CLARIO_DR_ENDPOINTS.selfDRLatestAssessment,
  );
}

export function fetchDRSelfDRAssessment(
  assessmentID: string,
): Promise<DRSelfDRAssessmentReport> {
  return fetchDRData<DRSelfDRAssessmentReport>(
    CLARIO_DR_ENDPOINTS.selfDRAssessment(assessmentID),
  );
}

export function fetchDRSelfDRArtifacts(
  limit?: number,
): Promise<DRSelfDRStoredArtifact[]> {
  return fetchDRData<DRSelfDRStoredArtifact[]>(
    CLARIO_DR_ENDPOINTS.selfDRArtifacts,
    limit ? { limit } : undefined,
  );
}

export function captureDRSelfDRBackup(
  payload: DRSelfDRBackupRequest,
): Promise<DRSelfDRStoredArtifact> {
  return postDRData<DRSelfDRStoredArtifact>(
    CLARIO_DR_ENDPOINTS.selfDRBackups,
    payload,
  );
}

export function generateDRSelfDROfflineBundle(
  payload?: DRSelfDROfflineBundleRequest,
): Promise<DRSelfDRStoredArtifact> {
  return postDRData<DRSelfDRStoredArtifact>(
    CLARIO_DR_ENDPOINTS.selfDROfflineBundle,
    payload,
  );
}

export function materializeDRRecoveryPointFromJournal(
  groupID: string,
  target: DRJournalTargetRequest,
  retentionUntil: string,
): Promise<DRRecoveryPoint> {
  return materializeDRJournalRecoveryPoint(groupID, {
    ...target,
    retention_until: retentionUntil,
  });
}

// ---------------------------------------------------------------------------
// External recovery integrations (hypervisor / storage-array / cloud-vault /
// kubernetes connectors). Credentials submitted on create/update are write-only
// and never returned in the DRIntegration response.
// ---------------------------------------------------------------------------

export function fetchDRIntegrations(): Promise<DRIntegration[]> {
  return fetchDRData<DRIntegration[]>(CLARIO_DR_ENDPOINTS.integrations);
}

export function listDRIntegrations(): Promise<DRIntegration[]> {
  return fetchDRIntegrations();
}

export function getDRIntegration(integrationID: string): Promise<DRIntegration> {
  return fetchDRData<DRIntegration>(
    CLARIO_DR_ENDPOINTS.integration(integrationID),
  );
}

export function createDRIntegration(
  payload: DRCreateIntegrationRequest,
): Promise<DRIntegration> {
  return postDRData<DRIntegration>(CLARIO_DR_ENDPOINTS.integrations, payload);
}

export function updateDRIntegration(
  integrationID: string,
  payload: DRUpdateIntegrationRequest,
): Promise<DRIntegration> {
  return putDRData<DRIntegration>(
    CLARIO_DR_ENDPOINTS.integration(integrationID),
    payload,
  );
}

export function deleteDRIntegration(integrationID: string): Promise<void> {
  return deleteDRNoContent(CLARIO_DR_ENDPOINTS.integration(integrationID));
}

export function testDRIntegration(
  integrationID: string,
): Promise<DRIntegrationTestResult> {
  return postDRData<DRIntegrationTestResult>(
    CLARIO_DR_ENDPOINTS.integrationTest(integrationID),
  );
}
