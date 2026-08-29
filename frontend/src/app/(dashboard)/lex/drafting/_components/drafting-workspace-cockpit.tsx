'use client';

import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { ArrowRight, ClipboardCheck, History, Play, Route, Sparkles } from 'lucide-react';
import { SectionCard } from '@/components/suites/section-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { useLexFormat } from '@/lib/lex/ksa';
import { type DraftingLabels, useDraftingLabels } from './drafting-shared';
import {
  DRAFTING_HISTORY_EVENT,
  DRAFTING_WORKSPACE_EVENT,
  type DraftingRunRecord,
  type DraftingTaskKey,
  type DraftingWorkspaceSnapshot,
  type DraftingWorkspaceVersion,
  readDraftingHistory,
  readDraftingWorkspaceSnapshot,
  writeDraftingHandoff,
} from './drafting-workspace';

export interface DraftingCockpitTask {
  value: DraftingTaskKey;
  label: string;
}

export interface DraftingWorkspaceCockpitProps {
  tasks: DraftingCockpitTask[];
  activeTask: DraftingTaskKey;
  workspaceId: string;
  projectId?: string;
  activeVersionId?: string;
  onTaskChange: (task: DraftingTaskKey) => void;
  onWorkspaceChange: (workspaceId: string) => void;
  onRestoreVersion: (version: DraftingWorkspaceVersion) => void;
}

type RecipeKey = 'clauseNegotiation' | 'contractReview' | 'rfpResponse';

const RECIPES: Array<{
  id: string;
  key: RecipeKey;
  target: DraftingTaskKey;
  steps: DraftingTaskKey[];
}> = [
  {
    id: 'clause-negotiation',
    key: 'clauseNegotiation',
    target: 'clause',
    steps: ['clause', 'fallbacks', 'rewrite', 'translate'],
  },
  {
    id: 'contract-review',
    key: 'contractReview',
    target: 'summarize',
    steps: ['summarize', 'glossary', 'obligationQa'],
  },
  {
    id: 'rfp-response',
    key: 'rfpResponse',
    target: 'rfp',
    steps: ['rfp', 'rewrite', 'translate'],
  },
];

function taskLabel(tasks: DraftingCockpitTask[], task: DraftingTaskKey): string {
  return tasks.find((item) => item.value === task)?.label ?? task;
}

function nextActionFor(
  snapshot: DraftingWorkspaceSnapshot | null,
  activeTask: DraftingTaskKey,
  cockpit: DraftingLabels['cockpit'],
): string {
  const latest = snapshot?.versions[0];
  if (!latest) return cockpit.nextAction.generateFirst;
  if (latest.riskLevel && ['critical', 'high'].includes(String(latest.riskLevel).toLowerCase())) {
    return cockpit.nextAction.reviewRiskGates;
  }
  if (activeTask === 'clause') return cockpit.nextAction.createFallbacks;
  if (activeTask === 'contract') return cockpit.nextAction.summarizeDraft;
  if (activeTask === 'translate') return cockpit.nextAction.compareEquivalence;
  return cockpit.nextAction.publishOrChain;
}

export function DraftingWorkspaceCockpit({
  tasks,
  activeTask,
  workspaceId,
  projectId,
  activeVersionId,
  onTaskChange,
  onWorkspaceChange,
  onRestoreVersion,
}: DraftingWorkspaceCockpitProps) {
  const f = useLexFormat();
  const cockpit = useDraftingLabels().cockpit;
  const [draftWorkspaceId, setDraftWorkspaceId] = useState(workspaceId);
  const [snapshot, setSnapshot] = useState<DraftingWorkspaceSnapshot | null>(null);
  const [history, setHistory] = useState<DraftingRunRecord[]>([]);

  useEffect(() => {
    setDraftWorkspaceId(workspaceId);
  }, [workspaceId]);

  useEffect(() => {
    const refresh = () => {
      setSnapshot(readDraftingWorkspaceSnapshot(workspaceId, { projectId, activeTask }));
      setHistory(readDraftingHistory());
    };
    refresh();
    window.addEventListener(DRAFTING_WORKSPACE_EVENT, refresh);
    window.addEventListener(DRAFTING_HISTORY_EVENT, refresh);
    return () => {
      window.removeEventListener(DRAFTING_WORKSPACE_EVENT, refresh);
      window.removeEventListener(DRAFTING_HISTORY_EVENT, refresh);
    };
  }, [activeTask, projectId, workspaceId]);

  const activeTaskRuns = useMemo(
    () => history.filter((record) => record.task === activeTask).slice(0, 3),
    [activeTask, history],
  );
  const latestVersion = snapshot?.versions[0];
  const highRiskCount = snapshot?.versions.filter((version) =>
    ['critical', 'high'].includes(String(version.riskLevel ?? '').toLowerCase()),
  ).length ?? 0;
  const completedTasks = new Set(snapshot?.versions.map((version) => version.task) ?? []);

  const submitWorkspace = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onWorkspaceChange(draftWorkspaceId);
  };

  return (
    <SectionCard
      title={
        <span className="inline-flex items-center gap-2">
          <Route className="h-4 w-4" aria-hidden="true" />
          {cockpit.title}
        </span>
      }
      description={cockpit.description}
      contentClassName="space-y-4"
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="space-y-4">
          <form className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]" onSubmit={submitWorkspace}>
            <div className="space-y-2">
              <Label htmlFor="drafting-workspace-id">{cockpit.workspace}</Label>
              <Input
                id="drafting-workspace-id"
                value={draftWorkspaceId}
                onChange={(event) => setDraftWorkspaceId(event.target.value)}
              />
            </div>
            <Button type="submit" variant="outline" className="self-end">
              {cockpit.open}
            </Button>
          </form>

          <div className="grid gap-2 sm:grid-cols-3">
            <div className="rounded-md border bg-muted/20 p-3">
              <p className="text-xs text-muted-foreground">{cockpit.activeTask}</p>
              <p className="mt-1 text-sm font-semibold">{taskLabel(tasks, activeTask)}</p>
            </div>
            <div className="rounded-md border bg-muted/20 p-3">
              <p className="text-xs text-muted-foreground">{cockpit.versions}</p>
              <p className="mt-1 text-sm font-semibold">{snapshot?.versions.length ?? 0}</p>
            </div>
            <div className="rounded-md border bg-muted/20 p-3">
              <p className="text-xs text-muted-foreground">{cockpit.riskFlags}</p>
              <p className="mt-1 text-sm font-semibold">{highRiskCount}</p>
            </div>
          </div>

          <div className="rounded-md border bg-muted/20 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <ClipboardCheck className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                {cockpit.readiness}
              </div>
              <Badge variant={latestVersion ? 'success' : 'warning'}>
                {latestVersion ? cockpit.readyForReview : cockpit.needsFirstRun}
              </Badge>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              {nextActionFor(snapshot, activeTask, cockpit)}
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {tasks.slice(0, 6).map((task) => (
                <Badge
                  key={task.value}
                  variant={completedTasks.has(task.value) ? 'success' : 'outline'}
                  className="tracking-normal normal-case"
                >
                  {task.label}
                </Badge>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-md border bg-muted/20 p-3">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium">
              <Sparkles className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              {cockpit.recipes}
            </div>
            <div className="grid gap-2 lg:grid-cols-3">
              {RECIPES.map((recipe) => (
                <button
                  key={recipe.id}
                  type="button"
                  className="card-interactive px-3 py-2.5 text-start"
                  onClick={() => {
                    writeDraftingHandoff({
                      target: recipe.target,
                      text: cockpit.recipePrompts[recipe.key],
                      title: cockpit.recipeTitles[recipe.key],
                      sourceTask: activeTask,
                    });
                    onTaskChange(recipe.target);
                  }}
                >
                  <span className="block text-sm font-medium">{cockpit.recipeTitles[recipe.key]}</span>
                  <span className="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                    {recipe.steps.map((step, index) => (
                      <span key={step} className="inline-flex items-center gap-1">
                        {index > 0 ? <ArrowRight className="h-3 w-3 rtl:-scale-x-100" aria-hidden="true" /> : null}
                        {taskLabel(tasks, step)}
                      </span>
                    ))}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-md border bg-muted/20 p-3">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <History className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                {cockpit.recentVersions}
              </div>
              <Badge variant="outline" className="tracking-normal normal-case">
                {cockpit.runCount(history.length)}
              </Badge>
            </div>
            {snapshot?.versions.length ? (
              <div className="space-y-2">
                {snapshot.versions.slice(0, 4).map((version) => (
                  <button
                    key={version.id}
                    type="button"
                    className={cn(
                      'card-interactive block w-full px-3 py-2.5 text-start',
                      activeVersionId === version.id && 'ring-1 ring-primary/40',
                    )}
                    onClick={() => onRestoreVersion(version)}
                  >
                    <span className="flex flex-wrap items-center justify-between gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{version.title}</span>
                      <span className="flex items-center gap-1.5">
                        {activeVersionId === version.id ? <Badge variant="success">{cockpit.active}</Badge> : null}
                        <Badge variant="outline" className="tracking-normal normal-case">
                          {taskLabel(tasks, version.task)}
                        </Badge>
                      </span>
                    </span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {f.formatDual(version.createdAt, {
                        dateOptions: { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' },
                      })}
                    </span>
                  </button>
                ))}
              </div>
            ) : activeTaskRuns.length ? (
              <div className="space-y-2">
                {activeTaskRuns.map((record) => (
                  <button
                    key={record.id}
                    type="button"
                    className="card-interactive block w-full px-3 py-2.5 text-start"
                    onClick={() =>
                      writeDraftingHandoff({
                        target: record.task,
                        text: record.text,
                        title: record.title,
                        payload: { record_id: record.id },
                      })
                    }
                  >
                    <span className="block truncate text-sm font-medium">{record.title}</span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {f.formatRelative(record.createdAt)}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                {cockpit.noVersions}
              </div>
            )}
          </div>
        </div>
      </div>
    </SectionCard>
  );
}
