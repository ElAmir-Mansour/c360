/**
 * evidence-export.ts — pure, deterministic client-side assembler for a ClarioDR
 * "one-click evidence pack".
 *
 * There is NO backend export/report endpoint: the evidence pack for a completed
 * failover run (or drill) is assembled entirely from data the console already
 * fetches through the real ClarioDR APIs — the run itself, its execution steps
 * (`fetchDRFailoverSteps`), its sealed attestation (`fetchDRFailoverAttestation`),
 * the tenant attestation-ledger entries (`fetchDRAttestationLedger`) and the
 * chain-verify verdict (`verifyDRAttestationLedger`). This module turns those
 * real-shaped inputs into a single, self-describing pack structure that can be
 * serialised to JSON (downloaded via a Blob) and rendered into a print-optimised
 * evidence view for browser print-to-PDF.
 *
 * Everything here is a pure function: callers pass `generatedAt` explicitly (no
 * `Date.now()` reads) so the output is deterministic and unit-testable. No fields
 * are invented — every value is derived from the real `@/types/clario-dr` shapes.
 * The RTO-vs-RTA evaluation reuses the design-system `evaluateRto`, and the
 * four-gate derivation reuses the same `gateIndexForStatus` / `isTerminalFailure`
 * status helpers the live PIR panel uses, so the pack never re-encodes the
 * backend FSM or fabricates an outcome.
 */

import {
  evaluateRto,
  gateIndexForStatus,
  isTerminalFailure,
  isTerminalSuccess,
} from '@/components/product';
import type {
  DRAttestation,
  DRAttestationLedgerEntry,
  DRAttestationLedgerVerifyResult,
  DRFailoverRun,
  DRFailoverStep,
} from '@/types/clario-dr';

/** Schema version stamped into every pack so downstream readers can branch. */
export const EVIDENCE_PACK_SCHEMA_VERSION = '1.0' as const;

/** The four recovery gates, in execution order. */
export const EVIDENCE_GATE_KEYS = ['validate', 'approve', 'execute', 'attest'] as const;
export type EvidenceGateKey = (typeof EVIDENCE_GATE_KEYS)[number];

/** Honest outcome of a single gate, derived from real step records + run status. */
export type EvidenceGateOutcome = 'passed' | 'failed' | 'skipped' | 'pending';

const GATE_INDEX: Record<EvidenceGateKey, number> = {
  validate: 0,
  approve: 1,
  execute: 2,
  attest: 3,
};

// ---------------------------------------------------------------------------
// Pack structure.
// ---------------------------------------------------------------------------

/** Provenance + identity stamped on the pack envelope. */
export interface EvidencePackMeta {
  schema_version: typeof EVIDENCE_PACK_SCHEMA_VERSION;
  kind: 'clario-dr.evidence-pack';
  generated_at: string;
  /** Optional human/operator attribution; omitted when not supplied. */
  generated_by?: string;
  tenant_id: string;
  group_id: string;
  /** Resolved protection-group display name when available. */
  group_name?: string;
  run_id: string;
  run_mode: string;
  run_status: string;
}

/** Run-level summary, copied straight from the real `DRFailoverRun`. */
export interface EvidencePackRun {
  id: string;
  group_id: string;
  mode: string;
  status: string;
  recovery_point_id?: string | null;
  initiated_by: string;
  approved_by?: string | null;
  initiated_at: string;
  completed_at?: string | null;
  rto_objective_seconds: number;
  rto_actual_seconds?: number | null;
  last_error?: string | null;
  terminal: boolean;
  terminal_success: boolean;
  terminal_failure: boolean;
}

/** RTO-vs-RTA verdict for the pack (derived via the DS `evaluateRto`). */
export interface EvidencePackRto {
  objective_seconds: number;
  actual_seconds: number | null;
  /** objective - actual; negative once the recovery overran the objective. */
  remaining_seconds: number | null;
  /** actual / objective (clamped to >= 0); 0 when there is nothing to measure. */
  ratio: number;
  /** A sealed actual exceeded the objective. */
  breached: boolean;
  /** True only for a terminal-success run whose actual met the objective. */
  met: boolean;
}

/** One of the four gate outcomes, with the contributing step records. */
export interface EvidencePackGate {
  key: EvidenceGateKey;
  outcome: EvidenceGateOutcome;
  /** Real step records (name + status + timing) that fed this gate's outcome. */
  steps: Array<{
    step: string;
    status: string;
    started_at: string;
    finished_at?: string | null;
  }>;
}

/** Compact, real attestation evidence (omitted when no attestation was sealed). */
export interface EvidencePackAttestation {
  id: string;
  run_id: string;
  rto_objective_seconds: number;
  rto_actual_seconds: number;
  rpo_seconds: number;
  validation_ratio: number;
  report_object_key: string;
  content_hash: string;
  created_at: string;
}

/** A single ledger entry carried in the pack (the full hash-chained record). */
export interface EvidencePackLedgerEntry {
  seq: number;
  entry_type: string;
  subject_id: string;
  payload_hash: string;
  prev_hash: string;
  entry_hash: string;
  anchored_root?: string | null;
  created_at: string;
}

/** Hash-chain integrity summary scoped to the entries carried in the pack. */
export interface EvidencePackHashChain {
  /** The tenant-wide chain-verify verdict at pack-generation time. */
  verified_intact: boolean;
  entries_checked: number;
  first_broken_seq: number | null;
  head_hash: string | null;
  verify_reason: string | null;
  /** Entries included in this pack (the run's own + any directly referencing it). */
  included_entry_count: number;
  /** Sequence span [min, max] of the included entries; null when none included. */
  included_seq_range: [number, number] | null;
  /** True when every included entry links to its predecessor's `entry_hash`. */
  included_links_contiguous: boolean;
  /** How many of the included entries have been anchored to a Merkle root. */
  anchored_entry_count: number;
}

/** The assembled, serialisable evidence pack. */
export interface EvidencePack {
  meta: EvidencePackMeta;
  run: EvidencePackRun;
  rto: EvidencePackRto;
  gates: EvidencePackGate[];
  attestation: EvidencePackAttestation | null;
  ledger_entries: EvidencePackLedgerEntry[];
  hash_chain: EvidencePackHashChain;
}

/** Inputs the assembler reads. Every field maps to a real ClarioDR fetch. */
export interface AssembleEvidencePackInput {
  run: DRFailoverRun;
  steps: DRFailoverStep[];
  /** Sealed attestation; `null`/`undefined` for drills or unattested runs. */
  attestation?: DRAttestation | null;
  /** Tenant attestation-ledger entries (the pack scopes them to this run). */
  ledgerEntries: DRAttestationLedgerEntry[];
  /** Tenant chain-verify verdict; `null`/`undefined` when not yet loaded. */
  verification?: DRAttestationLedgerVerifyResult | null;
  /** Resolved protection-group display name, when known. */
  groupName?: string | null;
  /** Operator attribution to stamp on the pack envelope. */
  generatedBy?: string | null;
  /** Generation timestamp (passed in so the output is deterministic). */
  generatedAt: Date | string;
}

// ---------------------------------------------------------------------------
// Gate derivation (shared logic with the live PIR panel).
// ---------------------------------------------------------------------------

/** Map a backend step name to the gate it belongs to (null = non-gate step). */
function gateForStep(step: string): EvidenceGateKey | null {
  const lower = step.toLowerCase();
  if (lower.startsWith('gate1')) return 'validate';
  if (lower.startsWith('gate2')) return 'approve';
  if (lower.startsWith('gate3')) return 'execute';
  if (lower.startsWith('gate4')) return 'attest';
  return null;
}

/**
 * Derive the honest four-gate outcome strip from the real step records, falling
 * back to the run status for gates that emitted no step record. Identical in
 * spirit to the live PIR panel's `deriveGates` so the pack and the on-screen
 * review never disagree.
 */
export function deriveEvidenceGates(
  run: Pick<DRFailoverRun, 'status'>,
  steps: DRFailoverStep[],
): EvidencePackGate[] {
  const byGate = new Map<EvidenceGateKey, DRFailoverStep[]>();
  for (const step of steps) {
    const gate = gateForStep(step.step);
    if (!gate) continue;
    const list = byGate.get(gate) ?? [];
    list.push(step);
    byGate.set(gate, list);
  }

  const clearedGates = gateIndexForStatus(run.status);
  const runFailed = isTerminalFailure(run.status);

  return EVIDENCE_GATE_KEYS.map((gate) => {
    const gateSteps = byGate.get(gate) ?? [];
    let outcome: EvidenceGateOutcome;

    if (gateSteps.length > 0) {
      const anyFailed = gateSteps.some((step) => step.status.toLowerCase() === 'failed');
      const allPassed = gateSteps.every((step) => step.status.toLowerCase() === 'passed');
      outcome = anyFailed ? 'failed' : allPassed ? 'passed' : 'pending';
    } else if (clearedGates > GATE_INDEX[gate]) {
      outcome = 'passed';
    } else if (runFailed) {
      outcome = 'skipped';
    } else {
      outcome = 'pending';
    }

    return {
      key: gate,
      outcome,
      steps: gateSteps.map((step) => ({
        step: step.step,
        status: step.status,
        started_at: step.started_at,
        finished_at: step.finished_at ?? null,
      })),
    };
  });
}

// ---------------------------------------------------------------------------
// Ledger scoping + hash-chain summary.
// ---------------------------------------------------------------------------

/**
 * Select the ledger entries relevant to a single run: any entry whose
 * `subject_id` is the run id, plus any entry whose payload references the run id
 * (`run_id` / `runID`). Entries are returned ascending by `seq` so the included
 * hash links can be checked for contiguity deterministically.
 */
export function selectRunLedgerEntries(
  runId: string,
  entries: DRAttestationLedgerEntry[],
): DRAttestationLedgerEntry[] {
  const relevant = entries.filter((entry) => {
    if (entry.subject_id === runId) return true;
    const payload = entry.payload;
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      const record = payload as Record<string, unknown>;
      return record.run_id === runId || record.runID === runId;
    }
    return false;
  });
  return [...relevant].sort((a, b) => a.seq - b.seq);
}

function summariseHashChain(
  included: DRAttestationLedgerEntry[],
  verification: DRAttestationLedgerVerifyResult | null | undefined,
): EvidencePackHashChain {
  const seqs = included.map((entry) => entry.seq);
  const range: [number, number] | null =
    seqs.length > 0 ? [Math.min(...seqs), Math.max(...seqs)] : null;

  // Contiguity: every included entry (after the first) links to the previous
  // included entry's `entry_hash`. Trivially true for 0 or 1 entries.
  let contiguous = true;
  for (let i = 1; i < included.length; i += 1) {
    if (included[i].prev_hash !== included[i - 1].entry_hash) {
      contiguous = false;
      break;
    }
  }

  const anchoredCount = included.filter(
    (entry) => typeof entry.anchored_root === 'string' && entry.anchored_root.length > 0,
  ).length;

  return {
    verified_intact: Boolean(verification?.intact),
    entries_checked: verification?.entries_checked ?? 0,
    first_broken_seq:
      verification?.first_broken_seq === undefined ? null : verification.first_broken_seq,
    head_hash: verification?.head_hash ?? null,
    verify_reason: verification?.reason ?? null,
    included_entry_count: included.length,
    included_seq_range: range,
    included_links_contiguous: contiguous,
    anchored_entry_count: anchoredCount,
  };
}

// ---------------------------------------------------------------------------
// Top-level assembler.
// ---------------------------------------------------------------------------

function toIso(value: Date | string): string {
  if (typeof value === 'string') return value;
  return value.toISOString();
}

/**
 * Assemble a complete evidence pack from real-shaped inputs. Pure and
 * deterministic: identical inputs always yield an identical pack.
 */
export function assembleEvidencePack(input: AssembleEvidencePackInput): EvidencePack {
  const {
    run,
    steps,
    attestation,
    ledgerEntries,
    verification,
    groupName,
    generatedBy,
    generatedAt,
  } = input;

  const terminalSuccess = isTerminalSuccess(run.status);
  const terminalFailure = isTerminalFailure(run.status);

  const rtoEval = evaluateRto(run.rto_objective_seconds, run.rto_actual_seconds);
  const rto: EvidencePackRto = {
    objective_seconds: rtoEval.objectiveSeconds,
    actual_seconds: rtoEval.actualSeconds,
    remaining_seconds: rtoEval.remainingSeconds,
    ratio: rtoEval.ratio,
    breached: rtoEval.breached,
    // "Met" only makes sense for a terminal success that did not breach budget.
    met: terminalSuccess && !rtoEval.breached && rtoEval.actualSeconds !== null,
  };

  const includedEntries = selectRunLedgerEntries(run.id, ledgerEntries);

  const meta: EvidencePackMeta = {
    schema_version: EVIDENCE_PACK_SCHEMA_VERSION,
    kind: 'clario-dr.evidence-pack',
    generated_at: toIso(generatedAt),
    tenant_id: run.tenant_id,
    group_id: run.group_id,
    run_id: run.id,
    run_mode: run.mode,
    run_status: run.status,
  };
  if (generatedBy) meta.generated_by = generatedBy;
  if (groupName) meta.group_name = groupName;

  return {
    meta,
    run: {
      id: run.id,
      group_id: run.group_id,
      mode: run.mode,
      status: run.status,
      recovery_point_id: run.recovery_point_id ?? null,
      initiated_by: run.initiated_by,
      approved_by: run.approved_by ?? null,
      initiated_at: run.initiated_at,
      completed_at: run.completed_at ?? null,
      rto_objective_seconds: run.rto_objective_seconds,
      rto_actual_seconds: run.rto_actual_seconds ?? null,
      last_error: run.last_error ?? null,
      terminal: terminalSuccess || terminalFailure,
      terminal_success: terminalSuccess,
      terminal_failure: terminalFailure,
    },
    rto,
    gates: deriveEvidenceGates(run, steps),
    attestation: attestation
      ? {
          id: attestation.id,
          run_id: attestation.run_id,
          rto_objective_seconds: attestation.rto_objective_seconds,
          rto_actual_seconds: attestation.rto_actual_seconds,
          rpo_seconds: attestation.rpo_seconds,
          validation_ratio: attestation.validation_ratio,
          report_object_key: attestation.report_object_key,
          content_hash: attestation.content_hash,
          created_at: attestation.created_at,
        }
      : null,
    ledger_entries: includedEntries.map((entry) => ({
      seq: entry.seq,
      entry_type: entry.entry_type,
      subject_id: entry.subject_id,
      payload_hash: entry.payload_hash,
      prev_hash: entry.prev_hash,
      entry_hash: entry.entry_hash,
      anchored_root: entry.anchored_root ?? null,
      created_at: entry.created_at,
    })),
    hash_chain: summariseHashChain(includedEntries, verification),
  };
}

/** Serialise a pack to a stable, pretty-printed JSON string. */
export function serializeEvidencePack(pack: EvidencePack): string {
  return JSON.stringify(pack, null, 2);
}

/**
 * Deterministic, filesystem-safe download filename for a pack, e.g.
 * `clario-dr-evidence-run-abc123-20260615T101500Z.json`. The timestamp is taken
 * from `meta.generated_at` so the name matches the pack contents.
 */
export function evidencePackFilename(pack: EvidencePack): string {
  const safeRun = pack.meta.run_id.replace(/[^a-zA-Z0-9_-]+/g, '-');
  const stamp = pack.meta.generated_at.replace(/[:-]/g, '').replace(/\.\d+Z$/, 'Z');
  return `clario-dr-evidence-${safeRun}-${stamp}.json`;
}
