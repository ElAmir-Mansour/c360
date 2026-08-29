'use client';

import { useMemo } from 'react';
import {
  CloudCog,
  KeyRound,
  Landmark,
  LockKeyhole,
  type LucideIcon,
} from 'lucide-react';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import type {
  DRAttestationLedgerEntry,
  DRBCMPack,
  DRBYOKKey,
  DRFailoverRun,
  DRPosture,
} from '@/types/clario-dr';
import {
  type SovereignReadinessLabels,
  useSovereignReadinessLabels,
} from './sovereign-readiness-labels';

/**
 * Sovereign readiness panel for the Recovery Operations Console — extracted from
 * the original `/dr` monolith's inline `SovereignReadiness` helper.
 *
 * The monolith derived an `evidence` summary (from the attestation ledger plus
 * failover runs) and a `readiness` summary (from BCM packs, BYOK keys, posture,
 * and that evidence), then rendered residency / immutable-recovery / encryption /
 * air-gap controls plus framework coverage. To keep the readiness route page
 * clean and self-contained, this component now takes the *raw* live query data
 * and rebuilds those two summaries internally via the same byte-for-byte helpers,
 * so the rendered UI and derivations match the monolith exactly.
 *
 * Every helper, type alias, and JSX block below is copied verbatim from the
 * monolith (`page.tsx`) so there is no behavioural drift; only the wiring shape
 * (raw inputs instead of pre-built summaries) is new.
 */

// ---------------------------------------------------------------------------
// Internal structural types (copied verbatim from the monolith).
// `DRFailoverRun[]` / `DRPosture` are structurally assignable to these because
// every field below is optional.
// ---------------------------------------------------------------------------

type Health = 'healthy' | 'warning' | 'critical' | 'paused' | 'seeding' | 'empty' | string;

type StreamLike = {
  stream_id?: string;
  rpo_seconds?: number | null;
  rpo_objective_seconds?: number;
};

type RunLike = {
  id?: string;
  run_id?: string;
  group_id?: string | null;
  group_name?: string | null;
  mode?: string;
  status?: string;
  recovery_point_id?: string | null;
  rto_objective_seconds?: number;
  rto_actual_seconds?: number | null;
  met_rto?: boolean | null;
  initiated_by?: string;
  approved_by?: string | null;
  initiated_at?: string | Date;
  completed_at?: string | Date | null;
  last_error?: string | null;
  updated_at?: string | Date;
};

type PostureLike = {
  generated_at?: string | Date;
  recovery_point_count?: number;
  attention?: Array<{ severity?: string; kind?: string; message?: string }>;
};

type EvidenceReportLike = {
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
  generated_at?: string | Date;
  frameworks?: string[];
};

type EvidenceSummaryLike = {
  generated_at?: string | Date;
  latest_attestation?: EvidenceReportLike | null;
  reports?: EvidenceReportLike[];
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
};

type ReadinessLike = {
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
};

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

// ---------------------------------------------------------------------------
// Shared formatting helpers (copied verbatim from the monolith).
// ---------------------------------------------------------------------------

function normalizeStatus(status?: string | null) {
  return (status ?? 'empty').toLowerCase().replace(/\s+/g, '_');
}

function labelFor(status?: string | null, health?: Record<string, string>) {
  const normalized = normalizeStatus(status);
  return (health ?? HEALTH_LABELS)[normalized] ?? normalized.replace(/_/g, ' ');
}

function clampPercent(value?: number | null) {
  if (value === undefined || value === null || Number.isNaN(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function formatDateTime(value?: string | Date | null) {
  if (!value) return 'n/a';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'n/a';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatGeneratedAt(value: string | Date | null | undefined, L: SovereignReadinessLabels) {
  if (!value) return L.notGenerated;
  return L.updated(formatDateTime(value));
}

function daysSince(value?: string | Date | null) {
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

function stringFromUnknown(value: unknown) {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function numberFromUnknown(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stringArrayFromUnknown(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : undefined;
}

// ---------------------------------------------------------------------------
// Summary builders (copied verbatim from the monolith).
// ---------------------------------------------------------------------------

function latestCompletedRunsAsEvidence(runs: RunLike[]): EvidenceReportLike[] {
  return runs
    .filter((run) => run.status === 'COMPLETED' || run.status === 'ATTESTED')
    .slice(0, 5)
    .map((run) => ({
      id: run.run_id ?? run.id,
      run_id: run.run_id ?? run.id,
      group_id: run.group_id,
      type: run.mode === 'drill' ? 'drill_attestation' : 'failover_attestation',
      result: run.met_rto === false ? 'warning' : 'healthy',
      rto_actual_seconds: run.rto_actual_seconds ?? undefined,
      created_at: run.completed_at ?? run.updated_at,
    }));
}

function buildEvidenceSummary(
  entries: DRAttestationLedgerEntry[] | undefined,
  runs: RunLike[],
): EvidenceSummaryLike {
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
    } satisfies EvidenceReportLike;
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

function buildReadinessSummary(
  packs: DRBCMPack[] | undefined,
  keys: DRBYOKKey[] | undefined,
  posture: PostureLike | undefined,
  evidence: EvidenceSummaryLike,
  L: SovereignReadinessLabels,
): ReadinessLike {
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
    region: L.region,
    residency_status: L.residencyActive,
    data_residency: {
      status: L.residencyActive,
      region: L.region,
      enforced: true,
    },
    air_gap: {
      ready: hasBCMPacks,
      bundle_version: hasBCMPacks ? `${packs?.[0]?.key ?? 'bcm'}:${packs?.[0]?.version ?? 'current'}` : undefined,
      last_verified_at: evidence.generated_at,
    },
    encryption: {
      at_rest: 'AES-256',
      key_custody: activeKeys[0]
        ? `${activeKeys[0].provider} key v${activeKeys[0].key_version}`
        : L.noActiveByokKey,
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
        name: L.ctrlBcmPacks,
        status: hasBCMPacks ? 'healthy' : 'warning',
        detail: hasBCMPacks ? L.packsAvailable(packs?.length ?? 0) : L.noBcmPacks,
      },
      {
        name: L.ctrlByokCustody,
        status: activeKeys.length > 0 ? 'healthy' : 'warning',
        detail: activeKeys[0]?.reference ?? L.noActiveKey,
      },
      {
        name: L.ctrlImmutableEvidence,
        status: hasEvidence ? 'healthy' : 'warning',
        detail: L.attestationRecords(evidence.immutable_reports ?? 0),
      },
      {
        name: L.ctrlOpenAttention,
        status: hasOpenAttention ? 'warning' : 'healthy',
        detail: L.currentAttentionItems(posture?.attention?.length ?? 0),
      },
    ],
  };
}

function defaultReadinessControls(
  L: SovereignReadinessLabels,
  readiness?: ReadinessLike,
  evidence?: EvidenceSummaryLike,
  posture?: PostureLike,
) {
  return [
    {
      name: L.ctrlInRegion,
      status: readiness?.data_residency?.enforced === false ? 'warning' : 'healthy',
      detail: readiness?.data_residency?.region ?? readiness?.region ?? L.regionNotReported,
    },
    {
      name: L.ctrlImmutablePoints,
      status: (evidence?.worm_locked_count ?? posture?.recovery_point_count ?? 0) > 0 ? 'healthy' : 'warning',
      detail: L.lockedRecoveryArtifacts(evidence?.worm_locked_count ?? posture?.recovery_point_count ?? 0),
    },
    {
      name: L.ctrlHumanApproval,
      status: 'healthy',
      detail: L.humanApprovalDetail,
    },
    {
      name: L.ctrlAttestationLedger,
      status: evidence?.hash_chain_status ?? 'healthy',
      detail: L.immutableReportsIndexed(evidence?.immutable_reports ?? 0),
    },
  ];
}

function defaultFrameworks(score: number | null, L: SovereignReadinessLabels) {
  const value = score ?? 0;
  return [
    { name: L.fwNcaEccCcc, score: value, status: value >= 85 ? 'healthy' : 'warning', gaps: value >= 85 ? 0 : 2 },
    { name: L.fwSamaBcm, score: Math.max(0, value - 3), status: value >= 88 ? 'healthy' : 'warning', gaps: value >= 88 ? 0 : 1 },
    { name: L.fwInternalDrPolicy, score: Math.min(100, value + 4), status: value >= 80 ? 'healthy' : 'warning', gaps: value >= 80 ? 0 : 3 },
  ];
}

// ---------------------------------------------------------------------------
// Presentational sub-components (copied verbatim from the monolith).
// ---------------------------------------------------------------------------

function StatusBadge({
  status,
  label,
  health,
}: {
  status: string;
  label?: string;
  health?: Record<string, string>;
}) {
  const normalized = normalizeStatus(status);
  const variant =
    normalized === 'critical' || normalized === 'failed' || normalized === 'error'
      ? 'destructive'
      : normalized === 'warning' || normalized === 'degraded' || normalized === 'paused' || normalized === 'awaiting_approval'
        ? 'warning'
        : normalized === 'healthy' || normalized === 'completed' || normalized === 'passed' || normalized === 'attested'
          ? 'success'
          : 'outline';

  return (
    <Badge variant={variant} className="max-w-full normal-case">
      <span className="truncate">{label ?? labelFor(normalized, health)}</span>
    </Badge>
  );
}

// Map a control's RAG status onto the materialized `.kpi-theme-*` palette so the
// sovereign-control tile rides the accent-orb depth. RAG is preserved: a healthy
// control reads `emerald` (health), a warning/at-risk control reads `amber`
// (watch), a critical control reads `red` (risk). An unknown/empty status falls
// back to the brand/primary accent (slate) so the tile is never flat white.
function controlThemeClass(status: string): string {
  const normalized = normalizeStatus(status);
  if (normalized === 'healthy' || normalized === 'completed' || normalized === 'passed' || normalized === 'attested') {
    return 'kpi-theme-emerald';
  }
  if (normalized === 'critical' || normalized === 'failed' || normalized === 'error') {
    return 'kpi-theme-red';
  }
  if (normalized === 'warning' || normalized === 'degraded' || normalized === 'paused') {
    return 'kpi-theme-amber';
  }
  return 'kpi-theme-primary';
}

// Tone the readiness band (the score gauge) by the readiness score so it is
// never flat white: regulator-ready (>=90) reads emerald (health), a mid band
// (75-89) reads amber (watch/time), a low band (<75) reads red (risk), and an
// unscored band (null) reads the brand/primary accent (slate) as a neutral
// placeholder rather than blank white.
function readinessBandThemeClass(score: number | null): string {
  if (score === null) return 'kpi-theme-primary';
  if (score >= 90) return 'kpi-theme-emerald';
  if (score >= 75) return 'kpi-theme-amber';
  return 'kpi-theme-red';
}

function SovereignControl({
  icon: Icon,
  label,
  value,
  status,
  health,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  status: string;
  health?: Record<string, string>;
}) {
  const themeClass = controlThemeClass(status);
  return (
    <div className={`kpi-card-themed ${themeClass}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="kpi-icon-badge shrink-0">
          <Icon className="h-4 w-4" aria-hidden />
        </div>
        <StatusBadge status={status} health={health} />
      </div>
      <div className="mt-3 text-sm font-medium text-foreground">{label}</div>
      <div className="mt-1 truncate text-xs text-muted-foreground">{value}</div>
    </div>
  );
}

function PercentBar({ value, label }: { value?: number | null; label?: string }) {
  const pct = clampPercent(value) ?? 0;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label ?? `${pct}%`}</span>
        <span className="font-medium">{pct}%</span>
      </div>
      <Progress
        value={pct}
        className="h-2"
        indicatorClassName={pct < 75 ? 'bg-amber-500' : pct < 95 ? 'bg-sky-500' : 'bg-primary'}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Public panel.
// ---------------------------------------------------------------------------

export type SovereignReadinessPanelProps = {
  /** BCM packs (from `useDRBCMPacks`). */
  bcmPacks: DRBCMPack[];
  /** BYOK key material (from `useDRBYOKKeys`). */
  byokKeys: DRBYOKKey[];
  /** Tenant posture (from `useDRPosture`). */
  posture?: DRPosture | null;
  /** Attestation ledger entries (from `useDRAttestationLedger`). */
  attestationLedger: DRAttestationLedgerEntry[];
  /** Failover runs (from `useDRFailoverRuns`), used for the evidence fallback. */
  failoverRuns: DRFailoverRun[];
  loading: boolean;
  error: unknown;
  onRetry: () => void;
};

export function SovereignReadinessPanel({
  bcmPacks,
  byokKeys,
  posture,
  attestationLedger,
  failoverRuns,
  loading,
  error,
  onRetry,
}: SovereignReadinessPanelProps) {
  const L = useSovereignReadinessLabels();
  const evidence = useMemo(
    () => buildEvidenceSummary(attestationLedger, failoverRuns),
    [attestationLedger, failoverRuns],
  );
  const readiness = useMemo(
    () => buildReadinessSummary(bcmPacks, byokKeys, posture ?? undefined, evidence, L),
    [bcmPacks, byokKeys, posture, evidence, L],
  );

  if (loading && !readiness) {
    return <LoadingSkeleton variant="card" count={3} />;
  }

  if (error && !readiness) {
    return (
      <ErrorState
        message={L.loadError}
        error={error}
        onRetry={onRetry}
      />
    );
  }

  const score = clampPercent(readiness?.readiness_score);
  const controls = readiness?.controls ?? defaultReadinessControls(L, readiness, evidence, posture ?? undefined);

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{L.panelTitle}</CardTitle>
          <CardDescription>{L.panelSubtitle}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className={`kpi-card-themed flex items-center gap-5 ${readinessBandThemeClass(score)}`}>
            <div className="relative flex h-24 w-24 shrink-0 items-center justify-center rounded-full border-8 border-primary/15">
              <div
                className="absolute -inset-2 rounded-full border-8 border-primary"
                style={{ clipPath: `inset(${score === null ? 100 : 100 - score}% 0 0 0)` }}
                aria-hidden
              />
              <div className="relative text-center">
                <div className="text-2xl font-semibold">{score === null ? L.naLabel : score}</div>
                <div className="text-xs uppercase text-muted-foreground">{L.scoreCaption}</div>
              </div>
            </div>
            <div className="min-w-0 space-y-2">
              <StatusBadge status={score !== null && score >= 90 ? 'healthy' : 'warning'} label={score !== null && score >= 90 ? L.regulatorReady : L.needsReview} />
              <div className="text-sm text-muted-foreground">
                {L.regionGenerated(
                  readiness?.data_residency?.region ?? readiness?.region ?? L.notReported,
                  formatGeneratedAt(readiness?.generated_at, L),
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <SovereignControl icon={Landmark} label={L.dataResidency} value={readiness?.data_residency?.status ?? readiness?.residency_status ?? L.notReported} status={readiness?.data_residency?.enforced === false ? 'warning' : 'healthy'} health={L.health} />
            <SovereignControl icon={LockKeyhole} label={L.recoveryPoints} value={L.wormItems(evidence?.worm_locked_count ?? posture?.recovery_point_count ?? 0)} status="healthy" health={L.health} />
            <SovereignControl icon={KeyRound} label={L.keyCustody} value={readiness?.encryption?.key_custody ?? L.tenantKms} status={readiness?.encryption?.rotation_status ?? 'healthy'} health={L.health} />
            <SovereignControl icon={CloudCog} label={L.airGap} value={readiness?.air_gap?.bundle_version ?? L.bundleNotReported} status={readiness?.air_gap?.ready === false ? 'warning' : 'healthy'} health={L.health} />
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{L.readinessControlsTitle}</CardTitle>
            <CardDescription>{L.readinessControlsSubtitle}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {controls.map((control) => (
              <div key={control.name} className="flex items-center justify-between gap-4 rounded-lg border px-4 py-3">
                <div className="min-w-0">
                  <div className="font-medium">{control.name}</div>
                  <div className="truncate text-xs text-muted-foreground">{control.detail ?? L.noDetail}</div>
                </div>
                <StatusBadge status={control.status ?? 'empty'} health={L.health} />
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{L.frameworkCoverageTitle}</CardTitle>
            <CardDescription>{L.frameworkCoverageSubtitle}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {(readiness?.frameworks ?? defaultFrameworks(score, L)).map((framework) => (
              <div key={framework.name} className="space-y-2 rounded-lg border px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-medium">{framework.name}</div>
                  <StatusBadge status={framework.status ?? 'healthy'} health={L.health} />
                </div>
                <PercentBar value={framework.score} label={`${framework.score ?? 0}%`} />
                <div className="text-xs text-muted-foreground">{L.openGaps(framework.gaps ?? 0)}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
