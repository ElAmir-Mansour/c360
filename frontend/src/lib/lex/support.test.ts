import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { apiGet, apiPost } from '@/lib/api';
import { enterpriseApi } from '@/lib/enterprise';
import { casesApi } from '@/lib/lex/cases';
import { consultationsApi } from '@/lib/lex/consultations';
import { investigationsApi } from '@/lib/lex/investigations';
import { lexRequestsApi } from '@/lib/lex/requests';
import {
  lexSupportApi,
  lexSupportSubjectApi,
  type CreateLexSupportRequest,
} from './support';

vi.mock('@/lib/api', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
}));

const apiGetMock = vi.mocked(apiGet);
const apiPostMock = vi.mocked(apiPost);

describe('lexSupportApi', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uses the dependent directory endpoint without a separate users request', async () => {
    apiGetMock.mockResolvedValue({ data: { entities: [], members: [] } });

    await lexSupportApi.directory();
    await lexSupportApi.directory('entity-1');

    expect(apiGetMock).toHaveBeenNthCalledWith(
      1,
      '/api/v1/lex/support-requests/directory',
      undefined,
    );
    expect(apiGetMock).toHaveBeenNthCalledWith(
      2,
      '/api/v1/lex/support-requests/directory',
      { entity_id: 'entity-1' },
    );
  });

  it('submits a business-day duration and never accepts a client expiry timestamp', async () => {
    const payload: CreateLexSupportRequest = {
      target_entity_id: 'entity-1',
      assignee_id: 'user-1',
      subject: 'Review the litigation position',
      body: 'Please check the cited authority.',
      priority: 'high',
      business_days: 3,
      subject_type: 'case',
      subject_id: 'case-1',
    };
    apiPostMock.mockResolvedValue({ data: { id: 'support-1' } });

    await lexSupportApi.create(payload);

    expect(apiPostMock).toHaveBeenCalledWith(
      '/api/v1/lex/support-requests',
      payload,
    );
    expect(apiPostMock.mock.calls[0]?.[1]).not.toHaveProperty('expires_at');
  });

  it('previews expiry through the server calendar endpoint', async () => {
    apiGetMock.mockResolvedValue({
      data: { business_days: 3, expires_at: '2026-08-06T08:00:00Z' },
    });

    await lexSupportApi.previewExpiry(3);

    expect(apiGetMock).toHaveBeenCalledWith(
      '/api/v1/lex/support-requests/expiry-preview',
      { business_days: 3 },
    );
  });

  it('routes every state transition through the dedicated command endpoint', async () => {
    apiPostMock.mockResolvedValue({ data: { id: 'support-1' } });

    await lexSupportApi.accept('support-1');
    await lexSupportApi.decline('support-1', 'At capacity');
    await lexSupportApi.resolve('support-1', 'Reviewed');
    await lexSupportApi.cancel('support-1');

    expect(apiPostMock).toHaveBeenNthCalledWith(
      1,
      '/api/v1/lex/support-requests/support-1/accept',
    );
    expect(apiPostMock).toHaveBeenNthCalledWith(
      2,
      '/api/v1/lex/support-requests/support-1/decline',
      { note: 'At capacity' },
    );
    expect(apiPostMock).toHaveBeenNthCalledWith(
      3,
      '/api/v1/lex/support-requests/support-1/resolve',
      { note: 'Reviewed' },
    );
    expect(apiPostMock).toHaveBeenNthCalledWith(
      4,
      '/api/v1/lex/support-requests/support-1/cancel',
    );
  });

  it('routes the manager-approval gate through its own approve and reject commands', async () => {
    apiPostMock.mockResolvedValue({ data: { id: 'support-1' } });

    await lexSupportApi.approve('support-1');
    await lexSupportApi.reject('support-1', '  Route this through procurement.  ');
    await lexSupportApi.reject('support-1', '   ');

    expect(apiPostMock).toHaveBeenNthCalledWith(
      1,
      '/api/v1/lex/support-requests/support-1/approve',
      { note: undefined },
    );
    expect(apiPostMock).toHaveBeenNthCalledWith(
      2,
      '/api/v1/lex/support-requests/support-1/reject',
      { note: 'Route this through procurement.' },
    );
    // A whitespace-only note is dropped rather than stored as a blank reason.
    expect(apiPostMock).toHaveBeenNthCalledWith(
      3,
      '/api/v1/lex/support-requests/support-1/reject',
      { note: undefined },
    );
  });

  it('scopes the approver queue to the server-owned approvals box', async () => {
    apiGetMock.mockResolvedValue({ data: [], meta: { page: 1, per_page: 25, total: 0, total_pages: 0 } });

    await lexSupportApi.list({ box: 'approvals', status: ['pending_manager_approval'], page: 1, per_page: 25 });

    expect(apiGetMock).toHaveBeenCalledWith('/api/v1/lex/support-requests', {
      box: 'approvals',
      status: ['pending_manager_approval'],
      page: 1,
      per_page: 25,
    });
  });
});

const META = { page: 1, per_page: 20, total: 1, total_pages: 1 };

function page<T>(data: T[]) {
  return { data, meta: { ...META, total: data.length } };
}

describe('lexSupportSubjectApi', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('resolves every subject type to the human reference printed on the record', async () => {
    vi.spyOn(casesApi, 'getCase').mockResolvedValue({
      case_number: 'CASE-2026-014',
      title: { en: 'Supplier dispute', ar: 'نزاع مع مورد' },
    } as never);
    vi.spyOn(enterpriseApi.lex, 'getContract').mockResolvedValue({
      contract: { contract_number: 'CTR-2026-0031', title: 'Facilities services' },
    } as never);
    vi.spyOn(consultationsApi, 'get').mockResolvedValue({
      consultation_number: 'CONS-2026-007',
      title: { en: 'Data transfer opinion', ar: 'رأي نقل البيانات' },
    } as never);
    vi.spyOn(enterpriseApi.lex, 'getMatter').mockResolvedValue({
      matter_number: 'MAT-2026-002',
      title: 'Regulatory filing',
    } as never);
    vi.spyOn(investigationsApi, 'get').mockResolvedValue({
      investigation_number: 'INV-2026-004',
      subject: 'Procurement irregularity',
    } as never);
    vi.spyOn(lexRequestsApi, 'getRequest').mockResolvedValue({
      request_number: 'REQ-2026-120',
      title: { en: 'Contract review', ar: 'مراجعة عقد' },
    } as never);

    await expect(lexSupportSubjectApi.resolve('case', 'id-1')).resolves.toEqual({
      subject_type: 'case',
      subject_id: 'id-1',
      number: 'CASE-2026-014',
      title: { en: 'Supplier dispute', ar: 'نزاع مع مورد' },
    });
    await expect(lexSupportSubjectApi.resolve('contract', 'id-2')).resolves.toMatchObject({
      number: 'CTR-2026-0031',
      title: { en: 'Facilities services', ar: 'Facilities services' },
    });
    await expect(lexSupportSubjectApi.resolve('consultation', 'id-3')).resolves.toMatchObject({
      number: 'CONS-2026-007',
    });
    await expect(lexSupportSubjectApi.resolve('matter', 'id-4')).resolves.toMatchObject({
      number: 'MAT-2026-002',
    });
    await expect(lexSupportSubjectApi.resolve('investigation', 'id-5')).resolves.toMatchObject({
      number: 'INV-2026-004',
      title: { en: 'Procurement irregularity', ar: 'Procurement irregularity' },
    });
    await expect(lexSupportSubjectApi.resolve('request', 'id-6')).resolves.toMatchObject({
      number: 'REQ-2026-120',
    });
  });

  it('reports an unreadable record as a rejection so the caller can fall back', async () => {
    vi.spyOn(casesApi, 'getCase').mockRejectedValue(new Error('forbidden'));
    await expect(lexSupportSubjectApi.resolve('case', 'id-1')).rejects.toThrow('forbidden');
  });

  it('passes the search term to the owning catalog', async () => {
    const listCases = vi
      .spyOn(casesApi, 'listCases')
      .mockResolvedValue(
        page([{ id: 'case-1', case_number: 'CASE-2026-014', title: { en: 'A', ar: 'أ' } }]) as never,
      );

    await expect(lexSupportSubjectApi.search('case', ' CASE-2026 ')).resolves.toEqual([
      {
        subject_type: 'case',
        subject_id: 'case-1',
        number: 'CASE-2026-014',
        title: { en: 'A', ar: 'أ' },
      },
    ]);
    expect(listCases).toHaveBeenCalledWith({ page: 1, per_page: 20, search: 'CASE-2026' });
  });

  it('recovers contract-number matches the contract full-text search cannot make', async () => {
    // `/lex/contracts` search covers title/counterparty/description only.
    const listContracts = vi
      .spyOn(enterpriseApi.lex, 'listContracts')
      .mockImplementation(async (params) =>
        (params as { search?: string }).search
          ? (page([]) as never)
          : (page([
              { id: 'contract-7', contract_number: 'CTR-2026-0031', title: 'Facilities services' },
              { id: 'contract-8', contract_number: 'CTR-2025-0002', title: 'Cleaning' },
            ]) as never),
      );

    await expect(lexSupportSubjectApi.search('contract', 'CTR-2026-0031')).resolves.toEqual([
      {
        subject_type: 'contract',
        subject_id: 'contract-7',
        number: 'CTR-2026-0031',
        title: { en: 'Facilities services', ar: 'Facilities services' },
      },
    ]);
    expect(listContracts).toHaveBeenCalledTimes(2);
  });

  it('skips the supplementary contract read for a term with no reference digits', async () => {
    const listContracts = vi
      .spyOn(enterpriseApi.lex, 'listContracts')
      .mockResolvedValue(page([{ id: 'contract-7', contract_number: 'CTR-2026-0031', title: 'Facilities services' }]) as never);

    await lexSupportSubjectApi.search('contract', 'facilities');

    expect(listContracts).toHaveBeenCalledTimes(1);
    expect(listContracts).toHaveBeenCalledWith({ page: 1, per_page: 20, search: 'facilities' });
  });
});
