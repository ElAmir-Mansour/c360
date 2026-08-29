'use client';

import { apiDelete, apiGet, apiPost } from '@/lib/api';
import type { PaginatedResponse } from '@/types/api';
import type { JsonObject } from '@/types/suites';

export type DraftingTaskKey =
  | 'clause'
  | 'contract'
  | 'rewrite'
  | 'fallbacks'
  | 'translate'
  | 'summarize'
  | 'glossary'
  | 'rfp'
  | 'obligationQa'
  | 'assembly';

export interface DraftingRunRecord {
  id: string;
  task: DraftingTaskKey;
  title: string;
  input: unknown;
  result: unknown;
  text?: string;
  riskLevel?: string | null;
  riskScore?: number | null;
  confidence?: number | null;
  createdAt: string;
}

export interface DraftingHandoff {
  target: DraftingTaskKey;
  text?: string;
  title?: string;
  payload?: JsonObject;
  sourceTask?: DraftingTaskKey;
  createdAt: string;
}

export interface DraftingTemplate {
  id: string;
  task: DraftingTaskKey;
  name: string;
  value: string;
  createdAt: string;
}

export interface DraftingWorkspaceContext {
  workspaceId: string;
  projectId?: string;
  activeTask?: DraftingTaskKey;
  updatedAt: string;
}

export interface DraftingWorkspaceVersion {
  id: string;
  workspaceId: string;
  projectId?: string;
  task: DraftingTaskKey;
  title: string;
  input: unknown;
  result: unknown;
  text?: string;
  riskLevel?: string | null;
  riskScore?: number | null;
  confidence?: number | null;
  sourceHistoryId?: string;
  createdAt: string;
  restoredAt?: string;
}

export interface DraftingWorkspaceSnapshot {
  workspaceId: string;
  projectId?: string;
  activeTask: DraftingTaskKey;
  historyIds: string[];
  versions: DraftingWorkspaceVersion[];
  restoredVersionId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SaveDraftingWorkspaceVersionInput {
  workspaceId: string;
  projectId?: string;
  activeTask?: DraftingTaskKey;
  record: DraftingRunRecord;
}

export const DRAFTING_HISTORY_KEY = 'clario360.lex.drafting.history';
export const DRAFTING_HANDOFF_KEY = 'clario360.lex.drafting.handoff';
export const DRAFTING_TEMPLATES_KEY = 'clario360.lex.drafting.templates';
export const DRAFTING_WORKSPACES_KEY = 'clario360.lex.drafting.workspaces';
export const DRAFTING_ACTIVE_WORKSPACE_KEY = 'clario360.lex.drafting.activeWorkspace';
export const DRAFTING_NAVIGATE_EVENT = 'clario360.lex.drafting.navigate';
export const DRAFTING_HISTORY_EVENT = 'clario360.lex.drafting.history';
export const DRAFTING_WORKSPACE_EVENT = 'clario360.lex.drafting.workspace';
export const DEFAULT_DRAFTING_WORKSPACE_ID = 'local-drafting';

const MAX_HISTORY = 30;
const MAX_WORKSPACE_VERSIONS = 60;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

function emitWorkspaceChange(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(DRAFTING_WORKSPACE_EVENT));
  }
}

function readDraftingWorkspaceRows(): Record<string, DraftingWorkspaceSnapshot> {
  const rows = readJson<Record<string, DraftingWorkspaceSnapshot>>(DRAFTING_WORKSPACES_KEY, {});
  return isRecord(rows) ? rows : {};
}

function writeDraftingWorkspaceRows(rows: Record<string, DraftingWorkspaceSnapshot>): void {
  writeJson(DRAFTING_WORKSPACES_KEY, rows);
}

function normalizeWorkspaceVersion(value: unknown): DraftingWorkspaceVersion | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.workspaceId !== 'string') {
    return null;
  }
  if (typeof value.task !== 'string' || typeof value.title !== 'string' || typeof value.createdAt !== 'string') {
    return null;
  }
  return value as unknown as DraftingWorkspaceVersion;
}

function normalizeWorkspaceSnapshot(value: unknown, workspaceId: string): DraftingWorkspaceSnapshot | null {
  if (!isRecord(value)) return null;
  const versions = Array.isArray(value.versions)
    ? value.versions.map(normalizeWorkspaceVersion).filter((version): version is DraftingWorkspaceVersion => Boolean(version))
    : [];
  return {
    workspaceId,
    projectId: typeof value.projectId === 'string' && value.projectId ? value.projectId : undefined,
    activeTask: typeof value.activeTask === 'string' ? (value.activeTask as DraftingTaskKey) : 'clause',
    historyIds: Array.isArray(value.historyIds) ? value.historyIds.filter((id): id is string => typeof id === 'string') : [],
    versions,
    restoredVersionId: typeof value.restoredVersionId === 'string' ? value.restoredVersionId : undefined,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : new Date().toISOString(),
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date().toISOString(),
  };
}

function createDraftingWorkspaceSnapshot(
  workspaceId: string,
  projectId: string | undefined,
  activeTask: DraftingTaskKey,
): DraftingWorkspaceSnapshot {
  const now = new Date().toISOString();
  return {
    workspaceId,
    projectId,
    activeTask,
    historyIds: [],
    versions: [],
    createdAt: now,
    updatedAt: now,
  };
}

function upsertDraftingWorkspaceSnapshot(
  workspaceId: string,
  projectId?: string,
  activeTask: DraftingTaskKey = 'clause',
): DraftingWorkspaceSnapshot {
  const normalizedWorkspaceId = normalizeDraftingWorkspaceId(workspaceId);
  const normalizedProjectId = normalizeOptionalDraftingId(projectId);
  const rows = readDraftingWorkspaceRows();
  const existing = normalizeWorkspaceSnapshot(rows[normalizedWorkspaceId], normalizedWorkspaceId);
  const snapshot = existing ?? createDraftingWorkspaceSnapshot(normalizedWorkspaceId, normalizedProjectId, activeTask);
  const next: DraftingWorkspaceSnapshot = {
    ...snapshot,
    projectId: normalizedProjectId ?? snapshot.projectId,
    activeTask,
    updatedAt: new Date().toISOString(),
  };
  rows[normalizedWorkspaceId] = next;
  writeDraftingWorkspaceRows(rows);
  return next;
}

export function normalizeDraftingWorkspaceId(value?: string | null, fallback = DEFAULT_DRAFTING_WORKSPACE_ID): string {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) return fallback;
  return trimmed
    .replace(/[^A-Za-z0-9._:-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || fallback;
}

export function normalizeOptionalDraftingId(value?: string | null): string | undefined {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) return undefined;
  const normalized = normalizeDraftingWorkspaceId(trimmed, '');
  return normalized || undefined;
}

export function setActiveDraftingWorkspaceContext(context: {
  workspaceId: string;
  projectId?: string;
  activeTask?: DraftingTaskKey;
}): DraftingWorkspaceContext {
  const workspaceId = normalizeDraftingWorkspaceId(context.workspaceId);
  const projectId = normalizeOptionalDraftingId(context.projectId);
  const payload: DraftingWorkspaceContext = {
    workspaceId,
    projectId,
    activeTask: context.activeTask,
    updatedAt: new Date().toISOString(),
  };
  writeJson(DRAFTING_ACTIVE_WORKSPACE_KEY, payload);
  upsertDraftingWorkspaceSnapshot(workspaceId, projectId, context.activeTask ?? 'clause');
  return payload;
}

export function readActiveDraftingWorkspaceContext(): DraftingWorkspaceContext {
  const row = readJson<DraftingWorkspaceContext | null>(DRAFTING_ACTIVE_WORKSPACE_KEY, null);
  if (!isRecord(row)) {
    return setActiveDraftingWorkspaceContext({ workspaceId: DEFAULT_DRAFTING_WORKSPACE_ID, activeTask: 'clause' });
  }
  return {
    workspaceId: normalizeDraftingWorkspaceId(typeof row.workspaceId === 'string' ? row.workspaceId : undefined),
    projectId: normalizeOptionalDraftingId(typeof row.projectId === 'string' ? row.projectId : undefined),
    activeTask: typeof row.activeTask === 'string' ? (row.activeTask as DraftingTaskKey) : undefined,
    updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : new Date().toISOString(),
  };
}

export function readDraftingWorkspaceSnapshot(
  workspaceId: string,
  options: { projectId?: string; activeTask?: DraftingTaskKey } = {},
): DraftingWorkspaceSnapshot {
  return upsertDraftingWorkspaceSnapshot(
    normalizeDraftingWorkspaceId(workspaceId),
    options.projectId,
    options.activeTask ?? readActiveDraftingWorkspaceContext().activeTask ?? 'clause',
  );
}

export function listDraftingWorkspaces(): DraftingWorkspaceSnapshot[] {
  const rows = readDraftingWorkspaceRows();
  return Object.entries(rows)
    .map(([workspaceId, row]) => normalizeWorkspaceSnapshot(row, workspaceId))
    .filter((row): row is DraftingWorkspaceSnapshot => Boolean(row))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function listDraftingWorkspaceVersions(workspaceId: string): DraftingWorkspaceVersion[] {
  return readDraftingWorkspaceSnapshot(workspaceId).versions;
}

export function saveDraftingWorkspaceVersion(input: SaveDraftingWorkspaceVersionInput): DraftingWorkspaceVersion {
  const workspaceId = normalizeDraftingWorkspaceId(input.workspaceId);
  const projectId = normalizeOptionalDraftingId(input.projectId);
  const now = new Date().toISOString();
  const version: DraftingWorkspaceVersion = {
    id: `${workspaceId}-v-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    workspaceId,
    projectId,
    task: input.record.task,
    title: input.record.title,
    input: input.record.input,
    result: input.record.result,
    text: input.record.text,
    riskLevel: input.record.riskLevel,
    riskScore: input.record.riskScore,
    confidence: input.record.confidence,
    sourceHistoryId: input.record.id,
    createdAt: input.record.createdAt || now,
  };
  const rows = readDraftingWorkspaceRows();
  const snapshot = normalizeWorkspaceSnapshot(rows[workspaceId], workspaceId)
    ?? createDraftingWorkspaceSnapshot(workspaceId, projectId, input.activeTask ?? input.record.task);
  rows[workspaceId] = {
    ...snapshot,
    projectId: projectId ?? snapshot.projectId,
    activeTask: input.activeTask ?? input.record.task,
    historyIds: [input.record.id, ...snapshot.historyIds.filter((id) => id !== input.record.id)].slice(0, MAX_WORKSPACE_VERSIONS),
    versions: [version, ...snapshot.versions].slice(0, MAX_WORKSPACE_VERSIONS),
    updatedAt: now,
  };
  writeDraftingWorkspaceRows(rows);
  emitWorkspaceChange();
  return version;
}

export function restoreDraftingWorkspaceVersion(workspaceId: string, versionId: string): DraftingWorkspaceVersion | null {
  const normalizedWorkspaceId = normalizeDraftingWorkspaceId(workspaceId);
  const rows = readDraftingWorkspaceRows();
  const snapshot = normalizeWorkspaceSnapshot(rows[normalizedWorkspaceId], normalizedWorkspaceId);
  if (!snapshot) return null;
  const version = snapshot.versions.find((item) => item.id === versionId) ?? null;
  if (!version) return null;
  const restoredAt = new Date().toISOString();
  rows[normalizedWorkspaceId] = {
    ...snapshot,
    activeTask: version.task,
    restoredVersionId: version.id,
    versions: snapshot.versions.map((item) => (item.id === version.id ? { ...item, restoredAt } : item)),
    updatedAt: restoredAt,
  };
  writeDraftingWorkspaceRows(rows);
  emitWorkspaceChange();
  return { ...version, restoredAt };
}

export function readDraftingHistory(): DraftingRunRecord[] {
  const rows = readJson<DraftingRunRecord[]>(DRAFTING_HISTORY_KEY, []);
  return Array.isArray(rows) ? rows.filter((row) => isRecord(row) && typeof row.id === 'string') : [];
}

export function saveDraftingRun(record: Omit<DraftingRunRecord, 'id' | 'createdAt'>): DraftingRunRecord {
  const saved: DraftingRunRecord = {
    ...record,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
  };
  const next = [saved, ...readDraftingHistory()].slice(0, MAX_HISTORY);
  writeJson(DRAFTING_HISTORY_KEY, next);
  const context = readActiveDraftingWorkspaceContext();
  saveDraftingWorkspaceVersion({
    workspaceId: context.workspaceId,
    projectId: context.projectId,
    activeTask: context.activeTask ?? saved.task,
    record: saved,
  });
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(DRAFTING_HISTORY_EVENT));
  }
  return saved;
}

export function clearDraftingHistory(): void {
  writeJson(DRAFTING_HISTORY_KEY, []);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(DRAFTING_HISTORY_EVENT));
  }
}

export function writeDraftingHandoff(handoff: Omit<DraftingHandoff, 'createdAt'>): void {
  const payload: DraftingHandoff = { ...handoff, createdAt: new Date().toISOString() };
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(DRAFTING_HANDOFF_KEY, JSON.stringify(payload));
  window.dispatchEvent(new CustomEvent<DraftingHandoff>(DRAFTING_NAVIGATE_EVENT, { detail: payload }));
}

export function consumeDraftingHandoff(target: DraftingTaskKey): DraftingHandoff | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(DRAFTING_HANDOFF_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DraftingHandoff;
    if (!parsed || parsed.target !== target) return null;
    window.sessionStorage.removeItem(DRAFTING_HANDOFF_KEY);
    return parsed;
  } catch {
    return null;
  }
}

export function readDraftingTemplates(task?: DraftingTaskKey): DraftingTemplate[] {
  const rows = readJson<DraftingTemplate[]>(DRAFTING_TEMPLATES_KEY, []);
  const templates = Array.isArray(rows) ? rows.filter((row) => isRecord(row) && typeof row.id === 'string') : [];
  return task ? templates.filter((template) => template.task === task) : templates;
}

export function saveDraftingTemplate(template: Omit<DraftingTemplate, 'id' | 'createdAt'>): DraftingTemplate[] {
  const saved: DraftingTemplate = {
    ...template,
    id: `${template.task}-${Date.now()}`,
    createdAt: new Date().toISOString(),
  };
  const next = [saved, ...readDraftingTemplates().filter((row) => !(row.task === saved.task && row.name === saved.name))].slice(0, 50);
  writeJson(DRAFTING_TEMPLATES_KEY, next);
  return next;
}

export function deleteDraftingTemplate(id: string): DraftingTemplate[] {
  const next = readDraftingTemplates().filter((template) => template.id !== id);
  writeJson(DRAFTING_TEMPLATES_KEY, next);
  return next;
}

// ---- AID-09 prompt library: persisted, tenant-scoped prompt templates ----
//
// Wire the six persisted prompt-library routes under
// `/api/v1/lex/drafting/prompts` (backend: handler/routes.go +
// service/drafting_service.go). The template bar was previously a
// localStorage-only shadow; callers now prefer these server-backed helpers and
// fall back to the local `*DraftingTemplate` store when the endpoint is
// unavailable (e.g. the prompt library is unprovisioned and returns 503).

const DRAFTING_BASE_PATH = '/api/v1/lex/drafting';
const DRAFTING_PROMPTS_PATH = `${DRAFTING_BASE_PATH}/prompts`;

/** Server shape of a persisted prompt template (model.PromptTemplate). */
export interface PromptLibraryTemplate {
  id: string;
  tenant_id?: string;
  name: string;
  description?: string;
  category?: string;
  system_prompt?: string;
  user_prompt: string;
  variables?: string[];
  metadata?: Record<string, unknown> | null;
  created_by?: string;
  created_at?: string;
  updated_at?: string;
}

// The task-scoped PromptTemplateBar stores one reusable input snippet per
// (task, name). Map it onto the richer server model: the drafting task lives in
// `category` (so the flat prompt list can be filtered per task) and the snippet
// text in `user_prompt` (the field the backend treats as required).
function promptTemplateToDrafting(row: PromptLibraryTemplate): DraftingTemplate {
  const task = (row.category ?? '').trim();
  return {
    id: row.id,
    task: (task || 'clause') as DraftingTaskKey,
    name: row.name,
    value: row.user_prompt ?? '',
    createdAt: row.created_at ?? new Date().toISOString(),
  };
}

/** GET /drafting/prompts, filtered to a single drafting task. */
export async function listPromptLibraryTemplates(task: DraftingTaskKey): Promise<DraftingTemplate[]> {
  const res = await apiGet<PaginatedResponse<PromptLibraryTemplate>>(DRAFTING_PROMPTS_PATH, { per_page: 100 });
  const rows = Array.isArray(res?.data) ? res.data : [];
  return rows.filter((row) => (row.category ?? '').trim() === task).map(promptTemplateToDrafting);
}

/** POST /drafting/prompts — persist a task-scoped snippet. */
export async function createPromptLibraryTemplate(input: {
  task: DraftingTaskKey;
  name: string;
  value: string;
}): Promise<DraftingTemplate> {
  const res = await apiPost<{ data: PromptLibraryTemplate }>(DRAFTING_PROMPTS_PATH, {
    name: input.name,
    category: input.task,
    user_prompt: input.value,
  });
  return promptTemplateToDrafting(res.data);
}

/** DELETE /drafting/prompts/{id} — backend returns 200 `{ deleted: true }`. */
export async function deletePromptLibraryTemplate(id: string): Promise<void> {
  await apiDelete<{ data: { deleted: boolean; id: string } }>(`${DRAFTING_PROMPTS_PATH}/${encodeURIComponent(id)}`);
}

// ---- Feature 4: AI draft human review (submit + status) ----
//
// Wire the two live routes `POST /drafting/{id}/submit-for-review` and
// `GET /drafting/{id}/review` (backend: handler/routes.go +
// service/drafting_review_service.go). `{id}` is a stable, caller-supplied draft
// UUID; the review is an engine-tracked human task projected onto the lex side.

/** Lifecycle states mirrored from model.DraftReview. */
export type DraftReviewStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'changes_requested'
  | 'cancelled';

/** Server shape of a draft review projection (model.DraftReview). */
export interface DraftReviewSummary {
  id: string;
  draft_id: string;
  title: string;
  draft_kind: string;
  review_status: DraftReviewStatus | string;
  review_task_id?: string | null;
  workflow_instance_id?: string | null;
  assignee_id?: string | null;
  assignee_role?: string | null;
  sla_deadline?: string | null;
  review_notes?: string;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  submitted_by?: string | null;
  created_at: string;
  updated_at: string;
}

function newDraftReviewId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // RFC-4122 v4-ish fallback for environments without crypto.randomUUID.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const rand = (Math.random() * 16) | 0;
    const value = char === 'x' ? rand : (rand & 0x3) | 0x8;
    return value.toString(16);
  });
}

/**
 * POST /drafting/{id}/submit-for-review. Generates a stable draft id when none
 * is supplied (AI outputs are otherwise ephemeral). Returns the created review
 * whose `draft_id` can be replayed into {@link getDraftReview}.
 */
export async function submitDraftForReview(input: {
  draftId?: string;
  title: string;
  draftKind: string;
  content: Record<string, unknown>;
}): Promise<DraftReviewSummary> {
  const draftId = input.draftId ?? newDraftReviewId();
  const res = await apiPost<{ data: DraftReviewSummary }>(
    `${DRAFTING_BASE_PATH}/${encodeURIComponent(draftId)}/submit-for-review`,
    {
      title: input.title,
      draft_kind: input.draftKind,
      content: input.content,
    },
  );
  return res.data;
}

/** GET /drafting/{id}/review — the current review-status projection for a draft. */
export async function getDraftReview(draftId: string): Promise<DraftReviewSummary> {
  const res = await apiGet<{ data: DraftReviewSummary }>(
    `${DRAFTING_BASE_PATH}/${encodeURIComponent(draftId)}/review`,
  );
  return res.data;
}

function downloadBlob(filename: string, blob: Blob): void {
  if (typeof document === 'undefined') return;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function downloadDraftingText(filename: string, content: string, type = 'text/plain;charset=utf-8'): void {
  const blob = new Blob([content], { type });
  downloadBlob(filename, blob);
}

export function toMarkdown(title: string, body: string): string {
  return `# ${title.trim() || 'Draft'}\n\n${body.trim()}\n`;
}

export function downloadDraftingDocx(filename: string, title: string, body: string): void {
  const safeFilename = filename.endsWith('.docx') ? filename : `${filename}.docx`;
  downloadBlob(safeFilename, createDocxBlob(title, body));
}

export function printDraftingPdf(title: string, body: string): void {
  if (typeof window === 'undefined') return;
  const printWindow = window.open('', '_blank', 'noopener,noreferrer,width=900,height=1100');
  if (!printWindow) return;
  const safeTitle = escapeHtml(title.trim() || 'Drafting result');
  const safeBody = escapeHtml(body).replace(/\n/g, '<br />');
  printWindow.document.write(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${safeTitle}</title>
    <style>
      @page { margin: 24mm; }
      body { color: #06352F; font-family: Inter, "Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif; font-size: 12pt; line-height: 1.65; }
      h1 { font-size: 18pt; margin: 0 0 16pt; }
      .meta { color: #6C7874; font-size: 9pt; margin-bottom: 18pt; }
    </style>
  </head>
  <body>
    <h1>${safeTitle}</h1>
    <div class="meta">Generated ${escapeHtml(new Date().toLocaleString())}</div>
    <main>${safeBody}</main>
    <script>window.onload = () => { window.focus(); window.print(); };</script>
  </body>
</html>`);
  printWindow.document.close();
}

function createDocxBlob(title: string, body: string): Blob {
  const files = [
    {
      name: '[Content_Types].xml',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
    },
    {
      name: '_rels/.rels',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
    },
    {
      name: 'word/document.xml',
      content: docxDocumentXml(title, body),
    },
  ];
  const packageBytes = zipStore(files);
  return new Blob([uint8ArrayToArrayBuffer(packageBytes)], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
}

function uint8ArrayToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function docxDocumentXml(title: string, body: string): string {
  const paragraphs = [title.trim() || 'Drafting result', ...body.split(/\r?\n/)]
    .map((line) => `<w:p><w:r><w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r></w:p>`)
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${paragraphs}
    <w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>
  </w:body>
</w:document>`;
}

function zipStore(files: Array<{ name: string; content: string }>): Uint8Array {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = encoder.encode(file.content);
    const crc = crc32(data);
    const local = zipLocalHeader(name, data, crc);
    localParts.push(local, data);
    centralParts.push(zipCentralHeader(name, data, crc, offset));
    offset += local.length + data.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = zipEndRecord(files.length, centralSize, offset);
  return concatUint8Arrays([...localParts, ...centralParts, end]);
}

function zipLocalHeader(name: Uint8Array, data: Uint8Array, crc: number): Uint8Array {
  const header = new Uint8Array(30 + name.length);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, 0, true);
  view.setUint16(10, 0, true);
  view.setUint16(12, 0, true);
  view.setUint32(14, crc, true);
  view.setUint32(18, data.length, true);
  view.setUint32(22, data.length, true);
  view.setUint16(26, name.length, true);
  view.setUint16(28, 0, true);
  header.set(name, 30);
  return header;
}

function zipCentralHeader(name: Uint8Array, data: Uint8Array, crc: number, offset: number): Uint8Array {
  const header = new Uint8Array(46 + name.length);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 20, true);
  view.setUint16(8, 0, true);
  view.setUint16(10, 0, true);
  view.setUint16(12, 0, true);
  view.setUint16(14, 0, true);
  view.setUint32(16, crc, true);
  view.setUint32(20, data.length, true);
  view.setUint32(24, data.length, true);
  view.setUint16(28, name.length, true);
  view.setUint16(30, 0, true);
  view.setUint16(32, 0, true);
  view.setUint16(34, 0, true);
  view.setUint16(36, 0, true);
  view.setUint32(38, 0, true);
  view.setUint32(42, offset, true);
  header.set(name, 46);
  return header;
}

function zipEndRecord(fileCount: number, centralSize: number, centralOffset: number): Uint8Array {
  const header = new Uint8Array(22);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(4, 0, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, fileCount, true);
  view.setUint16(10, fileCount, true);
  view.setUint32(12, centralSize, true);
  view.setUint32(16, centralOffset, true);
  view.setUint16(20, 0, true);
  return header;
}

function concatUint8Arrays(parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

let crcTable: Uint32Array | null = null;

function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) {
        value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      }
      crcTable[index] = value >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function scorePercent(value?: number | null): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const normalized = value > 1 ? value : value * 100;
  return `${Math.round(normalized)}%`;
}
