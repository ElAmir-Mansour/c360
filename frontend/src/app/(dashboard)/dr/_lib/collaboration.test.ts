import { describe, expect, it } from 'vitest';
import {
  itemsNeedingApproval,
  ledgerToActivity,
  type ActivityEvent,
  type ApprovalItem,
} from './collaboration';
import type {
  DRAttestationLedgerEntry,
  DRBCMPack,
  DRFailbackRun,
  DRFailoverRun,
  DRFailoverStep,
} from '@/types/clario-dr';

/**
 * Deterministic tests for the collaboration selectors.
 *
 * Inputs use the REAL `@/types/clario-dr` field names. Failover approval is
 * proven through the actual `AWAITING_APPROVAL` FSM state the shared helper
 * recognises; failback cutback approval through the real
 * `awaiting_cutback_approval` state. The activity feed is proven on the real
 * ledger `entry_type` values and failover `step` tokens, including the
 * actor-absent → `system` fallback.
 */

// ---------------------------------------------------------------------------
// Builders (full real shapes, overridable).
// ---------------------------------------------------------------------------

function failover(overrides: Partial<DRFailoverRun> = {}): DRFailoverRun {
  return {
    id: 'fo-1',
    tenant_id: 't-1',
    group_id: 'g-1',
    mode: 'drill',
    status: 'AWAITING_APPROVAL',
    recovery_point_id: null,
    rto_objective_seconds: 900,
    initiated_by: 'op-1',
    approved_by: null,
    initiated_at: '2026-06-15T00:00:00.000Z',
    completed_at: null,
    rto_actual_seconds: null,
    last_error: null,
    claimed_at: null,
    updated_at: '2026-06-15T00:00:00.000Z',
    ...overrides,
  };
}

function failback(overrides: Partial<DRFailbackRun> = {}): DRFailbackRun {
  return {
    id: 'fb-1',
    tenant_id: 't-1',
    group_id: 'g-1',
    failover_run_id: 'fo-1',
    from_site: 'site-a',
    to_site: 'site-b',
    reverse_stream_id: null,
    status: 'awaiting_cutback_approval',
    delta_bytes_remaining: 0,
    delta_seq_remaining: 0,
    converge_threshold_bytes: 1024,
    source_lsn: null,
    applied_lsn: null,
    last_converged_at: null,
    cutover_window_open: true,
    initiated_by: 'op-1',
    approved_by: null,
    approved_at: null,
    new_direction: null,
    last_error: null,
    claimed_at: null,
    initiated_at: '2026-06-15T00:00:00.000Z',
    completed_at: null,
    updated_at: '2026-06-15T00:00:00.000Z',
    ...overrides,
  };
}

function ledger(overrides: Partial<DRAttestationLedgerEntry> = {}): DRAttestationLedgerEntry {
  return {
    id: 'le-1',
    tenant_id: 't-1',
    seq: 1,
    entry_type: 'failover_attestation',
    subject_id: 'fo-1',
    payload: {},
    payload_hash: 'h',
    prev_hash: 'p',
    entry_hash: 'e',
    anchored_root: null,
    created_at: '2026-06-15T00:00:00.000Z',
    ...overrides,
  };
}

function step(overrides: Partial<DRFailoverStep> = {}): DRFailoverStep {
  return {
    id: 'st-1',
    run_id: 'fo-1',
    step: 'execute',
    status: 'completed',
    started_at: '2026-06-15T00:00:00.000Z',
    finished_at: '2026-06-15T00:01:00.000Z',
    ...overrides,
  };
}

const bcmPacks: DRBCMPack[] = [
  {
    key: 'iso-22301',
    standard: 'ISO 22301',
    version: '2019',
    authority: 'ISO',
    title: 'Business Continuity',
    description: 'BC pack',
    controls: [],
  },
];

// ---------------------------------------------------------------------------
// itemsNeedingApproval
// ---------------------------------------------------------------------------

describe('itemsNeedingApproval', () => {
  it('flags a failover run in the AWAITING_APPROVAL FSM state via the shared helper', () => {
    const items = itemsNeedingApproval([failover()], []);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject<Partial<ApprovalItem>>({
      kind: 'failover',
      id: 'fo-1',
      route: '/dr/runs/fo-1',
    });
    expect(items[0].title).toContain('awaiting approval');
    expect(items[0].since).toBe('2026-06-15T00:00:00.000Z');
  });

  it('ignores failover runs in any other FSM state (not a hardcoded string match)', () => {
    const states = ['INITIATED', 'EXECUTING', 'VALIDATING', 'ATTESTED', 'COMPLETED', 'FAILED'];
    for (const status of states) {
      expect(itemsNeedingApproval([failover({ status })], [])).toHaveLength(0);
    }
  });

  it('detects AWAITING_APPROVAL case-insensitively', () => {
    expect(itemsNeedingApproval([failover({ status: 'awaiting_approval' })], [])).toHaveLength(1);
  });

  it('flags a failback run awaiting cutback approval', () => {
    const items = itemsNeedingApproval([], [failback()]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject<Partial<ApprovalItem>>({
      kind: 'failback_cutback',
      id: 'fb-1',
      route: '/recover/it-dr/recover',
    });
  });

  it('carries optional backend approval reason and quorum state when present', () => {
    const items = itemsNeedingApproval(
      [
        failover({
          approval: {
            reason: 'RTO breach requires executive approval',
            quorum: { status: 'waiting', required: 2, received: 1, remaining: 1 },
          },
        }),
      ],
      [],
    );
    expect(items[0]).toMatchObject<Partial<ApprovalItem>>({
      approvalReason: 'RTO breach requires executive approval',
      approvalQuorumStatus: 'waiting',
      approvalQuorum: { required: 2, received: 1 },
    });
  });

  it('does not flag a failback whose cutback was already approved', () => {
    expect(
      itemsNeedingApproval([], [failback({ approved_by: 'op-2', approved_at: '2026-06-15T00:05:00.000Z' })]),
    ).toHaveLength(0);
    // approved_at alone is also enough to clear it.
    expect(
      itemsNeedingApproval([], [failback({ approved_at: '2026-06-15T00:05:00.000Z' })]),
    ).toHaveLength(0);
  });

  it('ignores failbacks not in the cutback-approval state', () => {
    expect(itemsNeedingApproval([], [failback({ status: 'converging' })])).toHaveLength(0);
    expect(itemsNeedingApproval([], [failback({ status: 'cutting_back' })])).toHaveLength(0);
  });

  it('never emits approval items for BCM packs (templates have no approval FSM)', () => {
    expect(itemsNeedingApproval([], [], bcmPacks)).toHaveLength(0);
  });

  it('merges and orders oldest-waiting first across both run kinds', () => {
    const items = itemsNeedingApproval(
      [failover({ id: 'fo-new', updated_at: '2026-06-15T03:00:00.000Z' })],
      [failback({ id: 'fb-old', updated_at: '2026-06-15T01:00:00.000Z' })],
    );
    expect(items.map((i) => i.id)).toEqual(['fb-old', 'fo-new']);
  });

  it('is total on empty / undefined-ish inputs', () => {
    expect(itemsNeedingApproval([], [])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// ledgerToActivity
// ---------------------------------------------------------------------------

describe('ledgerToActivity', () => {
  it('maps each known entry_type to a human verb and carries subject/time', () => {
    const events = ledgerToActivity([
      ledger({ id: 'a', entry_type: 'recovery_point_validation', subject_id: 'rp-9' }),
    ]);
    expect(events[0]).toMatchObject<Partial<ActivityEvent>>({
      source: 'ledger',
      verb: 'validated a recovery point',
      subjectId: 'rp-9',
      rawType: 'recovery_point_validation',
      at: '2026-06-15T00:00:00.000Z',
    });
    expect(events[0].key).toBe('ledger:a');
  });

  it('humanizes an unknown entry_type deterministically rather than dropping it', () => {
    const [event] = ledgerToActivity([ledger({ entry_type: 'custom_event_kind' })]);
    expect(event.verb).toBe('recorded custom event kind');
  });

  it('reads a real actor out of the ledger payload when present', () => {
    const [event] = ledgerToActivity([ledger({ payload: { actor: 'alice@clario.dev' } })]);
    expect(event.actor).toBe('alice@clario.dev');
  });

  it('accepts acted_by as an actor alias in the payload', () => {
    const [event] = ledgerToActivity([ledger({ payload: { acted_by: 'bob' } })]);
    expect(event.actor).toBe('bob');
  });

  it('attributes to system when no actor is present or payload is not an object', () => {
    expect(ledgerToActivity([ledger({ payload: {} })])[0].actor).toBe('system');
    expect(ledgerToActivity([ledger({ payload: null })])[0].actor).toBe('system');
    expect(ledgerToActivity([ledger({ payload: ['x'] })])[0].actor).toBe('system');
    expect(ledgerToActivity([ledger({ payload: { actor: '   ' } })])[0].actor).toBe('system');
  });

  it('maps a known step token to a verb and uses finished_at as the time', () => {
    const [event] = ledgerToActivity([], [step({ step: 'validate' })]);
    expect(event).toMatchObject<Partial<ActivityEvent>>({
      source: 'step',
      verb: 'validated recovery',
      subjectId: 'fo-1',
      at: '2026-06-15T00:01:00.000Z',
    });
  });

  it('falls back to started_at when a step has no finished_at', () => {
    const [event] = ledgerToActivity([], [step({ finished_at: null })]);
    expect(event.at).toBe('2026-06-15T00:00:00.000Z');
  });

  it('reads an optional acted_by/actor off a step, else system', () => {
    const withActor = step() as DRFailoverStep & { acted_by?: string };
    withActor.acted_by = 'carol';
    expect(ledgerToActivity([], [withActor])[0].actor).toBe('carol');
    expect(ledgerToActivity([], [step()])[0].actor).toBe('system');
  });

  it('merges ledger + steps newest-first deterministically', () => {
    const events = ledgerToActivity(
      [
        ledger({ id: 'old', created_at: '2026-06-15T00:00:00.000Z' }),
        ledger({ id: 'new', created_at: '2026-06-15T05:00:00.000Z' }),
      ],
      [step({ id: 's-mid', finished_at: '2026-06-15T02:00:00.000Z' })],
    );
    expect(events.map((e) => e.key)).toEqual(['ledger:new', 'step:s-mid', 'ledger:old']);
  });

  it('emits but sorts unparseable timestamps to the end', () => {
    const events = ledgerToActivity([
      ledger({ id: 'good', created_at: '2026-06-15T01:00:00.000Z' }),
      ledger({ id: 'bad', created_at: 'not-a-date' }),
    ]);
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.key)).toEqual(['ledger:good', 'ledger:bad']);
  });

  it('is total on empty inputs', () => {
    expect(ledgerToActivity([])).toEqual([]);
    expect(ledgerToActivity([], [])).toEqual([]);
  });
});
