'use client';

import {
  CheckCircle2,
  CircleDashed,
  Swords,
} from 'lucide-react';
import { ErrorState } from '@/components/common/error-state';
import { EmptyState } from '@/components/common/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { TONE_THEME_CLASS, type StatTone } from '@/components/shared/stat-card';
import type { DRFailoverRun } from '@/types/clario-dr';
import { useRecoverStateLabels, type RecoverStateLabels } from './recover-labels';

/**
 * Failover-runs table + the four-gate visual, extracted verbatim from the
 * monolith's inline `FailoverOperations` helper (the "Failover runs" tab) and
 * namespaced for the Recover route. The only addition over the monolith is the
 * `onOpenRun` row affordance, which deep-links the live execution view at
 * `/dr/runs/[id]` — the Cutover-style drill-in.
 *
 * Consumes the real `DRFailoverRun` contract; no invented fields, no stubs.
 */

/** Minimal group shape used only to resolve a run's group display name. */
export interface FailoverGroupRef {
  id?: string;
  group_id?: string;
  groupId?: string;
  name?: string | null;
}

const GATE_KEYS = ['validate', 'approve', 'execute', 'attest'] as const;

const FAILOVER_GATE_BY_STATUS: Record<string, number> = {
  INITIATED: 0,
  QUIESCING: 0,
  SYNC_CONFIRMED: 1,
  AWAITING_APPROVAL: 1,
  APPROVED: 2,
  EXECUTING: 2,
  VALIDATING: 2,
  ATTESTED: 3,
  COMPLETED: 4,
  FAILED: 0,
  CANCELLED: 0,
  ROLLED_BACK: 0,
};

export function FailoverOperations({
  runs,
  activeRun,
  gateIndex,
  groups,
  error,
  onRetry,
  onOpenRun,
  onDeclareRun,
  canDeclareRun = false,
}: {
  runs: DRFailoverRun[];
  activeRun?: DRFailoverRun | null;
  gateIndex: number;
  groups: FailoverGroupRef[];
  error: unknown;
  onRetry: () => void;
  onOpenRun?: (runID: string) => void;
  /** Declares a drill/failover run from the empty state (dr:write-gated upstream). */
  onDeclareRun?: () => void;
  /** When false the empty-state declare CTA is omitted (no write permission / no group). */
  canDeclareRun?: boolean;
}) {
  const L = useRecoverStateLabels();
  const fo = L.failoverOps;
  if (error && runs.length === 0) {
    return <ErrorState message={fo.loadError} onRetry={onRetry} />;
  }

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <div className="space-y-4">
        <FourGateFailoverVisual run={activeRun} gateIndex={gateIndex} labels={L} />
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{fo.activeRunTitle}</CardTitle>
            <CardDescription>{fo.activeRunDescription}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {activeRun ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <MetricTile label={fo.colMode} value={activeRun.mode ?? fo.unknown} tone="slate" />
                  <MetricTile
                    label={fo.colStatus}
                    value={activeRun.status ?? fo.unknown}
                    tone={statusTone(activeRun.status)}
                  />
                  <MetricTile
                    label={fo.rtoTarget}
                    value={formatSeconds(activeRun.rto_objective_seconds)}
                    tone="gold"
                  />
                  <MetricTile
                    label={fo.rtoActual}
                    value={formatSeconds(activeRun.rto_actual_seconds)}
                    tone={rtoActualTone(activeRun)}
                  />
                </div>
                <div className="rounded-lg border bg-muted/20 p-3">
                  <div className="mb-2 text-sm font-medium">{fo.runLogPreview}</div>
                  <div className="space-y-2 font-mono text-xs text-muted-foreground">
                    {runLogLines(activeRun).map((line) => (
                      <div key={line}>{line}</div>
                    ))}
                  </div>
                </div>
                {onOpenRun ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => onOpenRun(activeRun.id)}
                  >
                    {fo.openLiveExecution}
                  </Button>
                ) : null}
              </>
            ) : (
              <EmptyState
                icon={CircleDashed}
                title={L.noActiveRunTitle}
                description={L.noActiveRunDescription}
                size="compact"
              />
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle className="text-base">{fo.runsTitle}</CardTitle>
            <CardDescription>{fo.runsDescription}</CardDescription>
          </div>
          <Badge variant="outline">{fo.runsBadge(runs.length)}</Badge>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{fo.colRun}</TableHead>
                  <TableHead>{fo.colGroup}</TableHead>
                  <TableHead>{fo.colMode}</TableHead>
                  <TableHead>{fo.colStatus}</TableHead>
                  <TableHead>{fo.colRto}</TableHead>
                  <TableHead>{fo.colStarted}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="p-0">
                      <EmptyState
                        icon={Swords}
                        title={L.noRunsTitle}
                        description={L.noRunsDescription}
                        action={
                          canDeclareRun && onDeclareRun
                            ? { label: L.noRunsAction, onClick: onDeclareRun }
                            : undefined
                        }
                        size="compact"
                      />
                    </TableCell>
                  </TableRow>
                ) : (
                  runs.map((run) => (
                    <TableRow
                      key={run.id}
                      className={cn(onOpenRun && 'cursor-pointer')}
                      onClick={() => onOpenRun?.(run.id)}
                    >
                      <TableCell>
                        <div className="font-mono text-xs">{run.id}</div>
                        <div className="text-xs text-muted-foreground">{run.recovery_point_id ?? fo.noRecoveryPointPinned}</div>
                      </TableCell>
                      <TableCell>{groupName(run.group_id, groups)}</TableCell>
                      <TableCell className="capitalize">{run.mode ?? '-'}</TableCell>
                      <TableCell><StatusBadge status={run.status ?? 'empty'} labels={L} /></TableCell>
                      <TableCell>
                        <div className="font-medium">{formatSeconds(run.rto_actual_seconds)}</div>
                        <div className="text-xs text-muted-foreground">{fo.rtoTargetPrefix} {formatSeconds(run.rto_objective_seconds)}</div>
                      </TableCell>
                      <TableCell>{formatDateTime(run.initiated_at)}</TableCell>
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

function FourGateFailoverVisual({
  run,
  gateIndex,
  labels,
}: {
  run?: DRFailoverRun | null;
  gateIndex: number;
  labels: RecoverStateLabels;
}) {
  const fo = labels.failoverOps;
  const currentLabel = run ? `${run.mode ?? 'run'} / ${run.status ?? fo.unknown}` : fo.noActiveRun;
  const progress = gateIndex >= 4 ? 100 : Math.max(6, gateIndex * 25 + (run ? 12 : 0));

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle className="text-base">{fo.fourGateTitle}</CardTitle>
          <CardDescription>{fo.fourGateDescription}</CardDescription>
        </div>
        <StatusBadge status={run?.status ?? 'empty'} label={currentLabel} labels={labels} />
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          {GATE_KEYS.map((gateKey, index) => {
            const done = gateIndex > index;
            const active = gateIndex === index && Boolean(run);
            return (
              <div
                key={gateKey}
                className={cn(
                  'rounded-lg border bg-muted/20 p-3',
                  done && 'border-primary/30 bg-primary/5',
                  active && 'border-amber-300 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/20',
                )}
              >
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div
                    className={cn(
                      'flex h-8 w-8 items-center justify-center rounded-full border bg-card text-xs font-semibold',
                      done && 'border-primary bg-primary text-primary-foreground',
                      active && 'border-amber-400 text-warning-700 dark:text-warning-300',
                    )}
                  >
                    {done ? <CheckCircle2 className="h-4 w-4" /> : index + 1}
                  </div>
                  {active ? <Badge variant="warning">{fo.gateActive}</Badge> : done ? <Badge variant="success">{fo.gateDone}</Badge> : <Badge variant="outline">{fo.gateQueued}</Badge>}
                </div>
                <div className="font-medium">{fo.gates[gateKey]}</div>
                <div className="mt-1 text-xs leading-5 text-muted-foreground">{fo.gateDescriptions[gateKey]}</div>
              </div>
            );
          })}
        </div>
        <Progress value={progress} className="h-2" />
        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span className="font-mono">{run?.id || 'no-run'}</span>
          <span>{formatDateTime(run?.initiated_at)}</span>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Active-run metric tile. `tone` is a decorative accent only, bridged onto the
 * shared `StatTone` vocabulary via `TONE_THEME_CLASS` (which wires the `--kpi-*`
 * custom properties): the tile rides the materialized faded-gradient surface
 * with an accented label while the value text stays neutral. An empty/`n/a`
 * value renders a muted em-dash so a toned-but-empty tile still reads
 * intentionally rather than blank.
 */
function MetricTile({
  label,
  value,
  tone = 'slate',
}: {
  label: string;
  value: string | number;
  tone?: StatTone;
}) {
  const empty =
    value === '' ||
    value === 'n/a' ||
    value === 'unknown' ||
    value === null ||
    value === undefined;
  return (
    <div
      className={cn(
        TONE_THEME_CLASS[tone],
        'rounded-lg border bg-[var(--kpi-bg)] border-[var(--kpi-border)] px-3 py-2',
      )}
    >
      <div className="text-xs font-semibold uppercase text-[color:var(--kpi-accent)]">
        {label}
      </div>
      <div
        className={cn(
          'mt-1 truncate text-sm font-semibold',
          empty ? 'text-muted-foreground' : 'text-foreground',
        )}
      >
        {empty ? '—' : value}
      </div>
    </div>
  );
}

function StatusBadge({ status, label, labels }: { status: string; label?: string; labels: RecoverStateLabels }) {
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
      <span className="truncate">{label ?? labelFor(normalized, labels)}</span>
    </Badge>
  );
}

function normalizeStatus(status?: string | null) {
  return (status ?? 'empty').toLowerCase().replace(/\s+/g, '_');
}

function labelFor(status: string | null | undefined, labels: RecoverStateLabels) {
  const normalized = normalizeStatus(status);
  return labels.failoverOps.statusLabels[normalized] ?? normalized.replace(/_/g, ' ');
}

/**
 * Map a run status onto a semantic stat tone for the Status tile: terminal-bad
 * (failed/cancelled/rolled_back) reads `rose` (risk), completed/attested reads
 * `emerald` (success), an in-flight run reads `sky` (active/count), and an
 * empty/unknown status falls back to `slate` (type).
 */
function statusTone(status?: string | null): StatTone {
  const normalized = normalizeStatus(status);
  if (['failed', 'cancelled', 'rolled_back', 'error', 'critical'].includes(normalized)) {
    return 'rose';
  }
  if (['completed', 'attested', 'passed', 'healthy'].includes(normalized)) return 'emerald';
  if (normalized === 'empty' || normalized === 'unknown') return 'slate';
  return 'sky';
}

/**
 * Tone the RTO-actual tile on whether the run met its objective: a measured
 * actual within the objective reads `emerald` (pass), an actual that overruns
 * the objective reads `rose` (risk/overdue), and an unmeasured/unknown actual
 * stays `gold` (the time metric's default).
 */
function rtoActualTone(run: DRFailoverRun): StatTone {
  if (run.rto_actual_seconds !== null && run.rto_actual_seconds !== undefined) {
    return run.rto_actual_seconds <= run.rto_objective_seconds ? 'emerald' : 'rose';
  }
  return 'gold';
}

function groupId(group: FailoverGroupRef) {
  const id = (group.group_id ?? group.groupId ?? group.id ?? '').trim();
  if (!id || id === 'null' || id === 'undefined') {
    return null;
  }
  return id;
}

function groupName(groupIdValue: string | null | undefined, groups: FailoverGroupRef[]) {
  if (!groupIdValue) return '-';
  return groups.find((group) => groupId(group) === groupIdValue)?.name ?? groupIdValue;
}

export function gateIndexForRun(run?: DRFailoverRun | null) {
  if (!run?.status) return 0;
  return FAILOVER_GATE_BY_STATUS[run.status] ?? (normalizeStatus(run.status) === 'completed' ? 4 : 0);
}

export function selectActiveFailoverRun(runs: DRFailoverRun[]) {
  if (runs.length === 0) return null;
  const active = runs.find((run) => !['COMPLETED', 'FAILED', 'CANCELLED', 'ROLLED_BACK'].includes(run.status));
  return active ?? runs[0];
}

function formatSeconds(seconds?: number | null) {
  if (seconds === undefined || seconds === null || Number.isNaN(seconds)) return 'n/a';
  if (seconds < 60) return `${Math.max(0, Math.round(seconds))}s`;
  const mins = Math.floor(seconds / 60);
  const rem = Math.round(seconds % 60);
  if (mins < 60) return rem > 0 ? `${mins}m ${rem}s` : `${mins}m`;
  const hours = Math.floor(mins / 60);
  const minRem = mins % 60;
  return minRem > 0 ? `${hours}h ${minRem}m` : `${hours}h`;
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

function runLogLines(run: DRFailoverRun) {
  const lines = [
    `${formatDateTime(run.initiated_at)} run.requested id=${run.id} mode=${run.mode ?? 'unknown'}`,
  ];
  const gate = gateIndexForRun(run);
  if (gate >= 1) lines.push('gate1.validate recovery-point pinned and RPO checked');
  if (gate >= 2) lines.push(`gate2.approve approver=${run.approved_by ?? 'pending'}`);
  if (gate >= 3) lines.push('gate3.execute boot-order started');
  if (gate >= 4) {
    const met =
      run.rto_actual_seconds === null || run.rto_actual_seconds === undefined
        ? 'pending'
        : String(run.rto_actual_seconds <= run.rto_objective_seconds);
    lines.push(`gate4.attest rto=${formatSeconds(run.rto_actual_seconds)} met=${met}`);
  }
  if (run.last_error) lines.push(`error ${run.last_error}`);
  return lines;
}
