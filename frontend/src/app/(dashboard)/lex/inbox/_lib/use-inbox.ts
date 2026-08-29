/**
 * Cross-domain "Awaiting me" aggregation hook (feature #16).
 *
 * Fans out across every legal-suite source that can put a decision in front of
 * the signed-in user, normalizes each into a single {@link InboxItem} shape, and
 * returns them grouped by kind plus client-derived KPIs (pending / due-today /
 * overdue). Each source is an INDEPENDENT, fail-soft `useQuery` (`retry:false`)
 * so a slow or 403/404 source never blocks the rest — mirroring the established
 * `use-lex-command-center` fan-out pattern. No new endpoints are invented:
 *
 *   • settlement  → settlementsApi.list({status: pending_approval})
 *                   (inline decide() via the settlement's workflow instance)
 *   • case        → Lex-owned case-intake task queue. It reads the workflow task
 *                   rows stored in lex_db with actor/role/claim visibility.
 *                   Decisions use the case-specific endpoint so the case FSM
 *                   advances together with the workflow task.
 *   • contract /  → enterpriseApi.lex.listMyWorkflows() — the actor-scoped
 *     governance     workflow summary; open human tasks this user can decide.
 *                   (inline decideWorkflowTask()). Clause/regulation governance
 *                   sign-offs run through the same engine, so they surface here
 *                   too; we split contract-bound vs. other tasks by kind.
 *   • request     → lexRequestsApi.listMyApprovalRequests()
 *                   (links to the entity; the per-request workflow/task id is
 *                   not on the list row, so no inline action).
 *
 * KPIs are computed client-side from the already-fetched items; we never call a
 * count endpoint just for the strip.
 */

'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { useAuth } from '@/hooks/use-auth';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { apiGet } from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { enterpriseApi } from '@/lib/enterprise/api';
import { settlementsApi, type Settlement } from '@/lib/lex/settlements';
import { lexRequestsApi, type LegalRequest } from '@/lib/lex/requests';
import type { PaginatedResponse } from '@/types/api';
import type { HumanTask } from '@/types/models';
import type { LexWorkflowSummary } from '@/types/suites';
import type { FetchParams } from '@/types/table';

/* ------------------------------------------------------------------------- *
 * Public model
 * ------------------------------------------------------------------------- */

/** The five decision families this queue aggregates. */
export type InboxKind = 'settlement' | 'case' | 'governance' | 'contract' | 'workflow' | 'request';

/** Stable group ordering (most decision-heavy / highest-stakes first). */
export const INBOX_KIND_ORDER: readonly InboxKind[] = [
  'settlement',
  'case',
  'contract',
  'governance',
  'workflow',
  'request',
] as const;

/**
 * One normalized decision row. `action` carries the inline approve/route hook
 * when the source exposes one; otherwise the row links to its entity via `href`.
 */
export interface InboxItem {
  id: string;
  kind: InboxKind;
  title: string;
  /** Display name of the requester / initiator (already resolved). */
  requestedBy: string;
  /** SLA / decision deadline, ISO string — drives <SlaCountdown>. */
  dueAt: string | null;
  /** Deep link to the entity (always present; the fallback affordance). */
  href: string;
  /** Status/priority token used for the row accent + severity tone. */
  accentValue: string;
  /** Inline decision context, when the source supports a quick decision. */
  action?: InboxItemAction;
}

/** Identifies how to execute an inline decision for an item. */
export type InboxItemAction =
  | {
      /** Settlement approval — decide via the settlement workflow endpoint. */
      type: 'settlement';
      settlementId: string;
      workflowInstanceId: string;
      entityLabel: string;
      slaDeadline?: string | null;
    }
  | {
      /** Contract/governance workflow human task — decide via the lex engine. */
      type: 'workflow';
      workflowInstanceId: string;
      taskId: string;
      entityLabel: string;
      slaDeadline?: string | null;
    }
  | {
      /** Litigation-case Phase-1 directive approval. */
      type: 'case';
      caseId: string;
      workflowInstanceId: string;
      taskId: string;
      entityLabel: string;
      approverRole: string;
      evidenceId: string;
      slaDeadline?: string | null;
    };

export interface InboxKpis {
  pending: number;
  dueToday: number;
  overdue: number;
}

export interface InboxData {
  items: InboxItem[];
  /** Items grouped by kind, in {@link INBOX_KIND_ORDER}; empty groups omitted. */
  groups: { kind: InboxKind; items: InboxItem[] }[];
  kpis: InboxKpis;
  isLoading: boolean;
  /** True when at least one source failed but others succeeded. */
  isPartial: boolean;
  /** True only when EVERY source failed (nothing to show). */
  isError: boolean;
  refetch: () => void;
}

export interface InboxSourceAccess {
  settlements: boolean;
  cases: boolean;
  workflows: boolean;
  requests: boolean;
}

/**
 * Resolve each backend source independently. This prevents a contracts-only
 * persona from issuing settlement/case requests it cannot authorize while
 * keeping its actor-scoped contract workflows and request approvals live.
 */
export function inboxSourceAccess(
  hasPermission: (permission: string) => boolean,
): InboxSourceAccess {
  return {
    settlements: hasPermission('lex:settlement:view'),
    cases: hasPermission('lex:case:approve'),
    workflows:
      hasPermission('lex:contract:view') || hasPermission('lex:document:view'),
    requests: hasPermission('lex:request:view'),
  };
}

/* ------------------------------------------------------------------------- *
 * Internals
 * ------------------------------------------------------------------------- */

const SOFT_QUERY = { staleTime: 30_000, retry: false as const };
const QUEUE_PAGE: FetchParams = { page: 1, per_page: 50, sort: 'updated_at', order: 'asc' };

/** Request statuses that mean "a human approval decision is pending". */
const REQUEST_PENDING_STATUSES = new Set<string>([
  'pending_provider_approval',
  'pending_requester_approval',
]);

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Resolve a bilingual title to the active locale, English-falling-back. */
function pickTitle(
  title: { en?: string; ar?: string } | null | undefined,
  locale: string,
  fallback: string,
): string {
  if (!title) return fallback;
  const primary = locale === 'ar' ? title.ar : title.en;
  return primary || title.en || title.ar || fallback;
}

/* ------------------------------------------------------------------------- *
 * Per-source normalizers
 * ------------------------------------------------------------------------- */

function settlementToItem(s: Settlement): InboxItem {
  const wf = s.workflow_instance_id ?? null;
  return {
    id: `settlement:${s.id}`,
    kind: 'settlement',
    title: s.title,
    requestedBy: s.counterparty_name || s.created_by || '',
    // Settlements have no explicit decision SLA; the create time anchors the
    // countdown's inferred window so the bar still conveys waiting time.
    dueAt: s.created_at,
    href: `/lex/settlements/${s.id}`,
    accentValue: s.status,
    action: wf
      ? {
          type: 'settlement',
          settlementId: s.id,
          workflowInstanceId: wf,
          entityLabel: s.title,
        }
      : undefined,
  };
}

/**
 * A workflow summary becomes either a `contract` item (when it is bound to a
 * contract) or a `governance` item (clause/regulation/other engine task). Only
 * rows carrying an open human task (`task_id` + pending `task_status`) reach the
 * inbox — those are the ones actually awaiting a decision.
 */
export function workflowToItem(w: LexWorkflowSummary): InboxItem | null {
  if (!w.task_id) return null;
  if (w.task_status && !['pending', 'claimed', 'escalated'].includes(w.task_status)) return null;

  const isContract = Boolean(w.contract_id);
  const kind: InboxKind = isContract ? 'contract' : 'governance';
  const title = w.contract_title || w.workflow_status || w.workflow_instance_id;
  const href = w.contract_id ? `/lex/contracts/${w.contract_id}` : '/lex/workflow-policies';

  return {
    id: `workflow:${w.task_id}`,
    kind,
    title,
    requestedBy: w.assignee_role || '',
    dueAt: w.sla_deadline ?? null,
    href,
    accentValue: w.task_status || w.workflow_status || 'pending',
    action: {
      type: 'workflow',
      workflowInstanceId: w.workflow_instance_id,
      taskId: w.task_id,
      entityLabel: title,
      slaDeadline: w.sla_deadline,
    },
  };
}

function requestToItem(r: LegalRequest, locale: string, fallback: string): InboxItem {
  const title = pickTitle(r.title, locale, r.request_number || fallback);
  return {
    id: `request:${r.id}`,
    kind: 'request',
    title,
    requestedBy: r.requester_name || '',
    dueAt: null,
    href: `/lex/service-desk/${r.id}`,
    accentValue: r.status,
  };
}

function metadataString(task: HumanTask, key: string): string {
  const value = task.metadata?.[key];
  return typeof value === 'string' ? value.trim() : '';
}

/** Normalize only case-intake tasks; other workflow tasks stay on their existing source. */
export function caseTaskToItem(task: HumanTask): InboxItem | null {
  const subjectType = metadataString(task, 'subject_type');
  const source = metadataString(task, 'source');
  if (subjectType !== 'legal_case' || source !== 'lex_case_intake') return null;
  if (!['pending', 'claimed', 'escalated'].includes(task.status)) return null;

  const caseId = metadataString(task, 'case_id');
  if (!caseId || !task.instance_id || !task.id) return null;

  const caseNumber = metadataString(task, 'case_number');
  const entityLabel = caseNumber || task.name || caseId;
  const approverRole = task.assignee_role?.trim() || metadataString(task, 'approver_ref') || 'legal-approver';
  // The requester column is a person field. Case intake tasks carry both the
  // immutable initiator id and, when IAM resolution succeeds, its display
  // name. Never fall back to the assignee role here: doing so attributes the
  // submission to the approver (typically the Cases Manager).
  const submittedBy =
    metadataString(task, 'submitted_by_name') || metadataString(task, 'submitted_by');
  const evidenceId = metadataString(task, 'doa_authority_ref');

  return {
    id: `case:${task.id}`,
    kind: 'case',
    title: entityLabel,
    requestedBy: submittedBy,
    dueAt: task.sla_deadline,
    href: `/lex/cases/${caseId}`,
    accentValue: task.status,
    action: {
      type: 'case',
      caseId,
      workflowInstanceId: task.instance_id,
      taskId: task.id,
      entityLabel,
      approverRole,
      evidenceId,
      slaDeadline: task.sla_deadline,
    },
  };
}

/** Fetch the actor-filtered case-intake queue owned by the Lex service. */
export function listVisibleCaseIntakeTasks(): Promise<PaginatedResponse<HumanTask>> {
  return apiGet<PaginatedResponse<HumanTask>>(API_ENDPOINTS.LEX_CASE_INTAKE_TASKS, {
    page: 1,
    per_page: 100,
  });
}

/* ------------------------------------------------------------------------- *
 * Hook
 * ------------------------------------------------------------------------- */

export function useInbox(enabled = true): InboxData {
  const { hasPermission } = useAuth();
  const { locale } = useLocaleOrDefault();
  const access = inboxSourceAccess(hasPermission);

  const settlementsQuery = useQuery({
    queryKey: ['lex-inbox', 'settlements'],
    queryFn: () =>
      settlementsApi.list({ ...QUEUE_PAGE, filters: { status: 'pending_approval' } }),
    enabled: enabled && access.settlements,
    ...SOFT_QUERY,
  });

  const workflowsQuery = useQuery({
    queryKey: ['lex-inbox', 'workflows'],
    queryFn: () => enterpriseApi.lex.listMyWorkflows(QUEUE_PAGE),
    enabled: enabled && access.workflows,
    ...SOFT_QUERY,
  });

  const caseTasksQuery = useQuery({
    queryKey: ['lex-inbox', 'case-tasks'],
    queryFn: listVisibleCaseIntakeTasks,
    enabled: enabled && access.cases,
    ...SOFT_QUERY,
  });

  const requestsQuery = useQuery({
    queryKey: ['lex-inbox', 'requests'],
    queryFn: () => lexRequestsApi.listMyApprovalRequests(QUEUE_PAGE),
    enabled: enabled && access.requests,
    ...SOFT_QUERY,
  });

  const sources: Array<{
    isLoading: boolean;
    isError: boolean;
    fetchStatus: 'fetching' | 'paused' | 'idle';
  }> = [];
  if (enabled && access.settlements) sources.push(settlementsQuery);
  if (enabled && access.cases) sources.push(caseTasksQuery);
  if (enabled && access.workflows) sources.push(workflowsQuery);
  if (enabled && access.requests) sources.push(requestsQuery);

  return useMemo<InboxData>(() => {
    if (!enabled) {
      return {
        items: [],
        groups: [],
        kpis: { pending: 0, dueToday: 0, overdue: 0 },
        isLoading: false,
        isPartial: false,
        isError: false,
        refetch: () => undefined,
      };
    }
    const items: InboxItem[] = [];

    // --- Settlements awaiting approval -----------------------------------
    for (const s of settlementsQuery.data?.data ?? []) {
      if (s.status !== 'pending_approval') continue;
      items.push(settlementToItem(s));
    }

    // --- Litigation-case directive approvals -----------------------------
    for (const task of caseTasksQuery.data?.data ?? []) {
      const item = caseTaskToItem(task);
      if (item) items.push(item);
    }

    // --- Contract + governance workflow tasks ----------------------------
    for (const w of workflowsQuery.data?.data ?? []) {
      const item = workflowToItem(w);
      if (item) items.push(item);
    }

    // --- Service-desk request approvals ----------------------------------
    for (const r of requestsQuery.data?.data ?? []) {
      if (!REQUEST_PENDING_STATUSES.has(r.status)) continue;
      items.push(requestToItem(r, locale, r.request_number));
    }

    // Stable ordering: by kind (canonical order), then soonest deadline, then
    // title for determinism. Items without a deadline sort last within a group.
    const kindRank = (k: InboxKind) => INBOX_KIND_ORDER.indexOf(k);
    items.sort((a, b) => {
      const kr = kindRank(a.kind) - kindRank(b.kind);
      if (kr !== 0) return kr;
      const at = a.dueAt ? Date.parse(a.dueAt) : Number.POSITIVE_INFINITY;
      const bt = b.dueAt ? Date.parse(b.dueAt) : Number.POSITIVE_INFINITY;
      if (at !== bt) return at - bt;
      return a.title.localeCompare(b.title);
    });

    // --- Grouping --------------------------------------------------------
    const groups = INBOX_KIND_ORDER.map((kind) => ({
      kind,
      items: items.filter((i) => i.kind === kind),
    })).filter((g) => g.items.length > 0);

    // --- KPIs (client-derived) ------------------------------------------
    const now = new Date();
    let dueToday = 0;
    let overdue = 0;
    for (const item of items) {
      if (!item.dueAt) continue;
      const due = new Date(item.dueAt);
      if (Number.isNaN(due.getTime())) continue;
      if (due.getTime() < now.getTime()) overdue += 1;
      else if (isSameDay(due, now)) dueToday += 1;
    }

    const anyLoading = sources.some((q) => q.isLoading && q.fetchStatus !== 'idle');
    const failures = sources.filter((q) => q.isError).length;

    return {
      items,
      groups,
      kpis: { pending: items.length, dueToday, overdue },
      isLoading: anyLoading,
      isPartial: failures > 0 && failures < sources.length,
      isError: failures === sources.length && sources.length > 0,
      refetch: () => {
        if (enabled && access.settlements) void settlementsQuery.refetch();
        if (enabled && access.cases) void caseTasksQuery.refetch();
        if (enabled && access.workflows) void workflowsQuery.refetch();
        if (enabled && access.requests) void requestsQuery.refetch();
      },
    };
    // Depend on the granular query fields (react-query returns fresh query
    // objects each render; depending on them defeats the memo). Mirrors the
    // command-center hook's dependency strategy.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    locale,
    access.settlements,
    access.cases,
    access.workflows,
    access.requests,
    enabled,
    settlementsQuery.data,
    settlementsQuery.isLoading,
    settlementsQuery.isError,
    settlementsQuery.fetchStatus,
    caseTasksQuery.data,
    caseTasksQuery.isLoading,
    caseTasksQuery.isError,
    caseTasksQuery.fetchStatus,
    workflowsQuery.data,
    workflowsQuery.isLoading,
    workflowsQuery.isError,
    workflowsQuery.fetchStatus,
    requestsQuery.data,
    requestsQuery.isLoading,
    requestsQuery.isError,
    requestsQuery.fetchStatus,
  ]);
}
