'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, BookText, Plus } from 'lucide-react';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { PageHeader } from '@/components/common/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TONE_THEME_CLASS } from '@/components/shared/stat-card';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/use-auth';
import { DR_PERMISSIONS } from '../_lib/dr-permissions';
import { DRWriteGate } from '../_components/console/dr-write-gate';
import { DRSetupEmptyState } from '../_components/empty/dr-setup-empty-state';
import { useDRPosture, useDRRunbook } from '../_hooks/use-dr-queries';
import { useRunbookStudioActions } from '../_hooks/use-dr-actions';
import { useRunbookStudioLabels } from '../_components/runbook-studio/runbook-studio-labels';
import { CreateRunbookDialog } from './_components/create-runbook-dialog';
import { RunbookCatalog } from './_components/runbook-catalog';
import { useRunbookPageLabels } from './_components/runbook-page-labels';
import { useRunbookSelection } from './_components/use-runbook-selection';

/**
 * `/dr/runbooks` — runbook list + create surface.
 *
 * There is NO runbook LIST endpoint (`@/lib/clario-dr` exposes only create / get
 * / put — the studio-runbooks collection has no GET), so this surface drives the
 * "active runbook" off the URL `?runbook=` param (the smallest real alternative
 * the Wave-E foundation documented) and resolves it with `useDRRunbook(id)`.
 * Creating a runbook returns the new record (`latestRunbookId`), which is written
 * straight to the param so a freshly authored runbook is selected without a
 * catalogue. From here the operator opens the runbook to author its task DAG.
 *
 * Authoring (create) is gated behind `dr:write` via the shared `dr-write-gate`.
 */
export default function DRRunbooksPage() {
  const { hasPermission } = useAuth();
  const canWrite = hasPermission(DR_PERMISSIONS.write);

  const labels = useRunbookPageLabels();
  const studioLabels = useRunbookStudioLabels();

  const { runbookId, setRunbook } = useRunbookSelection();
  const [idDraft, setIdDraft] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  // Pre-bind the create dialog to a protection group when opened from a catalog row.
  const [createGroupId, setCreateGroupId] = useState<string | null>(null);

  // Tenant posture drives the cold-start empty state + the runbook catalog (the
  // tenant's protection groups are the runbook scopes — there is no studio-runbook
  // list endpoint to browse, so groups are the honest catalog).
  const postureQuery = useDRPosture();
  const groups = useMemo(() => postureQuery.data?.groups ?? [], [postureQuery.data?.groups]);
  const postureLoaded = !postureQuery.isPending;

  const openCreateForGroup = (groupId: string | null) => {
    setCreateGroupId(groupId);
    setCreateOpen(true);
  };

  const actions = useRunbookStudioActions();
  const { createRunbook, createRunbookPending, latestRunbookId } = actions;

  // After a create resolves, select the new runbook via the URL param + close the
  // dialog. `latestRunbookId` is the real id the create action surfaced.
  useEffect(() => {
    if (latestRunbookId && latestRunbookId !== runbookId) {
      setRunbook(latestRunbookId);
      setCreateOpen(false);
    }
    // Selecting once per new id; runbookId is intentionally excluded so a manual
    // re-selection of a different runbook is not overwritten.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestRunbookId]);

  const runbookQuery = useDRRunbook(runbookId);
  const plan = runbookQuery.data ?? null;

  const openId = idDraft.trim();

  // Cold-start on-ramp: runbooks orchestrate the recovery of a protection group.
  // With zero groups there is nothing to scope a runbook to, so show the
  // create-a-group path (still allowing a tenant-wide runbook via the dialog).
  if (postureLoaded && groups.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow={labels.consoleEyebrow}
          title={labels.listTitle}
          description={labels.listDescription}
        />
        <DRSetupEmptyState description={labels.setupDescription} />
        <CreateRunbookDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          onCreate={createRunbook}
          submitting={createRunbookPending}
          groups={groups}
          defaultGroupId={createGroupId}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={labels.consoleEyebrow}
        title={labels.listTitle}
        description={labels.listDescription}
        tags={
          plan
            ? [
                {
                  label: labels.runbookStatusLabels[plan.runbook.status] ?? plan.runbook.status,
                  tone:
                    plan.runbook.status === 'published'
                      ? 'success'
                      : plan.runbook.status === 'archived'
                        ? 'warning'
                        : 'neutral',
                },
                { label: `${labels.taskCountLabel}: ${plan.tasks.length}`, tone: 'info' },
              ]
            : undefined
        }
        actions={
          <DRWriteGate canWrite={canWrite} description={studioLabels.description}>
            <Button type="button" onClick={() => openCreateForGroup(null)}>
              <Plus className="me-1.5 h-4 w-4" aria-hidden />
              {studioLabels.createTriggerLabel}
            </Button>
          </DRWriteGate>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{labels.selectorLabel}</CardTitle>
          <CardDescription>{labels.selectorEmpty}</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
            onSubmit={(event) => {
              event.preventDefault();
              if (openId) setRunbook(openId);
            }}
          >
            <div className="flex-1 space-y-2">
              <Label htmlFor="runbook-id-input">{labels.selectorLabel}</Label>
              <Input
                id="runbook-id-input"
                value={idDraft}
                onChange={(event) => setIdDraft(event.target.value)}
                placeholder={labels.selectorPlaceholder}
                autoComplete="off"
                dir="ltr"
              />
            </div>
            <Button type="submit" variant="outline" disabled={!openId}>
              {labels.openAuthor}
            </Button>
          </form>
        </CardContent>
      </Card>

      <RunbookCatalog
        groups={groups}
        labels={labels}
        loaded={postureLoaded}
        canCreate={canWrite}
        onCreateForGroup={openCreateForGroup}
      />

      {plan ? (
        <Card interactive data-testid="selected-runbook-card">
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              <BookText className="h-4 w-4 text-primary" aria-hidden />
              <span>{plan.runbook.name}</span>
              <Badge variant="outline" className="normal-case">
                {labels.runbookStatusLabels[plan.runbook.status] ?? plan.runbook.status}
              </Badge>
              {latestRunbookId && latestRunbookId === plan.runbook.id ? (
                <Badge variant="secondary">{labels.createdJustNow}</Badge>
              ) : null}
            </CardTitle>
            {plan.runbook.description ? (
              <CardDescription>{plan.runbook.description}</CardDescription>
            ) : null}
          </CardHeader>
          <CardContent className="flex flex-wrap items-center justify-between gap-3">
            <div
              className={cn(
                TONE_THEME_CLASS.sky,
                'rounded-lg border bg-[var(--kpi-bg)] border-[var(--kpi-border)] px-3 py-2',
              )}
            >
              <div className="text-xs font-semibold uppercase text-[color:var(--kpi-accent)]">
                {labels.taskCountLabel}
              </div>
              <div className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-foreground">
                {plan.tasks.length}
              </div>
            </div>
            <Button asChild>
              <Link href={`/dr/runbooks/${encodeURIComponent(plan.runbook.id)}`}>
                {labels.openAuthor}
                <ArrowRight className="ms-1.5 h-4 w-4" aria-hidden />
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : runbookId && runbookQuery.error ? (
        <ErrorState
          message={labels.loadError}
          error={runbookQuery.error}
          onRetry={() => void runbookQuery.refetch()}
        />
      ) : (
        <EmptyState
          icon={BookText}
          title={labels.noSelectionTitle}
          description={labels.noSelectionDescription}
          action={
            canWrite
              ? { label: labels.createRunbookCta, onClick: () => openCreateForGroup(null) }
              : undefined
          }
        />
      )}

      <CreateRunbookDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreate={createRunbook}
        submitting={createRunbookPending}
        groups={groups}
        defaultGroupId={createGroupId}
      />
    </div>
  );
}
