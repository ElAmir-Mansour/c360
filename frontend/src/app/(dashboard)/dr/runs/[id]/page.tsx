'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, FileCheck2, Radio, ShieldCheck } from 'lucide-react';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { PageHeader, type PageHeaderTag } from '@/components/common/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TooltipProvider } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/use-auth';
import {
  fetchDRFailoverAttestation,
  type DRAttestation,
} from '@/lib/clario-dr';
import {
  NodeMap,
  PostImplementationReviewPanel,
  topologyToGraph,
} from '@/components/product';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { DRBreadcrumbs } from '../../_components/console/dr-breadcrumbs';
import {
  useDRAttestationLedger,
  useDRFailoverRun,
  useDRFailoverSteps,
  useDRGroupSummary,
  useDRTopology,
} from '../../_hooks/use-dr-queries';
import { ledgerToActivity } from '../../_lib/collaboration';
import { ActivityFeed } from '../../_components/activity/activity-feed';
import {
  DR_BASELINE_REFETCH_MS,
  useActiveRunLiveness,
  useActiveRunRealtime,
} from '../../_hooks/use-dr-realtime';
import { useFailoverActions } from '../../_hooks/use-dr-actions';
import { useDRLabels, resolveDRBilingual, type DRBilingual } from '../../_lib/dr-i18n';
import { RunStepsTimeline } from '../../_components/runs/run-steps-timeline';
import { RunStageProgress } from '../../_components/runs/run-stage-progress';
import { deriveFailoverGates, isTerminalRun } from '../../_components/runs/run-derivations';
import { RunNextAction } from '../../_components/runs/run-next-action';
import { RunGateTimeline } from '../../_components/runs/run-gate-timeline';
import { RunRtoCountdown } from '../../_components/runs/run-rto-countdown';
import { useRunWarRoomLabels } from '../../_components/runs/run-war-room-labels';

const WRITE_PERMISSION = 'dr:write';

/** Bilingual breadcrumb section labels for the failover war-room. */
const failoverRunCrumbLabels: DRBilingual<{ recover: string; run: string }> = {
  en: { recover: 'Recover', run: 'Failover run' },
  ar: { recover: 'الاسترداد', run: 'تشغيل تجاوز الفشل' },
};

/**
 * `/dr/runs/[id]` — Incident-command / war-room view for a failover run.
 *
 * This is the action-first centrepiece of the recovery console. For a live run
 * it surfaces, above the fold:
 *  - the NEXT REQUIRED ACTION as the primary CTA, derived from the real
 *    `run.status` FSM (Approve at the approval gate; Cancel in flight; Cancel /
 *    roll back on failure), `dr:write`-gated;
 *  - a LIVE RTO COUNTDOWN (ticking stopwatch vs `rto_objective_seconds`) that
 *    turns amber `at_risk` and red `breached` via state-* tokens + icon/text;
 *  - a LIVE four-gate TIMELINE (validate -> approve -> execute -> attest) with
 *    the current/next gate emphasised and completed gates stamped from the real
 *    driver steps;
 *  - the CRITICAL PATH + topology via the design-system `NodeMap`.
 *
 * Liveness: `useActiveRunRealtime` registers the run/run-list/posture query keys
 * against the per-run DR WS topics so they invalidate the instant a gate/step
 * event arrives; `useActiveRunLiveness` tightens the polling fallback for the
 * driver steps to 5s while the run is non-terminal (relaxing to the baseline
 * once terminal). For terminal runs the `PostImplementationReviewPanel` takes
 * over with the sealed attestation + four-gate outcome.
 *
 * Every input is a real `@/lib/clario-dr` shape; no fields are invented.
 */
export default function DRRunExecutionPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const runId = params?.id ?? null;
  const { nodeMapLabels, drStatusLabel, drRunStatusLabels, pirLabels } = useDRLabels();
  const warRoomLabels = useRunWarRoomLabels();
  const { locale } = useLocaleOrDefault();
  const crumbLabels = resolveDRBilingual(failoverRunCrumbLabels, locale);
  const runCrumbs = [
    { label: crumbLabels.recover, href: '/dr/recover' },
    { label: crumbLabels.run },
  ];

  const { hasPermission } = useAuth();
  const canWrite = hasPermission(WRITE_PERMISSION);

  const runQuery = useDRFailoverRun(runId);
  const run = runQuery.data ?? null;
  const groupId = run?.group_id ?? null;

  // Real-time: register the per-run keys against the DR lifecycle topics so the
  // run/run-list/posture caches invalidate on incoming gate/step events.
  useActiveRunRealtime(runId);
  // Polling fallback: 5s while the run is non-terminal, relaxed otherwise.
  const liveRefetch = useActiveRunLiveness(run, DR_BASELINE_REFETCH_MS);

  const groupSummaryQuery = useDRGroupSummary(groupId);
  const topologyQuery = useDRTopology(groupId);

  // Shares the exact `['clario-dr','failover-run-steps', runId]` cache entry the
  // PIR review uses, so the war-room never double-fetches the driver steps. The
  // liveness fallback tightens polling to 5s while the run is non-terminal.
  const stepsQuery = useDRFailoverSteps(runId, liveRefetch);

  // The immutable decision/action record for this run: the attestation ledger
  // scoped to the run as its subject, merged with the driver steps below.
  const ledgerQuery = useDRAttestationLedger(runId ? { subject: runId } : undefined);

  const terminal = run ? isTerminalRun(run) : false;

  const attestationQuery = useQuery<DRAttestation>({
    queryKey: ['clario-dr', 'failover-run-attestation', runId],
    queryFn: () => fetchDRFailoverAttestation(runId!),
    // Attestation only exists once a run reaches a terminal/attested state.
    enabled: Boolean(runId) && terminal,
    retry: false,
  });

  const steps = useMemo(() => stepsQuery.data ?? [], [stepsQuery.data]);

  // Merge the run-scoped ledger + driver steps into the newest-first activity
  // stream (the immutable who/what/when). Pure foundation selector; no clock.
  const activity = useMemo(
    () => ledgerToActivity(ledgerQuery.data ?? [], steps),
    [ledgerQuery.data, steps],
  );
  // Only surface a first-load skeleton / error before any record is available.
  const activityLoading =
    ledgerQuery.isLoading && stepsQuery.isLoading && activity.length === 0;
  const activityErrored =
    Boolean(ledgerQuery.error) && Boolean(stepsQuery.error) && activity.length === 0;

  const failover = useFailoverActions({
    activeGroupId: groupId,
    activeRecoveryPointId: run?.recovery_point_id ?? null,
    groupSummary: groupSummaryQuery.data ?? null,
    activeFailoverRun: run,
    failbackSites: { fromSite: null, toSite: null },
  });

  const topologyGraph = useMemo(
    () => (topologyQuery.data ? topologyToGraph(topologyQuery.data) : { nodes: [], edges: [] }),
    [topologyQuery.data],
  );

  const gates = useMemo(() => (run ? deriveFailoverGates(run, steps) : []), [run, steps]);

  if (!runId) {
    return (
      <div className="space-y-6">
        <DRBreadcrumbs items={runCrumbs} />
        <ErrorState message={warRoomLabels.noRunId} />
      </div>
    );
  }

  if (runQuery.isLoading && !run) {
    return (
      <div className="space-y-6">
        <DRBreadcrumbs items={runCrumbs} />
        <PageHeader title={warRoomLabels.loadingTitle} description={warRoomLabels.loadingDescription} />
        <LoadingSkeleton variant="card" count={3} />
      </div>
    );
  }

  if ((runQuery.error && !run) || !run) {
    return (
      <div className="space-y-6">
        <DRBreadcrumbs items={runCrumbs} />
        <ErrorState
          message={warRoomLabels.loadError}
          error={runQuery.error}
          onRetry={() => void runQuery.refetch()}
        />
      </div>
    );
  }

  const statusLabel = drRunStatusLabels[String(run.status).toUpperCase()] ?? run.status;
  const live = !terminal;

  // Restrained run framing chip: the run mode (live / rehearsal). The run status
  // already renders as a badge inside the title, so it is not duplicated here.
  const headerTags: PageHeaderTag[] = [
    {
      label: `${warRoomLabels.modeLabel}: ${warRoomLabels.runModeLabels[run.mode] ?? run.mode}`,
      tone: 'info',
    },
  ];

  return (
    <TooltipProvider delayDuration={150}>
      <div className="space-y-6">
        <DRBreadcrumbs items={runCrumbs} />
        <PageHeader
          eyebrow={warRoomLabels.eyebrow}
          tags={headerTags}
          title={
            <span className="flex flex-wrap items-center gap-2">
              <span>{warRoomLabels.title}</span>
              <span
                className="font-mono text-sm text-content-muted"
                dir="ltr"
                title={run.id}
              >
                {run.id}
              </span>
              <Badge variant="outline" className="normal-case">{statusLabel}</Badge>
              <LiveBadge
                live={live}
                liveLabel={warRoomLabels.liveLabel}
                pausedLabel={warRoomLabels.pausedLabel}
                liveDescription={warRoomLabels.liveDescription}
                settledDescription={warRoomLabels.settledDescription}
              />
            </span>
          }
          description={`${warRoomLabels.subtitlePrefix} ${groupSummaryQuery.data?.name ?? run.group_id}`}
          actions={
            <>
              {terminal && run.mode === 'drill' ? (
                <Button asChild variant="outline" size="sm">
                  <Link href={`/recover/it-dr/prove/rehearsals/failover-runs/${run.id}`}>
                    <FileCheck2 className="me-1.5 h-4 w-4" aria-hidden />
                    Proof envelope
                  </Link>
                </Button>
              ) : null}
              <Button type="button" variant="outline" size="sm" onClick={() => router.push('/dr/recover')}>
                <ArrowLeft className="me-1.5 h-4 w-4" aria-hidden />
                {warRoomLabels.backToRecover}
              </Button>
            </>
          }
        />

        {/* Execution pipeline at a glance — validate -> approve -> execute -> attest. */}
        <RunStageProgress run={run} />

        {/* Command row: next required action + live RTO countdown, side by side. */}
        <div className="grid gap-6 lg:grid-cols-2">
          <RunNextAction
            run={run}
            canWrite={canWrite}
            onApprove={() => failover.approveFailover(run.id)}
            onCancel={() => failover.cancelFailover(run.id)}
            approvePending={failover.approveFailoverPending}
            cancelPending={failover.cancelFailoverPending}
          />
          <RunRtoCountdown run={run} />
        </div>

        {/* Live gate timeline + critical-path topology. */}
        <div className="grid gap-6 lg:grid-cols-2">
          <RunGateTimeline run={run} steps={steps} />
          <NodeMap
            nodes={topologyGraph.nodes}
            edges={topologyGraph.edges}
            labels={nodeMapLabels}
            statusLabel={drStatusLabel}
            title={warRoomLabels.topologyTitle}
            description={warRoomLabels.topologyDescription}
          />
        </div>

        {groupSummaryQuery.error && !groupSummaryQuery.data ? (
          <ErrorState
            message={warRoomLabels.summaryLoadError}
            error={groupSummaryQuery.error}
            onRetry={() => void groupSummaryQuery.refetch()}
          />
        ) : null}

        <RunStepsTimeline steps={steps} />

        {/* Immutable decision & action record — real ledger + driver steps. */}
        <ActivityFeed
          events={activity}
          loading={activityLoading}
          errored={activityErrored}
          onRetry={() => {
            void ledgerQuery.refetch();
            void stepsQuery.refetch();
          }}
        />

        {terminal ? (
          <PostImplementationReviewPanel
            run={run}
            attestation={attestationQuery.data ?? undefined}
            steps={steps}
            gates={gates}
            issues={[]}
            actionItems={[]}
            rpoObjectiveSeconds={groupSummaryQuery.data?.rpo_objective_seconds}
            labels={pirLabels}
          />
        ) : null}
      </div>
    </TooltipProvider>
  );
}

/** A live/settled indicator pairing a pulsing dot + text (never colour alone). */
function LiveBadge({
  live,
  liveLabel,
  pausedLabel,
  liveDescription,
  settledDescription,
}: {
  live: boolean;
  liveLabel: string;
  pausedLabel: string;
  liveDescription: string;
  settledDescription: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-button border px-2 py-0.5 text-caption font-medium',
        live
          ? 'border-state-success/40 bg-state-success/10 text-state-success'
          : 'border-outline-subtle bg-surface-sunken text-content-muted',
      )}
      title={live ? liveDescription : settledDescription}
    >
      {live ? (
        <Radio className="h-3.5 w-3.5 animate-pulse" aria-hidden />
      ) : (
        <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
      )}
      {live ? liveLabel : pausedLabel}
    </span>
  );
}
