import { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Unit test for the domain-grouped action hooks in `use-dr-actions.ts`.
 *
 * These prove the actions are REAL wiring (not stubs): each `mutate` fn calls
 * the matching `@/lib/clario-dr` function with the correct args, and on success
 * fires the exact `queryClient.invalidateQueries` keys the monolith used.
 *
 * Strategy:
 *  - Mock `@/lib/clario-dr` so every fn the hooks import is a `vi.fn` resolving a
 *    real-shaped value (shapes come from `@/types/clario-dr` via the lib).
 *  - Mock `sonner` so toasts are inert.
 *  - Spy on `QueryClient.prototype.invalidateQueries` to capture the keys fired
 *    by `useQueryClient()` inside each hook.
 */

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/lib/clario-dr', () => ({
  // failover / failback / boot
  createDRFailoverRun: vi.fn(),
  approveDRFailoverRun: vi.fn(),
  cancelDRFailoverRun: vi.fn(),
  planDRFailback: vi.fn(),
  approveDRFailbackCutback: vi.fn(),
  advanceDRFailback: vi.fn(),
  startDRBootRun: vi.fn(),
  // replication
  pauseDRStream: vi.fn(),
  resumeDRStream: vi.fn(),
  // recovery workbench
  validateDRRecoveryPoint: vi.fn(),
  sealDRRecoveryPoint: vi.fn(),
  createDRJournalBookmark: vi.fn(),
  deleteDRJournalBookmark: vi.fn(),
  materializeDRJournalRecoveryPoint: vi.fn(),
  startDRInstantRecovery: vi.fn(),
  fetchDRInstantRecoveryProgress: vi.fn(),
  finalizeDRInstantRecovery: vi.fn(),
  triggerDRAppConsistentPoint: vi.fn(),
  // rehearse
  createDRAgent: vi.fn(),
  mintDRAgentEnrollmentToken: vi.fn(),
  createDRDrillSchedule: vi.fn(),
  runDRGameDayScenario: vi.fn(),
  // evidence / attestation
  fetchDRAttestationLedgerProof: vi.fn(),
  anchorDRAttestationLedger: vi.fn(),
  assessDRBCMPack: vi.fn(),
  // readiness
  rotateDRBYOKKey: vi.fn(),
  evaluateDRCyberVault: vi.fn(),
  ingestDRIaCSnapshot: vi.fn(),
  fetchDRIaCSnapshotDiff: vi.fn(),
  fetchDRIaCReconstitutionPlan: vi.fn(),
  requestDRStorageSnapshot: vi.fn(),
  replicateDRStorageSnapshot: vi.fn(),
  runDRWorkloadCapture: vi.fn(),
  assessDRSelfDR: vi.fn(),
  captureDRSelfDRBackup: vi.fn(),
  generateDRSelfDROfflineBundle: vi.fn(),
  regenerateDRRegistryRunbook: vi.fn(),
  chatDRCopilot: vi.fn(),
  fetchDRCopilotSessionTranscript: vi.fn(),
  // recovery-tier recommendation
  recommendDRRecoveryTier: vi.fn(),
  // provisioning
  createDRSite: vi.fn(),
  createDRGroup: vi.fn(),
  addDRGroupMember: vi.fn(),
  createDRStream: vi.fn(),
  createDRNetworkMapping: vi.fn(),
}));

import * as drApi from '@/lib/clario-dr';
import {
  useCopilotActions,
  useEvidenceActions,
  useFailoverActions,
  useProvisioningActions,
  useReadinessActions,
  useRecoveryActions,
  useRecoveryTierActions,
  useRehearseActions,
  useReplicationActions,
  type UseFailoverActionsContext,
  type UseReadinessActionsContext,
  type UseRecoveryActionsContext,
  type UseRehearseActionsContext,
} from './use-dr-actions';

const api = vi.mocked(drApi);

let invalidateSpy: ReturnType<typeof vi.spyOn>;

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  // Spy on the prototype so the instance created here (and used by the hook via
  // useQueryClient) reports the keys it invalidates.
  invalidateSpy = vi
    .spyOn(QueryClient.prototype, 'invalidateQueries')
    .mockResolvedValue(undefined);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

/** Collect the `queryKey` arrays passed to invalidateQueries. */
function invalidatedKeys(): unknown[][] {
  const calls = invalidateSpy.mock.calls as unknown[][];
  return calls
    .map(
      (call) => (call[0] as { queryKey?: unknown[] } | undefined)?.queryKey,
    )
    .filter((key): key is unknown[] => Array.isArray(key));
}

function expectInvalidated(key: unknown[]) {
  const keys = invalidatedKeys();
  const match = keys.some(
    (k) => JSON.stringify(k) === JSON.stringify(key),
  );
  expect(
    match,
    `expected invalidateQueries to be called with ${JSON.stringify(
      key,
    )}; got ${JSON.stringify(keys)}`,
  ).toBe(true);
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  invalidateSpy?.mockRestore();
});

// ---------------------------------------------------------------------------
// useFailoverActions
// ---------------------------------------------------------------------------

describe('useFailoverActions', () => {
  const baseCtx: UseFailoverActionsContext = {
    activeGroupId: 'group-1',
    activeRecoveryPointId: 'rp-1',
    groupSummary: { name: 'Critical ERP', rto_objective_seconds: 600 },
    selectedGroup: null,
    activeFailoverRun: { id: 'run-9' } as never,
    failbackSites: { fromSite: 'site-a', toSite: 'site-b' },
  };

  it('createFailover calls createDRFailoverRun with group defaults and invalidates failover-runs/posture/group-summary', async () => {
    api.createDRFailoverRun.mockResolvedValue({ id: 'run-1' } as never);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useFailoverActions(baseCtx), { wrapper });

    result.current.createFailover();

    await waitFor(() =>
      expect(api.createDRFailoverRun).toHaveBeenCalledTimes(1),
    );
    expect(api.createDRFailoverRun).toHaveBeenCalledWith({
      group_id: 'group-1',
      mode: 'drill',
      recovery_point_id: 'rp-1',
      rto_objective_seconds: 600,
    });

    await waitFor(() =>
      expectInvalidated(['clario-dr', 'failover-runs']),
    );
    expectInvalidated(['clario-dr', 'posture']);
    expectInvalidated(['clario-dr', 'group-summary', 'group-1']);
  });

  it('approveFailover calls approveDRFailoverRun with the run id and optional reason, then invalidates failover-runs/posture', async () => {
    api.approveDRFailoverRun.mockResolvedValue({ id: 'run-7' } as never);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useFailoverActions(baseCtx), { wrapper });

    result.current.approveFailover('run-7', { reason: 'Evidence reviewed' });

    await waitFor(() =>
      expect(api.approveDRFailoverRun).toHaveBeenCalledTimes(1),
    );
    expect(api.approveDRFailoverRun).toHaveBeenCalledWith('run-7', {
      reason: 'Evidence reviewed',
    });
    await waitFor(() => expectInvalidated(['clario-dr', 'failover-runs']));
    expectInvalidated(['clario-dr', 'posture']);
  });

  it('createFailback calls planDRFailback with derived sites + failover run id and invalidates failback-runs', async () => {
    api.planDRFailback.mockResolvedValue({ id: 'fb-1' } as never);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useFailoverActions(baseCtx), { wrapper });

    result.current.createFailback();

    await waitFor(() => expect(api.planDRFailback).toHaveBeenCalledTimes(1));
    expect(api.planDRFailback).toHaveBeenCalledWith({
      group_id: 'group-1',
      from_site: 'site-a',
      to_site: 'site-b',
      failover_run_id: 'run-9',
    });
    await waitFor(() => expectInvalidated(['clario-dr', 'failback-runs']));
  });

  it('startBoot calls startDRBootRun with isolated policy and invalidates the group boot-plan', async () => {
    api.startDRBootRun.mockResolvedValue({ run: { id: 'boot-1' } } as never);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useFailoverActions(baseCtx), { wrapper });

    result.current.startBoot();

    await waitFor(() =>
      expect(api.startDRBootRun).toHaveBeenCalledWith('group-1', 'isolated'),
    );
    await waitFor(() =>
      expectInvalidated(['clario-dr', 'boot-plan', 'group-1']),
    );
  });
});

// ---------------------------------------------------------------------------
// useReplicationActions
// ---------------------------------------------------------------------------

describe('useReplicationActions', () => {
  it('pauseStream calls pauseDRStream and invalidates replication-summary/posture/group-summary', async () => {
    api.pauseDRStream.mockResolvedValue(undefined as never);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useReplicationActions('group-1'), {
      wrapper,
    });

    result.current.pauseStream('stream-3');

    await waitFor(() => expect(api.pauseDRStream).toHaveBeenCalledTimes(1));
    expect(api.pauseDRStream.mock.calls[0][0]).toBe('stream-3');
    await waitFor(() =>
      expectInvalidated(['clario-dr', 'replication-summary']),
    );
    expectInvalidated(['clario-dr', 'posture']);
    expectInvalidated(['clario-dr', 'group-summary', 'group-1']);
    // result state is updated to the paused stream id
    await waitFor(() =>
      expect(result.current.latestPausedStreamId).toBe('stream-3'),
    );
  });

  it('resumeStream calls resumeDRStream and invalidates replication-summary', async () => {
    api.resumeDRStream.mockResolvedValue(undefined as never);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useReplicationActions('group-1'), {
      wrapper,
    });

    result.current.resumeStream('stream-5');

    await waitFor(() => expect(api.resumeDRStream).toHaveBeenCalledTimes(1));
    expect(api.resumeDRStream.mock.calls[0][0]).toBe('stream-5');
    await waitFor(() =>
      expectInvalidated(['clario-dr', 'replication-summary']),
    );
  });

  // #20b — optimistic pause flips the cached stream status immediately, then
  // rolls the snapshot back when the server rejects the mutation.
  it('pauseStream optimistically flips the cached stream then rolls back on error', async () => {
    const streamId = 'stream-opt';
    const seededSummary = {
      generated_at: '2026-06-14T10:00:00Z',
      overall_health: 'healthy',
      total_streams: 1,
      streams_by_status: { streaming: 1 },
      worst_live_rpo: null,
      rpo_breaches: [],
      streams: [
        {
          stream_id: streamId,
          site_id: 'site-1',
          site_name: 'Primary',
          site_kind: 'primary',
          status: 'streaming',
          health: 'healthy',
          applied_seq: 10,
          source_lsn: '0/1',
          applied_at: '2026-06-14T10:00:00Z',
          last_error: null,
          rpo_seconds: 5,
          lag_seconds: 1,
          has_data: true,
          breaches_rpo: false,
          rpo_objective_seconds: 300,
          measured_at: '2026-06-14T10:00:01Z',
        },
      ],
    };

    // A deferred rejection so the optimistic state is observable while the
    // mutationFn is still in flight, then resolved to reject for the rollback.
    let rejectPause: (reason: unknown) => void = () => undefined;
    api.pauseDRStream.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectPause = reject;
      }) as never,
    );

    const { queryClient, wrapper } = makeWrapper();
    queryClient.setQueryData(['clario-dr', 'replication-summary'], seededSummary);

    const { result } = renderHook(() => useReplicationActions('group-1'), {
      wrapper,
    });

    result.current.pauseStream(streamId);

    // Optimistic update: the cached stream flips to "paused" before resolution.
    await waitFor(() => {
      const optimistic = queryClient.getQueryData<typeof seededSummary>([
        'clario-dr',
        'replication-summary',
      ]);
      expect(optimistic?.streams[0].status).toBe('paused');
      expect(optimistic?.streams_by_status).toEqual({ paused: 1 });
    });

    // Now reject: onError restores the exact pre-mutation snapshot.
    rejectPause(new Error('pause failed'));

    await waitFor(() => {
      const rolledBack = queryClient.getQueryData<typeof seededSummary>([
        'clario-dr',
        'replication-summary',
      ]);
      expect(rolledBack?.streams[0].status).toBe('streaming');
      expect(rolledBack?.streams_by_status).toEqual({ streaming: 1 });
    });
  });
});

// ---------------------------------------------------------------------------
// useRecoveryActions
// ---------------------------------------------------------------------------

describe('useRecoveryActions', () => {
  const ctx: UseRecoveryActionsContext = {
    activeGroupId: 'group-1',
    activeStreamId: 'stream-1',
    journalTimeline: {
      latest_seq: 42,
      latest_lsn: 'lsn-42',
      latest_ts: '2026-06-14T00:00:00Z',
    } as never,
  };

  it('validatePoint calls validateDRRecoveryPoint with point id and invalidates group-recovery-points', async () => {
    api.validateDRRecoveryPoint.mockResolvedValue({ id: 'rp-2' } as never);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useRecoveryActions(ctx), { wrapper });

    result.current.validatePoint('rp-2');

    await waitFor(() =>
      expect(api.validateDRRecoveryPoint).toHaveBeenCalledTimes(1),
    );
    expect(api.validateDRRecoveryPoint.mock.calls[0][0]).toBe('rp-2');
    await waitFor(() =>
      expectInvalidated(['clario-dr', 'group-recovery-points', 'group-1']),
    );
  });

  it('sealPoint calls sealDRRecoveryPoint with group + retention and invalidates group-recovery-points/posture', async () => {
    api.sealDRRecoveryPoint.mockResolvedValue({ id: 'rp-sealed' } as never);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useRecoveryActions(ctx), { wrapper });

    result.current.sealPoint();

    await waitFor(() =>
      expect(api.sealDRRecoveryPoint).toHaveBeenCalledTimes(1),
    );
    const [groupArg, payloadArg] = api.sealDRRecoveryPoint.mock.calls[0];
    expect(groupArg).toBe('group-1');
    expect(payloadArg).toHaveProperty('retention_until');
    expect(typeof (payloadArg as { retention_until: string }).retention_until).toBe(
      'string',
    );

    await waitFor(() =>
      expectInvalidated(['clario-dr', 'group-recovery-points', 'group-1']),
    );
    expectInvalidated(['clario-dr', 'posture']);
  });

  it('createBookmark calls createDRJournalBookmark with stream id + journal anchor and invalidates journal-bookmarks/timeline', async () => {
    api.createDRJournalBookmark.mockResolvedValue({
      name: 'operator-bookmark-42',
    } as never);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useRecoveryActions(ctx), { wrapper });

    result.current.createBookmark();

    await waitFor(() =>
      expect(api.createDRJournalBookmark).toHaveBeenCalledTimes(1),
    );
    const [streamArg, bookmarkPayload] = api.createDRJournalBookmark.mock.calls[0];
    expect(streamArg).toBe('stream-1');
    expect(bookmarkPayload).toMatchObject({
      kind: 'operator',
      at_seq: 42,
      at_lsn: 'lsn-42',
      at_ts: '2026-06-14T00:00:00Z',
    });

    await waitFor(() =>
      expectInvalidated(['clario-dr', 'journal-bookmarks', 'stream-1']),
    );
    expectInvalidated(['clario-dr', 'journal-timeline', 'stream-1']);
  });

  it('triggerConsistencyPoint calls triggerDRAppConsistentPoint and invalidates consistency-barriers/group-recovery-points/posture', async () => {
    api.triggerDRAppConsistentPoint.mockResolvedValue({ id: 'barrier-1' } as never);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useRecoveryActions(ctx), { wrapper });

    result.current.triggerConsistencyPoint();

    await waitFor(() =>
      expect(api.triggerDRAppConsistentPoint).toHaveBeenCalledTimes(1),
    );
    const [groupArg, payload] = api.triggerDRAppConsistentPoint.mock.calls[0];
    expect(groupArg).toBe('group-1');
    expect(payload).toMatchObject({ provider: 'script' });

    await waitFor(() =>
      expectInvalidated(['clario-dr', 'consistency-barriers', 'group-1']),
    );
    expectInvalidated(['clario-dr', 'group-recovery-points', 'group-1']);
    expectInvalidated(['clario-dr', 'posture']);
  });

  it('startInstantRecovery calls startDRInstantRecovery with point + group, then fetches progress', async () => {
    api.startDRInstantRecovery.mockResolvedValue({ id: 'session-1' } as never);
    api.fetchDRInstantRecoveryProgress.mockResolvedValue({
      session: { id: 'session-1' },
      percent_complete: 50,
    } as never);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useRecoveryActions(ctx), { wrapper });

    result.current.startInstantRecovery('rp-99');

    await waitFor(() =>
      expect(api.startDRInstantRecovery).toHaveBeenCalledWith('rp-99', 'group-1'),
    );
    await waitFor(() =>
      expect(api.fetchDRInstantRecoveryProgress).toHaveBeenCalledWith('session-1'),
    );
    await waitFor(() =>
      expect(result.current.latestInstantProgress?.percent_complete).toBe(50),
    );
  });
});

// ---------------------------------------------------------------------------
// useRehearseActions
// ---------------------------------------------------------------------------

describe('useRehearseActions', () => {
  const ctx: UseRehearseActionsContext = {
    activeGroupId: 'group-1',
    groupSummary: { name: 'Critical ERP', rto_objective_seconds: 600 },
    selectedGroup: null,
  };

  it('createAgent calls createDRAgent and invalidates agents', async () => {
    api.createDRAgent.mockResolvedValue({ id: 'agent-1' } as never);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useRehearseActions(ctx), { wrapper });

    result.current.createAgent();

    await waitFor(() => expect(api.createDRAgent).toHaveBeenCalledWith({}));
    await waitFor(() => expectInvalidated(['clario-dr', 'agents']));
    await waitFor(() =>
      expect(result.current.selectedAgentId).toBe('agent-1'),
    );
  });

  it('createDrillSchedule calls createDRDrillSchedule with group defaults and invalidates drill-schedules', async () => {
    api.createDRDrillSchedule.mockResolvedValue({
      name: 'Critical ERP isolated drill',
    } as never);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useRehearseActions(ctx), { wrapper });

    result.current.createDrillSchedule();

    await waitFor(() =>
      expect(api.createDRDrillSchedule).toHaveBeenCalledTimes(1),
    );
    expect(api.createDRDrillSchedule).toHaveBeenCalledWith({
      group_id: 'group-1',
      name: 'Critical ERP isolated drill',
      cron_expr: '0 2 * * 6',
      profile: 'isolated',
      rto_objective_seconds: 600,
      enabled: true,
    });
    await waitFor(() =>
      expectInvalidated(['clario-dr', 'drill-schedules']),
    );
  });

  it('runGameDay calls runDRGameDayScenario with scenario id and invalidates gameday-scenarios', async () => {
    api.runDRGameDayScenario.mockResolvedValue({
      run: { id: 'gd-1', safety_verdict: 'safe' },
    } as never);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useRehearseActions(ctx), { wrapper });

    result.current.runGameDay('scenario-1');

    await waitFor(() =>
      expect(api.runDRGameDayScenario).toHaveBeenCalledTimes(1),
    );
    expect(api.runDRGameDayScenario.mock.calls[0][0]).toBe('scenario-1');
    await waitFor(() =>
      expectInvalidated(['clario-dr', 'gameday-scenarios']),
    );
  });
});

// ---------------------------------------------------------------------------
// useEvidenceActions
// ---------------------------------------------------------------------------

describe('useEvidenceActions', () => {
  it('anchorLedger calls anchorDRAttestationLedger and invalidates attestation-ledger + verify', async () => {
    api.anchorDRAttestationLedger.mockResolvedValue({ seq: 10 } as never);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useEvidenceActions('group-1'), {
      wrapper,
    });

    result.current.anchorLedger();

    await waitFor(() =>
      expect(api.anchorDRAttestationLedger).toHaveBeenCalledTimes(1),
    );
    await waitFor(() =>
      expectInvalidated(['clario-dr', 'attestation-ledger']),
    );
    expectInvalidated(['clario-dr', 'attestation-ledger-verify']);
  });

  it('ledgerProof calls fetchDRAttestationLedgerProof with the seq and stores the proof', async () => {
    api.fetchDRAttestationLedgerProof.mockResolvedValue({ seq: 7 } as never);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useEvidenceActions('group-1'), {
      wrapper,
    });

    result.current.ledgerProof(7);

    await waitFor(() =>
      expect(api.fetchDRAttestationLedgerProof).toHaveBeenCalledTimes(1),
    );
    expect(api.fetchDRAttestationLedgerProof.mock.calls[0][0]).toBe(7);
    await waitFor(() => expect(result.current.selectedSeq).toBe(7));
  });

  it('assessBcm calls assessDRBCMPack with pack key + active group', async () => {
    api.assessDRBCMPack.mockResolvedValue({
      assessment: { pack_key: 'iso-22301' },
      score: 88.4,
    } as never);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useEvidenceActions('group-1'), {
      wrapper,
    });

    result.current.assessBcm('iso-22301');

    await waitFor(() =>
      expect(api.assessDRBCMPack).toHaveBeenCalledWith('iso-22301', 'group-1'),
    );
    await waitFor(() =>
      expect(result.current.latestBcmAssessment?.assessment.pack_key).toBe(
        'iso-22301',
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// useReadinessActions
// ---------------------------------------------------------------------------

describe('useReadinessActions', () => {
  const ctx: UseReadinessActionsContext = {
    activeGroupId: 'group-1',
    activeStreamId: 'stream-1',
    selfDRRestoreWaves: undefined,
  };

  it('rotateByok calls rotateDRBYOKKey and invalidates byok-keys + custody-log', async () => {
    api.rotateDRBYOKKey.mockResolvedValue({ key_version: 4 } as never);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useReadinessActions(ctx), { wrapper });

    result.current.rotateByok();

    await waitFor(() =>
      expect(api.rotateDRBYOKKey).toHaveBeenCalledTimes(1),
    );
    await waitFor(() => expectInvalidated(['clario-dr', 'byok-keys']));
    expectInvalidated(['clario-dr', 'byok-custody-log']);
  });

  it('evaluateVault calls evaluateDRCyberVault with vault + group and invalidates cyber-vaults + assessments', async () => {
    api.evaluateDRCyberVault.mockResolvedValue({ Score: 91 } as never);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useReadinessActions(ctx), { wrapper });

    result.current.evaluateVault('vault-9');

    await waitFor(() =>
      expect(api.evaluateDRCyberVault).toHaveBeenCalledWith('vault-9', 'group-1'),
    );
    await waitFor(() =>
      expectInvalidated(['clario-dr', 'cyber-vaults', 'group-1']),
    );
    expectInvalidated(['clario-dr', 'cyber-vault-assessments', 'group-1']);
  });

  it('runWorkloadCapture calls runDRWorkloadCapture and invalidates workload-captures + epochs', async () => {
    api.runDRWorkloadCapture.mockResolvedValue({
      epoch: 12,
      source_id: 'source-1',
    } as never);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useReadinessActions(ctx), { wrapper });

    result.current.runWorkloadCapture('source-1');

    await waitFor(() =>
      expect(api.runDRWorkloadCapture).toHaveBeenCalledTimes(1),
    );
    expect(api.runDRWorkloadCapture.mock.calls[0][0]).toBe('source-1');
    await waitFor(() =>
      expectInvalidated(['clario-dr', 'workload-captures']),
    );
    expectInvalidated(['clario-dr', 'workload-capture-epochs', 'source-1']);
  });

  it('regenerateRunbook calls regenerateDRRegistryRunbook with group + isolated and invalidates runbook + versions', async () => {
    api.regenerateDRRegistryRunbook.mockResolvedValue({
      changed: true,
      version: { version: 3 },
    } as never);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useReadinessActions(ctx), { wrapper });

    result.current.regenerateRunbook();

    await waitFor(() =>
      expect(api.regenerateDRRegistryRunbook).toHaveBeenCalledWith(
        'group-1',
        'isolated',
      ),
    );
    await waitFor(() =>
      expectInvalidated(['clario-dr', 'registry-runbook', 'group-1']),
    );
    expectInvalidated(['clario-dr', 'registry-runbook-versions', 'group-1']);
  });

  it('askCopilot (delegated to useCopilotActions) calls chatDRCopilot with the prompt and stores the result', async () => {
    api.chatDRCopilot.mockResolvedValue({
      session_id: 'sess-1',
      answer: 'Failover is ready.',
    } as never);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useReadinessActions(ctx), { wrapper });

    result.current.askCopilot('Is failover ready?');

    await waitFor(() => expect(api.chatDRCopilot).toHaveBeenCalledTimes(1));
    expect(api.chatDRCopilot).toHaveBeenCalledWith({
      session_id: null,
      message: 'Is failover ready?',
    });
    await waitFor(() =>
      expect(result.current.copilotResult?.session_id).toBe('sess-1'),
    );
  });
});

// ---------------------------------------------------------------------------
// useCopilotActions
// ---------------------------------------------------------------------------

describe('useCopilotActions', () => {
  it('askCopilot calls chatDRCopilot with a null session for the first message and stores the result', async () => {
    api.chatDRCopilot.mockResolvedValue({
      session_id: 'sess-9',
      answer: 'Recovery point validated.',
    } as never);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useCopilotActions(), { wrapper });

    result.current.askCopilot('Summarize recovery readiness.');

    await waitFor(() => expect(api.chatDRCopilot).toHaveBeenCalledTimes(1));
    expect(api.chatDRCopilot).toHaveBeenCalledWith({
      session_id: null,
      message: 'Summarize recovery readiness.',
    });
    await waitFor(() =>
      expect(result.current.copilotResult?.session_id).toBe('sess-9'),
    );
  });

  it('askCopilot threads the active session_id into the next message', async () => {
    api.chatDRCopilot
      .mockResolvedValueOnce({ session_id: 'sess-thread', answer: 'first' } as never)
      .mockResolvedValueOnce({ session_id: 'sess-thread', answer: 'second' } as never);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useCopilotActions(), { wrapper });

    result.current.askCopilot('first');
    await waitFor(() =>
      expect(result.current.copilotResult?.session_id).toBe('sess-thread'),
    );

    result.current.askCopilot('second');
    await waitFor(() => expect(api.chatDRCopilot).toHaveBeenCalledTimes(2));
    expect(api.chatDRCopilot.mock.calls[1][0]).toEqual({
      session_id: 'sess-thread',
      message: 'second',
    });
  });

  it('loadTranscript calls fetchDRCopilotSessionTranscript with the session id and stores the transcript', async () => {
    api.fetchDRCopilotSessionTranscript.mockResolvedValue({
      session: { id: 'sess-2' },
      messages: [],
    } as never);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useCopilotActions(), { wrapper });

    result.current.loadTranscript('sess-2');

    await waitFor(() =>
      expect(api.fetchDRCopilotSessionTranscript).toHaveBeenCalledTimes(1),
    );
    expect(api.fetchDRCopilotSessionTranscript.mock.calls[0][0]).toBe('sess-2');
    await waitFor(() =>
      expect(result.current.copilotTranscript?.session.id).toBe('sess-2'),
    );
  });
});

// ---------------------------------------------------------------------------
// useRecoveryTierActions
// ---------------------------------------------------------------------------

describe('useRecoveryTierActions', () => {
  it('recommendTier calls recommendDRRecoveryTier with the objective payload and stores the profile', async () => {
    api.recommendDRRecoveryTier.mockResolvedValue({
      tier: 'tier-1',
      rto_seconds: 300,
      rpo_seconds: 60,
    } as never);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useRecoveryTierActions(), { wrapper });

    result.current.recommendTier({
      rto_seconds: 300,
      rpo_seconds: 60,
      mission_critical: true,
    });

    await waitFor(() =>
      expect(api.recommendDRRecoveryTier).toHaveBeenCalledTimes(1),
    );
    expect(api.recommendDRRecoveryTier).toHaveBeenCalledWith({
      rto_seconds: 300,
      rpo_seconds: 60,
      mission_critical: true,
    });
    await waitFor(() =>
      expect(result.current.latestRecommendation?.tier).toBe('tier-1'),
    );
  });
});

// ---------------------------------------------------------------------------
// useProvisioningActions
// ---------------------------------------------------------------------------

describe('useProvisioningActions', () => {
  it('createSite calls createDRSite with the payload and invalidates sites + posture', async () => {
    api.createDRSite.mockResolvedValue({ id: 'site-1', name: 'Prod DB' } as never);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useProvisioningActions(), { wrapper });

    const payload = {
      name: 'Prod DB',
      kind: 'database',
      primary_endpoint: 'pg://primary',
      rto_objective_seconds: 900,
      rpo_objective_seconds: 300,
    };
    result.current.createSite(payload);

    await waitFor(() => expect(api.createDRSite).toHaveBeenCalledTimes(1));
    expect(api.createDRSite).toHaveBeenCalledWith(payload);
    await waitFor(() => expectInvalidated(['clario-dr', 'sites']));
    expectInvalidated(['clario-dr', 'posture']);
    await waitFor(() => expect(result.current.latestSite?.id).toBe('site-1'));
  });

  it('createGroup calls createDRGroup with the payload and invalidates groups + posture', async () => {
    api.createDRGroup.mockResolvedValue({ id: 'group-1', name: 'Critical ERP' } as never);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useProvisioningActions(), { wrapper });

    result.current.createGroup({ name: 'Critical ERP' });

    await waitFor(() => expect(api.createDRGroup).toHaveBeenCalledTimes(1));
    expect(api.createDRGroup).toHaveBeenCalledWith({ name: 'Critical ERP' });
    await waitFor(() => expectInvalidated(['clario-dr', 'groups']));
    expectInvalidated(['clario-dr', 'posture']);
    await waitFor(() => expect(result.current.latestGroup?.id).toBe('group-1'));
  });

  it('addMember calls addDRGroupMember with group id + payload and invalidates group-members/summary/posture', async () => {
    api.addDRGroupMember.mockResolvedValue({
      group_id: 'group-1',
      site_id: 'site-1',
      boot_order: 0,
    } as never);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useProvisioningActions(), { wrapper });

    result.current.addMember('group-1', { site_id: 'site-1', boot_order: 0 });

    await waitFor(() => expect(api.addDRGroupMember).toHaveBeenCalledTimes(1));
    expect(api.addDRGroupMember).toHaveBeenCalledWith('group-1', {
      site_id: 'site-1',
      boot_order: 0,
    });
    await waitFor(() =>
      expectInvalidated(['clario-dr', 'group-members', 'group-1']),
    );
    expectInvalidated(['clario-dr', 'group-summary', 'group-1']);
    expectInvalidated(['clario-dr', 'posture']);
  });

  it('createStream calls createDRStream with the payload and invalidates streams/replication-summary/posture', async () => {
    api.createDRStream.mockResolvedValue({ id: 'stream-1' } as never);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useProvisioningActions(), { wrapper });

    result.current.createStream({ site_id: 'site-1', status: 'pending' });

    await waitFor(() => expect(api.createDRStream).toHaveBeenCalledTimes(1));
    expect(api.createDRStream).toHaveBeenCalledWith({
      site_id: 'site-1',
      status: 'pending',
    });
    await waitFor(() => expectInvalidated(['clario-dr', 'streams']));
    expectInvalidated(['clario-dr', 'replication-summary']);
    expectInvalidated(['clario-dr', 'posture']);
    await waitFor(() => expect(result.current.latestStream?.id).toBe('stream-1'));
  });

  it('createNetworkMapping calls createDRNetworkMapping with group id + payload and invalidates group-network-mappings', async () => {
    api.createDRNetworkMapping.mockResolvedValue({
      id: 'nm-1',
      group_id: 'group-1',
      profile: 'isolated',
    } as never);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useProvisioningActions(), { wrapper });

    result.current.createNetworkMapping('group-1', {
      profile: 'isolated',
      primary_cidr: '10.0.0.0/16',
      recovery_cidr: '10.10.0.0/16',
    });

    await waitFor(() =>
      expect(api.createDRNetworkMapping).toHaveBeenCalledTimes(1),
    );
    expect(api.createDRNetworkMapping).toHaveBeenCalledWith('group-1', {
      profile: 'isolated',
      primary_cidr: '10.0.0.0/16',
      recovery_cidr: '10.10.0.0/16',
    });
    await waitFor(() =>
      expectInvalidated(['clario-dr', 'group-network-mappings', 'group-1']),
    );
    await waitFor(() =>
      expect(result.current.latestNetworkMapping?.id).toBe('nm-1'),
    );
  });
});
