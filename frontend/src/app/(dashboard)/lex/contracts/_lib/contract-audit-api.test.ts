import { afterEach, describe, expect, it, vi } from 'vitest';

const { apiGetMock, apiGetBlobMock } = vi.hoisted(() => ({
  apiGetMock: vi.fn(),
  apiGetBlobMock: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  default: { get: vi.fn() },
  apiGet: apiGetMock,
  apiGetBlob: apiGetBlobMock,
}));

const {
  CONTRACT_AUDIT_ENDPOINT,
  buildContractAuditQuery,
  contractAuditCsvFilename,
  contractAuditParamsFromFilters,
  exportContractAuditCsv,
  listContractAudit,
} = await import('./contract-audit-api');

afterEach(() => {
  apiGetMock.mockReset();
  apiGetBlobMock.mockReset();
});

describe('buildContractAuditQuery', () => {
  it('drops empty values, joins arrays, and flattens the filters passthrough', () => {
    expect(
      buildContractAuditQuery({
        status: 'active',
        search: '',
        department: undefined,
        from: '2026-01-01',
        filters: { tag: ['msa', 'vendor'], custom_key: 'x', empty: '' },
      }),
    ).toEqual({
      status: 'active',
      from: '2026-01-01',
      tag: 'msa,vendor',
      custom_key: 'x',
    });
  });

  it('adds format=csv only for the export branch', () => {
    expect(buildContractAuditQuery({ status: 'active' }, 'csv')).toEqual({
      format: 'csv',
      status: 'active',
    });
    expect(buildContractAuditQuery({ status: 'active' })).not.toHaveProperty('format');
  });
});

describe('contractAuditParamsFromFilters', () => {
  it('maps enumerated list filters onto typed params and merges search', () => {
    expect(
      contractAuditParamsFromFilters(
        {
          status: 'active',
          risk_level: 'high',
          department: 'Procurement',
          expiring_in_days: '30',
        },
        'renewal',
      ),
    ).toEqual({
      status: 'active',
      risk_level: 'high',
      department: 'Procurement',
      expiring_in_days: 30,
      search: 'renewal',
    });
  });

  it('passes unknown filter keys through verbatim and skips empties', () => {
    expect(
      contractAuditParamsFromFilters({
        expiry_from: '2026-01-01',
        tag: '',
        owner_user_id: 'u-1',
      }),
    ).toEqual({
      owner_user_id: 'u-1',
      filters: { expiry_from: '2026-01-01' },
    });
  });

  it('ignores a non-numeric expiring_in_days', () => {
    expect(contractAuditParamsFromFilters({ expiring_in_days: 'soon' })).toEqual({});
  });
});

describe('listContractAudit', () => {
  it('GETs the audit endpoint with the built query', async () => {
    const page = { data: [], meta: { page: 1, per_page: 25, total: 0, total_pages: 0 } };
    apiGetMock.mockResolvedValue(page);

    await expect(listContractAudit({ status: 'active', page: 2 })).resolves.toBe(page);
    expect(apiGetMock).toHaveBeenCalledWith(CONTRACT_AUDIT_ENDPOINT, {
      status: 'active',
      page: 2,
    });
  });
});

describe('exportContractAuditCsv', () => {
  it('fetches the blob with format=csv and returns the server filename', async () => {
    const result = { blob: new Blob(['ok']), filename: 'lex-contract-audit.csv' };
    apiGetBlobMock.mockResolvedValue(result);

    await expect(exportContractAuditCsv({ risk_level: 'high' })).resolves.toBe(result);
    expect(apiGetBlobMock).toHaveBeenCalledWith(CONTRACT_AUDIT_ENDPOINT, {
      format: 'csv',
      risk_level: 'high',
    });
  });
});

describe('contractAuditCsvFilename', () => {
  it('stamps the fallback filename with the ISO date', () => {
    expect(contractAuditCsvFilename(new Date('2026-07-09T13:00:00Z'))).toBe(
      'lex-contract-audit-2026-07-09.csv',
    );
  });
});
