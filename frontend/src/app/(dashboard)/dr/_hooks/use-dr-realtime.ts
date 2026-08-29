'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { isRunActive, isTerminalSuccess, isTerminalFailure } from '@/components/product';
import { useRealtimeStore } from '@/stores/realtime-store';
import type { DRFailoverRun, DRReplicationSummary } from '@/lib/clario-dr';

/**
 * use-dr-realtime — the shared real-time + liveness layer for the ClarioDR
 * Recovery Operations Console.
 *
 * TRANSPORT (do not fabricate): the app holds ONE notifications WebSocket
 * (`/ws/v1/notifications`, see `@/hooks/use-websocket`). For every inbound
 * message it calls `realtimeStore.publish(topic, …)` for each topic that
 * `normalizeTopics(notification.type)` yields. The ClarioDR backend stages
 * run / gate / step / attestation lifecycle events to `events.Topics.DREvents`
 * (`datastream.dr.events`) and breach/forecast alerts to `events.Topics.DRAlerts`
 * (`datastream.dr.alerts`) via the outbox; the notification fan-out forwards the
 * concrete event `type` (e.g. `datastream.dr.failover.gate1.passed`) as the WS
 * `notification.type`, which `normalizeTopics` passes through unchanged (no DR
 * alias) so the published topic string IS that event type.
 *
 * So "real-time" here = REGISTER the ClarioDR query keys against those DR topic
 * strings; when a DR event arrives the realtime store bumps the per-queryKey
 * event counter and this hook invalidates the matching react-query entries. The
 * `['clario-dr', …]` keys are the exact ones produced by `use-dr-queries.ts`.
 *
 * LIVENESS FALLBACK: WS topic delivery is not guaranteed in every deployment, so
 * a polling fallback always runs. `useDRRefetchInterval` tightens the interval
 * to ~5s while a run/replication is non-terminal (live) and relaxes to the
 * caller's slower baseline otherwise.
 */

// ---------------------------------------------------------------------------
// DR realtime topic strings (== backend event `type`s forwarded by the WS).
// Derived from backend/internal/dr/** outbox `events.NewEvent(eventType, …)`
// staged to events.Topics.DREvents / events.Topics.DRAlerts.
// ---------------------------------------------------------------------------

/** Lifecycle topics on `events.Topics.DREvents` (run / gate / step / attestation / failback). */
export const DR_LIFECYCLE_TOPICS = [
  'datastream.dr.failover.quiescing',
  'datastream.dr.failover.quiesced',
  'datastream.dr.failover.gate1.passed',
  'datastream.dr.failover.approval.required',
  'datastream.dr.failover.gate2.approved',
  'datastream.dr.failover.gate3.executed',
  'datastream.dr.failover.recovery.validated',
  'datastream.dr.failover.failed',
  'datastream.dr.attestation.issued',
  'datastream.dr.failback.planned',
  'datastream.dr.failback.reverse_syncing',
  'datastream.dr.failback.reverse_progress',
  'datastream.dr.failback.delta_converged',
  'datastream.dr.failback.cutback_approval.required',
  'datastream.dr.failback.cutback_approved',
  'datastream.dr.failback.completed',
  'datastream.dr.failback.failed',
  'datastream.dr.appconsistent.barrier.sealed',
  'datastream.dr.appconsistent.barrier.failed',
  'datastream.dr.drill.scheduled',
  'datastream.dr.runbook.generated',
  'datastream.dr.runbook.regenerated',
  'datastream.dr.assurance.evaluated',
  'datastream.dr.bcm.assessed',
  'datastream.dr.selfdr.assessed',
  'datastream.dr.selfdr.artifact_sealed',
] as const;

/** Alert topics on `events.Topics.DRAlerts` (RPO breach / ransomware / forecast). */
export const DR_ALERT_TOPICS = [
  'rpo.breached',
  'rpo.recovered',
  'dr.ransomware.suspected',
  'dr.prediction.rpo_breach_forecast',
  'dr.prediction.rpo_forecast_cleared',
  'dr.prediction.throughput_collapse',
] as const;

/** Subset of lifecycle topics that specifically concern a single in-flight run. */
export const DR_RUN_TOPICS = [
  'datastream.dr.failover.quiescing',
  'datastream.dr.failover.quiesced',
  'datastream.dr.failover.gate1.passed',
  'datastream.dr.failover.approval.required',
  'datastream.dr.failover.gate2.approved',
  'datastream.dr.failover.gate3.executed',
  'datastream.dr.failover.recovery.validated',
  'datastream.dr.failover.failed',
  'datastream.dr.attestation.issued',
] as const;

/** Every DR realtime topic this console listens to. */
export const DR_REALTIME_TOPICS: readonly string[] = [
  ...DR_LIFECYCLE_TOPICS,
  ...DR_ALERT_TOPICS,
];

// ---------------------------------------------------------------------------
// Polling fallback cadences.
// ---------------------------------------------------------------------------

/** Tightened interval (ms) while a run/replication is live (non-terminal). */
export const DR_LIVE_REFETCH_MS = 5_000;
/** Default relaxed baseline (ms) used when nothing live is in flight. */
export const DR_BASELINE_REFETCH_MS = 45_000;

// ---------------------------------------------------------------------------
// Liveness predicates.
// ---------------------------------------------------------------------------

/** A failover run is "live" when its status is neither a terminal success nor failure. */
export function isRunLive(status: string | null | undefined): boolean {
  return isRunActive(status) && !isTerminalSuccess(status) && !isTerminalFailure(status);
}

/** True if ANY run in the list is still live (drives the runs/overview cadence). */
export function hasLiveRun(runs: ReadonlyArray<{ status: string }> | undefined | null): boolean {
  return Boolean(runs?.some((run) => isRunLive(run.status)));
}

/**
 * Replication is "live" (worth fast-polling) when at least one stream is in a
 * non-steady transitional state — i.e. not every stream sits at a healthy/paused
 * resting status. Reads only real `DRReplicationSummary` fields.
 */
const STEADY_STREAM_STATUSES = new Set(['healthy', 'streaming', 'paused']);
export function isReplicationLive(summary: DRReplicationSummary | undefined | null): boolean {
  if (!summary) return false;
  if (summary.rpo_breaches.length > 0) return true;
  const counts = summary.streams_by_status ?? {};
  return Object.entries(counts).some(
    ([status, count]) => count > 0 && !STEADY_STREAM_STATUSES.has(status.toLowerCase()),
  );
}

/**
 * Dynamic refetch interval helper.
 *
 * Returns {@link DR_LIVE_REFETCH_MS} while `live` is true so the view stays
 * current even if the WS topic is not delivered in this deployment; otherwise
 * returns `baseline` (the caller's existing slower cadence). Returns `false`
 * when polling should be disabled entirely (e.g. nothing to watch).
 */
export function drRefetchInterval(
  live: boolean,
  baseline: number | false = DR_BASELINE_REFETCH_MS,
): number | false {
  if (live) return DR_LIVE_REFETCH_MS;
  return baseline;
}

/**
 * Reactive variant of {@link drRefetchInterval} for direct use as a react-query
 * `refetchInterval`. Pass the live predicate result; memoised so the returned
 * value is referentially stable across renders with the same inputs.
 */
export function useDRRefetchInterval(
  live: boolean,
  baseline: number | false = DR_BASELINE_REFETCH_MS,
): number | false {
  return useMemo(() => drRefetchInterval(live, baseline), [live, baseline]);
}

// ---------------------------------------------------------------------------
// Realtime registration core.
// ---------------------------------------------------------------------------

/** Serialise a react-query key the same way the realtime store registers it. */
function keyString(queryKey: QueryKey): string {
  return JSON.stringify(queryKey);
}

/**
 * Register `queryKeys` against `topics` in the realtime store and invalidate the
 * matching react-query entries whenever a registered key receives a DR event.
 *
 * Cleans up every registration on unmount / dependency change. The store keys
 * its per-query event counter by `JSON.stringify(queryKey)`, which is exactly
 * what we register and what `getKeysForTopic` returns on `publish`.
 */
function useRegisterDRTopics(topics: readonly string[], queryKeys: readonly QueryKey[]): void {
  const queryClient = useQueryClient();
  const register = useRealtimeStore((state) => state.register);
  const unregister = useRealtimeStore((state) => state.unregister);
  const queryEvents = useRealtimeStore((state) => state.queryEvents);

  const keyStrings = useMemo(() => queryKeys.map(keyString), [queryKeys]);
  // Map serialised key -> original QueryKey for invalidation.
  const keyMap = useMemo(() => {
    const map = new Map<string, QueryKey>();
    queryKeys.forEach((key) => map.set(keyString(key), key));
    return map;
  }, [queryKeys]);

  const topicSig = useMemo(() => [...topics].sort().join('|'), [topics]);
  const keySig = useMemo(() => [...keyStrings].sort().join('|'), [keyStrings]);

  useEffect(() => {
    for (const topic of topics) {
      for (const ks of keyStrings) {
        register(topic, ks);
      }
    }
    return () => {
      for (const topic of topics) {
        for (const ks of keyStrings) {
          unregister(topic, ks);
        }
      }
    };
    // topicSig/keySig capture the meaningful content of topics/keyStrings.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topicSig, keySig, register, unregister]);

  // Track the last seen event count per query key; invalidate on increment.
  const seenRef = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    for (const ks of keyStrings) {
      const event = queryEvents[ks];
      const count = event?.count ?? 0;
      const prev = seenRef.current.get(ks) ?? 0;
      if (count > prev) {
        seenRef.current.set(ks, count);
        const original = keyMap.get(ks);
        if (original) {
          void queryClient.invalidateQueries({ queryKey: original });
        }
      }
    }
  }, [queryEvents, keyStrings, keyMap, queryClient]);
}

// ---------------------------------------------------------------------------
// Public hooks.
// ---------------------------------------------------------------------------

/** Options for {@link useDRRealtime}. */
export interface UseDRRealtimeOptions {
  /** Active group id, when known, so group-scoped keys are invalidated too. */
  activeGroupId?: string | null;
  /** Active stream id, when known, so stream-scoped keys are invalidated too. */
  activeStreamId?: string | null;
  /** Disable the registration entirely (e.g. on routes that opt out). */
  enabled?: boolean;
}

/**
 * Console-wide DR realtime registration. Mount once in the DR layout: it keeps
 * the posture, replication summary, failover/failback runs, predictions,
 * ransomware signals and (when ids are supplied) the active group/stream
 * summaries fresh against incoming DR WS events.
 */
export function useDRRealtime(options: UseDRRealtimeOptions = {}): void {
  const { activeGroupId = null, activeStreamId = null, enabled = true } = options;

  const queryKeys = useMemo<QueryKey[]>(() => {
    const keys: QueryKey[] = [
      ['clario-dr', 'posture'],
      ['clario-dr', 'replication-summary'],
      ['clario-dr', 'failover-runs'],
      ['clario-dr', 'failback-runs'],
      ['clario-dr', 'predictions'],
      ['clario-dr', 'ransomware-signals'],
    ];
    if (activeGroupId) {
      keys.push(['clario-dr', 'group-summary', activeGroupId]);
      keys.push(['clario-dr', 'group-recovery-points', activeGroupId]);
      keys.push(['clario-dr', 'consistency-barriers', activeGroupId]);
    }
    if (activeStreamId) {
      keys.push(['clario-dr', 'stream-forecast', activeStreamId]);
      keys.push(['clario-dr', 'stream-ransomware-signals', activeStreamId]);
    }
    return keys;
  }, [activeGroupId, activeStreamId]);

  const topics = enabled ? DR_REALTIME_TOPICS : EMPTY_TOPICS;
  const keys = enabled ? queryKeys : EMPTY_KEYS;
  useRegisterDRTopics(topics, keys);
}

/**
 * Per-run realtime registration for the live execution view (`/dr/runs/[id]`).
 * Invalidates the single-run and run-list queries when run/gate/step events for
 * the active run arrive. Pass `null` when no run is selected (registration is a
 * no-op).
 */
export function useActiveRunRealtime(runId: string | null | undefined): void {
  const queryKeys = useMemo<QueryKey[]>(() => {
    if (!runId) return EMPTY_KEYS;
    return [
      ['clario-dr', 'failover-run', runId],
      ['clario-dr', 'failover-runs'],
      ['clario-dr', 'posture'],
    ];
  }, [runId]);

  const topics = runId ? DR_RUN_TOPICS : EMPTY_TOPICS;
  useRegisterDRTopics(topics, queryKeys);
}

/**
 * Convenience liveness wrapper for the live run view: registers per-run realtime
 * AND returns the dynamic refetch interval (5s while live, baseline otherwise)
 * to drop straight into the run's `useQuery({ refetchInterval })`.
 */
export function useActiveRunLiveness(
  run: Pick<DRFailoverRun, 'status'> | null | undefined,
  baseline: number | false = DR_BASELINE_REFETCH_MS,
): number | false {
  const live = isRunLive(run?.status);
  return useDRRefetchInterval(live, baseline);
}

// Stable empty references so disabled paths don't churn the registration effect.
const EMPTY_TOPICS: readonly string[] = [];
const EMPTY_KEYS: QueryKey[] = [];
