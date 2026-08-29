'use client';

/**
 * #8 Unified activity timeline — merges every event source for a request into a
 * single reverse-chronological feed:
 *   - priority changes      (listPriorityHistory)
 *   - review rounds         (getExecution → review_rounds)
 *   - delivery confirmations(getExecution → delivery_confirmations)
 *   - approval tasks        (listApprovalTasks)
 *   - spine audit entries   (listRequestAudit)
 *
 * The audit feed is the authoritative status-transition log. It is queried with
 * `retry:false` and treated as auxiliary so a transient read error does not block
 * the other sources from composing a feed.
 * Entries are de-duped by a stable composite key and sorted newest-first.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowRightLeft,
  CheckCircle2,
  FileClock,
  RotateCcw,
  ShieldCheck,
  Truck,
  type LucideIcon,
} from 'lucide-react';
import { Timeline } from '@/components/shared/timeline';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { EmptyState } from '@/components/common/empty-state';
import { SectionCard } from '@/components/suites/section-card';
import { formatDateTime } from '@/lib/format';
import { useLocale } from '@/components/providers/locale-provider';
import {
  lexRequestsApi,
  requestCanHaveApprovalTasks,
  requestCanHaveExecutionState,
  type RequestStatus,
} from '@/lib/lex/requests';
import { useServiceDeskLabels } from './labels';
import { useDetailExtraLabels } from './detail-extra-labels';
import { resolveApprovalTaskLabel, resolveApprovalTaskStatusLabel } from './lex-enums-i18n';

interface Props {
  requestId: string;
  status: RequestStatus;
  workflowInstanceId?: string | null;
}

type TimelineVariant = 'default' | 'success' | 'warning' | 'error';

interface FeedEntry {
  id: string;
  icon: LucideIcon;
  title: string;
  actor?: string | null;
  /** ISO timestamp used for sorting. */
  at: string;
  variant: TimelineVariant;
}

export function RequestActivityTimeline({ requestId, status, workflowInstanceId }: Props) {
  const { locale } = useLocale();
  const baseLabels = useServiceDeskLabels();
  const labels = useDetailExtraLabels();
  const t = labels.activity;
  const executionExpected = requestCanHaveExecutionState(status);
  const hasWorkflow = requestCanHaveApprovalTasks(workflowInstanceId);

  const priorityQuery = useQuery({
    queryKey: ['lex-request-priority-history', requestId],
    queryFn: () => lexRequestsApi.listPriorityHistory(requestId),
    enabled: Boolean(requestId),
    retry: false,
  });

  const executionQuery = useQuery({
    queryKey: ['lex-request-execution', requestId],
    queryFn: () => lexRequestsApi.getExecution(requestId),
    enabled: Boolean(requestId) && executionExpected,
    retry: false,
  });

  const approvalQuery = useQuery({
    queryKey: ['lex-request-approval-tasks', requestId],
    queryFn: () => lexRequestsApi.listApprovalTasks(requestId),
    enabled: Boolean(requestId) && hasWorkflow,
    retry: false,
  });

  // Authoritative spine audit log is auxiliary to the request detail page. Any
  // transient read error must not break the feed: `retry:false` + tolerate below.
  const auditQuery = useQuery({
    queryKey: ['lex-request-audit', requestId],
    queryFn: () => lexRequestsApi.listRequestAudit(requestId),
    enabled: Boolean(requestId),
    retry: false,
  });

  const isLoading =
    priorityQuery.isLoading ||
    (executionExpected && executionQuery.isLoading) ||
    (hasWorkflow && approvalQuery.isLoading) ||
    auditQuery.isLoading;

  const entries = useMemo<FeedEntry[]>(() => {
    const out: FeedEntry[] = [];
    const seen = new Set<string>();
    const push = (entry: FeedEntry) => {
      if (seen.has(entry.id)) return;
      seen.add(entry.id);
      out.push(entry);
    };

    const statusLabel = (token?: string | null): string =>
      token ? baseLabels.statusOptions[token] ?? token.replace(/_/g, ' ') : '—';

    // --- Priority changes ---
    for (const change of priorityQuery.data ?? []) {
      push({
        id: `priority:${change.id}`,
        icon: AlertTriangle,
        title: t.priorityChanged(
          baseLabels.priorityOptions[change.from_priority] ?? change.from_priority,
          baseLabels.priorityOptions[change.to_priority] ?? change.to_priority,
        ),
        actor: change.changed_by,
        at: change.changed_at,
        variant: change.to_priority === 'urgent' ? 'warning' : 'default',
      });
    }

    // --- Review rounds (opened + closed are distinct events) ---
    for (const round of executionQuery.data?.review_rounds ?? []) {
      push({
        id: `round-open:${round.id}`,
        icon: RotateCcw,
        title: t.reviewRoundOpened(round.round_no),
        actor: round.opened_by,
        at: round.opened_at,
        variant: 'warning',
      });
      if (round.closed_at) {
        push({
          id: `round-close:${round.id}`,
          icon: round.outcome === 'accepted' ? CheckCircle2 : RotateCcw,
          title: t.reviewRoundClosed(
            round.round_no,
            round.outcome
              ? baseLabels.execution.roundOutcome[round.outcome] ?? round.outcome
              : '—',
          ),
          actor: round.closed_by,
          at: round.closed_at,
          variant: round.outcome === 'accepted' ? 'success' : 'warning',
        });
      }
    }

    // --- Delivery confirmations (requested + responded) ---
    for (const dc of executionQuery.data?.delivery_confirmations ?? []) {
      push({
        id: `delivery-req:${dc.id}`,
        icon: Truck,
        title: t.deliveryRequested,
        actor: dc.requested_by,
        at: dc.requested_at,
        variant: 'default',
      });
      if (dc.responded_at) {
        const confirmed = dc.status === 'confirmed';
        push({
          id: `delivery-resp:${dc.id}`,
          icon: confirmed ? CheckCircle2 : AlertTriangle,
          title: t.deliveryResponded(
            baseLabels.execution.deliveryStatus[dc.status] ?? dc.status,
          ),
          actor: dc.responded_by,
          at: dc.responded_at,
          variant: confirmed ? 'success' : 'error',
        });
      }
    }

    // --- Approval tasks (use completion time when present, else creation) ---
    for (const task of approvalQuery.data ?? []) {
      const done = Boolean(task.completed_at);
      push({
        id: `approval:${task.id}`,
        icon: ShieldCheck,
        title: t.approvalTask(
          resolveApprovalTaskLabel(task.name || task.step_id, locale),
          resolveApprovalTaskStatusLabel(task.status, locale),
        ),
        actor: task.assignee_id ?? task.assignee_role,
        at: task.completed_at ?? task.created_at,
        variant: done ? 'success' : 'default',
      });
    }

    // --- Spine audit entries (status transitions etc.) ---
    for (const audit of auditQuery.data ?? []) {
      const isTransition = Boolean(audit.from_status || audit.to_status);
      push({
        id: `audit:${audit.id}`,
        icon: isTransition ? ArrowRightLeft : FileClock,
        title: isTransition
          ? t.statusTransition(statusLabel(audit.from_status), statusLabel(audit.to_status))
          : t.auditAction(audit.reason || audit.action.replace(/_/g, ' ')),
        actor: audit.actor_name ?? audit.actor_user_id,
        at: audit.created_at,
        variant: audit.to_status === 'cancelled' || audit.to_status === 'returned'
          ? 'warning'
          : 'default',
      });
    }

    out.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    return out;
  }, [priorityQuery.data, executionQuery.data, approvalQuery.data, auditQuery.data, baseLabels, locale, t]);

  const timelineItems = entries.map((e) => ({
    id: e.id,
    icon: e.icon,
    title: e.title,
    description: e.actor ? t.actorPrefix(e.actor) : undefined,
    timestamp: formatDateTime(e.at),
    variant: e.variant,
  }));

  return (
    <SectionCard title={t.title} description={t.description}>
      {isLoading ? (
        <LoadingSkeleton variant="list-item" count={4} />
      ) : entries.length === 0 ? (
        <EmptyState icon={FileClock} title={t.empty} description="" />
      ) : (
        <div dir={locale === 'ar' ? 'rtl' : 'ltr'}>
          <Timeline items={timelineItems} />
        </div>
      )}
    </SectionCard>
  );
}
