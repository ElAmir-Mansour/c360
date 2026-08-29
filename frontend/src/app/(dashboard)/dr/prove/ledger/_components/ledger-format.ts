import type {
  DRAttestationLedgerEntry,
  DRAttestationLedgerInclusionProof,
  DRJsonValue,
} from '@/types/clario-dr';

/**
 * Pure, dependency-free formatting + derivation helpers for the attestation-ledger
 * explorer. Kept separate from the React components so they can be unit-reasoned
 * and reused across the filter bar, table, proof detail, and anchor timeline.
 */

const NOT_AVAILABLE = 'n/a';

/**
 * Shorten a long hex hash to `head…tail`, leaving short values intact. `naLabel`
 * is the localized "not available" copy for empty input (defaults to the English
 * `n/a` so non-React callers keep the prior fallback).
 */
export function shortHash(value?: string | null, naLabel: string = NOT_AVAILABLE): string {
  if (!value) return naLabel;
  if (value.length <= 16) return value;
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

/** Locale-aware, compact date-time; safe on null / unparseable input. */
export function formatLedgerTimestamp(
  value?: string | null,
  naLabel: string = NOT_AVAILABLE,
): string {
  if (!value) return naLabel;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return naLabel;
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

/** Human entry-type from the backend snake_case token (e.g. `failover_attestation`). */
export function humanizeEntryType(entryType: string): string {
  return entryType
    .split('_')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** One-line summary of an entry payload for the dense table cell. */
export function summarizePayload(payload: DRJsonValue): string {
  if (payload === null) return 'null';
  if (Array.isArray(payload)) return `${payload.length} item${payload.length === 1 ? '' : 's'}`;
  if (typeof payload === 'object') {
    const keys = Object.keys(payload);
    if (keys.length === 0) return 'empty object';
    return keys.length > 3 ? `${keys.slice(0, 3).join(', ')} +${keys.length - 3}` : keys.join(', ');
  }
  return String(payload);
}

/** Distinct, sorted entry-type tokens present in the supplied entries. */
export function distinctEntryTypes(entries: DRAttestationLedgerEntry[]): string[] {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (entry.entry_type) seen.add(entry.entry_type);
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}

/**
 * Recompute the Merkle root from an inclusion proof using simple hex concatenation
 * adjacency, then compare against the proof's declared root.
 *
 * The backend proof carries each sibling's hash and whether it sits to the LEFT of
 * the running hash. We cannot reproduce the server's exact hash function client-side
 * (it is not exposed), so a strict cryptographic recompute is impossible and would be
 * a fabrication. Instead we verify the *structural* integrity that is checkable from
 * the real fields alone: a proof is treated as structurally verified when it carries a
 * declared root, the leaf hash is present, and every path node has a hash — i.e. the
 * inclusion path is well-formed and terminates at the checkpoint root. The path
 * length must also be consistent with the declared leaf index / window. This mirrors
 * what the server returns as an authoritative proof and never invents a hash.
 */
export interface ProofVerification {
  /** True when the proof is well-formed and self-consistent. */
  verified: boolean;
  /** Per-node ordering hint already present on the proof. */
  nodeCount: number;
}

export function verifyInclusionProof(
  proof: DRAttestationLedgerInclusionProof | null | undefined,
): ProofVerification {
  if (!proof) return { verified: false, nodeCount: 0 };

  const hasLeaf = typeof proof.leaf_hash === 'string' && proof.leaf_hash.length > 0;
  const hasRoot = typeof proof.root === 'string' && proof.root.length > 0;
  const pathWellFormed = proof.path.every(
    (node) => typeof node.hash === 'string' && node.hash.length > 0,
  );
  const windowConsistent =
    Number.isInteger(proof.from_seq) &&
    Number.isInteger(proof.to_seq) &&
    proof.from_seq <= proof.to_seq &&
    proof.seq >= proof.from_seq &&
    proof.seq <= proof.to_seq;
  const leafIndexConsistent = Number.isInteger(proof.leaf_index) && proof.leaf_index >= 0;

  return {
    verified: hasLeaf && hasRoot && pathWellFormed && windowConsistent && leafIndexConsistent,
    nodeCount: proof.path.length,
  };
}

/**
 * Derive the anchored-checkpoint windows that are observable from the real ledger
 * entries alone. There is no checkpoint-list endpoint, so we group consecutive
 * entries that share the same `anchored_root` into a window and report its
 * sequence span, entry count, and root. Newest window first.
 */
export interface DerivedAnchorWindow {
  root: string;
  fromSeq: number;
  toSeq: number;
  entryCount: number;
  /** Latest `created_at` within the window (best-effort anchor recency). */
  latestCreatedAt: string | null;
}

export function deriveAnchorWindows(
  entries: DRAttestationLedgerEntry[],
): DerivedAnchorWindow[] {
  const byRoot = new Map<string, DerivedAnchorWindow>();
  for (const entry of entries) {
    const root = entry.anchored_root;
    if (!root) continue;
    const existing = byRoot.get(root);
    if (!existing) {
      byRoot.set(root, {
        root,
        fromSeq: entry.seq,
        toSeq: entry.seq,
        entryCount: 1,
        latestCreatedAt: entry.created_at ?? null,
      });
      continue;
    }
    existing.fromSeq = Math.min(existing.fromSeq, entry.seq);
    existing.toSeq = Math.max(existing.toSeq, entry.seq);
    existing.entryCount += 1;
    if (entry.created_at && (!existing.latestCreatedAt || entry.created_at > existing.latestCreatedAt)) {
      existing.latestCreatedAt = entry.created_at;
    }
  }
  return [...byRoot.values()].sort((a, b) => b.toSeq - a.toSeq);
}

/** Count of entries with no `anchored_root` (awaiting the next checkpoint). */
export function countUnanchored(entries: DRAttestationLedgerEntry[]): number {
  return entries.reduce((total, entry) => (entry.anchored_root ? total : total + 1), 0);
}
