'use client';

import React, { useCallback, useRef } from 'react';
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
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLocaleOrDefault, useT } from '@/components/providers/locale-provider';
import {
  formatAssigneeStrategyLabel,
  formatStepTypeLabel,
} from '../../../definition-i18n';
import type { WorkflowStep, WorkflowStepType } from '@/types/models';

const stepTypeConfig: Record<
  WorkflowStepType,
  { icon: React.ElementType; color: string; bg: string }
> = {
  approval: { icon: CheckCircle2, color: 'text-blue-700', bg: 'bg-blue-50 border-blue-200' },
  approval_chain: { icon: UserCheck, color: 'text-success-700', bg: 'bg-success-50 border-success-100' },
  review: { icon: Eye, color: 'text-indigo-700', bg: 'bg-indigo-50 border-indigo-200' },
  task: { icon: ClipboardList, color: 'text-teal-700', bg: 'bg-teal-50 border-teal-200' },
  notification: { icon: Bell, color: 'text-purple-700', bg: 'bg-purple-50 border-purple-200' },
  condition: { icon: GitBranch, color: 'text-yellow-700', bg: 'bg-yellow-50 border-yellow-300' },
  parallel_gateway: { icon: GitMerge, color: 'text-warning-700', bg: 'bg-warning-50 border-warning-100' },
  join_gateway: { icon: GitMerge, color: 'text-warning-700', bg: 'bg-warning-50 border-warning-100' },
  delay: { icon: Timer, color: 'text-foreground', bg: 'bg-secondary border-primary/15' },
  webhook: { icon: Globe, color: 'text-cyan-700', bg: 'bg-cyan-50 border-cyan-200' },
  script: { icon: Code2, color: 'text-primary', bg: 'bg-primary/10 border-primary/30' },
  sub_workflow: { icon: Workflow, color: 'text-pink-700', bg: 'bg-pink-50 border-pink-200' },
  end: { icon: CircleDot, color: 'text-error-600', bg: 'bg-error-50 border-error-300' },
};

interface StepNodeProps {
  step: WorkflowStep;
  selected: boolean;
  readOnly: boolean;
  zoom: number;
  stepStatus?: string;
  onSelect: (stepId: string) => void;
  onDragStart: (stepId: string, e: React.MouseEvent) => void;
  onConnectStart: (stepId: string, e: React.MouseEvent) => void;
  onConnectEnd: (stepId: string) => void;
}

export const StepNode = React.memo(function StepNode({
  step,
  selected,
  readOnly,
  stepStatus,
  onSelect,
  onDragStart,
  onConnectStart,
  onConnectEnd,
}: StepNodeProps) {
  const t = useT('admin');
  const { locale } = useLocaleOrDefault();
  const config = stepTypeConfig[step.type] ?? stepTypeConfig.task;
  const Icon = config.icon;
  const nodeRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (readOnly) return;
      e.stopPropagation();
      onSelect(step.id);
      onDragStart(step.id, e);
    },
    [readOnly, step.id, onSelect, onDragStart],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onSelect(step.id);
      }
    },
    [step.id, onSelect],
  );

  // Non-human steps (start/end/delay/notification/webhook/script/sub_workflow)
  // legitimately have no assignee_strategy — read it safely so the canvas never
  // crashes rendering them. assigneeLabel is only surfaced for human steps.
  const strategyType = step.assignee_strategy?.type;
  const assigneeLabel = formatAssigneeStrategyLabel(strategyType, locale);

  const isHuman = ['approval', 'review', 'task'].includes(step.type);

  return (
    <div
      ref={nodeRef}
      className={cn(
        'absolute select-none rounded-lg border-2 shadow-sm transition-shadow w-[200px]',
        config.bg,
        selected && 'ring-2 ring-primary ring-offset-2 shadow-md',
        stepStatus === 'running' && 'ring-2 ring-info-500 animate-pulse',
        stepStatus === 'completed' && 'border-primary bg-primary/10',
        stepStatus === 'failed' && 'border-error-500 bg-error-50 dark:bg-error-700/15',
        stepStatus === 'pending' && 'opacity-50',
      )}
      style={{
        left: step.position.x,
        top: step.position.y,
      }}
      onMouseDown={handleMouseDown}
      tabIndex={0}
      role="button"
      aria-label={t('sn.stepAria', { name: step.name })}
      onKeyDown={handleKeyDown}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-inherit">
        <Icon className={cn('h-4 w-4 shrink-0', config.color)} />
        <span className="text-sm font-medium truncate">{step.name}</span>
      </div>

      {/* Body */}
      <div className="px-3 py-1.5 text-xs text-muted-foreground space-y-0.5">
        <div className="flex items-center justify-between">
          <span>{formatStepTypeLabel(step.type, locale)}</span>
          {step.timeout_minutes && (
            <span className="text-warning-600 dark:text-warning-300">
              {step.timeout_minutes}{locale === 'ar' ? 'د' : 'm'}
            </span>
          )}
        </div>
        {isHuman && assigneeLabel && (
          <div className="flex items-center gap-1">
            <UserCheck className="h-3 w-3" />
            <span>{assigneeLabel}</span>
          </div>
        )}
      </div>

      {/* Input port (top center) */}
      <div
        className="absolute -top-2 left-1/2 -translate-x-1/2 w-4 h-4 rounded-full bg-card border-2 border-primary/20 hover:border-primary cursor-pointer z-10"
        onMouseUp={(e) => {
          e.stopPropagation();
          onConnectEnd(step.id);
        }}
        aria-label={t('sn.inputPort')}
      />

      {/* Output port (bottom center) */}
      {step.type !== 'end' && (
        <div
          className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-4 h-4 rounded-full bg-card border-2 border-primary/20 hover:border-primary cursor-crosshair z-10"
          onMouseDown={(e) => {
            e.stopPropagation();
            onConnectStart(step.id, e);
          }}
          aria-label={t('sn.outputPort')}
        />
      )}
    </div>
  );
});
