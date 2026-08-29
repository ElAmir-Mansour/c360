/**
 * collaboration.ts — pure, deterministic selectors that power the ClarioDR
 * console's cross-route "what needs a human?" and "who did what when?" surfaces
 * (the /dr/approvals queue and the war-room activity feed).
 *
 * Everything here is a side-effect-free transform over REAL API shapes from
 * `@/types/clario-dr`. No wall-clock reads, no fabricated fields, no invented
 * endpoints. The two exported selectors:
 *
 *   - {@link itemsNeedingApproval} folds live failover + failback runs into a
 *     single approval queue. Failover approval-need is detected with the shared
 *     FSM helper {@link isAwaitingApproval} from `@/components/product` (never a
 *     hardcoded status literal). Failback cutback approval is detected from the
 *     failback FSM's `awaiting_cutback_approval` state — the same canonical state
 *     the existing execution panel keys on — normalized so a backend
 *     casing/spacing change does not silently drop an item.
 *
 *   - {@link ledgerToActivity} merges the immutable attestation ledger with a
 *     run's execution steps into one time-ordered "who/what/when" event list. It
 *     reads only fields that actually exist (`actor`/`acted_by` where present —
 *     else a `system` actor — `entry_type`/`step` → a human verb, and
 *     `created_at`/`finished_at`/`started_at` → an ISO time). It is total and
 *     deterministic: same input always yields the same ordered output.
 *
 * NOTE ON BCM PACKS: a `DRBCMPack` is a compliance *template* (`key`, `controls`,
 * …) — it carries no approval/run FSM, so it can never be "awaiting approval".
 * The optional `bcm` parameter is accepted for call-site stability with the
 * console's approval surface, but BCM packs intentionally contribute no approval
 * items; only failover/failback runs do. Surfacing a fake BCM approval state
 * would be fabrication, so we do not.
 */

import { isAwaitingApproval } from '@/components/product';
import type {
  DRApprovalGateState,
  DRApprovalQuorumState,
  DRAttestationLedgerEntry,
  DRBCMPack,
  DRFailbackRun,
  DRFailoverRun,
  DRFailoverStep,
} from '@/types/clario-dr';

// ---------------------------------------------------------------------------
// Approval queue.
// ---------------------------------------------------------------------------

/** The kind of work item awaiting a `dr:write` operator's approval. */
export type ApprovalKind = 'failover' | 'failback_cutback';

export interface ApprovalItem {
  /** Discriminator for the approval action the UI should offer. */
  kind: ApprovalKind;
  /** Run id the approval acts on (`approveDRFailoverRun` / `approveDRFailbackCutback`). */
  id: string;
  /** Human-readable headline (real ids/sites only — no invented copy). */
  title: string;
  /**
   * ISO timestamp the item entered its approval state, best-effort from the run:
   * the failback `approved_at` is never set yet (that is what approval will set),
   * so we use `updated_at` (when the run last transitioned) falling back to
   * `initiated_at`. Always a non-empty string a caller can sort/format.
   */
  since: string;
  /** Deep link into the console route that can act on this item. */
  route: string;
  /** Optional backend-supplied approval reason/body, when exposed on the run. */
  approvalReason?: string | null;
  /** Optional backend-supplied quorum status, when exposed on the run. */
  approvalQuorumStatus?: string | null;
  /** Optional structured quorum detail, when exposed on the run. */
  approvalQuorum?: DRApprovalQuorumState | null;
}

/**
 * Canonical failback cutback-approval state. Mirrors the detection already used
 * by `dr-execution-actions.tsx` (`normalizeStatus(status) === 'awaiting_cutback_approval'`).
 * There is no shared exported failback FSM helper to reuse, so the single
 * normalize-and-compare lives here, documented, rather than being scattered as a
 * raw literal — and it tolerates casing/whitespace drift from the backend.
 */
const FAILBACK_AWAITING_CUTBACK = 'awaiting_cutback_approval';

function normalizeStatus(status?: string | null): string {
  return (status ?? '').toLowerCase().trim().replace(/\s+/g, '_');
}

function isFailbackAwaitingCutback(run: DRFailbackRun): boolean {
  // A cutback that has already been approved (approved_by/approved_at recorded)
  // is no longer pending, even if a stale status lingers.
  if (run.approved_by || run.approved_at) return false;
  return normalizeStatus(run.status) === FAILBACK_AWAITING_CUTBACK;
}

/** Best-effort "since" timestamp for a run entering its approval state. */
function approvalSince(run: { updated_at?: string | null; initiated_at: string }): string {
  return run.updated_at ?? run.initiated_at;
}

function approvalDetail(
  run: {
    approval_reason?: string | null;
    approval_quorum_status?: string | null;
    approval_quorum?: DRApprovalQuorumState | null;
    approval?: DRApprovalGateState | null;
  },
): Pick<ApprovalItem, 'approvalReason' | 'approvalQuorumStatus' | 'approvalQuorum'> {
  return {
    approvalReason: run.approval?.reason ?? run.approval?.body ?? run.approval_reason ?? null,
    approvalQuorumStatus:
      run.approval?.quorum_status ??
      run.approval?.quorum?.status ??
      run.approval_quorum_status ??
      run.approval_quorum?.status ??
      null,
    approvalQuorum: run.approval?.quorum ?? run.approval_quorum ?? null,
  };
}

/** Stable short label for a run id in a headline (full id stays on `item.id`). */
function shortId(value: string): string {
  return value.length <= 12 ? value : `${value.slice(0, 8)}…`;
}

/**
 * Fold live failover + failback runs into a single, time-ordered approval queue.
 *
 * Ordering: oldest `since` first, so the longest-waiting decision sits at the top
 * of the queue. Ties break by `kind` then `id` for full determinism. Pure: it
 * never mutates its inputs and reads no clock.
 */
export function itemsNeedingApproval(
  runs: DRFailoverRun[],
  failbacks: DRFailbackRun[],
  bcm?: DRBCMPack[],
): ApprovalItem[] {
  // `bcm` is intentionally unused for item generation — see the file header.
  void bcm;

  const items: ApprovalItem[] = [];

  for (const run of runs ?? []) {
    if (!isAwaitingApproval(run.status)) continue;
    items.push({
      kind: 'failover',
      id: run.id,
      title: `Failover ${run.mode} run ${shortId(run.id)} awaiting approval`,
      since: approvalSince(run),
      route: `/dr/runs/${run.id}`,
      ...approvalDetail(run),
    });
  }

  for (const run of failbacks ?? []) {
    if (!isFailbackAwaitingCutback(run)) continue;
    items.push({
      kind: 'failback_cutback',
      id: run.id,
      title: `Failback ${shortId(run.id)} awaiting cutback approval`,
      since: approvalSince(run),
      route: '/recover/it-dr/recover',
      ...approvalDetail(run),
    });
  }

  return items.sort(compareApprovalItems);
}

function compareApprovalItems(a: ApprovalItem, b: ApprovalItem): number {
  const aMs = Date.parse(a.since);
  const bMs = Date.parse(b.since);
  const aValid = !Number.isNaN(aMs);
  const bValid = !Number.isNaN(bMs);
  // Unparseable timestamps sort last (after every real time) but stay stable.
  if (aValid && bValid && aMs !== bMs) return aMs - bMs;
  if (aValid !== bValid) return aValid ? -1 : 1;
  if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}

// ---------------------------------------------------------------------------
// Activity feed (who / what / when).
// ---------------------------------------------------------------------------

/** Source plane an activity event was derived from. */
export type ActivitySource = 'ledger' | 'step';

export interface ActivityEvent {
  /** Stable key: `${source}:${id}` — unique across the merged feed. */
  key: string;
  source: ActivitySource;
  /** Who acted. Real `actor` / `acted_by` where present; otherwise `'system'`. */
  actor: string;
  /** Human verb derived from `entry_type` (ledger) or `step` (step record). */
  verb: string;
  /** The thing acted on — ledger `subject_id` or the step's run id. */
  subjectId: string;
  /** ISO time the event occurred (ledger `created_at`; step `finished_at ?? started_at`). */
  at: string;
  /** Raw type/step token kept for filtering/badging without re-deriving. */
  rawType: string;
}

const SYSTEM_ACTOR = 'system';

/** Maps a known ledger `entry_type` to a past-tense human verb. */
const LEDGER_VERBS: Record<string, string> = {
  failover_attestation: 'sealed a failover attestation',
  drill_attestation: 'sealed a drill attestation',
  recovery_point_validation: 'validated a recovery point',
  cleanroom_verdict: 'recorded a clean-room verdict',
  anchor_checkpoint: 'anchored a ledger checkpoint',
};

/** Maps a known failover step token to a past-tense human verb. */
const STEP_VERBS: Record<string, string> = {
  quiesce: 'quiesced the source',
  sync_confirm: 'confirmed replication sync',
  approval: 'cleared the approval gate',
  execute: 'executed the failover',
  boot: 'booted recovery targets',
  validate: 'validated recovery',
  attest: 'issued the attestation',
};

/** Humanize an unknown token (`foo_bar` → `recorded foo bar`) deterministically. */
function humanizeToken(token: string): string {
  const cleaned = token.toLowerCase().trim().replace(/\s+/g, '_');
  if (!cleaned) return 'recorded an event';
  return `recorded ${cleaned.replace(/_/g, ' ')}`;
}

/**
 * A ledger entry's actor lives inside its `payload` (the entry row itself has no
 * top-level `actor` column). We read `payload.actor` / `payload.acted_by` only
 * when the payload is a plain object and the field is a non-empty string —
 * otherwise the event is attributed to the system, never to a fabricated name.
 */
function actorFromLedger(entry: DRAttestationLedgerEntry): string {
  const payload = entry.payload;
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const candidate = payload['actor'] ?? payload['acted_by'];
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return SYSTEM_ACTOR;
}

/** Read an optional `acted_by`/`actor` off a step row, else attribute to system. */
function actorFromStep(step: DRFailoverStep): string {
  const record = step as DRFailoverStep & {
    acted_by?: string | null;
    actor?: string | null;
  };
  const candidate = record.acted_by ?? record.actor;
  if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  return SYSTEM_ACTOR;
}

function verbForLedger(entryType: string): string {
  const key = entryType.toLowerCase().trim();
  return LEDGER_VERBS[key] ?? humanizeToken(entryType);
}

function verbForStep(step: string): string {
  const key = step.toLowerCase().trim();
  return STEP_VERBS[key] ?? humanizeToken(step);
}

/**
 * Merge the immutable attestation ledger and a run's execution steps into one
 * unified, newest-first activity feed.
 *
 * Pure + deterministic: reads no clock, mutates nothing. Each event's time is the
 * real recorded moment — ledger `created_at`, step `finished_at ?? started_at`.
 * Events are sorted newest-first; ties break on `source` then `key` so equal
 * timestamps never reorder between renders. An event whose timestamp is missing
 * or unparseable sorts to the end (but is still emitted — we never drop real
 * records).
 */
export function ledgerToActivity(
  entries: DRAttestationLedgerEntry[],
  steps?: DRFailoverStep[],
): ActivityEvent[] {
  const events: ActivityEvent[] = [];

  for (const entry of entries ?? []) {
    events.push({
      key: `ledger:${entry.id}`,
      source: 'ledger',
      actor: actorFromLedger(entry),
      verb: verbForLedger(entry.entry_type),
      subjectId: entry.subject_id,
      at: entry.created_at,
      rawType: entry.entry_type,
    });
  }

  for (const step of steps ?? []) {
    events.push({
      key: `step:${step.id}`,
      source: 'step',
      actor: actorFromStep(step),
      verb: verbForStep(step.step),
      subjectId: step.run_id,
      at: step.finished_at ?? step.started_at,
      rawType: step.step,
    });
  }

  return events.sort(compareActivityEvents);
}

function compareActivityEvents(a: ActivityEvent, b: ActivityEvent): number {
  const aMs = Date.parse(a.at);
  const bMs = Date.parse(b.at);
  const aValid = !Number.isNaN(aMs);
  const bValid = !Number.isNaN(bMs);
  // Newest first.
  if (aValid && bValid && aMs !== bMs) return bMs - aMs;
  if (aValid !== bValid) return aValid ? -1 : 1;
  if (a.source !== b.source) return a.source < b.source ? -1 : 1;
  if (a.key !== b.key) return a.key < b.key ? -1 : 1;
  return 0;
}
