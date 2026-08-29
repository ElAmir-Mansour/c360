'use client';

import {
  Activity,
  CalendarClock,
  CheckCircle2,
  GitBranch,
  Network,
  RotateCcw,
  ServerCog,
  ShieldAlert,
  type LucideIcon,
} from 'lucide-react';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { Badge } from '@/components/ui/badge';
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
import type {
  DRAgent,
  DRAssuranceAssessmentReport,
  DRAssuranceControlInfo,
  DRBootPlan,
  DRConsistencyBarrier,
  DRDrillResult,
  DRDrillSchedule,
  DRFailbackRun,
  DRGameDayScenario,
  DRTopology,
  DRTopologyFailoverSelection,
} from '@/types/clario-dr';

type CockpitGroup = {
  group_id?: string;
  groupId?: string;
  id?: string;
  name?: string | null;
};

export function DRResilienceCockpit({
  agents,
  assuranceControls,
  assuranceLatest,
  bootPlan,
  consistencyBarriers,
  drillResults,
  drillSchedules,
  failbackRuns,
  gameDayScenarios,
  selectedGroup,
  topology,
  topologySelection,
  loading,
  error,
  onRetry,
}: {
  agents: DRAgent[];
  assuranceControls: DRAssuranceControlInfo[];
  assuranceLatest?: DRAssuranceAssessmentReport | null;
  bootPlan?: DRBootPlan | null;
  consistencyBarriers: DRConsistencyBarrier[];
  drillResults: DRDrillResult[];
  drillSchedules: DRDrillSchedule[];
  failbackRuns: DRFailbackRun[];
  gameDayScenarios: DRGameDayScenario[];
  selectedGroup?: CockpitGroup | null;
  topology?: DRTopology | null;
  topologySelection?: DRTopologyFailoverSelection | null;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  if (loading && agents.length === 0 && drillSchedules.length === 0) {
    return <LoadingSkeleton variant="card" count={4} />;
  }

  if (error && agents.length === 0 && drillSchedules.length === 0 && failbackRuns.length === 0) {
    return <ErrorState message="Failed to load DR resilience cockpit data." onRetry={onRetry} />;
  }

  const activeAgents = agents.filter((agent) => normalizeStatus(agent.status) === 'active').length;
  const staleAgents = agents.filter(isAgentStale).length;
  const failedDrills = drillResults.filter((result) => !result.passed).length;
  const activeFailbacks = failbackRuns.filter((run) => !terminalStatus(run.status)).length;
  const assuranceScore = assuranceLatest?.assessment?.score;
  const selectedTarget = topologySelection?.selected;
  const groupName = selectedGroup?.name ?? groupId(selectedGroup) ?? 'selected group';

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <CockpitMetric
          title="Agent fleet"
          value={`${activeAgents}/${agents.length}`}
          detail={staleAgents > 0 ? `${staleAgents} stale or missing heartbeat` : 'All active agents are current'}
          icon={ServerCog}
          tone={staleAgents > 0 ? 'warning' : 'success'}
        />
        <CockpitMetric
          title="Assurance"
          value={assuranceScore === undefined ? 'n/a' : `${assuranceScore}%`}
          detail={`${assuranceControls.length} controls, ${assuranceLatest?.findings?.length ?? 0} findings`}
          icon={ShieldAlert}
          tone={assuranceScore !== undefined && assuranceScore < 85 ? 'warning' : 'success'}
        />
        <CockpitMetric
          title="Drill cadence"
          value={drillSchedules.length}
          detail={failedDrills > 0 ? `${failedDrills} recent drill regressions` : `${drillResults.length} recent results`}
          icon={CalendarClock}
          tone={failedDrills > 0 ? 'warning' : 'success'}
        />
        <CockpitMetric
          title="Failback"
          value={activeFailbacks}
          detail={`${failbackRuns.length} reverse recovery runs tracked`}
          icon={RotateCcw}
          tone={activeFailbacks > 0 ? 'warning' : 'info'}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
            <div>
              <CardTitle className="text-base">Agent fleet</CardTitle>
              <CardDescription>Enrollment, certificate state, and heartbeat coverage.</CardDescription>
            </div>
            <Badge variant="outline">{agents.length} agents</Badge>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Agent</TableHead>
                    <TableHead>Site</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Last seen</TableHead>
                    <TableHead>Certificate</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {agents.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-sm text-muted-foreground">
                        No DR agents returned.
                      </TableCell>
                    </TableRow>
                  ) : (
                    agents.slice(0, 6).map((agent) => (
                      <TableRow key={agent.id}>
                        <TableCell>
                          <div className="font-mono text-xs">{agent.id}</div>
                          <div className="text-xs text-muted-foreground">{shortHash(agent.mtls_thumbprint)}</div>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{agent.site_id ?? 'unassigned'}</TableCell>
                        <TableCell><StatusBadge status={isAgentStale(agent) ? 'warning' : agent.status} label={isAgentStale(agent) ? 'stale' : undefined} /></TableCell>
                        <TableCell>{formatDateTime(agent.last_seen_at)}</TableCell>
                        <TableCell>
                          <div className="text-sm">{agent.cert_serial ?? 'pending'}</div>
                          <div className="text-xs text-muted-foreground">expires {formatDate(agent.cert_expires_at)}</div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
            <div>
              <CardTitle className="text-base">Assurance controls</CardTitle>
              <CardDescription>Latest evaluated readiness for {groupName}.</CardDescription>
            </div>
            <StatusBadge status={assuranceLatest?.assessment?.verdict ?? 'empty'} />
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <MiniDatum
                label="Score"
                value={assuranceScore === undefined ? 'n/a' : `${assuranceScore}%`}
                tone={assuranceScore !== undefined && assuranceScore < 85 ? 'rose' : 'emerald'}
              />
              <MiniDatum label="Satisfied" value={assuranceLatest?.assessment?.satisfied ?? 0} tone="emerald" />
              <MiniDatum label="Partial" value={assuranceLatest?.assessment?.partial ?? 0} tone="gold" />
              <MiniDatum label="Failed" value={assuranceLatest?.assessment?.failed ?? 0} tone="rose" />
            </div>
            <Progress
              value={assuranceScore ?? 0}
              className="h-2"
              indicatorClassName={(assuranceScore ?? 0) < 75 ? 'bg-amber-500' : 'bg-primary'}
            />
            <div className="space-y-2">
              {(assuranceLatest?.findings ?? []).slice(0, 4).map((finding) => (
                <div key={`${finding.code}-${finding.title}`} className="rounded-lg border bg-muted/20 px-3 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-medium">{finding.title}</div>
                    <StatusBadge status={finding.severity ?? finding.verdict} />
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">{finding.recommendation || finding.message}</div>
                </div>
              ))}
              {(assuranceLatest?.findings ?? []).length === 0 ? (
                <EmptyLine icon={CheckCircle2} text={assuranceLatest ? 'No assurance findings returned.' : 'No assurance assessment returned yet.'} />
              ) : null}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <DrillPanel schedules={drillSchedules} results={drillResults} />
        <TopologyPanel bootPlan={bootPlan} topology={topology} topologySelection={topologySelection} />
        <FailbackPanel runs={failbackRuns} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Application-consistent barriers</CardTitle>
            <CardDescription>Quiesce, stream fence, seal, and thaw history for {groupName}.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {consistencyBarriers.length === 0 ? (
              <EmptyLine icon={Activity} text="No consistency barriers returned." />
            ) : (
              consistencyBarriers.slice(0, 5).map((barrier) => (
                <div key={barrier.id} className="flex items-start justify-between gap-3 rounded-lg border px-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{barrier.recovery_point_id ?? barrier.barrier_lsn}</div>
                    <div className="text-xs text-muted-foreground">
                      {barrier.provider} / {barrier.consistency_level} / {formatDateTime(barrier.created_at)}
                    </div>
                  </div>
                  <StatusBadge status={barrier.success ? 'healthy' : 'failed'} label={barrier.success ? 'sealed' : 'failed'} />
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Game-day safety</CardTitle>
            <CardDescription>Non-production resilience exercises with explicit production-scope refusal.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {gameDayScenarios.length === 0 ? (
              <EmptyLine icon={ShieldAlert} text="No game-day scenarios returned." />
            ) : (
              gameDayScenarios.slice(0, 5).map((scenario) => (
                <div key={scenario.id} className="flex items-start justify-between gap-3 rounded-lg border px-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{scenario.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {scenario.scope} / {scenario.steps?.length ?? 0} fault steps / {scenario.group_id}
                    </div>
                  </div>
                  <StatusBadge status={scenario.scope === 'production' ? 'critical' : 'healthy'} label={scenario.scope === 'production' ? 'blocked' : 'safe'} />
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function DrillPanel({
  schedules,
  results,
}: {
  schedules: DRDrillSchedule[];
  results: DRDrillResult[];
}) {
  const latest = [...results].sort((left, right) => timestampMs(right.observed_at) - timestampMs(left.observed_at))[0];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Drills and tests</CardTitle>
        <CardDescription>Scheduled isolated drills, recent outcomes, and regression markers.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <MiniDatum label="Schedules" value={schedules.length} tone="sky" />
          <MiniDatum
            label="Recent pass"
            value={`${results.filter((result) => result.passed).length}/${results.length}`}
            tone={results.some((result) => !result.passed) ? 'rose' : 'emerald'}
          />
        </div>
        {latest ? (
          <div className="rounded-lg border bg-muted/20 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="font-mono text-xs">{latest.run_id}</div>
              <StatusBadge status={latest.passed ? 'passed' : 'failed'} />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <MiniDatum label="RTO" value={`${formatSeconds(latest.rto_achieved_seconds)} / ${formatSeconds(latest.rto_objective_seconds)}`} tone="gold" />
              <MiniDatum label="RPO" value={formatSeconds(latest.rpo_achieved_seconds)} tone="gold" />
              <MiniDatum
                label="Validation"
                value={formatRatio(latest.validation_ratio)}
                tone={latest.passed ? 'emerald' : 'rose'}
              />
              <MiniDatum label="Observed" value={formatDateTime(latest.observed_at)} tone="gold" />
            </div>
          </div>
        ) : (
          <EmptyLine icon={CalendarClock} text="No drill results returned." />
        )}
        <div className="space-y-2">
          {schedules.slice(0, 3).map((schedule) => (
            <div key={schedule.id} className="rounded-lg border px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <div className="font-medium">{schedule.name}</div>
                <StatusBadge status={schedule.enabled ? 'active' : 'paused'} />
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {schedule.profile} / next {formatDateTime(schedule.next_run)}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function TopologyPanel({
  bootPlan,
  topology,
  topologySelection,
}: {
  bootPlan?: DRBootPlan | null;
  topology?: DRTopology | null;
  topologySelection?: DRTopologyFailoverSelection | null;
}) {
  const tierNames = bootPlan?.tier_names ?? bootPlan?.tiers?.map((tier) => tier.map((service) => service.name)) ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Topology and boot DAG</CardTitle>
        <CardDescription>Replication graph, failover target ranking, and dependency boot tiers.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <MiniDatum label="Nodes" value={topology?.nodes?.length ?? 0} tone="sky" />
          <MiniDatum label="Edges" value={topology?.edges?.length ?? 0} tone="sky" />
          <MiniDatum label="Boot tiers" value={tierNames.length} tone="sky" />
          <MiniDatum label="Target" value={topologySelection?.selected?.site_name ?? 'n/a'} tone="slate" />
        </div>
        <div className="rounded-lg border bg-muted/20 p-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="text-sm font-medium">Selected target</div>
            <StatusBadge status={topologySelection?.selected?.health ?? 'empty'} />
          </div>
          <div className="text-sm">{topologySelection?.selected?.reason ?? 'No target ranking returned.'}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {topologySelection?.selected?.site_id ?? 'no selected site'} / lag {formatSeconds(topologySelection?.selected?.lag_seconds)}
          </div>
        </div>
        <div className="space-y-2">
          {tierNames.slice(0, 4).map((tier, index) => (
            <div key={`${index}-${tier.join(',')}`} className="flex items-center gap-3 rounded-lg border px-3 py-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-xs font-semibold text-primary">
                {index + 1}
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{tier.join(' + ')}</div>
                <div className="text-xs text-muted-foreground">tier {index + 1}</div>
              </div>
            </div>
          ))}
          {tierNames.length === 0 ? <EmptyLine icon={GitBranch} text="No boot plan returned." /> : null}
        </div>
      </CardContent>
    </Card>
  );
}

function FailbackPanel({ runs }: { runs: DRFailbackRun[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Failback control</CardTitle>
        <CardDescription>Reverse replication convergence and gated cutback status.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {runs.length === 0 ? (
          <EmptyLine icon={RotateCcw} text="No failback runs returned." />
        ) : (
          runs.slice(0, 5).map((run) => (
            <div key={run.id} className="rounded-lg border px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <div className="font-mono text-xs">{run.id}</div>
                <StatusBadge status={run.status} />
              </div>
              <div className="mt-2 grid grid-cols-2 gap-3 text-sm">
                <MiniDatum label="Remaining" value={formatBytes(run.delta_bytes_remaining)} tone="sky" />
                <MiniDatum label="Threshold" value={formatBytes(run.converge_threshold_bytes)} tone="sky" />
                <MiniDatum label="Window" value={run.cutover_window_open ? 'open' : 'closed'} tone="slate" />
                <MiniDatum label="Direction" value={run.new_direction ?? 'pending'} tone="slate" />
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function CockpitMetric({
  title,
  value,
  detail,
  icon: Icon,
  tone,
}: {
  title: string;
  value: string | number;
  detail: string;
  icon: LucideIcon;
  tone: 'success' | 'warning' | 'critical' | 'info' | 'neutral';
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-overline font-semibold uppercase text-muted-foreground">{title}</div>
            <div className="mt-3 truncate text-3xl font-semibold tracking-tight">{value}</div>
          </div>
          <div className={cn('rounded-lg p-2.5', toneClass(tone, 'soft'))}>
            <Icon className={cn('h-5 w-5', toneClass(tone, 'text'))} />
          </div>
        </div>
        <div className="mt-3 min-h-5 truncate text-xs text-muted-foreground">{detail}</div>
      </CardContent>
    </Card>
  );
}

/**
 * Compact DR-local stat tile. `tone` is a *decorative accent only*, wired onto
 * the shared `StatTone` vocabulary via `TONE_THEME_CLASS`: the theme class sets
 * the `--kpi-*` custom properties, which we render at a compact scale (faded
 * gradient bg + themed border + accented label), keeping the value text neutral
 * (`text-foreground`). When `tone` is `"neutral"` (default) the original flat,
 * borderless treatment is byte-for-byte unchanged.
 */
function MiniDatum({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string | number;
  tone?: StatTone;
}) {
  if (tone === 'neutral') {
    return (
      <div className="min-w-0">
        <div className="text-overline font-semibold uppercase text-muted-foreground">{label}</div>
        <div className="mt-1 truncate font-medium">{value}</div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        TONE_THEME_CLASS[tone],
        'min-w-0 rounded-lg border bg-[var(--kpi-bg)] border-[var(--kpi-border)] px-2.5 py-2',
      )}
    >
      <div className="text-overline font-semibold uppercase text-[color:var(--kpi-accent)]">
        {label}
      </div>
      <div className="mt-1 truncate font-medium text-foreground">{value}</div>
    </div>
  );
}

function StatusBadge({ status, label }: { status?: string | null; label?: string }) {
  const normalized = normalizeStatus(status);
  const variant =
    normalized === 'critical' || normalized === 'failed' || normalized === 'error' || normalized === 'revoked'
      ? 'destructive'
      : normalized === 'warning' || normalized === 'degraded' || normalized === 'paused' || normalized === 'stale'
        ? 'warning'
        : normalized === 'healthy' || normalized === 'completed' || normalized === 'passed' || normalized === 'active' || normalized === 'satisfied'
          ? 'success'
          : 'outline';

  return (
    <Badge variant={variant} className="max-w-full normal-case">
      <span className="truncate">{label ?? normalized.replace(/_/g, ' ')}</span>
    </Badge>
  );
}

function EmptyLine({ icon: Icon, text }: { icon: LucideIcon; text: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-4 text-sm text-muted-foreground">
      <Icon className="h-4 w-4" />
      <span>{text}</span>
    </div>
  );
}

function groupId(group?: CockpitGroup | null) {
  return group?.group_id ?? group?.groupId ?? group?.id;
}

function isAgentStale(agent: DRAgent) {
  const status = normalizeStatus(agent.status);
  if (status !== 'active') return true;
  if (!agent.last_seen_at) return true;
  return Date.now() - timestampMs(agent.last_seen_at) > 15 * 60 * 1000;
}

function terminalStatus(status?: string | null) {
  return ['completed', 'failed', 'cancelled', 'rolled_back', 'aborted'].includes(normalizeStatus(status));
}

function normalizeStatus(status?: string | null) {
  return (status ?? 'empty').toLowerCase().replace(/\s+/g, '_');
}

function toneClass(tone: 'success' | 'warning' | 'critical' | 'info' | 'neutral', part: 'soft' | 'text') {
  const styles = {
    success: { soft: 'bg-primary/10', text: 'text-primary' },
    warning: { soft: 'bg-amber-50 dark:bg-amber-950/25', text: 'text-warning-700 dark:text-warning-300' },
    critical: { soft: 'bg-error-50 dark:bg-error-700/25', text: 'text-error-700 dark:text-error-300' },
    info: { soft: 'bg-sky-50 dark:bg-sky-950/25', text: 'text-sky-700 dark:text-sky-300' },
    neutral: { soft: 'bg-muted', text: 'text-muted-foreground' },
  } as const;
  return styles[tone][part];
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

function formatBytes(bytes?: number | null) {
  if (bytes === undefined || bytes === null || Number.isNaN(bytes)) return 'n/a';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  return `${Math.round(bytes / (1024 * 1024 * 1024))} GB`;
}

function formatRatio(value?: number | null) {
  if (value === undefined || value === null || Number.isNaN(value)) return 'n/a';
  const pct = value <= 1 ? value * 100 : value;
  return `${Math.round(pct)}%`;
}

function formatDate(value?: string | Date | null) {
  if (!value) return 'n/a';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'n/a';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
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

function shortHash(value?: string | null) {
  if (!value) return 'n/a';
  if (value.length <= 12) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function timestampMs(value?: string | Date | null) {
  if (!value) return 0;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}
