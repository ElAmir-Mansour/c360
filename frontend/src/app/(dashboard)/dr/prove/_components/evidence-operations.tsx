'use client';

import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { DRAttestationLedgerEntry, DRFailoverRun } from '@/lib/clario-dr';
import {
  useEvidenceOperationsLabels,
  type EvidenceOperationsLabels,
} from './prove-labels';

/**
 * EvidenceOperations
 * ==================
 * Extracted verbatim from the legacy `/dr` monolith's `evidence` tab (the inline
 * `EvidenceOperations` helper and its private dependencies). It summarises the
 * tenant's immutable evidence posture — WORM-locked attestation reports, the
 * hash-chain status, recency, the latest attestation, framework control results,
 * and an evidence library table — all derived from the real attestation-ledger
 * entries (`DRAttestationLedgerEntry[]`) and completed failover runs
 * (`DRFailoverRun[]`), with no fabricated fields.
 *
 * The derivation (`buildEvidenceSummary`) is the monolith's exact logic, kept
 * here so the prove route renders byte-identical evidence content. The component
 * is read-only; the write actions (proof / anchor / BCM assess) live alongside
 * it in the prove page via the shared action hooks.
 */

// ---------------------------------------------------------------------------
// Derived "like" shapes the evidence summary is built into (from the monolith).
// ---------------------------------------------------------------------------

export type EvidenceReportLike = {
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

export type EvidenceSummaryLike = {
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

/** Minimal run shape used for the completed-run evidence fallback. */
type RunLike = Pick<
  DRFailoverRun,
  'id' | 'group_id' | 'mode' | 'status' | 'rto_actual_seconds' | 'completed_at' | 'updated_at'
> & {
  run_id?: string;
  group_name?: string | null;
  met_rto?: boolean | null;
};

// ---------------------------------------------------------------------------
// Evidence summary builder + helpers (copied verbatim from the monolith).
// ---------------------------------------------------------------------------

export function buildEvidenceSummary(
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

// ---------------------------------------------------------------------------
// Read-only evidence panel.
// ---------------------------------------------------------------------------

export function EvidenceOperations({
  evidence,
  runs,
  loading,
  error,
  onRetry,
}: {
  evidence?: EvidenceSummaryLike;
  runs: RunLike[];
  loading: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  const labels = useEvidenceOperationsLabels();
  const reports = evidence?.reports ?? latestCompletedRunsAsEvidence(runs);

  if (loading && !evidence) {
    return <LoadingSkeleton variant="card" count={3} />;
  }

  if (error && !evidence) {
    return <ErrorState message={labels.loadError} onRetry={onRetry} />;
  }

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[0.85fr_1.15fr]">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{labels.postureTitle}</CardTitle>
          <CardDescription>{labels.postureDescription}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <MetricTile label={labels.metricReports} value={reports.length} />
            <MetricTile
              label={labels.metricWormLocked}
              value={evidence?.worm_locked_count ?? evidence?.immutable_reports ?? reports.length}
            />
            <MetricTile
              label={labels.metricHashChain}
              value={labelFor(evidence?.hash_chain_status ?? 'healthy', labels)}
            />
            <MetricTile
              label={labels.metricRecency}
              value={formatDays(evidence?.evidence_recency_days, labels)}
            />
          </div>
          <div className="rounded-lg border bg-muted/20 p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <div className="text-sm font-medium">{labels.latestAttestation}</div>
                <div className="font-mono text-xs text-muted-foreground">
                  {evidence?.latest_attestation?.id ??
                    evidence?.latest_attestation?.report_id ??
                    reports[0]?.id ??
                    labels.noAttestation}
                </div>
              </div>
              <StatusBadge
                status={
                  evidence?.latest_attestation?.result ??
                  evidence?.latest_attestation?.status ??
                  reports[0]?.status ??
                  'empty'
                }
                labels={labels}
              />
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <MiniDatum
                label={labels.miniRtoActual}
                value={formatSeconds(
                  evidence?.latest_attestation?.rto_actual_seconds ?? reports[0]?.rto_actual_seconds,
                  labels,
                )}
              />
              <MiniDatum
                label={labels.miniRpo}
                value={formatSeconds(
                  evidence?.latest_attestation?.rpo_seconds ?? reports[0]?.rpo_seconds,
                  labels,
                )}
              />
              <MiniDatum
                label={labels.miniCreated}
                value={formatDateTime(
                  evidence?.latest_attestation?.created_at ??
                    evidence?.latest_attestation?.generated_at ??
                    reports[0]?.created_at,
                  labels,
                )}
              />
              <MiniDatum
                label={labels.miniHash}
                value={shortHash(
                  evidence?.latest_attestation?.content_hash ?? reports[0]?.content_hash,
                  labels,
                )}
              />
            </div>
          </div>
          <div className="space-y-2">
            {(evidence?.control_results ?? []).slice(0, 5).map((control) => (
              <div
                key={control.control}
                className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
              >
                <div>
                  <div className="text-sm font-medium">
                    {control.control
                      ? labels.controlLabels[control.control] ?? control.control
                      : control.control}
                  </div>
                  <div className="font-mono text-xs text-muted-foreground">
                    {control.evidence_ref ?? labels.noRef}
                  </div>
                </div>
                <StatusBadge status={control.status ?? 'empty'} labels={labels} />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{labels.libraryTitle}</CardTitle>
          <CardDescription>{labels.libraryDescription}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{labels.colReport}</TableHead>
                  <TableHead>{labels.colGroup}</TableHead>
                  <TableHead>{labels.colType}</TableHead>
                  <TableHead>{labels.colResult}</TableHead>
                  <TableHead>{labels.colHash}</TableHead>
                  <TableHead>{labels.colGenerated}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reports.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-sm text-muted-foreground">
                      {labels.noReports}
                    </TableCell>
                  </TableRow>
                ) : (
                  reports.map((report) => (
                    <TableRow key={report.id ?? report.report_id ?? report.run_id}>
                      <TableCell>
                        <div className="font-mono text-xs">
                          {report.id ?? report.report_id ?? report.run_id}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {report.report_object_key ?? labels.indexedEvidence}
                        </div>
                      </TableCell>
                      <TableCell>{report.group_name ?? report.group_id ?? '-'}</TableCell>
                      <TableCell className="capitalize">
                        {(report.type ?? 'attestation').replace(/_/g, ' ')}
                      </TableCell>
                      <TableCell>
                        <StatusBadge
                          status={report.result ?? report.status ?? 'healthy'}
                          labels={labels}
                        />
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {shortHash(report.content_hash, labels)}
                      </TableCell>
                      <TableCell>
                        {formatDateTime(report.created_at ?? report.generated_at, labels)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Private presentational + formatting helpers (copied verbatim from monolith).
// ---------------------------------------------------------------------------

function MetricTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border bg-muted/20 px-3 py-2">
      <div className="text-overline font-semibold uppercase text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold">{value}</div>
    </div>
  );
}

function MiniDatum({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="min-w-0">
      <div className="text-overline font-semibold uppercase text-muted-foreground">{label}</div>
      <div className="mt-1 truncate font-medium">{value}</div>
    </div>
  );
}

function StatusBadge({
  status,
  label,
  labels,
}: {
  status: string;
  label?: string;
  labels: EvidenceOperationsLabels;
}) {
  const normalized = normalizeStatus(status);
  const variant =
    normalized === 'critical' || normalized === 'failed' || normalized === 'error'
      ? 'destructive'
      : normalized === 'warning' ||
          normalized === 'degraded' ||
          normalized === 'paused' ||
          normalized === 'awaiting_approval'
        ? 'warning'
        : normalized === 'healthy' ||
            normalized === 'completed' ||
            normalized === 'passed' ||
            normalized === 'attested'
          ? 'success'
          : 'outline';

  return (
    <Badge variant={variant} className="max-w-full normal-case">
      <span className="truncate">{label ?? labelFor(normalized, labels)}</span>
    </Badge>
  );
}

function normalizeStatus(status?: string | null) {
  return (status ?? 'empty').toLowerCase().replace(/\s+/g, '_');
}

function labelFor(status: string | null | undefined, labels: EvidenceOperationsLabels) {
  const normalized = normalizeStatus(status);
  return labels.healthLabels[normalized] ?? normalized.replace(/_/g, ' ');
}

function formatSeconds(seconds: number | null | undefined, labels: EvidenceOperationsLabels) {
  if (seconds === undefined || seconds === null || Number.isNaN(seconds)) return labels.notAvailable;
  if (seconds < 60) return `${Math.max(0, Math.round(seconds))}s`;
  const mins = Math.floor(seconds / 60);
  const rem = Math.round(seconds % 60);
  if (mins < 60) return rem > 0 ? `${mins}m ${rem}s` : `${mins}m`;
  const hours = Math.floor(mins / 60);
  const minRem = mins % 60;
  return minRem > 0 ? `${hours}h ${minRem}m` : `${hours}h`;
}

function formatDays(days: number | null | undefined, labels: EvidenceOperationsLabels) {
  if (days === undefined || days === null) return labels.notAvailable;
  if (days === 0) return labels.today;
  return labels.daysSuffix(days);
}

function formatDateTime(value: string | Date | null | undefined, labels: EvidenceOperationsLabels) {
  if (!value) return labels.notAvailable;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return labels.notAvailable;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function shortHash(value: string | null | undefined, labels: EvidenceOperationsLabels) {
  if (!value) return labels.notAvailable;
  if (value.length <= 12) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
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
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : undefined;
}
