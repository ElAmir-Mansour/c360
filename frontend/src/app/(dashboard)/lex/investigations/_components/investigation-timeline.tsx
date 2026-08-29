'use client';

import { useMemo } from 'react';
import {
  Activity,
  ClipboardCheck,
  FileText,
  Files,
  History,
  Info,
  MessageSquare,
  RefreshCw,
  Users,
} from 'lucide-react';
import { EmptyState } from '@/components/common/empty-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { SectionCard } from '@/components/suites/section-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatDateTime } from '@/lib/format';
import type {
  Investigation,
  InvestigationApprovalTask,
  InvestigationAuditEntry,
} from '@/lib/lex/investigations';
import { useApprovalTaskLabel } from '../../service-desk/_components/lex-enums-i18n';
import {
  formatInvestigationToken,
  type InvestigationLabels,
  useInvestigationLabels,
} from './labels';

interface InvestigationTimelineProps {
  investigation: Investigation;
  auditEntries: InvestigationAuditEntry[];
  approvalTasks: InvestigationApprovalTask[];
  auditLoading: boolean;
  approvalLoading: boolean;
  auditError: boolean;
  approvalError: boolean;
  onRetryAudit: () => void;
  onRetryApproval: () => void;
}

type TimelineKind =
  | 'metadata'
  | 'party'
  | 'statement'
  | 'evidence'
  | 'finding'
  | 'recommendation'
  | 'approval'
  | 'audit';

interface TimelineEntry {
  id: string;
  kind: TimelineKind;
  date: string;
  title: string;
  description?: string;
  badge?: string;
}

export function InvestigationTimeline({
  investigation,
  auditEntries,
  approvalTasks,
  auditLoading,
  approvalLoading,
  auditError,
  approvalError,
  onRetryAudit,
  onRetryApproval,
}: InvestigationTimelineProps) {
  const labels = useInvestigationLabels();
  const resolveTaskLabel = useApprovalTaskLabel();
  const entries = useMemo(
    () =>
      buildTimelineEntries({
        investigation,
        auditEntries,
        approvalTasks,
        labels,
        resolveTaskLabel,
      }),
    [approvalTasks, auditEntries, investigation, labels, resolveTaskLabel],
  );
  const loading = auditLoading || approvalLoading;
  const hasError = auditError || approvalError;

  return (
    <div id="investigation-timeline" className="scroll-mt-24">
      <SectionCard
        title={labels.timeline.title}
        description={labels.timeline.description}
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            {loading ? <Badge variant="outline">{labels.timeline.loading}</Badge> : null}
            {auditError ? (
              <Button size="sm" variant="outline" onClick={onRetryAudit}>
                <RefreshCw className="me-1.5 h-3.5 w-3.5" />
                {labels.timeline.retryAudit}
              </Button>
            ) : null}
            {approvalError ? (
              <Button size="sm" variant="outline" onClick={onRetryApproval}>
                <RefreshCw className="me-1.5 h-3.5 w-3.5" />
                {labels.timeline.retryApprovals}
              </Button>
            ) : null}
          </div>
        }
      >
        <div className="space-y-4">
          {hasError ? (
            <div className="rounded-md border border-warning-100 bg-warning-50 px-3 py-2 text-sm text-warning-700 dark:text-warning-300">
              {labels.timeline.partialError}
            </div>
          ) : null}

          {loading && entries.length === 0 ? (
            <LoadingSkeleton variant="list-item" count={4} />
          ) : null}

          {entries.length === 0 && !loading ? (
            <EmptyState
              icon={Activity}
              title={labels.timeline.emptyTitle}
              description={labels.timeline.emptyDescription}
            />
          ) : (
            <ol className="relative space-y-4 border-s ps-5">
              {entries.map((entry) => (
                <li key={entry.id} className="relative">
                  <span className="absolute -start-[1.45rem] top-1 flex h-5 w-5 items-center justify-center rounded-full border bg-card text-primary">
                    <TimelineIcon kind={entry.kind} />
                  </span>
                  <div className="rounded-lg border bg-card px-4 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium">{entry.title}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {formatDateTime(entry.date)}
                        </p>
                      </div>
                      {entry.badge ? <Badge variant="outline">{entry.badge}</Badge> : null}
                    </div>
                    {entry.description ? (
                      <p className="mt-2 whitespace-pre-line text-sm text-muted-foreground">
                        {entry.description}
                      </p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </SectionCard>
    </div>
  );
}

function TimelineIcon({ kind }: { kind: TimelineKind }) {
  if (kind === 'party') return <Users className="h-3 w-3" />;
  if (kind === 'statement') return <MessageSquare className="h-3 w-3" />;
  if (kind === 'evidence') return <Files className="h-3 w-3" />;
  if (kind === 'finding') return <FileText className="h-3 w-3" />;
  if (kind === 'recommendation') return <FileText className="h-3 w-3" />;
  if (kind === 'approval') return <ClipboardCheck className="h-3 w-3" />;
  if (kind === 'audit') return <History className="h-3 w-3" />;
  return <Info className="h-3 w-3" />;
}

function buildTimelineEntries({
  investigation,
  auditEntries,
  approvalTasks,
  labels,
  resolveTaskLabel,
}: {
  investigation: Investigation;
  auditEntries: InvestigationAuditEntry[];
  approvalTasks: InvestigationApprovalTask[];
  labels: ReturnType<typeof useInvestigationLabels>;
  resolveTaskLabel: (name: string) => string;
}): TimelineEntry[] {
  const tl = labels.timeline;
  const entries: TimelineEntry[] = [
    {
      id: `investigation-created:${investigation.id}`,
      kind: 'metadata',
      date: investigation.created_at,
      title: tl.registeredTitle,
      description: [
        investigation.investigation_number,
        investigation.lead_investigator
          ? `${labels.detail.metadata.lead}: ${investigation.lead_investigator}`
          : undefined,
      ]
        .filter(Boolean)
        .join('\n'),
      badge:
        labels.filters.statusOptions[investigation.status] ??
        formatInvestigationToken(investigation.status),
    },
  ];

  if (investigation.updated_at && investigation.updated_at !== investigation.created_at) {
    entries.push({
      id: `investigation-updated:${investigation.id}`,
      kind: 'metadata',
      date: investigation.updated_at,
      title: tl.updatedTitle,
      description: investigation.department || undefined,
      badge:
        labels.filters.priorityOptions[investigation.priority] ??
        formatInvestigationToken(investigation.priority),
    });
  }

  for (const party of investigation.parties ?? []) {
    entries.push({
      id: `party:${party.id}`,
      kind: 'party',
      date: party.created_at,
      title: tl.partyAdded(party.name),
      description: [party.contact, party.identifier].filter(Boolean).join('\n'),
      badge: labels.filters.roleOptions[party.role] ?? formatInvestigationToken(party.role),
    });
  }

  for (const statement of investigation.statements ?? []) {
    entries.push({
      id: `statement:${statement.id}`,
      kind: 'statement',
      date: statement.taken_at || statement.created_at,
      title: tl.statementRecorded(statement.deponent_name),
      description: [
        labels.detail.takenBy(statement.taken_by),
        summarizeText(statement.statement),
      ]
        .filter(Boolean)
        .join('\n'),
    });
  }

  for (const item of investigation.evidence ?? []) {
    entries.push({
      id: `evidence:${item.id}`,
      kind: 'evidence',
      date: item.collected_at || item.created_at,
      title: tl.evidenceCatalogued(item.title),
      description: [
        item.evidence_type ? tl.typePrefix(item.evidence_type) : undefined,
        item.collected_by ? labels.detail.collectedBy(item.collected_by) : undefined,
        summarizeText(item.description),
      ]
        .filter(Boolean)
        .join('\n'),
    });
  }

  if (isFilled(investigation.findings)) {
    entries.push({
      id: `findings:${investigation.id}`,
      kind: 'finding',
      date:
        findAuditDate(auditEntries, ['result', 'finding', 'record_results']) ??
        investigation.updated_at,
      title: tl.findingsRecorded,
      description: summarizeText(investigation.findings),
      badge: investigation.ai_drafted ? labels.detail.aiBadge : undefined,
    });
  }

  if (isFilled(investigation.recommendations)) {
    entries.push({
      id: `recommendations:${investigation.id}`,
      kind: 'recommendation',
      date:
        findAuditDate(auditEntries, ['recommendation', 'record_recommendations']) ??
        investigation.updated_at,
      title: tl.recommendationsRecorded,
      description: summarizeText(investigation.recommendations),
    });
  }

  for (const task of approvalTasks) {
    const rawTaskName = task.title ?? task.name;
    const taskTitle = rawTaskName ? resolveTaskLabel(rawTaskName) : String(task.id);
    const taskStatus = task.status ? formatInvestigationToken(String(task.status)) : undefined;

    if (task.created_at) {
      entries.push({
        id: `approval-created:${task.id}`,
        kind: 'approval',
        date: task.created_at,
        title: tl.approvalOpened(taskTitle),
        description: formatApprovalTaskDescription(task, tl),
        badge: taskStatus,
      });
    }

    if (task.due_at) {
      entries.push({
        id: `approval-due:${task.id}`,
        kind: 'approval',
        date: task.due_at,
        title: tl.approvalDue(taskTitle),
        description: formatApprovalTaskDescription(task, tl),
        badge: taskStatus,
      });
    }
  }

  for (const entry of auditEntries) {
    entries.push({
      id: `audit:${entry.id}`,
      kind: 'audit',
      date: entry.created_at,
      title: tl.auditPrefix(formatInvestigationToken(entry.action)),
      description: formatAuditDescription(entry, tl),
    });
  }

  return entries
    .filter((entry) => Boolean(entry.date))
    .sort((a, b) => timestamp(a.date) - timestamp(b.date) || a.id.localeCompare(b.id));
}

function formatApprovalTaskDescription(
  task: InvestigationApprovalTask,
  tl: InvestigationLabels['timeline'],
): string | undefined {
  const description = readText(task, 'description');
  const role = task.assignee_role ? tl.rolePrefix(task.assignee_role) : undefined;
  const assignee = task.assignee_user_id ? tl.assigneePrefix(task.assignee_user_id) : undefined;
  return [description, role, assignee].filter(Boolean).join('\n') || undefined;
}

function formatAuditDescription(
  entry: InvestigationAuditEntry,
  tl: InvestigationLabels['timeline'],
): string | undefined {
  const statusChange =
    entry.from_status || entry.to_status
      ? `${formatInvestigationToken(entry.from_status ?? 'none')} -> ${formatInvestigationToken(
          entry.to_status ?? 'none',
        )}`
      : undefined;
  const detail = extractDetailText(entry.detail);
  const actor = entry.actor_user_id ? tl.actorPrefix(entry.actor_user_id) : undefined;
  return [statusChange, detail, actor].filter(Boolean).join('\n') || undefined;
}

function extractDetailText(detail?: Record<string, unknown> | null): string | undefined {
  if (!detail) return undefined;
  for (const key of ['notes', 'note', 'reason', 'message', 'summary', 'description']) {
    const value = detail[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function findAuditDate(
  auditEntries: InvestigationAuditEntry[],
  candidates: string[],
): string | undefined {
  return auditEntries
    .filter((entry) => {
      const action = entry.action.toLowerCase();
      return candidates.some((candidate) => action.includes(candidate));
    })
    .sort((a, b) => timestamp(b.created_at) - timestamp(a.created_at))[0]?.created_at;
}

function summarizeText(value?: string | null): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (trimmed.length <= 360) return trimmed;
  return `${trimmed.slice(0, 357)}...`;
}

function readText(source: InvestigationApprovalTask, key: string): string | undefined {
  const value = source[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isFilled(value?: string | null): boolean {
  return Boolean(value?.trim());
}

function timestamp(value: string): number {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}
