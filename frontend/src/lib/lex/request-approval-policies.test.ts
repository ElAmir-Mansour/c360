/**
 * Envelope + URL contract tests for the Request-Approval Policy API client.
 *
 * Mirrors `api-routes.test.ts`: `@/lib/api` is mocked at the source so we can
 * assert (a) every method hits the expected `/api/v1/lex/request-approval/...`
 * URL and (b) the correct envelope is unwrapped — proving the previously
 * unverified assumptions:
 *   - listTemplates       → PLAIN array via fetchSuiteData (NOT paginated)
 *   - createTemplate /
 *     instantiateTemplate /
 *     conflictCheck        → unwrap `{ data }`
 *   - listPolicies         → paginated `{ data, meta }`
 *   - recommend / versions / audit → fetchSuiteData URLs
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

const { apiDeleteMock, apiGetMock, apiPatchMock, apiPostMock, apiPutMock } = vi.hoisted(() => ({
  apiDeleteMock: vi.fn(),
  apiGetMock: vi.fn(),
  apiPatchMock: vi.fn(),
  apiPostMock: vi.fn(),
  apiPutMock: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  default: { get: vi.fn() },
  apiDelete: apiDeleteMock,
  apiGet: apiGetMock,
  apiPatch: apiPatchMock,
  apiPost: apiPostMock,
  apiPut: apiPutMock,
}));

const { lexRequestApprovalPoliciesApi } = await import('./request-approval-policies');

const BASE = '/api/v1/lex/request-approval/policies';
const meta = { total: 1, page: 2, per_page: 10, total_pages: 1 };

describe('lexRequestApprovalPoliciesApi envelope + URL contract', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('listTemplates GETs the templates URL and returns the PLAIN array (not paginated)', async () => {
    const templates = [
      { id: 'tpl-1', name: 'Procurement', category: 'procurement', definition: {} },
      { id: 'tpl-2', name: 'Legal', category: 'legal', definition: {} },
    ];
    // fetchSuiteData unwraps a `{ data }` envelope where data is the array itself.
    apiGetMock.mockResolvedValue({ data: templates });

    const result = await lexRequestApprovalPoliciesApi.listTemplates();

    expect(apiGetMock).toHaveBeenCalledWith(`${BASE}/templates`, undefined);
    // No `meta` is read, no pagination wrapper — the bare array comes back.
    expect(result).toEqual(templates);
    expect(Array.isArray(result)).toBe(true);
  });

  it('getTemplate GETs the per-id URL and unwraps `{ data }`', async () => {
    const template = { id: 'tpl-1', name: 'Procurement', definition: {} };
    apiGetMock.mockResolvedValue({ data: template });

    const result = await lexRequestApprovalPoliciesApi.getTemplate('tpl-1');

    expect(apiGetMock).toHaveBeenCalledWith(`${BASE}/templates/tpl-1`, undefined);
    expect(result).toEqual(template);
  });

  it('createTemplate POSTs the payload to /templates and unwraps `{ data }`', async () => {
    const created = { id: 'tpl-new', name: 'New', definition: { mode: 'parallel' } };
    apiPostMock.mockResolvedValue({ data: created });

    const result = await lexRequestApprovalPoliciesApi.createTemplate({
      name: 'New',
      definition: { mode: 'parallel' },
    });

    expect(apiPostMock).toHaveBeenCalledWith(`${BASE}/templates`, {
      name: 'New',
      definition: { mode: 'parallel' },
    });
    expect(result).toEqual(created);
  });

  it('updateTemplate PATCHes the per-id URL and unwraps `{ data }`', async () => {
    const updated = { id: 'tpl-1', name: 'Renamed', definition: {} };
    apiPatchMock.mockResolvedValue({ data: updated });

    const result = await lexRequestApprovalPoliciesApi.updateTemplate('tpl-1', { name: 'Renamed' });

    expect(apiPatchMock).toHaveBeenCalledWith(`${BASE}/templates/tpl-1`, { name: 'Renamed' });
    expect(result).toEqual(updated);
  });

  it('deleteTemplate DELETEs the per-id URL', async () => {
    apiDeleteMock.mockResolvedValue(undefined);

    await lexRequestApprovalPoliciesApi.deleteTemplate('tpl-1');

    expect(apiDeleteMock).toHaveBeenCalledWith(`${BASE}/templates/tpl-1`);
  });

  it('instantiateTemplate POSTs to /templates/:id/instantiate and unwraps `{ data }`', async () => {
    const policy = { id: 'pol-9', name: 'From template' };
    apiPostMock.mockResolvedValue({ data: policy });

    const result = await lexRequestApprovalPoliciesApi.instantiateTemplate('tpl-1', {
      overrides: { name: 'Override name' },
    });

    expect(apiPostMock).toHaveBeenCalledWith(`${BASE}/templates/tpl-1/instantiate`, {
      overrides: { name: 'Override name' },
    });
    expect(result).toEqual(policy);
  });

  it('conflictCheck POSTs to /conflict-check and unwraps `{ data }`', async () => {
    const conflictResult = { conflicts: [{ id: 'c1', name: 'X' }], has_conflicts: true, has_identical: false };
    apiPostMock.mockResolvedValue({ data: conflictResult });

    const result = await lexRequestApprovalPoliciesApi.conflictCheck({
      name: 'Candidate',
      mode: 'parallel',
      quorum: 'all',
      approvers: [{ type: 'role', ref: 'legal' }],
    });

    expect(apiPostMock).toHaveBeenCalledWith(
      `${BASE}/conflict-check`,
      expect.objectContaining({ name: 'Candidate' }),
    );
    expect(result).toEqual(conflictResult);
  });

  it('listPolicies GETs the base URL and returns the paginated `{ data, meta }`', async () => {
    const rows = [{ id: 'pol-1', name: 'Policy A' }];
    apiGetMock.mockResolvedValue({ data: rows, meta });

    const result = await lexRequestApprovalPoliciesApi.listPolicies({
      page: 2,
      per_page: 10,
      order: 'desc',
    });

    expect(apiGetMock).toHaveBeenCalledWith(
      BASE,
      expect.objectContaining({ page: 2, per_page: 10, order: 'desc' }),
    );
    expect(result).toEqual({ data: rows, meta });
  });

  it('getPolicy / createPolicy / updatePolicy / archivePolicy / deletePolicy hit the right URLs', async () => {
    apiGetMock.mockResolvedValue({ data: { id: 'pol-1' } });
    apiPostMock.mockResolvedValue({ data: { id: 'pol-1' } });
    apiPatchMock.mockResolvedValue({ data: { id: 'pol-1' } });
    apiDeleteMock.mockResolvedValue(undefined);

    await lexRequestApprovalPoliciesApi.getPolicy('pol-1');
    await lexRequestApprovalPoliciesApi.createPolicy({
      name: 'P',
      mode: 'parallel',
      quorum: 'all',
      approvers: [],
    });
    await lexRequestApprovalPoliciesApi.updatePolicy('pol-1', { name: 'P2' });
    await lexRequestApprovalPoliciesApi.archivePolicy('pol-1');
    await lexRequestApprovalPoliciesApi.deletePolicy('pol-1');

    expect(apiGetMock).toHaveBeenCalledWith(`${BASE}/pol-1`, undefined);
    expect(apiPostMock).toHaveBeenNthCalledWith(
      1,
      BASE,
      expect.objectContaining({ name: 'P' }),
    );
    expect(apiPatchMock).toHaveBeenCalledWith(`${BASE}/pol-1`, { name: 'P2' });
    expect(apiPostMock).toHaveBeenNthCalledWith(2, `${BASE}/pol-1/archive`, {});
    expect(apiDeleteMock).toHaveBeenCalledWith(`${BASE}/pol-1`);
  });

  it('recommendPolicy GETs /recommend with params and unwraps `{ data }`', async () => {
    const recommendation = { policy: null, matched: false, reason: 'no match' };
    apiGetMock.mockResolvedValue({ data: recommendation });

    const result = await lexRequestApprovalPoliciesApi.recommendPolicy({
      request_type: 'consultation',
      stage: 'requester',
    });

    expect(apiGetMock).toHaveBeenCalledWith(`${BASE}/recommend`, {
      request_type: 'consultation',
      stage: 'requester',
    });
    expect(result).toEqual(recommendation);
  });

  it('listVersions / getVersion / restoreVersion / listAudit hit the governance URLs', async () => {
    apiGetMock.mockResolvedValue({ data: { policy_id: 'pol-1', versions: [], entries: [] } });
    apiPostMock.mockResolvedValue({ data: { id: 'pol-1' } });

    await lexRequestApprovalPoliciesApi.listVersions('pol-1');
    await lexRequestApprovalPoliciesApi.getVersion('pol-1', 3);
    await lexRequestApprovalPoliciesApi.restoreVersion('pol-1', 3);
    await lexRequestApprovalPoliciesApi.listAudit('pol-1');

    expect(apiGetMock).toHaveBeenNthCalledWith(1, `${BASE}/pol-1/versions`, undefined);
    expect(apiGetMock).toHaveBeenNthCalledWith(2, `${BASE}/pol-1/versions/3`, undefined);
    expect(apiPostMock).toHaveBeenCalledWith(`${BASE}/pol-1/versions/3/restore`, {});
    expect(apiGetMock).toHaveBeenNthCalledWith(3, `${BASE}/pol-1/audit`, undefined);
  });
});
