import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api', () => ({
  apiDelete: vi.fn(),
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
}));

const { apiDelete, apiGet, apiPost, apiPut } = await import('@/lib/api');
const {
  CLARIO_DR_ENDPOINTS,
  assessDRBCMPack,
  assessDRSelfDR,
  captureDRSelfDRBackup,
  chatDRCopilot,
  createDRFailoverRun,
  deleteDRJournalBookmark,
  fetchDRCleanRoomScan,
  fetchDRBootPlan,
  fetchDRDrillSchedules,
  fetchDRFailbackRuns,
  fetchDRAttestationLedger,
  fetchDRBYOKCustodyLog,
  fetchDRCopilotSessionTranscript,
  fetchDRCyberVaults,
  fetchDRGroupSummary,
  fetchDRIaCReconstitutionPlan,
  fetchDRIaCSnapshot,
  fetchDRIaCSnapshotDiff,
  fetchDRIaCSnapshots,
  fetchDRJournalTimeline,
  fetchDRPosture,
  fetchDRPredictions,
  fetchDRRecoveryTier,
  fetchDRRegistryRunbook,
  fetchDRRegistryRunbookVersions,
  fetchDRRansomwareSignals,
  fetchDRRansomwareStreamSignals,
  fetchDRSelfDRAssessment,
  fetchDRSelfDRArtifacts,
  fetchDRSelfDRComponents,
  fetchDRSelfDRLatestAssessment,
  fetchDRStorageSnapshot,
  fetchDRStorageVolume,
  fetchDRStorageVolumeSnapshots,
  fetchDRStorageVolumes,
  fetchDRStreamForecast,
  fetchDRWorkloadCaptureEpochs,
  fetchDRWorkloadCaptures,
  generateDRSelfDROfflineBundle,
  ingestDRIaCSnapshot,
  mintDRAgentEnrollmentToken,
  pauseDRStream,
  registerDRStorageVolume,
  registerDRWorkloadCapture,
  regenerateDRRegistryRunbook,
  replicateDRStorageSnapshot,
  requestDRStorageSnapshot,
  runDRCleanRoomScan,
  runDRWorkloadCapture,
  updateDRCyberVault,
} = await import('./clario-dr');

describe('clario-dr api helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('unwraps the posture data envelope', async () => {
    const posture = {
      generated_at: '2026-06-13T09:00:00Z',
      overall_health: 'healthy',
      site_count: 2,
      group_count: 1,
      stream_count: 3,
      recovery_point_count: 4,
      streams_by_status: { healthy: 3 },
      rpo_breaches: [],
      attention: [],
      groups: [],
      recent_runs: [],
    };
    vi.mocked(apiGet).mockResolvedValueOnce({ data: posture });

    await expect(fetchDRPosture()).resolves.toEqual(posture);
    expect(apiGet).toHaveBeenCalledWith(CLARIO_DR_ENDPOINTS.posture, undefined);
  });

  it('encodes group IDs when loading group summaries', async () => {
    const summary = {
      generated_at: '2026-06-13T09:00:00Z',
      group_id: 'tenant-a/group-1',
      name: 'Critical ERP',
      health: 'warning',
      member_count: 2,
      stream_count: 2,
      replication_percent: 88,
      rpo_objective_seconds: 300,
      rto_objective_seconds: 900,
      rpo_breaches: [],
      members: [],
      recent_runs: [],
    };
    vi.mocked(apiGet).mockResolvedValueOnce({ data: summary });

    await expect(fetchDRGroupSummary('tenant-a/group-1')).resolves.toEqual(summary);
    expect(apiGet).toHaveBeenCalledWith(
      '/api/v1/dr/groups/tenant-a%2Fgroup-1/summary',
      undefined,
    );
  });

  it('rejects empty and nullish path identifiers before building DR URLs', () => {
    expect(() => fetchDRGroupSummary('null')).toThrow('A valid DR resource identifier is required.');
    expect(() => fetchDRJournalTimeline(' undefined ')).toThrow('A valid DR resource identifier is required.');
    expect(() => fetchDRWorkloadCaptureEpochs('')).toThrow('A valid DR resource identifier is required.');
    expect(apiGet).not.toHaveBeenCalled();
  });

  it('passes attestation ledger filters through to the API client', async () => {
    vi.mocked(apiGet).mockResolvedValueOnce({ data: [] });

    await expect(fetchDRAttestationLedger({ type: 'attestation', limit: 25 })).resolves.toEqual([]);
    expect(apiGet).toHaveBeenCalledWith(CLARIO_DR_ENDPOINTS.attestationLedger, {
      type: 'attestation',
      limit: 25,
    });
  });

  it('builds direct resource endpoints for catalog and custody reads', async () => {
    vi.mocked(apiGet)
      .mockResolvedValueOnce({ data: { tier: 'gold' } })
      .mockResolvedValueOnce({ data: { entries: [], intact: true, broken_seq: 0, merkle_root: 'abc' } });

    await expect(fetchDRRecoveryTier('gold/platinum')).resolves.toEqual({ tier: 'gold' });
    expect(apiGet).toHaveBeenNthCalledWith(
      1,
      '/api/v1/dr/recovery-tiers/gold%2Fplatinum',
      undefined,
    );

    await expect(fetchDRBYOKCustodyLog()).resolves.toEqual({
      entries: [],
      intact: true,
      broken_seq: 0,
      merkle_root: 'abc',
    });
    expect(apiGet).toHaveBeenNthCalledWith(
      2,
      CLARIO_DR_ENDPOINTS.byokCustodyLog,
      undefined,
    );
  });

  it('passes cyber vault group scope as query params for list reads', async () => {
    vi.mocked(apiGet).mockResolvedValueOnce({ data: { vaults: [], count: 0 } });

    await expect(fetchDRCyberVaults('group-1')).resolves.toEqual({ vaults: [], count: 0 });
    expect(apiGet).toHaveBeenCalledWith(CLARIO_DR_ENDPOINTS.cyberVaults, {
      group: 'group-1',
    });
  });

  it('appends query scope for cyber vault mutations that require group', async () => {
    const payload = {
      name: 'prod vault',
      provider: 'aws_backup',
      immutability_enabled: true,
      vault_lock_enabled: true,
      encryption_enabled: true,
      customer_managed_key: true,
      approval: {
        require_restore_approval: true,
        restore_approvers: 2,
        require_destructive_approval: true,
        destructive_approvers: 2,
        separation_of_duties: true,
      },
      retention: { minimum_days: 35 },
      isolation: {
        cross_account: true,
        disjoint_admins: true,
        source_admin_denied: true,
      },
      last_restore_test_passed: true,
      break_glass_enabled: true,
      break_glass_mfa: true,
    };
    vi.mocked(apiPut).mockResolvedValueOnce({ data: { id: 'vault-1' } });

    await expect(updateDRCyberVault('vault/1', 'group/1', payload)).resolves.toEqual({
      id: 'vault-1',
    });
    expect(apiPut).toHaveBeenCalledWith(
      '/api/v1/dr/cyber-vaults/vault%2F1?group=group%2F1',
      payload,
    );
  });

  it('unwraps envelopes from failover create calls', async () => {
    const request = {
      group_id: 'group-1',
      mode: 'drill',
      rto_objective_seconds: 900,
    };
    const run = { id: 'run-1', status: 'INITIATED' };
    vi.mocked(apiPost).mockResolvedValueOnce({ data: run });

    await expect(createDRFailoverRun(request)).resolves.toEqual(run);
    expect(apiPost).toHaveBeenCalledWith(CLARIO_DR_ENDPOINTS.failoverRuns, request);
  });

  it('supports no-content stream actions', async () => {
    vi.mocked(apiPost).mockResolvedValueOnce(undefined);

    await expect(pauseDRStream('stream/1')).resolves.toBeUndefined();
    expect(apiPost).toHaveBeenCalledWith('/api/v1/dr/streams/stream%2F1/pause', undefined);
  });

  it('builds scoped BCM assessment and agent enrollment token calls', async () => {
    vi.mocked(apiPost)
      .mockResolvedValueOnce({ data: { compliant: true } })
      .mockResolvedValueOnce({ data: { jwt: 'token' } });

    await expect(assessDRBCMPack('iso/22301', 'group/1')).resolves.toEqual({
      compliant: true,
    });
    expect(apiPost).toHaveBeenNthCalledWith(
      1,
      '/api/v1/dr/bcm/packs/iso%2F22301/assess?group=group%2F1',
      undefined,
    );

    await expect(
      mintDRAgentEnrollmentToken('agent/1', { purpose: 'rotate', ttl_seconds: 60 }),
    ).resolves.toEqual({ jwt: 'token' });
    expect(apiPost).toHaveBeenNthCalledWith(
      2,
      '/api/v1/dr/agents/agent%2F1/enrollment-token',
      { purpose: 'rotate', ttl_seconds: 60 },
    );
  });

  it('builds resilience and orchestration read endpoints', async () => {
    vi.mocked(apiGet)
      .mockResolvedValueOnce({ data: { group_id: 'group/1', tier_names: [['db']] } })
      .mockResolvedValueOnce({ data: [{ id: 'schedule-1' }] })
      .mockResolvedValueOnce({ data: [{ id: 'failback-1' }] })
      .mockResolvedValueOnce({ data: { stream_id: 'stream/1', recoverable: true } });

    await expect(fetchDRBootPlan('group/1')).resolves.toEqual({
      group_id: 'group/1',
      tier_names: [['db']],
    });
    expect(apiGet).toHaveBeenNthCalledWith(
      1,
      '/api/v1/dr/groups/group%2F1/boot-plan',
      undefined,
    );

    await expect(fetchDRDrillSchedules()).resolves.toEqual([{ id: 'schedule-1' }]);
    expect(apiGet).toHaveBeenNthCalledWith(
      2,
      CLARIO_DR_ENDPOINTS.drillSchedules,
      undefined,
    );

    await expect(fetchDRFailbackRuns()).resolves.toEqual([{ id: 'failback-1' }]);
    expect(apiGet).toHaveBeenNthCalledWith(
      3,
      CLARIO_DR_ENDPOINTS.failbackRuns,
      undefined,
    );

    await expect(fetchDRJournalTimeline('stream/1')).resolves.toEqual({
      stream_id: 'stream/1',
      recoverable: true,
    });
    expect(apiGet).toHaveBeenNthCalledWith(
      4,
      '/api/v1/dr/streams/stream%2F1/journal/timeline',
      undefined,
    );
  });

  it('supports no-content journal bookmark deletes', async () => {
    vi.mocked(apiDelete).mockResolvedValueOnce(undefined);

    await expect(deleteDRJournalBookmark('stream/1', 'bookmark/1')).resolves.toBeUndefined();
    expect(apiDelete).toHaveBeenCalledWith(
      '/api/v1/dr/streams/stream%2F1/journal/bookmarks/bookmark%2F1',
    );
  });

  it('builds intelligence plane read endpoints', async () => {
    vi.mocked(apiGet)
      .mockResolvedValueOnce({ data: [{ id: 'prediction-1' }] })
      .mockResolvedValueOnce({ data: { samples: [] } })
      .mockResolvedValueOnce({ data: { id: 'version-1' } })
      .mockResolvedValueOnce({ data: [{ id: 'version-1' }] })
      .mockResolvedValueOnce({ data: [{ id: 'signal-1' }] })
      .mockResolvedValueOnce({ data: [{ id: 'signal-2' }] })
      .mockResolvedValueOnce({ data: { id: 'scan-1', verdict: 'clean' } })
      .mockResolvedValueOnce({ data: { session: { id: 'session/1' }, messages: [] } });

    await expect(fetchDRPredictions()).resolves.toEqual([{ id: 'prediction-1' }]);
    expect(apiGet).toHaveBeenNthCalledWith(
      1,
      CLARIO_DR_ENDPOINTS.predictions,
      undefined,
    );

    await expect(fetchDRStreamForecast('stream/1')).resolves.toEqual({ samples: [] });
    expect(apiGet).toHaveBeenNthCalledWith(
      2,
      '/api/v1/dr/streams/stream%2F1/forecast',
      undefined,
    );

    await expect(fetchDRRegistryRunbook('group/1', 'isolated')).resolves.toEqual({
      id: 'version-1',
    });
    expect(apiGet).toHaveBeenNthCalledWith(
      3,
      '/api/v1/dr/groups/group%2F1/runbook',
      { profile: 'isolated' },
    );

    await expect(fetchDRRegistryRunbookVersions('group/1')).resolves.toEqual([
      { id: 'version-1' },
    ]);
    expect(apiGet).toHaveBeenNthCalledWith(
      4,
      '/api/v1/dr/groups/group%2F1/runbook/versions',
      undefined,
    );

    await expect(
      fetchDRRansomwareSignals({ limit: 50, stream_id: 'stream/1' }),
    ).resolves.toEqual([{ id: 'signal-1' }]);
    expect(apiGet).toHaveBeenNthCalledWith(
      5,
      CLARIO_DR_ENDPOINTS.ransomwareSignals,
      { limit: 50, stream_id: 'stream/1' },
    );

    await expect(fetchDRRansomwareStreamSignals('stream/1', 5)).resolves.toEqual([
      { id: 'signal-2' },
    ]);
    expect(apiGet).toHaveBeenNthCalledWith(
      6,
      '/api/v1/dr/ransomware/streams/stream%2F1/signals',
      { limit: 5 },
    );

    await expect(fetchDRCleanRoomScan('rp/1')).resolves.toEqual({
      id: 'scan-1',
      verdict: 'clean',
    });
    expect(apiGet).toHaveBeenNthCalledWith(
      7,
      '/api/v1/dr/recovery-points/rp%2F1/cleanroom',
      undefined,
    );

    await expect(fetchDRCopilotSessionTranscript('session/1')).resolves.toEqual({
      session: { id: 'session/1' },
      messages: [],
    });
    expect(apiGet).toHaveBeenNthCalledWith(
      8,
      '/api/v1/dr/copilot/sessions/session%2F1',
      undefined,
    );
  });

  it('builds intelligence plane mutation endpoints', async () => {
    vi.mocked(apiPost)
      .mockResolvedValueOnce({ data: { changed: true } })
      .mockResolvedValueOnce({ data: { id: 'scan-1' } })
      .mockResolvedValueOnce({ data: { answer: 'ready' } });

    await expect(regenerateDRRegistryRunbook('group/1', 'isolated')).resolves.toEqual({
      changed: true,
    });
    expect(apiPost).toHaveBeenNthCalledWith(
      1,
      '/api/v1/dr/groups/group%2F1/runbook/regenerate?profile=isolated',
      undefined,
    );

    await expect(runDRCleanRoomScan('rp/1')).resolves.toEqual({ id: 'scan-1' });
    expect(apiPost).toHaveBeenNthCalledWith(
      2,
      '/api/v1/dr/recovery-points/rp%2F1/cleanroom-scan',
      undefined,
    );

    await expect(
      chatDRCopilot({ session_id: 'session-1', message: 'show readiness' }),
    ).resolves.toEqual({ answer: 'ready' });
    expect(apiPost).toHaveBeenNthCalledWith(3, CLARIO_DR_ENDPOINTS.copilotChat, {
      session_id: 'session-1',
      message: 'show readiness',
    });
  });

  it('builds coverage plane read endpoints', async () => {
    vi.mocked(apiGet)
      .mockResolvedValueOnce({ data: { snapshots: [], count: 0 } })
      .mockResolvedValueOnce({ data: { id: 'snap/1' } })
      .mockResolvedValueOnce({ data: { added: [], removed: [], modified: [] } })
      .mockResolvedValueOnce({ data: { steps: [], waves: [] } })
      .mockResolvedValueOnce({ data: [{ id: 'vol-1' }] })
      .mockResolvedValueOnce({ data: { id: 'vol/1' } })
      .mockResolvedValueOnce({ data: [{ id: 'storage-snap-1' }] })
      .mockResolvedValueOnce({ data: { id: 'storage-snap/1' } })
      .mockResolvedValueOnce({ data: [{ id: 'source-1' }] })
      .mockResolvedValueOnce({ data: [{ id: 'epoch-1' }] });

    await expect(fetchDRIaCSnapshots()).resolves.toEqual({ snapshots: [], count: 0 });
    expect(apiGet).toHaveBeenNthCalledWith(
      1,
      CLARIO_DR_ENDPOINTS.iacSnapshots,
      undefined,
    );

    await expect(fetchDRIaCSnapshot('snap/1')).resolves.toEqual({ id: 'snap/1' });
    expect(apiGet).toHaveBeenNthCalledWith(
      2,
      '/api/v1/dr/iac-snapshots/snap%2F1',
      undefined,
    );

    await expect(fetchDRIaCSnapshotDiff('snap/2', 'snap/1')).resolves.toEqual({
      added: [],
      removed: [],
      modified: [],
    });
    expect(apiGet).toHaveBeenNthCalledWith(
      3,
      '/api/v1/dr/iac-snapshots/snap%2F2/diff',
      { against: 'snap/1' },
    );

    await expect(fetchDRIaCReconstitutionPlan('snap/2')).resolves.toEqual({
      steps: [],
      waves: [],
    });
    expect(apiGet).toHaveBeenNthCalledWith(
      4,
      '/api/v1/dr/iac-snapshots/snap%2F2/reconstitution-plan',
      undefined,
    );

    await expect(fetchDRStorageVolumes()).resolves.toEqual([{ id: 'vol-1' }]);
    expect(apiGet).toHaveBeenNthCalledWith(
      5,
      CLARIO_DR_ENDPOINTS.storageVolumes,
      undefined,
    );

    await expect(fetchDRStorageVolume('vol/1')).resolves.toEqual({ id: 'vol/1' });
    expect(apiGet).toHaveBeenNthCalledWith(
      6,
      '/api/v1/dr/storage-volumes/vol%2F1',
      undefined,
    );

    await expect(fetchDRStorageVolumeSnapshots('vol/1')).resolves.toEqual([
      { id: 'storage-snap-1' },
    ]);
    expect(apiGet).toHaveBeenNthCalledWith(
      7,
      '/api/v1/dr/storage-volumes/vol%2F1/snapshots',
      undefined,
    );

    await expect(fetchDRStorageSnapshot('storage-snap/1')).resolves.toEqual({
      id: 'storage-snap/1',
    });
    expect(apiGet).toHaveBeenNthCalledWith(
      8,
      '/api/v1/dr/storage-snapshots/storage-snap%2F1',
      undefined,
    );

    await expect(fetchDRWorkloadCaptures()).resolves.toEqual([{ id: 'source-1' }]);
    expect(apiGet).toHaveBeenNthCalledWith(
      9,
      CLARIO_DR_ENDPOINTS.workloadCaptures,
      undefined,
    );

    await expect(fetchDRWorkloadCaptureEpochs('source/1')).resolves.toEqual([
      { id: 'epoch-1' },
    ]);
    expect(apiGet).toHaveBeenNthCalledWith(
      10,
      '/api/v1/dr/workload-captures/source%2F1/epochs',
      undefined,
    );
  });

  it('builds coverage plane mutation endpoints', async () => {
    vi.mocked(apiPost)
      .mockResolvedValueOnce({ data: { id: 'snap-1' } })
      .mockResolvedValueOnce({ data: { id: 'vol-1' } })
      .mockResolvedValueOnce({ data: { id: 'storage-snap-1' } })
      .mockResolvedValueOnce({ data: { id: 'storage-snap-1', state: 'REPLICATING' } })
      .mockResolvedValueOnce({ data: { id: 'source-1' } })
      .mockResolvedValueOnce({ data: { id: 'epoch-1' } });

    await expect(
      ingestDRIaCSnapshot({
        name: 'prod',
        source_kind: 'terraform_state',
        artifact: '{}',
      }),
    ).resolves.toEqual({ id: 'snap-1' });
    expect(apiPost).toHaveBeenNthCalledWith(1, CLARIO_DR_ENDPOINTS.iacSnapshots, {
      name: 'prod',
      source_kind: 'terraform_state',
      artifact: '{}',
    });

    await expect(
      registerDRStorageVolume({ name: 'primary', source_location: '/data' }),
    ).resolves.toEqual({ id: 'vol-1' });
    expect(apiPost).toHaveBeenNthCalledWith(2, CLARIO_DR_ENDPOINTS.storageVolumes, {
      name: 'primary',
      source_location: '/data',
    });

    await expect(requestDRStorageSnapshot('vol/1')).resolves.toEqual({
      id: 'storage-snap-1',
    });
    expect(apiPost).toHaveBeenNthCalledWith(
      3,
      '/api/v1/dr/storage-volumes/vol%2F1/snapshots',
      undefined,
    );

    await expect(
      replicateDRStorageSnapshot('storage-snap/1', { target: 'dr/site' }),
    ).resolves.toEqual({ id: 'storage-snap-1', state: 'REPLICATING' });
    expect(apiPost).toHaveBeenNthCalledWith(
      4,
      '/api/v1/dr/storage-snapshots/storage-snap%2F1/replicate',
      { target: 'dr/site' },
    );

    await expect(
      registerDRWorkloadCapture({
        stream_id: 'stream-1',
        name: 'erp-vm',
        source_kind: 'vm_disk',
        binding_kind: 'file',
      }),
    ).resolves.toEqual({ id: 'source-1' });
    expect(apiPost).toHaveBeenNthCalledWith(5, CLARIO_DR_ENDPOINTS.workloadCaptures, {
      stream_id: 'stream-1',
      name: 'erp-vm',
      source_kind: 'vm_disk',
      binding_kind: 'file',
    });

    await expect(runDRWorkloadCapture('source/1')).resolves.toEqual({
      id: 'epoch-1',
    });
    expect(apiPost).toHaveBeenNthCalledWith(
      6,
      '/api/v1/dr/workload-captures/source%2F1/run',
      undefined,
    );
  });

  it('builds self-DR readiness and offline bundle endpoints', async () => {
    vi.mocked(apiGet)
      .mockResolvedValueOnce({ data: { required_components: [], sealing_enabled: true } })
      .mockResolvedValueOnce({ data: { assessment: { id: 'latest' }, artifacts: [] } })
      .mockResolvedValueOnce({ data: { assessment: { id: 'assessment/1' }, artifacts: [] } })
      .mockResolvedValueOnce({ data: [{ id: 'artifact-1' }] });
    vi.mocked(apiPost)
      .mockResolvedValueOnce({ data: { verdict: 'ready' } })
      .mockResolvedValueOnce({ data: { id: 'backup-1' } })
      .mockResolvedValueOnce({ data: { id: 'bundle-1' } });

    await expect(fetchDRSelfDRComponents()).resolves.toEqual({
      required_components: [],
      sealing_enabled: true,
    });
    expect(apiGet).toHaveBeenNthCalledWith(
      1,
      CLARIO_DR_ENDPOINTS.selfDRComponents,
      undefined,
    );

    await expect(fetchDRSelfDRLatestAssessment()).resolves.toEqual({
      assessment: { id: 'latest' },
      artifacts: [],
    });
    expect(apiGet).toHaveBeenNthCalledWith(
      2,
      CLARIO_DR_ENDPOINTS.selfDRLatestAssessment,
      undefined,
    );

    await expect(fetchDRSelfDRAssessment('assessment/1')).resolves.toEqual({
      assessment: { id: 'assessment/1' },
      artifacts: [],
    });
    expect(apiGet).toHaveBeenNthCalledWith(
      3,
      '/api/v1/dr/selfdr/assessments/assessment%2F1',
      undefined,
    );

    await expect(fetchDRSelfDRArtifacts(25)).resolves.toEqual([{ id: 'artifact-1' }]);
    expect(apiGet).toHaveBeenNthCalledWith(
      4,
      CLARIO_DR_ENDPOINTS.selfDRArtifacts,
      { limit: 25 },
    );

    await expect(assessDRSelfDR()).resolves.toEqual({ verdict: 'ready' });
    expect(apiPost).toHaveBeenNthCalledWith(
      1,
      CLARIO_DR_ENDPOINTS.selfDRAssess,
      undefined,
    );

    await expect(
      captureDRSelfDRBackup({
        component_id: 'postgres_control_db',
        component_kind: 'postgres_control_db',
        retain_days: 30,
      }),
    ).resolves.toEqual({ id: 'backup-1' });
    expect(apiPost).toHaveBeenNthCalledWith(2, CLARIO_DR_ENDPOINTS.selfDRBackups, {
      component_id: 'postgres_control_db',
      component_kind: 'postgres_control_db',
      retain_days: 30,
    });

    await expect(
      generateDRSelfDROfflineBundle({ format: 'tar.gz', retain_days: 365 }),
    ).resolves.toEqual({ id: 'bundle-1' });
    expect(apiPost).toHaveBeenNthCalledWith(
      3,
      CLARIO_DR_ENDPOINTS.selfDROfflineBundle,
      { format: 'tar.gz', retain_days: 365 },
    );
  });
});
