import type {
  JsonObject,
  JsonValue,
  LexClause,
  LexContractRecord,
  LexContractStatus,
  LexContractVersion,
  LexDashboard,
} from '@/types/suites';

export const WATHEEQ_LIFECYCLE_STAGES: LexContractStatus[] = [
  'draft',
  'internal_review',
  'legal_review',
  'negotiation',
  'pending_signature',
  'active',
];

export type RedlineChunkType = 'unchanged' | 'added' | 'removed';

export interface RedlineChunk {
  type: RedlineChunkType;
  text: string;
}

export interface WatheeqMatterSummary {
  id?: string;
  title: string;
  status: string;
  owner?: string;
  priority?: string;
}

export interface WatheeqObligationSummary {
  id?: string;
  title: string;
  status: string;
  owner?: string;
  dueDate?: string;
  reminderDays?: number;
}

export interface RenewalWarning {
  level: 'overdue' | 'urgent' | 'warning' | 'ok' | 'none';
  label: string;
  daysUntil: number | null;
  anchorDate: string | null;
}

function isObject(value: JsonValue | undefined): value is JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function asString(value: JsonValue | undefined): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function asNumber(value: JsonValue | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readObject(source: JsonObject, keys: string[]): JsonObject | null {
  for (const key of keys) {
    const value = source[key];
    if (isObject(value)) {
      return value;
    }
  }
  return null;
}

function readArray(source: JsonObject, keys: string[]): JsonValue[] {
  for (const key of keys) {
    const value = source[key];
    if (Array.isArray(value)) {
      return value;
    }
  }
  return [];
}

export function extractMatterSummary(contract: LexContractRecord): WatheeqMatterSummary | null {
  const matter = readObject(contract.metadata, ['matter', 'legal_matter', 'case']);
  const matterId = asString(contract.metadata.matter_id) ?? asString(matter?.id);
  const title =
    asString(contract.metadata.matter_title) ??
    asString(matter?.title) ??
    asString(matter?.name);

  if (!matterId && !title) {
    return null;
  }

  return {
    id: matterId,
    title: title ?? `Matter ${matterId}`,
    status: asString(contract.metadata.matter_status) ?? asString(matter?.status) ?? 'not_assessed',
    owner: asString(contract.metadata.matter_owner) ?? asString(matter?.owner),
    priority: asString(contract.metadata.matter_priority) ?? asString(matter?.priority),
  };
}

export function extractObligationSummaries(contract: LexContractRecord): WatheeqObligationSummary[] {
  return readArray(contract.metadata, ['obligations', 'contract_obligations'])
    .filter(isObject)
    .map((obligation, index) => ({
      id: asString(obligation.id),
      title: asString(obligation.title) ?? asString(obligation.name) ?? `Obligation ${index + 1}`,
      status: asString(obligation.status) ?? 'not_assessed',
      owner: asString(obligation.owner) ?? asString(obligation.owner_name),
      dueDate: asString(obligation.due_date) ?? asString(obligation.dueDate),
      reminderDays: asNumber(obligation.reminder_days) ?? asNumber(obligation.reminderDays),
    }));
}

// Arabic day-count with number/noun agreement (Western digits, Saudi admin
// style): 1 يوم واحد, 2 يومان, 3–10 أيام, 11+ يومًا.
function arDays(n: number): string {
  if (n === 1) return 'يوم واحد';
  if (n === 2) return 'يومان';
  if (n >= 3 && n <= 10) return `${n} أيام`;
  return `${n} يومًا`;
}

function renewalLabel(
  kind: 'none' | 'overdue' | 'remaining',
  n: number,
  locale: 'ar' | 'en',
): string {
  if (locale === 'ar') {
    if (kind === 'none') return 'لا يوجد تاريخ تجديد أو انتهاء';
    if (kind === 'overdue') return `متأخّر بمقدار ${arDays(n)}`;
    return `يتبقّى ${arDays(n)}`;
  }
  if (kind === 'none') return 'No renewal or expiry date';
  if (kind === 'overdue') return `${n} days overdue`;
  return `${n} days remaining`;
}

export function getRenewalWarning(
  contract: LexContractRecord,
  today = new Date(),
  locale: 'ar' | 'en' = 'en',
): RenewalWarning {
  const anchorDate = contract.renewal_date ?? contract.expiry_date ?? null;
  if (!anchorDate) {
    return { level: 'none', label: renewalLabel('none', 0, locale), daysUntil: null, anchorDate: null };
  }

  const daysUntil = daysUntilDate(anchorDate, today);
  const noticeDays = Math.max(0, contract.renewal_notice_days || 30);

  if (daysUntil < 0) {
    return { level: 'overdue', label: renewalLabel('overdue', Math.abs(daysUntil), locale), daysUntil, anchorDate };
  }
  if (daysUntil <= 7) {
    return { level: 'urgent', label: renewalLabel('remaining', daysUntil, locale), daysUntil, anchorDate };
  }
  if (daysUntil <= noticeDays) {
    return { level: 'warning', label: renewalLabel('remaining', daysUntil, locale), daysUntil, anchorDate };
  }
  return { level: 'ok', label: renewalLabel('remaining', daysUntil, locale), daysUntil, anchorDate };
}

export function daysUntilDate(value: string, today = new Date()): number {
  const target = new Date(value);
  if (Number.isNaN(target.getTime())) {
    return 0;
  }
  const start = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const end = Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate());
  return Math.ceil((end - start) / 86_400_000);
}

export function buildContractRedline(
  previousVersion: LexContractVersion | null | undefined,
  currentVersion: LexContractVersion | null | undefined,
): RedlineChunk[] {
  const previous = previousVersion?.extracted_text?.trim() ?? '';
  const current = currentVersion?.extracted_text?.trim() ?? '';
  if (!previous || !current) {
    return [];
  }

  return diffTokens(tokenizeRedline(previous), tokenizeRedline(current));
}

export function diffTokens(previousTokens: string[], currentTokens: string[]): RedlineChunk[] {
  const rows = previousTokens.length + 1;
  const cols = currentTokens.length + 1;
  const table = Array.from({ length: rows }, () => Array<number>(cols).fill(0));

  for (let i = previousTokens.length - 1; i >= 0; i -= 1) {
    for (let j = currentTokens.length - 1; j >= 0; j -= 1) {
      table[i][j] =
        previousTokens[i] === currentTokens[j]
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const chunks: RedlineChunk[] = [];
  let i = 0;
  let j = 0;

  while (i < previousTokens.length && j < currentTokens.length) {
    if (previousTokens[i] === currentTokens[j]) {
      pushChunk(chunks, 'unchanged', previousTokens[i]);
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      pushChunk(chunks, 'removed', previousTokens[i]);
      i += 1;
    } else {
      pushChunk(chunks, 'added', currentTokens[j]);
      j += 1;
    }
  }

  while (i < previousTokens.length) {
    pushChunk(chunks, 'removed', previousTokens[i]);
    i += 1;
  }
  while (j < currentTokens.length) {
    pushChunk(chunks, 'added', currentTokens[j]);
    j += 1;
  }

  return chunks;
}

export function summarizeClauseLibrary(clauses: LexClause[]): {
  total: number;
  bilingualReady: number;
  deprecated: number;
  pendingReview: number;
} {
  return clauses.reduce(
    (summary, clause) => {
      const hasArabic = /[\u0600-\u06ff]/.test(clause.content);
      const hasEnglish = /[A-Za-z]/.test(clause.content);
      return {
        total: summary.total + 1,
        bilingualReady: summary.bilingualReady + (hasArabic && hasEnglish ? 1 : 0),
        deprecated: summary.deprecated + (clause.review_status === 'rejected' ? 1 : 0),
        pendingReview: summary.pendingReview + (clause.review_status === 'pending' ? 1 : 0),
      };
    },
    { total: 0, bilingualReady: 0, deprecated: 0, pendingReview: 0 },
  );
}

export function createLexDashboardCsv(dashboard: LexDashboard): string {
  const rows: string[][] = [
    ['Section', 'Metric', 'Value'],
    ...Object.entries(dashboard.kpis).map(([metric, value]) => ['KPI', metric, String(value)]),
    ...Object.entries(dashboard.contracts_by_status).map(([status, value]) => ['Contracts by status', status, String(value)]),
    ...Object.entries(dashboard.contracts_by_type).map(([type, value]) => ['Contracts by type', type, String(value)]),
    ...dashboard.expiring_contracts.map((contract) => [
      'Expiring contract',
      contract.title,
      `${contract.days_until_expiry} days`,
    ]),
    ...dashboard.monthly_activity.map((activity) => [
      'Monthly activity',
      activity.month,
      `created=${activity.created}; activated=${activity.activated}; expired=${activity.expired}; renewed=${activity.renewed}`,
    ]),
  ];

  return rows.map((row) => row.map(csvCell).join(',')).join('\n');
}

function tokenizeRedline(value: string): string[] {
  return value.match(/\s+|[^\s]+/g) ?? [];
}

function pushChunk(chunks: RedlineChunk[], type: RedlineChunkType, text: string): void {
  const previous = chunks[chunks.length - 1];
  if (previous?.type === type) {
    previous.text += text;
    return;
  }
  chunks.push({ type, text });
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
