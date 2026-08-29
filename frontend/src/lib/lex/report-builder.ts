import { casesApi } from '@/lib/lex/cases';
import { consultationsApi } from '@/lib/lex/consultations';
import { lexRequestsApi } from '@/lib/lex/requests';
import { enterpriseApi } from '@/lib/enterprise';
import { apiDelete, apiPost, apiPut } from '@/lib/api';
import type {
  CreateSavedViewInput,
  SavedViewScope,
  ServerSavedView,
  UpdateSavedViewInput,
} from '@/lib/lex/saved-views';
import { fetchSuiteData } from '@/lib/suite-api';
import type { AppLocale } from '@/lib/i18n';
import { resolveLocalized } from '@/lib/i18n/localized';
import type { FetchParams } from '@/types/table';

export const REPORT_BUILDER_NAMESPACE = 'lex-report-builder';
export const REPORT_DEFINITIONS_URL = '/api/v1/lex/report-definitions';
export const REPORT_BUILDER_SCHEMA_VERSION = 1;
export const REPORT_BUILDER_PREVIEW_SIZE = 100;
export const REPORT_BUILDER_EXPORT_PAGE_SIZE = 100;
export const REPORT_BUILDER_EXPORT_MAX_ROWS = 10_000;

export type ReportDataSourceId =
  | 'contracts'
  | 'matters'
  | 'obligations'
  | 'requests'
  | 'cases'
  | 'consultations';

export type ReportVisualization = 'table' | 'bar' | 'donut';
export type ReportSortDirection = 'asc' | 'desc';
export type ReportFilterControl = 'select' | 'text' | 'boolean' | 'date';

export interface ReportBuilderFilter {
  field: string;
  value: string;
}

export interface ReportBuilderDefinition {
  schemaVersion: typeof REPORT_BUILDER_SCHEMA_VERSION;
  name: string;
  description: string;
  source: ReportDataSourceId;
  columns: string[];
  filters: ReportBuilderFilter[];
  search: string;
  sortBy: string;
  sortDirection: ReportSortDirection;
  groupBy: string;
  visualization: ReportVisualization;
}

export interface ReportBuilderField {
  key: string;
  kind: 'text' | 'number' | 'date' | 'datetime' | 'boolean' | 'currency';
  groupable?: boolean;
  sortable?: boolean;
}

export interface ReportBuilderFilterDefinition {
  key: string;
  control: ReportFilterControl;
  options?: string[];
}

export interface ReportDataSourceDefinition {
  id: ReportDataSourceId;
  permission?: string;
  detailHref: string;
  fields: ReportBuilderField[];
  filters: ReportBuilderFilterDefinition[];
  defaultColumns: string[];
  defaultSort: string;
  defaultGroupBy: string;
  supportsNativeXlsx: boolean;
}

export type ReportBuilderRow = Record<string, unknown> & { id: string };

export interface ReportBuilderPage {
  rows: ReportBuilderRow[];
  total: number;
}

export async function listReportDefinitions(): Promise<ServerSavedView[]> {
  const items = await fetchSuiteData<ServerSavedView[] | null>(
    REPORT_DEFINITIONS_URL,
  );
  return items ?? [];
}

export function createReportDefinition(
  input: Omit<CreateSavedViewInput, 'namespace'>,
): Promise<ServerSavedView> {
  return apiPost<{ data: ServerSavedView }>(
    REPORT_DEFINITIONS_URL,
    input,
  ).then((response) => response.data);
}

export function updateReportDefinition(
  id: string,
  input: UpdateSavedViewInput,
): Promise<ServerSavedView> {
  return apiPut<{ data: ServerSavedView }>(
    `${REPORT_DEFINITIONS_URL}/${id}`,
    input,
  ).then((response) => response.data);
}

export async function deleteReportDefinition(id: string): Promise<void> {
  await apiDelete<{ data: { status: string } }>(
    `${REPORT_DEFINITIONS_URL}/${id}`,
  );
}

const PRIORITIES = ['critical', 'high', 'medium', 'low'];
const CONTRACT_STATUSES = [
  'draft',
  'internal_review',
  'legal_review',
  'negotiation',
  'pending_signature',
  'active',
  'suspended',
  'expired',
  'terminated',
  'renewed',
  'cancelled',
];
const CONTRACT_TYPES = [
  'service_agreement',
  'nda',
  'employment',
  'vendor',
  'license',
  'lease',
  'partnership',
  'consulting',
  'procurement',
  'sla',
  'mou',
  'amendment',
  'renewal',
  'other',
];
const MATTER_STATUSES = [
  'intake',
  'open',
  'in_review',
  'waiting_on_business',
  'on_hold',
  'closed',
  'cancelled',
];
const MATTER_TYPES = [
  'general',
  'contract',
  'litigation',
  'regulatory',
  'employment',
  'dispute',
  'advisory',
  'other',
];
const OBLIGATION_STATUSES = [
  'open',
  'in_progress',
  'blocked',
  'completed',
  'waived',
  'cancelled',
];
const OBLIGATION_TYPES = [
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
];
const REQUEST_STATUSES = [
  'draft',
  'submitted',
  'pending_requester_approval',
  'pending_provider_approval',
  'approved',
  'routed',
  'in_execution',
  'delivered',
  'closed',
  'returned',
  'cancelled',
];
const CASE_STATUSES = [
  'intake',
  'phase1',
  'phase2',
  'open',
  'under_procedure',
  'on_hold',
  'closed',
  'cancelled',
];
const CONSULTATION_STATUSES = [
  'submitted',
  'classified',
  'routed',
  'responded',
  'approved',
  'archived',
];
const CONSULTATION_TYPES = [
  'general',
  'contractual',
  'labor',
  'regulatory',
  'corporate',
  'litigation',
  'intellectual_property',
  'tax',
  'other',
];

export const REPORT_DATA_SOURCES: Record<ReportDataSourceId, ReportDataSourceDefinition> = {
  contracts: {
    id: 'contracts',
    detailHref: '/lex/contracts',
    fields: [
      { key: 'title', kind: 'text', sortable: true },
      { key: 'status', kind: 'text', groupable: true, sortable: true },
      { key: 'type', kind: 'text', groupable: true, sortable: true },
      { key: 'risk_level', kind: 'text', groupable: true, sortable: true },
      { key: 'party_b_name', kind: 'text' },
      { key: 'expiry_date', kind: 'date', sortable: true },
      { key: 'current_version', kind: 'number' },
      { key: 'created_at', kind: 'datetime', sortable: true },
    ],
    filters: [
      { key: 'status', control: 'select', options: CONTRACT_STATUSES },
      { key: 'type', control: 'select', options: CONTRACT_TYPES },
      { key: 'risk_level', control: 'select', options: ['critical', 'high', 'medium', 'low', 'none'] },
      { key: 'department', control: 'text' },
      { key: 'tag', control: 'text' },
    ],
    defaultColumns: ['title', 'status', 'type', 'risk_level', 'party_b_name', 'expiry_date'],
    defaultSort: 'created_at',
    defaultGroupBy: 'status',
    supportsNativeXlsx: true,
  },
  matters: {
    id: 'matters',
    detailHref: '/lex/matters',
    fields: [
      { key: 'matter_number', kind: 'text' },
      { key: 'title', kind: 'text', sortable: true },
      { key: 'status', kind: 'text', groupable: true, sortable: true },
      { key: 'type', kind: 'text', groupable: true, sortable: true },
      { key: 'priority', kind: 'text', groupable: true, sortable: true },
      { key: 'owner_name', kind: 'text', groupable: true },
      { key: 'department', kind: 'text', groupable: true },
      { key: 'opened_at', kind: 'datetime' },
      { key: 'due_date', kind: 'date', sortable: true },
      { key: 'closed_at', kind: 'datetime' },
      { key: 'created_at', kind: 'datetime', sortable: true },
    ],
    filters: [
      { key: 'status', control: 'select', options: MATTER_STATUSES },
      { key: 'type', control: 'select', options: MATTER_TYPES },
      { key: 'priority', control: 'select', options: PRIORITIES },
      { key: 'department', control: 'text' },
      { key: 'tag', control: 'text' },
      { key: 'due_after', control: 'date' },
      { key: 'due_before', control: 'date' },
    ],
    defaultColumns: ['matter_number', 'title', 'status', 'type', 'priority', 'owner_name', 'due_date'],
    defaultSort: 'created_at',
    defaultGroupBy: 'status',
    supportsNativeXlsx: true,
  },
  obligations: {
    id: 'obligations',
    detailHref: '/lex/obligations',
    fields: [
      { key: 'title', kind: 'text', sortable: true },
      { key: 'status', kind: 'text', groupable: true, sortable: true },
      { key: 'type', kind: 'text', groupable: true, sortable: true },
      { key: 'priority', kind: 'text', groupable: true, sortable: true },
      { key: 'owner_name', kind: 'text', groupable: true },
      { key: 'contract_title', kind: 'text' },
      { key: 'matter_title', kind: 'text' },
      { key: 'due_date', kind: 'date', sortable: true },
      { key: 'days_until_due', kind: 'number', sortable: true },
      { key: 'completed_at', kind: 'datetime' },
      { key: 'created_at', kind: 'datetime', sortable: true },
    ],
    filters: [
      { key: 'status', control: 'select', options: OBLIGATION_STATUSES },
      { key: 'type', control: 'select', options: OBLIGATION_TYPES },
      { key: 'priority', control: 'select', options: PRIORITIES },
      { key: 'overdue', control: 'boolean', options: ['true', 'false'] },
      { key: 'tag', control: 'text' },
      { key: 'due_after', control: 'date' },
      { key: 'due_before', control: 'date' },
    ],
    defaultColumns: ['title', 'status', 'type', 'priority', 'owner_name', 'due_date', 'days_until_due'],
    defaultSort: 'due_date',
    defaultGroupBy: 'status',
    supportsNativeXlsx: true,
  },
  requests: {
    id: 'requests',
    permission: 'lex:request:view',
    detailHref: '/lex/service-desk',
    fields: [
      { key: 'request_number', kind: 'text' },
      { key: 'title', kind: 'text' },
      { key: 'request_type', kind: 'text', groupable: true },
      { key: 'requester_name', kind: 'text', groupable: true },
      { key: 'department', kind: 'text', groupable: true },
      { key: 'priority', kind: 'text', groupable: true },
      { key: 'status', kind: 'text', groupable: true },
      { key: 'created_at', kind: 'datetime', sortable: true },
      { key: 'updated_at', kind: 'datetime', sortable: true },
    ],
    filters: [
      { key: 'status', control: 'select', options: REQUEST_STATUSES },
      { key: 'priority', control: 'select', options: ['urgent', 'normal'] },
      { key: 'request_type', control: 'text' },
      { key: 'department', control: 'text' },
    ],
    defaultColumns: ['request_number', 'title', 'request_type', 'requester_name', 'priority', 'status', 'created_at'],
    defaultSort: 'created_at',
    defaultGroupBy: 'status',
    supportsNativeXlsx: false,
  },
  cases: {
    id: 'cases',
    permission: 'lex:case:view',
    detailHref: '/lex/cases',
    fields: [
      { key: 'case_number', kind: 'text' },
      { key: 'title', kind: 'text' },
      { key: 'case_type', kind: 'text', groupable: true },
      { key: 'company_status', kind: 'text', groupable: true },
      { key: 'status', kind: 'text', groupable: true },
      { key: 'priority', kind: 'text', groupable: true },
      { key: 'risk_rating', kind: 'text', groupable: true },
      { key: 'department', kind: 'text', groupable: true },
      { key: 'responsible_lawyer', kind: 'text', groupable: true },
      { key: 'created_at', kind: 'datetime', sortable: true },
      { key: 'updated_at', kind: 'datetime', sortable: true },
    ],
    filters: [
      { key: 'status', control: 'select', options: CASE_STATUSES },
      { key: 'company_status', control: 'select', options: ['plaintiff', 'defendant'] },
      { key: 'priority', control: 'select', options: PRIORITIES },
      { key: 'risk_rating', control: 'select', options: ['critical', 'high', 'medium', 'low'] },
      { key: 'case_type', control: 'text' },
      { key: 'department', control: 'text' },
    ],
    defaultColumns: ['case_number', 'title', 'case_type', 'company_status', 'status', 'priority', 'risk_rating'],
    defaultSort: 'created_at',
    defaultGroupBy: 'status',
    supportsNativeXlsx: false,
  },
  consultations: {
    id: 'consultations',
    permission: 'lex:consultation:view',
    detailHref: '/lex/consultations',
    fields: [
      { key: 'consultation_number', kind: 'text' },
      { key: 'title', kind: 'text' },
      { key: 'type', kind: 'text', groupable: true },
      { key: 'status', kind: 'text', groupable: true },
      { key: 'priority', kind: 'text', groupable: true },
      { key: 'requester_name', kind: 'text', groupable: true },
      { key: 'department', kind: 'text', groupable: true },
      { key: 'advisor_name', kind: 'text', groupable: true },
      { key: 'sla_outcome', kind: 'text', groupable: true },
      { key: 'sla_response_due_at', kind: 'datetime' },
      { key: 'responded_at', kind: 'datetime' },
      { key: 'created_at', kind: 'datetime', sortable: true },
      { key: 'updated_at', kind: 'datetime', sortable: true },
    ],
    filters: [
      { key: 'status', control: 'select', options: CONSULTATION_STATUSES },
      { key: 'type', control: 'select', options: CONSULTATION_TYPES },
      { key: 'priority', control: 'select', options: PRIORITIES },
      { key: 'department', control: 'text' },
    ],
    defaultColumns: ['consultation_number', 'title', 'type', 'status', 'priority', 'requester_name', 'advisor_name'],
    defaultSort: 'created_at',
    defaultGroupBy: 'status',
    supportsNativeXlsx: false,
  },
};

export const REPORT_DATA_SOURCE_IDS = Object.keys(REPORT_DATA_SOURCES) as ReportDataSourceId[];

export function createDefaultReportDefinition(
  source: ReportDataSourceId = 'contracts',
): ReportBuilderDefinition {
  const dataSource = REPORT_DATA_SOURCES[source];
  return {
    schemaVersion: REPORT_BUILDER_SCHEMA_VERSION,
    name: '',
    description: '',
    source,
    columns: [...dataSource.defaultColumns],
    filters: [],
    search: '',
    sortBy: dataSource.defaultSort,
    sortDirection: 'desc',
    groupBy: dataSource.defaultGroupBy,
    visualization: 'table',
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDataSource(value: unknown): value is ReportDataSourceId {
  return typeof value === 'string' && value in REPORT_DATA_SOURCES;
}

function isVisualization(value: unknown): value is ReportVisualization {
  return value === 'table' || value === 'bar' || value === 'donut';
}

export function normalizeReportDefinition(value: unknown): ReportBuilderDefinition | null {
  if (!isRecord(value)) return null;
  const source = isDataSource(value.source) ? value.source : null;
  if (!source) return null;

  const base = createDefaultReportDefinition(source);
  const sourceDefinition = REPORT_DATA_SOURCES[source];
  const allowedFields = new Set(sourceDefinition.fields.map((field) => field.key));
  const allowedFilters = new Set(sourceDefinition.filters.map((filter) => filter.key));
  const columns = Array.isArray(value.columns)
    ? value.columns.filter((field): field is string => typeof field === 'string' && allowedFields.has(field))
    : [];
  const filters = Array.isArray(value.filters)
    ? value.filters
        .filter(
          (filter): filter is ReportBuilderFilter =>
            isRecord(filter) &&
            typeof filter.field === 'string' &&
            allowedFilters.has(filter.field) &&
            typeof filter.value === 'string' &&
            filter.value.trim() !== '',
        )
        .map((filter) => ({ field: filter.field, value: filter.value }))
    : [];
  const sortable = new Set(
    sourceDefinition.fields.filter((field) => field.sortable).map((field) => field.key),
  );
  const groupable = new Set(
    sourceDefinition.fields.filter((field) => field.groupable).map((field) => field.key),
  );

  return {
    ...base,
    name: typeof value.name === 'string' ? value.name.slice(0, 120) : '',
    description: typeof value.description === 'string' ? value.description.slice(0, 500) : '',
    columns: columns.length > 0 ? columns : base.columns,
    filters,
    search: typeof value.search === 'string' ? value.search.slice(0, 200) : '',
    sortBy:
      typeof value.sortBy === 'string' && sortable.has(value.sortBy)
        ? value.sortBy
        : base.sortBy,
    sortDirection: value.sortDirection === 'asc' ? 'asc' : 'desc',
    groupBy:
      typeof value.groupBy === 'string' && groupable.has(value.groupBy)
        ? value.groupBy
        : base.groupBy,
    visualization: isVisualization(value.visualization) ? value.visualization : base.visualization,
  };
}

export function reportDefinitionFromSavedView(
  view: Pick<ServerSavedView, 'name' | 'payload'>,
): ReportBuilderDefinition | null {
  const payload = view.payload;
  if (!isRecord(payload)) return null;
  const nested = payload.report_builder ?? payload.reportBuilder;
  const normalized = normalizeReportDefinition(nested);
  if (!normalized) return null;
  return { ...normalized, name: view.name };
}

export function reportDefinitionPayload(
  definition: ReportBuilderDefinition,
): Record<string, unknown> {
  return {
    schema_version: REPORT_BUILDER_SCHEMA_VERSION,
    report_builder: definition,
  };
}

export interface SavedReportDefinition {
  id: string;
  name: string;
  scope: SavedViewScope;
  roleSlug?: string | null;
  ownerUserId: string;
  updatedAt: string;
  definition: ReportBuilderDefinition;
}

export function mapSavedReportDefinition(view: ServerSavedView): SavedReportDefinition | null {
  const definition = reportDefinitionFromSavedView(view);
  if (!definition) return null;
  return {
    id: view.id,
    name: view.name,
    scope: view.scope,
    roleSlug: view.role_slug,
    ownerUserId: view.owner_user_id,
    updatedAt: view.updated_at,
    definition,
  };
}

function toFetchParams(
  definition: ReportBuilderDefinition,
  page: number,
  perPage: number,
): FetchParams {
  return {
    page,
    per_page: perPage,
    sort: definition.sortBy,
    order: definition.sortDirection,
    search: definition.search || undefined,
    filters: Object.fromEntries(
      definition.filters
        .filter((filter) => filter.value.trim() !== '')
        .map((filter) => [filter.field, filter.value.trim()]),
    ),
  };
}

function asBuilderRows(rows: unknown[]): ReportBuilderRow[] {
  return rows.filter(
    (row): row is ReportBuilderRow => isRecord(row) && typeof row.id === 'string',
  );
}

export async function fetchReportBuilderPage(
  definition: ReportBuilderDefinition,
  page = 1,
  perPage = REPORT_BUILDER_PREVIEW_SIZE,
): Promise<ReportBuilderPage> {
  const params = toFetchParams(definition, page, perPage);
  switch (definition.source) {
    case 'contracts': {
      const report = await enterpriseApi.lex.getContractReport(params);
      return { rows: asBuilderRows(report.contracts), total: report.total };
    }
    case 'matters': {
      const report = await enterpriseApi.lex.getMatterReport(params);
      return { rows: asBuilderRows(report.matters), total: report.total };
    }
    case 'obligations': {
      const report = await enterpriseApi.lex.getObligationReport(params);
      return { rows: asBuilderRows(report.obligations), total: report.total };
    }
    case 'requests': {
      const response = await lexRequestsApi.listRequests(params);
      return { rows: asBuilderRows(response.data), total: response.meta.total };
    }
    case 'cases': {
      const response = await casesApi.listCases(params);
      return { rows: asBuilderRows(response.data), total: response.meta.total };
    }
    case 'consultations': {
      const response = await consultationsApi.list(params);
      return { rows: asBuilderRows(response.data), total: response.meta.total };
    }
  }
}

export async function fetchAllReportBuilderRows(
  definition: ReportBuilderDefinition,
  maxRows = REPORT_BUILDER_EXPORT_MAX_ROWS,
): Promise<ReportBuilderPage> {
  const rows: ReportBuilderRow[] = [];
  let total = 0;
  let page = 1;

  while (rows.length < maxRows) {
    const result = await fetchReportBuilderPage(
      definition,
      page,
      Math.min(REPORT_BUILDER_EXPORT_PAGE_SIZE, maxRows - rows.length),
    );
    total = result.total;
    rows.push(...result.rows);
    if (result.rows.length === 0 || rows.length >= total) break;
    page += 1;
  }

  return { rows: rows.slice(0, maxRows), total };
}

export async function exportNativeReportXlsx(
  definition: ReportBuilderDefinition,
): Promise<Blob> {
  const params = toFetchParams(definition, 1, REPORT_BUILDER_PREVIEW_SIZE);
  switch (definition.source) {
    case 'contracts':
      return enterpriseApi.lex.exportContractReportXlsx(params);
    case 'matters':
      return enterpriseApi.lex.exportMatterReportXlsx(params);
    case 'obligations':
      return enterpriseApi.lex.exportObligationReportXlsx(params);
    default:
      throw new Error('Native XLSX export is unavailable for this data source.');
  }
}

export function readReportField(
  row: ReportBuilderRow,
  field: string,
  locale: AppLocale,
): unknown {
  const value = row[field];
  if (field === 'title' && (typeof value === 'string' || isRecord(value))) {
    return resolveLocalized(
      value as string | { ar: string; en: string },
      locale,
    );
  }
  if (Array.isArray(value)) return value.join(', ');
  return value;
}

export function formatReportField(
  value: unknown,
  kind: ReportBuilderField['kind'],
  locale: AppLocale,
): string {
  if (value === null || value === undefined || value === '') return '—';
  if (kind === 'boolean') {
    const truthy = value === true || value === 'true';
    if (locale === 'ar') return truthy ? 'نعم' : 'لا';
    return truthy ? 'Yes' : 'No';
  }
  if (kind === 'number' && typeof value === 'number') {
    return new Intl.NumberFormat(locale === 'ar' ? 'ar-SA' : 'en-SA').format(value);
  }
  if ((kind === 'date' || kind === 'datetime') && typeof value === 'string') {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-SA' : 'en-SA', {
        dateStyle: 'medium',
        ...(kind === 'datetime' ? { timeStyle: 'short' as const } : {}),
      }).format(date);
    }
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export interface ReportGroup {
  [key: string]: unknown;
  name: string;
  value: number;
}

export function groupReportRows(
  rows: ReportBuilderRow[],
  field: string,
  locale: AppLocale,
  emptyLabel: string,
): ReportGroup[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const raw = readReportField(row, field, locale);
    const key =
      raw === null || raw === undefined || raw === ''
        ? emptyLabel
        : String(raw);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name))
    .slice(0, 12);
}

function escapeCsv(value: string): string {
  // Spreadsheet programs treat a leading =, +, -, or @ as a formula. Prefix
  // user-authored values with an apostrophe so exported legal data stays data.
  const safeValue = /^\s*[=+\-@]/.test(value) ? `'${value}` : value;
  if (!/[",\r\n]/.test(safeValue)) return safeValue;
  return `"${safeValue.replaceAll('"', '""')}"`;
}

export function buildReportCsv(
  definition: ReportBuilderDefinition,
  rows: ReportBuilderRow[],
  locale: AppLocale,
  fieldLabel: (field: string) => string,
): string {
  const source = REPORT_DATA_SOURCES[definition.source];
  const fields = definition.columns
    .map((column) => source.fields.find((field) => field.key === column))
    .filter((field): field is ReportBuilderField => Boolean(field));
  const header = fields.map((field) => escapeCsv(fieldLabel(field.key))).join(',');
  const body = rows.map((row) =>
    fields
      .map((field) =>
        escapeCsv(
          formatReportField(
            readReportField(row, field.key, locale),
            field.kind,
            locale,
          ),
        ),
      )
      .join(','),
  );
  return [`\uFEFF${header}`, ...body].join('\r\n');
}
