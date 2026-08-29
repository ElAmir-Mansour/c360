'use client';

import React from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import {
  CheckCircle2,
  Eye,
  ClipboardList,
  Bell,
  GitBranch,
  GitMerge,
  Timer,
  Globe,
  Code2,
  Workflow,
  CircleDot,
  UserCheck,
  AlertCircle,
  AlertTriangle,
  FileText,
  Users,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  formatApprovalModeLabel,
  formatApprovalTypeLabel,
  formatAssigneeStrategyLabel,
  formatChannelLabel,
  formatStepTypeLabel,
  getDefinitionLabels,
} from '../../../definition-i18n';
import type { WorkflowStep, WorkflowStepType } from '@/types/models';

/**
 * Per-step visual config. Keys are the *designer* step types (which map 1:1 to
 * the backend FSM step types via {@link backendStepType}). The palette/adapter
 * own that mapping; here we only render. Visuals are ported from the legacy
 * `step-node.tsx` so the look is unchanged after the React Flow migration.
 */
const STEP_VISUAL: Record<
  WorkflowStepType,
  { icon: React.ElementType; color: string; bg: string; backend: string }
> = {
  approval: { icon: CheckCircle2, color: 'text-blue-700', bg: 'bg-blue-50 border-blue-200', backend: 'human_task' },
  approval_chain: { icon: UserCheck, color: 'text-success-700', bg: 'bg-success-50 border-success-100', backend: 'approval_chain' },
  review: { icon: Eye, color: 'text-indigo-700', bg: 'bg-indigo-50 border-indigo-200', backend: 'human_task' },
  task: { icon: ClipboardList, color: 'text-teal-700', bg: 'bg-teal-50 border-teal-200', backend: 'human_task' },
  notification: { icon: Bell, color: 'text-purple-700', bg: 'bg-purple-50 border-purple-200', backend: 'service_task' },
  condition: { icon: GitBranch, color: 'text-yellow-700', bg: 'bg-yellow-50 border-yellow-300', backend: 'condition' },
  parallel_gateway: { icon: GitMerge, color: 'text-warning-700', bg: 'bg-warning-50 border-warning-100', backend: 'parallel_gateway' },
  join_gateway: { icon: GitMerge, color: 'text-warning-700', bg: 'bg-warning-50 border-warning-100', backend: 'parallel_gateway' },
  delay: { icon: Timer, color: 'text-foreground', bg: 'bg-secondary border-primary/15', backend: 'timer' },
  webhook: { icon: Globe, color: 'text-cyan-700', bg: 'bg-cyan-50 border-cyan-200', backend: 'event_task' },
  script: { icon: Code2, color: 'text-primary', bg: 'bg-primary/10 border-primary/30', backend: 'service_task' },
  sub_workflow: { icon: Workflow, color: 'text-pink-700', bg: 'bg-pink-50 border-pink-200', backend: 'service_task' },
  end: { icon: CircleDot, color: 'text-error-600', bg: 'bg-error-50 border-error-300', backend: 'end' },
};

export interface RfStepNodeData extends Record<string, unknown> {
  step: WorkflowStep;
  /** Validation issues attached to this node by the lint pass. */
  issues?: { level: 'error' | 'warning'; message: string }[];
  /** Live-run / simulate status, e.g. running|completed|failed|pending. */
  stepStatus?: string;
  readOnly?: boolean;
  isAr?: boolean;
}

const HUMAN_TYPES = new Set<WorkflowStepType>(['approval', 'review', 'task']);

/** Small pill badge surfaced under the node title. */
function Badge({ icon: Icon, children }: { icon?: React.ElementType; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded bg-background/70 px-1.5 py-0.5 text-overline font-medium text-muted-foreground">
      {Icon && <Icon className="h-2.5 w-2.5" />}
      {children}
    </span>
  );
}

/**
 * The single custom React Flow node used for every step type. It selects its
 * icon/colour from {@link STEP_VISUAL} by `data.step.type`, renders the
 * type-specific key badges (assignee/role, SLA, form ref, approval mode), and
 * paints a validation-state ring driven by the lint pass.
 *
 * Registered under every designer step type so `node.type` round-trips the FSM
 * step type (see the `nodeTypes` map in workflow-canvas.tsx).
 */
function RfStepNodeImpl({ data, selected }: NodeProps) {
  const { step, issues = [], stepStatus, readOnly, isAr = false } = data as RfStepNodeData;
  const locale = isAr ? 'ar' : 'en';
  const localLabels = getDefinitionLabels(locale);
  const visual = STEP_VISUAL[step.type] ?? STEP_VISUAL.task;
  const Icon = visual.icon;

  const hasError = issues.some((i) => i.level === 'error');
  const hasWarning = !hasError && issues.some((i) => i.level === 'warning');

  const isHuman = HUMAN_TYPES.has(step.type);
  const assignee = isHuman
    ? formatAssigneeStrategyLabel(step.assignee_strategy?.type, locale)
    : null;

  // Key badges per type.
  const badges: React.ReactNode[] = [];
  if (assignee) badges.push(<Badge key="assignee" icon={UserCheck}>{assignee}</Badge>);
  if (isHuman && step.config.form_schema && step.config.form_schema.length > 0) {
    badges.push(
      <Badge key="form" icon={FileText}>
        {isAr ? `${step.config.form_schema.length} حقل` : `${step.config.form_schema.length} fields`}
      </Badge>,
    );
  }
  if (step.type === 'approval' && step.config.approval_type) {
    badges.push(
      <Badge key="apptype">
        {formatApprovalTypeLabel(step.config.approval_type, locale)}
      </Badge>,
    );
  }
  if (step.type === 'approval_chain') {
    const n = step.config.approvers?.length ?? 0;
    badges.push(
      <Badge key="chain" icon={Users}>
        {formatApprovalModeLabel(step.config.mode ?? 'sequential', locale)} · {n}
      </Badge>,
    );
  }
  if (step.type === 'delay' && step.config.delay_minutes) {
    badges.push(
      <Badge key="delay" icon={Timer}>
        {step.config.delay_minutes}{isAr ? 'د' : 'm'}
      </Badge>,
    );
  }
  if (step.type === 'notification' && step.config.notification_channels?.length) {
    badges.push(
      <Badge key="ch" icon={Bell}>
        {step.config.notification_channels.map((ch) => formatChannelLabel(ch, locale)).join(', ')}
      </Badge>,
    );
  }
  if (step.type === 'webhook' && step.config.webhook_method) {
    badges.push(<Badge key="wh" icon={Globe}>{step.config.webhook_method}</Badge>);
  }
  if (step.timeout_minutes) {
    badges.push(<Badge key="sla" icon={Timer}>SLA {step.timeout_minutes}{isAr ? 'د' : 'm'}</Badge>);
  }

  return (
    <div
      className={cn(
        'relative w-[200px] select-none rounded-lg border-2 shadow-sm transition-shadow',
        visual.bg,
        selected && 'ring-2 ring-primary ring-offset-2 shadow-md',
        hasError && !selected && 'ring-2 ring-destructive/70',
        hasWarning && !selected && 'ring-2 ring-status-warning/70',
        stepStatus === 'running' && 'ring-2 ring-info-500 animate-pulse',
        stepStatus === 'completed' && 'border-primary',
        stepStatus === 'failed' && 'border-error-500',
        stepStatus === 'pending' && 'opacity-50',
      )}
      aria-label={localLabels.aria.workflowStep(step.name)}
    >
      {/* Target handle (incoming) — top. `end` still accepts incoming edges. */}
      <Handle
        type="target"
        position={Position.Top}
        isConnectable={!readOnly}
        className="!h-3 !w-3 !border-2 !border-primary/30 !bg-card"
      />

      {/* Header */}
      <div className="flex items-center gap-2 border-b border-inherit px-3 py-2">
        <Icon className={cn('h-4 w-4 shrink-0', visual.color)} />
        <span className="truncate text-sm font-medium">{step.name}</span>
        {hasError && <AlertCircle className="ms-auto h-3.5 w-3.5 shrink-0 text-destructive" />}
        {hasWarning && <AlertTriangle className="ms-auto h-3.5 w-3.5 shrink-0 text-status-warning" />}
      </div>

      {/* Body */}
      <div className="space-y-1 px-3 py-1.5 text-xs text-muted-foreground">
        <div>{formatStepTypeLabel(step.type, locale)}</div>
        {badges.length > 0 && <div className="flex flex-wrap gap-1">{badges}</div>}
      </div>

      {/* Source handle (outgoing) — bottom. `end` is terminal: no source. */}
      {step.type !== 'end' && (
        <Handle
          type="source"
          position={Position.Bottom}
          isConnectable={!readOnly}
          className="!h-3 !w-3 !border-2 !border-primary/30 !bg-card"
        />
      )}
    </div>
  );
}

export const RfStepNode = React.memo(RfStepNodeImpl);

/** Designer step types — used to register the node component under each type. */
export const STEP_TYPE_KEYS = Object.keys(STEP_VISUAL) as WorkflowStepType[];
