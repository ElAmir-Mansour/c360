/**
 * Typed client for the portfolio-wide contract audit feed
 * (`GET /api/v1/lex/contracts/audit`) — Feature #7 (audit drawer + export).
 *
 * The endpoint accepts the SAME query params as the contracts list
 * (status / type / risk_level / search / owner_user_id / department / tag /
 * org_entity_id / expiring_in_days + pagination/sort) plus an occurred_at
 * window (`from` / `to`, date-only `to` is inclusive end-of-day) so the feed
 * answers "the audit trail of exactly the contracts I am looking at".
 *
 * Two shapes are served:
 *  - JSON  → `listContractAudit`     — paginated `LexContractAuditEvent` rows.
 *  - CSV   → `exportContractAuditCsv` — UTF-8-with-BOM export (`?format=csv`)
 *    downloaded through the authenticated axios pipeline (`apiGetBlob`), since
 *    the access token lives only in memory and a plain anchor cannot
 *    authenticate.
 *
 * Kept feature-local (mirrors `_lib/settlement-export.ts`); the fns are
 * drop-in candidates for `enterpriseApi.lex` should the client ever be
 * centralized.
 */

import { apiGet, apiGetBlob } from '@/lib/api';
import type { PaginatedResponse } from '@/types/api';
import type {
  JsonObject,
  LexContractStatus,
  LexContractType,
  LexRiskLevel,
} from '@/types/suites';

export const CONTRACT_AUDIT_ENDPOINT = '/api/v1/lex/contracts/audit';

/**
 * One row of the tenant-wide, append-only contract audit feed: who changed
 * what on which contract, when, and the before→after values where the schema
 * retains them. Mirrors backend `model.ContractAuditEvent` (JSON tags).
 */
export interface LexContractAuditEvent {
  id: string;
  tenant_id: string;
  contract_id: string;
  contract_title: string;
  /** e.g. contract_created / status_changed / version_uploaded / … */
  event_type: string;
  /** Audited attribute: status, archive_status, document_version, lifecycle… */
  field: string;
  before?: string | null;
  after?: string | null;
  /** Mutating user where the schema stamps one; absent for system events. */
  actor_user_id?: string | null;
  occurred_at: string;
  /** Storage provenance, e.g. "contracts.status_changed_at". */
  source: string;
  detail?: JsonObject | null;
}

/**
 * Query surface of GET /contracts/audit. Enumerated fields match the
 * contracts-list parser; `from`/`to` are the audit-only occurred_at window;
 * `filters` passes any future list filters through verbatim (same philosophy
 * as `LexExportContractsReportParams`).
 */
export interface LexContractAuditParams {
  status?: LexContractStatus;
  type?: LexContractType;
  risk_level?: LexRiskLevel;
  search?: string;
  owner_user_id?: string;
  department?: string;
  tag?: string;
  org_entity_id?: string;
  expiring_in_days?: number;
  /** Inclusive ISO lower bound on occurred_at. */
  from?: string;
  /** Upper bound on occurred_at (date-only value is inclusive end-of-day). */
  to?: string;
  page?: number;
  per_page?: number;
  sort?: string;
  order?: 'asc' | 'desc';
  /** Passthrough for additional list filters not enumerated above. */
  filters?: Record<string, unknown>;
}

/**
 * Builds the audit query, dropping empty values and joining arrays the same
 * way the contracts-report builder does. `format: 'csv'` selects the export
 * branch on the server.
 */
export function buildContractAuditQuery(
  params: LexContractAuditParams = {},
  format?: 'csv',
): Record<string, unknown> {
  const { filters, ...rest } = params;
  const query: Record<string, unknown> = {};
  if (format) {
    query.format = format;
  }
  const assign = (key: string, value: unknown) => {
    if (value === undefined || value === null || value === '') {
      return;
    }
    if (Array.isArray(value)) {
      if (value.length === 0) {
        return;
      }
      query[key] = value.join(',');
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

/** Filter keys the audit endpoint parses into typed fields. */
const ENUMERATED_AUDIT_KEYS = new Set([
  'status',
  'type',
  'risk_level',
  'search',
  'owner_user_id',
  'department',
  'tag',
  'org_entity_id',
  'from',
  'to',
]);

/**
 * Projects the list page's `activeFilters` (from `useDataTable`) + search box
 * into `LexContractAuditParams`, so the audit export tracks exactly what the
 * user is viewing. Unknown keys ride along in `filters` (the server ignores
 * what it does not parse), mirroring `exportFilteredReport` on the page.
 */
export function contractAuditParamsFromFilters(
  activeFilters: Record<string, string | string[]>,
  search?: string,
): LexContractAuditParams {
  const params: LexContractAuditParams = {};
  const passthrough: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(activeFilters)) {
    if (value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) {
      continue;
    }
    if (key === 'expiring_in_days') {
      const days = Number(Array.isArray(value) ? value[0] : value);
      if (Number.isFinite(days)) {
        params.expiring_in_days = days;
      }
      continue;
    }
    if (ENUMERATED_AUDIT_KEYS.has(key) && typeof value === 'string') {
      (params as Record<string, unknown>)[key] = value;
      continue;
    }
    passthrough[key] = value;
  }
  if (search) {
    params.search = search;
  }
  if (Object.keys(passthrough).length > 0) {
    params.filters = passthrough;
  }
  return params;
}

/** JSON feed: paginated audit events, newest first. */
export async function listContractAudit(
  params: LexContractAuditParams = {},
): Promise<PaginatedResponse<LexContractAuditEvent>> {
  return apiGet<PaginatedResponse<LexContractAuditEvent>>(
    CONTRACT_AUDIT_ENDPOINT,
    buildContractAuditQuery(params),
  );
}

/**
 * CSV export (`?format=csv`). Returns the Blob plus the server-suggested
 * filename (Content-Disposition: `lex-contract-audit.csv`) so the caller can
 * hand both straight to `downloadBlob`.
 */
export async function exportContractAuditCsv(
  params: LexContractAuditParams = {},
): Promise<{ blob: Blob; filename: string | null }> {
  return apiGetBlob(CONTRACT_AUDIT_ENDPOINT, buildContractAuditQuery(params, 'csv'));
}

/** Date-stamped fallback filename when the server suggests none. */
export function contractAuditCsvFilename(now: Date = new Date()): string {
  return `lex-contract-audit-${now.toISOString().slice(0, 10)}.csv`;
}
