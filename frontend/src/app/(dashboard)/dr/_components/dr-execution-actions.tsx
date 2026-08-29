'use client';

import {
  Activity,
  AlertTriangle,
  ArchiveRestore,
  BadgeCheck,
  CheckCircle2,
  GitBranch,
  Loader2,
  PlayCircle,
  RefreshCw,
  RotateCcw,
  ServerCog,
  ShieldCheck,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { TONE_THEME_CLASS, type StatTone } from '@/components/shared/stat-card';
import type { DRBootPlan, DRFailbackRun, DRFailoverRun } from '@/types/clario-dr';
import { useExecutionActionLabels, type ExecutionActionLabels } from '../_lib/dr-action-labels';

type BootService = DRBootPlan['tiers'][number][number];

export type DRExecutionActionsPanelProps = {
  selectedGroupId?: string | null;
  selectedGroupName?: string | null;
  latestRecoveryPointId?: string | null;
  activeFailoverRun?: DRFailoverRun | null;
  failbackRuns: DRFailbackRun[];
  bootPlan?: DRBootPlan | null;
  loading: boolean;
  creatingFailover: boolean;
  approvingFailover: boolean;
  cancelingFailover: boolean;
  creatingFailback: boolean;
  approvingCutback: boolean;
  advancingFailback: boolean;
  startingBoot: boolean;
  error: unknown;
  onCreateFailover: () => void;
  onApproveFailover: (runID: string) => void;
  onCancelFailover: (runID: string) => void;
  onCreateFailback: (failoverRunID?: string | null) => void;
  onApproveCutback: (runID: string) => void;
  onAdvanceFailback: (runID: string) => void;
  onStartBoot: () => void;
  onRetry: () => void;
};

export function DRExecutionActionsPanel({
  selectedGroupId,
  selectedGroupName,
  latestRecoveryPointId,
  activeFailoverRun,
  failbackRuns,
  bootPlan,
  loading,
  creatingFailover,
  approvingFailover,
  cancelingFailover,
  creatingFailback,
  approvingCutback,
  advancingFailback,
  startingBoot,
  error,
  onCreateFailover,
  onApproveFailover,
  onCancelFailover,
  onCreateFailback,
  onApproveCutback,
  onAdvanceFailback,
  onStartBoot,
  onRetry,
}: DRExecutionActionsPanelProps) {
  const t = useExecutionActionLabels();
  const latestFailbackRun = selectLatestFailbackRun(failbackRuns);
  const bootServices = flattenBootServices(bootPlan);
  const bootTierNames = bootPlan?.tier_names && bootPlan.tier_names.length > 0
    ? bootPlan.tier_names
    : (bootPlan?.tiers ?? []).map((tier) => tier.map((service) => service.name));
  const hasData = Boolean(
    selectedGroupId ||
      latestRecoveryPointId ||
      activeFailoverRun ||
      failbackRuns.length > 0 ||
      bootPlan,
  );

  if (loading && !hasData) {
    return <LoadingSkeleton variant="card" count={4} />;
  }

  if (error && !hasData) {
    return <ErrorState message={t.loadError} onRetry={onRetry} />;
  }

  const selectedGroupLabel = selectedGroupName ?? selectedGroupId ?? t.noGroupSelected;
  const activeFailoverStatus = normalizeStatus(activeFailoverRun?.status);
  const latestFailbackStatus = normalizeStatus(latestFailbackRun?.status);
  const activeFailoverId = activeFailoverRun?.id ?? null;
  const latestFailbackId = latestFailbackRun?.id ?? null;
  const hasActiveFailover = Boolean(activeFailoverRun && !isTerminalFailoverStatus(activeFailoverRun.status));
  const hasActiveFailback = failbackRuns.some((run) => !isTerminalFailbackStatus(run.status));
  const failoverAwaitingApproval = activeFailoverStatus === 'awaiting_approval';
  const failoverApprovalReady = Boolean(
    activeFailoverRun &&
      (failoverAwaitingApproval ||
        Boolean(activeFailoverRun.approved_by) ||
        isFailoverPastApproval(activeFailoverRun.status)),
  );
  const failbackCutbackReady = Boolean(
    latestFailbackRun &&
      (isFailbackCutbackGate(latestFailbackRun) ||
        Boolean(latestFailbackRun.approved_by) ||
        isFailbackPastCutback(latestFailbackRun.status)),
  );
  const bootPlanReady = bootServices.length > 0;
  const failbackConvergence = convergencePercent(latestFailbackRun);

  const createFailoverDisabled = loading || creatingFailover || !selectedGroupId || !latestRecoveryPointId || hasActiveFailover;
  const approveFailoverDisabled = loading || approvingFailover || !activeFailoverId || !failoverAwaitingApproval;
  const cancelFailoverDisabled = loading || cancelingFailover || !activeFailoverId || !hasActiveFailover;
  const createFailbackDisabled = loading || creatingFailback || !selectedGroupId || hasActiveFailback;
  const approveCutbackDisabled =
    loading ||
    approvingCutback ||
    !latestFailbackId ||
    latestFailbackStatus !== 'awaiting_cutback_approval' ||
    Boolean(latestFailbackRun?.approved_by);
  const advanceFailbackDisabled =
    loading ||
    advancingFailback ||
    !latestFailbackId ||
    isTerminalFailbackStatus(latestFailbackRun?.status) ||
    latestFailbackStatus === 'awaiting_cutback_approval';
  const startBootDisabled = loading || startingBoot || !selectedGroupId || !bootPlanReady;

  return (
    <div className="space-y-4">
      {error ? (
        <div className="flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-warning-700 dark:border-amber-900/50 dark:bg-amber-950/25 dark:text-warning-300 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="min-w-0">{formatError(error, t)}</span>
          </div>
          <Button type="button" size="sm" variant="outline" className="shrink-0" onClick={onRetry}>
            <RefreshCw className="me-1.5 h-3.5 w-3.5" />
            {t.retry}
          </Button>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
        <ExecutionMetric
          title={t.metricGroup}
          value={selectedGroupLabel}
          detail={selectedGroupId ? shortID(selectedGroupId) : t.selectConsistencyGroup}
          icon={ShieldCheck}
          tone={selectedGroupId ? 'info' : 'neutral'}
        />
        <ExecutionMetric
          title={t.metricRecoveryPoint}
          value={latestRecoveryPointId ? shortID(latestRecoveryPointId) : t.na}
          detail={latestRecoveryPointId ? t.pinnedForDrill : t.noRecoveryPointSelected}
          icon={ArchiveRestore}
          tone={latestRecoveryPointId ? 'success' : 'warning'}
        />
        <ExecutionMetric
          title={t.metricFailover}
          value={activeFailoverRun ? labelFor(activeFailoverStatus, t) : t.idle}
          detail={activeFailoverRun ? shortID(activeFailoverRun.id) : t.noActiveFailoverRun}
          icon={PlayCircle}
          tone={statusTone(activeFailoverRun?.status)}
        />
        <ExecutionMetric
          title={t.metricFailback}
          value={latestFailbackRun ? labelFor(latestFailbackStatus, t) : t.none}
          detail={latestFailbackRun ? `${formatBytes(latestFailbackRun.delta_bytes_remaining)} ${t.remainingSuffix}` : t.noFailbackRun}
          icon={RotateCcw}
          tone={statusTone(latestFailbackRun?.status)}
        />
        <ExecutionMetric
          title={t.metricBootPlan}
          value={bootPlanReady ? `${bootServices.length} ${t.servicesSuffix}` : t.na}
          detail={bootPlanReady ? `${bootTierNames.length} ${t.orderedTiersSuffix}` : t.noBootPlanReturned}
          icon={ServerCog}
          tone={bootPlanReady ? 'success' : 'warning'}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[0.95fr_1.05fr]">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
            <div>
              <CardTitle className="text-base">{t.actionsTitle}</CardTitle>
              <CardDescription>{t.actionsDescription}</CardDescription>
            </div>
            {loading ? <StatusBadge status="pending" label={t.refreshing} t={t} /> : <StatusBadge status={selectedGroupId ? 'ready' : 'pending'} t={t} />}
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <ActionButton
                label={t.createFailoverDrill}
                loadingVerb={t.verbCreating}
                description={createFailoverDisabled ? failoverCreateDisabledReason(selectedGroupId, latestRecoveryPointId, hasActiveFailover, t) : `${t.usePointPrefix} ${shortID(latestRecoveryPointId)}`}
                icon={ArchiveRestore}
                loading={creatingFailover}
                disabled={createFailoverDisabled}
                onClick={onCreateFailover}
              />
              <ActionButton
                label={t.approveFailover}
                loadingVerb={t.verbApproving}
                description={activeFailoverRun ? `${labelFor(activeFailoverStatus, t)} / ${shortID(activeFailoverRun.id)}` : t.noActiveFailoverRun}
                icon={BadgeCheck}
                loading={approvingFailover}
                disabled={approveFailoverDisabled}
                onClick={() => activeFailoverId && onApproveFailover(activeFailoverId)}
              />
              <ActionButton
                label={t.cancelFailover}
                loadingVerb={t.verbCanceling}
                description={activeFailoverRun ? `${labelFor(activeFailoverStatus, t)} / ${shortID(activeFailoverRun.id)}` : t.noActiveFailoverRun}
                icon={XCircle}
                variant="destructive"
                loading={cancelingFailover}
                disabled={cancelFailoverDisabled}
                onClick={() => activeFailoverId && onCancelFailover(activeFailoverId)}
              />
              <ActionButton
                label={t.createFailback}
                loadingVerb={t.verbCreating}
                description={createFailbackDisabled ? failbackCreateDisabledReason(selectedGroupId, hasActiveFailback, t) : activeFailoverId ? `${t.linkPrefix} ${shortID(activeFailoverId)}` : t.planReverseRecovery}
                icon={RotateCcw}
                loading={creatingFailback}
                disabled={createFailbackDisabled}
                onClick={() => onCreateFailback(activeFailoverId)}
              />
              <ActionButton
                label={t.approveCutback}
                loadingVerb={t.verbApproving}
                description={latestFailbackRun ? `${labelFor(latestFailbackStatus, t)} / ${shortID(latestFailbackRun.id)}` : t.noFailbackRun}
                icon={ShieldCheck}
                loading={approvingCutback}
                disabled={approveCutbackDisabled}
                onClick={() => latestFailbackId && onApproveCutback(latestFailbackId)}
              />
              <ActionButton
                label={t.advanceFailback}
                loadingVerb={t.verbAdvancing}
                description={latestFailbackRun ? `${labelFor(latestFailbackStatus, t)} / ${formatBytes(latestFailbackRun.delta_bytes_remaining)}` : t.noFailbackRun}
                icon={Activity}
                loading={advancingFailback}
                disabled={advanceFailbackDisabled}
                onClick={() => latestFailbackId && onAdvanceFailback(latestFailbackId)}
              />
              <ActionButton
                label={t.startIsolatedBoot}
                loadingVerb={t.verbStarting}
                description={bootPlanReady ? t.servicesAcrossTiers(bootServices.length, bootTierNames.length) : t.bootPlanUnavailable}
                icon={ServerCog}
                loading={startingBoot}
                disabled={startBootDisabled}
                onClick={onStartBoot}
                className="sm:col-span-2"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
            <div>
              <CardTitle className="text-base">{t.readinessTitle}</CardTitle>
              <CardDescription>{t.readinessDescription}</CardDescription>
            </div>
            <StatusBadge status={executionReady(latestRecoveryPointId, failoverApprovalReady, failbackCutbackReady, bootPlanReady) ? 'ready' : 'pending'} t={t} />
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <MiniDatum label={t.selectedGroup} value={selectedGroupLabel} tone="slate" />
              <MiniDatum label={t.latestPoint} value={latestRecoveryPointId ? shortID(latestRecoveryPointId) : t.na} tone="slate" />
              <MiniDatum
                label={t.activeFailover}
                value={activeFailoverRun ? labelFor(activeFailoverStatus, t) : t.idle}
                tone={activeFailoverRun ? statusStatTone(activeFailoverRun.status) : 'slate'}
              />
              <MiniDatum
                label={t.latestFailback}
                value={latestFailbackRun ? labelFor(latestFailbackStatus, t) : t.none}
                tone={latestFailbackRun ? statusStatTone(latestFailbackRun.status) : 'slate'}
              />
            </div>

            <div className="space-y-2">
              <ReadinessLine
                icon={ArchiveRestore}
                label={t.recoveryPointSelected}
                ready={Boolean(latestRecoveryPointId)}
                detail={latestRecoveryPointId ? t.recoveryPointSelectedDetail(shortID(latestRecoveryPointId)) : t.recoveryPointSelectMissing}
                t={t}
              />
              <ReadinessLine
                icon={BadgeCheck}
                label={t.activeRunApproval}
                ready={failoverApprovalReady}
                detail={activeFailoverRun ? failoverApprovalDetail(activeFailoverRun, t) : t.noApprovalGateRun}
                t={t}
              />
              <ReadinessLine
                icon={RotateCcw}
                label={t.failbackCutback}
                ready={failbackCutbackReady}
                detail={latestFailbackRun ? failbackCutbackDetail(latestFailbackRun, t) : t.noFailbackCutbackReady}
                t={t}
              />
              <ReadinessLine
                icon={GitBranch}
                label={t.bootPlanAvailability}
                ready={bootPlanReady}
                detail={bootPlanReady ? t.bootPlanReadyDetail(bootServices.length, bootTierNames.length) : t.defineBootServices}
                t={t}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
            <div>
              <CardTitle className="text-base">{t.latestFailbackTitle}</CardTitle>
              <CardDescription>{t.latestFailbackDescription}</CardDescription>
            </div>
            <StatusBadge status={latestFailbackRun?.status ?? 'empty'} t={t} />
          </CardHeader>
          <CardContent className="space-y-4">
            {latestFailbackRun ? (
              <>
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <MiniDatum label={t.colRun} value={shortID(latestFailbackRun.id)} tone="slate" />
                  <MiniDatum label={t.colFailover} value={shortID(latestFailbackRun.failover_run_id)} tone="slate" />
                  <MiniDatum label={t.colFrom} value={shortID(latestFailbackRun.from_site)} tone="slate" />
                  <MiniDatum label={t.colTo} value={shortID(latestFailbackRun.to_site)} tone="slate" />
                  <MiniDatum label={t.colRemaining} value={formatBytes(latestFailbackRun.delta_bytes_remaining)} tone="sky" />
                  <MiniDatum label={t.colThreshold} value={formatBytes(latestFailbackRun.converge_threshold_bytes)} tone="sky" />
                  <MiniDatum label={t.colWindow} value={latestFailbackRun.cutover_window_open ? t.windowOpen : t.windowClosed} tone="slate" />
                  <MiniDatum label={t.colDirection} value={latestFailbackRun.new_direction ?? t.directionPending} tone="slate" />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <span className="font-medium text-muted-foreground">{t.reverseDeltaConvergence}</span>
                    <span className="font-semibold">{failbackConvergence}%</span>
                  </div>
                  <Progress
                    value={failbackConvergence}
                    className="h-2"
                    indicatorClassName={failbackConvergence < 100 ? 'bg-amber-500' : 'bg-primary'}
                  />
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <HashBox label={t.sourceLsn} value={latestFailbackRun.source_lsn} t={t} />
                  <HashBox label={t.appliedLsn} value={latestFailbackRun.applied_lsn} t={t} />
                </div>
                {latestFailbackRun.last_error ? (
                  <div className="rounded-lg border border-error-100 bg-error-50 px-3 py-2 text-sm text-error-700 dark:border-error-700/50 dark:bg-error-700/25 dark:text-error-300">
                    {latestFailbackRun.last_error}
                  </div>
                ) : null}
              </>
            ) : (
              <EmptyLine icon={RotateCcw} text={t.noFailbackRunsReturned} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
            <div>
              <CardTitle className="text-base">{t.bootPlanTitle}</CardTitle>
              <CardDescription>{t.bootPlanDescription}</CardDescription>
            </div>
            <Badge variant="outline">{t.tiersBadge(bootTierNames.length)}</Badge>
          </CardHeader>
          <CardContent className="space-y-3">
            {bootPlanReady ? (
              bootTierNames.slice(0, 6).map((tier, index) => {
                const tierServices = bootPlan?.tiers?.[index] ?? [];
                return (
                  <div key={`${index}-${tier.join(',')}`} className="rounded-lg border px-3 py-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-3">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-xs font-semibold text-primary">
                          {index + 1}
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{tier.join(' + ')}</div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {t.servicesInTier(tierServices.length, index + 1)}
                          </div>
                        </div>
                      </div>
                      <StatusBadge status="ready" label={t.ordered} t={t} />
                    </div>
                    {tierServices.length > 0 ? (
                      <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                        {tierServices.slice(0, 4).map((service) => (
                          <BootServiceLine key={service.id} service={service} />
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })
            ) : (
              <EmptyLine icon={GitBranch} text={t.noBootPlanReturnedLine} />
            )}
            {bootTierNames.length > 6 ? (
              <div className="text-xs text-muted-foreground">
                {t.additionalTiersHidden(bootTierNames.length - 6)}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ExecutionMetric({
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
  loadingVerb,
  description,
  icon: Icon,
  loading,
  disabled,
  onClick,
  variant = 'outline',
  className,
}: {
  label: string;
  loadingVerb: string;
  description: string;
  icon: LucideIcon;
  loading: boolean;
  disabled: boolean;
  onClick: () => void;
  variant?: 'default' | 'outline' | 'secondary' | 'destructive';
  className?: string;
}) {
  return (
    <Button
      type="button"
      variant={disabled ? 'secondary' : variant}
      className={cn(
        'h-auto min-h-[82px] justify-start gap-3 whitespace-normal px-3 py-3 text-start',
        disabled && 'opacity-70',
        className,
      )}
      disabled={disabled || loading}
      onClick={onClick}
      title={description}
    >
      <span className={cn('rounded-lg p-2', disabled ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary')}>
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium leading-5">{loading ? loadingVerb : label}</span>
        <span className="mt-1 block text-xs leading-4 text-muted-foreground">{description}</span>
      </span>
    </Button>
  );
}

function ReadinessLine({
  icon: Icon,
  label,
  ready,
  detail,
  t,
}: {
  icon: LucideIcon;
  label: string;
  ready: boolean;
  detail: string;
  t: ExecutionActionLabels;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border px-3 py-2">
      <div className={cn('mt-0.5 rounded-lg p-1.5', ready ? 'bg-primary/10 text-primary' : 'bg-amber-50 text-warning-700 dark:bg-amber-950/25 dark:text-warning-300')}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-3">
          <div className="truncate text-sm font-medium">{label}</div>
          <StatusBadge status={ready ? 'ready' : 'pending'} t={t} />
        </div>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">{detail}</div>
      </div>
    </div>
  );
}

/**
 * Compact DR-local stat tile. `tone` is a *decorative accent only*, wired onto
 * the shared `StatTone` vocabulary via `TONE_THEME_CLASS` (faded gradient bg +
 * themed border + accented label) with the value text staying neutral
 * (`text-foreground`). `"neutral"` (default) keeps the original flat treatment.
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

function HashBox({ label, value, t }: { label: string; value?: string | null; t: ExecutionActionLabels }) {
  return (
    <div className="min-w-0 rounded-lg border bg-muted/20 px-3 py-2">
      <div className="text-overline font-semibold uppercase text-muted-foreground">{label}</div>
      <div className="mt-1 truncate font-mono text-xs">{value || t.na}</div>
    </div>
  );
}

function BootServiceLine({ service }: { service: BootService }) {
  return (
    <div className="min-w-0 rounded-lg border bg-muted/20 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{service.name}</div>
          <div className="mt-1 truncate text-xs text-muted-foreground">
            {service.kind} / {service.boot_action}
          </div>
        </div>
        <Badge variant="outline" className="shrink-0 normal-case tracking-normal">
          {service.probe_kind}
        </Badge>
      </div>
      <div className="mt-2 truncate font-mono text-xs text-muted-foreground">{service.probe_target}</div>
    </div>
  );
}

function StatusBadge({ status, label, t }: { status?: string | null; label?: string; t: ExecutionActionLabels }) {
  const normalized = normalizeStatus(status);
  const variant =
    normalized === 'critical' ||
    normalized === 'failed' ||
    normalized === 'error' ||
    normalized === 'cancelled' ||
    normalized === 'rolled_back'
      ? 'destructive'
      : normalized === 'warning' ||
          normalized === 'pending' ||
          normalized === 'initiated' ||
          normalized === 'quiescing' ||
          normalized === 'sync_confirmed' ||
          normalized === 'awaiting_approval' ||
          normalized === 'awaiting_cutback_approval'
        ? 'warning'
        : normalized === 'healthy' ||
            normalized === 'ready' ||
            normalized === 'approved' ||
            normalized === 'executing' ||
            normalized === 'validating' ||
            normalized === 'attested' ||
            normalized === 'completed' ||
            normalized === 'cutting_back'
          ? 'success'
          : 'outline';

  return (
    <Badge variant={variant} className="max-w-full normal-case tracking-normal">
      <span className="truncate">{label ?? labelFor(normalized, t)}</span>
    </Badge>
  );
}

function EmptyLine({ icon: Icon, text }: { icon: LucideIcon; text: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-4 text-sm text-muted-foreground">
      <Icon className="h-4 w-4 shrink-0" />
      <span className="min-w-0">{text}</span>
    </div>
  );
}

function flattenBootServices(bootPlan?: DRBootPlan | null) {
  return (bootPlan?.tiers ?? []).reduce<BootService[]>((services, tier) => services.concat(tier), []);
}

function selectLatestFailbackRun(runs: DRFailbackRun[]) {
  return [...runs].sort((left, right) => timestampMs(right.updated_at ?? right.initiated_at) - timestampMs(left.updated_at ?? left.initiated_at))[0] ?? null;
}

function executionReady(
  latestRecoveryPointId: string | null | undefined,
  failoverApprovalReady: boolean,
  failbackCutbackReady: boolean,
  bootPlanReady: boolean,
) {
  return Boolean(latestRecoveryPointId) && failoverApprovalReady && failbackCutbackReady && bootPlanReady;
}

function failoverCreateDisabledReason(
  selectedGroupId: string | null | undefined,
  latestRecoveryPointId: string | null | undefined,
  hasActiveFailover: boolean,
  t: ExecutionActionLabels,
) {
  if (!selectedGroupId) return t.reasonSelectGroup;
  if (!latestRecoveryPointId) return t.reasonSelectRecoveryPoint;
  if (hasActiveFailover) return t.reasonActiveFailover;
  return t.reasonReadyToCreateDrill;
}

function failbackCreateDisabledReason(
  selectedGroupId: string | null | undefined,
  hasActiveFailback: boolean,
  t: ExecutionActionLabels,
) {
  if (!selectedGroupId) return t.reasonSelectGroup;
  if (hasActiveFailback) return t.reasonActiveFailback;
  return t.reasonReadyToPlanFailback;
}

function failoverApprovalDetail(run: DRFailoverRun, t: ExecutionActionLabels) {
  const status = normalizeStatus(run.status);
  if (status === 'awaiting_approval') return t.failoverWaitingApproval(shortID(run.id));
  if (run.approved_by) return t.failoverApprovedBy(shortID(run.id), shortID(run.approved_by));
  if (isFailoverPastApproval(run.status)) return t.failoverPastApproval(shortID(run.id));
  return t.failoverNotReachedApproval(shortID(run.id));
}

function failbackCutbackDetail(run: DRFailbackRun, t: ExecutionActionLabels) {
  const status = normalizeStatus(run.status);
  if (status === 'awaiting_cutback_approval') return t.cutbackWaitingApproval(shortID(run.id));
  if (run.approved_by) return t.cutbackApprovedBy(shortID(run.id), shortID(run.approved_by));
  if (isFailbackPastCutback(run.status)) return t.cutbackPastGate(shortID(run.id));
  if (isFailbackDeltaConverged(run)) return t.cutbackConverged(shortID(run.id));
  return t.cutbackRemaining(formatBytes(run.delta_bytes_remaining));
}

function isFailbackCutbackGate(run: DRFailbackRun) {
  return normalizeStatus(run.status) === 'awaiting_cutback_approval' || isFailbackDeltaConverged(run);
}

function isFailbackDeltaConverged(run: DRFailbackRun) {
  return run.cutover_window_open && run.delta_bytes_remaining <= run.converge_threshold_bytes;
}

function isFailoverPastApproval(status?: string | null) {
  return ['approved', 'executing', 'validating', 'attested', 'completed'].includes(normalizeStatus(status));
}

function isFailbackPastCutback(status?: string | null) {
  return ['cutting_back', 'completed'].includes(normalizeStatus(status));
}

function isTerminalFailoverStatus(status?: string | null) {
  return ['completed', 'failed', 'cancelled', 'rolled_back'].includes(normalizeStatus(status));
}

function isTerminalFailbackStatus(status?: string | null) {
  return ['completed', 'failed', 'cancelled'].includes(normalizeStatus(status));
}

function statusTone(status?: string | null): 'success' | 'warning' | 'critical' | 'info' | 'neutral' {
  const normalized = normalizeStatus(status);
  if (normalized === 'empty') return 'neutral';
  if (normalized === 'failed' || normalized === 'error' || normalized === 'cancelled' || normalized === 'rolled_back') return 'critical';
  if (normalized === 'completed' || normalized === 'approved' || normalized === 'attested' || normalized === 'ready') return 'success';
  if (normalized === 'executing' || normalized === 'validating' || normalized === 'cutting_back') return 'info';
  return 'warning';
}

/** Map a run/operation status to a semantic `StatTone` for compact stat tiles. */
function statusStatTone(status?: string | null): StatTone {
  const tone = statusTone(status);
  if (tone === 'critical') return 'rose';
  if (tone === 'success') return 'emerald';
  if (tone === 'info') return 'sky';
  if (tone === 'warning') return 'gold';
  return 'slate';
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

function convergencePercent(run?: DRFailbackRun | null) {
  if (!run) return 0;
  if (run.delta_bytes_remaining <= run.converge_threshold_bytes) return 100;
  if (run.converge_threshold_bytes <= 0) return 0;
  return Math.max(0, Math.min(95, Math.round((run.converge_threshold_bytes / run.delta_bytes_remaining) * 100)));
}

function formatBytes(bytes?: number | null) {
  if (bytes === undefined || bytes === null || Number.isNaN(bytes)) return 'n/a';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  return `${Math.round(bytes / (1024 * 1024 * 1024))} GB`;
}

function shortID(value?: string | null) {
  if (!value) return 'n/a';
  if (value.length <= 14) return value;
  return `${value.slice(0, 7)}...${value.slice(-5)}`;
}

function normalizeStatus(status?: string | null) {
  return (status ?? 'empty').toLowerCase().replace(/\s+/g, '_');
}

function labelFor(value: string, t: ExecutionActionLabels) {
  const normalized = value.toLowerCase().replace(/\s+/g, '_');
  return t.statusLabels[normalized] ?? value.replace(/_/g, ' ');
}

function timestampMs(value?: string | Date | null) {
  if (!value) return 0;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function formatError(error: unknown, t: ExecutionActionLabels) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.length > 0) return error;
  return t.refreshError;
}
