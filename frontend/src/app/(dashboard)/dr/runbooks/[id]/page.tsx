'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Pencil, Play, Plus } from 'lucide-react';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { PageHeader } from '@/components/common/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/hooks/use-auth';
import { RunbookTaskFlow } from '@/components/product';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { DR_PERMISSIONS } from '../../_lib/dr-permissions';
import { resolveDRBilingual, type DRBilingual } from '../../_lib/dr-i18n';
import { DRBreadcrumbs } from '../../_components/console/dr-breadcrumbs';
import { DRWriteGate } from '../../_components/console/dr-write-gate';
import { useDRRunbook } from '../../_hooks/use-dr-queries';
import { useRunbookStudioActions } from '../../_hooks/use-dr-actions';
import { useRunbookStudioLabels } from '../../_components/runbook-studio/runbook-studio-labels';
import { AddTaskDialog } from '../_components/add-task-dialog';
import { EditRunbookDialog } from '../_components/edit-runbook-dialog';
import { StartRunDialog } from '../_components/start-run-dialog';
import { useRunbookPageLabels } from '../_components/runbook-page-labels';

/**
 * `/dr/runbooks/[id]` — runbook AUTHORING surface.
 *
 * Resolves the runbook plan (`DRRunbookPlan` = runbook + ordered tasks) via
 * `useDRRunbook(id)` and renders it through the design-system `RunbookTaskFlow`
 * (the sequenced task DAG with the highlighted critical path). The operator can:
 *  - add a task (`addDRRunbookTask`) via the RHF + zod add-task dialog,
 *  - edit the runbook metadata (`updateDRRunbook`),
 *  - start a run (`startDRRunbookRun`) and jump to its live execution view.
 * Every authoring control is gated behind `dr:write` via the shared
 * `dr-write-gate`. All copy is bilingual + logical-RTL; no fields are invented.
 */
/** Bilingual breadcrumb section label for the runbooks lifecycle area. */
const runbooksCrumbLabel: DRBilingual<string> = { en: 'Runbooks', ar: 'كتيبات التشغيل' };

export default function DRRunbookAuthorPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const runbookId = params?.id ?? null;
  const { locale } = useLocaleOrDefault();
  const runbooksCrumb = resolveDRBilingual(runbooksCrumbLabel, locale);

  const { hasPermission } = useAuth();
  const canWrite = hasPermission(DR_PERMISSIONS.write);

  const labels = useRunbookPageLabels();
  const studioLabels = useRunbookStudioLabels();

  const runbookQuery = useDRRunbook(runbookId);
  const plan = runbookQuery.data ?? null;

  const actions = useRunbookStudioActions();
  const {
    addTask,
    addTaskPending,
    updateRunbook,
    updateRunbookPending,
    startRun,
    startRunPending,
    latestRunId,
  } = actions;

  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [startOpen, setStartOpen] = useState(false);

  // When a run is started, surface a deep link to its live execution view (the
  // run id is the real id the start action returned). Closing the dialog is driven
  // here so the run link card appears immediately.
  useEffect(() => {
    if (latestRunId) setStartOpen(false);
  }, [latestRunId]);

  if (!runbookId) {
    return (
      <div className="space-y-6">
        <DRBreadcrumbs items={[{ label: runbooksCrumb, href: '/dr/runbooks' }, { label: labels.notFoundTitle }]} />
        <PageHeader title={labels.notFoundTitle} description={labels.notFoundDescription} />
        <Button type="button" variant="outline" onClick={() => router.push('/dr/runbooks')}>
          <ArrowLeft className="me-1.5 h-4 w-4" aria-hidden />
          {labels.backToList}
        </Button>
      </div>
    );
  }

  if (runbookQuery.isLoading && !plan) {
    return (
      <div className="space-y-6">
        <DRBreadcrumbs items={[{ label: runbooksCrumb, href: '/dr/runbooks' }, { label: labels.authorTitle }]} />
        <PageHeader title={labels.authorTitle} description={labels.loading} />
        <LoadingSkeleton variant="card" count={2} />
      </div>
    );
  }

  if ((runbookQuery.error && !plan) || !plan) {
    return (
      <div className="space-y-6">
        <DRBreadcrumbs items={[{ label: runbooksCrumb, href: '/dr/runbooks' }, { label: labels.authorTitle }]} />
        <PageHeader title={labels.authorTitle} description={labels.loadError} />
        <ErrorState message={labels.loadError} onRetry={() => void runbookQuery.refetch()} />
      </div>
    );
  }

  const { runbook, tasks } = plan;

  return (
    <div className="space-y-6">
      <DRBreadcrumbs
        items={[
          { label: runbooksCrumb, href: '/dr/runbooks' },
          { label: runbook.name },
        ]}
      />
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span>{runbook.name}</span>
            <Badge variant="outline" className="normal-case">
              {labels.runbookStatusLabels[runbook.status] ?? runbook.status}
            </Badge>
          </span>
        }
        description={runbook.description || labels.authorDescription}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => router.push('/dr/runbooks')}>
              <ArrowLeft className="me-1.5 h-4 w-4" aria-hidden />
              {labels.backToList}
            </Button>
            <DRWriteGate canWrite={canWrite} description={studioLabels.description}>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setEditOpen(true)}>
                  <Pencil className="me-1.5 h-4 w-4" aria-hidden />
                  {studioLabels.editTriggerLabel}
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => setAddOpen(true)}>
                  <Plus className="me-1.5 h-4 w-4" aria-hidden />
                  {studioLabels.addTaskTriggerLabel}
                </Button>
                <Button type="button" size="sm" onClick={() => setStartOpen(true)}>
                  <Play className="me-1.5 h-4 w-4" aria-hidden />
                  {studioLabels.startRunTriggerLabel}
                </Button>
              </div>
            </DRWriteGate>
          </div>
        }
      />

      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <MetaItem label={labels.groupBoundLabel} value={runbook.group_id || labels.groupUnbound} />
        <MetaItem label={labels.sourceLabel} value={runbook.source} />
        <MetaItem label={labels.taskCountLabel} value={String(tasks.length)} />
      </dl>

      {latestRunId ? (
        <Card data-testid="open-run-card">
          <CardHeader>
            <CardTitle className="text-base">{labels.openRunHeading}</CardTitle>
            <CardDescription>{labels.openRunDescription}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              type="button"
              onClick={() => router.push(`/dr/runbooks/runs/${encodeURIComponent(latestRunId)}`)}
            >
              <Play className="me-1.5 h-4 w-4" aria-hidden />
              {labels.openRunLink}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <RunbookTaskFlow
        tasks={tasks}
        labels={studioLabels.taskFlow}
        title={runbook.name}
        description={studioLabels.description}
      />

      <AddTaskDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        existingTasks={tasks}
        onAddTask={(payload) => addTask(runbook.id, payload)}
        submitting={addTaskPending}
      />

      <EditRunbookDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        runbook={runbook}
        onUpdate={(payload) => updateRunbook(runbook.id, payload)}
        submitting={updateRunbookPending}
      />

      <StartRunDialog
        open={startOpen}
        onOpenChange={setStartOpen}
        onStart={(payload) => startRun(runbook.id, payload)}
        submitting={startRunPending}
      />
    </div>
  );
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-card border border-outline-subtle bg-surface-card p-3">
      <dt className="text-caption font-semibold uppercase tracking-wide text-content-muted">
        {label}
      </dt>
      <dd className="truncate text-body text-content-primary" title={value}>
        {value}
      </dd>
    </div>
  );
}
