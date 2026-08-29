import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuditLog } from '@/types/models';
import { apiGet } from '@/lib/api';
import {
  auditCsv,
  fetchLexAuditLogs,
  fetchLexAuditTimeline,
} from './_audit-data';
import { resolveLexAuditCopy } from './_components/audit-copy';

vi.mock('@/lib/api', () => ({
  apiGet: vi.fn(),
}));

vi.mock('@/components/providers/locale-provider', () => ({
  useLocaleOrDefault: () => ({
    locale: 'en',
    direction: 'ltr',
  }),
}));

const log: AuditLog = {
  id: 'audit-1',
  tenant_id: 'tenant-1',
  user_id: 'user-1',
  user_email: 'legal@example.test',
  action: 'com.clario360.lex.consultation.updated',
  service: 'lex-service',
  resource_type: 'consultation',
  resource_id: 'CONS-2026-001',
  old_value: { status: 'submitted' },
  new_value: { status: 'routed' },
  severity: 'info',
  ip_address: '127.0.0.1',
  user_agent: 'Vitest',
  event_id: 'event-1',
  correlation_id: 'correlation-1',
  entry_hash: 'entry-hash',
  previous_hash: 'previous-hash',
  metadata: {},
  created_at: '2026-07-26T09:00:00.000Z',
};

describe('Watheeq audit data integration', () => {
  beforeEach(() => {
    vi.mocked(apiGet).mockReset();
  });

  it('always scopes the global audit endpoint to lex-service', async () => {
    vi.mocked(apiGet).mockResolvedValue({
      data: [log],
      meta: {
        page: 1,
        per_page: 25,
        total: 1,
        total_pages: 1,
      },
    });

    await fetchLexAuditLogs(
      {
        page: 2,
        per_page: 25,
        search: 'CONS-2026-001',
        filters: { severity: 'info' },
      },
      {
        date_from: '2026-07-01T00:00:00.000Z',
        date_to: '2026-07-31T23:59:59.999Z',
      },
    );

    expect(apiGet).toHaveBeenCalledWith(
      '/api/v1/audit/logs',
      expect.objectContaining({
        page: 2,
        per_page: 25,
        search: 'CONS-2026-001',
        severity: 'info',
        service: 'lex-service',
      }),
    );
  });

  it('exports the real audit fields and safely escapes CSV content', () => {
    const copy = resolveLexAuditCopy('en');
    const csv = auditCsv(
      [
        {
          ...log,
          user_email: 'Legal, "Reviewer" <legal@example.test>',
        },
      ],
      copy,
    );

    expect(csv).toContain('"TX ID"');
    expect(csv).toContain('"event-1"');
    expect(csv).toContain(
      '"Legal, ""Reviewer"" <legal@example.test>"',
    );
    expect(csv).toContain('"consultation:CONS-2026-001"');
  });

  it('loads every available page for a selected record timeline', async () => {
    vi.mocked(apiGet)
      .mockResolvedValueOnce({
        data: [log],
        meta: {
          page: 1,
          per_page: 200,
          total: 2,
          total_pages: 2,
        },
      })
      .mockResolvedValueOnce({
        data: [{ ...log, id: 'audit-2', event_id: 'event-2' }],
        meta: {
          page: 2,
          per_page: 200,
          total: 2,
          total_pages: 2,
        },
      });

    const rows = await fetchLexAuditTimeline(
      'CONS-2026-001',
      'consultation',
      {
        date_from: '2026-07-01T00:00:00.000Z',
        date_to: '2026-07-31T23:59:59.999Z',
      },
    );

    expect(rows).toHaveLength(2);
    expect(apiGet).toHaveBeenNthCalledWith(
      1,
      '/api/v1/audit/logs',
      expect.objectContaining({
        page: 1,
        service: 'lex-service',
        resource_id: 'CONS-2026-001',
        resource_type: 'consultation',
      }),
    );
    expect(apiGet).toHaveBeenNthCalledWith(
      2,
      '/api/v1/audit/logs',
      expect.objectContaining({
        page: 2,
        resource_id: 'CONS-2026-001',
      }),
    );
  });
});
