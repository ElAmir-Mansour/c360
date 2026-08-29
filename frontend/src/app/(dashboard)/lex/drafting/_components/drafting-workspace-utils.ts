export type DraftingStorageScope = 'local' | 'session';

export const DRAFTING_HISTORY_STORAGE_KEY = 'clario360:lex:drafting:workspace-history';
export const DRAFTING_CHAIN_STORAGE_KEY = 'clario360:lex:drafting:chain-payload';
export const DRAFTING_COMMAND_STATE_STORAGE_KEY = 'clario360:lex:drafting:command-state';

export type DraftingExportFormat = 'txt' | 'json' | 'markdown' | 'docx' | 'pdf';

export interface DraftingHistoryEntry<TInput = unknown, TResult = unknown> {
  id: string;
  task: string;
  title: string;
  subtitle?: string;
  input?: TInput;
  result?: TResult;
  primaryText?: string;
  riskLevel?: string;
  confidence?: number | null;
  riskScore?: number | null;
  tags?: string[];
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt?: string;
}

export type NewDraftingHistoryEntry<TInput = unknown, TResult = unknown> = Omit<
  DraftingHistoryEntry<TInput, TResult>,
  'id' | 'createdAt'
> &
  Partial<Pick<DraftingHistoryEntry<TInput, TResult>, 'id' | 'createdAt' | 'updatedAt'>>;

export interface DraftingHistoryStorageOptions {
  key?: string;
  scope?: DraftingStorageScope;
  maxEntries?: number;
}

export interface DraftingChainSource<TResult = unknown, TInput = unknown> {
  task: string;
  title?: string;
  input?: TInput;
  result?: TResult;
  primaryText?: string;
  metadata?: Record<string, unknown>;
}

export interface DraftingChainTarget {
  task: string;
  label: string;
  description?: string;
  accepts?: string[];
  disabled?: boolean;
  reason?: string;
}

export interface DraftingChainPayload<TPayload = unknown> {
  id: string;
  sourceTask: string;
  targetTask: string;
  title?: string;
  primaryText?: string;
  payload?: TPayload;
  sourceResult?: unknown;
  sourceInput?: unknown;
  metadata?: Record<string, unknown>;
  createdAt: string;
  expiresAt?: string;
}

export interface DraftingCommandBarStoredState {
  activeTask?: string;
  query?: string;
  updatedAt: string;
}

export interface DraftingExportOptions {
  format: DraftingExportFormat;
  title?: string;
  filenameBase?: string;
  primaryText?: string;
  result?: unknown;
  metadata?: Record<string, unknown>;
}

export interface DraftingExportFile {
  content: string;
  filename: string;
  mimeType: string;
}

export interface DraftingRiskIssue {
  id?: string;
  label: string;
  description?: string;
  severity?: string;
  suggestion?: string;
  source?: string;
}

export interface DraftingRiskSummary {
  confidence?: number;
  riskScore?: number;
  riskLevel?: string;
  riskShift?: string;
  risks: string[];
  issues: DraftingRiskIssue[];
  notes: string[];
}

const DEFAULT_HISTORY_MAX_ENTRIES = 50;
const DEFAULT_CHAIN_TTL_MS = 60 * 60 * 1000;

const KNOWN_CHAIN_TARGETS: DraftingChainTarget[] = [
  {
    task: 'rewrite',
    label: 'Rewrite',
    description: 'Send the selected result into clause rewriting.',
    accepts: ['clause', 'contract', 'fallbacks', 'translate', 'summarize', 'rfp'],
  },
  {
    task: 'fallbacks',
    label: 'Fallbacks',
    description: 'Build a negotiation fallback ladder from the selected clause.',
    accepts: ['clause', 'rewrite'],
  },
  {
    task: 'translate',
    label: 'Translate',
    description: 'Translate the selected result while preserving legal meaning.',
    accepts: ['clause', 'contract', 'rewrite', 'fallbacks', 'summarize', 'rfp', 'glossary'],
  },
  {
    task: 'summarize',
    label: 'Summarize',
    description: 'Create an executive summary from the selected document text.',
    accepts: ['contract', 'rewrite', 'translate', 'rfp', 'assembly'],
  },
  {
    task: 'glossary',
    label: 'Glossary',
    description: 'Extract defined terms from the selected contract text.',
    accepts: ['contract', 'summarize', 'assembly'],
  },
  {
    task: 'obligationQa',
    label: 'Obligation QA',
    description: 'Review extracted obligations against the selected source text.',
    accepts: ['contract', 'summarize', 'assembly'],
  },
  {
    task: 'assembly',
    label: 'Assemble',
    description: 'Use the result as source text for deterministic assembly inputs.',
    accepts: ['clause', 'contract', 'rewrite', 'fallbacks'],
  },
];

function nowIso(): string {
  return new Date().toISOString();
}

function createId(prefix = 'drafting'): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function storageFor(scope: DraftingStorageScope): Storage | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    return scope === 'session' ? window.sessionStorage : window.localStorage;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readRecordNumber(record: Record<string, unknown> | undefined, keys: string[]): number | undefined {
  if (!record) {
    return undefined;
  }
  for (const key of keys) {
    const value = numberValue(record[key]);
    if (typeof value === 'number') {
      return value;
    }
  }
  return undefined;
}

function readRecordString(record: Record<string, unknown> | undefined, keys: string[]): string | undefined {
  if (!record) {
    return undefined;
  }
  for (const key of keys) {
    const value = stringValue(record[key]);
    if (value) {
      return value;
    }
  }
  return undefined;
}

function normalizeHistoryEntry(value: unknown): DraftingHistoryEntry | null {
  if (!isRecord(value)) {
    return null;
  }
  const task = stringValue(value.task);
  const title = stringValue(value.title);
  const createdAt = stringValue(value.createdAt);
  if (!task || !title || !createdAt) {
    return null;
  }
  return {
    id: stringValue(value.id) ?? createId('history'),
    task,
    title,
    subtitle: stringValue(value.subtitle),
    input: value.input,
    result: value.result,
    primaryText: stringValue(value.primaryText),
    riskLevel: stringValue(value.riskLevel),
    confidence: numberValue(value.confidence) ?? null,
    riskScore: numberValue(value.riskScore) ?? null,
    tags: isStringArray(value.tags) ? value.tags : undefined,
    metadata: isRecord(value.metadata) ? value.metadata : undefined,
    createdAt,
    updatedAt: stringValue(value.updatedAt),
  };
}

export function readStorageJson<T>(
  key: string,
  fallback: T,
  scope: DraftingStorageScope = 'local',
): T {
  const storage = storageFor(scope);
  if (!storage) {
    return fallback;
  }
  try {
    const raw = storage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeStorageJson(
  key: string,
  value: unknown,
  scope: DraftingStorageScope = 'local',
): boolean {
  const storage = storageFor(scope);
  if (!storage) {
    return false;
  }
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function removeStorageValue(
  key: string,
  scope: DraftingStorageScope = 'local',
): boolean {
  const storage = storageFor(scope);
  if (!storage) {
    return false;
  }
  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export function loadDraftingHistory(
  options: DraftingHistoryStorageOptions = {},
): DraftingHistoryEntry[] {
  const key = options.key ?? DRAFTING_HISTORY_STORAGE_KEY;
  const scope = options.scope ?? 'local';
  const raw = readStorageJson<unknown>(key, [], scope);
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map(normalizeHistoryEntry)
    .filter((entry): entry is DraftingHistoryEntry => Boolean(entry))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export function saveDraftingHistory(
  entries: DraftingHistoryEntry[],
  options: DraftingHistoryStorageOptions = {},
): DraftingHistoryEntry[] {
  const key = options.key ?? DRAFTING_HISTORY_STORAGE_KEY;
  const scope = options.scope ?? 'local';
  const maxEntries = options.maxEntries ?? DEFAULT_HISTORY_MAX_ENTRIES;
  const normalized = entries
    .map(normalizeHistoryEntry)
    .filter((entry): entry is DraftingHistoryEntry => Boolean(entry))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, maxEntries);
  writeStorageJson(key, normalized, scope);
  return normalized;
}

export function addDraftingHistoryEntry<TInput = unknown, TResult = unknown>(
  entry: NewDraftingHistoryEntry<TInput, TResult>,
  options: DraftingHistoryStorageOptions = {},
): DraftingHistoryEntry[] {
  const createdAt = entry.createdAt ?? nowIso();
  const completeEntry: DraftingHistoryEntry<TInput, TResult> = {
    ...entry,
    id: entry.id ?? createId('history'),
    createdAt,
    updatedAt: entry.updatedAt ?? createdAt,
  };
  const existing = loadDraftingHistory(options).filter((item) => item.id !== completeEntry.id);
  return saveDraftingHistory([completeEntry, ...existing], options);
}

export function removeDraftingHistoryEntry(
  id: string,
  options: DraftingHistoryStorageOptions = {},
): DraftingHistoryEntry[] {
  return saveDraftingHistory(
    loadDraftingHistory(options).filter((entry) => entry.id !== id),
    options,
  );
}

export function clearDraftingHistory(options: DraftingHistoryStorageOptions = {}): void {
  removeStorageValue(options.key ?? DRAFTING_HISTORY_STORAGE_KEY, options.scope ?? 'local');
}

export function readDraftingCommandState(
  key = DRAFTING_COMMAND_STATE_STORAGE_KEY,
): DraftingCommandBarStoredState | null {
  const value = readStorageJson<unknown>(key, null, 'session');
  if (!isRecord(value)) {
    return null;
  }
  return {
    activeTask: stringValue(value.activeTask),
    query: stringValue(value.query),
    updatedAt: stringValue(value.updatedAt) ?? nowIso(),
  };
}

export function writeDraftingCommandState(
  state: Omit<DraftingCommandBarStoredState, 'updatedAt'>,
  key = DRAFTING_COMMAND_STATE_STORAGE_KEY,
): boolean {
  return writeStorageJson(key, { ...state, updatedAt: nowIso() }, 'session');
}

export function filterDraftingChainTargets(
  sourceTask: string | undefined,
  targets: DraftingChainTarget[] = KNOWN_CHAIN_TARGETS,
): DraftingChainTarget[] {
  if (!sourceTask) {
    return targets;
  }
  return targets.filter((target) => {
    if (target.task === sourceTask) {
      return false;
    }
    return !target.accepts || target.accepts.includes(sourceTask);
  });
}

export function createDraftingChainPayload<TPayload = unknown>(
  source: DraftingChainSource,
  targetTask: string,
  payload?: TPayload,
  ttlMs = DEFAULT_CHAIN_TTL_MS,
): DraftingChainPayload<TPayload> {
  const createdAt = nowIso();
  return {
    id: createId('chain'),
    sourceTask: source.task,
    targetTask,
    title: source.title,
    primaryText: source.primaryText,
    payload,
    sourceResult: source.result,
    sourceInput: source.input,
    metadata: source.metadata,
    createdAt,
    expiresAt: ttlMs > 0 ? new Date(Date.now() + ttlMs).toISOString() : undefined,
  };
}

export function writeDraftingChainPayload(
  payload: DraftingChainPayload,
  key = DRAFTING_CHAIN_STORAGE_KEY,
): boolean {
  return writeStorageJson(key, payload, 'session');
}

export function readDraftingChainPayload<TPayload = unknown>(
  targetTask?: string,
  key = DRAFTING_CHAIN_STORAGE_KEY,
): DraftingChainPayload<TPayload> | null {
  const value = readStorageJson<unknown>(key, null, 'session');
  if (!isRecord(value)) {
    return null;
  }
  const expiresAt = stringValue(value.expiresAt);
  if (expiresAt && Date.parse(expiresAt) < Date.now()) {
    removeStorageValue(key, 'session');
    return null;
  }
  const sourceTask = stringValue(value.sourceTask);
  const storedTarget = stringValue(value.targetTask);
  const createdAt = stringValue(value.createdAt);
  if (!sourceTask || !storedTarget || !createdAt) {
    return null;
  }
  if (targetTask && storedTarget !== targetTask) {
    return null;
  }
  return {
    id: stringValue(value.id) ?? createId('chain'),
    sourceTask,
    targetTask: storedTarget,
    title: stringValue(value.title),
    primaryText: stringValue(value.primaryText),
    payload: value.payload as TPayload | undefined,
    sourceResult: value.sourceResult,
    sourceInput: value.sourceInput,
    metadata: isRecord(value.metadata) ? value.metadata : undefined,
    createdAt,
    expiresAt,
  };
}

export function consumeDraftingChainPayload<TPayload = unknown>(
  targetTask?: string,
  key = DRAFTING_CHAIN_STORAGE_KEY,
): DraftingChainPayload<TPayload> | null {
  const payload = readDraftingChainPayload<TPayload>(targetTask, key);
  if (payload) {
    removeStorageValue(key, 'session');
  }
  return payload;
}

export function normalizeScore(value: number | null | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }
  const percent = value <= 1 ? value * 100 : value;
  return Math.max(0, Math.min(100, percent));
}

export function formatDraftingScore(value: number | null | undefined): string {
  const percent = normalizeScore(value);
  return typeof percent === 'number' ? `${Math.round(percent)}%` : 'N/A';
}

function humanizeKey(key: string): string {
  return key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, (letter) => letter.toUpperCase());
}

function plainTextFromValue(value: unknown, depth = 0, seen = new WeakSet<object>()): string {
  if (value === null || typeof value === 'undefined') {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value
      .map((item, index) => {
        const text = plainTextFromValue(item, depth + 1, seen);
        return depth > 0 && text ? `${index + 1}. ${text}` : text;
      })
      .filter(Boolean)
      .join('\n\n');
  }
  if (!isRecord(value)) {
    return '';
  }
  if (seen.has(value)) {
    return '[Circular]';
  }
  seen.add(value);

  const preferredKeys = [
    'title',
    'heading',
    'summary',
    'executive_summary',
    'text',
    'body',
    'rewritten_text',
    'translation',
    'document',
    'rationale',
    'renewal_notes',
    'response',
    'definition',
    'issue',
    'suggestion',
  ];
  const orderedKeys = [
    ...preferredKeys.filter((key) => key in value),
    ...Object.keys(value).filter((key) => !preferredKeys.includes(key) && key !== 'meta'),
  ];

  return orderedKeys
    .map((key) => {
      const text = plainTextFromValue(value[key], depth + 1, seen);
      if (!text) {
        return '';
      }
      return `${humanizeKey(key)}\n${text}`;
    })
    .filter(Boolean)
    .join('\n\n');
}

export function draftingValueToPlainText(value: unknown, fallback = ''): string {
  const text = plainTextFromValue(value).trim();
  return text || fallback;
}

function markdownFromValue(title: string, primaryText: string, result?: unknown): string {
  const sections = [`# ${title}`];
  if (primaryText.trim()) {
    sections.push(primaryText.trim());
  } else if (typeof result !== 'undefined') {
    sections.push(draftingValueToPlainText(result));
  }
  return sections.filter(Boolean).join('\n\n');
}

function safeFilenameBase(value: string | undefined): string {
  const cleaned = (value ?? 'drafting-result')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return cleaned || 'drafting-result';
}

export function createDraftingExportFile(options: DraftingExportOptions): DraftingExportFile {
  const title = options.title?.trim() || 'Drafting result';
  const base = safeFilenameBase(options.filenameBase ?? title);
  const dateStamp = new Date().toISOString().slice(0, 10);
  const primaryText =
    options.primaryText?.trim() || draftingValueToPlainText(options.result, title);

  if (options.format === 'docx' || options.format === 'pdf') {
    throw new Error(`${options.format.toUpperCase()} export requires a document export library.`);
  }

  if (options.format === 'json') {
    return {
      content: JSON.stringify(
        {
          title,
          exportedAt: nowIso(),
          primaryText,
          result: options.result ?? null,
          metadata: options.metadata ?? null,
        },
        null,
        2,
      ),
      filename: `${base}-${dateStamp}.json`,
      mimeType: 'application/json;charset=utf-8',
    };
  }

  if (options.format === 'markdown') {
    return {
      content: markdownFromValue(title, primaryText, options.result),
      filename: `${base}-${dateStamp}.md`,
      mimeType: 'text/markdown;charset=utf-8',
    };
  }

  return {
    content: primaryText,
    filename: `${base}-${dateStamp}.txt`,
    mimeType: 'text/plain;charset=utf-8',
  };
}

export function downloadDraftingExport(options: DraftingExportOptions): DraftingExportFile {
  const file = createDraftingExportFile(options);
  if (typeof document === 'undefined') {
    return file;
  }
  const blob = new Blob([file.content], { type: file.mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = file.filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
  return file;
}

function collectStringArray(record: Record<string, unknown>, keys: string[]): string[] {
  const values: string[] = [];
  for (const key of keys) {
    const value = record[key];
    if (isStringArray(value)) {
      values.push(...value);
    }
  }
  return values;
}

function normalizeIssue(value: unknown, index: number): DraftingRiskIssue | null {
  if (typeof value === 'string' && value.trim()) {
    return { id: `issue-${index}`, label: value };
  }
  if (!isRecord(value)) {
    return null;
  }
  const label =
    readRecordString(value, ['label', 'issue', 'summary', 'message', 'description']) ??
    `Issue ${index + 1}`;
  return {
    id: readRecordString(value, ['id']) ?? `issue-${index}`,
    label,
    description: readRecordString(value, ['description', 'detail']),
    severity: readRecordString(value, ['severity', 'risk_level', 'level']),
    suggestion: readRecordString(value, ['suggestion', 'recommendation']),
    source: readRecordString(value, ['source']),
  };
}

export function extractDraftingRiskSummary(result: unknown): DraftingRiskSummary {
  if (!isRecord(result)) {
    return { risks: [], issues: [], notes: [] };
  }
  const meta = isRecord(result.meta) ? result.meta : undefined;
  const confidence =
    readRecordNumber(result, ['overall_confidence', 'confidence']) ??
    readRecordNumber(meta, ['overall_confidence', 'confidence']);
  const riskScore =
    readRecordNumber(result, ['risk_score']) ?? readRecordNumber(meta, ['risk_score']);
  const riskLevel =
    readRecordString(result, ['risk_level', 'risk']) ??
    readRecordString(meta, ['risk_level', 'risk']);
  const issueValues = Array.isArray(result.issues) ? result.issues : [];

  return {
    confidence,
    riskScore,
    riskLevel,
    riskShift: readRecordString(result, ['risk_shift']),
    risks: collectStringArray(result, ['risks', 'residual_risks', 'caveats']),
    issues: issueValues
      .map((issue, index) => normalizeIssue(issue, index))
      .filter((issue): issue is DraftingRiskIssue => Boolean(issue)),
    notes: collectStringArray(result, ['notes', 'assumptions', 'missing_obligations', 'gaps']),
  };
}
