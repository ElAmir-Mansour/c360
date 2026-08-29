'use client';

import { statisticHint } from '@/lib/lex/statistic-hint';

import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  AlertTriangle,
  BriefcaseBusiness,
  CheckCircle2,
  CircleDashed,
  ClipboardCheck,
  FileText,
  Files,
  ListChecks,
  MessageSquare,
  RefreshCw,
  ShieldAlert,
  UserRound,
  Users,
} from 'lucide-react';
import { RelativeTime } from '@/components/shared/relative-time';
import { StatusBadge } from '@/components/shared/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatDateTime } from '@/lib/format';
import type { Investigation, InvestigationApprovalTask } from '@/lib/lex/investigations';
import {
  formatInvestigationToken,
  type InvestigationLabels,
  useInvestigationLabels,
} from './labels';

interface InvestigationCommandHeaderProps {
  investigation: Investigation;
  approvalTasks: InvestigationApprovalTask[];
  canWrite: boolean;
  canApprove: boolean;
  canStartApproval: boolean;
  onAddParty: () => void;
  onRecordStatement: () => void;
  onAddEvidence: () => void;
  onRecordResults: () => void;
  onRecordRecommendations: () => void;
  onStartApproval: () => void;
  onChangeStatus: () => void;
  onReviewApproval: () => void;
  onOpenTimeline: () => void;
}

interface ReadinessCheck {
  id: string;
  label: string;
  helper: string;
  complete: boolean;
  required?: boolean;
}

interface PrimaryAction {
  label: string;
  helper: string;
  icon: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  variant?: 'default' | 'outline' | 'secondary' | 'destructive';
}

export function InvestigationCommandHeader({
  investigation,
  approvalTasks,
  canWrite,
  canApprove,
  canStartApproval,
  onAddParty,
  onRecordStatement,
  onAddEvidence,
  onRecordResults,
  onRecordRecommendations,
  onStartApproval,
  onChangeStatus,
  onReviewApproval,
  onOpenTimeline,
}: InvestigationCommandHeaderProps) {
  const labels = useInvestigationLabels();
  const detail = labels.detail;
  const ch = labels.commandHeader;
  const parties = investigation.parties ?? [];
  const statements = investigation.statements ?? [];
  const evidence = investigation.evidence ?? [];
  const statusLabel =
    labels.filters.statusOptions[investigation.status] ??
    formatInvestigationToken(investigation.status);
  const priorityLabel =
    labels.filters.priorityOptions[investigation.priority] ??
    formatInvestigationToken(investigation.priority);
  const readinessChecks = buildReadinessChecks(investigation, labels);
  const completedChecks = readinessChecks.filter((check) => check.complete).length;
  const requiredReady = readinessChecks
    .filter((check) => check.required)
    .every((check) => check.complete);
  const approvalState = getApprovalState(investigation, approvalTasks, canStartApproval, labels);
  const action = getPrimaryAction({
    investigation,
    canWrite,
    canApprove,
    canStartApproval,
    approvalTasks,
    labels,
    onAddParty,
    onRecordStatement,
    onAddEvidence,
    onRecordResults,
    onRecordRecommendations,
    onStartApproval,
    onChangeStatus,
    onReviewApproval,
    onOpenTimeline,
  });

  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{ch.badge}</Badge>
            <Badge variant={priorityVariant(investigation.priority)}>{priorityLabel}</Badge>
            <StatusBadge status={statusLabel} size="sm" />
            <Badge variant={approvalState.variant}>{approvalState.label}</Badge>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <CommandMetric
              label={detail.metricStatus}
              value={statusLabel}
              icon={<RefreshCw className="h-4 w-4" />}
              onAction={canWrite ? onChangeStatus : onOpenTimeline}
            />
            <CommandMetric
              label={detail.metricPriority}
              value={priorityLabel}
              icon={<ShieldAlert className="h-4 w-4" />}
              onAction={onOpenTimeline}
            />
            <CommandMetric
              label={detail.metadata.lead}
              value={investigation.lead_investigator || detail.notSet}
              icon={<UserRound className="h-4 w-4" />}
              onAction={onOpenTimeline}
            />
            <CommandMetric
              label={detail.metadata.linkedCase}
              value={investigation.case_id || detail.none}
              icon={<BriefcaseBusiness className="h-4 w-4" />}
              href={investigation.case_id ? `/lex/cases/${investigation.case_id}` : undefined}
              onAction={investigation.case_id ? undefined : onOpenTimeline}
            />
            <CommandMetric
              label={ch.approvalLabel}
              value={approvalState.metric}
              icon={<ClipboardCheck className="h-4 w-4" />}
              onAction={canApprove ? onReviewApproval : canStartApproval ? onStartApproval : onOpenTimeline}
            />
            <CommandMetric
              label={ch.readinessLabel}
              value={ch.checksValue(completedChecks, readinessChecks.length)}
              icon={<ListChecks className="h-4 w-4" />}
              onAction={action.onClick}
            />
          </div>

          <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
            {readinessChecks.map((check) => (
              <ReadinessPill key={check.id} check={check} />
            ))}
          </div>
        </div>

        <div className="shrink-0 space-y-2 xl:w-64">
          <Button
            className="w-full"
            variant={action.variant}
            onClick={action.onClick}
            disabled={action.disabled}
          >
            {action.icon}
            {action.label}
          </Button>
          <p className="text-xs leading-5 text-muted-foreground">{action.helper}</p>
          <p className="text-xs text-muted-foreground">
            {ch.updatedPrefix} <RelativeTime date={investigation.updated_at} />
          </p>
          {!requiredReady ? (
            <p className="rounded-md border border-warning-100 bg-warning-50 px-3 py-2 text-xs text-warning-700 dark:text-warning-300">
              {ch.requiredWarning}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function CommandMetric({
  label,
  value,
  icon,
  href,
  onAction,
}: {
  label: string;
  value: ReactNode;
  icon: ReactNode;
  href?: string;
  onAction?: () => void;
}) {
  const content = (
    <>
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <span className="text-primary">{icon}</span>
        <span>{label}</span>
      </div>
      <div className="mt-1 truncate text-sm font-semibold text-foreground">{value}</div>
    </>
  );

  const className =
    'min-w-0 rounded-md border bg-muted/20 px-3 py-2 text-start transition hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

  return href ? (
    <Link href={href} className={className} title={statisticHint(label)}>
      {content}
    </Link>
  ) : (
    <Button
      type="button"
      variant="ghost"
      onClick={onAction}
      className={`${className} h-auto items-stretch justify-start font-normal`}
      title={statisticHint(label)}
    >
      {content}
    </Button>
  );
}

function ReadinessPill({ check }: { check: ReadinessCheck }) {
  const icon = check.complete ? (
    <CheckCircle2 className="h-4 w-4 text-primary" />
  ) : check.required ? (
    <AlertTriangle className="h-4 w-4 text-warning-700 dark:text-warning-300" />
  ) : (
    <CircleDashed className="h-4 w-4 text-muted-foreground" />
  );

  return (
    <div className="flex min-w-0 items-start gap-2 rounded-md border bg-muted/10 px-3 py-2">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span className="min-w-0">
        <span className="block text-sm font-medium">{check.label}</span>
        <span className="block text-xs text-muted-foreground">{check.helper}</span>
      </span>
    </div>
  );
}

function buildReadinessChecks(
  investigation: Investigation,
  labels: InvestigationLabels,
): ReadinessCheck[] {
  const r = labels.commandHeader.readiness;
  const parties = investigation.parties ?? [];
  const statements = investigation.statements ?? [];
  const evidence = investigation.evidence ?? [];
  const approvalEligible =
    investigation.status === 'results_recorded' ||
    investigation.status === 'pending_approval' ||
    investigation.status === 'approved' ||
    investigation.status === 'closed';

  return [
    {
      id: 'status',
      label: r.status,
      helper: approvalEligible ? r.statusDoneHelper : r.statusTodoHelper,
      complete: approvalEligible,
      required: true,
    },
    {
      id: 'findings',
      label: r.findings,
      helper: isFilled(investigation.findings) ? r.findingsDoneHelper : r.findingsTodoHelper,
      complete: isFilled(investigation.findings),
      required: true,
    },
    {
      id: 'recommendations',
      label: r.recommendations,
      helper: isFilled(investigation.recommendations)
        ? r.recommendationsDoneHelper
        : r.recommendationsTodoHelper,
      complete: isFilled(investigation.recommendations),
    },
    {
      id: 'parties',
      label: r.parties,
      helper: parties.length > 0 ? r.partiesDoneHelper(parties.length) : r.partiesTodoHelper,
      complete: parties.length > 0,
    },
    {
      id: 'statements',
      label: r.statements,
      helper:
        statements.length > 0 ? r.statementsDoneHelper(statements.length) : r.statementsTodoHelper,
      complete: statements.length > 0,
    },
    {
      id: 'evidence',
      label: r.evidence,
      helper: evidence.length > 0 ? r.evidenceDoneHelper(evidence.length) : r.evidenceTodoHelper,
      complete: evidence.length > 0,
    },
  ];
}

function getPrimaryAction({
  investigation,
  canWrite,
  canApprove,
  canStartApproval,
  approvalTasks,
  labels,
  onAddParty,
  onRecordStatement,
  onAddEvidence,
  onRecordResults,
  onRecordRecommendations,
  onStartApproval,
  onChangeStatus,
  onReviewApproval,
  onOpenTimeline,
}: {
  investigation: Investigation;
  canWrite: boolean;
  canApprove: boolean;
  canStartApproval: boolean;
  approvalTasks: InvestigationApprovalTask[];
  labels: InvestigationLabels;
  onAddParty: () => void;
  onRecordStatement: () => void;
  onAddEvidence: () => void;
  onRecordResults: () => void;
  onRecordRecommendations: () => void;
  onStartApproval: () => void;
  onChangeStatus: () => void;
  onReviewApproval: () => void;
  onOpenTimeline: () => void;
}): PrimaryAction {
  const a = labels.commandHeader.actions;
  const parties = investigation.parties ?? [];
  const statements = investigation.statements ?? [];
  const evidence = investigation.evidence ?? [];
  const hasActionableApproval = approvalTasks.some(isTaskActionable);

  if (investigation.status === 'pending_approval') {
    return {
      label: canApprove && hasActionableApproval ? a.decideApproval : a.reviewApproval,
      helper: hasActionableApproval ? a.decideHelper : a.reviewHelper,
      icon: <ClipboardCheck className="me-1.5 h-4 w-4" />,
      onClick: onReviewApproval,
    };
  }

  if (canWrite && investigation.status === 'rejected') {
    return {
      label: a.resume,
      helper: a.resumeHelper,
      icon: <RefreshCw className="me-1.5 h-4 w-4" />,
      onClick: onChangeStatus,
      variant: 'outline',
    };
  }

  if (canWrite && parties.length === 0) {
    return {
      label: a.addParty,
      helper: a.addPartyHelper,
      icon: <Users className="me-1.5 h-4 w-4" />,
      onClick: onAddParty,
      variant: 'outline',
    };
  }

  if (canWrite && statements.length === 0) {
    return {
      label: a.recordStatement,
      helper: a.recordStatementHelper,
      icon: <MessageSquare className="me-1.5 h-4 w-4" />,
      onClick: onRecordStatement,
      variant: 'outline',
    };
  }

  if (canWrite && evidence.length === 0) {
    return {
      label: a.addEvidence,
      helper: a.addEvidenceHelper,
      icon: <Files className="me-1.5 h-4 w-4" />,
      onClick: onAddEvidence,
      variant: 'outline',
    };
  }

  if (canWrite && !isFilled(investigation.findings)) {
    return {
      label: a.recordFindings,
      helper: a.recordFindingsHelper,
      icon: <FileText className="me-1.5 h-4 w-4" />,
      onClick: onRecordResults,
      variant: 'outline',
    };
  }

  if (canWrite && !isFilled(investigation.recommendations)) {
    return {
      label: a.recordRecommendations,
      helper: a.recordRecommendationsHelper,
      icon: <FileText className="me-1.5 h-4 w-4" />,
      onClick: onRecordRecommendations,
      variant: 'outline',
    };
  }

  if (canWrite && canStartApproval) {
    return {
      label: a.startApproval,
      helper: a.startApprovalHelper,
      icon: <ClipboardCheck className="me-1.5 h-4 w-4" />,
      onClick: onStartApproval,
    };
  }

  if (canWrite && investigation.status !== 'closed' && investigation.status !== 'cancelled') {
    return {
      label: a.changeStatus,
      helper: a.changeStatusHelper,
      icon: <RefreshCw className="me-1.5 h-4 w-4" />,
      onClick: onChangeStatus,
      variant: 'outline',
    };
  }

  return {
    label: a.viewTimeline,
    helper: a.viewTimelineHelper(formatDateTime(investigation.updated_at)),
    icon: <ListChecks className="me-1.5 h-4 w-4" />,
    onClick: onOpenTimeline,
    variant: 'outline',
  };
}

function getApprovalState(
  investigation: Investigation,
  approvalTasks: InvestigationApprovalTask[],
  canStartApproval: boolean,
  labels: InvestigationLabels,
) {
  const s = labels.commandHeader.state;
  if (investigation.status === 'approved' || investigation.status === 'closed') {
    return { label: s.approved, metric: s.approvedMetric, variant: 'success' as const };
  }

  if (investigation.status === 'rejected') {
    return { label: s.rejected, metric: s.rejectedMetric, variant: 'destructive' as const };
  }

  if (investigation.status === 'pending_approval') {
    const pendingCount = approvalTasks.filter(isTaskActionable).length;
    const metric = pendingCount > 0 ? s.pendingMetric(pendingCount) : s.pendingApprovalMetric;
    return { label: s.pendingApproval, metric, variant: 'warning' as const };
  }

  if (canStartApproval) {
    return { label: s.readyToRoute, metric: s.readyMetric, variant: 'success' as const };
  }

  return { label: s.notRouted, metric: s.notStartedMetric, variant: 'secondary' as const };
}

function isTaskActionable(task: InvestigationApprovalTask): boolean {
  const status = String(task.status ?? '').toLowerCase();
  if (task.completed_at) return false;
  if (!status) return true;
  return ![
    'approved',
    'rejected',
    'complete',
    'completed',
    'done',
    'cancelled',
    'canceled',
    'closed',
  ].includes(status);
}

function priorityVariant(priority: string): 'destructive' | 'warning' | 'secondary' {
  if (priority === 'critical') return 'destructive';
  if (priority === 'high') return 'warning';
  return 'secondary';
}

function isFilled(value?: string | null): boolean {
  return Boolean(value?.trim());
}
