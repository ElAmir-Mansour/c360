'use client';

import * as React from 'react';
import {
  Activity,
  DatabaseZap,
  GitBranch,
  Radio,
  ShieldCheck,
  Timer,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { MetricTile } from '@/components/shared/metric-tile';
import { StatusChip } from '@/components/shared/status-chip';
import { EmptyState } from '@/components/common/empty-state';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import type {
  DRFailoverRun,
  DRGroupSummary,
  DRRecoveryPointSummary,
  DRStreamSummary,
} from '@/lib/clario-dr';
import { RTOvsRTATracker } from './rto-vs-rta-tracker';
import { RPOIndicator } from './rpo-indicator';
import { RunbookProgressBar, type RunbookGate } from './runbook-progress-bar';
import {
  RecoveryAnalyticsChart,
  type RecoveryAnalyticsPoint,
} from './recovery-analytics-chart';
import {
  evaluateRpo,
  formatDuration,
  isRunActive,
  latestRun,
  toneForHealth,
  toneForRunStatus,
  worstStreamByRpo,
} from './recovery-utils';

/**
 * RecoveryDashboard
 * =================
 * The real-time, single-event recovery dashboard. Composes the shared widgets
 * (RunbookProgressBar, RTOvsRTATracker, RPOIndicator) with MetricTile +
 * StatusChip and a lazily-imported analytics chart. Every prop is typed to the
 * real `internal/dr` contract surfaced by `lib/clario-dr`:
 *   - `DRGroupSummary` (group-summary fetcher) for header KPIs + RPO objective,
 *   - `DRFailoverRun` (failover-run fetcher) for the in-flight run + RTO/RTA,
 *   - `DRStreamSummary[]` for live replication / stream-health widgets,
 *   - `DRRecoveryPointSummary` for recovery-point validation.
 *
 * No page assembly: this is a composable product component. It is presentational
 * — data fetching, polling, and mutations stay with the caller.
 *
 * Token-driven, responsive (single column on mobile), light/dark, RTL-ready.
 * All copy is supplied via `labels` for bilingual rendering.
 */

export interface RecoveryDashboardLabels {
  /** Header. */
  groupLabel: string;
  generatedAtLabel: string;
  /** KPI strip. */
  members: string;
  streams: string;
  replication: string;
  recoveryPoints: string;
  /** Section titles. */
  runProgressTitle: string;
  runProgressDescription: string;
  noActiveRunTitle: string;
  noActiveRunDescription: string;
  rtoTitle: string;
  liveStatusTitle: string;
  analyticsTitle: string;
  analyticsDescription: string;
  recoveryPointTitle: string;
  recoveryPointValidated: string;
  recoveryPointUnvalidated: string;
  recoveryPointLegalHold: string;
  noRecoveryPoint: string;
  streamHealthTitle: string;
  noStreams: string;
  /** Gate labels (4 failover gates). */
  gates: { validate: string; approve: string; execute: string; attest: string };
  /** RTO tracker copy. */
  rto: {
    title: string;
    objective: string;
    actual: string;
    elapsed: string;
    onTarget: string;
    atRisk: string;
    breached: string;
    overrunSuffix: string;
    remainingSuffix: string;
    notStarted: string;
  };
  /** RPO indicator copy. */
  rpo: {
    title: string;
    objective: string;
    lag: string;
    withinObjective: string;
    approaching: string;
    breached: string;
    valueCaption: string;
  };
  /** Run status pill text keyed by upper-case status; falls back to raw status. */
  runStatusLabels?: Record<string, string>;
  /** Stream health pill text keyed by lower-case health; falls back to raw. */
  healthLabels?: Record<string, string>;
  /** Analytics series labels. */
  analytics: { rpo: string; lag: string; objective: string; empty: string };
  naLabel?: string;
}

export interface RecoveryDashboardProps {
  /** Group-summary from `fetchDRGroupSummary` — header KPIs + objectives. */
  summary: DRGroupSummary;
  /** The active failover run from `fetchDRFailoverRun(s)`; null if none in flight. */
  activeRun?: DRFailoverRun | null;
  /** All recent runs (used to derive a run if `activeRun` not supplied). */
  recentRuns?: DRFailoverRun[];
  /** Live replication streams (from replication-summary / group members). */
  streams?: DRStreamSummary[];
  /** Latest sealed recovery point for the validation widget. */
  recoveryPoint?: DRRecoveryPointSummary | null;
  /** Pre-formatted RPO/lag analytics series (objective drawn as reference). */
  analyticsData?: RecoveryAnalyticsPoint[];
  /** Live elapsed seconds for the in-flight run (drives at-risk projection). */
  elapsedSeconds?: number | null;
  labels: RecoveryDashboardLabels;
  className?: string;
}

const FAILOVER_GATES = (labels: RecoveryDashboardLabels): RunbookGate[] => [
  { key: 'validate', label: labels.gates.validate, description: labels.rpo.objective },
  { key: 'approve', label: labels.gates.approve },
  { key: 'execute', label: labels.gates.execute },
  { key: 'attest', label: labels.gates.attest },
];

function formatTimestamp(value: string | null | undefined, naLabel: string): string {
  if (!value) return naLabel;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? naLabel : date.toLocaleString();
}

export function RecoveryDashboard({
  summary,
  activeRun,
  recentRuns,
  streams,
  recoveryPoint,
  analyticsData = [],
  elapsedSeconds = null,
  labels,
  className,
}: RecoveryDashboardProps) {
  const naLabel = labels.naLabel ?? 'n/a';

  const run = activeRun ?? latestRun(recentRuns) ?? null;
  const resolvedStreams = streams ?? summary.members
    .map((member) => member.stream)
    .filter((stream): stream is DRStreamSummary => Boolean(stream));

  const focusStream = React.useMemo(
    () => worstStreamByRpo(resolvedStreams) ?? summary.worst_live_rpo ?? null,
    [resolvedStreams, summary.worst_live_rpo],
  );
  const recoveryPointRow = recoveryPoint ?? summary.latest_recovery_point ?? null;

  const runStatusText = (status: string | null | undefined): string => {
    if (!status) return naLabel;
    return labels.runStatusLabels?.[status.toUpperCase()] ?? status;
  };
  const healthText = (health: string | null | undefined): string => {
    if (!health) return naLabel;
    return labels.healthLabels?.[health.toLowerCase()] ?? health;
  };

  return (
    <div className={cn('flex flex-col gap-gutter', className)} dir="auto">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-overline uppercase tracking-wide text-content-muted">
            {labels.groupLabel}
          </p>
          <h2 className="truncate text-h3 font-bold text-content-primary">{summary.name}</h2>
          <p className="mt-1 text-body-sm text-content-muted">
            {labels.generatedAtLabel}: {formatTimestamp(summary.generated_at, naLabel)}
          </p>
        </div>
        <StatusChip
          tone={toneForHealth(summary.health)}
          icon={ShieldCheck}
          label={healthText(summary.health)}
          size="lg"
        />
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <MetricTile icon={GitBranch} label={labels.members} value={summary.member_count} />
        <MetricTile icon={Radio} label={labels.streams} value={summary.stream_count} />
        <MetricTile
          icon={Activity}
          label={labels.replication}
          value={`${Math.round(summary.replication_percent)}%`}
        />
        <MetricTile
          icon={DatabaseZap}
          label={labels.recoveryPoints}
          value={recoveryPointRow ? formatDuration(recoveryPointRow.rpo_seconds, naLabel) : naLabel}
        />
      </div>

      {/* Runbook progress + RTO/RTA */}
      <div className="grid grid-cols-1 gap-gutter lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-body-lg">
              <Timer className="size-4 text-content-muted" aria-hidden />
              {labels.runProgressTitle}
            </CardTitle>
            <CardDescription>{labels.runProgressDescription}</CardDescription>
          </CardHeader>
          <CardContent>
            {run ? (
              <RunbookProgressBar
                gates={FAILOVER_GATES(labels)}
                status={run.status}
                statusLabel={runStatusText(run.status)}
                ariaLabel={labels.runProgressTitle}
                stateLabels={{
                  done: labels.gates.attest,
                  current: labels.gates.execute,
                  awaitingApproval: labels.gates.approve,
                  failed: labels.rto.breached,
                  pending: labels.gates.validate,
                }}
              />
            ) : (
              <EmptyState
                icon={Timer}
                title={labels.noActiveRunTitle}
                description={labels.noActiveRunDescription}
                size="compact"
              />
            )}
          </CardContent>
        </Card>

        <RTOvsRTATracker
          objectiveSeconds={run?.rto_objective_seconds ?? summary.rto_objective_seconds}
          actualSeconds={run?.rto_actual_seconds ?? null}
          elapsedSeconds={run && isRunActive(run.status) ? elapsedSeconds : null}
          naLabel={naLabel}
          labels={labels.rto}
        />
      </div>

      {/* Live status widgets */}
      <section aria-label={labels.liveStatusTitle} className="flex flex-col gap-3">
        <h3 className="text-body-lg font-semibold text-content-primary">{labels.liveStatusTitle}</h3>
        <div className="grid grid-cols-1 gap-gutter md:grid-cols-3">
          <RPOIndicator
            rpoSeconds={focusStream?.rpo_seconds}
            objectiveSeconds={focusStream?.rpo_objective_seconds ?? summary.rpo_objective_seconds}
            lagSeconds={focusStream?.lag_seconds ?? null}
            breachesRpo={focusStream?.breaches_rpo}
            naLabel={naLabel}
            labels={labels.rpo}
          />

          {/* Recovery-point validation */}
          <div className="rounded-card border border-outline-subtle bg-surface-card p-card-padding shadow-elevation-1">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <ShieldCheck className="size-4 text-content-muted" aria-hidden />
                <h4 className="text-body-sm font-semibold text-content-primary">
                  {labels.recoveryPointTitle}
                </h4>
              </div>
              {recoveryPointRow && (
                <StatusChip
                  tone={recoveryPointRow.is_validated ? 'success' : 'warning'}
                  label={
                    recoveryPointRow.is_validated
                      ? labels.recoveryPointValidated
                      : labels.recoveryPointUnvalidated
                  }
                  size="sm"
                />
              )}
            </div>
            {recoveryPointRow ? (
              <div className="mt-3 space-y-2">
                <p className="text-h4 font-bold tabular-nums text-content-primary">
                  {recoveryPointRow.validation_ratio != null
                    ? `${Math.round(recoveryPointRow.validation_ratio * 100)}%`
                    : naLabel}
                </p>
                <p className="truncate font-mono text-caption text-content-muted">
                  {recoveryPointRow.marker_lsn}
                </p>
                {recoveryPointRow.legal_hold && (
                  <StatusChip tone="info" label={labels.recoveryPointLegalHold} size="sm" />
                )}
              </div>
            ) : (
              <EmptyState icon={ShieldCheck} title={labels.noRecoveryPoint} size="compact" className="px-0 py-4" />
            )}
          </div>

          {/* Stream health summary */}
          <div className="rounded-card border border-outline-subtle bg-surface-card p-card-padding shadow-elevation-1">
            <div className="flex items-center gap-2">
              <Radio className="size-4 text-content-muted" aria-hidden />
              <h4 className="text-body-sm font-semibold text-content-primary">
                {labels.streamHealthTitle}
              </h4>
            </div>
            {resolvedStreams.length > 0 ? (
              <ul className="mt-3 flex flex-col gap-2">
                {resolvedStreams.slice(0, 4).map((stream) => {
                  const rpoEval = evaluateRpo(
                    stream.rpo_seconds,
                    stream.rpo_objective_seconds,
                    stream.lag_seconds,
                    stream.breaches_rpo,
                  );
                  return (
                    <li
                      key={stream.stream_id}
                      className="flex items-center justify-between gap-2 text-body-sm"
                    >
                      <span className="min-w-0 truncate text-content-primary">
                        {stream.site_name ?? stream.stream_id}
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="tabular-nums text-content-muted">
                          {formatDuration(rpoEval.rpoSeconds, naLabel)}
                        </span>
                        <StatusChip
                          tone={toneForHealth(stream.health)}
                          label={healthText(stream.health)}
                          size="sm"
                        />
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState icon={Radio} title={labels.noStreams} size="compact" className="px-0 py-4" />
            )}
          </div>
        </div>
      </section>

      {/* Analytics */}
      <Card>
        <CardHeader>
          <CardTitle className="text-body-lg">{labels.analyticsTitle}</CardTitle>
          <CardDescription>{labels.analyticsDescription}</CardDescription>
        </CardHeader>
        <CardContent>
          <RecoveryAnalyticsChart
            data={analyticsData}
            objectiveSeconds={focusStream?.rpo_objective_seconds ?? summary.rpo_objective_seconds}
            labels={labels.analytics}
            yFormatter={(value) => formatDuration(value, naLabel)}
          />
        </CardContent>
      </Card>
    </div>
  );
}
