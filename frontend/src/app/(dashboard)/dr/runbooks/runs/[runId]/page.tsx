'use client';

import { useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Radio, ShieldCheck } from 'lucide-react';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { PageHeader } from '@/components/common/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/use-auth';
import {
  RunbookTaskFlow,
  deriveTaskStatuses,
  type RunbookTaskRunStatus,
} from '@/components/product';
import type { DRRunbookTask } from '@/types/clario-dr';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { DR_PERMISSIONS } from '../../../_lib/dr-permissions';
import { resolveDRBilingual, type DRBilingual } from '../../../_lib/dr-i18n';
import { DRBreadcrumbs } from '../../../_components/console/dr-breadcrumbs';
import { DRWriteGate } from '../../../_components/console/dr-write-gate';
import { useDRRunbookRun } from '../../../_hooks/use-dr-queries';
import {
  DR_BASELINE_REFETCH_MS,
  useDRRefetchInterval,
} from '../../../_hooks/use-dr-realtime';
import { useRunbookStudioActions } from '../../../_hooks/use-dr-actions';
import { useRunbookStudioLabels } from '../../../_components/runbook-studio/runbook-studio-labels';
import { ActOnTaskPanel } from '../../_components/act-on-task-panel';
import { RunProjectionStrip } from '../../_components/run-projection-strip';
import {
  isRunbookRunTerminal,
  useRunbookPageLabels,
} from '../../_components/runbook-page-labels';

/**
 * `/dr/runbooks/runs/[runId]` — LIVE runbook execution (war-room).
 *
 * Resolves the live run state (`DRRunbookLiveState` = run + tasks + task_runs +
 * frontier + server-computed projection) via `useDRRunbookRun(runId)` and renders
 * it through the design-system `RunbookTaskFlow` with the real `taskRuns` +
 * `projection` so the highlighted critical path, per-task statuses, and the
 * on-track projection match the engine exactly. The operator selects a runnable
 * task in the flow, then completes / skips / fails it via `actOnDRRunbookTask`
 * (gated behind `dr:write` by the shared `dr-write-gate`).
 *
 * Liveness: `useDRRunbookRun` polls live (the foundation's 15s default), tightened
 * to {@link DR_LIVE_REFETCH_MS} while the run is non-terminal and relaxed to the
 * baseline once it settles — so the war-room ticks forward even in deployments
 * that do not deliver the DR WebSocket topic. `actOnTask` invalidates the run key
 * for an immediate repaint.
 */
/** Bilingual breadcrumb section labels for the live runbook-run war-room. */
const runbookRunCrumbLabels: DRBilingual<{ runbooks: string; run: string }> = {
  en: { runbooks: 'Runbooks', run: 'Run' },
  ar: { runbooks: 'كتيبات التشغيل', run: 'التشغيل' },
};

export default function DRRunbookRunPage() {
  const params = useParams<{ runId: string }>();
  const router = useRouter();
  const runId = params?.runId ?? null;
  const { locale } = useLocaleOrDefault();
  const crumbLabels = resolveDRBilingual(runbookRunCrumbLabels, locale);

  const { hasPermission } = useAuth();
  const canWrite = hasPermission(DR_PERMISSIONS.write);

  const labels = useRunbookPageLabels();
  const studioLabels = useRunbookStudioLabels();

  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  // Probe the cache first to size the polling cadence (5s while live, baseline
  // once terminal) without an extra fetch.
  const probe = useDRRunbookRun(runId, false);
  const terminal = isRunbookRunTerminal(probe.data?.run.status);
  const interval = useDRRefetchInterval(!terminal, DR_BASELINE_REFETCH_MS);

  const runQuery = useDRRunbookRun(runId, interval);
  const live = runQuery.data ?? null;

  const actions = useRunbookStudioActions();
  const { actOnTask, actOnTaskPending } = actions;

  const tasks = useMemo<DRRunbookTask[]>(() => live?.tasks ?? [], [live]);
  const taskRuns = useMemo(() => live?.task_runs ?? [], [live]);

  // Derived per-task statuses, computed exactly as the engine does (frontier +
  // blocked propagation), so the act panel knows which tasks are actionable.
  const statuses = useMemo(
    () => deriveTaskStatuses(tasks, taskRuns),
    [tasks, taskRuns],
  );

  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === selectedTaskId) ?? null,
    [tasks, selectedTaskId],
  );
  const selectedStatus: RunbookTaskRunStatus | null = selectedTask
    ? statuses.get(selectedTask.id) ?? 'pending'
    : null;

  if (!runId) {
    return (
      <div className="space-y-6">
        <DRBreadcrumbs items={[{ label: crumbLabels.runbooks, href: '/dr/runbooks' }, { label: labels.notFoundTitle }]} />
        <PageHeader title={labels.notFoundTitle} description={labels.notFoundDescription} />
        <Button type="button" variant="outline" onClick={() => router.push('/dr/runbooks')}>
          <ArrowLeft className="me-1.5 h-4 w-4" aria-hidden />
          {labels.backToList}
        </Button>
      </div>
    );
  }

  if (runQuery.isLoading && !live) {
    return (
      <div className="space-y-6">
        <DRBreadcrumbs items={[{ label: crumbLabels.runbooks, href: '/dr/runbooks' }, { label: crumbLabels.run }]} />
        <PageHeader title={labels.liveTitle} description={labels.loading} />
        <LoadingSkeleton variant="card" count={3} />
      </div>
    );
  }

  if ((runQuery.error && !live) || !live) {
    return (
      <div className="space-y-6">
        <DRBreadcrumbs items={[{ label: crumbLabels.runbooks, href: '/dr/runbooks' }, { label: crumbLabels.run }]} />
        <PageHeader title={labels.liveTitle} description={labels.loadError} />
        <ErrorState
          message={labels.loadError}
          error={runQuery.error}
          onRetry={() => void runQuery.refetch()}
        />
      </div>
    );
  }

  const isLive = !isRunbookRunTerminal(live.run.status);

  return (
    <div className="space-y-6">
      <DRBreadcrumbs
        items={[
          { label: crumbLabels.runbooks, href: '/dr/runbooks' },
          {
            label: labels.backToRunbook,
            href: `/dr/runbooks/${encodeURIComponent(live.run.runbook_id)}`,
          },
          { label: crumbLabels.run },
        ]}
      />
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span>{labels.liveTitle}</span>
            <span className="font-mono text-sm text-content-muted" dir="ltr" title={live.run.id}>
              {live.run.id}
            </span>
            <Badge variant="outline" className="normal-case">
              {labels.runStatusLabels[live.run.status] ?? live.run.status}
            </Badge>
            <Badge variant="secondary">
              {labels.runModeLabels[live.run.mode] ?? live.run.mode}
            </Badge>
            <LiveBadge
              live={isLive}
              liveLabel={labels.liveBadge}
              settledLabel={labels.settledBadge}
              liveDescription={labels.liveBadgeDescription}
              settledDescription={labels.settledBadgeDescription}
            />
          </span>
        }
        description={`${labels.liveDescriptionPrefix} ${live.run.runbook_id}`}
        actions={
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              router.push(`/dr/runbooks/${encodeURIComponent(live.run.runbook_id)}`)
            }
          >
            <ArrowLeft className="me-1.5 h-4 w-4" aria-hidden />
            {labels.backToRunbook}
          </Button>
        }
      />

      <RunProjectionStrip projection={live.projection} />

      <RunbookTaskFlow
        tasks={tasks}
        taskRuns={taskRuns}
        projection={live.projection}
        labels={studioLabels.taskFlow}
        title={studioLabels.frontierHeading}
        description={studioLabels.runStatusHeading}
        onSelectTask={(task) => setSelectedTaskId(task.id)}
      />

      <DRWriteGate canWrite={canWrite} description={studioLabels.description}>
        <ActOnTaskPanel
          task={selectedTask}
          status={selectedStatus}
          onAct={(taskId, action, payload) => actOnTask(live.run.id, taskId, action, payload)}
          pending={actOnTaskPending}
        />
      </DRWriteGate>
    </div>
  );
}

/** A live/settled indicator pairing a pulsing dot + text (never colour alone). */
function LiveBadge({
  live,
  liveLabel,
  settledLabel,
  liveDescription,
  settledDescription,
}: {
  live: boolean;
  liveLabel: string;
  settledLabel: string;
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
      {live ? liveLabel : settledLabel}
    </span>
  );
}
