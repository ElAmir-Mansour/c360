import api, {
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  apiPut,
  apiUpload,
} from "@/lib/api";
import { getAccessToken } from "@/lib/auth";
import { getActiveImpersonationToken } from "@/stores/impersonation-store";
import { getCSRFToken, CSRF_HEADER } from "@/lib/csrf";
import { getApiUrl } from "@/lib/env";
import {
  readSSEStream,
  streamFallback,
  type AskStreamHandlers,
} from "@/lib/enterprise/reference-library-stream";
import {
  buildSuiteQueryParams,
  fetchSuiteData,
  fetchSuitePaginated,
} from "@/lib/suite-api";
import type { PaginatedResponse } from "@/types/api";
import type {
  FileAccessLogEntry,
  FilePresignedDownload,
  FileQuarantineEntry,
  FileRecord,
  FileStorageStat,
  HumanTask,
} from "@/types/models";
import type { FetchParams } from "@/types/table";
import type {
  AICreateVersionPayload,
  AIDashboardData,
  AIDriftReport,
  AIExplanation,
  AILifecycleHistoryEntry,
  AIModelVersion,
  AIRegisterModelPayload,
  AIRegisteredModel,
  AIModelWithVersions,
  AIPerformancePoint,
  AIPredictionLog,
  AIPredictionStats,
  AIShadowComparison,
  AIShadowDivergence,
  AIUpdateModelPayload,
  AIValidationPreview,
  AIValidationResult,
  AIInferenceServer,
  AIBenchmarkSuite,
  AIBenchmarkRun,
  AIBenchmarkComparison,
  AIComputeCostModel,
  CostSavingsEstimate,
} from "@/types/ai-governance";
import type {
  ActaActionItem,
  ActaActionItemStats,
  ActaCalendarDay,
  ActaCommittee,
  ActaComplianceCheck,
  ActaComplianceReport,
  ActaDashboard,
  ActaMeeting,
  ActaMeetingAttachment,
  ActaMeetingMinutes,
  ActaMeetingSummary,
  ActaAgendaItem,
  ActaAttendee,
  JsonObject,
  LexClause,
  LexClauseDeviationReport,
  LexClausePlaybook,
  LexClonePlaybookPayload,
  LexDeviationFilters,
  LexDeviationReview,
  LexDryRunPlaybookPayload,
  LexPlaybookPortfolioParams,
  LexPlaybookPortfolioResult,
  LexPlaybookTemplate,
  LexUpsertDeviationReviewPayload,
  LexComplianceAlert,
  LexComplianceDashboard,
  LexComplianceRule,
  LexComplianceRunResult,
  LexComplianceScore,
  LexContractBrief,
  LexContractBulkAnalyzeRequest,
  LexContractBulkResult,
  LexContractBulkStatusRequest,
  LexContractClassificationRequest,
  LexContractClassificationResult,
  LexContractDetail,
  LexContractInsightsReport,
  LexContractRedline,
  LexContractRecord,
  LexContractReport,
  LexContractRenewalWarningSummary,
  LexContractRiskAnalysis,
  LexContractSummary,
  LexContractStats,
  LexContractStatus,
  LexContractType,
  LexRiskLevel,
  LexContractTimeline,
  LexContractVersion,
  LexCreateClauseLibraryEntryPayload,
  LexDashboard,
  LexAnalyzeDocumentTermsCrossReferencesRequest,
  LexDocument,
  LexApplyDocumentDefinedTermRepairRequest,
  LexDocumentApprovalMatrix,
  LexCreateDocumentAutomationTaskRequest,
  LexCreateDocumentEvidenceBindingRequest,
  LexDocumentAuditEntry,
  LexDocumentBulkImportResult,
  LexDocumentCheckOutRequest,
  LexDocumentClauseAIActionRequest,
  LexDocumentClauseAIActionResult,
  LexDocumentAIChangeSafety,
  LexDocumentAutomationTask,
  LexDocumentClauseAnchor,
  LexDocumentCollaborationInbox,
  LexDocumentCompareWorkspace,
  LexDocumentEditorLock,
  LexDocumentEditorOpenRequest,
  LexDocumentEditorPreflightIssue,
  LexDocumentEditorPreflightResult,
  LexDocumentEditorSession,
  LexDocumentEditorFeatureRequestBase,
  LexDocumentEditorAnalytics,
  LexDocumentEvidenceBinding,
  LexDocumentGuestReviewLink,
  LexDocumentGuestPortalStatus,
  LexDocumentHealthScore,
  LexDocumentLegalIssue,
  LexDocumentNegotiationMessage,
  LexDocumentNegotiationMessageRequest,
  LexDocumentNegotiationRoom,
  LexDocumentOfflineRecoveryState,
  LexDocumentPlaybookRuleLink,
  LexDocumentPreflightRequest,
  LexDocumentPlaybookEnforcement,
  LexDocumentProviderEvent,
  LexDocumentPrivilegedControls,
  LexDocumentRedlinePackage,
  LexDocumentDefinedTermRepairAction,
  LexDocumentRepositorySummary,
  LexDocumentSearchHit,
  LexDocumentSectionAssignment,
  LexDocumentSignatureReadiness,
  LexDocumentTermsCrossReferences,
  LexDocumentVersion,
  LexDocumentVersionSnapshot,
  LexDocumentVersionSnapshotRequest,
  LexCreateMatterPayload,
  LexExpiringContractSummary,
  LexCreateObligationPayload,
  LexCreatePlaybookPayload,
  LexCreateRegulationPayload,
  LexDispatchObligationReminderOutboxPayload,
  LexEnqueueObligationRemindersPayload,
  LexExtractObligationsPayload,
  LexClauseLibraryEntry,
  LexClauseLibrarySearchParams,
  LexClauseLibrarySearchResult,
  LexGovernanceDecisionRequest,
  LexLinkMatterContractPayload,
  LexLinkRegulationClausePayload,
  LexMarkObligationReminderDeliveryPayload,
  LexMarkObligationReminderSentPayload,
  LexMatter,
  LexMatterContract,
  LexMatterConflictCheckRequest,
  LexMatterConflictCheckResult,
  LexMatterReport,
  LexMatterComment,
  LexCreateMatterCommentPayload,
  LexUpdateMatterCommentPayload,
  LexMatterDocumentLink,
  LexCreateMatterDocumentLinkPayload,
  LexMatterAuditEntry,
  LexMatterLink,
  LexCreateMatterLinkPayload,
  LexCaseTimeline,
  LexMatterTimelineSummary,
  LexMatterTimelineSummaryParams,
  LexUpdateMatterTimelinePayload,
  LexSetExternalHoldPayload,
  LexObligation,
  LexObligationExtractionResult,
  LexObligationNotificationOutboxItem,
  LexObligationReport,
  LexResolutionRateReport,
  LexObligationReminderEnqueueResult,
  LexObligationReminderDispatchResult,
  LexObligationReminderPlan,
  LexRegulation,
  LexRegulationClauseReference,
  LexRegulationSearchParams,
  LexRegulationSearchResult,
  LexReferenceDocument,
  LexReferenceLibraryFacets,
  LexReferenceSearchHit,
  LexReferenceAskPayload,
  LexReferenceAskResponse,
  LexReferenceArticle,
  LexReferenceAskFeedbackPayload,
  LexRenderedSignatureText,
  LexCreateSignatureEnvelopePayload,
  LexApprovalPolicy,
  LexApprovalPolicyAnalytics,
  LexApprovalPolicyRecommendationResult,
  LexCreateApprovalPolicyRequest,
  LexUpdateApprovalPolicyRequest,
  LexCreateDocumentGuestReviewLinkRequest,
  LexCreateDocumentLegalIssueRequest,
  LexCreateDocumentPlaybookRuleLinkRequest,
  LexDraftingAssembleRequest,
  LexDraftingAssemblyResult,
  LexDraftingClauseRequest,
  LexDraftingClauseRewrite,
  LexDraftingContractDraft,
  LexDraftingContractRequest,
  LexDraftingContractSummary,
  LexDraftingFallbackRequest,
  LexDraftingFallbackSet,
  LexDraftingGeneratedClause,
  LexDraftingGlossaryRequest,
  LexDraftingGlossaryResult,
  LexDraftingObligationQaRequest,
  LexDraftingObligationQaReview,
  LexDraftingRewriteRequest,
  LexDraftingRfpRequest,
  LexDraftingRfpResponse,
  LexDraftingSummaryRequest,
  LexDraftingTranslateRequest,
  LexDraftingTranslationResult,
  LexRecordSignatureCustodyPayload,
  LexRecordDocumentProviderEventRequest,
  LexExtractDocumentClauseAnchorsRequest,
  LexGenerateDocumentRedlinePackageRequest,
  LexRefreshDocumentHealthScoreRequest,
  LexRevokeDocumentGuestReviewLinkRequest,
  LexRequestDocumentApprovalRequest,
  LexRunDocumentCompareRequest,
  LexRunDocumentPlaybookEnforcementRequest,
  LexRunDocumentSignatureReadinessRequest,
  LexSaveDocumentOfflineRecoveryRequest,
  LexReviewContractRequest,
  LexSignatureEnvelope,
  LexSignatureProviderEventPayload,
  LexSignatureRecipientActionPayload,
  LexSignatureUserProfile,
  LexTriageMatterPayload,
  LexUnlinkRegulationClauseParams,
  LexUpdateClauseLibraryEntryPayload,
  LexUpdateDocumentAIChangeSafetyRequest,
  LexUpdateDocumentAutomationTaskRequest,
  LexUpdateDocumentLegalIssueRequest,
  LexUpdateDocumentPrivilegedControlsRequest,
  LexUpdateMatterPayload,
  LexUpdateMatterStatusPayload,
  LexUpdateObligationPayload,
  LexUpdateObligationStatusPayload,
  LexUpdatePlaybookPayload,
  LexUpdateRegulationPayload,
  LexWorkflowDecisionRequest,
  LexWorkflowDecisionResult,
  LexWorkflowBulkDecisionRequest,
  LexWorkflowBulkDecisionResult,
  LexWorkflowSummary,
  LexUpsertSignaturePlacementsPayload,
  LexUpsertSignatureUserProfilePayload,
  LexUpsertDocumentNegotiationRoomRequest,
  LexUpsertDocumentSectionAssignmentRequest,
  UserDirectoryEntry,
  VisusAlertStats,
  VisusDashboard,
  VisusExecutiveAlert,
  VisusExecutiveSummary,
  VisusKPIDefinition,
  VisusKPIGetResponse,
  VisusKPISnapshot,
  VisusReportDefinition,
  VisusReportSnapshot,
  VisusWidget,
  VisusWidgetData,
  VisusWidgetTypeDefinition,
} from "@/types/suites";
import type {
  VisusCTIBrandAbuseListResponse,
  VisusCTICampaignListResponse,
  VisusCTIOverview,
  VisusCTIRiskScoreResponse,
  VisusCTISectorResponse,
  VisusCTIThreatMapResponse,
} from "@/types/visus-cti";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeOptionalString(value: unknown): unknown {
  if (value == null) {
    return null;
  }
  if (typeof value !== "string") {
    return value;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeOptionalId(value: unknown): unknown {
  return normalizeOptionalString(value);
}

function normalizeDateOnlyValue(value: unknown): unknown {
  if (value == null) {
    return null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.valueOf()) ? null : value.toISOString();
  }
  if (typeof value !== "string") {
    return value;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return `${trimmed}T12:00:00.000Z`;
  }
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.valueOf()) ? trimmed : parsed.toISOString();
}

function normalizeDateTimeValue(value: unknown): unknown {
  if (value == null) {
    return null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.valueOf()) ? null : value.toISOString();
  }
  if (typeof value !== "string") {
    return value;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.valueOf()) ? trimmed : parsed.toISOString();
}

function normalizeCommitteePayload(payload: unknown): unknown {
  if (!isRecord(payload)) {
    return payload;
  }
  return {
    ...payload,
    vice_chair_user_id: normalizeOptionalId(payload.vice_chair_user_id),
    secretary_user_id: normalizeOptionalId(payload.secretary_user_id),
    charter: normalizeOptionalString(payload.charter),
    established_date: normalizeDateOnlyValue(payload.established_date),
    dissolution_date: normalizeDateOnlyValue(payload.dissolution_date),
    vice_chair_name: normalizeOptionalString(payload.vice_chair_name),
    vice_chair_email: normalizeOptionalString(payload.vice_chair_email),
    secretary_name: normalizeOptionalString(payload.secretary_name),
    secretary_email: normalizeOptionalString(payload.secretary_email),
  };
}

// CreateCommitteeRequest does not have a `status` field; the backend defaults new
// committees to "active". Strip it so DisallowUnknownFields does not reject it.
function normalizeCommitteeCreatePayload(payload: unknown): unknown {
  const normalized = normalizeCommitteePayload(payload);
  if (!isRecord(normalized)) {
    return normalized;
  }
  const { status: _status, ...rest } = normalized;
  return rest;
}

function normalizeMeetingPayload(payload: unknown): unknown {
  if (!isRecord(payload)) {
    return payload;
  }
  return {
    ...payload,
    scheduled_at: normalizeDateTimeValue(payload.scheduled_at),
    scheduled_end_at: normalizeDateTimeValue(payload.scheduled_end_at),
    location: normalizeOptionalString(payload.location),
    virtual_link: normalizeOptionalString(payload.virtual_link),
    virtual_platform: normalizeOptionalString(payload.virtual_platform),
  };
}

function normalizePostponePayload(payload: unknown): unknown {
  if (!isRecord(payload)) {
    return payload;
  }
  return {
    ...payload,
    new_scheduled_at: normalizeDateTimeValue(payload.new_scheduled_at),
    new_scheduled_end_at: normalizeDateTimeValue(payload.new_scheduled_end_at),
  };
}

function normalizeAttendancePayload(payload: unknown): unknown {
  if (!isRecord(payload)) {
    return payload;
  }
  return {
    ...payload,
    notes: normalizeOptionalString(payload.notes),
    proxy_user_id: normalizeOptionalId(payload.proxy_user_id),
    proxy_user_name: normalizeOptionalString(payload.proxy_user_name),
    proxy_authorized_by: normalizeOptionalId(payload.proxy_authorized_by),
  };
}

function normalizeBulkAttendancePayload(payload: unknown): unknown {
  if (!isRecord(payload)) {
    return payload;
  }
  const attendance = Array.isArray(payload.attendance)
    ? payload.attendance.map((entry) => normalizeAttendancePayload(entry))
    : payload.attendance;
  return {
    ...payload,
    attendance,
  };
}

function normalizeAgendaPayload(payload: unknown): unknown {
  if (!isRecord(payload)) {
    return payload;
  }
  return {
    ...payload,
    item_number: normalizeOptionalString(payload.item_number),
    presenter_user_id: normalizeOptionalId(payload.presenter_user_id),
    presenter_name: normalizeOptionalString(payload.presenter_name),
    parent_item_id: normalizeOptionalId(payload.parent_item_id),
    vote_type: normalizeOptionalString(payload.vote_type),
    category: normalizeOptionalString(payload.category),
  };
}

function normalizeActionItemPayload(payload: unknown): unknown {
  if (!isRecord(payload)) {
    return payload;
  }
  return {
    ...payload,
    agenda_item_id: normalizeOptionalId(payload.agenda_item_id),
    due_date: normalizeDateOnlyValue(payload.due_date),
  };
}

function normalizeActionItemExtensionPayload(payload: unknown): unknown {
  if (!isRecord(payload)) {
    return payload;
  }
  return {
    ...payload,
    new_due_date: normalizeDateOnlyValue(payload.new_due_date),
  };
}

function normalizeAttachmentPayload(payload: unknown): unknown {
  if (!isRecord(payload)) {
    return payload;
  }
  return {
    ...payload,
    content_type: normalizeOptionalString(payload.content_type),
    uploaded_by: normalizeOptionalId(payload.uploaded_by),
  };
}

function lexSearchPageParams(params: {
  page?: number;
  per_page?: number;
}): FetchParams {
  return {
    page: params.page ?? 1,
    per_page: params.per_page ?? 25,
  };
}

function lexRegulationClauseQuery(
  params: LexUnlinkRegulationClauseParams,
): string {
  const query = new URLSearchParams({
    clause_id: params.clause_id,
    reference_type: params.reference_type,
  });
  return query.toString();
}

// Server-side filtered CSV export of the contracts report. Mirrors the active
// list filters so the download matches what the user is viewing. The backend
// (ContractHandler.ContractReport, GET /reports/contracts) reads the same query
// keys as the contracts list: status, type, risk_level, search, owner_user_id,
// department, tag, expiring_in_days, plus sort/order. expiry_from / expiry_to
// and any other keys are passed through verbatim so the export tracks future
// backend filter additions without another round-trip here.
export interface LexExportContractsReportParams {
  status?: LexContractStatus;
  type?: LexContractType;
  risk_level?: LexRiskLevel;
  search?: string;
  expiry_from?: string;
  expiry_to?: string;
  owner_user_id?: string;
  department?: string;
  tag?: string;
  expiring_in_days?: number;
  sort?: string;
  order?: "asc" | "desc";
  // Passthrough for any additional list filters not enumerated above.
  filters?: Record<string, unknown>;
}

/* ------------------------------------------------------------------ *
 * Contract approval-policy governance (Feature 5, L2).
 *
 * The version history / audit log / conflict-check / reusable-template
 * surface for the contract approval policies (`/workflow-policies/approval`).
 * These mirror the request-side governance client (`lib/lex/request-approval-
 * policies.ts`) but bind to the contract policy shape (`LexApprovalPolicy`,
 * scoped by `contract_type` rather than `request_type`). All calls unwrap the
 * `{data}` envelope. Note: template UPDATE is PATCH; conflict-check is on the
 * write tier.
 * ------------------------------------------------------------------ */

/** Immutable point-in-time snapshot of an approval policy (append-only history). */
export interface LexApprovalPolicyVersion {
  id: string;
  policy_id: string;
  tenant_id: string;
  version: number;
  snapshot: LexApprovalPolicy;
  change_reason?: string;
  created_by?: string | null;
  created_at: string;
}

export interface LexApprovalPolicyVersionsResult {
  policy_id: string;
  versions: LexApprovalPolicyVersion[];
}

export type LexApprovalPolicyAuditAction =
  | "created"
  | "updated"
  | "archived"
  | "restored"
  | "template_applied"
  | string;

/** One append-only audit record (before/after may each be null). */
export interface LexApprovalPolicyAuditEntry {
  id: string;
  tenant_id: string;
  policy_id: string;
  action: LexApprovalPolicyAuditAction;
  actor_id?: string | null;
  before?: LexApprovalPolicy | null;
  after?: LexApprovalPolicy | null;
  request_id?: string;
  created_at: string;
}

export interface LexApprovalPolicyAuditResult {
  policy_id: string;
  entries: LexApprovalPolicyAuditEntry[];
}

/** Reusable named policy definition a concrete policy can be materialised from. */
export interface LexApprovalPolicyTemplate {
  id: string;
  tenant_id: string;
  name: string;
  description: string;
  category: string;
  definition: JsonObject;
  created_by?: string | null;
  updated_by?: string | null;
  created_at: string;
  updated_at: string;
}

export interface LexCreateApprovalPolicyTemplatePayload {
  name: string;
  description?: string;
  category?: string;
  definition: JsonObject;
}

export type LexUpdateApprovalPolicyTemplatePayload =
  Partial<LexCreateApprovalPolicyTemplatePayload>;

/** Materialise a concrete policy from a template; overrides win per-field. */
export interface LexInstantiateApprovalPolicyTemplatePayload {
  overrides?: Partial<LexUpdateApprovalPolicyRequest> & {
    cleared_fields?: string[];
  };
}

/** Conflict-check body: a candidate policy + optional id to exclude (edit preview). */
export type LexApprovalPolicyConflictCheckPayload =
  LexCreateApprovalPolicyRequest & { exclude_id?: string };

/** A single active policy whose routing scope overlaps the candidate. */
export interface LexApprovalPolicyConflict {
  policy_id: string;
  name: string;
  reason: string;
  identical: boolean;
}

export interface LexApprovalPolicyConflictCheckResult {
  conflicts: LexApprovalPolicyConflict[];
  has_conflicts: boolean;
  has_identical: boolean;
}

// Builds the report query, dropping empty values and joining arrays the same way
// buildSuiteQueryParams does (repeat format is handled by the axios serializer).
function lexContractsReportQuery(
  params: LexExportContractsReportParams,
): Record<string, unknown> {
  const { filters, ...rest } = params;
  const query: Record<string, unknown> = { format: "csv" };
  const assign = (key: string, value: unknown) => {
    if (value === undefined || value === null || value === "") {
      return;
    }
    if (Array.isArray(value)) {
      if (value.length === 0) {
        return;
      }
      query[key] = value.join(",");
      return;
    }
    query[key] = value;
  };
  for (const [key, value] of Object.entries(rest)) {
    assign(key, value);
  }
  for (const [key, value] of Object.entries(filters ?? {})) {
    assign(key, value);
  }
  return query;
}

// Builds the optional severity/kind/required_only query params for the
// clause-deviation report + export endpoints (WTQ-RSK-02 #4). Empty values are
// dropped so an undefined filter is a no-op (the server returns the full report).
function lexDeviationFilterParams(
  filters?: LexDeviationFilters,
): Record<string, unknown> | undefined {
  if (!filters) {
    return undefined;
  }
  const query: Record<string, unknown> = {};
  if (filters.severity) {
    query.severity = filters.severity;
  }
  if (filters.kind) {
    query.kind = filters.kind;
  }
  if (filters.required_only !== undefined) {
    query.required_only = filters.required_only;
  }
  return query;
}

// Builds the playbook portfolio query (WTQ-RSK-02 #2), dropping empty values.
function lexPlaybookPortfolioQuery(
  params?: LexPlaybookPortfolioParams,
): Record<string, unknown> | undefined {
  if (!params) {
    return undefined;
  }
  const query: Record<string, unknown> = {};
  if (params.contract_type) {
    query.contract_type = params.contract_type;
  }
  if (params.min_score !== undefined) {
    query.min_score = params.min_score;
  }
  if (params.max_score !== undefined) {
    query.max_score = params.max_score;
  }
  if (params.order) {
    query.order = params.order;
  }
  if (params.page !== undefined) {
    query.page = params.page;
  }
  if (params.per_page !== undefined) {
    query.per_page = params.per_page;
  }
  return query;
}

function parseLexDraftingContractDraft(value: unknown): LexDraftingContractDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The AI drafting service returned an invalid contract result. Please try again.");
  }
  const draft = value as Record<string, unknown>;
  if (typeof draft.title !== "string" || !draft.title.trim() || !Array.isArray(draft.sections)) {
    throw new Error("The AI drafting service returned an invalid contract result. Please try again.");
  }
  const sections = draft.sections.map((section) => {
    if (!section || typeof section !== "object" || Array.isArray(section)) {
      throw new Error("The AI drafting service returned an invalid contract result. Please try again.");
    }
    const candidate = section as Record<string, unknown>;
    if (
      typeof candidate.heading !== "string" ||
      !candidate.heading.trim() ||
      typeof candidate.body !== "string" ||
      !candidate.body.trim()
    ) {
      throw new Error("The AI drafting service returned an invalid contract result. Please try again.");
    }
    return { heading: candidate.heading, body: candidate.body };
  });
  if (sections.length === 0) {
    throw new Error("The AI drafting service returned an invalid contract result. Please try again.");
  }
  if (
    draft.open_items != null &&
    (!Array.isArray(draft.open_items) || draft.open_items.some((item) => typeof item !== "string"))
  ) {
    throw new Error("The AI drafting service returned an invalid contract result. Please try again.");
  }
  return {
    ...(draft as unknown as LexDraftingContractDraft),
    title: draft.title,
    sections,
    open_items: (draft.open_items as string[] | null | undefined) ?? [],
  };
}

function createLexDraftingApi(
  basePath: "/api/v1/lex/drafting" | "/api/v1/watheeq/drafting",
) {
  return {
    generateClause: (
      payload: LexDraftingClauseRequest,
    ): Promise<LexDraftingGeneratedClause> =>
      apiPost<{ data: LexDraftingGeneratedClause }>(
        `${basePath}/clauses`,
        payload,
      ).then((res) => res.data),
    generateClauseStream: (
      payload: LexDraftingClauseRequest,
      handlers: AskStreamHandlers,
    ): Promise<void> => streamLexClause(basePath, payload, handlers),
    draftContract: (
      payload: LexDraftingContractRequest,
    ): Promise<LexDraftingContractDraft> =>
      apiPost<{ data: unknown }>(
        `${basePath}/contracts`,
        payload,
      ).then((res) => parseLexDraftingContractDraft(res.data)),
    rewriteClause: (
      payload: LexDraftingRewriteRequest,
    ): Promise<LexDraftingClauseRewrite> =>
      apiPost<{ data: LexDraftingClauseRewrite }>(
        `${basePath}/clauses/rewrite`,
        payload,
      ).then((res) => res.data),
    suggestClauseFallbacks: (
      payload: LexDraftingFallbackRequest,
    ): Promise<LexDraftingFallbackSet> =>
      apiPost<{ data: LexDraftingFallbackSet }>(
        `${basePath}/clauses/fallbacks`,
        payload,
      ).then((res) => res.data),
    translateText: (
      payload: LexDraftingTranslateRequest,
    ): Promise<LexDraftingTranslationResult> =>
      apiPost<{ data: LexDraftingTranslationResult }>(
        `${basePath}/translate`,
        payload,
      ).then((res) => res.data),
    summarizeContract: (
      payload: LexDraftingSummaryRequest,
    ): Promise<LexDraftingContractSummary> =>
      apiPost<{ data: LexDraftingContractSummary }>(
        `${basePath}/summary`,
        payload,
      ).then((res) => res.data),
    generateGlossary: (
      payload: LexDraftingGlossaryRequest,
    ): Promise<LexDraftingGlossaryResult> =>
      apiPost<{ data: LexDraftingGlossaryResult }>(
        `${basePath}/glossary`,
        payload,
      ).then((res) => res.data),
    assembleTemplate: (
      payload: LexDraftingAssembleRequest,
    ): Promise<LexDraftingAssemblyResult> =>
      apiPost<{ data: LexDraftingAssemblyResult }>(
        `${basePath}/assemble`,
        payload,
      ).then((res) => res.data),
    generateRfpResponse: (
      payload: LexDraftingRfpRequest,
    ): Promise<LexDraftingRfpResponse> =>
      apiPost<{ data: LexDraftingRfpResponse }>(
        `${basePath}/rfp-response`,
        payload,
      ).then((res) => res.data),
    reviewObligationExtraction: (
      payload: LexDraftingObligationQaRequest,
    ): Promise<LexDraftingObligationQaReview> =>
      apiPost<{ data: LexDraftingObligationQaReview }>(
        `${basePath}/obligations/qa-review`,
        payload,
      ).then((res) => res.data),
  };
}

function compactPayload(
  values: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(values).filter(
      ([, value]) => value !== undefined && value !== null,
    ),
  );
}

function editorMetadata(payload: {
  metadata?: JsonObject;
  source?: string;
  current_version?: number;
  return_url?: string;
  expires_at?: string;
}): JsonObject {
  const metadata: JsonObject = { ...(payload.metadata ?? {}) };
  if (payload.source) metadata.source = payload.source;
  if (payload.current_version !== undefined)
    metadata.current_version = payload.current_version;
  if (payload.return_url) metadata.return_url = payload.return_url;
  if (payload.expires_at) metadata.expires_at = payload.expires_at;
  return metadata;
}

function editorOpenPayload(
  payload: LexDocumentEditorOpenRequest,
): Record<string, unknown> {
  const options = editorMetadata(payload);
  for (const [key, value] of Object.entries(payload.options ?? {})) {
    options[key] = value;
  }
  return compactPayload({
    mode: payload.mode ?? "edit",
    provider: payload.provider ?? "onlyoffice",
    locale: payload.locale,
    user_display_name: payload.user_display_name,
    document_url: payload.document_url,
    callback_url: payload.callback_url,
    options,
  });
}

function editorLockPayload(
  payload: LexDocumentCheckOutRequest,
): Record<string, unknown> {
  return compactPayload({
    session_id: payload.session_id,
    lock_type: payload.lock_type ?? "checkout",
    reason: payload.reason,
    expires_in_seconds: payload.expires_in_seconds,
    metadata: editorMetadata(payload),
  });
}

function editorPreflightPayload(
  payload: LexDocumentPreflightRequest,
): Record<string, unknown> {
  return compactPayload({
    session_id: payload.session_id,
    status: payload.status ?? "passed",
    score: payload.score,
    blocking: payload.blocking ?? false,
    summary: payload.summary ?? "Document editor preflight requested.",
    checks: payload.checks ?? [],
    metadata: editorMetadata(payload),
  });
}

function editorSnapshotPayload(
  payload: LexDocumentVersionSnapshotRequest,
): Record<string, unknown> {
  return compactPayload({
    session_id: payload.session_id,
    change_summary: payload.change_summary,
    current_version: payload.current_version,
    source: payload.source,
    metadata: payload.metadata ?? {},
  });
}

function documentEditorPath(id: string, feature: string): string {
  return `/api/v1/lex/documents/${id}/editor/${feature}`;
}

function recordFromUnknown(
  value: unknown,
): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringFromUnknown(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeEditorPreflightResult(
  documentId: string,
  data: unknown,
): LexDocumentEditorPreflightResult {
  const root = recordFromUnknown(data) ?? {};
  const preflight = recordFromUnknown(root.preflight) ?? root;
  const rawChecks = Array.isArray(preflight.checks) ? preflight.checks : [];
  const issues: LexDocumentEditorPreflightIssue[] = rawChecks
    .map((item): LexDocumentEditorPreflightIssue | null => {
      const check = recordFromUnknown(item);
      if (!check) return null;
      const status = stringFromUnknown(check.status);
      if (status === "passed") return null;
      return {
        code: stringFromUnknown(check.key) ?? "editor_preflight",
        severity: stringFromUnknown(check.severity) ?? "warning",
        message:
          stringFromUnknown(check.message) ??
          "Editor preflight requires review.",
        metadata: recordFromUnknown(check.metadata) as JsonObject | undefined,
      };
    })
    .filter((item): item is LexDocumentEditorPreflightIssue => Boolean(item));
  const status = stringFromUnknown(preflight.status);
  const blocking = preflight.blocking === true;
  const accepted =
    root.accepted !== false && !(status === "failed" && blocking);
  return {
    document_id: documentId,
    ready: accepted && issues.length === 0,
    can_edit: accepted,
    status: !accepted
      ? "blocked"
      : issues.length > 0 || status === "warning"
        ? "needs_review"
        : (status ?? "passed"),
    issues,
    checked_at: stringFromUnknown(preflight.recorded_at),
    metadata: recordFromUnknown(preflight.metadata) as JsonObject | undefined,
  };
}

/** Ask-the-Library streaming payload (camelCase; remapped to the wire body). */
export interface LexReferenceAskStreamRequest {
  question: string;
  topK?: number;
  docIds?: string[];
}

/** Valid HTTP header-name token grammar (RFC 7230 §3.2.6). */
const VALID_HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

/**
 * Drop any entry whose name/value is empty, null/undefined, or whose name is not
 * a legal HTTP token — so `new Headers(...)` / `fetch()` can NEVER throw
 * "Failed to construct 'Headers': Invalid name". A blank/invalid auth or CSRF
 * value must silently fall through (the request degrades) rather than crash the
 * page.
 */
function sanitizeHeaders(
  raw: Record<string, string | undefined | null>,
): Record<string, string> {
  const clean: Record<string, string> = {};
  for (const [name, value] of Object.entries(raw)) {
    if (!name || !VALID_HEADER_NAME.test(name)) continue;
    if (value == null) continue;
    const trimmed = String(value).trim();
    if (trimmed === "") continue;
    clean[name] = trimmed;
  }
  return clean;
}

/**
 * Build auth/CSRF/tracing headers for the raw streaming `fetch`, mirroring the
 * axios request interceptor (Bearer token — impersonation grant first —, CSRF
 * double-submit header, and a per-request trace id) so the SSE call is
 * authenticated identically to every other API call. Every entry is passed
 * through {@link sanitizeHeaders} so a blank/malformed token or a bad
 * `CSRF_HEADER` name can never yield an invalid `Headers` construction.
 */
function buildAskStreamHeaders(): Record<string, string> {
  const token = getActiveImpersonationToken() ?? getAccessToken();
  const trimmedToken = token?.trim();
  const csrf = getCSRFToken();
  const reqId =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return sanitizeHeaders({
    "Content-Type": "application/json",
    Accept: "text/event-stream",
    Authorization: trimmedToken ? `Bearer ${trimmedToken}` : undefined,
    [CSRF_HEADER]: csrf,
    "X-Request-ID": reqId,
  });
}

/**
 * Consume the real SSE stream from `POST …/reference-library/ask/stream`,
 * driving {@link AskStreamHandlers}. Falls back to the non-streaming `ask()`
 * endpoint when the stream endpoint is not deployed (404/405), when auth needs a
 * refresh (401 — the axios pipeline retries), when the browser can't stream, or
 * on a network error. A 503 maps to the graceful "not enabled yet" state.
 */
async function askReferenceLibraryStream(
  payload: LexReferenceAskStreamRequest,
  handlers: AskStreamHandlers,
  options?: { fallbackChunkDelayMs?: number },
): Promise<void> {
  const body: LexReferenceAskPayload = {
    question: payload.question,
    top_k: payload.topK,
    doc_ids: payload.docIds,
  };
  const nonStreamAsk = () =>
    apiPost<LexReferenceAskResponse>(
      "/api/v1/lex/reference-library/ask",
      body,
    );
  const fallback = () =>
    streamFallback(nonStreamAsk, handlers, options?.fallbackChunkDelayMs);

  // The browser (or test env) can't do a fetch ReadableStream — degrade.
  if (
    typeof fetch !== "function" ||
    typeof ReadableStream === "undefined" ||
    typeof TextDecoder === "undefined"
  ) {
    await fallback();
    return;
  }

  let response: Response;
  try {
    response = await fetch(
      `${getApiUrl()}/api/v1/lex/reference-library/ask/stream`,
      {
        method: "POST",
        credentials: "same-origin",
        headers: buildAskStreamHeaders(),
        body: JSON.stringify(body),
        signal: handlers.signal,
      },
    );
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error; // user aborted — propagate so the hook leaves state alone
    }
    await fallback(); // network error → try the non-streaming endpoint
    return;
  }

  // Not deployed / auth-refresh needed → reuse the authenticated axios pipeline.
  if (
    response.status === 404 ||
    response.status === 405 ||
    response.status === 401
  ) {
    await fallback();
    return;
  }
  if (response.status === 503) {
    handlers.onError?.({ message: "second brain not configured", notConfigured: true });
    return;
  }
  if (!response.ok) {
    handlers.onError?.({
      message: `stream failed with status ${response.status}`,
      notConfigured: false,
    });
    return;
  }
  if (!response.body) {
    await fallback(); // no readable body (e.g. buffering proxy) → degrade
    return;
  }

  await readSSEStream(response.body, handlers);
}

/**
 * Consume the SSE stream from `POST …/drafting/clauses/stream`, streaming the
 * clause text word-by-word via `onToken` and delivering the assembled structured
 * clause via `onClause`. Falls back to the non-streaming `…/clauses` endpoint
 * (emitting the whole clause at once) when the stream endpoint is unavailable
 * (404/405/401), the browser can't stream, or on a network error.
 */
async function streamLexClause(
  basePath: string,
  payload: LexDraftingClauseRequest,
  handlers: AskStreamHandlers,
): Promise<void> {
  const fallback = async () => {
    try {
      const clause = await apiPost<{ data: LexDraftingGeneratedClause }>(
        `${basePath}/clauses`,
        payload,
      ).then((res) => res.data);
      handlers.onClause?.(clause as unknown as Record<string, unknown>);
      handlers.onDone?.();
    } catch (error) {
      handlers.onError?.({
        message: error instanceof Error ? error.message : "drafting failed",
        notConfigured: false,
      });
    }
  };

  if (
    typeof fetch !== "function" ||
    typeof ReadableStream === "undefined" ||
    typeof TextDecoder === "undefined"
  ) {
    await fallback();
    return;
  }

  let response: Response;
  try {
    response = await fetch(`${getApiUrl()}${basePath}/clauses/stream`, {
      method: "POST",
      credentials: "same-origin",
      headers: buildAskStreamHeaders(),
      body: JSON.stringify(payload),
      signal: handlers.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }
    await fallback();
    return;
  }

  if (
    response.status === 404 ||
    response.status === 405 ||
    response.status === 401
  ) {
    await fallback();
    return;
  }
  if (response.status === 503) {
    handlers.onError?.({
      message: "AI drafting is not enabled for this deployment",
      notConfigured: true,
    });
    return;
  }
  if (!response.ok) {
    handlers.onError?.({
      message: `stream failed with status ${response.status}`,
      notConfigured: false,
    });
    return;
  }
  if (!response.body) {
    await fallback();
    return;
  }

  await readSSEStream(response.body, handlers);
}

export const enterpriseApi = {
  users: {
    list: async (
      params: FetchParams,
    ): Promise<PaginatedResponse<UserDirectoryEntry>> => {
      const response = await apiGet<PaginatedResponse<UserDirectoryEntry>>(
        "/api/v1/users",
        {
          page: params.page,
          per_page: params.per_page,
          sort: params.sort,
          order: params.order,
          search: params.search,
          ...params.filters,
        },
      );
      return response;
    },
    listByRole: (roleSlug: string): Promise<UserDirectoryEntry[]> =>
      apiGet<UserDirectoryEntry[]>(
        `/api/v1/roles/${encodeURIComponent(roleSlug)}/users`,
      ),
  },
  files: {
    list: (params?: {
      page?: number;
      per_page?: number;
      suite?: string;
      entity_type?: string;
      entity_id?: string;
      uploaded_by?: string;
      tag?: string;
    }): Promise<PaginatedResponse<FileRecord>> =>
      apiGet<PaginatedResponse<FileRecord>>("/api/v1/files", params),
    get: (id: string): Promise<FileRecord> =>
      apiGet<FileRecord>(`/api/v1/files/${id}`),
    upload: (
      file: File,
      fields: Record<string, string>,
      onProgress?: (progress: number) => void,
    ): Promise<FileRecord> =>
      apiUpload<FileRecord>("/api/v1/files/upload", file, fields, onProgress),
    delete: (id: string): Promise<{ status: string }> =>
      apiDelete<{ status: string }>(`/api/v1/files/${id}`),
    versions: (id: string): Promise<FileRecord[]> =>
      apiGet<{ versions: FileRecord[] }>(`/api/v1/files/${id}/versions`).then(
        (res) => res.versions,
      ),
    accessLog: (
      id: string,
      params?: { page?: number; per_page?: number },
    ): Promise<PaginatedResponse<FileAccessLogEntry>> =>
      apiGet<PaginatedResponse<FileAccessLogEntry>>(
        `/api/v1/files/${id}/access-log`,
        params,
      ),
    stats: (): Promise<FileStorageStat[]> =>
      apiGet<{ storage_stats: FileStorageStat[] }>("/api/v1/files/stats").then(
        (res) => res.storage_stats,
      ),
    quarantine: (params?: {
      page?: number;
      per_page?: number;
    }): Promise<PaginatedResponse<FileQuarantineEntry>> =>
      apiGet<PaginatedResponse<FileQuarantineEntry>>(
        "/api/v1/files/quarantine",
        params,
      ),
    resolveQuarantine: (
      id: string,
      action: "deleted" | "restored" | "false_positive",
    ): Promise<{
      quarantine_id: string;
      action: string;
      resolved_by: string;
      status: string;
    }> =>
      apiPost<{
        quarantine_id: string;
        action: string;
        resolved_by: string;
        status: string;
      }>(`/api/v1/files/quarantine/${id}/resolve`, { action }),
    rescan: (id: string): Promise<{ file_id: string; status: string }> =>
      apiPost<{ file_id: string; status: string }>(
        `/api/v1/files/${id}/rescan`,
      ),
    getPresignedDownload: (id: string): Promise<FilePresignedDownload> =>
      apiGet<FilePresignedDownload>(`/api/v1/files/${id}/presigned`),
    download: async (id: string): Promise<Blob> => {
      const response = await api.get<Blob>(`/api/v1/files/${id}/download`, {
        responseType: "blob",
      });
      return response.data;
    },
  },
  acta: {
    getDashboard: (): Promise<ActaDashboard> =>
      fetchSuiteData("/api/v1/acta/dashboard"),
    listCommittees: (params: FetchParams) =>
      fetchSuitePaginated<ActaCommittee>("/api/v1/acta/committees", params),
    getCommittee: (id: string) =>
      fetchSuiteData<ActaCommittee>(`/api/v1/acta/committees/${id}`),
    createCommittee: (payload: unknown) =>
      apiPost<{ data: ActaCommittee }>(
        "/api/v1/acta/committees",
        normalizeCommitteeCreatePayload(payload),
      ).then((res) => res.data),
    updateCommittee: (id: string, payload: unknown) =>
      apiPut<{ data: ActaCommittee }>(
        `/api/v1/acta/committees/${id}`,
        normalizeCommitteePayload(payload),
      ).then((res) => res.data),
    deleteCommittee: (id: string) =>
      apiDelete<void>(`/api/v1/acta/committees/${id}`),
    addCommitteeMember: (id: string, payload: unknown) =>
      apiPost<{ data: ActaCommittee }>(
        `/api/v1/acta/committees/${id}/members`,
        payload,
      ).then((res) => res.data),
    updateCommitteeMember: (id: string, userId: string, payload: unknown) =>
      apiPut<{ data: ActaCommittee }>(
        `/api/v1/acta/committees/${id}/members/${userId}`,
        payload,
      ).then((res) => res.data),
    removeCommitteeMember: (id: string, userId: string) =>
      apiDelete<void>(`/api/v1/acta/committees/${id}/members/${userId}`),
    listMeetings: (params: FetchParams) =>
      fetchSuitePaginated<ActaMeeting>("/api/v1/acta/meetings", params),
    getMeeting: (id: string) =>
      fetchSuiteData<ActaMeeting>(`/api/v1/acta/meetings/${id}`),
    createMeeting: (payload: unknown) =>
      apiPost<{ data: ActaMeeting }>(
        "/api/v1/acta/meetings",
        normalizeMeetingPayload(payload),
      ).then((res) => res.data),
    updateMeeting: (id: string, payload: unknown) =>
      apiPut<{ data: ActaMeeting }>(
        `/api/v1/acta/meetings/${id}`,
        normalizeMeetingPayload(payload),
      ).then((res) => res.data),
    cancelMeeting: (id: string, payload: unknown) =>
      api
        .delete<{
          data: ActaMeeting;
        }>(`/api/v1/acta/meetings/${id}`, { data: payload })
        .then((res) => res.data.data),
    startMeeting: (id: string) =>
      apiPost<{ data: ActaMeeting }>(`/api/v1/acta/meetings/${id}/start`).then(
        (res) => res.data,
      ),
    endMeeting: (id: string) =>
      apiPost<{ data: ActaMeeting }>(`/api/v1/acta/meetings/${id}/end`).then(
        (res) => res.data,
      ),
    postponeMeeting: (id: string, payload: unknown) =>
      apiPost<{ data: ActaMeeting }>(
        `/api/v1/acta/meetings/${id}/postpone`,
        normalizePostponePayload(payload),
      ).then((res) => res.data),
    getUpcomingMeetings: (): Promise<ActaMeetingSummary[]> =>
      fetchSuiteData("/api/v1/acta/meetings/upcoming"),
    getCalendar: (month: string): Promise<ActaCalendarDay[]> =>
      fetchSuiteData("/api/v1/acta/meetings/calendar", { month }),
    getAttendance: (meetingId: string): Promise<ActaAttendee[]> =>
      fetchSuiteData(`/api/v1/acta/meetings/${meetingId}/attendance`),
    recordAttendance: (meetingId: string, payload: unknown) =>
      apiPost<{ data: ActaAttendee[] }>(
        `/api/v1/acta/meetings/${meetingId}/attendance`,
        normalizeAttendancePayload(payload),
      ).then((res) => res.data),
    bulkRecordAttendance: (meetingId: string, payload: unknown) =>
      apiPost<{ data: ActaAttendee[] }>(
        `/api/v1/acta/meetings/${meetingId}/attendance/bulk`,
        normalizeBulkAttendancePayload(payload),
      ).then((res) => res.data),
    listAgenda: (meetingId: string): Promise<ActaAgendaItem[]> =>
      fetchSuiteData(`/api/v1/acta/meetings/${meetingId}/agenda`),
    createAgendaItem: (meetingId: string, payload: unknown) =>
      apiPost<{ data: ActaAgendaItem }>(
        `/api/v1/acta/meetings/${meetingId}/agenda`,
        normalizeAgendaPayload(payload),
      ).then((res) => res.data),
    updateAgendaItem: (meetingId: string, itemId: string, payload: unknown) =>
      apiPut<{ data: ActaAgendaItem }>(
        `/api/v1/acta/meetings/${meetingId}/agenda/${itemId}`,
        normalizeAgendaPayload(payload),
      ).then((res) => res.data),
    deleteAgendaItem: (meetingId: string, itemId: string) =>
      apiDelete<void>(`/api/v1/acta/meetings/${meetingId}/agenda/${itemId}`),
    reorderAgenda: (meetingId: string, itemIds: string[]) =>
      apiPut<{ data: ActaAgendaItem[] }>(
        `/api/v1/acta/meetings/${meetingId}/agenda/reorder`,
        { item_ids: itemIds },
      ).then((res) => res.data),
    updateAgendaNotes: (meetingId: string, itemId: string, notes: string) =>
      apiPut<{ data: ActaAgendaItem }>(
        `/api/v1/acta/meetings/${meetingId}/agenda/${itemId}/notes`,
        { notes },
      ).then((res) => res.data),
    voteAgendaItem: (meetingId: string, itemId: string, payload: unknown) =>
      apiPost<{ data: ActaAgendaItem }>(
        `/api/v1/acta/meetings/${meetingId}/agenda/${itemId}/vote`,
        payload,
      ).then((res) => res.data),
    createMinutes: (meetingId: string, content: string) =>
      apiPost<{ data: ActaMeetingMinutes }>(
        `/api/v1/acta/meetings/${meetingId}/minutes`,
        { content },
      ).then((res) => res.data),
    getMinutes: (meetingId: string): Promise<ActaMeetingMinutes> =>
      fetchSuiteData(`/api/v1/acta/meetings/${meetingId}/minutes`),
    listMinutesVersions: (meetingId: string): Promise<ActaMeetingMinutes[]> =>
      fetchSuiteData(`/api/v1/acta/meetings/${meetingId}/minutes/versions`),
    generateMinutes: (meetingId: string) =>
      apiPost<{ data: ActaMeetingMinutes }>(
        `/api/v1/acta/meetings/${meetingId}/minutes/generate`,
      ).then((res) => res.data),
    updateMinutes: (meetingId: string, content: string) =>
      apiPut<{ data: ActaMeetingMinutes }>(
        `/api/v1/acta/meetings/${meetingId}/minutes`,
        { content },
      ).then((res) => res.data),
    submitMinutes: (meetingId: string) =>
      apiPost<{ data: ActaMeetingMinutes }>(
        `/api/v1/acta/meetings/${meetingId}/minutes/submit`,
      ).then((res) => res.data),
    requestMinutesRevision: (meetingId: string, notes: string) =>
      apiPost<{ data: ActaMeetingMinutes }>(
        `/api/v1/acta/meetings/${meetingId}/minutes/request-revision`,
        { notes },
      ).then((res) => res.data),
    approveMinutes: (meetingId: string) =>
      apiPost<{ data: ActaMeetingMinutes }>(
        `/api/v1/acta/meetings/${meetingId}/minutes/approve`,
      ).then((res) => res.data),
    publishMinutes: (meetingId: string) =>
      apiPost<{ data: ActaMeetingMinutes }>(
        `/api/v1/acta/meetings/${meetingId}/minutes/publish`,
      ).then((res) => res.data),
    listActionItems: (params: FetchParams) =>
      fetchSuitePaginated<ActaActionItem>("/api/v1/acta/action-items", params),
    getActionItem: (id: string) =>
      fetchSuiteData<ActaActionItem>(`/api/v1/acta/action-items/${id}`),
    createActionItem: (payload: unknown) =>
      apiPost<{ data: ActaActionItem }>(
        "/api/v1/acta/action-items",
        normalizeActionItemPayload(payload),
      ).then((res) => res.data),
    updateActionItem: (id: string, payload: unknown) =>
      apiPut<{ data: ActaActionItem }>(
        `/api/v1/acta/action-items/${id}`,
        normalizeActionItemPayload(payload),
      ).then((res) => res.data),
    updateActionItemStatus: (id: string, payload: unknown) =>
      apiPut<{ data: ActaActionItem }>(
        `/api/v1/acta/action-items/${id}/status`,
        payload,
      ).then((res) => res.data),
    extendActionItem: (id: string, payload: unknown) =>
      apiPost<{ data: ActaActionItem }>(
        `/api/v1/acta/action-items/${id}/extend`,
        normalizeActionItemExtensionPayload(payload),
      ).then((res) => res.data),
    listOverdueActionItems: (): Promise<ActaActionItem[]> =>
      fetchSuiteData("/api/v1/acta/action-items/overdue"),
    listMyActionItems: (): Promise<ActaActionItem[]> =>
      fetchSuiteData("/api/v1/acta/action-items/my"),
    getActionItemStats: (): Promise<ActaActionItemStats> =>
      fetchSuiteData("/api/v1/acta/action-items/stats"),
    runCompliance: (): Promise<ActaComplianceReport> =>
      fetchSuiteData("/api/v1/acta/compliance/run"),
    listComplianceResults: (params: FetchParams) =>
      fetchSuitePaginated<ActaComplianceCheck>(
        "/api/v1/acta/compliance/results",
        params,
      ),
    getComplianceReport: (): Promise<ActaComplianceReport> =>
      fetchSuiteData("/api/v1/acta/compliance/report"),
    getComplianceScore: (): Promise<{ score: number }> =>
      fetchSuiteData("/api/v1/acta/compliance/score"),
    listAttachments: (meetingId: string): Promise<ActaMeetingAttachment[]> =>
      fetchSuiteData(`/api/v1/acta/meetings/${meetingId}/attachments`),
    addAttachmentReference: (meetingId: string, payload: unknown) =>
      apiPost<{ data: ActaMeetingAttachment[] }>(
        `/api/v1/acta/meetings/${meetingId}/attachments`,
        normalizeAttachmentPayload(payload),
      ).then((res) => res.data),
    deleteAttachment: (meetingId: string, fileId: string) =>
      apiDelete<void>(
        `/api/v1/acta/meetings/${meetingId}/attachments/${fileId}`,
      ),
  },
  lex: {
    drafting: createLexDraftingApi("/api/v1/lex/drafting"),
    getDashboard: (): Promise<LexDashboard> =>
      fetchSuiteData("/api/v1/lex/dashboard"),
    listContracts: (params: FetchParams) =>
      fetchSuitePaginated<LexContractRecord>("/api/v1/lex/contracts", params),
    searchContracts: async (
      query: string,
      params: FetchParams,
    ): Promise<PaginatedResponse<LexContractSummary>> => {
      const response = await apiGet<{
        data: LexContractSummary[];
        meta: PaginatedResponse<LexContractSummary>["meta"];
      }>("/api/v1/lex/contracts/search", {
        q: query,
        page: params.page,
        per_page: params.per_page,
      });
      return {
        data: response.data,
        meta: response.meta,
      };
    },
    getContract: (id: string): Promise<LexContractDetail> =>
      fetchSuiteData(`/api/v1/lex/contracts/${id}`),
    getContractBrief: (id: string): Promise<LexContractBrief> =>
      fetchSuiteData(`/api/v1/lex/contracts/${id}/brief`),
    getContractRenewalWarnings: (params?: {
      horizon_days?: number;
      lead_days?: number;
    }): Promise<LexContractRenewalWarningSummary> =>
      fetchSuiteData("/api/v1/lex/contracts/renewal-warnings", params),
    getContractInsights: (params?: {
      /** Renewal opt-out horizon in days (server default 30, clamped 1..365). */
      window_days?: number;
      /** Draft-inactivity threshold in days (server default 30, clamped 1..365). */
      stale_days?: number;
    }): Promise<LexContractInsightsReport> =>
      fetchSuiteData("/api/v1/lex/contracts/insights", params),
    getContractStats: (): Promise<LexContractStats> =>
      fetchSuiteData("/api/v1/lex/contracts/stats"),
    exportContractsReport: async (
      params: LexExportContractsReportParams = {},
    ): Promise<Blob> => {
      const response = await api.get<Blob>("/api/v1/lex/reports/contracts", {
        params: lexContractsReportQuery(params),
        responseType: "blob",
      });
      return response.data;
    },
    getContractAnalysis: (id: string): Promise<LexContractRiskAnalysis> =>
      fetchSuiteData(`/api/v1/lex/contracts/${id}/analysis`),
    analyzeContract: (id: string) =>
      apiPost<{ data: LexContractRiskAnalysis }>(
        `/api/v1/lex/contracts/${id}/analyze`,
      ).then((res) => res.data),
    classifyContract: (
      id: string,
      payload: LexContractClassificationRequest,
    ): Promise<LexContractClassificationResult> =>
      apiPost<{ data: LexContractClassificationResult }>(
        `/api/v1/lex/contracts/${id}/classify`,
        payload,
      ).then((res) => res.data),
    createContract: (payload: unknown) =>
      apiPost<{ data: LexContractRecord }>(
        "/api/v1/lex/contracts",
        payload,
      ).then((res) => res.data),
    updateContract: (id: string, payload: unknown) =>
      apiPut<{ data: LexContractRecord }>(
        `/api/v1/lex/contracts/${id}`,
        payload,
      ).then((res) => res.data),
    deleteContract: (id: string) =>
      apiDelete<void>(`/api/v1/lex/contracts/${id}`),
    updateContractStatus: (id: string, payload: unknown) =>
      apiPut<{ data: LexContractRecord }>(
        `/api/v1/lex/contracts/${id}/status`,
        payload,
      ).then((res) => res.data),
    bulkUpdateContractStatus: (
      payload: LexContractBulkStatusRequest,
    ): Promise<LexContractBulkResult> =>
      apiPost<{ data: LexContractBulkResult }>(
        "/api/v1/lex/contracts/bulk-status",
        payload,
      ).then((res) => res.data),
    bulkAnalyzeContracts: (
      payload: LexContractBulkAnalyzeRequest,
    ): Promise<LexContractBulkResult> =>
      apiPost<{ data: LexContractBulkResult }>(
        "/api/v1/lex/contracts/bulk-analyze",
        payload,
      ).then((res) => res.data),
    uploadContractDocument: (id: string, payload: unknown) =>
      apiPost<{ data: LexContractVersion[] }>(
        `/api/v1/lex/contracts/${id}/upload`,
        payload,
      ).then((res) => res.data),
    listContractVersions: (id: string): Promise<LexContractVersion[]> =>
      fetchSuiteData(`/api/v1/lex/contracts/${id}/versions`),
    getContractRedline: (
      id: string,
      params?: { base_version?: number; target_version?: number },
    ): Promise<LexContractRedline> =>
      fetchSuiteData(`/api/v1/lex/contracts/${id}/redline`, params),
    getContractTimeline: (id: string): Promise<LexContractTimeline> =>
      fetchSuiteData(`/api/v1/lex/contracts/${id}/timeline`),
    renewContract: (id: string, payload: unknown) =>
      apiPost<{ data: LexContractRecord }>(
        `/api/v1/lex/contracts/${id}/renew`,
        payload,
      ).then((res) => res.data),
    startContractReview: (id: string, payload: LexReviewContractRequest) =>
      apiPost<{ data: LexWorkflowSummary }>(
        `/api/v1/lex/contracts/${id}/review`,
        payload,
      ).then((res) => res.data),
    listWorkflows: (params: FetchParams) =>
      fetchSuitePaginated<LexWorkflowSummary>("/api/v1/lex/workflows", params),
    listMyWorkflows: (params: FetchParams) =>
      fetchSuitePaginated<LexWorkflowSummary>("/api/v1/lex/workflows", params, { mine: true }),
    decideWorkflowTask: (
      workflowInstanceId: string,
      taskId: string,
      payload: LexWorkflowDecisionRequest,
    ): Promise<LexWorkflowDecisionResult> =>
      apiPost<{ data: LexWorkflowDecisionResult }>(
        `/api/v1/lex/workflows/${workflowInstanceId}/tasks/${taskId}/decision`,
        payload,
      ).then((res) => res.data),
    bulkDecideWorkflowTasks: (
      payload: LexWorkflowBulkDecisionRequest,
    ): Promise<LexWorkflowBulkDecisionResult> =>
      apiPost<{ data: LexWorkflowBulkDecisionResult }>(
        "/api/v1/lex/workflows/tasks/bulk-decision",
        payload,
      ).then((res) => res.data),
    listApprovalPolicies: (): Promise<LexApprovalPolicy[]> =>
      fetchSuiteData("/api/v1/lex/workflow-policies/approval"),
    getApprovalPolicyAnalytics: (): Promise<LexApprovalPolicyAnalytics> =>
      fetchSuiteData("/api/v1/lex/workflow-policies/approval/analytics"),
    createApprovalPolicy: (
      payload: LexCreateApprovalPolicyRequest,
    ): Promise<LexApprovalPolicy> =>
      apiPost<{ data: LexApprovalPolicy }>(
        "/api/v1/lex/workflow-policies/approval",
        payload,
      ).then((res) => res.data),
    updateApprovalPolicy: (
      id: string,
      payload: LexUpdateApprovalPolicyRequest,
    ): Promise<LexApprovalPolicy> =>
      apiPatch<{ data: LexApprovalPolicy }>(
        `/api/v1/lex/workflow-policies/approval/${id}`,
        payload,
      ).then((res) => res.data),
    archiveApprovalPolicy: (id: string): Promise<void> =>
      apiDelete<void>(`/api/v1/lex/workflow-policies/approval/${id}`),
    recommendApprovalPolicy: (
      contractId: string,
    ): Promise<LexApprovalPolicyRecommendationResult> =>
      fetchSuiteData("/api/v1/lex/workflow-policies/approval/recommend", {
        contract_id: contractId,
      }),
    // --- Governance: version history + audit log (Feature 5, L2) ---
    listApprovalPolicyVersions: (
      id: string,
    ): Promise<LexApprovalPolicyVersionsResult> =>
      fetchSuiteData(`/api/v1/lex/workflow-policies/approval/${id}/versions`),
    getApprovalPolicyVersion: (
      id: string,
      version: number,
    ): Promise<LexApprovalPolicyVersion> =>
      fetchSuiteData(
        `/api/v1/lex/workflow-policies/approval/${id}/versions/${version}`,
      ),
    restoreApprovalPolicyVersion: (
      id: string,
      version: number,
    ): Promise<LexApprovalPolicy> =>
      apiPost<{ data: LexApprovalPolicy }>(
        `/api/v1/lex/workflow-policies/approval/${id}/versions/${version}/restore`,
        {},
      ).then((res) => res.data),
    listApprovalPolicyAudit: (
      id: string,
    ): Promise<LexApprovalPolicyAuditResult> =>
      fetchSuiteData(`/api/v1/lex/workflow-policies/approval/${id}/audit`),
    // --- Governance: conflict-check (write tier) ---
    conflictCheckApprovalPolicy: (
      payload: LexApprovalPolicyConflictCheckPayload,
    ): Promise<LexApprovalPolicyConflictCheckResult> =>
      apiPost<{ data: LexApprovalPolicyConflictCheckResult }>(
        "/api/v1/lex/workflow-policies/approval/conflict-check",
        payload,
      ).then((res) => res.data),
    // --- Governance: reusable templates ---
    listApprovalPolicyTemplates: (): Promise<LexApprovalPolicyTemplate[]> =>
      fetchSuiteData("/api/v1/lex/workflow-policies/approval/templates"),
    getApprovalPolicyTemplate: (
      id: string,
    ): Promise<LexApprovalPolicyTemplate> =>
      fetchSuiteData(`/api/v1/lex/workflow-policies/approval/templates/${id}`),
    createApprovalPolicyTemplate: (
      payload: LexCreateApprovalPolicyTemplatePayload,
    ): Promise<LexApprovalPolicyTemplate> =>
      apiPost<{ data: LexApprovalPolicyTemplate }>(
        "/api/v1/lex/workflow-policies/approval/templates",
        payload,
      ).then((res) => res.data),
    // Template UPDATE is PATCH (not PUT) — matches the backend route.
    updateApprovalPolicyTemplate: (
      id: string,
      payload: LexUpdateApprovalPolicyTemplatePayload,
    ): Promise<LexApprovalPolicyTemplate> =>
      apiPatch<{ data: LexApprovalPolicyTemplate }>(
        `/api/v1/lex/workflow-policies/approval/templates/${id}`,
        payload,
      ).then((res) => res.data),
    deleteApprovalPolicyTemplate: (id: string): Promise<void> =>
      apiDelete<void>(
        `/api/v1/lex/workflow-policies/approval/templates/${id}`,
      ),
    instantiateApprovalPolicyTemplate: (
      id: string,
      payload: LexInstantiateApprovalPolicyTemplatePayload,
    ): Promise<LexApprovalPolicy> =>
      apiPost<{ data: LexApprovalPolicy }>(
        `/api/v1/lex/workflow-policies/approval/templates/${id}/instantiate`,
        payload,
      ).then((res) => res.data),
    listContractClauses: (id: string): Promise<LexClause[]> =>
      fetchSuiteData(`/api/v1/lex/contracts/${id}/clauses`),
    getClause: (contractId: string, clauseId: string): Promise<LexClause> =>
      fetchSuiteData(`/api/v1/lex/contracts/${contractId}/clauses/${clauseId}`),
    listClauseRiskSummary: (contractId: string): Promise<LexClause[]> =>
      fetchSuiteData(`/api/v1/lex/contracts/${contractId}/clauses/risks`),
    updateClauseReview: (
      contractId: string,
      clauseId: string,
      payload: unknown,
    ) =>
      apiPut<{ data: LexClause }>(
        `/api/v1/lex/contracts/${contractId}/clauses/${clauseId}/review`,
        payload,
      ).then((res) => res.data),
    listDocuments: (params: FetchParams) =>
      fetchSuitePaginated<LexDocument>("/api/v1/lex/documents", params),
    getDocumentRepositorySummary: (): Promise<LexDocumentRepositorySummary> =>
      fetchSuiteData("/api/v1/lex/documents/repository-summary"),
    bulkImportDocuments: (
      payload: unknown,
    ): Promise<LexDocumentBulkImportResult> =>
      apiPost<{ data: LexDocumentBulkImportResult }>(
        "/api/v1/lex/documents/bulk-import",
        payload,
      ).then((res) => res.data),
    createDocument: (payload: unknown) =>
      apiPost<{ data: LexDocument }>("/api/v1/lex/documents", payload).then(
        (res) => res.data,
      ),
    getDocument: (id: string): Promise<LexDocument> =>
      fetchSuiteData(`/api/v1/lex/documents/${id}`),
    updateDocument: (id: string, payload: unknown) =>
      apiPut<{ data: LexDocument }>(
        `/api/v1/lex/documents/${id}`,
        payload,
      ).then((res) => res.data),
    deleteDocument: (id: string) =>
      apiDelete<void>(`/api/v1/lex/documents/${id}`),
    listDocumentVersions: (id: string): Promise<LexDocumentVersion[]> =>
      fetchSuiteData(`/api/v1/lex/documents/${id}/versions`),
    getDocumentEditorSession: (id: string): Promise<LexDocumentEditorSession> =>
      apiPost<{ data: LexDocumentEditorSession }>(
        `/api/v1/lex/documents/${id}/editor/session`,
        editorOpenPayload({ mode: "view" }),
      ).then((res) => res.data),
    openDocumentEditor: (
      id: string,
      payload: LexDocumentEditorOpenRequest = {},
    ): Promise<LexDocumentEditorSession> =>
      apiPost<{ data: LexDocumentEditorSession }>(
        `/api/v1/lex/documents/${id}/editor/session`,
        editorOpenPayload(payload),
      ).then((res) => res.data),
    checkOutDocument: (
      id: string,
      payload: LexDocumentCheckOutRequest = {},
    ): Promise<LexDocumentEditorLock> =>
      apiPost<{ data: LexDocumentEditorLock }>(
        `/api/v1/lex/documents/${id}/editor/lock`,
        editorLockPayload(payload),
      ).then((res) => res.data),
    releaseDocumentLock: (
      id: string,
      payload: unknown = {},
    ): Promise<LexDocumentEditorLock> =>
      api
        .delete<{
          data: LexDocumentEditorLock;
        }>(`/api/v1/lex/documents/${id}/editor/lock`, { data: payload })
        .then((res) => res.data.data),
    runDocumentPreflight: (
      id: string,
      payload: LexDocumentPreflightRequest = {},
    ): Promise<LexDocumentEditorPreflightResult> =>
      apiPost<{ data: unknown }>(
        `/api/v1/lex/documents/${id}/editor/preflight`,
        editorPreflightPayload(payload),
      ).then((res) => normalizeEditorPreflightResult(id, res.data)),
    createDocumentVersionSnapshot: (
      id: string,
      payload: LexDocumentVersionSnapshotRequest = {},
    ): Promise<LexDocumentVersionSnapshot> =>
      apiPost<{ data: LexDocumentVersionSnapshot }>(
        `/api/v1/lex/documents/${id}/editor/snapshot`,
        editorSnapshotPayload(payload),
      ).then((res) => res.data),
    listDocumentAudit: (id: string): Promise<LexDocumentAuditEntry[]> =>
      fetchSuiteData(`/api/v1/lex/documents/${id}/editor/audit`),
    getDocumentNegotiationRoom: (
      id: string,
    ): Promise<LexDocumentNegotiationRoom> =>
      fetchSuiteData(documentEditorPath(id, "negotiation-room")),
    upsertDocumentNegotiationRoom: (
      id: string,
      payload: LexUpsertDocumentNegotiationRoomRequest,
    ): Promise<LexDocumentNegotiationRoom> =>
      apiPut<{ data: LexDocumentNegotiationRoom }>(
        documentEditorPath(id, "negotiation-room"),
        payload,
      ).then((res) => res.data),
    addDocumentNegotiationMessage: (
      id: string,
      payload: LexDocumentNegotiationMessageRequest,
    ): Promise<LexDocumentNegotiationMessage> =>
      apiPost<{ data: LexDocumentNegotiationMessage }>(
        `${documentEditorPath(id, "negotiation-room")}/messages`,
        payload,
      ).then((res) => res.data),
    getDocumentPlaybookEnforcement: (
      id: string,
    ): Promise<LexDocumentPlaybookEnforcement> =>
      fetchSuiteData(documentEditorPath(id, "playbook-enforcement")),
    runDocumentPlaybookEnforcement: (
      id: string,
      payload: LexRunDocumentPlaybookEnforcementRequest = {},
    ): Promise<LexDocumentPlaybookEnforcement> =>
      apiPost<{ data: LexDocumentPlaybookEnforcement }>(
        documentEditorPath(id, "playbook-enforcement"),
        payload,
      ).then((res) => res.data),
    getDocumentTermsCrossReferences: (
      id: string,
    ): Promise<LexDocumentTermsCrossReferences> =>
      fetchSuiteData(documentEditorPath(id, "terms-cross-references")),
    analyzeDocumentTermsCrossReferences: (
      id: string,
      payload: LexAnalyzeDocumentTermsCrossReferencesRequest = {},
    ): Promise<LexDocumentTermsCrossReferences> =>
      apiPost<{ data: LexDocumentTermsCrossReferences }>(
        documentEditorPath(id, "terms-cross-references"),
        payload,
      ).then((res) => res.data),
    listDocumentSectionAssignments: (
      id: string,
    ): Promise<LexDocumentSectionAssignment[]> =>
      fetchSuiteData(documentEditorPath(id, "section-assignments")),
    upsertDocumentSectionAssignments: (
      id: string,
      payload: LexUpsertDocumentSectionAssignmentRequest,
    ): Promise<LexDocumentSectionAssignment[]> =>
      apiPut<{ data: LexDocumentSectionAssignment[] }>(
        documentEditorPath(id, "section-assignments"),
        payload,
      ).then((res) => res.data),
    listDocumentGuestReviewLinks: (
      id: string,
    ): Promise<LexDocumentGuestReviewLink[]> =>
      fetchSuiteData(documentEditorPath(id, "guest-review-links")),
    createDocumentGuestReviewLink: (
      id: string,
      payload: LexCreateDocumentGuestReviewLinkRequest,
    ): Promise<LexDocumentGuestReviewLink> =>
      apiPost<{ data: LexDocumentGuestReviewLink }>(
        documentEditorPath(id, "guest-review-links"),
        payload,
      ).then((res) => res.data),
    revokeDocumentGuestReviewLink: (
      id: string,
      linkId: string,
      payload: LexRevokeDocumentGuestReviewLinkRequest = {},
    ): Promise<LexDocumentGuestReviewLink> =>
      api
        .delete<{
          data: LexDocumentGuestReviewLink;
        }>(
          `${documentEditorPath(id, "guest-review-links")}/${encodeURIComponent(linkId)}`,
          { data: payload },
        )
        .then((res) => res.data.data),
    listDocumentLegalIssues: (id: string): Promise<LexDocumentLegalIssue[]> =>
      fetchSuiteData(documentEditorPath(id, "legal-issues")),
    createDocumentLegalIssue: (
      id: string,
      payload: LexCreateDocumentLegalIssueRequest,
    ): Promise<LexDocumentLegalIssue> =>
      apiPost<{ data: LexDocumentLegalIssue }>(
        documentEditorPath(id, "legal-issues"),
        payload,
      ).then((res) => res.data),
    updateDocumentLegalIssue: (
      id: string,
      issueId: string,
      payload: LexUpdateDocumentLegalIssueRequest,
    ): Promise<LexDocumentLegalIssue> =>
      apiPatch<{ data: LexDocumentLegalIssue }>(
        `${documentEditorPath(id, "legal-issues")}/${encodeURIComponent(issueId)}`,
        payload,
      ).then((res) => res.data),
    resolveDocumentLegalIssue: (
      id: string,
      issueId: string,
      payload: LexUpdateDocumentLegalIssueRequest = {},
    ): Promise<LexDocumentLegalIssue> =>
      apiPost<{ data: LexDocumentLegalIssue }>(
        `${documentEditorPath(id, "legal-issues")}/${encodeURIComponent(issueId)}/resolve`,
        payload,
      ).then((res) => res.data),
    getDocumentSignatureReadiness: (
      id: string,
    ): Promise<LexDocumentSignatureReadiness> =>
      fetchSuiteData(documentEditorPath(id, "signature-readiness")),
    runDocumentSignatureReadiness: (
      id: string,
      payload: LexRunDocumentSignatureReadinessRequest = {},
    ): Promise<LexDocumentSignatureReadiness> =>
      apiPost<{ data: LexDocumentSignatureReadiness }>(
        documentEditorPath(id, "signature-readiness"),
        payload,
      ).then((res) => res.data),
    runDocumentClauseAIAction: (
      id: string,
      payload: LexDocumentClauseAIActionRequest,
    ): Promise<LexDocumentClauseAIActionResult> =>
      apiPost<{ data: LexDocumentClauseAIActionResult }>(
        documentEditorPath(id, "clause-ai-actions"),
        payload,
      ).then((res) => res.data),
    getDocumentHealthScore: (id: string): Promise<LexDocumentHealthScore> =>
      fetchSuiteData(documentEditorPath(id, "health-score")),
    refreshDocumentHealthScore: (
      id: string,
      payload: LexRefreshDocumentHealthScoreRequest = {},
    ): Promise<LexDocumentHealthScore> =>
      apiPost<{ data: LexDocumentHealthScore }>(
        documentEditorPath(id, "health-score"),
        payload,
      ).then((res) => res.data),
    getDocumentPrivilegedControls: (
      id: string,
    ): Promise<LexDocumentPrivilegedControls> =>
      fetchSuiteData(documentEditorPath(id, "privileged-controls")),
    updateDocumentPrivilegedControls: (
      id: string,
      payload: LexUpdateDocumentPrivilegedControlsRequest,
    ): Promise<LexDocumentPrivilegedControls> =>
      apiPut<{ data: LexDocumentPrivilegedControls }>(
        documentEditorPath(id, "privileged-controls"),
        payload,
      ).then((res) => res.data),
    listDocumentProviderEvents: (
      id: string,
    ): Promise<LexDocumentProviderEvent[]> =>
      fetchSuiteData(documentEditorPath(id, "provider-events")),
    recordDocumentProviderEvent: (
      id: string,
      payload: LexRecordDocumentProviderEventRequest,
    ): Promise<LexDocumentProviderEvent> =>
      apiPost<{ data: LexDocumentProviderEvent }>(
        documentEditorPath(id, "provider-events"),
        payload,
      ).then((res) => res.data),
    getDocumentGuestPortalStatus: (
      id: string,
    ): Promise<LexDocumentGuestPortalStatus> =>
      fetchSuiteData(documentEditorPath(id, "guest-portal")),
    refreshDocumentGuestPortalStatus: (
      id: string,
      payload: LexDocumentEditorFeatureRequestBase & { link_id?: string } = {},
    ): Promise<LexDocumentGuestPortalStatus> =>
      apiPost<{ data: LexDocumentGuestPortalStatus }>(
        payload.link_id
          ? `${documentEditorPath(id, "guest-review-links")}/${encodeURIComponent(payload.link_id)}/portal/validate`
          : documentEditorPath(id, "guest-portal"),
        payload,
      ).then((res) => res.data),
    listDocumentAutomationTasks: (
      id: string,
    ): Promise<LexDocumentAutomationTask[]> =>
      fetchSuiteData(documentEditorPath(id, "tasks")),
    createDocumentAutomationTask: (
      id: string,
      payload: LexCreateDocumentAutomationTaskRequest,
    ): Promise<LexDocumentAutomationTask> =>
      apiPost<{ data: LexDocumentAutomationTask }>(
        documentEditorPath(id, "tasks"),
        payload,
      ).then((res) => res.data),
    updateDocumentAutomationTask: (
      id: string,
      taskId: string,
      payload: LexUpdateDocumentAutomationTaskRequest,
    ): Promise<LexDocumentAutomationTask> =>
      apiPatch<{ data: LexDocumentAutomationTask }>(
        `${documentEditorPath(id, "tasks")}/${encodeURIComponent(taskId)}`,
        payload,
      ).then((res) => res.data),
    listDocumentClauseAnchors: (
      id: string,
    ): Promise<LexDocumentClauseAnchor[]> =>
      fetchSuiteData(documentEditorPath(id, "clause-anchors")),
    extractDocumentClauseAnchors: (
      id: string,
      payload: LexExtractDocumentClauseAnchorsRequest = {},
    ): Promise<LexDocumentClauseAnchor[]> =>
      apiPut<{ data: LexDocumentClauseAnchor[] }>(
        documentEditorPath(id, "clause-anchors"),
        payload,
      ).then((res) => res.data),
    listDocumentRedlinePackages: (
      id: string,
    ): Promise<LexDocumentRedlinePackage[]> =>
      fetchSuiteData(documentEditorPath(id, "redline-packages")),
    generateDocumentRedlinePackage: (
      id: string,
      payload: LexGenerateDocumentRedlinePackageRequest = {},
    ): Promise<LexDocumentRedlinePackage> =>
      apiPost<{ data: LexDocumentRedlinePackage }>(
        documentEditorPath(id, "redline-packages"),
        payload,
      ).then((res) => res.data),
    getDocumentApprovalMatrix: (
      id: string,
    ): Promise<LexDocumentApprovalMatrix> =>
      fetchSuiteData(documentEditorPath(id, "approval-matrix")),
    requestDocumentApproval: (
      id: string,
      payload: LexRequestDocumentApprovalRequest = {},
    ): Promise<LexDocumentApprovalMatrix> =>
      apiPost<{ data: LexDocumentApprovalMatrix }>(
        documentEditorPath(id, "approval-matrix/requests"),
        payload,
      ).then((res) => res.data),
    getDocumentCompareWorkspace: (
      id: string,
    ): Promise<LexDocumentCompareWorkspace> =>
      fetchSuiteData(documentEditorPath(id, "compare-workspace")),
    runDocumentCompare: (
      id: string,
      payload: LexRunDocumentCompareRequest = {},
    ): Promise<LexDocumentCompareWorkspace> =>
      apiPost<{ data: LexDocumentCompareWorkspace }>(
        documentEditorPath(id, "compare"),
        payload,
      ).then((res) => res.data),
    getDocumentCollaborationInbox: (
      id: string,
    ): Promise<LexDocumentCollaborationInbox> =>
      fetchSuiteData(documentEditorPath(id, "collaboration-inbox")),
    markDocumentCollaborationInboxItemRead: (
      id: string,
      itemId: string,
      payload: LexDocumentEditorFeatureRequestBase = {},
    ): Promise<LexDocumentCollaborationInbox> =>
      apiPost<{ data: LexDocumentCollaborationInbox }>(
        `${documentEditorPath(id, "collaboration-inbox")}/${encodeURIComponent(itemId)}/read`,
        payload,
      ).then((res) => res.data),
    listDocumentPlaybookRuleLinks: (
      id: string,
    ): Promise<LexDocumentPlaybookRuleLink[]> =>
      fetchSuiteData(documentEditorPath(id, "playbook-rules")),
    createDocumentPlaybookRuleLink: (
      id: string,
      payload: LexCreateDocumentPlaybookRuleLinkRequest = {},
    ): Promise<LexDocumentPlaybookRuleLink> =>
      apiPut<{ data: LexDocumentPlaybookRuleLink }>(
        documentEditorPath(id, "playbook-rules"),
        payload,
      ).then((res) => res.data),
    listDocumentDefinedTermRepairs: (
      id: string,
    ): Promise<LexDocumentDefinedTermRepairAction[]> =>
      fetchSuiteData(documentEditorPath(id, "term-repairs")),
    applyDocumentDefinedTermRepair: (
      id: string,
      payload: LexApplyDocumentDefinedTermRepairRequest,
    ): Promise<LexDocumentDefinedTermRepairAction> =>
      apiPost<{ data: LexDocumentDefinedTermRepairAction }>(
        documentEditorPath(id, "terms-cross-references/repair"),
        payload,
      ).then((res) => res.data),
    listDocumentEvidenceBindings: (
      id: string,
    ): Promise<LexDocumentEvidenceBinding[]> =>
      fetchSuiteData(documentEditorPath(id, "evidence-bindings")),
    createDocumentEvidenceBinding: (
      id: string,
      payload: LexCreateDocumentEvidenceBindingRequest,
    ): Promise<LexDocumentEvidenceBinding> =>
      apiPost<{ data: LexDocumentEvidenceBinding }>(
        documentEditorPath(id, "citations"),
        payload,
      ).then((res) => res.data),
    getDocumentAIChangeSafety: (
      id: string,
    ): Promise<LexDocumentAIChangeSafety> =>
      fetchSuiteData(documentEditorPath(id, "ai-change-safety")),
    updateDocumentAIChangeSafety: (
      id: string,
      payload: LexUpdateDocumentAIChangeSafetyRequest,
    ): Promise<LexDocumentAIChangeSafety> =>
      apiPost<{ data: LexDocumentAIChangeSafety }>(
        documentEditorPath(id, "ai-change-safety"),
        payload,
      ).then((res) => res.data),
    getDocumentOfflineRecoveryState: (
      id: string,
    ): Promise<LexDocumentOfflineRecoveryState> =>
      fetchSuiteData(documentEditorPath(id, "offline-recovery")),
    saveDocumentOfflineRecoveryState: (
      id: string,
      payload: LexSaveDocumentOfflineRecoveryRequest = {},
    ): Promise<LexDocumentOfflineRecoveryState> =>
      apiPost<{ data: LexDocumentOfflineRecoveryState }>(
        documentEditorPath(id, "offline-recovery"),
        payload,
      ).then((res) => res.data),
    getDocumentEditorAnalytics: (
      id: string,
    ): Promise<LexDocumentEditorAnalytics> =>
      fetchSuiteData(documentEditorPath(id, "analytics")),
    recordDocumentEditorProviderEvent: (
      id: string,
      payload: LexRecordDocumentProviderEventRequest,
    ): Promise<LexDocumentProviderEvent> =>
      apiPost<{ data: LexDocumentProviderEvent }>(
        documentEditorPath(id, "provider-events"),
        payload,
      ).then((res) => res.data),
    getDocumentGuestPortal: (token: string): Promise<LexDocumentGuestPortalStatus> =>
      fetchSuiteData(`/api/v1/lex/editor/guest-portal/${encodeURIComponent(token)}`),
    openDocumentGuestPortalSession: (
      token: string,
      payload: Record<string, unknown> = {},
    ): Promise<LexDocumentGuestPortalStatus> =>
      apiPost<{ data: LexDocumentGuestPortalStatus }>(
        `/api/v1/lex/editor/guest-portal/${encodeURIComponent(token)}/session`,
        payload,
      ).then((res) => res.data),
    addDocumentGuestPortalComment: (
      token: string,
      payload: Record<string, unknown>,
    ): Promise<LexDocumentCollaborationInbox> =>
      apiPost<{ data: LexDocumentCollaborationInbox }>(
        `/api/v1/lex/editor/guest-portal/${encodeURIComponent(token)}/comments`,
        payload,
      ).then((res) => res.data),
    createDocumentEditorTask: (
      id: string,
      payload: Record<string, unknown>,
    ): Promise<LexDocumentAutomationTask> =>
      apiPost<{ data: LexDocumentAutomationTask }>(
        documentEditorPath(id, "tasks"),
        payload,
      ).then((res) => res.data),
    compareDocumentEditorVersions: (
      id: string,
      payload: Record<string, unknown> = {},
    ): Promise<LexDocumentCompareWorkspace> =>
      apiPost<{ data: LexDocumentCompareWorkspace }>(
        documentEditorPath(id, "compare"),
        payload,
      ).then((res) => res.data),
    updateDocumentApprovalMatrix: (
      id: string,
      payload: Record<string, unknown>,
    ): Promise<LexDocumentApprovalMatrix> =>
      apiPut<{ data: LexDocumentApprovalMatrix }>(
        documentEditorPath(id, "approval-matrix"),
        payload,
      ).then((res) => res.data),
    requestDocumentEditorApproval: (
      id: string,
      payload: Record<string, unknown> = {},
    ): Promise<LexDocumentApprovalMatrix> =>
      apiPost<{ data: LexDocumentApprovalMatrix }>(
        documentEditorPath(id, "approval-requests"),
        payload,
      ).then((res) => res.data),
    requestDocumentAIChangeSafety: (
      id: string,
      payload: Record<string, unknown>,
    ): Promise<LexDocumentAIChangeSafety> =>
      apiPost<{ data: LexDocumentAIChangeSafety }>(
        documentEditorPath(id, "ai-change-safety"),
        payload,
      ).then((res) => res.data),
    listDocumentPlaybookRules: (
      id: string,
    ): Promise<LexDocumentPlaybookRuleLink[]> =>
      fetchSuiteData(documentEditorPath(id, "playbook-rules")),
    updateDocumentPlaybookRules: (
      id: string,
      payload: Record<string, unknown>,
    ): Promise<LexDocumentPlaybookRuleLink[]> =>
      apiPut<{ data: LexDocumentPlaybookRuleLink[] }>(
        documentEditorPath(id, "playbook-rules"),
        payload,
      ).then((res) => res.data),
    repairDocumentDefinedTerms: (
      id: string,
      payload: Record<string, unknown>,
    ): Promise<LexDocumentDefinedTermRepairAction[]> =>
      apiPost<{ data: LexDocumentDefinedTermRepairAction[] }>(
        documentEditorPath(id, "term-repairs"),
        payload,
      ).then((res) => res.data),
    listDocumentCitationBindings: (
      id: string,
    ): Promise<LexDocumentEvidenceBinding[]> =>
      fetchSuiteData(documentEditorPath(id, "citation-bindings")),
    createDocumentCitationBinding: (
      id: string,
      payload: Record<string, unknown>,
    ): Promise<LexDocumentEvidenceBinding> =>
      apiPost<{ data: LexDocumentEvidenceBinding }>(
        documentEditorPath(id, "citation-bindings"),
        payload,
      ).then((res) => res.data),
    restoreDocumentOfflineRecoveryState: (
      id: string,
      payload: Record<string, unknown>,
    ): Promise<LexDocumentOfflineRecoveryState> =>
      apiPost<{ data: LexDocumentOfflineRecoveryState }>(
        `${documentEditorPath(id, "offline-recovery")}/restore`,
        payload,
      ).then((res) => res.data),
    searchDocuments: (
      body: {
        query: string;
        type?: string;
        status?: string;
        confidentiality?: string;
        category?: string;
      },
      page = 1,
      perPage = 25,
    ): Promise<PaginatedResponse<LexDocumentSearchHit>> =>
      apiPost<PaginatedResponse<LexDocumentSearchHit>>(
        `/api/v1/lex/documents/search?page=${page}&per_page=${perPage}`,
        body,
      ),
    uploadDocumentVersion: (id: string, payload: unknown) =>
      apiPost<{ data: LexDocumentVersion[] }>(
        `/api/v1/lex/documents/${id}/upload`,
        payload,
      ).then((res) => res.data),
    listMatters: (params: FetchParams) =>
      fetchSuitePaginated<LexMatter>("/api/v1/lex/matters", params),
    getMatter: (id: string): Promise<LexMatter> =>
      fetchSuiteData(`/api/v1/lex/matters/${id}`),
    createMatter: (payload: LexCreateMatterPayload): Promise<LexMatter> =>
      apiPost<{ data: LexMatter }>("/api/v1/lex/matters", payload).then(
        (res) => res.data,
      ),
    updateMatter: (
      id: string,
      payload: LexUpdateMatterPayload,
    ): Promise<LexMatter> =>
      apiPut<{ data: LexMatter }>(`/api/v1/lex/matters/${id}`, payload).then(
        (res) => res.data,
      ),
    updateMatterStatus: (
      id: string,
      payload: LexUpdateMatterStatusPayload,
    ): Promise<LexMatter> =>
      apiPut<{ data: LexMatter }>(
        `/api/v1/lex/matters/${id}/status`,
        payload,
      ).then((res) => res.data),
    triageMatter: (
      id: string,
      payload: LexTriageMatterPayload,
    ): Promise<LexMatter> =>
      apiPost<{ data: LexMatter }>(
        `/api/v1/lex/matters/${id}/triage`,
        payload,
      ).then((res) => res.data),
    linkMatterContract: (
      id: string,
      payload: LexLinkMatterContractPayload,
    ): Promise<LexMatterContract> =>
      apiPost<{ data: LexMatterContract }>(
        `/api/v1/lex/matters/${id}/contracts`,
        payload,
      ).then((res) => res.data),
    unlinkMatterContract: (id: string, contractId: string) =>
      apiDelete<void>(`/api/v1/lex/matters/${id}/contracts/${contractId}`),
    deleteMatter: (id: string) => apiDelete<void>(`/api/v1/lex/matters/${id}`),
    checkMatterConflict: (
      payload: LexMatterConflictCheckRequest,
    ): Promise<LexMatterConflictCheckResult> =>
      apiPost<{ data: LexMatterConflictCheckResult }>(
        "/api/v1/lex/matters/conflict-check",
        payload,
      ).then((res) => res.data),
    getMatterTimeline: (matterId: string): Promise<LexCaseTimeline> =>
      fetchSuiteData(`/api/v1/lex/matters/${matterId}/timeline`),
    updateMatterTimeline: (
      matterId: string,
      payload: LexUpdateMatterTimelinePayload,
    ): Promise<LexCaseTimeline> =>
      apiPut<{ data: LexCaseTimeline }>(
        `/api/v1/lex/matters/${matterId}/timeline`,
        payload,
      ).then((res) => res.data),
    setMatterExternalHold: (
      matterId: string,
      payload: LexSetExternalHoldPayload,
    ): Promise<LexCaseTimeline> =>
      apiPost<{ data: LexCaseTimeline }>(
        `/api/v1/lex/matters/${matterId}/timeline/external-hold`,
        payload,
      ).then((res) => res.data),
    listMatterTimelineSummaries: (
      params?: LexMatterTimelineSummaryParams,
    ): Promise<LexMatterTimelineSummary[]> =>
      fetchSuiteData<LexMatterTimelineSummary[]>(
        "/api/v1/lex/matters/timelines",
        params as Record<string, unknown> | undefined,
      ),
    // --- Matter comments (FEATURE 10) ---
    listMatterComments: (matterId: string): Promise<LexMatterComment[]> =>
      fetchSuiteData<LexMatterComment[]>(
        `/api/v1/lex/matters/${matterId}/comments`,
      ),
    addMatterComment: (
      matterId: string,
      payload: LexCreateMatterCommentPayload,
    ): Promise<LexMatterComment> =>
      apiPost<{ data: LexMatterComment }>(
        `/api/v1/lex/matters/${matterId}/comments`,
        payload,
      ).then((res) => res.data),
    updateMatterComment: (
      matterId: string,
      commentId: string,
      payload: LexUpdateMatterCommentPayload,
    ): Promise<LexMatterComment> =>
      apiPut<{ data: LexMatterComment }>(
        `/api/v1/lex/matters/${matterId}/comments/${commentId}`,
        payload,
      ).then((res) => res.data),
    deleteMatterComment: (matterId: string, commentId: string) =>
      apiDelete<void>(`/api/v1/lex/matters/${matterId}/comments/${commentId}`),
    // --- Matter document links (FEATURE 5) ---
    listMatterDocuments: (matterId: string): Promise<LexMatterDocumentLink[]> =>
      fetchSuiteData<LexMatterDocumentLink[]>(
        `/api/v1/lex/matters/${matterId}/documents`,
      ),
    addMatterDocument: (
      matterId: string,
      payload: LexCreateMatterDocumentLinkPayload,
    ): Promise<LexMatterDocumentLink> =>
      apiPost<{ data: LexMatterDocumentLink }>(
        `/api/v1/lex/matters/${matterId}/documents`,
        payload,
      ).then((res) => res.data),
    removeMatterDocument: (matterId: string, linkId: string) =>
      apiDelete<void>(`/api/v1/lex/matters/${matterId}/documents/${linkId}`),
    // --- Matter audit / activity feed (FEATURE 7) ---
    listMatterAudit: (
      matterId: string,
      params?: Record<string, unknown>,
    ): Promise<LexMatterAuditEntry[]> =>
      fetchSuiteData<LexMatterAuditEntry[]>(
        `/api/v1/lex/matters/${matterId}/audit`,
        params,
      ),
    // --- Matter cross-domain related links (FEATURE 9) ---
    listMatterRelated: (matterId: string): Promise<LexMatterLink[]> =>
      fetchSuiteData<LexMatterLink[]>(
        `/api/v1/lex/matters/${matterId}/related`,
      ),
    addMatterRelated: (
      matterId: string,
      payload: LexCreateMatterLinkPayload,
    ): Promise<LexMatterLink> =>
      apiPost<{ data: LexMatterLink }>(
        `/api/v1/lex/matters/${matterId}/related`,
        payload,
      ).then((res) => res.data),
    removeMatterRelated: (matterId: string, linkId: string) =>
      apiDelete<void>(`/api/v1/lex/matters/${matterId}/related/${linkId}`),
    listObligations: (params: FetchParams) =>
      fetchSuitePaginated<LexObligation>("/api/v1/lex/obligations", params),
    getObligation: (id: string): Promise<LexObligation> =>
      fetchSuiteData(`/api/v1/lex/obligations/${id}`),
    createObligation: (
      payload: LexCreateObligationPayload,
    ): Promise<LexObligation> =>
      apiPost<{ data: LexObligation }>("/api/v1/lex/obligations", payload).then(
        (res) => res.data,
      ),
    updateObligation: (
      id: string,
      payload: LexUpdateObligationPayload,
    ): Promise<LexObligation> =>
      apiPut<{ data: LexObligation }>(
        `/api/v1/lex/obligations/${id}`,
        payload,
      ).then((res) => res.data),
    updateObligationStatus: (
      id: string,
      payload: LexUpdateObligationStatusPayload,
    ): Promise<LexObligation> =>
      apiPut<{ data: LexObligation }>(
        `/api/v1/lex/obligations/${id}/status`,
        payload,
      ).then((res) => res.data),
    deleteObligation: (id: string) =>
      apiDelete<void>(`/api/v1/lex/obligations/${id}`),
    listContractObligations: (contractId: string, params: FetchParams) =>
      fetchSuitePaginated<LexObligation>(
        `/api/v1/lex/contracts/${contractId}/obligations`,
        params,
      ),
    listMatterObligations: (matterId: string, params: FetchParams) =>
      fetchSuitePaginated<LexObligation>(
        `/api/v1/lex/matters/${matterId}/obligations`,
        params,
      ),
    extractContractObligations: (
      contractId: string,
      payload: LexExtractObligationsPayload,
    ): Promise<LexObligationExtractionResult> =>
      apiPost<{ data: LexObligationExtractionResult }>(
        `/api/v1/lex/contracts/${contractId}/obligations/extract`,
        payload,
      ).then((res) => res.data),
    getObligationReminderPlan: (params?: {
      as_of?: string;
      horizon_days?: number;
      include_escalations?: boolean;
    }): Promise<LexObligationReminderPlan> =>
      fetchSuiteData("/api/v1/lex/obligations/reminders", params),
    enqueueObligationReminders: (
      payload?: LexEnqueueObligationRemindersPayload,
    ): Promise<LexObligationReminderEnqueueResult> =>
      apiPost<{ data: LexObligationReminderEnqueueResult }>(
        "/api/v1/lex/obligations/reminders/enqueue",
        payload,
      ).then((res) => res.data),
    markObligationReminderSent: (
      id: string,
      payload?: LexMarkObligationReminderSentPayload,
    ): Promise<LexObligation> =>
      apiPost<{ data: LexObligation }>(
        `/api/v1/lex/obligations/${id}/reminders/sent`,
        payload,
      ).then((res) => res.data),
    markObligationReminderDelivery: (
      outboxId: string,
      payload: LexMarkObligationReminderDeliveryPayload,
    ): Promise<LexObligationNotificationOutboxItem> =>
      apiPost<{ data: LexObligationNotificationOutboxItem }>(
        `/api/v1/lex/obligations/reminders/outbox/${outboxId}/delivery`,
        payload,
      ).then((res) => res.data),
    listClauseLibrary: (params: FetchParams) =>
      fetchSuitePaginated<LexClauseLibraryEntry>(
        "/api/v1/lex/clause-library",
        params,
      ),
    searchClauseLibrary: (
      params: LexClauseLibrarySearchParams,
    ): Promise<PaginatedResponse<LexClauseLibrarySearchResult>> =>
      fetchSuitePaginated<LexClauseLibrarySearchResult>(
        "/api/v1/lex/clause-library/search",
        lexSearchPageParams(params),
        {
          q: params.q ?? params.query,
          clause_type: params.clause_type,
          category: params.category,
          jurisdiction: params.jurisdiction,
          status: params.status,
          governance_status: params.governance_status,
          risk_level: params.risk_level,
          language: params.language,
          semantic: params.semantic,
        },
      ),
    getClauseLibraryEntry: (id: string): Promise<LexClauseLibraryEntry> =>
      fetchSuiteData(`/api/v1/lex/clause-library/${id}`),
    createClauseLibraryEntry: (
      payload: LexCreateClauseLibraryEntryPayload,
    ): Promise<LexClauseLibraryEntry> =>
      apiPost<{ data: LexClauseLibraryEntry }>(
        "/api/v1/lex/clause-library",
        payload,
      ).then((res) => res.data),
    updateClauseLibraryEntry: (
      id: string,
      payload: LexUpdateClauseLibraryEntryPayload,
    ): Promise<LexClauseLibraryEntry> =>
      apiPut<{ data: LexClauseLibraryEntry }>(
        `/api/v1/lex/clause-library/${id}`,
        payload,
      ).then((res) => res.data),
    deleteClauseLibraryEntry: (id: string) =>
      apiDelete<void>(`/api/v1/lex/clause-library/${id}`),
    decideClauseLibraryGovernance: (
      id: string,
      payload: LexGovernanceDecisionRequest,
    ): Promise<LexClauseLibraryEntry> =>
      apiPost<{ data: LexClauseLibraryEntry }>(
        `/api/v1/lex/clause-library/${id}/governance`,
        payload,
      ).then((res) => res.data),
    listPlaybooks: (params: FetchParams) =>
      fetchSuitePaginated<LexClausePlaybook>("/api/v1/lex/playbooks", params),
    getPlaybook: (id: string): Promise<LexClausePlaybook> =>
      fetchSuiteData(`/api/v1/lex/playbooks/${id}`),
    createPlaybook: (
      payload: LexCreatePlaybookPayload,
    ): Promise<LexClausePlaybook> =>
      apiPost<{ data: LexClausePlaybook }>(
        "/api/v1/lex/playbooks",
        payload,
      ).then((res) => res.data),
    updatePlaybook: (
      id: string,
      payload: LexUpdatePlaybookPayload,
    ): Promise<LexClausePlaybook> =>
      apiPut<{ data: LexClausePlaybook }>(
        `/api/v1/lex/playbooks/${id}`,
        payload,
      ).then((res) => res.data),
    deletePlaybook: (id: string) =>
      apiDelete<void>(`/api/v1/lex/playbooks/${id}`),
    // WTQ-RSK-02 #4: optional severity/kind/required_only filters narrow the
    // returned deviations list (the whole-report counts/score stay full-report).
    // Backward-compatible: zero-arg callers still work.
    getContractClauseDeviations: (
      id: string,
      filters?: LexDeviationFilters,
    ): Promise<LexClauseDeviationReport> =>
      fetchSuiteData(
        `/api/v1/lex/contracts/${id}/clause-deviations`,
        lexDeviationFilterParams(filters),
      ),
    // WTQ-RSK-02 #4: CSV export of the deviation report, honouring the same
    // severity/kind/required_only filters as the JSON endpoint. Returns a Blob the
    // caller can hand to a download helper (filename in Content-Disposition).
    exportContractClauseDeviations: async (
      id: string,
      filters?: LexDeviationFilters,
    ): Promise<Blob> => {
      const response = await api.get<Blob>(
        `/api/v1/lex/contracts/${id}/clause-deviations/export`,
        {
          params: { format: "csv", ...lexDeviationFilterParams(filters) },
          responseType: "blob",
        },
      );
      return response.data;
    },
    // WTQ-RSK-02 #3: per-clause-type deviation triage dispositions on a contract.
    listDeviationReviews: (contractId: string): Promise<LexDeviationReview[]> =>
      fetchSuiteData(
        `/api/v1/lex/contracts/${contractId}/clause-deviations/reviews`,
      ),
    upsertDeviationReview: (
      contractId: string,
      clauseType: string,
      payload: LexUpsertDeviationReviewPayload,
    ): Promise<LexDeviationReview> =>
      apiPut<{ data: LexDeviationReview }>(
        `/api/v1/lex/contracts/${contractId}/clause-deviations/reviews/${encodeURIComponent(clauseType)}`,
        payload,
      ).then((res) => res.data),
    // WTQ-RSK-02 #2: per-contract compliance portfolio. Non-standard envelope
    // {data,page,per_page,total,truncated}; `truncated` flags a capped candidate scan.
    getPlaybookPortfolio: (
      params?: LexPlaybookPortfolioParams,
    ): Promise<LexPlaybookPortfolioResult> =>
      fetchSuiteData<LexPlaybookPortfolioResult>(
        "/api/v1/lex/playbooks/portfolio",
        lexPlaybookPortfolioQuery(params),
      ),
    // WTQ-RSK-02 #8: dry-run a draft/edited (or saved-by-id) playbook against a
    // contract without it being the active playbook. Persists nothing.
    dryRunPlaybook: (
      payload: LexDryRunPlaybookPayload,
    ): Promise<LexClauseDeviationReport> =>
      apiPost<{ data: LexClauseDeviationReport }>(
        "/api/v1/lex/playbooks/dry-run",
        payload,
      ).then((res) => res.data),
    // WTQ-RSK-02 #7: static playbook template library + clone-into-DRAFT.
    listPlaybookTemplates: (): Promise<LexPlaybookTemplate[]> =>
      fetchSuiteData("/api/v1/lex/playbooks/templates"),
    clonePlaybookTemplate: (
      key: string,
      payload?: LexClonePlaybookPayload,
    ): Promise<LexClausePlaybook> =>
      apiPost<{ data: LexClausePlaybook }>(
        `/api/v1/lex/playbooks/templates/${encodeURIComponent(key)}/clone`,
        payload ?? {},
      ).then((res) => res.data),
    clonePlaybook: (
      id: string,
      payload?: LexClonePlaybookPayload,
    ): Promise<LexClausePlaybook> =>
      apiPost<{ data: LexClausePlaybook }>(
        `/api/v1/lex/playbooks/${id}/clone`,
        payload ?? {},
      ).then((res) => res.data),
    // WTQ-RSK-02 #9: gate a DRAFT playbook through the shared approval orchestrator
    // before it becomes active. Tasks are workflow HumanTasks; the decision body is
    // the shared LexWorkflowDecisionRequest (dto.WorkflowDecisionRequest).
    startPlaybookApproval: (id: string): Promise<unknown> =>
      apiPost<{ data: unknown }>(
        `/api/v1/lex/playbooks/${id}/approval/start`,
      ).then((res) => res.data),
    listPlaybookApprovalTasks: (id: string): Promise<HumanTask[]> =>
      fetchSuiteData(`/api/v1/lex/playbooks/${id}/approval/tasks`),
    decidePlaybookApproval: (
      id: string,
      workflowInstanceId: string,
      taskId: string,
      payload: LexWorkflowDecisionRequest,
    ): Promise<unknown> =>
      apiPost<{ data: unknown }>(
        `/api/v1/lex/playbooks/${id}/approval/${workflowInstanceId}/tasks/${taskId}/decision`,
        payload,
      ).then((res) => res.data),
    listRegulations: (params: FetchParams) =>
      fetchSuitePaginated<LexRegulation>("/api/v1/lex/regulations", params),
    searchRegulations: (
      params: LexRegulationSearchParams,
    ): Promise<PaginatedResponse<LexRegulationSearchResult>> =>
      fetchSuitePaginated<LexRegulationSearchResult>(
        "/api/v1/lex/regulations/search",
        lexSearchPageParams(params),
        {
          q: params.q ?? params.query,
          jurisdiction: params.jurisdiction,
          authority: params.authority,
          regulation_type: params.regulation_type,
          status: params.status,
          risk_level: params.risk_level,
          language: params.language,
          semantic: params.semantic,
        },
      ),
    getRegulation: (id: string): Promise<LexRegulation> =>
      fetchSuiteData(`/api/v1/lex/regulations/${id}`),
    createRegulation: (
      payload: LexCreateRegulationPayload,
    ): Promise<LexRegulation> =>
      apiPost<{ data: LexRegulation }>("/api/v1/lex/regulations", payload).then(
        (res) => res.data,
      ),
    updateRegulation: (
      id: string,
      payload: LexUpdateRegulationPayload,
    ): Promise<LexRegulation> =>
      apiPut<{ data: LexRegulation }>(
        `/api/v1/lex/regulations/${id}`,
        payload,
      ).then((res) => res.data),
    deleteRegulation: (id: string) =>
      apiDelete<void>(`/api/v1/lex/regulations/${id}`),
    decideRegulationGovernance: (
      id: string,
      payload: LexGovernanceDecisionRequest,
    ): Promise<LexRegulation> =>
      apiPost<{ data: LexRegulation }>(
        `/api/v1/lex/regulations/${id}/governance`,
        payload,
      ).then((res) => res.data),
    linkRegulationClause: (
      id: string,
      payload: LexLinkRegulationClausePayload,
    ): Promise<LexRegulationClauseReference> =>
      apiPost<{ data: LexRegulationClauseReference }>(
        `/api/v1/lex/regulations/${id}/clauses`,
        payload,
      ).then((res) => res.data),
    unlinkRegulationClause: (
      id: string,
      params: LexUnlinkRegulationClauseParams,
    ) =>
      apiDelete<void>(
        `/api/v1/lex/regulations/${id}/clauses?${lexRegulationClauseQuery(params)}`,
      ),
    // WatheeqTech Reference Library — read-only, cross-tenant Saudi legal corpus.
    // Base `/api/v1/lex/reference-library` (also dual-prefixed under
    // `/api/v1/watheeq`). See docs/ClarioWatheeq/WatheeqTech_Library_Design.md §6.
    referenceLibrary: {
      // List/filter. The catalog endpoint takes `q` (not `search`) plus flat
      // `category`/`doc_type`/`tag` params, so remap the table's FetchParams
      // explicitly rather than passing them through the generic `search` key.
      list: (params: FetchParams): Promise<PaginatedResponse<LexReferenceDocument>> => {
        const filters = params.filters ?? {};
        const first = (value: string | string[] | undefined): string | undefined =>
          Array.isArray(value) ? value[0] : value || undefined;
        return fetchSuitePaginated<LexReferenceDocument>(
          "/api/v1/lex/reference-library",
          {
            page: params.page,
            per_page: params.per_page,
            sort: params.sort,
            order: params.order,
          },
          {
            q: params.search || undefined,
            category: first(filters.category),
            doc_type: first(filters.doc_type),
            tag: first(filters.tag),
          },
        );
      },
      facets: (): Promise<LexReferenceLibraryFacets> =>
        fetchSuiteData("/api/v1/lex/reference-library/facets"),
      get: (id: string): Promise<LexReferenceDocument> =>
        fetchSuiteData(`/api/v1/lex/reference-library/${id}`),
      // Streams application/pdf — fetched as a Blob so the caller can feed a
      // URL.createObjectURL(...) to the inline viewer (renders inline despite the
      // server's Content-Disposition: attachment).
      download: async (id: string): Promise<Blob> => {
        const response = await api.get<Blob>(
          `/api/v1/lex/reference-library/${id}/download`,
          { responseType: "blob" },
        );
        return response.data;
      },
      // Contents/semantic search ("Second Brain"). Returns ranked hits with a
      // snippet; the `{data}` envelope is unwrapped to the hit array.
      search: (q: string, topK?: number): Promise<LexReferenceSearchHit[]> =>
        apiGet<{ data: LexReferenceSearchHit[] }>(
          "/api/v1/lex/reference-library/search",
          { q, top_k: topK },
        ).then((res) => res.data),
      // Grounded Q&A over the corpus ("Second Brain"). May 503 when the AI
      // runtime is not yet configured — callers degrade gracefully.
      ask: ({
        question,
        topK,
        docIds,
      }: {
        question: string;
        topK?: number;
        docIds?: string[];
      }): Promise<LexReferenceAskResponse> =>
        apiPost<LexReferenceAskResponse>("/api/v1/lex/reference-library/ask", {
          question,
          top_k: topK,
          doc_ids: docIds,
        } satisfies LexReferenceAskPayload),
      // True token-streaming Q&A over the corpus. Consumes the SSE endpoint
      // (event: meta|token|citations|error|done) and drives the handlers live;
      // gracefully falls back to the non-streaming `ask()` above when the stream
      // endpoint is not deployed or the browser can't stream. See
      // reference-library-stream.ts for the wire contract + parsing.
      askStream: (
        payload: LexReferenceAskStreamRequest,
        handlers: AskStreamHandlers,
        options?: { fallbackChunkDelayMs?: number },
      ): Promise<void> => askReferenceLibraryStream(payload, handlers, options),
      // Article/مادة table of contents for a document. The `{data}` envelope is
      // unwrapped to the article array; a 404 (endpoint not deployed) or empty
      // list degrades the viewer's article panel to hidden — never fabricated.
      articles: (id: string): Promise<LexReferenceArticle[]> =>
        apiGet<{ data: LexReferenceArticle[] }>(
          `/api/v1/lex/reference-library/${id}/articles`,
        ).then((res) => res.data ?? []),
      // Thumbs up/down feedback on an answer. Fire-and-forget from the caller's
      // side (failures are swallowed at the UI) so it never blocks the reader.
      askFeedback: (
        payload: LexReferenceAskFeedbackPayload,
      ): Promise<void> =>
        apiPost<void>(
          "/api/v1/lex/reference-library/ask/feedback",
          payload,
        ),
    },
    listSignatures: (params: FetchParams) =>
      fetchSuitePaginated<LexSignatureEnvelope>(
        "/api/v1/lex/signatures",
        params,
      ),
    getSignature: (id: string): Promise<LexSignatureEnvelope> =>
      fetchSuiteData(`/api/v1/lex/signatures/${id}`),
    getMySignatureProfile: (): Promise<LexSignatureUserProfile | null> =>
      fetchSuiteData<LexSignatureUserProfile | null>(
        "/api/v1/lex/signatures/me/profile",
      ),
    upsertMySignatureProfile: (
      payload: LexUpsertSignatureUserProfilePayload,
    ): Promise<LexSignatureUserProfile> =>
      apiPut<{ data: LexSignatureUserProfile }>(
        "/api/v1/lex/signatures/me/profile",
        payload,
      ).then((res) => res.data),
    deleteMySignatureProfile: (): Promise<void> =>
      apiDelete<void>("/api/v1/lex/signatures/me/profile"),
    getSignatureRecipientRendering: (
      id: string,
      recipientId: string,
    ): Promise<LexRenderedSignatureText> =>
      fetchSuiteData(
        `/api/v1/lex/signatures/${id}/recipients/${recipientId}/rendering`,
      ),
    createSignature: (
      payload: LexCreateSignatureEnvelopePayload,
    ): Promise<LexSignatureEnvelope> =>
      apiPost<{ data: LexSignatureEnvelope }>(
        "/api/v1/lex/signatures",
        payload,
      ).then((res) => res.data),
    sendSignature: (
      id: string,
      payload?: unknown,
    ): Promise<LexSignatureEnvelope> =>
      apiPost<{ data: LexSignatureEnvelope }>(
        `/api/v1/lex/signatures/${id}/send`,
        payload,
      ).then((res) => res.data),
    cancelSignature: (
      id: string,
      payload?: { reason?: string | null },
    ): Promise<LexSignatureEnvelope> =>
      apiPost<{ data: LexSignatureEnvelope }>(
        `/api/v1/lex/signatures/${id}/cancel`,
        payload,
      ).then((res) => res.data),
    updateSignaturePlacements: (
      id: string,
      payload: LexUpsertSignaturePlacementsPayload,
    ): Promise<LexSignatureEnvelope> =>
      apiPut<{ data: LexSignatureEnvelope }>(
        `/api/v1/lex/signatures/${id}/placements`,
        payload,
      ).then((res) => res.data),
    recordSignatureRecipientAction: (
      id: string,
      payload: LexSignatureRecipientActionPayload,
    ): Promise<LexSignatureEnvelope> =>
      apiPost<{ data: LexSignatureEnvelope }>(
        `/api/v1/lex/signatures/${id}/recipients/${payload.recipient_id}/actions`,
        payload,
      ).then((res) => res.data),
    recordSelfSignatureRecipientAction: (
      id: string,
      payload: LexSignatureRecipientActionPayload,
    ): Promise<LexSignatureEnvelope> =>
      apiPost<{ data: LexSignatureEnvelope }>(
        `/api/v1/lex/signatures/${id}/recipients/${payload.recipient_id}/self-actions`,
        payload,
      ).then((res) => res.data),
    recordSignatureProviderEvent: (
      id: string,
      payload: LexSignatureProviderEventPayload,
    ): Promise<LexSignatureEnvelope> =>
      apiPost<{ data: LexSignatureEnvelope }>(
        `/api/v1/lex/signatures/${id}/provider-events`,
        payload,
      ).then((res) => res.data),
    recordSignatureCustody: (
      id: string,
      payload: LexRecordSignatureCustodyPayload,
    ): Promise<LexSignatureEnvelope> =>
      apiPost<{ data: LexSignatureEnvelope }>(
        `/api/v1/lex/signatures/${id}/custody`,
        payload,
      ).then((res) => res.data),
    listComplianceRules: (params: FetchParams) =>
      fetchSuitePaginated<LexComplianceRule>(
        "/api/v1/lex/compliance/rules",
        params,
      ),
    createComplianceRule: (payload: unknown) =>
      apiPost<{ data: LexComplianceRule }>(
        "/api/v1/lex/compliance/rules",
        payload,
      ).then((res) => res.data),
    updateComplianceRule: (id: string, payload: unknown) =>
      apiPut<{ data: LexComplianceRule }>(
        `/api/v1/lex/compliance/rules/${id}`,
        payload,
      ).then((res) => res.data),
    deleteComplianceRule: (id: string) =>
      apiDelete<void>(`/api/v1/lex/compliance/rules/${id}`),
    runCompliance: (payload: unknown) =>
      apiPost<{ data: LexComplianceRunResult }>(
        "/api/v1/lex/compliance/run",
        payload,
      ).then((res) => res.data),
    listComplianceAlerts: (params: FetchParams) =>
      fetchSuitePaginated<LexComplianceAlert>(
        "/api/v1/lex/compliance/alerts",
        params,
      ),
    getComplianceAlert: (id: string): Promise<LexComplianceAlert> =>
      fetchSuiteData(`/api/v1/lex/compliance/alerts/${id}`),
    updateComplianceAlertStatus: (id: string, payload: unknown) =>
      apiPut<{ data: LexComplianceAlert }>(
        `/api/v1/lex/compliance/alerts/${id}/status`,
        payload,
      ).then((res) => res.data),
    getComplianceDashboard: (): Promise<LexComplianceDashboard> =>
      fetchSuiteData("/api/v1/lex/compliance/dashboard"),
    getComplianceScore: (): Promise<LexComplianceScore> =>
      fetchSuiteData("/api/v1/lex/compliance/score"),
    getExpiringContracts: (
      days?: number,
    ): Promise<LexExpiringContractSummary[]> =>
      fetchSuiteData(
        "/api/v1/lex/contracts/expiring",
        days ? { horizon_days: days } : undefined,
      ),
    getContractReport: (params: FetchParams): Promise<LexContractReport> =>
      fetchSuiteData(
        "/api/v1/lex/reports/contracts",
        buildSuiteQueryParams(params),
      ),
    getMatterReport: (params: FetchParams): Promise<LexMatterReport> =>
      fetchSuiteData(
        "/api/v1/lex/reports/matters",
        buildSuiteQueryParams(params),
      ),
    getObligationReport: (params: FetchParams): Promise<LexObligationReport> =>
      fetchSuiteData(
        "/api/v1/lex/reports/obligations",
        buildSuiteQueryParams(params),
      ),
    getResolutionRates: (): Promise<LexResolutionRateReport> =>
      fetchSuiteData("/api/v1/lex/reports/resolution-rates"),
    exportContractReportCsv: (params: FetchParams): Promise<Blob> =>
      api
        .get<Blob>("/api/v1/lex/reports/contracts", {
          params: { ...buildSuiteQueryParams(params), format: "csv" },
          responseType: "blob",
        })
        .then((res) => res.data),
    exportContractReportXlsx: (params: FetchParams): Promise<Blob> =>
      api
        .get<Blob>("/api/v1/lex/reports/contracts", {
          params: { ...buildSuiteQueryParams(params), format: "xlsx" },
          responseType: "blob",
        })
        .then((res) => res.data),
    exportMatterReportCsv: (params: FetchParams): Promise<Blob> =>
      api
        .get<Blob>("/api/v1/lex/reports/matters", {
          params: { ...buildSuiteQueryParams(params), format: "csv" },
          responseType: "blob",
        })
        .then((res) => res.data),
    exportMatterReportXlsx: (params: FetchParams): Promise<Blob> =>
      api
        .get<Blob>("/api/v1/lex/reports/matters", {
          params: { ...buildSuiteQueryParams(params), format: "xlsx" },
          responseType: "blob",
        })
        .then((res) => res.data),
    exportObligationReportCsv: (params: FetchParams): Promise<Blob> =>
      api
        .get<Blob>("/api/v1/lex/reports/obligations", {
          params: { ...buildSuiteQueryParams(params), format: "csv" },
          responseType: "blob",
        })
        .then((res) => res.data),
    exportObligationReportXlsx: (params: FetchParams): Promise<Blob> =>
      api
        .get<Blob>("/api/v1/lex/reports/obligations", {
          params: { ...buildSuiteQueryParams(params), format: "xlsx" },
          responseType: "blob",
        })
        .then((res) => res.data),
    dispatchObligationReminderOutbox: (
      payload?: LexDispatchObligationReminderOutboxPayload,
    ): Promise<LexObligationReminderDispatchResult> =>
      apiPost<{ data: LexObligationReminderDispatchResult }>(
        "/api/v1/lex/obligations/reminders/outbox/dispatch",
        payload,
      ).then((res) => res.data),
    dispatchObligationReminderOutboxItem: (
      outboxId: string,
      payload?: LexDispatchObligationReminderOutboxPayload,
    ): Promise<LexObligationReminderDispatchResult> =>
      apiPost<{ data: LexObligationReminderDispatchResult }>(
        `/api/v1/lex/obligations/reminders/outbox/${outboxId}/dispatch`,
        payload,
      ).then((res) => res.data),
  },
  watheeq: {
    drafting: createLexDraftingApi("/api/v1/watheeq/drafting"),
  },
  visus: {
    listDashboards: (params: FetchParams) =>
      fetchSuitePaginated<VisusDashboard>("/api/v1/visus/dashboards", params),
    getDashboard: (id: string): Promise<VisusDashboard> =>
      fetchSuiteData(`/api/v1/visus/dashboards/${id}`),
    createDashboard: (payload: unknown) =>
      apiPost<{ data: VisusDashboard }>(
        "/api/v1/visus/dashboards",
        payload,
      ).then((res) => res.data),
    updateDashboard: (id: string, payload: unknown) =>
      apiPut<{ data: VisusDashboard }>(
        `/api/v1/visus/dashboards/${id}`,
        payload,
      ).then((res) => res.data),
    deleteDashboard: (id: string) =>
      apiDelete<void>(`/api/v1/visus/dashboards/${id}`),
    duplicateDashboard: (id: string) =>
      apiPost<{ data: VisusDashboard }>(
        `/api/v1/visus/dashboards/${id}/duplicate`,
      ).then((res) => res.data),
    shareDashboard: (id: string, payload: unknown) =>
      apiPut<{ data: VisusDashboard }>(
        `/api/v1/visus/dashboards/${id}/share`,
        payload,
      ).then((res) => res.data),
    listWidgets: (dashboardId: string): Promise<VisusWidget[]> =>
      fetchSuiteData(`/api/v1/visus/dashboards/${dashboardId}/widgets`),
    createWidget: (dashboardId: string, payload: unknown) =>
      apiPost<{ data: VisusWidget }>(
        `/api/v1/visus/dashboards/${dashboardId}/widgets`,
        payload,
      ).then((res) => res.data),
    updateWidget: (dashboardId: string, widgetId: string, payload: unknown) =>
      apiPut<{ data: VisusWidget }>(
        `/api/v1/visus/dashboards/${dashboardId}/widgets/${widgetId}`,
        payload,
      ).then((res) => res.data),
    deleteWidget: (dashboardId: string, widgetId: string) =>
      apiDelete<void>(
        `/api/v1/visus/dashboards/${dashboardId}/widgets/${widgetId}`,
      ),
    updateWidgetLayout: (
      dashboardId: string,
      positions: Array<{
        widget_id: string;
        x: number;
        y: number;
        w: number;
        h: number;
      }>,
    ) =>
      apiPut<{ data: { updated: number } }>(
        `/api/v1/visus/dashboards/${dashboardId}/widgets/layout`,
        { positions },
      ).then((res) => res.data),
    getWidgetData: (
      dashboardId: string,
      widgetId: string,
    ): Promise<VisusWidgetData> =>
      fetchSuiteData(
        `/api/v1/visus/dashboards/${dashboardId}/widgets/${widgetId}/data`,
      ),
    listWidgetTypes: (): Promise<VisusWidgetTypeDefinition[]> =>
      fetchSuiteData("/api/v1/visus/widgets/types"),
    listKpis: (params: FetchParams) =>
      fetchSuitePaginated<VisusKPIDefinition>("/api/v1/visus/kpis", params),
    getKpi: (id: string): Promise<VisusKPIGetResponse> =>
      fetchSuiteData(`/api/v1/visus/kpis/${id}`),
    getKpiHistory: (
      id: string,
      params?: { start?: string; end?: string; per_page?: number },
    ): Promise<VisusKPISnapshot[]> =>
      fetchSuiteData(`/api/v1/visus/kpis/${id}/history`, params),
    createKpi: (payload: unknown) =>
      apiPost<{ data: VisusKPIDefinition }>("/api/v1/visus/kpis", payload).then(
        (res) => res.data,
      ),
    updateKpi: (id: string, payload: unknown) =>
      apiPut<{ data: VisusKPIDefinition }>(
        `/api/v1/visus/kpis/${id}`,
        payload,
      ).then((res) => res.data),
    deleteKpi: (id: string) => apiDelete<void>(`/api/v1/visus/kpis/${id}`),
    triggerKpiSnapshot: () =>
      apiPost<{ data: { status: string } }>("/api/v1/visus/kpis/snapshot").then(
        (res) => res.data,
      ),
    listReports: (params: FetchParams) =>
      fetchSuitePaginated<VisusReportDefinition>(
        "/api/v1/visus/reports",
        params,
      ),
    getReport: (id: string): Promise<VisusReportDefinition> =>
      fetchSuiteData(`/api/v1/visus/reports/${id}`),
    createReport: (payload: unknown) =>
      apiPost<{ data: VisusReportDefinition }>(
        "/api/v1/visus/reports",
        payload,
      ).then((res) => res.data),
    updateReport: (id: string, payload: unknown) =>
      apiPut<{ data: VisusReportDefinition }>(
        `/api/v1/visus/reports/${id}`,
        payload,
      ).then((res) => res.data),
    deleteReport: (id: string) =>
      apiDelete<void>(`/api/v1/visus/reports/${id}`),
    generateReport: (id: string) =>
      apiPost<{ data: VisusReportSnapshot }>(
        `/api/v1/visus/reports/${id}/generate`,
      ).then((res) => res.data),
    listReportSnapshots: (id: string): Promise<VisusReportSnapshot[]> =>
      fetchSuiteData(`/api/v1/visus/reports/${id}/snapshots`),
    getLatestReportSnapshot: (id: string): Promise<VisusReportSnapshot> =>
      fetchSuiteData(`/api/v1/visus/reports/${id}/snapshots/latest`),
    getReportSnapshot: (
      id: string,
      snapshotId: string,
    ): Promise<VisusReportSnapshot> =>
      fetchSuiteData(`/api/v1/visus/reports/${id}/snapshots/${snapshotId}`),
    listAlerts: (params: FetchParams) =>
      fetchSuitePaginated<VisusExecutiveAlert>("/api/v1/visus/alerts", params),
    getAlert: (id: string): Promise<VisusExecutiveAlert> =>
      fetchSuiteData(`/api/v1/visus/alerts/${id}`),
    updateAlertStatus: (id: string, payload: unknown) =>
      apiPut<{ data: VisusExecutiveAlert }>(
        `/api/v1/visus/alerts/${id}/status`,
        payload,
      ).then((res) => res.data),
    getAlertCount: (): Promise<{ count: number }> =>
      fetchSuiteData("/api/v1/visus/alerts/count"),
    getAlertStats: (): Promise<VisusAlertStats> =>
      fetchSuiteData("/api/v1/visus/alerts/stats"),
    getWidgetStats: (): Promise<Record<string, number>> =>
      fetchSuiteData("/api/v1/visus/widgets/stats"),
    getExecutiveView: (): Promise<VisusExecutiveSummary> =>
      fetchSuiteData("/api/v1/visus/executive"),
    getCTIOverview: (): Promise<VisusCTIOverview> =>
      fetchSuiteData("/api/v1/visus/cti/overview"),
    getCTIThreatMap: (period: string): Promise<VisusCTIThreatMapResponse> =>
      fetchSuiteData("/api/v1/visus/cti/threat-map", { period }),
    getCTISectors: (period: string): Promise<VisusCTISectorResponse> =>
      fetchSuiteData("/api/v1/visus/cti/sectors", { period }),
    getCTICampaigns: (limit = 5): Promise<VisusCTICampaignListResponse> =>
      fetchSuiteData("/api/v1/visus/cti/campaigns", { limit }),
    getCTIBrandAbuse: (limit = 5): Promise<VisusCTIBrandAbuseListResponse> =>
      fetchSuiteData("/api/v1/visus/cti/brand-abuse", { limit }),
    getCTIRiskScore: (): Promise<VisusCTIRiskScoreResponse> =>
      fetchSuiteData("/api/v1/visus/cti/risk-score"),
  },
  ai: {
    getDashboard: (): Promise<AIDashboardData> =>
      fetchSuiteData("/api/v1/ai/dashboard"),
    listModels: (params: FetchParams) =>
      fetchSuitePaginated<AIModelWithVersions>("/api/v1/ai/models", params),
    createModel: (
      payload: AIRegisterModelPayload,
    ): Promise<AIRegisteredModel> =>
      apiPost<{ data: AIRegisteredModel }>("/api/v1/ai/models", payload).then(
        (res) => res.data,
      ),
    getModel: (id: string): Promise<AIModelWithVersions> =>
      fetchSuiteData(`/api/v1/ai/models/${id}`),
    updateModel: (
      id: string,
      payload: AIUpdateModelPayload,
    ): Promise<AIRegisteredModel> =>
      apiPut<{ data: AIRegisteredModel }>(
        `/api/v1/ai/models/${id}`,
        payload,
      ).then((res) => res.data),
    createVersion: (
      id: string,
      payload: AICreateVersionPayload,
    ): Promise<AIModelVersion> =>
      apiPost<{ data: AIModelVersion }>(
        `/api/v1/ai/models/${id}/versions`,
        payload,
      ).then((res) => res.data),
    listVersions: (id: string): Promise<AIModelVersion[]> =>
      fetchSuiteData(`/api/v1/ai/models/${id}/versions`),
    getVersion: (id: string, versionId: string): Promise<AIModelVersion> =>
      fetchSuiteData(`/api/v1/ai/models/${id}/versions/${versionId}`),
    promote: (
      id: string,
      versionId: string,
      payload?: { approved_by?: string; override?: boolean },
    ) =>
      apiPost<{ data: AIModelVersion }>(
        `/api/v1/ai/models/${id}/versions/${versionId}/promote`,
        payload ?? {},
      ).then((res) => res.data),
    retire: (id: string, versionId: string, payload: { reason: string }) =>
      apiPost<{ data: AIModelVersion }>(
        `/api/v1/ai/models/${id}/versions/${versionId}/retire`,
        payload,
      ).then((res) => res.data),
    failVersion: (id: string, versionId: string, payload: { reason: string }) =>
      apiPost<{ data: AIModelVersion }>(
        `/api/v1/ai/models/${id}/versions/${versionId}/fail`,
        payload,
      ).then((res) => res.data),
    rollback: (id: string, payload: { reason: string }) =>
      apiPost<{ data: AIModelVersion }>(
        `/api/v1/ai/models/${id}/rollback`,
        payload,
      ).then((res) => res.data),
    lifecycleHistory: (id: string): Promise<AILifecycleHistoryEntry[]> =>
      fetchSuiteData(`/api/v1/ai/models/${id}/lifecycle-history`),
    startShadow: (id: string, payload: { version_id: string }) =>
      apiPost<{ data: AIModelVersion }>(
        `/api/v1/ai/models/${id}/shadow/start`,
        payload,
      ).then((res) => res.data),
    stopShadow: (id: string, payload: { version_id: string; reason: string }) =>
      apiPost<{ data: AIModelVersion }>(
        `/api/v1/ai/models/${id}/shadow/stop`,
        payload,
      ).then((res) => res.data),
    latestComparison: (id: string): Promise<AIShadowComparison> =>
      fetchSuiteData(`/api/v1/ai/models/${id}/shadow/comparison`),
    comparisonHistory: (
      id: string,
      limit = 24,
    ): Promise<AIShadowComparison[]> =>
      fetchSuiteData(`/api/v1/ai/models/${id}/shadow/comparison/history`, {
        limit,
      }),
    divergences: (id: string, params: FetchParams) =>
      fetchSuitePaginated<AIShadowDivergence>(
        `/api/v1/ai/models/${id}/shadow/divergences`,
        params,
      ),
    listPredictions: (params: FetchParams) =>
      fetchSuitePaginated<AIPredictionLog>("/api/v1/ai/predictions", params),
    getPrediction: (id: string): Promise<AIPredictionLog> =>
      fetchSuiteData(`/api/v1/ai/predictions/${id}`),
    submitFeedback: (
      id: string,
      payload: { correct: boolean; notes: string; corrected_output?: unknown },
    ) =>
      apiPost<{ data: { message: string } }>(
        `/api/v1/ai/predictions/${id}/feedback`,
        payload,
      ).then((res) => res.data),
    predictionStats: (): Promise<AIPredictionStats[]> =>
      fetchSuiteData("/api/v1/ai/predictions/stats"),
    getExplanation: (predictionId: string): Promise<AIExplanation> =>
      fetchSuiteData(`/api/v1/ai/explanations/${predictionId}`),
    searchExplanations: (
      query: string,
      limit = 20,
    ): Promise<AIPredictionLog[]> =>
      fetchSuiteData("/api/v1/ai/explanations/search", { q: query, limit }),
    latestDrift: (id: string): Promise<AIDriftReport> =>
      fetchSuiteData(`/api/v1/ai/models/${id}/drift`),
    driftHistory: (id: string, limit = 24): Promise<AIDriftReport[]> =>
      fetchSuiteData(`/api/v1/ai/models/${id}/drift/history`, { limit }),
    performance: (id: string, period = "30d"): Promise<AIPerformancePoint[]> =>
      fetchSuiteData(`/api/v1/ai/models/${id}/performance`, { period }),
    previewValidation: (
      id: string,
      versionId: string,
      payload: unknown,
    ): Promise<AIValidationPreview> =>
      apiPost<{ data: AIValidationPreview }>(
        `/api/v1/ai/models/${id}/versions/${versionId}/validation/preview`,
        payload,
      ).then((res) => res.data),
    validate: (
      id: string,
      versionId: string,
      payload: unknown,
    ): Promise<AIValidationResult> =>
      apiPost<{ data: AIValidationResult }>(
        `/api/v1/ai/models/${id}/versions/${versionId}/validate`,
        payload,
      ).then((res) => res.data),
    latestValidation: (
      id: string,
      versionId: string,
    ): Promise<AIValidationResult> =>
      fetchSuiteData(
        `/api/v1/ai/models/${id}/versions/${versionId}/validation`,
      ),
    validationHistory: (
      id: string,
      versionId: string,
      limit = 10,
    ): Promise<AIValidationResult[]> =>
      fetchSuiteData(
        `/api/v1/ai/models/${id}/versions/${versionId}/validation/history`,
        { limit },
      ),

    // ── Inference Servers ──────────────────────────
    createServer: (
      payload: Omit<
        AIInferenceServer,
        "id" | "tenant_id" | "status" | "created_at" | "updated_at"
      >,
    ): Promise<AIInferenceServer> =>
      apiPost<{ data: AIInferenceServer }>(
        "/api/v1/ai/inference-servers",
        payload,
      ).then((res) => res.data),
    listServers: (params?: FetchParams) =>
      fetchSuitePaginated<AIInferenceServer>(
        "/api/v1/ai/inference-servers",
        params ?? { page: 1, per_page: 50 },
      ),
    getServer: (id: string): Promise<AIInferenceServer> =>
      fetchSuiteData(`/api/v1/ai/inference-servers/${id}`),
    updateServerStatus: (id: string, payload: { status: string }) =>
      apiPut<{ data: AIInferenceServer }>(
        `/api/v1/ai/inference-servers/${id}/status`,
        payload,
      ).then((res) => res.data),
    deleteServer: (id: string): Promise<AIInferenceServer> =>
      apiDelete<{ data: AIInferenceServer }>(
        `/api/v1/ai/inference-servers/${id}`,
      ).then((res) => res.data),

    // ── Benchmark Suites ───────────────────────────
    createBenchmarkSuite: (
      payload: Omit<
        AIBenchmarkSuite,
        "id" | "tenant_id" | "created_by" | "created_at" | "updated_at"
      >,
    ): Promise<AIBenchmarkSuite> =>
      apiPost<{ data: AIBenchmarkSuite }>(
        "/api/v1/ai/benchmarks/suites",
        payload,
      ).then((res) => res.data),
    listBenchmarkSuites: (params?: FetchParams) =>
      fetchSuitePaginated<AIBenchmarkSuite>(
        "/api/v1/ai/benchmarks/suites",
        params ?? { page: 1, per_page: 50 },
      ),
    getBenchmarkSuite: (id: string): Promise<AIBenchmarkSuite> =>
      fetchSuiteData(`/api/v1/ai/benchmarks/suites/${id}`),

    // ── Benchmark Runs ─────────────────────────────
    runBenchmark: (
      suiteId: string,
      payload: { server_id: string },
    ): Promise<AIBenchmarkRun> =>
      apiPost<{ data: AIBenchmarkRun }>(
        `/api/v1/ai/benchmarks/suites/${suiteId}/run`,
        payload,
      ).then((res) => res.data),
    listBenchmarkRuns: (params?: FetchParams) =>
      fetchSuitePaginated<AIBenchmarkRun>(
        "/api/v1/ai/benchmarks/runs",
        params ?? { page: 1, per_page: 50 },
      ),
    getBenchmarkRun: (id: string): Promise<AIBenchmarkRun> =>
      fetchSuiteData(`/api/v1/ai/benchmarks/runs/${id}`),
    compareRuns: (payload: {
      run_ids: string[];
    }): Promise<AIBenchmarkComparison> =>
      apiPost<{ data: AIBenchmarkComparison }>(
        "/api/v1/ai/benchmarks/runs/compare",
        payload,
      ).then((res) => res.data),

    // ── Compute Costs ──────────────────────────────
    createCostModel: (
      payload: Omit<AIComputeCostModel, "id" | "tenant_id" | "created_at">,
    ): Promise<AIComputeCostModel> =>
      apiPost<{ data: AIComputeCostModel }>(
        "/api/v1/ai/compute-costs",
        payload,
      ).then((res) => res.data),
    listCostModels: (): Promise<AIComputeCostModel[]> =>
      fetchSuiteData("/api/v1/ai/compute-costs"),
    estimateCostSavings: (payload: {
      cpu_run_id: string;
      gpu_run_id: string;
    }): Promise<CostSavingsEstimate> =>
      apiPost<{ data: CostSavingsEstimate }>(
        "/api/v1/ai/compute-costs/estimate",
        payload,
      ).then((res) => res.data),
  },
};

export type EnterpriseApi = typeof enterpriseApi;
