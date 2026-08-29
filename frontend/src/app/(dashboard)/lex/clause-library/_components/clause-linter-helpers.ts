'use client';

import type {
  JsonObject,
  JsonValue,
  LexClauseLibraryEntry,
  LexUpdateClauseLibraryEntryPayload,
} from '@/types/suites';

export type ClauseLibraryGovernanceIntent =
  | 'submit_review'
  | 'approve'
  | 'request_changes'
  | 'reject';

export type ClauseQualitySeverity = 'error' | 'warning' | 'info';
export type ClauseQualityGrade = 'A' | 'B' | 'C' | 'D';
export type ClauseQualityState = ClauseQualitySeverity | 'clean';

export interface ClauseQualityIssue {
  id: string;
  severity: ClauseQualitySeverity;
  title: string;
  description: string;
  field?: keyof LexClauseLibraryEntry | 'metadata';
  recommendation?: string;
}

export interface ClauseQualityResult {
  entry: LexClauseLibraryEntry;
  score: number;
  grade: ClauseQualityGrade;
  state: ClauseQualityState;
  issues: ClauseQualityIssue[];
  errorCount: number;
  warningCount: number;
  infoCount: number;
}

export interface ClauseQualitySummary {
  total: number;
  averageScore: number;
  cleanCount: number;
  errorCount: number;
  warningCount: number;
  infoCount: number;
  highestRisk: ClauseQualityResult[];
}

export interface GovernanceQueueItem {
  entry: LexClauseLibraryEntry;
  quality: ClauseQualityResult;
  status: string;
  priority: number;
  priorityLabel: 'Critical' | 'High' | 'Medium' | 'Low';
  ageDays: number;
  availableIntents: ClauseLibraryGovernanceIntent[];
}

export interface DeleteImpactReference {
  kind:
    | 'superseded_by'
    | 'deprecated_by'
    | 'replacement_for'
    | 'metadata_reference'
    | 'same_code'
    | 'outbound_link';
  severity: 'blocker' | 'warning' | 'info';
  entry: LexClauseLibraryEntry;
  description: string;
}

export interface DeleteImpactReason {
  severity: 'blocker' | 'warning' | 'info';
  title: string;
  description: string;
}

export interface ClauseDeleteImpact {
  entry: LexClauseLibraryEntry;
  severity: 'blocked' | 'risky' | 'clear';
  recommendedAction: 'deprecate' | 'delete';
  reasons: DeleteImpactReason[];
  references: DeleteImpactReference[];
  replacementCandidates: LexClauseLibraryEntry[];
}

export interface ClauseLibrarySavedViewState {
  search?: string;
  filters?: Record<string, string | string[]>;
  sortColumn?: string;
  sortDirection?: 'asc' | 'desc';
  pageSize?: number;
}

export interface ClauseLibrarySavedView {
  id: string;
  name: string;
  state: ClauseLibrarySavedViewState;
  createdAt: string;
  updatedAt: string;
}

export interface ClauseBulkUpdateRequest {
  ids: string[];
  patch: LexUpdateClauseLibraryEntryPayload;
  entries: LexClauseLibraryEntry[];
}

export const CLAUSE_LIBRARY_SAVED_VIEWS_STORAGE_KEY =
  'lex.clauseLibrary.savedViews.v1';
export const CLAUSE_LIBRARY_PINNED_CLAUSES_STORAGE_KEY =
  'lex.clauseLibrary.pinnedClauseIds.v1';

const GOVERNANCE_REVIEW_STATUSES = new Set(['pending_review', 'in_review', 'rejected']);
const ACTIVE_GOVERNANCE_STATUSES = new Set(['approved', 'active']);
const ACTIVE_LIBRARY_STATUSES = new Set(['active', 'approved']);
const HIGH_RISK_LEVELS = new Set(['high', 'critical']);

export function lintClauseLibraryEntry(
  entry: LexClauseLibraryEntry,
  allEntries: LexClauseLibraryEntry[] = [],
): ClauseQualityResult {
  const issues: ClauseQualityIssue[] = [];
  const status = normalizeClauseToken(entry.status);
  const governanceStatus = normalizeGovernanceToken(entry.governance_status);
  const riskLevel = normalizeClauseToken(entry.risk_level);
  const language = normalizeClauseToken(entry.language);
  const textEn = entry.text_en?.trim() ?? '';
  const textAr = entry.text_ar?.trim() ?? '';

  const addIssue = (issue: ClauseQualityIssue) => {
    issues.push(issue);
  };

  if (!entry.code?.trim()) {
    addIssue({
      id: 'missing-code',
      severity: 'error',
      title: 'Missing clause code',
      description: 'The clause cannot be governed or referenced reliably without a stable code.',
      field: 'code',
      recommendation: 'Assign a unique code before publishing.',
    });
  }

  if (entry.code?.trim()) {
    const duplicateCodes = allEntries.filter(
      (candidate) =>
        candidate.id !== entry.id &&
        candidate.code.trim().toLowerCase() === entry.code.trim().toLowerCase(),
    );
    if (duplicateCodes.length > 0) {
      addIssue({
        id: 'duplicate-code',
        severity: 'warning',
        title: 'Duplicate clause code',
        description: `${duplicateCodes.length} other clause entry uses this code.`,
        field: 'code',
        recommendation: 'Keep codes unique unless the duplicate is an intentional versioning record.',
      });
    }
  }

  if (!entry.title_en?.trim()) {
    addIssue({
      id: 'missing-title-en',
      severity: 'error',
      title: 'Missing English title',
      description: 'The English title is required by the current authoring flow and table display.',
      field: 'title_en',
      recommendation: 'Add a concise business-facing title.',
    });
  }

  if (!textEn) {
    addIssue({
      id: 'missing-text-en',
      severity: 'error',
      title: 'Missing English clause text',
      description: 'The clause body is empty, so the template cannot be reused.',
      field: 'text_en',
      recommendation: 'Add the authoritative English clause language.',
    });
  } else if (wordCount(textEn) < 20) {
    addIssue({
      id: 'short-text-en',
      severity: 'warning',
      title: 'Clause text is very short',
      description: 'Short clauses are often placeholders or incomplete drafting fragments.',
      field: 'text_en',
      recommendation: 'Confirm the text is final and complete.',
    });
  }

  if (textEn.length > 5000) {
    addIssue({
      id: 'long-text-en',
      severity: 'info',
      title: 'Long clause body',
      description: 'Very long templates are harder to compare, translate, and govern.',
      field: 'text_en',
      recommendation: 'Consider splitting long combined provisions into focused clauses.',
    });
  }

  if (language === 'bilingual' && !textAr) {
    addIssue({
      id: 'missing-arabic-text',
      severity: 'warning',
      title: 'Bilingual clause is missing Arabic text',
      description: 'The entry is marked bilingual but does not include Arabic clause text.',
      field: 'text_ar',
      recommendation: 'Add Arabic text or change the language classification.',
    });
  } else if (!textAr) {
    addIssue({
      id: 'arabic-text-empty',
      severity: 'info',
      title: 'Arabic text not supplied',
      description: 'Arabic content is optional here, but bilingual reuse and review will be weaker without it.',
      field: 'text_ar',
      recommendation: 'Add Arabic text when this clause is intended for bilingual contracts.',
    });
  }

  if (textAr && !entry.title_ar?.trim()) {
    addIssue({
      id: 'arabic-title-empty',
      severity: 'info',
      title: 'Arabic title not supplied',
      description: 'Arabic text exists, but the Arabic title is empty.',
      field: 'title_ar',
      recommendation: 'Add an Arabic title for search and reviewer scanning.',
    });
  }

  if (!entry.clause_type?.trim()) {
    addIssue({
      id: 'missing-clause-type',
      severity: 'warning',
      title: 'Missing clause type',
      description: 'Clause type drives filtering and downstream playbook matching.',
      field: 'clause_type',
      recommendation: 'Classify the clause before review.',
    });
  }

  if (!entry.category?.trim()) {
    addIssue({
      id: 'missing-category',
      severity: 'info',
      title: 'No category assigned',
      description: 'Categories make large libraries easier to scan and bulk manage.',
      field: 'category',
      recommendation: 'Add a practical category such as confidentiality, data, payment, or termination.',
    });
  }

  if (!entry.jurisdiction?.trim()) {
    addIssue({
      id: 'missing-jurisdiction',
      severity: 'warning',
      title: 'Missing jurisdiction',
      description: 'Jurisdiction is needed before legal teams can safely reuse this clause.',
      field: 'jurisdiction',
      recommendation: 'Set the controlling or intended jurisdiction.',
    });
  }

  if (!riskLevel) {
    addIssue({
      id: 'missing-risk',
      severity: 'warning',
      title: 'Risk level not assigned',
      description: 'Risk level helps reviewers prioritize approval and deprecation work.',
      field: 'risk_level',
      recommendation: 'Set a risk level before submitting for governance.',
    });
  }

  if (entry.tags.length === 0) {
    addIssue({
      id: 'missing-tags',
      severity: 'info',
      title: 'No tags assigned',
      description: 'Tags improve search, saved views, and bulk operations.',
      field: 'tags',
      recommendation: 'Add at least one domain or use-case tag.',
    });
  }

  if (!entry.source?.trim()) {
    addIssue({
      id: 'missing-source',
      severity: 'info',
      title: 'No source noted',
      description: 'Source details help reviewers understand provenance.',
      field: 'source',
      recommendation: 'Record whether this came from internal precedent, external counsel, or regulation.',
    });
  }

  if (entry.source_url && !isLikelyUrl(entry.source_url)) {
    addIssue({
      id: 'invalid-source-url',
      severity: 'info',
      title: 'Source URL looks invalid',
      description: 'The source URL is present but does not look like a valid URL.',
      field: 'source_url',
      recommendation: 'Use a full URL or leave the field empty.',
    });
  }

  if (hasDraftMarker(textEn) || hasDraftMarker(textAr) || hasDraftMarker(entry.title_en)) {
    addIssue({
      id: 'draft-marker',
      severity: 'warning',
      title: 'Draft marker found',
      description: 'The clause appears to contain TODO, placeholder, or bracketed drafting text.',
      field: 'text_en',
      recommendation: 'Resolve placeholders before governance approval.',
    });
  }

  if (ACTIVE_LIBRARY_STATUSES.has(status) && !ACTIVE_GOVERNANCE_STATUSES.has(governanceStatus)) {
    addIssue({
      id: 'active-without-approval',
      severity: 'error',
      title: 'Active clause is not governance-approved',
      description: 'Active templates should be approved before use.',
      field: 'governance_status',
      recommendation: 'Approve the clause or return it to draft status.',
    });
  }

  if (governanceStatus === 'approved' && status === 'draft') {
    addIssue({
      id: 'approved-draft',
      severity: 'warning',
      title: 'Approved clause remains in draft',
      description: 'Approved clauses are usually activated for reuse unless approval was conditional.',
      field: 'status',
      recommendation: 'Activate the clause or document why it should remain draft.',
    });
  }

  if (status === 'deprecated' && !entry.replacement_clause_id) {
    addIssue({
      id: 'deprecated-without-replacement',
      severity: 'warning',
      title: 'Deprecated clause has no replacement',
      description: 'Users need a safe path when a clause is deprecated.',
      field: 'replacement_clause_id',
      recommendation: 'Link the replacement clause when one exists.',
    });
  }

  if (HIGH_RISK_LEVELS.has(riskLevel) && !ACTIVE_GOVERNANCE_STATUSES.has(governanceStatus)) {
    addIssue({
      id: 'high-risk-unapproved',
      severity: 'warning',
      title: 'High-risk clause needs governance attention',
      description: 'High and critical risk clauses should not sit outside review.',
      field: 'governance_status',
      recommendation: 'Submit for review or complete the governance decision.',
    });
  }

  if (entry.supersedes_id === entry.id || entry.deprecated_by_id === entry.id || entry.replacement_clause_id === entry.id) {
    addIssue({
      id: 'self-reference',
      severity: 'error',
      title: 'Clause references itself',
      description: 'A clause cannot safely supersede, deprecate, or replace itself.',
      field: 'metadata',
      recommendation: 'Clear the self-reference and choose a distinct related clause.',
    });
  }

  const score = clampScore(
    100 -
      issues.filter((issue) => issue.severity === 'error').length * 24 -
      issues.filter((issue) => issue.severity === 'warning').length * 10 -
      issues.filter((issue) => issue.severity === 'info').length * 4,
  );
  const errorCount = issues.filter((issue) => issue.severity === 'error').length;
  const warningCount = issues.filter((issue) => issue.severity === 'warning').length;
  const infoCount = issues.filter((issue) => issue.severity === 'info').length;

  return {
    entry,
    score,
    grade: scoreToGrade(score),
    state: errorCount > 0 ? 'error' : warningCount > 0 ? 'warning' : infoCount > 0 ? 'info' : 'clean',
    issues,
    errorCount,
    warningCount,
    infoCount,
  };
}

export function summarizeClauseQuality(
  entries: LexClauseLibraryEntry[],
): ClauseQualitySummary {
  const results = entries.map((entry) => lintClauseLibraryEntry(entry, entries));
  const total = results.length;
  const averageScore =
    total === 0 ? 0 : Math.round(results.reduce((sum, result) => sum + result.score, 0) / total);

  return {
    total,
    averageScore,
    cleanCount: results.filter((result) => result.state === 'clean').length,
    errorCount: results.reduce((sum, result) => sum + result.errorCount, 0),
    warningCount: results.reduce((sum, result) => sum + result.warningCount, 0),
    infoCount: results.reduce((sum, result) => sum + result.infoCount, 0),
    highestRisk: [...results]
      .sort((a, b) => a.score - b.score || b.issues.length - a.issues.length)
      .slice(0, 5),
  };
}

export function buildGovernanceReviewQueue(
  entries: LexClauseLibraryEntry[],
  options: { includeQualityRisks?: boolean; limit?: number } = {},
): GovernanceQueueItem[] {
  const includeQualityRisks = options.includeQualityRisks ?? true;

  const queue = entries
    .map((entry) => {
      const quality = lintClauseLibraryEntry(entry, entries);
      const status = normalizeGovernanceToken(entry.governance_status);
      const ageDays = daysSince(entry.updated_at || entry.created_at);
      const priority = governancePriority(entry, status, quality, ageDays);
      return {
        entry,
        quality,
        status,
        priority,
        priorityLabel: priorityLabel(priority),
        ageDays,
        availableIntents: availableGovernanceIntents(entry, status),
      } satisfies GovernanceQueueItem;
    })
    .filter((item) => {
      if (GOVERNANCE_REVIEW_STATUSES.has(item.status)) {
        return true;
      }
      if (!includeQualityRisks) {
        return false;
      }
      return item.quality.errorCount > 0 || (item.quality.warningCount > 0 && !ACTIVE_GOVERNANCE_STATUSES.has(item.status));
    })
    .sort((a, b) => b.priority - a.priority || b.ageDays - a.ageDays || a.entry.title_en.localeCompare(b.entry.title_en));

  return typeof options.limit === 'number' ? queue.slice(0, options.limit) : queue;
}

export function buildClauseDeleteImpact(
  entry: LexClauseLibraryEntry,
  entries: LexClauseLibraryEntry[],
): ClauseDeleteImpact {
  const references: DeleteImpactReference[] = [];
  const reasons: DeleteImpactReason[] = [];
  const activeStatus = normalizeClauseToken(entry.status);
  const governanceStatus = normalizeGovernanceToken(entry.governance_status);
  const riskLevel = normalizeClauseToken(entry.risk_level);
  const needles = [entry.id, entry.code].filter(Boolean);

  for (const candidate of entries) {
    if (candidate.id === entry.id) {
      continue;
    }

    if (candidate.supersedes_id === entry.id) {
      references.push({
        kind: 'superseded_by',
        severity: 'warning',
        entry: candidate,
        description: 'This newer clause says it supersedes the target clause.',
      });
    }

    if (candidate.deprecated_by_id === entry.id) {
      references.push({
        kind: 'deprecated_by',
        severity: 'warning',
        entry: candidate,
        description: 'Another clause records the target as its deprecating clause.',
      });
    }

    if (candidate.replacement_clause_id === entry.id) {
      references.push({
        kind: 'replacement_for',
        severity: 'blocker',
        entry: candidate,
        description: 'Another clause points to the target as its replacement.',
      });
    }

    if (candidate.code.trim().toLowerCase() === entry.code.trim().toLowerCase()) {
      references.push({
        kind: 'same_code',
        severity: 'info',
        entry: candidate,
        description: 'Another entry shares the same clause code.',
      });
    }

    if (metadataContains(candidate.metadata, needles)) {
      references.push({
        kind: 'metadata_reference',
        severity: 'warning',
        entry: candidate,
        description: 'Another clause metadata record contains this clause id or code.',
      });
    }
  }

  if (entry.supersedes_id || entry.deprecated_by_id || entry.replacement_clause_id) {
    references.push({
      kind: 'outbound_link',
      severity: 'info',
      entry,
      description: 'The target clause has existing lifecycle links that should be preserved or migrated.',
    });
  }

  if (ACTIVE_LIBRARY_STATUSES.has(activeStatus)) {
    reasons.push({
      severity: 'blocker',
      title: 'Active clause',
      description: 'Active clauses should be deprecated with a replacement path before deletion.',
    });
  }

  if (ACTIVE_GOVERNANCE_STATUSES.has(governanceStatus)) {
    reasons.push({
      severity: 'warning',
      title: 'Governance-approved clause',
      description: 'Deleting an approved clause can break audit history and reviewer traceability.',
    });
  }

  if (HIGH_RISK_LEVELS.has(riskLevel)) {
    reasons.push({
      severity: 'warning',
      title: 'High-risk clause',
      description: 'High-risk clauses should keep a deprecation record even when removed from active use.',
    });
  }

  if (entry.replacement_clause_id === null && activeStatus !== 'archived') {
    reasons.push({
      severity: 'info',
      title: 'No replacement recorded',
      description: 'A replacement clause id helps users migrate safely after deprecation.',
    });
  }

  const replacementCandidates = entries
    .filter((candidate) => candidate.id !== entry.id)
    .filter((candidate) => normalizeClauseToken(candidate.status) === 'active')
    .filter((candidate) => normalizeGovernanceToken(candidate.governance_status) === 'approved')
    .filter((candidate) => {
      const sameType = normalizeClauseToken(candidate.clause_type) === normalizeClauseToken(entry.clause_type);
      const sameCategory = candidate.category && entry.category && candidate.category === entry.category;
      const sameJurisdiction = candidate.jurisdiction && entry.jurisdiction && candidate.jurisdiction === entry.jurisdiction;
      return sameType || sameCategory || sameJurisdiction;
    })
    .slice(0, 5);

  const hasBlocker =
    reasons.some((reason) => reason.severity === 'blocker') ||
    references.some((reference) => reference.severity === 'blocker');
  const hasWarning =
    reasons.some((reason) => reason.severity === 'warning') ||
    references.some((reference) => reference.severity === 'warning');

  return {
    entry,
    severity: hasBlocker ? 'blocked' : hasWarning ? 'risky' : 'clear',
    recommendedAction: hasBlocker || hasWarning ? 'deprecate' : 'delete',
    reasons,
    references,
    replacementCandidates,
  };
}

export function getSelectedClauseEntries(
  entries: LexClauseLibraryEntry[],
  selectedIds: string[],
): LexClauseLibraryEntry[] {
  const selected = new Set(selectedIds);
  return entries.filter((entry) => selected.has(entry.id));
}

export function buildBulkUpdateRequest(
  entries: LexClauseLibraryEntry[],
  selectedIds: string[],
  patch: LexUpdateClauseLibraryEntryPayload,
): ClauseBulkUpdateRequest {
  return {
    ids: selectedIds,
    entries: getSelectedClauseEntries(entries, selectedIds),
    patch,
  };
}

export function readClauseLibrarySavedViews(): ClauseLibrarySavedView[] {
  return readJsonStorage<ClauseLibrarySavedView[]>(CLAUSE_LIBRARY_SAVED_VIEWS_STORAGE_KEY, []).filter(
    isSavedView,
  );
}

export function writeClauseLibrarySavedViews(views: ClauseLibrarySavedView[]): void {
  writeJsonStorage(CLAUSE_LIBRARY_SAVED_VIEWS_STORAGE_KEY, views);
}

export function upsertClauseLibrarySavedView(
  name: string,
  state: ClauseLibrarySavedViewState,
  views = readClauseLibrarySavedViews(),
): ClauseLibrarySavedView[] {
  const trimmedName = name.trim();
  if (!trimmedName) {
    return views;
  }

  const now = new Date().toISOString();
  const existing = views.find((view) => view.name.toLowerCase() === trimmedName.toLowerCase());
  const nextView: ClauseLibrarySavedView = existing
    ? { ...existing, state, updatedAt: now }
    : {
        id: `view-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: trimmedName,
        state,
        createdAt: now,
        updatedAt: now,
      };
  const nextViews = existing
    ? views.map((view) => (view.id === existing.id ? nextView : view))
    : [nextView, ...views];
  writeClauseLibrarySavedViews(nextViews);
  return nextViews;
}

export function deleteClauseLibrarySavedView(
  viewId: string,
  views = readClauseLibrarySavedViews(),
): ClauseLibrarySavedView[] {
  const nextViews = views.filter((view) => view.id !== viewId);
  writeClauseLibrarySavedViews(nextViews);
  return nextViews;
}

export function readPinnedClauseIds(): string[] {
  return readJsonStorage<string[]>(CLAUSE_LIBRARY_PINNED_CLAUSES_STORAGE_KEY, []).filter(
    (id) => typeof id === 'string' && id.trim() !== '',
  );
}

export function writePinnedClauseIds(ids: string[]): void {
  writeJsonStorage(CLAUSE_LIBRARY_PINNED_CLAUSES_STORAGE_KEY, Array.from(new Set(ids)));
}

export function togglePinnedClauseId(id: string, ids = readPinnedClauseIds()): string[] {
  const selected = new Set(ids);
  if (selected.has(id)) {
    selected.delete(id);
  } else {
    selected.add(id);
  }
  const nextIds = Array.from(selected);
  writePinnedClauseIds(nextIds);
  return nextIds;
}

export function pinnedClauseEntries(
  entries: LexClauseLibraryEntry[],
  pinnedIds: string[],
): LexClauseLibraryEntry[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  return pinnedIds.map((id) => byId.get(id)).filter((entry): entry is LexClauseLibraryEntry => Boolean(entry));
}

export function normalizeGovernanceToken(value?: string | null): string {
  return value?.trim() || 'pending_review';
}

export function normalizeClauseToken(value?: string | null): string {
  return value?.trim().toLowerCase() ?? '';
}

export function formatClauseToken(value?: string | null): string {
  const normalized = normalizeClauseToken(value);
  return normalized ? normalized.replace(/_/g, ' ') : 'Not set';
}

function availableGovernanceIntents(
  entry: LexClauseLibraryEntry,
  governanceStatus: string,
): ClauseLibraryGovernanceIntent[] {
  const libraryStatus = normalizeClauseToken(entry.status);
  if (ACTIVE_GOVERNANCE_STATUSES.has(governanceStatus)) {
    return ['request_changes', 'reject'];
  }
  if (governanceStatus === 'pending_review' || governanceStatus === 'in_review') {
    return ['approve', 'request_changes', 'reject'];
  }
  if (governanceStatus === 'rejected') {
    return ['submit_review'];
  }
  if (libraryStatus === 'draft') {
    return ['submit_review'];
  }
  return ['submit_review', 'approve'];
}

function governancePriority(
  entry: LexClauseLibraryEntry,
  governanceStatus: string,
  quality: ClauseQualityResult,
  ageDays: number,
): number {
  let priority = 0;
  if (governanceStatus === 'in_review') priority += 34;
  if (governanceStatus === 'pending_review') priority += 28;
  if (governanceStatus === 'rejected') priority += 18;
  if (HIGH_RISK_LEVELS.has(normalizeClauseToken(entry.risk_level))) priority += 22;
  if (normalizeClauseToken(entry.status) === 'active') priority += 20;
  priority += quality.errorCount * 18;
  priority += quality.warningCount * 5;
  priority += Math.min(18, Math.floor(ageDays / 14));
  return priority;
}

function priorityLabel(priority: number): GovernanceQueueItem['priorityLabel'] {
  if (priority >= 70) return 'Critical';
  if (priority >= 45) return 'High';
  if (priority >= 25) return 'Medium';
  return 'Low';
}

function metadataContains(metadata: JsonObject, needles: string[]): boolean {
  if (needles.length === 0) {
    return false;
  }
  return jsonValueContains(metadata, needles.map((needle) => needle.toLowerCase()));
}

function jsonValueContains(value: JsonValue | JsonObject | undefined, needles: string[]): boolean {
  if (value === undefined || value === null) {
    return false;
  }
  if (typeof value === 'string') {
    const haystack = value.toLowerCase();
    return needles.some((needle) => needle && haystack.includes(needle));
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return false;
  }
  if (Array.isArray(value)) {
    return value.some((item) => jsonValueContains(item, needles));
  }
  return Object.values(value).some((item) => jsonValueContains(item, needles));
}

function readJsonStorage<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') {
    return fallback;
  }
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJsonStorage<T>(key: string, value: T): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be unavailable in private browsing or restricted embeds.
  }
}

function isSavedView(value: ClauseLibrarySavedView): value is ClauseLibrarySavedView {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.createdAt === 'string' &&
    typeof value.updatedAt === 'string'
  );
}

function scoreToGrade(score: number): ClauseQualityGrade {
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 60) return 'C';
  return 'D';
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function wordCount(value: string): number {
  return value.split(/\s+/).filter(Boolean).length;
}

function hasDraftMarker(value?: string | null): boolean {
  if (!value) {
    return false;
  }
  return /\b(TODO|TBD|FIXME|PLACEHOLDER)\b|\[[^\]]+\]|__[^_]+__/i.test(value);
}

function isLikelyUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function daysSince(value?: string | null): number {
  if (!value) {
    return 0;
  }
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) {
    return 0;
  }
  return Math.max(0, Math.floor((Date.now() - timestamp) / 86_400_000));
}
