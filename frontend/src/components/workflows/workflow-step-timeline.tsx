'use client';

import { useState } from 'react';
import { CheckCircle, XCircle, Circle, Minus, ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getStepIcon } from '@/lib/workflow-utils';
import { Badge } from '@/components/ui/badge';
import {
  formatWorkflowDateTime,
  formatWorkflowDuration,
  useWorkflowPageLabels,
  workflowStepStatusLabel,
  workflowStepTypeLabel,
} from '@/app/(dashboard)/workflows/_lib/workflow-page-i18n';
import type { StepExecution, StepDefinition, StepType } from '@/types/models';

interface WorkflowStepTimelineProps {
  steps: StepExecution[];
  currentStepId: string | null;
  definitionSteps: StepDefinition[];
}

function StepIndicator({ status, isCurrent }: { status: string; isCurrent: boolean }) {
  if (isCurrent) {
    return (
      <div className="relative flex h-6 w-6 items-center justify-center">
        <span className="absolute inline-flex h-6 w-6 animate-ping rounded-full bg-blue-400 opacity-50" />
        <span className="relative h-3.5 w-3.5 rounded-full bg-blue-500" />
      </div>
    );
  }
  if (status === 'completed') {
    return <CheckCircle className="h-5 w-5 text-primary" />;
  }
  if (status === 'failed') {
    return <XCircle className="h-5 w-5 text-error-500" />;
  }
  if (status === 'skipped') {
    return <Minus className="h-5 w-5 text-foreground/45" />;
  }
  return <Circle className="h-5 w-5 text-foreground/30" />;
}

interface StepRowProps {
  step: StepDefinition;
  execution?: StepExecution;
  isCurrent: boolean;
  isLast: boolean;
}

function StepRow({ step, execution, isCurrent, isLast }: StepRowProps) {
  const [expanded, setExpanded] = useState(false);
  const labels = useWorkflowPageLabels();
  const StepIcon = getStepIcon(step.type);
  const status = isCurrent ? 'running' : execution?.status ?? 'pending';

  const lineColor = cn('absolute left-[11px] top-6 h-[calc(100%-8px)] border-l', {
    'border-primary/30': status === 'completed',
    'border-blue-300': isCurrent,
    'border-error-300': status === 'failed',
    'border-dashed border-primary/20': status === 'pending' || status === 'skipped',
  });

  const hasOutput = execution?.output && Object.keys(execution.output).length > 0;

  return (
    <div className="relative flex gap-3 pb-4">
      {!isLast && <div className={lineColor} />}

      <div className="relative z-10 mt-0.5 shrink-0">
        <StepIndicator status={status} isCurrent={isCurrent} />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-1.5">
              <StepIcon className="h-3.5 w-3.5 text-muted-foreground" />
              <span
                className={cn(
                  'text-sm font-medium',
                  isCurrent && 'text-blue-700',
                  status === 'failed' && 'text-error-600',
                  status === 'pending' && 'text-muted-foreground',
                )}
              >
                {step.name}
              </span>
              {isCurrent && (
                <Badge variant="secondary" className="text-xs bg-blue-100 text-blue-700">
                  {workflowStepStatusLabel(labels, 'running', 'In Progress')}
                </Badge>
              )}
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {workflowStepTypeLabel(labels, step.type, step.type)}
            </p>
          </div>

          {hasOutput && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="shrink-0 p-0.5 rounded hover:bg-muted"
            >
              {expanded ? (
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
              )}
            </button>
          )}
        </div>

        {/* Status details */}
        {execution && (
          <div className="mt-1 text-xs text-muted-foreground">
            {status === 'completed' && execution.completed_at && (
              <span>
                {workflowStepStatusLabel(labels, 'completed', 'Completed')}
                {execution.completed_by
                  ? `${labels.locale === 'ar' ? ' بواسطة ' : ' by '}${execution.completed_by}`
                  : ''}
                {execution.duration_seconds
                  ? ` · ${formatWorkflowDuration(execution.duration_seconds, labels)}`
                  : ''}
                {' · '}
                {formatWorkflowDateTime(execution.completed_at, labels)}
              </span>
            )}
            {isCurrent && (
              <span>
                {workflowStepStatusLabel(labels, 'running', 'In progress')}
                {execution.assigned_to
                  ? ` · ${labels.stepStatuses.claimedBy} ${execution.assigned_to}`
                  : ` · ${labels.stepStatuses.waitingForAssignment}`}
              </span>
            )}
            {status === 'failed' && execution.error && (
              <span className="text-error-500">
                {workflowStepStatusLabel(labels, 'failed', 'Failed')}: {execution.error}
              </span>
            )}
            {status === 'skipped' && (
              <span>{workflowStepStatusLabel(labels, 'skipped', 'Skipped')}</span>
            )}
          </div>
        )}

        {!execution && !isCurrent && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            {workflowStepStatusLabel(labels, 'pending', 'Pending')}
          </p>
        )}

        {/* Expanded output */}
        {expanded && hasOutput && (
          <div className="mt-2 rounded border bg-muted/50 p-2">
            <pre className="overflow-auto text-xs text-muted-foreground whitespace-pre-wrap">
              {JSON.stringify(execution?.output, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

export function WorkflowStepTimeline({
  steps,
  currentStepId,
  definitionSteps,
}: WorkflowStepTimelineProps) {
  const labels = useWorkflowPageLabels();

  if (definitionSteps.length === 0 && steps.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">{labels.stepStatuses.noStepsAvailable}</p>
    );
  }

  // Build display list from definition steps, annotated with execution data
  const execByStepId = new Map(steps.map((s) => [s.step_id, s]));

  const displaySteps =
    definitionSteps.length > 0
      ? definitionSteps
      : steps.map((s) => ({ id: s.step_id, name: s.step_name ?? s.step_id, type: s.step_type as StepType }));

  return (
    <div className="space-y-0">
      {displaySteps.map((defStep, idx) => (
        <StepRow
          key={defStep.id}
          step={defStep}
          execution={execByStepId.get(defStep.id)}
          isCurrent={defStep.id === currentStepId}
          isLast={idx === displaySteps.length - 1}
        />
      ))}
    </div>
  );
}
