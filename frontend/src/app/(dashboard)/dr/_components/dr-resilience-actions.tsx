'use client';

import {
  Activity,
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Loader2,
  PlayCircle,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import type {
  DRConsistencyBarrier,
  DRDrillSchedule,
  DRGameDayScenario,
  DRGameDayScorecard,
} from '@/types/clario-dr';

export type DRResilienceActionsProps = {
  selectedGroupId?: string | null;
  selectedGroupName?: string | null;
  consistencyBarriers: DRConsistencyBarrier[];
  drillSchedules: DRDrillSchedule[];
  gameDayScenarios: DRGameDayScenario[];
  latestConsistencyBarrier?: DRConsistencyBarrier | null;
  latestDrillSchedule?: DRDrillSchedule | null;
  latestGameDayScorecard?: DRGameDayScorecard | null;
  loading: boolean;
  triggeringConsistencyPoint: boolean;
  creatingDrillSchedule: boolean;
  runningGameDayScenario: boolean;
  error?: unknown;
  errors?: unknown;
  onTriggerConsistencyPoint: () => void;
  onCreateDrillSchedule: () => void;
  onRunGameDayScenario: (scenarioID: string) => void;
  onRetry: () => void;
};

export function DRResilienceActions({
  selectedGroupId,
  selectedGroupName,
  consistencyBarriers,
  drillSchedules,
  gameDayScenarios,
  latestConsistencyBarrier,
  latestDrillSchedule,
  latestGameDayScorecard,
  loading,
  triggeringConsistencyPoint,
  creatingDrillSchedule,
  runningGameDayScenario,
  error,
  errors,
  onTriggerConsistencyPoint,
  onCreateDrillSchedule,
  onRunGameDayScenario,
  onRetry,
}: DRResilienceActionsProps) {
  const visibleError = error ?? errors;
  const hasData = Boolean(
    selectedGroupId ||
      consistencyBarriers.length > 0 ||
      drillSchedules.length > 0 ||
      gameDayScenarios.length > 0 ||
      latestConsistencyBarrier ||
      latestDrillSchedule ||
      latestGameDayScorecard,
  );

  if (loading && !hasData) {
    return <LoadingSkeleton variant="card" count={4} />;
  }

  if (visibleError && !hasData) {
    return <ErrorState message="Failed to load DR resilience action data." onRetry={onRetry} />;
  }

  const groupLabel = selectedGroupName ?? selectedGroupId ?? 'No group selected';
  const latestBarrier = latestConsistencyBarrier ?? selectLatestBarrier(consistencyBarriers);
  const latestSchedule = latestDrillSchedule ?? selectLatestSchedule(drillSchedules);
  const scorecard = latestGameDayScorecard ?? null;
  const safeScenarioCount = gameDayScenarios.filter((scenario) => !isProductionScope(scenario)).length;

  const consistencyDisabled = loading || triggeringConsistencyPoint || !selectedGroupId;
  const drillDisabled = loading || creatingDrillSchedule || !selectedGroupId;
  const runDisabled = loading || runningGameDayScenario || !selectedGroupId || gameDayScenarios.length === 0;

  return (
    <div className="space-y-4">
      {visibleError ? (
        <div className="flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-warning-700 dark:border-amber-900/50 dark:bg-amber-950/25 dark:text-warning-300 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="min-w-0">{formatError(visibleError)}</span>
          </div>
          <Button type="button" size="sm" variant="outline" className="shrink-0" onClick={onRetry}>
            <RefreshCw className="me-1.5 h-3.5 w-3.5" />
            Retry
          </Button>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <ResilienceMetric
          title="Group"
          value={groupLabel}
          detail={selectedGroupId ? shortID(selectedGroupId) : 'Select a consistency group'}
          icon={ShieldCheck}
          tone={selectedGroupId ? 'info' : 'neutral'}
        />
        <ResilienceMetric
          title="Consistency"
          value={latestBarrier ? (latestBarrier.success ? 'sealed' : 'failed') : 'n/a'}
          detail={latestBarrier ? `${latestBarrier.provider} / ${formatDateTime(latestBarrier.created_at)}` : 'No barrier output returned'}
          icon={Activity}
          tone={latestBarrier ? (latestBarrier.success ? 'success' : 'critical') : 'neutral'}
        />
        <ResilienceMetric
          title="Drill schedule"
          value={latestSchedule ? (latestSchedule.enabled ? 'enabled' : 'paused') : 'n/a'}
          detail={latestSchedule ? `${latestSchedule.name} / next ${formatDateTime(latestSchedule.next_run)}` : 'No drill schedule returned'}
          icon={CalendarClock}
          tone={latestSchedule ? (latestSchedule.enabled ? 'success' : 'warning') : 'neutral'}
        />
        <ResilienceMetric
          title="Game-day"
          value={scorecard?.run.score ?? 'n/a'}
          detail={scorecard ? `${scorecard.run.steps_passed}/${scorecard.run.steps_total} steps passed` : `${safeScenarioCount} safe scenarios`}
          icon={ShieldAlert}
          tone={scorecard ? statusTone(scorecard.run.safety_verdict) : safeScenarioCount > 0 ? 'info' : 'neutral'}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[0.95fr_1.05fr]">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
            <div>
              <CardTitle className="text-base">Resilience actions</CardTitle>
              <CardDescription>Operator controls for app-consistent points, isolated drills, and game-day exercises.</CardDescription>
            </div>
            {loading ? <StatusBadge status="pending" label="refreshing" /> : <StatusBadge status={selectedGroupId ? 'ready' : 'pending'} />}
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <ActionButton
                label="Trigger app-consistent point"
                description={consistencyDisabled ? groupDisabledReason(selectedGroupId) : `Create barrier for ${groupLabel}`}
                icon={Activity}
                loading={triggeringConsistencyPoint}
                disabled={consistencyDisabled}
                onClick={onTriggerConsistencyPoint}
              />
              <ActionButton
                label="Create isolated drill"
                description={drillDisabled ? groupDisabledReason(selectedGroupId) : `Schedule an isolated drill for ${groupLabel}`}
                icon={CalendarClock}
                loading={creatingDrillSchedule}
                disabled={drillDisabled}
                onClick={onCreateDrillSchedule}
              />
            </div>

            <div className="space-y-2">
              <div className="text-overline font-semibold uppercase text-muted-foreground">Game-day scenarios</div>
              {gameDayScenarios.length === 0 ? (
                <EmptyLine icon={ShieldAlert} text="No game-day scenarios returned." />
              ) : (
                gameDayScenarios.slice(0, 5).map((scenario) => {
                  const productionScope = isProductionScope(scenario);
                  const disabled = runDisabled || productionScope;
                  const description = gameDayDisabledReason(selectedGroupId, gameDayScenarios.length, productionScope, scenario);

                  return (
                    <ActionButton
                      key={scenario.id}
                      label={`Run game-day scenario ${scenario.name}`}
                      description={disabled ? description : `${scenario.steps.length} fault steps / ${scenario.scope}`}
                      icon={PlayCircle}
                      loading={runningGameDayScenario}
                      disabled={disabled}
                      onClick={() => onRunGameDayScenario(scenario.id)}
                      className="w-full"
                    />
                  );
                })
              )}
              {gameDayScenarios.length > 5 ? (
                <div className="text-xs text-muted-foreground">
                  {gameDayScenarios.length - 5} additional scenario{gameDayScenarios.length - 5 === 1 ? '' : 's'} hidden.
                </div>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
            <div>
              <CardTitle className="text-base">Latest operator outputs</CardTitle>
              <CardDescription>App-consistent barrier, drill schedule, and game-day scorecard results.</CardDescription>
            </div>
            <StatusBadge status={latestOutputStatus(latestBarrier, latestSchedule, scorecard)} />
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <MiniDatum label="Selected group" value={groupLabel} />
              <MiniDatum label="Barrier" value={latestBarrier ? shortID(latestBarrier.id) : 'n/a'} />
              <MiniDatum label="Drill" value={latestSchedule ? shortID(latestSchedule.id) : 'n/a'} />
              <MiniDatum label="Scorecard" value={scorecard ? shortID(scorecard.run.id) : 'n/a'} />
            </div>

            <div className="space-y-2">
              <OutputLine
                icon={Activity}
                label="App-consistent barrier output"
                status={latestBarrier ? (latestBarrier.success ? 'sealed' : 'failed') : 'pending'}
                detail={latestBarrier ? barrierDetail(latestBarrier) : 'No consistency barrier output returned.'}
              />
              <OutputLine
                icon={CalendarClock}
                label="Drill schedule output"
                status={latestSchedule ? (latestSchedule.enabled ? 'enabled' : 'paused') : 'pending'}
                detail={latestSchedule ? `${latestSchedule.name} / ${latestSchedule.profile} / next ${formatDateTime(latestSchedule.next_run)}` : 'No drill schedule output returned.'}
              />
              <OutputLine
                icon={ShieldAlert}
                label="Game-day scorecard output"
                status={scorecard?.run.safety_verdict ?? scorecard?.run.status ?? 'pending'}
                detail={scorecard ? scorecardDetail(scorecard) : 'No game-day scorecard returned.'}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_1fr]">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
            <div>
              <CardTitle className="text-base">Consistency barriers</CardTitle>
              <CardDescription>Recent quiesce, stream fence, seal, and thaw outputs.</CardDescription>
            </div>
            <Badge variant="outline">{consistencyBarriers.length} barriers</Badge>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Barrier</TableHead>
                    <TableHead>Provider</TableHead>
                    <TableHead>Level</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {consistencyBarriers.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-sm text-muted-foreground">
                        No consistency barriers returned.
                      </TableCell>
                    </TableRow>
                  ) : (
                    sortBarriers(consistencyBarriers).slice(0, 6).map((barrier) => (
                      <TableRow key={barrier.id}>
                        <TableCell>
                          <div className="font-mono text-xs">{shortID(barrier.recovery_point_id ?? barrier.id)}</div>
                          <div className="text-xs text-muted-foreground">{shortHash(barrier.barrier_lsn)}</div>
                        </TableCell>
                        <TableCell>{barrier.provider}</TableCell>
                        <TableCell>{labelFor(barrier.consistency_level)}</TableCell>
                        <TableCell><StatusBadge status={barrier.success ? 'sealed' : 'failed'} /></TableCell>
                        <TableCell>{formatDateTime(barrier.created_at)}</TableCell>
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
              <CardTitle className="text-base">Drills and game-day catalog</CardTitle>
              <CardDescription>Available isolated drills and scenario safety scope.</CardDescription>
            </div>
            <Badge variant="outline">{drillSchedules.length + gameDayScenarios.length} items</Badge>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              {drillSchedules.length === 0 ? (
                <EmptyLine icon={CalendarClock} text="No drill schedules returned." />
              ) : (
                sortSchedules(drillSchedules).slice(0, 4).map((schedule) => (
                  <div key={schedule.id} className="flex items-start justify-between gap-3 rounded-lg border px-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{schedule.name}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {schedule.profile} / {schedule.cron_expr} / next {formatDateTime(schedule.next_run)}
                      </div>
                    </div>
                    <StatusBadge status={schedule.enabled ? 'enabled' : 'paused'} />
                  </div>
                ))
              )}
            </div>

            <div className="space-y-2">
              {gameDayScenarios.length === 0 ? (
                <EmptyLine icon={ShieldAlert} text="No game-day scenarios returned." />
              ) : (
                gameDayScenarios.slice(0, 4).map((scenario) => (
                  <div key={scenario.id} className="flex items-start justify-between gap-3 rounded-lg border px-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{scenario.name}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {scenario.scope} / {scenario.steps.length} fault steps / {shortID(scenario.group_id)}
                      </div>
                    </div>
                    <StatusBadge status={isProductionScope(scenario) ? 'critical' : 'healthy'} label={isProductionScope(scenario) ? 'blocked' : 'safe'} />
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export const DRResilienceActionsPanel = DRResilienceActions;

function ResilienceMetric({
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
            <div className="mt-3 truncate text-2xl font-semibold tracking-tight">{value}</div>
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

function ActionButton({
  label,
  description,
  icon: Icon,
  loading,
  disabled,
  onClick,
  className,
}: {
  label: string;
  description: string;
  icon: LucideIcon;
  loading: boolean;
  disabled: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <Button
      type="button"
      variant={disabled ? 'secondary' : 'outline'}
      className={cn(
        'h-auto min-h-[82px] justify-start gap-3 whitespace-normal px-3 py-3 text-start',
        disabled && 'opacity-70',
        className,
      )}
      disabled={disabled || loading}
      onClick={onClick}
      title={description}
      aria-label={label}
    >
      <span className={cn('rounded-lg p-2', disabled ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary')}>
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium leading-5">{loading ? loadingLabel(label) : label}</span>
        <span className="mt-1 block text-xs leading-4 text-muted-foreground">{description}</span>
      </span>
    </Button>
  );
}

function OutputLine({
  icon: Icon,
  label,
  status,
  detail,
}: {
  icon: LucideIcon;
  label: string;
  status: string;
  detail: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border px-3 py-2">
      <div className={cn('mt-0.5 rounded-lg p-1.5', toneClass(statusTone(status), 'soft'), toneClass(statusTone(status), 'text'))}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-3">
          <div className="truncate text-sm font-medium">{label}</div>
          <StatusBadge status={status} />
        </div>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">{detail}</div>
      </div>
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

function StatusBadge({ status, label }: { status?: string | null; label?: string }) {
  const normalized = normalizeStatus(status);
  const variant =
    normalized === 'critical' || normalized === 'failed' || normalized === 'error' || normalized === 'blocked'
      ? 'destructive'
      : normalized === 'warning' || normalized === 'degraded' || normalized === 'paused' || normalized === 'pending'
        ? 'warning'
        : normalized === 'healthy' || normalized === 'completed' || normalized === 'passed' || normalized === 'ready' || normalized === 'enabled' || normalized === 'sealed'
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

function selectLatestBarrier(barriers: DRConsistencyBarrier[]) {
  return sortBarriers(barriers)[0] ?? null;
}

function selectLatestSchedule(schedules: DRDrillSchedule[]) {
  return sortSchedules(schedules)[0] ?? null;
}

function sortBarriers(barriers: DRConsistencyBarrier[]) {
  return [...barriers].sort((left, right) => timestampMs(right.created_at) - timestampMs(left.created_at));
}

function sortSchedules(schedules: DRDrillSchedule[]) {
  return [...schedules].sort((left, right) => timestampMs(right.updated_at ?? right.created_at) - timestampMs(left.updated_at ?? left.created_at));
}

function latestOutputStatus(
  barrier: DRConsistencyBarrier | null,
  schedule: DRDrillSchedule | null,
  scorecard: DRGameDayScorecard | null,
) {
  if (scorecard?.run.safety_verdict) return scorecard.run.safety_verdict;
  if (barrier && !barrier.success) return 'failed';
  if (barrier || schedule) return 'ready';
  return 'pending';
}

function groupDisabledReason(selectedGroupId?: string | null) {
  return selectedGroupId ? 'Action is already running.' : 'Select a consistency group first.';
}

function gameDayDisabledReason(
  selectedGroupId: string | null | undefined,
  scenarioCount: number,
  productionScope: boolean,
  scenario: DRGameDayScenario,
) {
  if (!selectedGroupId) return 'Select a consistency group first.';
  if (scenarioCount === 0) return 'No game-day scenario is available.';
  if (productionScope) return `Production-scope scenario ${scenario.name} is blocked.`;
  return 'Scenario run is already in progress.';
}

function barrierDetail(barrier: DRConsistencyBarrier) {
  const point = barrier.recovery_point_id ? `point ${shortID(barrier.recovery_point_id)}` : `LSN ${shortHash(barrier.barrier_lsn)}`;
  const state = barrier.success ? 'sealed' : barrier.error ?? 'failed';
  return `${barrier.provider} ${state} ${point} at ${formatDateTime(barrier.created_at)}`;
}

function scorecardDetail(scorecard: DRGameDayScorecard) {
  const reverted = scorecard.run.all_faults_reverted ? 'all faults reverted' : 'fault reversion pending';
  const score = scorecard.run.score === undefined || scorecard.run.score === null ? 'n/a' : `${scorecard.run.score}`;
  return `score ${score} / ${scorecard.run.steps_passed}/${scorecard.run.steps_total} passed / ${reverted}`;
}

function isProductionScope(scenario: DRGameDayScenario) {
  return normalizeStatus(scenario.scope) === 'production';
}

function statusTone(status?: string | null): 'success' | 'warning' | 'critical' | 'info' | 'neutral' {
  const normalized = normalizeStatus(status);
  if (['critical', 'failed', 'error', 'unsafe', 'blocked'].includes(normalized)) return 'critical';
  if (['warning', 'degraded', 'paused', 'pending'].includes(normalized)) return 'warning';
  if (['healthy', 'completed', 'passed', 'ready', 'safe', 'enabled', 'sealed'].includes(normalized)) return 'success';
  if (['running', 'active', 'in_progress'].includes(normalized)) return 'info';
  return 'neutral';
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

function loadingLabel(label: string) {
  if (label.startsWith('Run game-day scenario')) return 'Running game-day scenario';
  if (label.startsWith('Create')) return 'Creating';
  if (label.startsWith('Trigger')) return 'Triggering';
  return 'Working';
}

function labelFor(value?: string | null) {
  return normalizeStatus(value).replace(/_/g, ' ');
}

function normalizeStatus(status?: string | null) {
  return (status ?? 'empty').toLowerCase().replace(/\s+/g, '_');
}

function shortID(value?: string | null) {
  if (!value) return 'n/a';
  return value.length <= 12 ? value : `${value.slice(0, 8)}...`;
}

function shortHash(value?: string | null) {
  if (!value) return 'n/a';
  return value.length <= 14 ? value : `${value.slice(0, 10)}...`;
}

function timestampMs(value?: string | null) {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function formatDateTime(value?: string | null) {
  if (!value) return 'n/a';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed);
}

function formatError(error: unknown): string {
  if (!error) return 'Unknown DR resilience action error.';
  if (error instanceof Error) return error.message;
  if (Array.isArray(error)) {
    const messages: string[] = error.map(formatError).filter(Boolean);
    return messages.length > 0 ? messages.join(' ') : 'Unknown DR resilience action error.';
  }
  if (typeof error === 'string') return error;
  if (typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  return 'Unknown DR resilience action error.';
}
