'use client';

import { Fragment, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { getStepIcon } from '@/lib/workflow-utils';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/shared/status-badge';
import { workflowStatusConfig, type StatusConfig } from '@/lib/status-configs';
import { WorkflowStepTimeline } from './workflow-step-timeline';
import {
  formatWorkflowDateTime,
  formatWorkflowDuration,
  useWorkflowPageLabels,
  workflowLabel,
  workflowStepStatusLabel,
  workflowStepTypeLabel,
  type WorkflowPageLabels,
} from '@/app/(dashboard)/workflows/_lib/workflow-page-i18n';
import type { WorkflowInstance, StepExecution } from '@/types/models';

interface WorkflowInstanceDetailProps {
  instance: WorkflowInstance;
  history: StepExecution[];
}

function getLocalizedWorkflowStatusConfig(labels: WorkflowPageLabels): StatusConfig {
  return Object.fromEntries(
    Object.entries(workflowStatusConfig).map(([status, config]) => [
      status,
      { ...config, label: workflowLabel(labels, status, config.label) },
    ]),
  ) as StatusConfig;
}

function VariablesSection({
  variables,
  labels,
}: {
  variables: Record<string, unknown>;
  labels: WorkflowPageLabels;
}) {
  const entries = Object.entries(variables);
  if (entries.length === 0) return null;

  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold">{labels.instance.variables}</h3>
      <div className="rounded-lg border divide-y">
        {entries.map(([key, val]) => (
          <div key={key} className="flex items-start justify-between gap-4 px-3 py-2 text-sm">
            <span className="font-medium text-muted-foreground shrink-0">{key}</span>
            <span className="text-right font-mono text-xs break-all">
              {typeof val === 'object' ? JSON.stringify(val) : String(val ?? '—')}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function StepOutputsSection({
  outputs,
  labels,
}: {
  outputs: Record<string, Record<string, unknown>>;
  labels: WorkflowPageLabels;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const entries = Object.entries(outputs);
  if (entries.length === 0) return null;

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold">{labels.instance.stepOutputs}</h3>
      <div className="space-y-1.5">
        {entries.map(([stepId, output]) => (
          <div key={stepId} className="rounded-lg border">
            <button
              onClick={() => toggle(stepId)}
              className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-muted/50"
            >
              <span className="font-medium">{stepId}</span>
              {expanded.has(stepId) ? (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              )}
            </button>
            {expanded.has(stepId) && (
              <div className="border-t bg-muted/30 px-3 py-2">
                <pre className="overflow-auto text-xs text-muted-foreground whitespace-pre-wrap">
                  {JSON.stringify(output, null, 2)}
                </pre>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function StepHistoryTable({ steps, labels }: { steps: StepExecution[]; labels: WorkflowPageLabels }) {
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  const toggle = (id: string) => setExpandedRow((prev) => (prev === id ? null : id));

  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold">{labels.instance.stepExecutionHistory}</h3>
      <div className="overflow-hidden rounded-lg border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/30">
            <tr>
              <th className="px-3 py-2 text-start text-xs font-medium text-muted-foreground">{labels.instance.step}</th>
              <th className="px-3 py-2 text-start text-xs font-medium text-muted-foreground">{labels.instance.type}</th>
              <th className="px-3 py-2 text-start text-xs font-medium text-muted-foreground">{labels.instance.status}</th>
              <th className="hidden px-3 py-2 text-start text-xs font-medium text-muted-foreground md:table-cell">{labels.instance.started}</th>
              <th className="hidden px-3 py-2 text-start text-xs font-medium text-muted-foreground lg:table-cell">{labels.instance.duration}</th>
              <th className="hidden px-3 py-2 text-start text-xs font-medium text-muted-foreground lg:table-cell">{labels.instance.attempt}</th>
            </tr>
          </thead>
          <tbody>
            {steps.map((step) => {
              const StepIcon = getStepIcon(step.step_type);
              const isExpanded = expandedRow === step.id;
              return (
                <Fragment key={step.id}>
                  <tr
                    className="border-b last:border-0 hover:bg-muted/30 cursor-pointer"
                    onClick={() => toggle(step.id)}
                  >
                    <td className="px-3 py-2 font-medium">{step.step_name ?? step.step_id}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        <StepIcon className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-xs text-muted-foreground">
                          {workflowStepTypeLabel(labels, step.step_type, step.step_type)}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <Badge
                        variant={
                          step.status === 'completed'
                            ? 'success'
                            : step.status === 'failed'
                            ? 'destructive'
                            : step.status === 'running'
                            ? 'default'
                            : 'secondary'
                        }
                        className="text-xs"
                      >
                        {workflowStepStatusLabel(labels, step.status, step.status)}
                      </Badge>
                    </td>
                    <td className="hidden px-3 py-2 text-xs text-muted-foreground md:table-cell">
                      {step.started_at ? formatWorkflowDateTime(step.started_at, labels) : '—'}
                    </td>
                    <td className="hidden px-3 py-2 text-xs text-muted-foreground lg:table-cell">
                      {step.duration_ms != null
                        ? formatWorkflowDuration(Math.round(step.duration_ms / 1000), labels)
                        : step.duration_seconds != null
                          ? formatWorkflowDuration(step.duration_seconds, labels)
                          : '—'}
                    </td>
                    <td className="hidden px-3 py-2 text-xs text-muted-foreground lg:table-cell">
                      {step.attempt}
                    </td>
                  </tr>
                  {isExpanded && ((step.input_data ?? step.input) || (step.output_data ?? step.output) || (step.error_message ?? step.error)) && (
                    <tr className="border-b last:border-0 bg-muted/20">
                      <td colSpan={6} className="px-3 py-3">
                        <div className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
                          {(step.input_data ?? step.input) && (
                            <div>
                              <p className="mb-1 font-semibold text-muted-foreground">{labels.instance.input}</p>
                              <pre className="overflow-auto rounded border bg-background p-2 whitespace-pre-wrap">
                                {JSON.stringify(step.input_data ?? step.input, null, 2)}
                              </pre>
                            </div>
                          )}
                          {(step.output_data ?? step.output) && (
                            <div>
                              <p className="mb-1 font-semibold text-muted-foreground">{labels.instance.output}</p>
                              <pre className="overflow-auto rounded border bg-background p-2 whitespace-pre-wrap">
                                {JSON.stringify(step.output_data ?? step.output, null, 2)}
                              </pre>
                            </div>
                          )}
                          {(step.error_message ?? step.error) && (
                            <div className="sm:col-span-2">
                              <p className="mb-1 font-semibold text-destructive">{labels.instance.error}</p>
                              <p className="text-destructive">{step.error_message ?? step.error}</p>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function WorkflowInstanceDetail({
  instance,
  history,
}: WorkflowInstanceDetailProps) {
  const labels = useWorkflowPageLabels();
  const localizedStatusConfig = getLocalizedWorkflowStatusConfig(labels);

  return (
    <div className="space-y-6">
      {/* Header info */}
      <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
        <StatusBadge status={instance.status} config={localizedStatusConfig} />
        <span>{labels.instance.startedAt(formatWorkflowDateTime(instance.started_at, labels))}</span>
        {instance.started_by_name ? (
          <span>{labels.instance.startedBy(instance.started_by_name)}</span>
        ) : (
          <Badge variant="secondary" className="text-xs">{labels.instance.systemTrigger}</Badge>
        )}
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_300px]">
        {/* Left: step timeline */}
        <div className="space-y-6">
          <div>
            <h3 className="mb-3 text-sm font-semibold">{labels.instance.workflowSteps}</h3>
            <WorkflowStepTimeline
              steps={history}
              currentStepId={instance.current_step_id}
              definitionSteps={instance.definition_steps ?? []}
            />
          </div>
          <StepHistoryTable steps={history} labels={labels} />
        </div>

        {/* Right: variables and outputs */}
        <div className="space-y-6">
          <VariablesSection variables={instance.variables} labels={labels} />
          <StepOutputsSection outputs={instance.step_outputs ?? {}} labels={labels} />
        </div>
      </div>
    </div>
  );
}
