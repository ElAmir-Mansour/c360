import { afterEach, describe, expect, it, vi } from 'vitest';

const { apiGetMock, readSnapshotsMock } = vi.hoisted(() => ({
  apiGetMock: vi.fn(),
  readSnapshotsMock: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  apiGet: apiGetMock,
}));

vi.mock('@/lib/lex/admin', () => ({
  LEX_ADMIN_ENDPOINTS: {
    ORG_ENTITIES: '/api/v1/lex/org-entities',
  },
}));

vi.mock('../../_lib/admin-feature-utils', () => ({
  localSnapshotKey: (namespace: string, id: string) => `snapshot:${namespace}:${id}`,
  readSnapshots: readSnapshotsMock,
}));

const platformApi = await import('./platform-sync-api');
const auditApi = await import('./org-audit-api');

afterEach(() => {
  vi.clearAllMocks();
  readSnapshotsMock.mockReturnValue([]);
});

describe('fetchPlatformOrgUnitsResult', () => {
  it('treats an empty backend list as loaded, not degraded', async () => {
    apiGetMock.mockResolvedValueOnce({ data: [] });

    const result = await platformApi.fetchPlatformOrgUnitsResult();

    expect(apiGetMock).toHaveBeenCalledWith('/api/v1/lex/org-entities/platform-units');
    expect(result).toEqual({ units: [], degraded: false });
  });

  it('marks the result degraded when the read fails', async () => {
    apiGetMock.mockRejectedValueOnce(new Error('network down'));

    const result = await platformApi.fetchPlatformOrgUnitsResult();

    expect(result).toEqual({ units: [], degraded: true });
  });
});

describe('fetchOrgAuditResult', () => {
  it('does not mark a successful empty audit response as degraded', async () => {
    readSnapshotsMock.mockReturnValueOnce([]);
    apiGetMock.mockResolvedValueOnce({ data: [] });

    const result = await auditApi.fetchOrgAuditResult('entity-1');

    expect(apiGetMock).toHaveBeenCalledWith('/api/v1/lex/org-entities/entity-1/audit');
    expect(readSnapshotsMock).toHaveBeenCalledWith('org-entities', 'entity-1');
    expect(result).toEqual({ events: [], degraded: false });
  });

  it('falls back to local snapshots and marks degraded after request failure', async () => {
    readSnapshotsMock.mockReturnValueOnce([
      {
        id: 'entity-1',
        code: 'LE-1',
        updated_at: '2026-01-02T03:04:05.000Z',
        snapshot_reason: 'Saved local edit',
      },
    ]);
    apiGetMock.mockRejectedValueOnce(new Error('service unavailable'));

    const result = await auditApi.fetchOrgAuditResult('entity-1');

    expect(result.degraded).toBe(true);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      action: 'snapshot',
      entity_id: 'entity-1',
      entity_code: 'LE-1',
      summary: 'Saved local edit',
    });
  });
});
