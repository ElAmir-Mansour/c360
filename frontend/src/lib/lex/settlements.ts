/**
 * Settlements / ADR (CAP-089..093) + Case Timelines (CAP-084..088) API client.
 *
 * This is the typed HTTP client for the legal-affairs Settlements/ADR vertical
 * and the per-matter Case-Timeline panel. It mirrors the `enterpriseApi.lex.*`
 * conventions (axios `apiGet/apiPost/...` against the gateway baseURL, the
 * `{data}` / `{data, meta}` envelope helpers in `@/lib/suite-api`) but lives in
 * this dedicated module because the shared `enterprise/api.ts` is integrator-owned.
 *
 * Endpoints (backend mounts at /api/v1/lex):
 *   Settlements:
 *     GET    /settlements
 *     POST   /settlements                                         (open reconciliation)
 *     GET    /settlements/{id}
 *     PUT    /settlements/{id}                                    (record terms)
 *     DELETE /settlements/{id}
 *     POST   /settlements/{id}/rounds                             (add negotiation round)
 *     POST   /settlements/{id}/submit                            (submit for approval)
 *     POST   /settlements/{id}/close                             (close by reconciliation)
 *     POST   /settlements/{id}/workflows/{workflowId}/tasks/{taskId}/decision
 *     GET    /settlements/{id}/audit
 *   Case timeline (per matter):
 *     GET    /matters/timelines                                    (cross-matter summary)
 *     GET    /matters/{id}/timeline
 *     PUT    /matters/{id}/timeline
 *     POST   /matters/{id}/timeline/external-hold
 *     GET    /matters/{id}/hold-history
 *     GET    /matters/{id}/delay-events
 *     POST   /matters/{id}/delay-events
 *     PATCH  /matters/{id}/delay-events/{eventId}                  (edit category/reason)
 *     POST   /matters/{id}/delay-events/{eventId}/resolve
 *     POST   /matters/{id}/delay-events/{eventId}/reopen
 *     GET    /matters/{id}/deadlines
 *     POST   /matters/{id}/deadlines
 */

import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { fetchSuiteData, fetchSuitePaginated } from '@/lib/suite-api';
import type { PaginatedResponse } from '@/types/api';
import type { HumanTask, WorkflowInstance } from '@/types/models';
import type { LexDocument } from '@/types/suites';
import type { FetchParams } from '@/types/table';

// ---------------------------------------------------------------------------
// Endpoint roots
// ---------------------------------------------------------------------------

const SETTLEMENTS_ROOT = '/api/v1/lex/settlements';
const MATTERS_ROOT = '/api/v1/lex/matters';
const SETTLEMENT_REPORT_ROOT = '/api/v1/lex/reports/settlements';

// ---------------------------------------------------------------------------
// Enums (raw backend tokens)
// ---------------------------------------------------------------------------

export const SETTLEMENT_STATUS_VALUES = [
  'proposed',
  'negotiating',
  'pending_approval',
  'approved',
  'executed',
  'rejected',
  'abandoned',
] as const;
export type SettlementStatus = (typeof SETTLEMENT_STATUS_VALUES)[number];

export const SETTLEMENT_METHOD_VALUES = [
  'reconciliation',
  'mediation',
  'arbitration',
  'negotiation',
  'other',
] as const;
export type SettlementMethod = (typeof SETTLEMENT_METHOD_VALUES)[number];

export const DELAY_CATEGORY_VALUES = ['court', 'government', 'department', 'expert'] as const;
export type DelayCategory = (typeof DELAY_CATEGORY_VALUES)[number];

/**
 * Allowed forward transitions of the settlement FSM, used to gate UI actions.
 * (Backend enforces authoritatively; this drives which buttons are enabled.)
 *
 * `abandoned` is a valid stored status (Go/DB enum) but is intentionally NOT
 * offered as a transition target: no backend verb writes it, so surfacing it
 * would produce a control that can only ever 409. It remains a terminal key
 * (`abandoned: []`) so a legacy row that somehow holds that status renders and
 * dead-ends correctly.
 */
export const SETTLEMENT_STATUS_TRANSITIONS: Record<SettlementStatus, SettlementStatus[]> = {
  proposed: ['negotiating', 'pending_approval'],
  negotiating: ['pending_approval'],
  pending_approval: ['approved', 'rejected'],
  approved: ['executed'],
  executed: [],
  rejected: ['negotiating'],
  abandoned: [],
};

/** Statuses for which the settlement record/terms are still mutable. */
export const SETTLEMENT_MUTABLE_STATUSES: SettlementStatus[] = [
  'proposed',
  'negotiating',
  'rejected',
];

// ---------------------------------------------------------------------------
// Response types (mirror backend JSON)
// ---------------------------------------------------------------------------

export interface SettlementNegotiationRound {
  id: string;
  tenant_id: string;
  settlement_id: string;
  round_number: number;
  proposed_by: string;
  proposed_value?: number | null;
  currency?: string | null;
  terms: string;
  outcome: string;
  metadata: Record<string, unknown>;
  created_by: string;
  created_at: string;
}

export interface Settlement {
  id: string;
  tenant_id: string;
  matter_id: string;
  reference: string;
  status: SettlementStatus;
  method: SettlementMethod;
  title: string;
  terms: string;
  value?: number | null;
  currency?: string | null;
  counterparty_name?: string | null;
  counterparty_contact?: string | null;
  counterparty_id_number?: string | null;
  workflow_instance_id?: string | null;
  approved_by?: string | null;
  approved_at?: string | null;
  executed_at?: string | null;
  metadata: Record<string, unknown>;
  created_by: string;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
  rounds?: SettlementNegotiationRound[];
}

export interface SettlementAuditEntry {
  id: string;
  tenant_id: string;
  settlement_id: string;
  action: string;
  from_status?: string | null;
  to_status?: string | null;
  detail: Record<string, unknown>;
  actor_user_id: string;
  created_at: string;
}

export interface LegalCaseDelayEvent {
  id: string;
  tenant_id: string;
  matter_id: string;
  category: DelayCategory;
  reason: string;
  opened_at: string;
  resolved_at?: string | null;
  resolved: boolean;
  metadata: Record<string, unknown>;
  created_by: string;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export interface MatterTimeline {
  matter_id: string;
  tenant_id: string;
  matter_number: string;
  title: string;
  status: string;
  opened_at: string;
  due_date?: string | null;
  closed_at?: string | null;
  estimated_duration_days?: number | null;
  estimated_completion_date?: string | null;
  external_hold: boolean;
  external_hold_category?: DelayCategory | null;
  external_hold_since?: string | null;
  closure_reason?: string | null;
  updated_at: string;
  delay_events?: LegalCaseDelayEvent[];
  open_delay_days: number;
}

/**
 * One row of the cross-matter (portfolio) timeline summary that powers the
 * manager triage dashboard (#15). Mirrors `model.MatterTimelineSummary`.
 */
export interface MatterTimelineSummary {
  matter_id: string;
  matter_number: string;
  title: string;
  status: string;
  external_hold: boolean;
  external_hold_category?: DelayCategory | null;
  external_hold_since?: string | null;
  estimated_completion_date?: string | null;
  due_date?: string | null;
  open_delay_days: number;
  updated_at: string;
}

/**
 * One immutable audit row recording an external-hold (external-pending) change
 * on a matter (#12). Mirrors `model.LegalCaseHoldHistory`. `action` is `'set'`
 * when a hold is placed and `'cleared'` when it is lifted.
 */
export interface HoldHistoryEntry {
  id: string;
  tenant_id: string;
  matter_id: string;
  action: 'set' | 'cleared';
  category?: DelayCategory | null;
  reason?: string | null;
  created_by: string;
  created_at: string;
}

// Obligation enums (raw backend tokens) — deadlines are obligations under the hood.
export const OBLIGATION_TYPE_VALUES = [
  'contractual',
  'renewal',
  'notice',
  'payment',
  'delivery',
  'reporting',
  'compliance',
  'covenant',
  'condition_precedent',
  'regulatory',
  'other',
] as const;
export type ObligationType = (typeof OBLIGATION_TYPE_VALUES)[number];

export const OBLIGATION_STATUS_VALUES = [
  'open',
  'in_progress',
  'blocked',
  'completed',
  'waived',
  'cancelled',
] as const;
export type ObligationStatus = (typeof OBLIGATION_STATUS_VALUES)[number];

export const OBLIGATION_PRIORITY_VALUES = ['critical', 'high', 'medium', 'low'] as const;
export type ObligationPriority = (typeof OBLIGATION_PRIORITY_VALUES)[number];

/**
 * A deadline obligation as returned by the deadline endpoints (#10/#11). This is
 * the full `model.Obligation` JSON — a matter deadline is auto-tracked via the
 * existing obligation reminder outbox, so the create/list endpoints return the
 * obligation row verbatim.
 */
export interface DeadlineObligation {
  id: string;
  tenant_id: string;
  title: string;
  description: string;
  type: ObligationType;
  status: ObligationStatus;
  priority: ObligationPriority;
  contract_id?: string | null;
  contract_title?: string | null;
  matter_id?: string | null;
  matter_title?: string | null;
  clause_id?: string | null;
  owner_user_id: string;
  owner_name: string;
  due_date: string;
  completed_at?: string | null;
  reminder_enabled: boolean;
  reminder_lead_days: number[];
  escalation_enabled: boolean;
  escalation_lead_days: number[];
  escalation_target?: string | null;
  last_reminder_at?: string | null;
  tags: string[];
  metadata: Record<string, unknown>;
  created_by: string;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
  days_until_due: number;
}

// Workflow decision (settlement approval task)
export interface SettlementWorkflowDecisionResult {
  status?: string;
  decision?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Settlement report / analytics (FEATURES 1 + 3) — GET /reports/settlements
// ---------------------------------------------------------------------------

/**
 * One PII-free settlement line item on a {@link SettlementReport}. Mirrors
 * `model.SettlementSummary` — counterparty fields are intentionally excluded.
 */
export interface SettlementReportLineItem {
  id: string;
  reference: string;
  matter_id: string;
  title: string;
  status: SettlementStatus;
  method: SettlementMethod;
  value?: number | null;
  currency?: string | null;
  approved_at?: string | null;
  executed_at?: string | null;
  created_at: string;
}

/**
 * create->execute turnaround statistics over the executed settlements in scope.
 * Mirrors `model.SettlementCycleTime`. All fields are 0 when `executed_count` is 0.
 */
export interface SettlementCycleTime {
  executed_count: number;
  avg_days: number;
  min_days: number;
  max_days: number;
}

/**
 * Aggregated Settlements analytics report (FEATURES 1 + 3). Mirrors
 * `model.SettlementReport`: the matching line items plus count/value rollups by
 * status and method, realised settled value, value at risk, average settlement
 * value, and create->execute cycle-time stats. Honors the same filters as the
 * settlements list (matter_id, status, method, search).
 */
export interface SettlementReport {
  generated_at: string;
  total: number;
  /** Only the active filters are echoed back. */
  filters: {
    search?: string;
    status?: string;
    method?: string;
    matter_id?: string;
  };
  /** PII-free line items, newest-first (created_at DESC). */
  settlements: SettlementReportLineItem[];
  /** Count of settlements per FSM status. */
  by_status: Record<string, number>;
  /** Count of settlements per ADR method. */
  by_method: Record<string, number>;
  /** Sum of value per status (NULL values contribute 0). */
  value_by_status: Record<string, number>;
  /** Realised settled amount == value_by_status["executed"]. */
  settled_value: number;
  /** Value awaiting approval == value_by_status["pending_approval"]. */
  value_at_risk: number;
  /** Sum of value across ALL matching settlements (NULLs as 0). */
  total_value: number;
  /** Number of matching settlements that carry a non-NULL value. */
  valued_count: number;
  /** total_value / valued_count (0 when none). */
  average_value: number;
  cycle_time: SettlementCycleTime;
}

// ---------------------------------------------------------------------------
// Settlement document links (FEATURE 12) — /settlements/{id}/documents
// ---------------------------------------------------------------------------

/**
 * A join row connecting a settlement to an existing repository document
 * (`LexDocument`). Mirrors `model.SettlementDocumentLink`. The linked document
 * is hydrated (`document`) on list/get responses when available. Unlinking
 * soft-deletes only the link — the WORM document registry row is never touched.
 */
export interface SettlementDocumentLink {
  id: string;
  tenant_id: string;
  settlement_id: string;
  document_id: string;
  relationship: string;
  created_by: string;
  created_at: string;
  deleted_at?: string | null;
  document?: LexDocument;
}

/** Body for linking an existing repository document to a settlement. */
export interface AddSettlementDocumentPayload {
  document_id: string;
  /** Optional; backend defaults to `"related"`. */
  relationship?: string;
}

// ---------------------------------------------------------------------------
// Request payloads (mirror backend DTOs)
// ---------------------------------------------------------------------------

export interface OpenSettlementPayload {
  matter_id: string;
  reference?: string;
  method: SettlementMethod;
  title: string;
  terms: string;
  value?: number;
  currency?: string;
  counterparty_name?: string;
  counterparty_contact?: string;
  counterparty_id_number?: string;
  metadata?: Record<string, unknown>;
}

export interface RecordSettlementPayload {
  reference?: string;
  method?: SettlementMethod;
  title?: string;
  terms?: string;
  value?: number;
  currency?: string;
  counterparty_name?: string;
  counterparty_contact?: string;
  counterparty_id_number?: string;
  metadata?: Record<string, unknown>;
}

export interface AddNegotiationRoundPayload {
  proposed_by: string;
  proposed_value?: number;
  currency?: string;
  terms: string;
  outcome?: string;
  metadata?: Record<string, unknown>;
}

export interface SettlementDecisionPayload {
  decision: string;
  notes?: string;
  metadata?: Record<string, unknown>;
  late_justification?: string;
}

export interface UpdateMatterTimelinePayload {
  estimated_duration_days?: number;
  estimated_completion_date?: string;
  clear_estimate?: boolean;
}

export interface SetExternalHoldPayload {
  held: boolean;
  category?: DelayCategory;
  reason?: string;
  since?: string;
}

export interface RecordDelayEventPayload {
  category: DelayCategory;
  reason: string;
  opened_at?: string;
  also_mark_external_hold?: boolean;
  metadata?: Record<string, unknown>;
}

export interface ResolveDelayEventPayload {
  resolved_at?: string;
  also_clear_external_hold?: boolean;
}

/**
 * Edit the category and/or reason of an existing delay event (#13). Both fields
 * are optional; omit a field to leave it unchanged (at least one must be set).
 * Mirrors `dto.UpdateDelayEventRequest`.
 */
export interface EditDelayEventPayload {
  category?: DelayCategory;
  reason?: string;
}

/**
 * Create a matter deadline obligation (#10/#11). Mirrors
 * `dto.CreateDeadlineObligationRequest`. `due_date` is required (RFC3339).
 * `kind` defaults to `"deadline"`, `lead_days` defaults to `[7, 1]`, and
 * `owner_user_id` defaults to the caller when omitted.
 */
export interface CreateDeadlinePayload {
  kind?: string;
  title?: string;
  due_date: string;
  owner_user_id?: string;
  owner_name?: string;
  lead_days?: number[];
}

/**
 * Optional filters/sort for the per-matter delay-event listing (#9/#13).
 * Backward compatible with the existing `FetchParams`-only call: the legacy
 * `sort`/`order` on `FetchParams` still map to the backend `sort`/`sort_dir`
 * params. These `extra` fields override them when provided.
 */
export interface ListDelayEventsParams {
  /** ILIKE search on the delay reason (backend param `q`). */
  q?: string;
  /** Filter to a single delay category (backend param `category`). */
  category?: DelayCategory;
  /** Filter to still-open delay events only (backend param `open`). */
  open?: boolean;
  /** Sort column, e.g. `'opened_at'` (backend param `sort`). */
  sort?: string;
  /** Sort direction (backend param `sort_dir`). */
  sort_dir?: 'asc' | 'desc';
}

// ---------------------------------------------------------------------------
// API surface
// ---------------------------------------------------------------------------

export const settlementsApi = {
  // --- Settlements / ADR -------------------------------------------------
  list: (params: FetchParams): Promise<PaginatedResponse<Settlement>> =>
    fetchSuitePaginated<Settlement>(SETTLEMENTS_ROOT, params),
  get: (id: string): Promise<Settlement> => fetchSuiteData<Settlement>(`${SETTLEMENTS_ROOT}/${id}`),
  open: (payload: OpenSettlementPayload): Promise<Settlement> =>
    apiPost<{ data: Settlement }>(SETTLEMENTS_ROOT, payload).then((res) => res.data),
  record: (id: string, payload: RecordSettlementPayload): Promise<Settlement> =>
    apiPut<{ data: Settlement }>(`${SETTLEMENTS_ROOT}/${id}`, payload).then((res) => res.data),
  remove: (id: string): Promise<void> => apiDelete<void>(`${SETTLEMENTS_ROOT}/${id}`),
  addRound: (id: string, payload: AddNegotiationRoundPayload): Promise<Settlement> =>
    apiPost<{ data: Settlement }>(`${SETTLEMENTS_ROOT}/${id}/rounds`, payload).then((res) => res.data),
  submitForApproval: (id: string): Promise<Settlement> =>
    apiPost<{ data: Settlement }>(`${SETTLEMENTS_ROOT}/${id}/submit`, {}).then((res) => res.data),
  close: (id: string): Promise<Settlement> =>
    apiPost<{ data: Settlement }>(`${SETTLEMENTS_ROOT}/${id}/close`, {}).then((res) => res.data),
  decide: (
    id: string,
    workflowId: string,
    taskId: string,
    payload: SettlementDecisionPayload,
  ): Promise<SettlementWorkflowDecisionResult> =>
    apiPost<{ data: SettlementWorkflowDecisionResult }>(
      `${SETTLEMENTS_ROOT}/${id}/workflows/${workflowId}/tasks/${taskId}/decision`,
      payload,
    ).then((res) => res.data),
  listAudit: (id: string): Promise<SettlementAuditEntry[]> =>
    fetchSuiteData<SettlementAuditEntry[]>(`${SETTLEMENTS_ROOT}/${id}/audit`),

  // --- Settlement reports / analytics (FEATURES 1 + 3) ------------------
  /**
   * Aggregated Settlements analytics report. Honors the same filters as the
   * settlements list (matter_id, status, method, search) via `params`. For the
   * CSV line-item export, pass `{ format: 'csv' }` and handle the raw response
   * at the call site (the JSON variant is typed here).
   */
  getSettlementReport: (params?: FetchParams): Promise<SettlementReport> =>
    fetchSuiteData<SettlementReport>(SETTLEMENT_REPORT_ROOT, params as Record<string, unknown> | undefined),

  // --- Settlement document links (FEATURE 12) ---------------------------
  listSettlementDocuments: (id: string): Promise<SettlementDocumentLink[]> =>
    fetchSuiteData<SettlementDocumentLink[]>(`${SETTLEMENTS_ROOT}/${id}/documents`),
  addSettlementDocument: (
    id: string,
    payload: AddSettlementDocumentPayload,
  ): Promise<SettlementDocumentLink> =>
    apiPost<{ data: SettlementDocumentLink }>(
      `${SETTLEMENTS_ROOT}/${id}/documents`,
      payload,
    ).then((res) => res.data),
  removeSettlementDocument: (id: string, linkId: string): Promise<void> =>
    apiDelete<void>(`${SETTLEMENTS_ROOT}/${id}/documents/${linkId}`),

  // --- Workflow read (FEATURE 11) ---------------------------------------
  /**
   * Read a workflow instance backing a settlement approval. Reuses the shared
   * platform workflow engine endpoint (`/api/v1/workflows/instances/{id}`).
   */
  getWorkflowInstance: (instanceId: string): Promise<WorkflowInstance> =>
    apiGet<WorkflowInstance>(`${API_ENDPOINTS.WORKFLOWS_INSTANCES}/${instanceId}`),
  /**
   * List the human tasks for a settlement's workflow instance. Reuses the shared
   * workflow engine task endpoint (`/api/v1/workflows/tasks?instance_id=...`),
   * which returns a paginated envelope of {@link HumanTask}.
   */
  listWorkflowTasks: (instanceId: string): Promise<PaginatedResponse<HumanTask>> =>
    apiGet<PaginatedResponse<HumanTask>>(API_ENDPOINTS.WORKFLOWS_TASKS, {
      instance_id: instanceId,
    }),

  // --- Case timeline (per matter) ---------------------------------------
  getTimeline: (matterId: string): Promise<MatterTimeline> =>
    fetchSuiteData<MatterTimeline>(`${MATTERS_ROOT}/${matterId}/timeline`),
  updateTimeline: (matterId: string, payload: UpdateMatterTimelinePayload): Promise<MatterTimeline> =>
    apiPut<{ data: MatterTimeline }>(`${MATTERS_ROOT}/${matterId}/timeline`, payload).then(
      (res) => res.data,
    ),
  setExternalHold: (matterId: string, payload: SetExternalHoldPayload): Promise<MatterTimeline> =>
    apiPost<{ data: MatterTimeline }>(`${MATTERS_ROOT}/${matterId}/timeline/external-hold`, payload).then(
      (res) => res.data,
    ),
  listDelayEvents: (
    matterId: string,
    params: FetchParams,
    extra?: ListDelayEventsParams,
  ): Promise<PaginatedResponse<LegalCaseDelayEvent>> =>
    fetchSuitePaginated<LegalCaseDelayEvent>(`${MATTERS_ROOT}/${matterId}/delay-events`, params, {
      // Backend reads `q`, `category`, `open`, `sort`, `sort_dir`. The shared
      // helper already forwards `params.sort` as `sort`, but the backend uses
      // `sort_dir` (not `order`) for direction — so translate the legacy
      // `params.order` and let an explicit `extra.sort_dir` win.
      open: extra?.open ? 'true' : undefined,
      category: extra?.category,
      q: extra?.q,
      sort: extra?.sort,
      sort_dir: extra?.sort_dir ?? params.order,
    }),
  recordDelayEvent: (
    matterId: string,
    payload: RecordDelayEventPayload,
  ): Promise<LegalCaseDelayEvent> =>
    apiPost<{ data: LegalCaseDelayEvent }>(`${MATTERS_ROOT}/${matterId}/delay-events`, payload).then(
      (res) => res.data,
    ),
  resolveDelayEvent: (
    matterId: string,
    eventId: string,
    payload: ResolveDelayEventPayload,
  ): Promise<LegalCaseDelayEvent> =>
    apiPost<{ data: LegalCaseDelayEvent }>(
      `${MATTERS_ROOT}/${matterId}/delay-events/${eventId}/resolve`,
      payload,
    ).then((res) => res.data),
  editDelayEvent: (
    matterId: string,
    eventId: string,
    payload: EditDelayEventPayload,
  ): Promise<LegalCaseDelayEvent> =>
    apiPatch<{ data: LegalCaseDelayEvent }>(
      `${MATTERS_ROOT}/${matterId}/delay-events/${eventId}`,
      payload,
    ).then((res) => res.data),
  reopenDelayEvent: (matterId: string, eventId: string): Promise<LegalCaseDelayEvent> =>
    apiPost<{ data: LegalCaseDelayEvent }>(
      `${MATTERS_ROOT}/${matterId}/delay-events/${eventId}/reopen`,
      {},
    ).then((res) => res.data),

  // --- Deadlines (per matter, #10/#11) ----------------------------------
  createDeadline: (matterId: string, payload: CreateDeadlinePayload): Promise<DeadlineObligation> =>
    apiPost<{ data: DeadlineObligation }>(`${MATTERS_ROOT}/${matterId}/deadlines`, payload).then(
      (res) => res.data,
    ),
  listDeadlines: (
    matterId: string,
    params?: FetchParams,
  ): Promise<PaginatedResponse<DeadlineObligation>> =>
    fetchSuitePaginated<DeadlineObligation>(`${MATTERS_ROOT}/${matterId}/deadlines`, {
      page: 1,
      per_page: 50,
      ...params,
    }),

  // --- External-hold history (#12) --------------------------------------
  listHoldHistory: (matterId: string): Promise<HoldHistoryEntry[]> =>
    fetchSuiteData<HoldHistoryEntry[]>(`${MATTERS_ROOT}/${matterId}/hold-history`),

  // --- Cross-matter timeline summary (manager triage, #15) --------------
  listMatterTimelines: (
    params?: FetchParams & {
      on_hold?: boolean;
      min_open_delay_days?: number;
      sort?: 'open_delay_days' | 'updated_at';
      sort_dir?: 'asc' | 'desc';
    },
  ): Promise<PaginatedResponse<MatterTimelineSummary>> => {
    const { page, per_page, on_hold, min_open_delay_days, sort, sort_dir, ...rest } = params ?? {};
    return fetchSuitePaginated<MatterTimelineSummary>(
      `${MATTERS_ROOT}/timelines`,
      { page: page ?? 1, per_page: per_page ?? 20, ...rest },
      {
        on_hold: on_hold === undefined ? undefined : on_hold ? 'true' : 'false',
        min_open_delay_days: min_open_delay_days,
        sort,
        sort_dir,
      },
    );
  },

  // --- Helper: matter lookup for the open-settlement dialog -------------
  searchMatters: (search: string): Promise<PaginatedResponse<{ id: string; title: string; matter_number?: string; status: string }>> =>
    fetchSuitePaginated(`${MATTERS_ROOT}`, {
      page: 1,
      per_page: 20,
      search,
      sort: 'updated_at',
      order: 'desc',
    }),
} as const;

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

/** Whether a settlement can still have its terms edited / rounds added. */
export function isSettlementMutable(status: SettlementStatus): boolean {
  return SETTLEMENT_MUTABLE_STATUSES.includes(status);
}

/** Tonal accent class for a settlement status (leading bar / badge tone). */
export function settlementStatusAccent(status: SettlementStatus): string {
  switch (status) {
    case 'executed':
    case 'approved':
      return 'bg-emerald-400/70';
    case 'rejected':
    case 'abandoned':
      return 'bg-destructive/60';
    case 'pending_approval':
      return 'bg-amber-400/70';
    default:
      return 'bg-sky-400/70';
  }
}

/** Format a settlement money value with currency, Western digits. */
export function formatSettlementValue(value?: number | null, currency?: string | null): string {
  if (value === null || value === undefined) {
    return '—';
  }
  const formatted = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
  return currency ? `${formatted} ${currency}` : formatted;
}
