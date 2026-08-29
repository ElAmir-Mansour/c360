'use client';

import { useEffect, useState } from 'react';
import { Check, Loader2, SkipForward, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { StatusChip } from '@/components/shared/status-chip';
import type { RunbookTaskRunStatus } from '@/components/product';
import type { DRRunbookActionRequest, DRRunbookTask } from '@/types/clario-dr';
import { useRunbookStudioLabels } from '../../_components/runbook-studio/runbook-studio-labels';
import { useRunbookPageLabels } from './runbook-page-labels';

export type RunbookTaskAction = 'complete' | 'skip' | 'fail';

export interface ActOnTaskPanelProps {
  /** The task the operator selected in the flow (null = nothing selected). */
  task: DRRunbookTask | null;
  /** The selected task's derived live status (drives actionability). */
  status: RunbookTaskRunStatus | null;
  /** Fired with the chosen action + optional note. Gated upstream by `dr:write`. */
  onAct: (taskId: string, action: RunbookTaskAction, payload?: DRRunbookActionRequest) => void;
  pending: boolean;
}

/**
 * Live-run action panel. For the task the operator selected in the
 * `RunbookTaskFlow`, it offers Complete / Skip / Fail — wired to
 * `actOnDRRunbookTask` via the studio action hook — plus an optional note and a
 * "fail the whole run" toggle (the real {@link DRRunbookActionRequest} fields).
 *
 * Actionability follows the engine: only a `runnable` or `running` task can be
 * acted on; pending/blocked/terminal tasks are surfaced read-only with an
 * explanatory message. The panel itself is permission-free — the page wraps it in
 * the shared `dr-write-gate`, which natively disables every control for an
 * operator lacking `dr:write`.
 */
export function ActOnTaskPanel({ task, status, onAct, pending }: ActOnTaskPanelProps) {
  const labels = useRunbookStudioLabels();
  const pageLabels = useRunbookPageLabels();

  const [note, setNote] = useState('');
  const [failRun, setFailRun] = useState(false);

  // Reset the note + fail-run toggle whenever the selected task changes so an
  // operator's draft note never leaks across tasks.
  useEffect(() => {
    setNote('');
    setFailRun(false);
  }, [task?.id]);

  const actionable = status === 'runnable' || status === 'running';

  const act = (action: RunbookTaskAction) => {
    if (!task) return;
    const trimmed = note.trim();
    const payload: DRRunbookActionRequest = {};
    if (trimmed) payload.note = trimmed;
    if (action === 'fail' && failRun) payload.fail_run = true;
    onAct(task.id, action, Object.keys(payload).length > 0 ? payload : undefined);
  };

  return (
    <Card data-testid="act-on-task-panel" data-actionable={actionable ? 'true' : 'false'}>
      <CardHeader>
        <CardTitle className="text-base">{pageLabels.actHeading}</CardTitle>
        <CardDescription>{pageLabels.actDescription}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!task ? (
          <p className="text-sm text-muted-foreground">{pageLabels.selectTaskPrompt}</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-body font-semibold text-content-primary">{task.name}</span>
              <span className="font-mono text-xs text-content-muted" dir="ltr">
                {task.task_key}
              </span>
              {status ? (
                <StatusChip tone="neutral" size="sm" label={labels.taskFlow.statuses[status]} />
              ) : null}
              <StatusChip
                tone="neutral"
                size="sm"
                label={task.required ? pageLabels.taskRequiredBadge : pageLabels.taskOptionalBadge}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="runbook-task-note">{labels.noteLabel}</Label>
              <Textarea
                id="runbook-task-note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder={labels.notePlaceholder}
                rows={2}
                disabled={!actionable}
              />
            </div>

            <label className="flex items-center gap-2 text-sm text-foreground">
              <Checkbox
                checked={failRun}
                onCheckedChange={(next) => setFailRun(next === true)}
                disabled={!actionable}
              />
              {labels.failRunLabel}
            </label>

            {actionable ? (
              <div className="flex flex-wrap gap-2">
                <Button type="button" onClick={() => act('complete')} disabled={pending}>
                  {pending ? (
                    <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    <Check className="me-2 h-4 w-4" aria-hidden />
                  )}
                  {labels.completeTaskLabel}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => act('skip')}
                  disabled={pending}
                >
                  <SkipForward className="me-2 h-4 w-4" aria-hidden />
                  {labels.skipTaskLabel}
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => act('fail')}
                  disabled={pending}
                >
                  <X className="me-2 h-4 w-4" aria-hidden />
                  {labels.failTaskLabel}
                </Button>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground" role="status">
                {pageLabels.noActionableTask}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
