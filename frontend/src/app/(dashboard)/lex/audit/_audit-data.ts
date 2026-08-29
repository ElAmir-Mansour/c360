/**
 * Data helpers for the Lex Audit page, extracted from `page.tsx`.
 *
 * A `page.tsx` in the App Router may only export the default page (plus Next's
 * recognised special exports), so these query + CSV helpers — also imported by
 * `page.test.tsx` — live here as a private (`_`-prefixed) sibling module.
 */

import { apiGet } from '@/lib/api';
import {
  buildAuditLogQueryParams,
  getDefaultAuditDateRange,
  resolveAuditSeverity,
} from '@/lib/audit';
import type { PaginatedResponse } from '@/types/api';
import type { AuditLog } from '@/types/models';
import type { FetchParams } from '@/types/table';
import type { LexAuditCopy } from './_components/audit-copy';

const AUDIT_ENDPOINT = '/api/v1/audit/logs';
const LEX_SERVICE = 'lex-service';

export function fetchLexAuditLogs(
  params: FetchParams,
  range = getDefaultAuditDateRange(),
) {
  return apiGet<PaginatedResponse<AuditLog>>(AUDIT_ENDPOINT, {
    ...buildAuditLogQueryParams(params, range),
    service: LEX_SERVICE,
  });
}

export async function fetchLexAuditTimeline(
  resourceId: string,
  resourceType: string,
  range = getDefaultAuditDateRange(),
) {
  const query = {
    page: 1,
    per_page: 200,
    sort: 'created_at',
    order: 'desc',
    date_from: range.date_from,
    date_to: range.date_to,
    service: LEX_SERVICE,
    resource_id: resourceId,
    resource_type: resourceType,
  };
  const first = await apiGet<PaginatedResponse<AuditLog>>(
    AUDIT_ENDPOINT,
    query,
  );
  const rows = [...first.data];

  for (let page = 2; page <= first.meta.total_pages; page += 1) {
    const next = await apiGet<PaginatedResponse<AuditLog>>(AUDIT_ENDPOINT, {
      ...query,
      page,
    });
    rows.push(...next.data);
  }

  return rows;
}

function csvCell(value: unknown) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

export function auditCsv(rows: AuditLog[], copy: LexAuditCopy) {
  const header = [
    copy.columns.transaction,
    copy.columns.timestamp,
    copy.columns.actor,
    copy.columns.action,
    copy.columns.resource,
    copy.columns.ip,
    copy.columns.severity,
  ];
  const body = rows.map((row) =>
    [
      row.event_id || row.id,
      row.created_at,
      row.user_email,
      row.action,
      `${row.resource_type}:${row.resource_id}`,
      row.ip_address,
      resolveAuditSeverity(row.action, row.severity),
    ]
      .map(csvCell)
      .join(','),
  );
  return [header.map(csvCell).join(','), ...body].join('\n');
}
