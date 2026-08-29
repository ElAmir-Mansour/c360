/**
 * Overview-route derivation helpers for the ClarioDR Recovery Operations Console.
 *
 * These are extracted verbatim from the original `/dr` monolith's inline helpers
 * so the overview's "single pane of glass" derives its evidence/readiness rollups
 * and recovery-point selection from the SAME real DR data with identical logic.
 * Nothing here invents fields: every derivation reads documented `@/types/clario-dr`
 * / `@/lib/clario-dr` shapes (`DRAttestationLedgerEntry`, `DRBCMPack`, `DRBYOKKey`,
 * `DRPosture`, `DRFailoverRunSummary`, `DRRecoveryPointSummary`).
 *
 * Namespaced under `_components/overview/` so it never collides with the helper
 * modules other console-route agents extract.
 */

import type {
  DRAttestationLedgerEntry,
  DRBCMPack,
  DRBYOKKey,
  DRFailoverRunSummary,
  DRGroupRollup,
  DRPosture,
  DRRecoveryPointSummary,
} from '@/lib/clario-dr';

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

/** Evidence report row derived from the attestation ledger or completed runs. */
export interface OverviewEvidenceReport {
  id?: string;
  report_id?: string;
  run_id?: string;
  group_id?: string | null;
  group_name?: string | null;
  type?: string;
  result?: string;
  status?: string;
  rto_actual_seconds?: number;
  rpo_seconds?: number;
  content_hash?: string;
  report_object_key?: string;
  created_at?: string | Date;
  frameworks?: string[];
}

/** Evidence rollup consumed by `CyberVaultCompliancePanel` + `DROperatorActions`. */
export interface OverviewEvidenceSummary {
  generated_at?: string | Date;
  latest_attestation?: OverviewEvidenceReport | null;
  reports?: OverviewEvidenceReport[];
  immutable_reports?: number;
  worm_locked_count?: number;
  hash_chain_status?: string;
  evidence_recency_days?: number;
  control_results?: Array<{
    control?: string;
    status?: string;
    evidence_ref?: string;
    updated_at?: string | Date;
  }>;
}

/** Readiness rollup consumed by `CyberVaultCompliancePanel`. */
export interface OverviewReadinessSummary {
  generated_at?: string | Date;
  readiness_score?: number;
  region?: string;
  residency_status?: string;
  data_residency?: {
    status?: string;
    region?: string;
    enforced?: boolean;
  };
  air_gap?: {
    ready?: boolean;
    bundle_version?: string;
    last_verified_at?: string | Date;
  };
  encryption?: {
    at_rest?: string;
    key_custody?: string;
    rotation_status?: string;
  };
  frameworks?: Array<{
    name?: string;
    score?: number;
    status?: string;
    gaps?: number;
  }>;
  controls?: Array<{
    name?: string;
    status?: string;
    detail?: string;
  }>;
}

export function normalizeStatus(status?: string | null): string {
  return (status ?? 'empty').toLowerCase().replace(/\s+/g, '_');
}

export function labelFor(status?: string | null): string {
  const normalized = normalizeStatus(status);
  return HEALTH_LABELS[normalized] ?? normalized.replace(/_/g, ' ');
}

export function clampPercent(value?: number | null): number | null {
  if (value === undefined || value === null || Number.isNaN(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function formatSeconds(seconds?: number | null): string {
  if (seconds === undefined || seconds === null || Number.isNaN(seconds)) return 'n/a';
  if (seconds < 60) return `${Math.max(0, Math.round(seconds))}s`;
  const mins = Math.floor(seconds / 60);
  const rem = Math.round(seconds % 60);
  if (mins < 60) return rem > 0 ? `${mins}m ${rem}s` : `${mins}m`;
  const hours = Math.floor(mins / 60);
  const minRem = mins % 60;
  return minRem > 0 ? `${hours}h ${minRem}m` : `${hours}h`;
}

function timestampMs(value?: string | Date | null): number {
  if (!value) return 0;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function daysSince(value?: string | Date | null): number | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / 86_400_000));
}

function objectFromUnknown(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function stringFromUnknown(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function numberFromUnknown(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stringArrayFromUnknown(value: unknown): string[] | undefined {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : undefined;
}

/** Latest sealed recovery point across the protection-group rollups. */
export function selectLatestRecoveryPoint(
  groups: DRGroupRollup[],
): DRRecoveryPointSummary | null {
  return [...groups]
    .map((group) => group.latest_recovery_point)
    .filter((point): point is DRRecoveryPointSummary => Boolean(point?.id))
    .sort((left, right) => timestampMs(right.sealed_at) - timestampMs(left.sealed_at))[0] ?? null;
}

function latestCompletedRunsAsEvidence(
  runs: DRFailoverRunSummary[],
): OverviewEvidenceReport[] {
  return runs
    .filter((run) => run.status === 'COMPLETED' || run.status === 'ATTESTED')
    .slice(0, 5)
    .map((run) => ({
      id: run.run_id,
      run_id: run.run_id,
      group_id: run.group_id,
      type: run.mode === 'drill' ? 'drill_attestation' : 'failover_attestation',
      result: run.met_rto === false ? 'warning' : 'healthy',
      rto_actual_seconds: run.rto_actual_seconds ?? undefined,
      created_at: run.completed_at ?? run.initiated_at,
    }));
}

/**
 * Build the evidence rollup from the attestation ledger (preferred) or the most
 * recent completed runs. Byte-identical logic to the monolith's
 * `buildEvidenceSummary`, retyped to the real summary shapes.
 */
export function buildEvidenceSummary(
  entries: DRAttestationLedgerEntry[] | undefined,
  runs: DRFailoverRunSummary[],
): OverviewEvidenceSummary {
  const attestationEntries = (entries ?? []).filter((entry) =>
    entry.entry_type.toLowerCase().includes('attestation'),
  );
  const ledgerReports = attestationEntries.map((entry) => {
    const payload = objectFromUnknown(entry.payload);
    return {
      id: entry.subject_id || entry.id,
      report_id: entry.subject_id || entry.id,
      run_id: stringFromUnknown(payload.run_id) ?? stringFromUnknown(payload.runID),
      group_id: stringFromUnknown(payload.group_id),
      group_name: stringFromUnknown(payload.group_name),
      type: entry.entry_type,
      result: stringFromUnknown(payload.result) ?? stringFromUnknown(payload.status) ?? 'healthy',
      rto_actual_seconds: numberFromUnknown(payload.rto_actual_seconds),
      rpo_seconds: numberFromUnknown(payload.rpo_seconds),
      content_hash: entry.entry_hash || entry.payload_hash,
      report_object_key: stringFromUnknown(payload.report_object_key),
      created_at: entry.created_at,
      frameworks: stringArrayFromUnknown(payload.frameworks),
    } satisfies OverviewEvidenceReport;
  });
  const reports = ledgerReports.length > 0 ? ledgerReports : latestCompletedRunsAsEvidence(runs);
  const latest = reports[0] ?? null;
  const hashChainHealthy = (entries ?? []).every((entry) => Boolean(entry.entry_hash));

  return {
    generated_at: latest?.created_at ?? entries?.[0]?.created_at,
    latest_attestation: latest,
    reports,
    immutable_reports: reports.length,
    worm_locked_count: reports.length,
    hash_chain_status: hashChainHealthy ? 'healthy' : 'warning',
    evidence_recency_days: daysSince(latest?.created_at),
    control_results: [
      {
        control: 'Gate-4 attestation ledger',
        status: reports.length > 0 ? 'healthy' : 'warning',
        evidence_ref: latest?.id ?? 'no-attestation',
        updated_at: latest?.created_at,
      },
      {
        control: 'Hash-chain continuity',
        status: hashChainHealthy ? 'healthy' : 'warning',
        evidence_ref: entries?.[0]?.entry_hash,
        updated_at: entries?.[0]?.created_at,
      },
      {
        control: 'Immutable evidence retention',
        status: reports.length > 0 ? 'healthy' : 'warning',
        evidence_ref: latest?.report_object_key ?? latest?.content_hash,
        updated_at: latest?.created_at,
      },
    ],
  };
}

/**
 * Build the sovereign-readiness rollup from BCM packs, BYOK keys, posture, and the
 * evidence rollup. Byte-identical logic to the monolith's `buildReadinessSummary`.
 */
export function buildReadinessSummary(
  packs: DRBCMPack[] | undefined,
  keys: DRBYOKKey[] | undefined,
  posture: DRPosture | undefined,
  evidence: OverviewEvidenceSummary,
): OverviewReadinessSummary {
  const activeKeys = (keys ?? []).filter((key) => key.state === 'active');
  const hasBCMPacks = (packs ?? []).length > 0;
  const hasEvidence = (evidence.reports ?? []).length > 0;
  const hasRecoveryPoints = (posture?.recovery_point_count ?? 0) > 0;
  const hasOpenAttention = (posture?.attention ?? []).length > 0;
  const score = clampPercent(
    70 +
      (hasBCMPacks ? 10 : 0) +
      (activeKeys.length > 0 ? 8 : 0) +
      (hasEvidence ? 7 : 0) +
      (hasRecoveryPoints ? 5 : 0) -
      (hasOpenAttention ? 8 : 0),
  );

  return {
    generated_at: evidence.generated_at ?? posture?.generated_at,
    readiness_score: score ?? undefined,
    region: 'tenant DR region',
    residency_status: 'sovereign controls active',
    data_residency: {
      status: 'sovereign controls active',
      region: 'tenant DR region',
      enforced: true,
    },
    air_gap: {
      ready: hasBCMPacks,
      bundle_version: hasBCMPacks
        ? `${packs?.[0]?.key ?? 'bcm'}:${packs?.[0]?.version ?? 'current'}`
        : undefined,
      last_verified_at: evidence.generated_at,
    },
    encryption: {
      at_rest: 'AES-256',
      key_custody: activeKeys[0]
        ? `${activeKeys[0].provider} key v${activeKeys[0].key_version}`
        : 'no active BYOK key reported',
      rotation_status: activeKeys.length > 0 ? 'healthy' : 'warning',
    },
    frameworks: (packs ?? []).slice(0, 4).map((pack) => ({
      name: `${pack.standard} ${pack.version}`,
      score: score ?? 0,
      status: score !== null && score >= 85 ? 'healthy' : 'warning',
      gaps: score !== null && score >= 85 ? 0 : 1,
    })),
    controls: [
      {
        name: 'BCM compliance packs',
        status: hasBCMPacks ? 'healthy' : 'warning',
        detail: hasBCMPacks ? `${packs?.length ?? 0} packs available` : 'No BCM packs returned',
      },
      {
        name: 'BYOK key custody',
        status: activeKeys.length > 0 ? 'healthy' : 'warning',
        detail: activeKeys[0]?.reference ?? 'No active key returned',
      },
      {
        name: 'Immutable recovery evidence',
        status: hasEvidence ? 'healthy' : 'warning',
        detail: `${evidence.immutable_reports ?? 0} attestation records`,
      },
      {
        name: 'Open DR attention',
        status: hasOpenAttention ? 'warning' : 'healthy',
        detail: `${posture?.attention?.length ?? 0} current attention items`,
      },
    ],
  };
}
