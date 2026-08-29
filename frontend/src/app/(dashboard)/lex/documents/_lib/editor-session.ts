import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { enterpriseApi } from "@/lib/enterprise";
import type { JsonObject, LexDocument } from "@/types/suites";

export const LEX_EDITOR_MODES = ["view", "comment", "edit"] as const;

export type LexEditorMode = (typeof LEX_EDITOR_MODES)[number];

export type LexEditorProviderId =
  | "onlyoffice"
  | "collabora"
  | "microsoft_graph"
  | "office_online"
  | "native"
  | "unconfigured";

export type LexEditorProviderStatus =
  | "ready"
  | "loading"
  | "degraded"
  | "unavailable"
  | "error";

export type LexEditorLockStatus =
  | "unlocked"
  | "locked_by_me"
  | "locked_by_other"
  | "checked_out"
  | "read_only";

export type LexAutosaveStatus =
  | "saved"
  | "saving"
  | "pending"
  | "disabled"
  | "error";

export interface LexEditorDocumentSummary {
  id: string;
  title: string;
  fileName?: string;
  type?: string;
  confidentiality?: string;
  status?: string;
  currentVersion?: number;
  updatedAt?: string;
  metadata?: JsonObject;
}

export interface LexEditorProviderConfig {
  provider: LexEditorProviderId;
  label: string;
  status: LexEditorProviderStatus;
  hasConfig: boolean;
  iframeUrl?: string;
  launchUrl?: string;
  scriptUrl?: string;
  config?: JsonObject;
  expiresAt?: string;
  message?: string;
  capabilities: string[];
}

export interface LexEditorLockState {
  status: LexEditorLockStatus;
  holderName?: string;
  holderEmail?: string;
  checkedOutAt?: string;
  expiresAt?: string;
  canCheckOut: boolean;
  message?: string;
}

export interface LexEditorAutosaveState {
  status: LexAutosaveStatus;
  lastSavedAt?: string;
  recoveryPointAt?: string;
  conflictCount: number;
  message?: string;
}

export interface LexEditorVersionState {
  currentVersion?: number;
  latestSnapshotAt?: string;
  pendingChanges: number;
  snapshotAllowed: boolean;
}

export interface LexEditorCommentThread {
  id: string;
  authorName: string;
  excerpt: string;
  status: "open" | "resolved";
  createdAt?: string;
}

export interface LexEditorTrackedChange {
  id: string;
  authorName: string;
  summary: string;
  status: "pending" | "accepted" | "rejected";
  createdAt?: string;
}

export interface LexEditorClauseRecommendation {
  id: string;
  title: string;
  category?: string;
  confidence?: number;
  reason?: string;
}

export interface LexEditorAuditEvent {
  id: string;
  actorName: string;
  action: string;
  createdAt?: string;
  detail?: string;
}

export type LexEditorRiskLevel = "low" | "medium" | "high" | "critical";

export interface LexEditorNegotiationParticipant {
  id: string;
  name: string;
  role?: string;
  organization?: string;
  status: "active" | "invited" | "waiting" | "offline";
}

export interface LexEditorNegotiationRoom {
  status: "open" | "quiet" | "blocked" | "closed";
  phase?: string;
  openPoints: number;
  agreedPoints: number;
  lastOfferAt?: string;
  nextSessionAt?: string;
  positionSummary?: string;
  participants: LexEditorNegotiationParticipant[];
}

export interface LexEditorPlaybookDeviation {
  id: string;
  title: string;
  severity: LexEditorRiskLevel;
  status: "open" | "approved" | "waived" | "blocked";
  section?: string;
  ownerName?: string;
}

export interface LexEditorPlaybookEnforcement {
  playbookName?: string;
  score?: number;
  requiredClausesMet: number;
  requiredClausesTotal: number;
  deviations: LexEditorPlaybookDeviation[];
}

export interface LexEditorDefinedTerm {
  id: string;
  term: string;
  definition?: string;
  section?: string;
  status: "defined" | "undefined" | "duplicate" | "unused";
  referenceCount?: number;
}

export interface LexEditorCrossReference {
  id: string;
  label: string;
  target?: string;
  status: "valid" | "missing" | "stale";
  excerpt?: string;
}

export interface LexEditorTermsNavigator {
  terms: LexEditorDefinedTerm[];
  crossReferences: LexEditorCrossReference[];
}

export interface LexEditorSectionAssignment {
  id: string;
  section: string;
  assigneeName: string;
  status: "not_started" | "in_review" | "changes_requested" | "approved";
  dueAt?: string;
  priority: LexEditorRiskLevel;
}

export interface LexEditorGuestReviewer {
  id: string;
  name: string;
  organization?: string;
  role?: string;
  status: "invited" | "active" | "expired" | "revoked";
  access: "view" | "comment" | "edit";
  expiresAt?: string;
  lastActiveAt?: string;
}

export interface LexEditorLegalIssue {
  id: string;
  title: string;
  severity: LexEditorRiskLevel;
  status: "open" | "triage" | "resolved" | "waived";
  section?: string;
  ownerName?: string;
  dueAt?: string;
}

export interface LexEditorSignatureReadiness {
  status: "ready" | "needs_review" | "blocked" | "not_started";
  ready: boolean;
  provider?: string;
  completedSigners: number;
  requiredSigners: number;
  nextSignerName?: string;
  blockers: string[];
}

export interface LexEditorClauseAiAction {
  id: string;
  clauseTitle: string;
  action: string;
  status: "available" | "running" | "blocked" | "applied";
  confidence?: number;
  targetSection?: string;
  rationale?: string;
}

export interface LexEditorDocumentHealthMetric {
  id: string;
  label: string;
  value: string;
  status: "good" | "attention" | "blocked";
  detail?: string;
}

export interface LexEditorDocumentHealth {
  score: number;
  grade?: string;
  summary?: string;
  metrics: LexEditorDocumentHealthMetric[];
  blockers: string[];
}

export interface LexEditorPrivilegeControl {
  id: string;
  label: string;
  enabled: boolean;
  detail?: string;
}

export interface LexEditorPrivilegedControls {
  privilegeLevel?: string;
  accessReviewDueAt?: string;
  controls: LexEditorPrivilegeControl[];
}

export interface LexEditorProviderEvent {
  id: string;
  provider?: string;
  eventType: string;
  status: "received" | "processed" | "failed" | "ignored";
  summary?: string;
  createdAt?: string;
}

export interface LexEditorGuestPortal {
  status: "ready" | "needs_review" | "blocked";
  activeLinks: number;
  expiredLinks: number;
  revokedLinks: number;
  lastActivityAt?: string;
  watermarkEnabled: boolean;
}

export interface LexEditorAutomationTask {
  id: string;
  title: string;
  taskType: string;
  status: "open" | "in_progress" | "done" | "blocked";
  priority: LexEditorRiskLevel;
  ownerName?: string;
  dueAt?: string;
}

export interface LexEditorClauseAnchor {
  id: string;
  label: string;
  section?: string;
  path?: string;
  status: "anchored" | "stale" | "missing";
  excerpt?: string;
}

export interface LexEditorRedlinePackage {
  id: string;
  status: "queued" | "generating" | "ready" | "failed";
  packageType?: string;
  formats: string[];
  downloadUrl?: string;
  createdAt?: string;
  summary?: string;
}

export interface LexEditorApprovalGate {
  id: string;
  name: string;
  status: "not_started" | "pending" | "approved" | "rejected" | "blocked";
  required: boolean;
  approverName?: string;
  dueAt?: string;
  severity: LexEditorRiskLevel;
}

export interface LexEditorApprovalMatrix {
  status: "clear" | "pending" | "blocked";
  nextGateId?: string;
  gates: LexEditorApprovalGate[];
}

export interface LexEditorCompareWorkspace {
  id: string;
  baseLabel?: string;
  targetLabel?: string;
  status: "queued" | "running" | "ready" | "failed";
  changesCount: number;
  materialChangesCount: number;
  redlineUrl?: string;
  summary?: string;
  createdAt?: string;
}

export interface LexEditorCollaborationInboxItem {
  id: string;
  itemType: string;
  title: string;
  status: "unread" | "read" | "done" | "snoozed";
  actorName?: string;
  priority: LexEditorRiskLevel;
  createdAt?: string;
}

export interface LexEditorCollaborationInbox {
  unreadCount: number;
  items: LexEditorCollaborationInboxItem[];
}

export interface LexEditorPlaybookRuleLink {
  id: string;
  name: string;
  status: "draft" | "active" | "approval_required" | "archived";
  ruleCount: number;
  href?: string;
  updatedAt?: string;
}

export interface LexEditorTermRepairAction {
  id: string;
  term: string;
  action: string;
  status: "suggested" | "queued" | "applied" | "dismissed";
  severity: LexEditorRiskLevel;
  section?: string;
  preview?: string;
}

export interface LexEditorEvidenceBinding {
  id: string;
  title: string;
  sourceType: string;
  status: "linked" | "missing" | "stale" | "needs_review";
  section?: string;
  confidence?: number;
  citation?: string;
}

export interface LexEditorAIChangeSafety {
  enabled: boolean;
  mode: "preview_only" | "approval_required" | "disabled";
  pendingProposals: number;
  requiredApprovals: number;
  blockers: string[];
}

export interface LexEditorOfflineRecovery {
  status: "clear" | "buffering" | "restore_available" | "conflict";
  queuedEdits: number;
  queuedComments: number;
  conflictCount: number;
  lastBufferedAt?: string;
}

export interface LexEditorAnalytics {
  cycleTimeHours?: number;
  revisionCount: number;
  unresolvedIssueCount: number;
  playbookDeviationRate?: number;
  approvalDelayHours?: number;
  externalReviewTurnaroundHours?: number;
  signatureReadinessTrend?: "improving" | "flat" | "declining";
  generatedAt?: string;
}

export interface LexEditorSessionConfig {
  sessionId?: string;
  documentId: string;
  document?: LexEditorDocumentSummary;
  mode: LexEditorMode;
  availableModes: LexEditorMode[];
  readOnly: boolean;
  provider: LexEditorProviderConfig;
  lock: LexEditorLockState;
  autosave: LexEditorAutosaveState;
  version: LexEditorVersionState;
  comments: {
    total: number;
    unresolved: number;
    threads: LexEditorCommentThread[];
  };
  trackChanges: {
    enabled: boolean;
    total: number;
    changes: LexEditorTrackedChange[];
  };
  clauseLibrary: {
    recommendations: LexEditorClauseRecommendation[];
  };
  audit: LexEditorAuditEvent[];
  negotiationRoom: LexEditorNegotiationRoom;
  playbookEnforcement: LexEditorPlaybookEnforcement;
  termsNavigator: LexEditorTermsNavigator;
  sectionAssignments: LexEditorSectionAssignment[];
  guestReviewers: LexEditorGuestReviewer[];
  legalIssues: LexEditorLegalIssue[];
  signatureReadiness: LexEditorSignatureReadiness;
  clauseAiActions: LexEditorClauseAiAction[];
  documentHealth: LexEditorDocumentHealth;
  privilegedControls: LexEditorPrivilegedControls;
  providerEvents: LexEditorProviderEvent[];
  guestPortal: LexEditorGuestPortal;
  automationTasks: LexEditorAutomationTask[];
  clauseAnchors: LexEditorClauseAnchor[];
  redlinePackages: LexEditorRedlinePackage[];
  approvalMatrix: LexEditorApprovalMatrix;
  compareWorkspaces: LexEditorCompareWorkspace[];
  collaborationInbox: LexEditorCollaborationInbox;
  playbookRuleLinks: LexEditorPlaybookRuleLink[];
  termRepairActions: LexEditorTermRepairAction[];
  evidenceBindings: LexEditorEvidenceBinding[];
  aiChangeSafety: LexEditorAIChangeSafety;
  offlineRecovery: LexEditorOfflineRecovery;
  editorAnalytics: LexEditorAnalytics;
}

interface SessionEnvelope {
  data?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordFrom(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function asJsonObject(value: unknown): JsonObject | undefined {
  return isRecord(value) ? (value as JsonObject) : undefined;
}

function stringFrom(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function numberFrom(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return undefined;
}

function booleanFrom(...values: unknown[]): boolean | undefined {
  for (const value of values) {
    if (typeof value === "boolean") {
      return value;
    }
  }
  return undefined;
}

function recordsFrom(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function stringsFrom(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter(
          (item): item is string =>
            typeof item === "string" && item.trim().length > 0,
        )
        .map((item) => item.trim())
    : [];
}

function compactRecords(...values: unknown[]): Record<string, unknown>[] {
  return values.filter(isRecord);
}

function nestedRecord(
  source: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  return recordFrom(source[key]);
}

function featureSources(
  session: Record<string, unknown>,
  root: Record<string, unknown>,
  metadataSources: Record<string, unknown>[],
): Record<string, unknown>[] {
  const sessionWorkspace = compactRecords(
    nestedRecord(session, "editor_workspace"),
    nestedRecord(session, "editorWorkspace"),
    nestedRecord(session, "workspace"),
  );
  const rootWorkspace = compactRecords(
    nestedRecord(root, "editor_workspace"),
    nestedRecord(root, "editorWorkspace"),
    nestedRecord(root, "workspace"),
  );
  const metadataWorkspace = metadataSources.flatMap((metadata) =>
    compactRecords(
      nestedRecord(metadata, "editor_workspace"),
      nestedRecord(metadata, "editorWorkspace"),
      nestedRecord(metadata, "workspace"),
      nestedRecord(metadata, "lex_editor"),
      nestedRecord(metadata, "lexEditor"),
    ),
  );

  return compactRecords(
    session,
    ...sessionWorkspace,
    root,
    ...rootWorkspace,
    ...metadataSources,
    ...metadataWorkspace,
  );
}

function recordFromKeys(
  sources: Record<string, unknown>[],
  keys: string[],
): Record<string, unknown> | undefined {
  for (const source of sources) {
    for (const key of keys) {
      const value = recordFrom(source[key]);
      if (value) return value;
    }
  }
  return undefined;
}

function recordsFromKeys(
  sources: Record<string, unknown>[],
  keys: string[],
): Record<string, unknown>[] {
  for (const source of sources) {
    for (const key of keys) {
      const values = recordsFrom(source[key]);
      if (values.length > 0) return values;
    }
  }
  return [];
}

function metadataSourcesFrom(
  session: Record<string, unknown>,
  root: Record<string, unknown>,
  document?: LexEditorDocumentSummary,
): Record<string, unknown>[] {
  return compactRecords(
    session.metadata,
    session.editor_metadata,
    session.editorMetadata,
    root.metadata,
    root.editor_metadata,
    root.editorMetadata,
    document?.metadata,
  );
}

function normalizedToken(value: unknown): string | undefined {
  return stringFrom(value)
    ?.toLowerCase()
    .replace(/[-\s]+/g, "_");
}

function normalizeRiskLevel(value: unknown): LexEditorRiskLevel {
  const level = normalizedToken(value);
  if (level === "critical" || level === "blocker") return "critical";
  if (level === "high" || level === "red") return "high";
  if (level === "medium" || level === "moderate" || level === "warning")
    return "medium";
  return "low";
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizeMode(value: unknown): LexEditorMode | undefined {
  const mode = typeof value === "string" ? value.toLowerCase() : "";
  return LEX_EDITOR_MODES.includes(mode as LexEditorMode)
    ? (mode as LexEditorMode)
    : undefined;
}

export function coerceEditorMode(
  value: string | null | undefined,
): LexEditorMode {
  return normalizeMode(value) ?? "view";
}

function normalizeModes(value: unknown): LexEditorMode[] {
  const modes = Array.isArray(value)
    ? value
        .map(normalizeMode)
        .filter((mode): mode is LexEditorMode => Boolean(mode))
    : [];
  return modes.length > 0 ? Array.from(new Set(modes)) : [...LEX_EDITOR_MODES];
}

function normalizeProvider(value: unknown): LexEditorProviderId {
  const provider =
    typeof value === "string" ? value.toLowerCase().replace(/[-\s]/g, "_") : "";
  if (provider === "onlyoffice" || provider === "only_office")
    return "onlyoffice";
  if (provider === "collabora" || provider === "collabora_online")
    return "collabora";
  if (
    provider === "microsoft_graph" ||
    provider === "ms_graph" ||
    provider === "graph"
  )
    return "microsoft_graph";
  if (
    provider === "office_online" ||
    provider === "office365" ||
    provider === "m365"
  )
    return "office_online";
  if (provider === "native" || provider === "internal") return "native";
  return "unconfigured";
}

function providerLabel(provider: LexEditorProviderId): string {
  switch (provider) {
    case "onlyoffice":
      return "OnlyOffice";
    case "collabora":
      return "Collabora";
    case "microsoft_graph":
      return "Microsoft Graph";
    case "office_online":
      return "Office Online";
    case "native":
      return "Native editor";
    case "unconfigured":
      return "Provider not configured";
  }
}

function normalizeProviderStatus(
  value: unknown,
  provider: LexEditorProviderId,
  hasConfig: boolean,
): LexEditorProviderStatus {
  const status =
    typeof value === "string" ? value.toLowerCase().replace(/[-\s]/g, "_") : "";
  if (status === "ready" || status === "healthy" || status === "online")
    return "ready";
  if (status === "loading" || status === "initializing") return "loading";
  if (status === "degraded" || status === "partial") return "degraded";
  if (status === "error" || status === "failed") return "error";
  if (status === "unavailable" || status === "disabled" || status === "missing")
    return "unavailable";
  if (provider === "unconfigured" || !hasConfig) return "unavailable";
  return "ready";
}

function normalizeLockStatus(
  value: unknown,
  readOnly: boolean,
): LexEditorLockStatus {
  if (readOnly) return "read_only";
  const status =
    typeof value === "string" ? value.toLowerCase().replace(/[-\s]/g, "_") : "";
  if (
    status === "locked_by_me" ||
    status === "mine" ||
    status === "checked_out_by_me"
  )
    return "locked_by_me";
  if (status === "locked_by_other" || status === "locked" || status === "busy")
    return "locked_by_other";
  if (
    status === "checked_out" ||
    status === "checkout" ||
    status === "check_out"
  )
    return "checked_out";
  if (status === "read_only" || status === "readonly") return "read_only";
  return "unlocked";
}

function normalizeAutosaveStatus(
  value: unknown,
  hasProviderConfig: boolean,
): LexAutosaveStatus {
  const status =
    typeof value === "string" ? value.toLowerCase().replace(/[-\s]/g, "_") : "";
  if (status === "saved" || status === "synced" || status === "clean")
    return "saved";
  if (status === "saving" || status === "syncing") return "saving";
  if (status === "pending" || status === "dirty" || status === "queued")
    return "pending";
  if (status === "error" || status === "failed") return "error";
  return hasProviderConfig ? "saved" : "disabled";
}

function unwrapSessionResponse(response: unknown): Record<string, unknown> {
  const envelope = recordFrom(response as SessionEnvelope) ?? {};
  const data = recordFrom(envelope.data);
  return data ?? envelope;
}

function documentSummaryFrom(
  value: unknown,
  fallbackId: string,
): LexEditorDocumentSummary | undefined {
  const source = recordFrom(value);
  if (!source) return undefined;
  const id = stringFrom(source.id, source.document_id) ?? fallbackId;
  return {
    id,
    title:
      stringFrom(source.title, source.name, source.file_name) ??
      "Untitled document",
    fileName: stringFrom(source.file_name, source.fileName, source.filename),
    type: stringFrom(source.type),
    confidentiality: stringFrom(source.confidentiality),
    status: stringFrom(source.status),
    currentVersion: numberFrom(
      source.current_version,
      source.currentVersion,
      source.version,
    ),
    updatedAt: stringFrom(
      source.updated_at,
      source.updatedAt,
      source.modified_at,
    ),
    metadata: asJsonObject(source.metadata),
  };
}

export function buildDocumentEditorSummary(
  document: LexDocument,
): LexEditorDocumentSummary {
  return {
    id: document.id,
    title: document.title,
    fileName: document.file_name ?? undefined,
    type: document.type,
    confidentiality: document.confidentiality,
    status: document.status,
    currentVersion: document.current_version,
    updatedAt: document.updated_at,
    metadata: document.metadata,
  };
}

function normalizeProviderConfig(
  session: Record<string, unknown>,
  root: Record<string, unknown>,
): LexEditorProviderConfig {
  const providerSource =
    recordFrom(session.provider_config) ??
    recordFrom(session.editor_provider) ??
    recordFrom(session.editor) ??
    recordFrom(root.provider_config) ??
    {};
  const provider = normalizeProvider(
    session.provider ??
      providerSource.provider ??
      providerSource.type ??
      providerSource.name ??
      root.provider,
  );
  const iframeUrl = stringFrom(
    session.iframe_url,
    session.iframeUrl,
    session.embed_url,
    session.embedUrl,
    providerSource.iframe_url,
    providerSource.iframeUrl,
    providerSource.embed_url,
    providerSource.url,
  );
  const launchUrl = stringFrom(
    session.launch_url,
    session.launchUrl,
    session.edit_url,
    session.view_url,
    providerSource.launch_url,
    providerSource.launchUrl,
  );
  const scriptUrl = stringFrom(
    session.script_url,
    session.scriptUrl,
    providerSource.script_url,
    providerSource.scriptUrl,
  );
  const config = asJsonObject(
    session.onlyoffice_config ??
      session.editor_config ??
      session.config ??
      providerSource.onlyoffice_config ??
      providerSource.editor_config ??
      providerSource.config,
  );
  const hasConfig = Boolean(iframeUrl || launchUrl || scriptUrl || config);
  const status = normalizeProviderStatus(
    session.provider_status ?? providerSource.status ?? root.provider_status,
    provider,
    hasConfig,
  );
  const capabilities = Array.isArray(session.capabilities)
    ? session.capabilities.filter(
        (item): item is string => typeof item === "string",
      )
    : Array.isArray(providerSource.capabilities)
      ? providerSource.capabilities.filter(
          (item): item is string => typeof item === "string",
        )
      : [];

  return {
    provider,
    label: providerLabel(provider),
    status,
    hasConfig,
    iframeUrl,
    launchUrl,
    scriptUrl,
    config,
    expiresAt: stringFrom(
      session.expires_at,
      session.expiresAt,
      providerSource.expires_at,
      providerSource.expiresAt,
    ),
    message: stringFrom(
      session.provider_message,
      providerSource.message,
      root.provider_message,
    ),
    capabilities,
  };
}

function normalizeLock(
  session: Record<string, unknown>,
  readOnly: boolean,
): LexEditorLockState {
  const source =
    recordFrom(session.lock) ??
    recordFrom(session.checkout) ??
    recordFrom(session.check_out) ??
    {};
  const status = normalizeLockStatus(
    source.status ?? session.lock_status ?? session.checkout_status,
    readOnly,
  );
  return {
    status,
    holderName: stringFrom(
      source.holder_name,
      source.user_name,
      source.owner_name,
      session.locked_by_name,
    ),
    holderEmail: stringFrom(
      source.holder_email,
      source.user_email,
      session.locked_by_email,
    ),
    checkedOutAt: stringFrom(
      source.checked_out_at,
      source.locked_at,
      session.checked_out_at,
    ),
    expiresAt: stringFrom(
      source.expires_at,
      source.expiresAt,
      session.lock_expires_at,
    ),
    canCheckOut:
      booleanFrom(source.can_check_out, session.can_check_out) ??
      status === "unlocked",
    message: stringFrom(source.message, session.lock_message),
  };
}

function normalizeAutosave(
  session: Record<string, unknown>,
  hasProviderConfig: boolean,
): LexEditorAutosaveState {
  const source =
    recordFrom(session.autosave) ?? recordFrom(session.recovery) ?? {};
  return {
    status: normalizeAutosaveStatus(
      source.status ?? session.autosave_status,
      hasProviderConfig,
    ),
    lastSavedAt: stringFrom(
      source.last_saved_at,
      source.lastSavedAt,
      session.last_saved_at,
    ),
    recoveryPointAt: stringFrom(
      source.recovery_point_at,
      source.recoveryPointAt,
      session.recovery_point_at,
    ),
    conflictCount:
      numberFrom(source.conflict_count, session.conflict_count) ?? 0,
    message: stringFrom(
      source.message,
      session.autosave_message,
      session.recovery_message,
    ),
  };
}

function normalizeComments(
  session: Record<string, unknown>,
): LexEditorSessionConfig["comments"] {
  const source =
    recordFrom(session.comments) ?? recordFrom(session.comment_summary) ?? {};
  const threads = recordsFrom(source.threads ?? session.comment_threads).map(
    (thread, index) => {
      const status: LexEditorCommentThread["status"] =
        stringFrom(thread.status)?.toLowerCase() === "resolved"
          ? "resolved"
          : "open";
      return {
        id: stringFrom(thread.id) ?? `comment-${index}`,
        authorName:
          stringFrom(
            thread.author_name,
            thread.authorName,
            thread.author,
            thread.created_by,
          ) ?? "Reviewer",
        excerpt:
          stringFrom(
            thread.excerpt,
            thread.body,
            thread.text,
            thread.summary,
          ) ?? "Comment thread",
        status,
        createdAt: stringFrom(thread.created_at, thread.createdAt),
      };
    },
  );
  return {
    total:
      numberFrom(source.total, source.count, session.comment_count) ??
      threads.length,
    unresolved:
      numberFrom(
        source.unresolved,
        source.open,
        session.unresolved_comment_count,
      ) ?? threads.filter((thread) => thread.status === "open").length,
    threads,
  };
}

function normalizeTrackChanges(
  session: Record<string, unknown>,
): LexEditorSessionConfig["trackChanges"] {
  const source =
    recordFrom(session.track_changes) ??
    recordFrom(session.trackChanges) ??
    recordFrom(session.change_tracking) ??
    {};
  const changes = recordsFrom(source.changes ?? session.tracked_changes).map(
    (change, index) => {
      const rawStatus = stringFrom(change.status)?.toLowerCase();
      const status: LexEditorTrackedChange["status"] =
        rawStatus === "accepted"
          ? "accepted"
          : rawStatus === "rejected"
            ? "rejected"
            : "pending";
      return {
        id: stringFrom(change.id) ?? `change-${index}`,
        authorName:
          stringFrom(
            change.author_name,
            change.authorName,
            change.author,
            change.created_by,
          ) ?? "Reviewer",
        summary:
          stringFrom(change.summary, change.text, change.description) ??
          "Tracked change",
        status,
        createdAt: stringFrom(change.created_at, change.createdAt),
      };
    },
  );
  return {
    enabled: booleanFrom(source.enabled, session.track_changes_enabled) ?? true,
    total:
      numberFrom(source.total, source.count, session.tracked_change_count) ??
      changes.length,
    changes,
  };
}

function normalizeClauseLibrary(
  session: Record<string, unknown>,
): LexEditorSessionConfig["clauseLibrary"] {
  const source =
    recordFrom(session.clause_library) ??
    recordFrom(session.clauseLibrary) ??
    {};
  const recommendations = recordsFrom(
    source.recommendations ?? session.clause_recommendations,
  ).map((recommendation, index) => ({
    id:
      stringFrom(recommendation.id, recommendation.clause_id) ??
      `clause-${index}`,
    title:
      stringFrom(
        recommendation.title,
        recommendation.name,
        recommendation.clause_title,
      ) ?? "Recommended clause",
    category: stringFrom(recommendation.category, recommendation.type),
    confidence: numberFrom(recommendation.confidence, recommendation.score),
    reason: stringFrom(
      recommendation.reason,
      recommendation.explanation,
      recommendation.summary,
    ),
  }));
  return { recommendations };
}

function normalizeAudit(
  session: Record<string, unknown>,
): LexEditorAuditEvent[] {
  return recordsFrom(
    session.audit ?? session.audit_events ?? session.activity,
  ).map((event, index) => ({
    id: stringFrom(event.id) ?? `audit-${index}`,
    actorName:
      stringFrom(
        event.actor_name,
        event.actorName,
        event.actor,
        event.user_name,
      ) ?? "System",
    action:
      stringFrom(event.action, event.event, event.type) ?? "Session event",
    createdAt: stringFrom(event.created_at, event.createdAt, event.timestamp),
    detail: stringFrom(event.detail, event.description, event.summary),
  }));
}

function normalizeNegotiationParticipantStatus(
  value: unknown,
): LexEditorNegotiationParticipant["status"] {
  const status = normalizedToken(value);
  if (status === "active" || status === "online" || status === "reviewing") {
    return "active";
  }
  if (status === "invited" || status === "pending_invite") return "invited";
  if (status === "waiting" || status === "awaiting_response") return "waiting";
  return "offline";
}

function normalizeNegotiationRoomStatus(
  value: unknown,
  openPoints: number,
): LexEditorNegotiationRoom["status"] {
  const status = normalizedToken(value);
  if (status === "open" || status === "active" || status === "live")
    return "open";
  if (status === "blocked" || status === "stalled") return "blocked";
  if (status === "closed" || status === "settled" || status === "complete")
    return "closed";
  return openPoints > 0 ? "open" : "quiet";
}

function normalizeNegotiationRoom(
  session: Record<string, unknown>,
  root: Record<string, unknown>,
  metadataSources: Record<string, unknown>[],
): LexEditorNegotiationRoom {
  const sources = featureSources(session, root, metadataSources);
  const source =
    recordFromKeys(sources, [
      "negotiation_room",
      "negotiationRoom",
      "negotiation",
    ]) ?? {};
  const participantRecords =
    recordsFrom(
      source.participants ?? source.counterparties ?? source.members,
    ) ?? [];
  const participants =
    participantRecords.length > 0
      ? participantRecords
      : recordsFromKeys(sources, [
          "negotiation_participants",
          "negotiationParticipants",
          "counterparties",
        ]);
  const openPoints =
    numberFrom(
      source.open_points,
      source.openPoints,
      source.unresolved_points,
      source.unresolvedPoints,
      source.issues_open,
    ) ?? 0;

  return {
    status: normalizeNegotiationRoomStatus(source.status, openPoints),
    phase: stringFrom(source.phase, source.stage),
    openPoints,
    agreedPoints:
      numberFrom(
        source.agreed_points,
        source.agreedPoints,
        source.closed_points,
      ) ?? 0,
    lastOfferAt: stringFrom(source.last_offer_at, source.lastOfferAt),
    nextSessionAt: stringFrom(source.next_session_at, source.nextSessionAt),
    positionSummary: stringFrom(
      source.position_summary,
      source.positionSummary,
      source.summary,
    ),
    participants: participants.map((participant, index) => ({
      id: stringFrom(participant.id, participant.email) ?? `party-${index}`,
      name:
        stringFrom(
          participant.name,
          participant.display_name,
          participant.displayName,
          participant.email,
        ) ?? "Counterparty",
      role: stringFrom(participant.role, participant.title),
      organization: stringFrom(
        participant.organization,
        participant.org,
        participant.company,
      ),
      status: normalizeNegotiationParticipantStatus(participant.status),
    })),
  };
}

function normalizePlaybookDeviationStatus(
  value: unknown,
): LexEditorPlaybookDeviation["status"] {
  const status = normalizedToken(value);
  if (status === "approved" || status === "accepted") return "approved";
  if (status === "waived" || status === "risk_accepted") return "waived";
  if (status === "blocked" || status === "blocker") return "blocked";
  return "open";
}

function normalizePlaybookEnforcement(
  session: Record<string, unknown>,
  root: Record<string, unknown>,
  metadataSources: Record<string, unknown>[],
): LexEditorPlaybookEnforcement {
  const sources = featureSources(session, root, metadataSources);
  const source =
    recordFromKeys(sources, [
      "playbook_enforcement",
      "playbookEnforcement",
      "playbook",
    ]) ?? {};
  const required =
    recordFrom(source.required_clauses ?? source.requiredClauses) ?? {};
  const deviationRecords =
    recordsFrom(source.deviations ?? source.exceptions ?? source.issues) ?? [];
  const deviations =
    deviationRecords.length > 0
      ? deviationRecords
      : recordsFromKeys(sources, ["playbook_deviations", "playbookDeviations"]);
  const requiredClausesTotal =
    numberFrom(
      source.required_clauses_total,
      source.requiredClausesTotal,
      required.total,
      required.count,
    ) ?? 0;
  const requiredClausesMet =
    numberFrom(
      source.required_clauses_met,
      source.requiredClausesMet,
      required.met,
      required.satisfied,
    ) ?? 0;

  return {
    playbookName: stringFrom(
      source.name,
      source.playbook_name,
      source.playbookName,
    ),
    score: numberFrom(
      source.score,
      source.compliance_score,
      source.complianceScore,
    ),
    requiredClausesMet,
    requiredClausesTotal,
    deviations: deviations.map((deviation, index) => ({
      id: stringFrom(deviation.id, deviation.code) ?? `deviation-${index}`,
      title:
        stringFrom(
          deviation.title,
          deviation.name,
          deviation.message,
          deviation.summary,
        ) ?? "Playbook deviation",
      severity: normalizeRiskLevel(deviation.severity ?? deviation.risk),
      status: normalizePlaybookDeviationStatus(deviation.status),
      section: stringFrom(
        deviation.section,
        deviation.clause,
        deviation.location,
      ),
      ownerName: stringFrom(
        deviation.owner_name,
        deviation.ownerName,
        deviation.assignee,
      ),
    })),
  };
}

function normalizeDefinedTermStatus(
  value: unknown,
): LexEditorDefinedTerm["status"] {
  const status = normalizedToken(value);
  if (status === "undefined" || status === "missing") return "undefined";
  if (status === "duplicate" || status === "conflict") return "duplicate";
  if (status === "unused" || status === "orphaned") return "unused";
  return "defined";
}

function normalizeCrossReferenceStatus(
  value: unknown,
): LexEditorCrossReference["status"] {
  const status = normalizedToken(value);
  if (status === "missing" || status === "broken") return "missing";
  if (status === "stale" || status === "renumbered") return "stale";
  return "valid";
}

function normalizeTermsNavigator(
  session: Record<string, unknown>,
  root: Record<string, unknown>,
  metadataSources: Record<string, unknown>[],
): LexEditorTermsNavigator {
  const sources = featureSources(session, root, metadataSources);
  const source =
    recordFromKeys(sources, [
      "terms_navigator",
      "termsNavigator",
      "defined_terms",
      "definedTerms",
    ]) ?? {};
  const termRecords =
    recordsFrom(source.terms ?? source.defined_terms ?? source.definedTerms) ??
    [];
  const crossReferenceRecords =
    recordsFrom(
      source.cross_references ?? source.crossReferences ?? source.references,
    ) ?? [];

  return {
    terms: (termRecords.length > 0
      ? termRecords
      : recordsFromKeys(sources, ["terms", "defined_terms", "definedTerms"])
    ).map((term, index) => ({
      id: stringFrom(term.id, term.term) ?? `term-${index}`,
      term: stringFrom(term.term, term.name, term.label) ?? "Defined term",
      definition: stringFrom(term.definition, term.description, term.text),
      section: stringFrom(term.section, term.location),
      status: normalizeDefinedTermStatus(term.status),
      referenceCount: numberFrom(
        term.reference_count,
        term.referenceCount,
        term.references,
      ),
    })),
    crossReferences: (crossReferenceRecords.length > 0
      ? crossReferenceRecords
      : recordsFromKeys(sources, [
          "cross_references",
          "crossReferences",
          "references",
        ])
    ).map((reference, index) => ({
      id: stringFrom(reference.id, reference.label) ?? `reference-${index}`,
      label:
        stringFrom(reference.label, reference.source, reference.text) ??
        "Reference",
      target: stringFrom(
        reference.target,
        reference.destination,
        reference.section,
      ),
      status: normalizeCrossReferenceStatus(reference.status),
      excerpt: stringFrom(
        reference.excerpt,
        reference.context,
        reference.summary,
      ),
    })),
  };
}

function normalizeSectionAssignmentStatus(
  value: unknown,
): LexEditorSectionAssignment["status"] {
  const status = normalizedToken(value);
  if (
    status === "approved" ||
    status === "complete" ||
    status === "completed"
  ) {
    return "approved";
  }
  if (status === "changes_requested" || status === "rework") {
    return "changes_requested";
  }
  if (status === "in_review" || status === "reviewing" || status === "active") {
    return "in_review";
  }
  return "not_started";
}

function normalizeSectionAssignments(
  session: Record<string, unknown>,
  root: Record<string, unknown>,
  metadataSources: Record<string, unknown>[],
): LexEditorSectionAssignment[] {
  const sources = featureSources(session, root, metadataSources);
  const source =
    recordFromKeys(sources, [
      "section_review",
      "sectionReview",
      "section_assignments",
      "sectionAssignments",
    ]) ?? {};
  const assignmentRecords =
    recordsFrom(source.assignments ?? source.sections ?? source.items) ?? [];

  return (
    assignmentRecords.length > 0
      ? assignmentRecords
      : recordsFromKeys(sources, ["section_assignments", "sectionAssignments"])
  ).map((assignment, index) => ({
    id: stringFrom(assignment.id, assignment.section) ?? `section-${index}`,
    section:
      stringFrom(assignment.section, assignment.title, assignment.clause) ??
      "Unlabeled section",
    assigneeName:
      stringFrom(
        assignment.assignee_name,
        assignment.assigneeName,
        assignment.assignee,
        assignment.owner_name,
      ) ?? "Unassigned",
    status: normalizeSectionAssignmentStatus(assignment.status),
    dueAt: stringFrom(assignment.due_at, assignment.dueAt, assignment.deadline),
    priority: normalizeRiskLevel(assignment.priority ?? assignment.severity),
  }));
}

function normalizeGuestReviewerStatus(
  value: unknown,
): LexEditorGuestReviewer["status"] {
  const status = normalizedToken(value);
  if (status === "active" || status === "accepted") return "active";
  if (status === "expired") return "expired";
  if (status === "revoked" || status === "disabled") return "revoked";
  return "invited";
}

function normalizeGuestAccess(
  value: unknown,
): LexEditorGuestReviewer["access"] {
  const access = normalizedToken(value);
  if (access === "edit" || access === "write") return "edit";
  if (access === "comment" || access === "review") return "comment";
  return "view";
}

function normalizeGuestReviewers(
  session: Record<string, unknown>,
  root: Record<string, unknown>,
  metadataSources: Record<string, unknown>[],
): LexEditorGuestReviewer[] {
  const sources = featureSources(session, root, metadataSources);
  const source =
    recordFromKeys(sources, [
      "guest_review",
      "guestReview",
      "external_review",
    ]) ?? {};
  const guestRecords =
    recordsFrom(source.guests ?? source.reviewers ?? source.invitations) ?? [];

  return (
    guestRecords.length > 0
      ? guestRecords
      : recordsFromKeys(sources, [
          "guest_reviewers",
          "guestReviewers",
          "external_reviewers",
        ])
  ).map((guest, index) => ({
    id: stringFrom(guest.id, guest.email) ?? `guest-${index}`,
    name:
      stringFrom(
        guest.name,
        guest.display_name,
        guest.displayName,
        guest.email,
      ) ?? "Guest reviewer",
    organization: stringFrom(guest.organization, guest.company),
    role: stringFrom(guest.role, guest.title),
    status: normalizeGuestReviewerStatus(guest.status),
    access: normalizeGuestAccess(guest.access ?? guest.permission),
    expiresAt: stringFrom(guest.expires_at, guest.expiresAt),
    lastActiveAt: stringFrom(guest.last_active_at, guest.lastActiveAt),
  }));
}

function normalizeLegalIssueStatus(
  value: unknown,
): LexEditorLegalIssue["status"] {
  const status = normalizedToken(value);
  if (status === "resolved" || status === "closed" || status === "done") {
    return "resolved";
  }
  if (status === "waived" || status === "accepted") return "waived";
  if (status === "triage" || status === "review") return "triage";
  return "open";
}

function normalizeLegalIssues(
  session: Record<string, unknown>,
  root: Record<string, unknown>,
  metadataSources: Record<string, unknown>[],
): LexEditorLegalIssue[] {
  const sources = featureSources(session, root, metadataSources);
  const source =
    recordFromKeys(sources, [
      "legal_issue_tracker",
      "legalIssueTracker",
      "legal_issues",
      "legalIssues",
    ]) ?? {};
  const preflight =
    recordFromKeys(sources, ["preflight", "editor_preflight"]) ?? {};
  const issueRecords = recordsFrom(source.issues ?? source.items) ?? [];
  const fallbackIssues =
    issueRecords.length > 0
      ? issueRecords
      : recordsFromKeys(sources, ["legal_issues", "legalIssues", "issues"]);
  const issues =
    fallbackIssues.length > 0 ? fallbackIssues : recordsFrom(preflight.issues);

  return issues.map((issue, index) => ({
    id: stringFrom(issue.id, issue.code) ?? `issue-${index}`,
    title:
      stringFrom(
        issue.title,
        issue.message,
        issue.summary,
        issue.description,
      ) ?? "Legal issue",
    severity: normalizeRiskLevel(issue.severity ?? issue.priority),
    status: normalizeLegalIssueStatus(issue.status),
    section: stringFrom(issue.section, issue.field, issue.location),
    ownerName: stringFrom(issue.owner_name, issue.ownerName, issue.assignee),
    dueAt: stringFrom(issue.due_at, issue.dueAt, issue.deadline),
  }));
}

function normalizeSignatureStatus(
  value: unknown,
  ready: boolean,
  blockers: string[],
  requiredSigners: number,
): LexEditorSignatureReadiness["status"] {
  const status = normalizedToken(value);
  if (status === "ready" || status === "passed") return "ready";
  if (status === "blocked" || status === "failed") return "blocked";
  if (status === "needs_review" || status === "review") return "needs_review";
  if (ready) return "ready";
  if (blockers.length > 0) return "blocked";
  return requiredSigners > 0 ? "needs_review" : "not_started";
}

function normalizeSignatureReadiness(
  session: Record<string, unknown>,
  root: Record<string, unknown>,
  metadataSources: Record<string, unknown>[],
): LexEditorSignatureReadiness {
  const sources = featureSources(session, root, metadataSources);
  const source =
    recordFromKeys(sources, [
      "signature_readiness",
      "signatureReadiness",
      "signing",
    ]) ?? {};
  const preflight =
    recordFromKeys(sources, ["preflight", "editor_preflight"]) ?? {};
  const preflightIssues = recordsFrom(preflight.issues);
  const issueBlockers = preflightIssues
    .filter((issue) => normalizeRiskLevel(issue.severity) === "critical")
    .map((issue) => stringFrom(issue.message, issue.title, issue.code))
    .filter((message): message is string => Boolean(message));
  const blockers = [
    ...stringsFrom(source.blockers),
    ...stringsFrom(source.blocking_reasons),
    ...issueBlockers,
  ];
  const requiredSigners =
    numberFrom(
      source.required_signers,
      source.requiredSigners,
      source.signer_count,
      source.signerCount,
    ) ?? 0;
  const completedSigners =
    numberFrom(
      source.completed_signers,
      source.completedSigners,
      source.signed_count,
      source.signedCount,
    ) ?? 0;
  const ready =
    booleanFrom(
      source.ready,
      source.can_send,
      source.canSend,
      preflight.ready,
    ) ??
    (requiredSigners > 0 &&
      completedSigners >= requiredSigners &&
      blockers.length === 0);

  return {
    status: normalizeSignatureStatus(
      source.status ?? preflight.status,
      ready,
      blockers,
      requiredSigners,
    ),
    ready,
    provider: stringFrom(source.provider, source.envelope_provider),
    completedSigners,
    requiredSigners,
    nextSignerName: stringFrom(
      source.next_signer_name,
      source.nextSignerName,
      source.next_signer,
    ),
    blockers,
  };
}

function normalizeClauseAiStatus(
  value: unknown,
): LexEditorClauseAiAction["status"] {
  const status = normalizedToken(value);
  if (status === "running" || status === "queued") return "running";
  if (status === "blocked" || status === "disabled") return "blocked";
  if (status === "applied" || status === "done") return "applied";
  return "available";
}

function normalizeClauseAiActions(
  session: Record<string, unknown>,
  root: Record<string, unknown>,
  metadataSources: Record<string, unknown>[],
): LexEditorClauseAiAction[] {
  const sources = featureSources(session, root, metadataSources);
  const source =
    recordFromKeys(sources, [
      "clause_ai",
      "clauseAi",
      "clause_level_ai",
      "clauseLevelAi",
    ]) ?? {};
  const actionRecords = recordsFrom(source.actions ?? source.items) ?? [];

  return (
    actionRecords.length > 0
      ? actionRecords
      : recordsFromKeys(sources, ["clause_ai_actions", "clauseAiActions"])
  ).map((action, index) => ({
    id: stringFrom(action.id, action.action) ?? `clause-ai-${index}`,
    clauseTitle:
      stringFrom(
        action.clause_title,
        action.clauseTitle,
        action.clause,
        action.title,
      ) ?? "Selected clause",
    action:
      stringFrom(action.action, action.type, action.label) ?? "Review with AI",
    status: normalizeClauseAiStatus(action.status),
    confidence: numberFrom(action.confidence, action.score),
    targetSection: stringFrom(action.target_section, action.targetSection),
    rationale: stringFrom(action.rationale, action.reason, action.summary),
  }));
}

function normalizeHealthMetricStatus(
  value: unknown,
): LexEditorDocumentHealthMetric["status"] {
  const status = normalizedToken(value);
  if (status === "blocked" || status === "failed" || status === "critical") {
    return "blocked";
  }
  if (status === "attention" || status === "warning" || status === "review") {
    return "attention";
  }
  return "good";
}

function normalizeDocumentHealth(
  session: Record<string, unknown>,
  root: Record<string, unknown>,
  metadataSources: Record<string, unknown>[],
  context: {
    provider: LexEditorProviderConfig;
    comments: LexEditorSessionConfig["comments"];
    trackChanges: LexEditorSessionConfig["trackChanges"];
    playbookEnforcement: LexEditorPlaybookEnforcement;
    legalIssues: LexEditorLegalIssue[];
    signatureReadiness: LexEditorSignatureReadiness;
  },
): LexEditorDocumentHealth {
  const sources = featureSources(session, root, metadataSources);
  const source =
    recordFromKeys(sources, [
      "document_health",
      "documentHealth",
      "health_score",
      "healthScore",
    ]) ?? {};
  const explicitScore = numberFrom(
    source.score,
    source.health_score,
    source.healthScore,
  );
  const openIssues = context.legalIssues.filter(
    (issue) => issue.status === "open" || issue.status === "triage",
  );
  const pendingChanges = context.trackChanges.changes.filter(
    (change) => change.status === "pending",
  ).length;
  const computedScore =
    100 -
    context.comments.unresolved * 4 -
    pendingChanges * 2 -
    context.playbookEnforcement.deviations.length * 6 -
    openIssues.length * 8 -
    (context.provider.status === "ready" ? 0 : 12) -
    context.signatureReadiness.blockers.length * 8;
  const score = clampPercent(
    explicitScore === undefined
      ? computedScore
      : explicitScore <= 1
        ? explicitScore * 100
        : explicitScore,
  );
  const metricRecords = recordsFrom(source.metrics);
  const blockers = [
    ...stringsFrom(source.blockers),
    ...context.signatureReadiness.blockers,
    ...openIssues
      .filter((issue) => issue.severity === "critical")
      .map((issue) => issue.title),
  ];

  return {
    score,
    grade: stringFrom(source.grade, source.rating),
    summary: stringFrom(source.summary, source.detail, source.description),
    blockers: Array.from(new Set(blockers)),
    metrics:
      metricRecords.length > 0
        ? metricRecords.map((metric, index) => ({
            id: stringFrom(metric.id, metric.label) ?? `health-${index}`,
            label: stringFrom(metric.label, metric.name) ?? "Health signal",
            value:
              stringFrom(metric.value, metric.count, metric.score) ?? "n/a",
            status: normalizeHealthMetricStatus(metric.status),
            detail: stringFrom(
              metric.detail,
              metric.description,
              metric.summary,
            ),
          }))
        : [
            {
              id: "provider",
              label: "Provider",
              value: context.provider.status,
              status:
                context.provider.status === "ready"
                  ? "good"
                  : context.provider.status === "error"
                    ? "blocked"
                    : "attention",
              detail: context.provider.message,
            },
            {
              id: "comments",
              label: "Unresolved comments",
              value: String(context.comments.unresolved),
              status: context.comments.unresolved > 0 ? "attention" : "good",
            },
            {
              id: "playbook",
              label: "Playbook deviations",
              value: String(context.playbookEnforcement.deviations.length),
              status:
                context.playbookEnforcement.deviations.length > 0
                  ? "attention"
                  : "good",
            },
            {
              id: "issues",
              label: "Open legal issues",
              value: String(openIssues.length),
              status: openIssues.some((issue) => issue.severity === "critical")
                ? "blocked"
                : openIssues.length > 0
                  ? "attention"
                  : "good",
            },
          ],
  };
}

function normalizePrivilegedControls(
  session: Record<string, unknown>,
  root: Record<string, unknown>,
  metadataSources: Record<string, unknown>[],
  document?: LexEditorDocumentSummary,
): LexEditorPrivilegedControls {
  const sources = featureSources(session, root, metadataSources);
  const source =
    recordFromKeys(sources, [
      "privileged_controls",
      "privilegedControls",
      "privilege_controls",
      "privilegeControls",
    ]) ?? {};
  const isPrivileged =
    normalizedToken(document?.confidentiality) === "privileged" ||
    normalizedToken(source.privilege_level) === "privileged" ||
    normalizedToken(source.privilegeLevel) === "privileged";
  const explicitControls = recordsFrom(source.controls);
  const controls =
    explicitControls.length > 0
      ? explicitControls.map((control, index) => ({
          id:
            stringFrom(control.id, control.key, control.label) ??
            `control-${index}`,
          label: stringFrom(control.label, control.name) ?? "Privilege control",
          enabled:
            booleanFrom(control.enabled, control.active, control.value) ??
            false,
          detail: stringFrom(
            control.detail,
            control.description,
            control.summary,
          ),
        }))
      : [
          {
            id: "legal-hold",
            label: "Legal hold",
            enabled: booleanFrom(source.legal_hold, source.legalHold) ?? false,
            detail: "Preserve versions, comments, and editor audit events.",
          },
          {
            id: "watermark",
            label: "Privilege watermark",
            enabled:
              booleanFrom(source.watermark, source.privilege_watermark) ??
              isPrivileged,
            detail: "Mark exported copies and provider sessions as privileged.",
          },
          {
            id: "download",
            label: "Restrict download",
            enabled:
              booleanFrom(
                source.download_restricted,
                source.downloadRestricted,
              ) ?? isPrivileged,
            detail: "Require approval before local copies are exported.",
          },
          {
            id: "external-ai",
            label: "Block external AI",
            enabled:
              booleanFrom(
                source.external_ai_restricted,
                source.externalAiRestricted,
              ) ?? isPrivileged,
            detail: "Keep privileged text out of non-approved model providers.",
          },
        ];

  return {
    privilegeLevel:
      stringFrom(source.privilege_level, source.privilegeLevel) ??
      document?.confidentiality,
    accessReviewDueAt: stringFrom(
      source.access_review_due_at,
      source.accessReviewDueAt,
    ),
    controls,
  };
}

function normalizeProviderEventStatus(
  value: unknown,
): LexEditorProviderEvent["status"] {
  const status = normalizedToken(value);
  if (status === "processed" || status === "complete") return "processed";
  if (status === "failed" || status === "error") return "failed";
  if (status === "ignored" || status === "skipped") return "ignored";
  return "received";
}

function normalizeProviderEvents(
  session: Record<string, unknown>,
  root: Record<string, unknown>,
  metadataSources: Record<string, unknown>[],
): LexEditorProviderEvent[] {
  const sources = featureSources(session, root, metadataSources);
  const source =
    recordFromKeys(sources, [
      "provider_events",
      "providerEvents",
      "webhook_events",
      "webhookEvents",
    ]) ?? {};
  const eventRecords = recordsFrom(source.events ?? source.items);

  return (
    eventRecords.length > 0
      ? eventRecords
      : recordsFromKeys(sources, [
          "provider_events",
          "providerEvents",
          "webhook_events",
          "webhookEvents",
        ])
  ).map((event, index) => ({
    id: stringFrom(event.id, event.event_id) ?? `provider-event-${index}`,
    provider: stringFrom(event.provider, event.source),
    eventType:
      stringFrom(event.event_type, event.eventType, event.type, event.action) ??
      "provider.event",
    status: normalizeProviderEventStatus(event.status),
    summary: stringFrom(event.summary, event.message, event.detail),
    createdAt: stringFrom(event.created_at, event.createdAt, event.timestamp),
  }));
}

function normalizeGuestPortalStatus(
  value: unknown,
  blocked: boolean,
): LexEditorGuestPortal["status"] {
  const status = normalizedToken(value);
  if (status === "blocked" || status === "failed") return "blocked";
  if (status === "needs_review" || status === "review") return "needs_review";
  if (status === "ready" || status === "active") return "ready";
  return blocked ? "blocked" : "ready";
}

function normalizeGuestPortal(
  session: Record<string, unknown>,
  root: Record<string, unknown>,
  metadataSources: Record<string, unknown>[],
  guests: LexEditorGuestReviewer[],
): LexEditorGuestPortal {
  const sources = featureSources(session, root, metadataSources);
  const source =
    recordFromKeys(sources, [
      "guest_portal",
      "guestPortal",
      "guest_portal_status",
      "guestPortalStatus",
    ]) ?? {};
  const activeLinks =
    numberFrom(source.active_links, source.activeLinks) ??
    guests.filter((guest) => guest.status === "active" || guest.status === "invited")
      .length;
  const expiredLinks =
    numberFrom(source.expired_links, source.expiredLinks) ??
    guests.filter((guest) => guest.status === "expired").length;
  const revokedLinks =
    numberFrom(source.revoked_links, source.revokedLinks) ??
    guests.filter((guest) => guest.status === "revoked").length;
  const blocked = revokedLinks > 0 && activeLinks === 0;

  return {
    status: normalizeGuestPortalStatus(source.status, blocked),
    activeLinks,
    expiredLinks,
    revokedLinks,
    lastActivityAt: stringFrom(
      source.last_guest_activity_at,
      source.lastGuestActivityAt,
      source.last_activity_at,
    ),
    watermarkEnabled:
      booleanFrom(source.watermark_enabled, source.watermarkEnabled) ?? false,
  };
}

function normalizeAutomationTaskStatus(
  value: unknown,
): LexEditorAutomationTask["status"] {
  const status = normalizedToken(value);
  if (status === "done" || status === "complete" || status === "completed")
    return "done";
  if (status === "blocked" || status === "failed") return "blocked";
  if (status === "in_progress" || status === "active") return "in_progress";
  return "open";
}

function normalizeAutomationTasks(
  session: Record<string, unknown>,
  root: Record<string, unknown>,
  metadataSources: Record<string, unknown>[],
): LexEditorAutomationTask[] {
  const sources = featureSources(session, root, metadataSources);
  const source =
    recordFromKeys(sources, [
      "task_automation",
      "taskAutomation",
      "automation_tasks",
      "automationTasks",
    ]) ?? {};
  const taskRecords = recordsFrom(source.tasks ?? source.items);

  return (
    taskRecords.length > 0
      ? taskRecords
      : recordsFromKeys(sources, ["automation_tasks", "automationTasks", "tasks"])
  ).map((task, index) => ({
    id: stringFrom(task.id, task.task_id) ?? `task-${index}`,
    title: stringFrom(task.title, task.name, task.summary) ?? "Document task",
    taskType:
      stringFrom(task.task_type, task.taskType, task.type, task.source_type) ??
      "editor",
    status: normalizeAutomationTaskStatus(task.status),
    priority: normalizeRiskLevel(task.priority ?? task.severity),
    ownerName: stringFrom(task.owner_name, task.ownerName, task.assignee),
    dueAt: stringFrom(task.due_at, task.dueAt, task.deadline),
  }));
}

function normalizeClauseAnchorStatus(
  value: unknown,
): LexEditorClauseAnchor["status"] {
  const status = normalizedToken(value);
  if (status === "stale" || status === "moved") return "stale";
  if (status === "missing" || status === "broken") return "missing";
  return "anchored";
}

function normalizeClauseAnchors(
  session: Record<string, unknown>,
  root: Record<string, unknown>,
  metadataSources: Record<string, unknown>[],
): LexEditorClauseAnchor[] {
  const sources = featureSources(session, root, metadataSources);
  const source =
    recordFromKeys(sources, [
      "clause_anchors",
      "clauseAnchors",
      "section_anchors",
      "sectionAnchors",
    ]) ?? {};
  const anchorRecords = recordsFrom(source.anchors ?? source.items);

  return (
    anchorRecords.length > 0
      ? anchorRecords
      : recordsFromKeys(sources, ["clause_anchors", "clauseAnchors", "anchors"])
  ).map((anchor, index) => ({
    id: stringFrom(anchor.id, anchor.clause_id, anchor.section_id) ?? `anchor-${index}`,
    label:
      stringFrom(anchor.label, anchor.title, anchor.clause, anchor.section) ??
      "Clause anchor",
    section: stringFrom(anchor.section, anchor.section_id, anchor.sectionId),
    path: stringFrom(anchor.path, anchor.reference, anchor.numbering),
    status: normalizeClauseAnchorStatus(anchor.status),
    excerpt: stringFrom(anchor.excerpt, anchor.text, anchor.preview),
  }));
}

function normalizeRedlinePackageStatus(
  value: unknown,
): LexEditorRedlinePackage["status"] {
  const status = normalizedToken(value);
  if (status === "generating" || status === "running") return "generating";
  if (status === "ready" || status === "complete") return "ready";
  if (status === "failed" || status === "error") return "failed";
  return "queued";
}

function normalizeRedlinePackages(
  session: Record<string, unknown>,
  root: Record<string, unknown>,
  metadataSources: Record<string, unknown>[],
): LexEditorRedlinePackage[] {
  const sources = featureSources(session, root, metadataSources);
  const source =
    recordFromKeys(sources, [
      "redline_packages",
      "redlinePackages",
      "export_packages",
      "exportPackages",
    ]) ?? {};
  const packageRecords = recordsFrom(source.packages ?? source.items);

  return (
    packageRecords.length > 0
      ? packageRecords
      : recordsFromKeys(sources, ["redline_packages", "redlinePackages"])
  ).map((pkg, index) => ({
    id: stringFrom(pkg.id, pkg.package_id) ?? `redline-${index}`,
    status: normalizeRedlinePackageStatus(pkg.status),
    packageType: stringFrom(pkg.package_type, pkg.packageType, pkg.type),
    formats: stringsFrom(pkg.formats),
    downloadUrl: stringFrom(pkg.download_url, pkg.downloadUrl, pkg.url),
    createdAt: stringFrom(pkg.created_at, pkg.createdAt),
    summary: stringFrom(pkg.summary, pkg.description),
  }));
}

function normalizeApprovalGateStatus(
  value: unknown,
): LexEditorApprovalGate["status"] {
  const status = normalizedToken(value);
  if (status === "approved" || status === "complete") return "approved";
  if (status === "rejected" || status === "denied") return "rejected";
  if (status === "blocked" || status === "failed") return "blocked";
  if (status === "pending" || status === "waiting") return "pending";
  return "not_started";
}

function normalizeApprovalMatrixStatus(
  value: unknown,
  gates: LexEditorApprovalGate[],
): LexEditorApprovalMatrix["status"] {
  const status = normalizedToken(value);
  if (status === "blocked" || status === "failed") return "blocked";
  if (status === "pending" || status === "waiting") return "pending";
  if (status === "clear" || status === "approved") return "clear";
  if (gates.some((gate) => gate.status === "blocked" || gate.status === "rejected"))
    return "blocked";
  if (gates.some((gate) => gate.status === "pending")) return "pending";
  return "clear";
}

function normalizeApprovalMatrix(
  session: Record<string, unknown>,
  root: Record<string, unknown>,
  metadataSources: Record<string, unknown>[],
): LexEditorApprovalMatrix {
  const sources = featureSources(session, root, metadataSources);
  const source =
    recordFromKeys(sources, [
      "approval_matrix",
      "approvalMatrix",
      "approval_gates",
      "approvalGates",
    ]) ?? {};
  const gateRecords = recordsFrom(source.gates ?? source.items);
  const gates = (
    gateRecords.length > 0
      ? gateRecords
      : recordsFromKeys(sources, ["approval_gates", "approvalGates"])
  ).map((gate, index) => ({
    id: stringFrom(gate.id, gate.key, gate.name) ?? `approval-${index}`,
    name: stringFrom(gate.name, gate.title, gate.label) ?? "Approval gate",
    status: normalizeApprovalGateStatus(gate.status),
    required: booleanFrom(gate.required, gate.mandatory) ?? true,
    approverName: stringFrom(gate.approver_name, gate.approverName, gate.owner_name),
    dueAt: stringFrom(gate.due_at, gate.dueAt, gate.deadline),
    severity: normalizeRiskLevel(gate.severity ?? gate.priority),
  }));

  return {
    status: normalizeApprovalMatrixStatus(source.status, gates),
    nextGateId: stringFrom(source.next_gate_id, source.nextGateId),
    gates,
  };
}

function normalizeCompareStatus(
  value: unknown,
): LexEditorCompareWorkspace["status"] {
  const status = normalizedToken(value);
  if (status === "running" || status === "comparing") return "running";
  if (status === "ready" || status === "complete") return "ready";
  if (status === "failed" || status === "error") return "failed";
  return "queued";
}

function normalizeCompareWorkspaces(
  session: Record<string, unknown>,
  root: Record<string, unknown>,
  metadataSources: Record<string, unknown>[],
): LexEditorCompareWorkspace[] {
  const sources = featureSources(session, root, metadataSources);
  const source =
    recordFromKeys(sources, [
      "compare_workspace",
      "compareWorkspace",
      "compare_workspaces",
      "compareWorkspaces",
    ]) ?? {};
  const compareRecords = recordsFrom(source.comparisons ?? source.items);
  const records =
    compareRecords.length > 0
      ? compareRecords
      : recordsFromKeys(sources, ["compare_workspaces", "compareWorkspaces"]);
  const single = records.length > 0 || Object.keys(source).length === 0 ? records : [source];

  return single.map((comparison, index) => ({
    id: stringFrom(comparison.id, comparison.compare_id) ?? `compare-${index}`,
    baseLabel: stringFrom(comparison.base_label, comparison.baseLabel, comparison.base_version),
    targetLabel: stringFrom(
      comparison.target_label,
      comparison.targetLabel,
      comparison.target_version,
    ),
    status: normalizeCompareStatus(comparison.status),
    changesCount:
      numberFrom(comparison.changes_count, comparison.changesCount) ?? 0,
    materialChangesCount:
      numberFrom(
        comparison.material_changes_count,
        comparison.materialChangesCount,
      ) ?? 0,
    redlineUrl: stringFrom(comparison.redline_url, comparison.redlineUrl),
    summary: stringFrom(comparison.summary, comparison.description),
    createdAt: stringFrom(comparison.created_at, comparison.createdAt),
  }));
}

function normalizeInboxItemStatus(
  value: unknown,
): LexEditorCollaborationInboxItem["status"] {
  const status = normalizedToken(value);
  if (status === "read" || status === "seen") return "read";
  if (status === "done" || status === "resolved") return "done";
  if (status === "snoozed" || status === "deferred") return "snoozed";
  return "unread";
}

function normalizeCollaborationInbox(
  session: Record<string, unknown>,
  root: Record<string, unknown>,
  metadataSources: Record<string, unknown>[],
): LexEditorCollaborationInbox {
  const sources = featureSources(session, root, metadataSources);
  const source =
    recordFromKeys(sources, [
      "collaboration_inbox",
      "collaborationInbox",
      "inbox",
    ]) ?? {};
  const itemRecords = recordsFrom(source.items ?? source.notifications);
  const items = (
    itemRecords.length > 0
      ? itemRecords
      : recordsFromKeys(sources, ["collaboration_items", "notifications"])
  ).map((item, index) => ({
    id: stringFrom(item.id, item.notification_id) ?? `inbox-${index}`,
    itemType: stringFrom(item.item_type, item.itemType, item.type) ?? "update",
    title: stringFrom(item.title, item.summary, item.message) ?? "Editor update",
    status: normalizeInboxItemStatus(item.status),
    actorName: stringFrom(item.actor_name, item.actorName, item.author),
    priority: normalizeRiskLevel(item.priority ?? item.severity),
    createdAt: stringFrom(item.created_at, item.createdAt, item.timestamp),
  }));

  return {
    unreadCount:
      numberFrom(source.unread_count, source.unreadCount) ??
      items.filter((item) => item.status === "unread").length,
    items,
  };
}

function normalizeRuleLinkStatus(
  value: unknown,
): LexEditorPlaybookRuleLink["status"] {
  const status = normalizedToken(value);
  if (status === "active" || status === "published") return "active";
  if (status === "approval_required" || status === "pending_approval")
    return "approval_required";
  if (status === "archived" || status === "disabled") return "archived";
  return "draft";
}

function normalizePlaybookRuleLinks(
  session: Record<string, unknown>,
  root: Record<string, unknown>,
  metadataSources: Record<string, unknown>[],
): LexEditorPlaybookRuleLink[] {
  const sources = featureSources(session, root, metadataSources);
  const source =
    recordFromKeys(sources, [
      "playbook_rule_builder",
      "playbookRuleBuilder",
      "playbook_rules",
      "playbookRules",
    ]) ?? {};
  const ruleRecords = recordsFrom(source.links ?? source.rules ?? source.items);

  return (
    ruleRecords.length > 0
      ? ruleRecords
      : recordsFromKeys(sources, ["playbook_rule_links", "playbookRuleLinks"])
  ).map((rule, index) => ({
    id: stringFrom(rule.id, rule.playbook_id, rule.name) ?? `rule-${index}`,
    name: stringFrom(rule.name, rule.title, rule.playbook_name) ?? "Playbook rules",
    status: normalizeRuleLinkStatus(rule.status),
    ruleCount: numberFrom(rule.rule_count, rule.ruleCount, rule.count) ?? 0,
    href: stringFrom(rule.href, rule.url),
    updatedAt: stringFrom(rule.updated_at, rule.updatedAt),
  }));
}

function normalizeTermRepairStatus(
  value: unknown,
): LexEditorTermRepairAction["status"] {
  const status = normalizedToken(value);
  if (status === "queued" || status === "running") return "queued";
  if (status === "applied" || status === "done") return "applied";
  if (status === "dismissed" || status === "ignored") return "dismissed";
  return "suggested";
}

function normalizeTermRepairActions(
  session: Record<string, unknown>,
  root: Record<string, unknown>,
  metadataSources: Record<string, unknown>[],
): LexEditorTermRepairAction[] {
  const sources = featureSources(session, root, metadataSources);
  const source =
    recordFromKeys(sources, [
      "term_repairs",
      "termRepairs",
      "defined_term_repairs",
      "definedTermRepairs",
    ]) ?? {};
  const repairRecords = recordsFrom(source.repairs ?? source.actions ?? source.items);

  return (
    repairRecords.length > 0
      ? repairRecords
      : recordsFromKeys(sources, ["term_repair_actions", "termRepairActions"])
  ).map((repair, index) => ({
    id: stringFrom(repair.id, repair.term) ?? `term-repair-${index}`,
    term: stringFrom(repair.term, repair.name) ?? "Defined term",
    action: stringFrom(repair.action, repair.type) ?? "repair",
    status: normalizeTermRepairStatus(repair.status),
    severity: normalizeRiskLevel(repair.severity ?? repair.priority),
    section: stringFrom(repair.section, repair.section_id, repair.location),
    preview: stringFrom(repair.preview, repair.replacement_text, repair.summary),
  }));
}

function normalizeEvidenceBindingStatus(
  value: unknown,
): LexEditorEvidenceBinding["status"] {
  const status = normalizedToken(value);
  if (status === "missing" || status === "unlinked") return "missing";
  if (status === "stale" || status === "outdated") return "stale";
  if (status === "needs_review" || status === "review") return "needs_review";
  return "linked";
}

function normalizeEvidenceBindings(
  session: Record<string, unknown>,
  root: Record<string, unknown>,
  metadataSources: Record<string, unknown>[],
): LexEditorEvidenceBinding[] {
  const sources = featureSources(session, root, metadataSources);
  const source =
    recordFromKeys(sources, [
      "evidence_bindings",
      "evidenceBindings",
      "citations",
      "citation_bindings",
    ]) ?? {};
  const bindingRecords = recordsFrom(source.bindings ?? source.items);

  return (
    bindingRecords.length > 0
      ? bindingRecords
      : recordsFromKeys(sources, ["evidence_bindings", "evidenceBindings", "citations"])
  ).map((binding, index) => ({
    id: stringFrom(binding.id, binding.source_id, binding.title) ?? `evidence-${index}`,
    title: stringFrom(binding.title, binding.name, binding.citation) ?? "Evidence binding",
    sourceType:
      stringFrom(binding.source_type, binding.sourceType, binding.type) ??
      "document",
    status: normalizeEvidenceBindingStatus(binding.status),
    section: stringFrom(binding.section, binding.section_id, binding.location),
    confidence: numberFrom(binding.confidence, binding.score),
    citation: stringFrom(binding.citation, binding.reference),
  }));
}

function normalizeAIChangeSafetyMode(
  value: unknown,
  enabled: boolean,
): LexEditorAIChangeSafety["mode"] {
  const mode = normalizedToken(value);
  if (mode === "disabled" || !enabled) return "disabled";
  if (mode === "approval_required" || mode === "approve") return "approval_required";
  return "preview_only";
}

function normalizeAIChangeSafety(
  session: Record<string, unknown>,
  root: Record<string, unknown>,
  metadataSources: Record<string, unknown>[],
): LexEditorAIChangeSafety {
  const sources = featureSources(session, root, metadataSources);
  const source =
    recordFromKeys(sources, [
      "ai_change_safety",
      "aiChangeSafety",
      "ai_safety",
      "aiSafety",
    ]) ?? {};
  const enabled = booleanFrom(source.enabled, source.active) ?? true;

  return {
    enabled,
    mode: normalizeAIChangeSafetyMode(source.mode, enabled),
    pendingProposals:
      numberFrom(source.pending_proposals, source.pendingProposals) ?? 0,
    requiredApprovals:
      numberFrom(source.required_approvals, source.requiredApprovals) ?? 1,
    blockers: stringsFrom(source.blockers),
  };
}

function normalizeOfflineRecoveryStatus(
  value: unknown,
): LexEditorOfflineRecovery["status"] {
  const status = normalizedToken(value);
  if (status === "buffering" || status === "queued") return "buffering";
  if (status === "restore_available" || status === "available")
    return "restore_available";
  if (status === "conflict" || status === "conflicted") return "conflict";
  return "clear";
}

function normalizeOfflineRecovery(
  session: Record<string, unknown>,
  root: Record<string, unknown>,
  metadataSources: Record<string, unknown>[],
  autosave: LexEditorAutosaveState,
): LexEditorOfflineRecovery {
  const sources = featureSources(session, root, metadataSources);
  const source =
    recordFromKeys(sources, [
      "offline_recovery",
      "offlineRecovery",
      "recovery_buffer",
      "recoveryBuffer",
    ]) ?? {};

  return {
    status: normalizeOfflineRecoveryStatus(source.status),
    queuedEdits: numberFrom(source.queued_edits, source.queuedEdits) ?? 0,
    queuedComments:
      numberFrom(source.queued_comments, source.queuedComments) ?? 0,
    conflictCount:
      numberFrom(source.conflict_count, source.conflictCount) ??
      autosave.conflictCount,
    lastBufferedAt: stringFrom(
      source.last_buffered_at,
      source.lastBufferedAt,
      autosave.recoveryPointAt,
    ),
  };
}

function normalizeTrend(
  value: unknown,
): LexEditorAnalytics["signatureReadinessTrend"] {
  const trend = normalizedToken(value);
  if (trend === "improving" || trend === "up") return "improving";
  if (trend === "declining" || trend === "down") return "declining";
  if (trend === "flat" || trend === "steady") return "flat";
  return undefined;
}

function normalizeEditorAnalytics(
  session: Record<string, unknown>,
  root: Record<string, unknown>,
  metadataSources: Record<string, unknown>[],
  context: {
    trackChanges: LexEditorSessionConfig["trackChanges"];
    legalIssues: LexEditorLegalIssue[];
    playbookEnforcement: LexEditorPlaybookEnforcement;
  },
): LexEditorAnalytics {
  const sources = featureSources(session, root, metadataSources);
  const source =
    recordFromKeys(sources, [
      "editor_analytics",
      "editorAnalytics",
      "analytics",
      "document_analytics",
    ]) ?? {};
  const unresolvedIssueCount = context.legalIssues.filter(
    (issue) => issue.status === "open" || issue.status === "triage",
  ).length;
  const deviationRate =
    context.playbookEnforcement.requiredClausesTotal > 0
      ? context.playbookEnforcement.deviations.length /
        context.playbookEnforcement.requiredClausesTotal
      : undefined;

  return {
    cycleTimeHours: numberFrom(source.cycle_time_hours, source.cycleTimeHours),
    revisionCount:
      numberFrom(source.revision_count, source.revisionCount) ??
      context.trackChanges.total,
    unresolvedIssueCount:
      numberFrom(source.unresolved_issue_count, source.unresolvedIssueCount) ??
      unresolvedIssueCount,
    playbookDeviationRate:
      numberFrom(source.playbook_deviation_rate, source.playbookDeviationRate) ??
      deviationRate,
    approvalDelayHours: numberFrom(
      source.approval_delay_hours,
      source.approvalDelayHours,
    ),
    externalReviewTurnaroundHours: numberFrom(
      source.external_review_turnaround_hours,
      source.externalReviewTurnaroundHours,
    ),
    signatureReadinessTrend: normalizeTrend(
      source.signature_readiness_trend ?? source.signatureReadinessTrend,
    ),
    generatedAt: stringFrom(source.generated_at, source.generatedAt),
  };
}

export function normalizeEditorSessionResponse(
  response: unknown,
  documentId: string,
  requestedMode: LexEditorMode,
): LexEditorSessionConfig {
  const root = unwrapSessionResponse(response);
  const session =
    recordFrom(root.editor_session) ?? recordFrom(root.session) ?? root;
  const provider = normalizeProviderConfig(session, root);
  const availableModes = normalizeModes(
    session.available_modes ?? session.modes,
  );
  const mode =
    normalizeMode(session.mode) ??
    (availableModes.includes(requestedMode)
      ? requestedMode
      : (availableModes[0] ?? "view"));
  const readOnly =
    booleanFrom(session.read_only, session.readonly, session.readOnly) ??
    (mode === "view" || provider.status === "unavailable");
  const autosave = normalizeAutosave(session, provider.hasConfig);
  const document =
    documentSummaryFrom(session.document, documentId) ??
    documentSummaryFrom(root.document, documentId);
  const metadataSources = metadataSourcesFrom(session, root, document);
  const comments = normalizeComments(session);
  const trackChanges = normalizeTrackChanges(session);
  const clauseLibrary = normalizeClauseLibrary(session);
  const audit = normalizeAudit(session);
  const negotiationRoom = normalizeNegotiationRoom(
    session,
    root,
    metadataSources,
  );
  const playbookEnforcement = normalizePlaybookEnforcement(
    session,
    root,
    metadataSources,
  );
  const termsNavigator = normalizeTermsNavigator(
    session,
    root,
    metadataSources,
  );
  const sectionAssignments = normalizeSectionAssignments(
    session,
    root,
    metadataSources,
  );
  const guestReviewers = normalizeGuestReviewers(
    session,
    root,
    metadataSources,
  );
  const legalIssues = normalizeLegalIssues(session, root, metadataSources);
  const signatureReadiness = normalizeSignatureReadiness(
    session,
    root,
    metadataSources,
  );
  const clauseAiActions = normalizeClauseAiActions(
    session,
    root,
    metadataSources,
  );
  const documentHealth = normalizeDocumentHealth(
    session,
    root,
    metadataSources,
    {
      provider,
      comments,
      trackChanges,
      playbookEnforcement,
      legalIssues,
      signatureReadiness,
    },
  );
  const privilegedControls = normalizePrivilegedControls(
    session,
    root,
    metadataSources,
    document,
  );
  const providerEvents = normalizeProviderEvents(session, root, metadataSources);
  const guestPortal = normalizeGuestPortal(
    session,
    root,
    metadataSources,
    guestReviewers,
  );
  const automationTasks = normalizeAutomationTasks(
    session,
    root,
    metadataSources,
  );
  const clauseAnchors = normalizeClauseAnchors(session, root, metadataSources);
  const redlinePackages = normalizeRedlinePackages(
    session,
    root,
    metadataSources,
  );
  const approvalMatrix = normalizeApprovalMatrix(
    session,
    root,
    metadataSources,
  );
  const compareWorkspaces = normalizeCompareWorkspaces(
    session,
    root,
    metadataSources,
  );
  const collaborationInbox = normalizeCollaborationInbox(
    session,
    root,
    metadataSources,
  );
  const playbookRuleLinks = normalizePlaybookRuleLinks(
    session,
    root,
    metadataSources,
  );
  const termRepairActions = normalizeTermRepairActions(
    session,
    root,
    metadataSources,
  );
  const evidenceBindings = normalizeEvidenceBindings(
    session,
    root,
    metadataSources,
  );
  const aiChangeSafety = normalizeAIChangeSafety(
    session,
    root,
    metadataSources,
  );
  const offlineRecovery = normalizeOfflineRecovery(
    session,
    root,
    metadataSources,
    autosave,
  );
  const editorAnalytics = normalizeEditorAnalytics(
    session,
    root,
    metadataSources,
    {
      trackChanges,
      legalIssues,
      playbookEnforcement,
    },
  );

  return {
    sessionId: stringFrom(session.session_id, session.sessionId, session.id),
    documentId:
      stringFrom(session.document_id, session.documentId, document?.id) ??
      documentId,
    document,
    mode,
    availableModes,
    readOnly,
    provider,
    lock: normalizeLock(session, readOnly),
    autosave,
    version: {
      currentVersion: numberFrom(
        session.current_version,
        session.currentVersion,
        document?.currentVersion,
      ),
      latestSnapshotAt: stringFrom(
        session.latest_snapshot_at,
        session.latestSnapshotAt,
      ),
      pendingChanges:
        numberFrom(session.pending_changes, session.pendingChanges) ?? 0,
      snapshotAllowed:
        booleanFrom(session.snapshot_allowed, session.snapshotAllowed) ??
        !readOnly,
    },
    comments,
    trackChanges,
    clauseLibrary,
    audit,
    negotiationRoom,
    playbookEnforcement,
    termsNavigator,
    sectionAssignments,
    guestReviewers,
    legalIssues,
    signatureReadiness,
    clauseAiActions,
    documentHealth,
    privilegedControls,
    providerEvents,
    guestPortal,
    automationTasks,
    clauseAnchors,
    redlinePackages,
    approvalMatrix,
    compareWorkspaces,
    collaborationInbox,
    playbookRuleLinks,
    termRepairActions,
    evidenceBindings,
    aiChangeSafety,
    offlineRecovery,
    editorAnalytics,
  };
}

export async function fetchLexEditorSession(
  documentId: string,
  mode: LexEditorMode,
): Promise<LexEditorSessionConfig> {
  const response = await enterpriseApi.lex.openDocumentEditor(documentId, {
    mode,
    provider: "onlyoffice",
    source: "lex-document-editor",
  });
  return normalizeEditorSessionResponse(response, documentId, mode);
}

export function buildFallbackEditorSession(
  document: LexDocument,
  requestedMode: LexEditorMode,
): LexEditorSessionConfig {
  const readOnly = requestedMode === "view" || document.status === "archived";
  const documentSummary = buildDocumentEditorSummary(document);
  const fallbackSession: Record<string, unknown> = {
    document: documentSummary,
    document_id: document.id,
    metadata: document.metadata,
    mode: requestedMode,
    read_only: readOnly,
  };
  const fallbackRoot: Record<string, unknown> = {
    document: documentSummary,
    metadata: document.metadata,
  };
  const metadataSources = metadataSourcesFrom(
    fallbackSession,
    fallbackRoot,
    documentSummary,
  );
  const provider: LexEditorProviderConfig = {
    provider: "unconfigured",
    label: providerLabel("unconfigured"),
    status: "unavailable",
    hasConfig: false,
    message:
      "Lex did not return an editor provider configuration for this document.",
    capabilities: [],
  };
  const comments = normalizeComments(fallbackSession);
  const trackChanges = normalizeTrackChanges(fallbackSession);
  const autosave: LexEditorAutosaveState = {
    status: "disabled",
    conflictCount: 0,
    message: "Autosave starts when an editor provider session is available.",
  };
  const clauseLibrary = normalizeClauseLibrary(fallbackSession);
  const audit = normalizeAudit(fallbackSession);
  const negotiationRoom = normalizeNegotiationRoom(
    fallbackSession,
    fallbackRoot,
    metadataSources,
  );
  const playbookEnforcement = normalizePlaybookEnforcement(
    fallbackSession,
    fallbackRoot,
    metadataSources,
  );
  const termsNavigator = normalizeTermsNavigator(
    fallbackSession,
    fallbackRoot,
    metadataSources,
  );
  const sectionAssignments = normalizeSectionAssignments(
    fallbackSession,
    fallbackRoot,
    metadataSources,
  );
  const guestReviewers = normalizeGuestReviewers(
    fallbackSession,
    fallbackRoot,
    metadataSources,
  );
  const legalIssues = normalizeLegalIssues(
    fallbackSession,
    fallbackRoot,
    metadataSources,
  );
  const signatureReadiness = normalizeSignatureReadiness(
    fallbackSession,
    fallbackRoot,
    metadataSources,
  );
  const clauseAiActions = normalizeClauseAiActions(
    fallbackSession,
    fallbackRoot,
    metadataSources,
  );
  const documentHealth = normalizeDocumentHealth(
    fallbackSession,
    fallbackRoot,
    metadataSources,
    {
      provider,
      comments,
      trackChanges,
      playbookEnforcement,
      legalIssues,
      signatureReadiness,
    },
  );
  const privilegedControls = normalizePrivilegedControls(
    fallbackSession,
    fallbackRoot,
    metadataSources,
    documentSummary,
  );
  const providerEvents = normalizeProviderEvents(
    fallbackSession,
    fallbackRoot,
    metadataSources,
  );
  const guestPortal = normalizeGuestPortal(
    fallbackSession,
    fallbackRoot,
    metadataSources,
    guestReviewers,
  );
  const automationTasks = normalizeAutomationTasks(
    fallbackSession,
    fallbackRoot,
    metadataSources,
  );
  const clauseAnchors = normalizeClauseAnchors(
    fallbackSession,
    fallbackRoot,
    metadataSources,
  );
  const redlinePackages = normalizeRedlinePackages(
    fallbackSession,
    fallbackRoot,
    metadataSources,
  );
  const approvalMatrix = normalizeApprovalMatrix(
    fallbackSession,
    fallbackRoot,
    metadataSources,
  );
  const compareWorkspaces = normalizeCompareWorkspaces(
    fallbackSession,
    fallbackRoot,
    metadataSources,
  );
  const collaborationInbox = normalizeCollaborationInbox(
    fallbackSession,
    fallbackRoot,
    metadataSources,
  );
  const playbookRuleLinks = normalizePlaybookRuleLinks(
    fallbackSession,
    fallbackRoot,
    metadataSources,
  );
  const termRepairActions = normalizeTermRepairActions(
    fallbackSession,
    fallbackRoot,
    metadataSources,
  );
  const evidenceBindings = normalizeEvidenceBindings(
    fallbackSession,
    fallbackRoot,
    metadataSources,
  );
  const aiChangeSafety = normalizeAIChangeSafety(
    fallbackSession,
    fallbackRoot,
    metadataSources,
  );
  const offlineRecovery = normalizeOfflineRecovery(
    fallbackSession,
    fallbackRoot,
    metadataSources,
    autosave,
  );
  const editorAnalytics = normalizeEditorAnalytics(
    fallbackSession,
    fallbackRoot,
    metadataSources,
    {
      trackChanges,
      legalIssues,
      playbookEnforcement,
    },
  );

  return {
    documentId: document.id,
    document: documentSummary,
    mode: requestedMode,
    availableModes: [...LEX_EDITOR_MODES],
    readOnly,
    provider,
    lock: {
      status: readOnly ? "read_only" : "unlocked",
      canCheckOut: !readOnly,
      message: readOnly
        ? "Document is currently opened in read-only mode."
        : undefined,
    },
    autosave,
    version: {
      currentVersion: document.current_version,
      pendingChanges: 0,
      snapshotAllowed: false,
    },
    comments,
    trackChanges,
    clauseLibrary,
    audit,
    negotiationRoom,
    playbookEnforcement,
    termsNavigator,
    sectionAssignments,
    guestReviewers,
    legalIssues,
    signatureReadiness,
    clauseAiActions,
    documentHealth,
    privilegedControls,
    providerEvents,
    guestPortal,
    automationTasks,
    clauseAnchors,
    redlinePackages,
    approvalMatrix,
    compareWorkspaces,
    collaborationInbox,
    playbookRuleLinks,
    termRepairActions,
    evidenceBindings,
    aiChangeSafety,
    offlineRecovery,
    editorAnalytics,
  };
}

export function useLexEditorSession(
  documentId: string | null,
  mode: LexEditorMode,
) {
  const sessionQuery = useQuery({
    queryKey: ["lex-document-editor-session", documentId, mode],
    queryFn: () => fetchLexEditorSession(documentId as string, mode),
    enabled: Boolean(documentId),
    retry: false,
  });

  const documentQuery = useQuery({
    queryKey: ["lex-document-editor-document", documentId],
    queryFn: () => enterpriseApi.lex.getDocument(documentId as string),
    enabled: Boolean(documentId),
  });

  const session = useMemo(() => {
    if (sessionQuery.data) {
      if (!sessionQuery.data.document && documentQuery.data) {
        return {
          ...sessionQuery.data,
          document: buildDocumentEditorSummary(documentQuery.data),
        };
      }
      return sessionQuery.data;
    }
    if (documentQuery.data) {
      return buildFallbackEditorSession(documentQuery.data, mode);
    }
    return undefined;
  }, [documentQuery.data, mode, sessionQuery.data]);

  return {
    session,
    document: documentQuery.data,
    sessionError: sessionQuery.error,
    documentError: documentQuery.error,
    sessionUnavailable: sessionQuery.isError,
    isLoading:
      Boolean(documentId) &&
      !session &&
      (sessionQuery.isLoading || documentQuery.isLoading),
    isRefetching: sessionQuery.isFetching || documentQuery.isFetching,
    refetch: async () => {
      await Promise.allSettled([
        sessionQuery.refetch(),
        documentQuery.refetch(),
      ]);
    },
  };
}
