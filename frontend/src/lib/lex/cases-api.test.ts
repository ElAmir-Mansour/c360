import { beforeEach, describe, expect, it, vi } from 'vitest';
import { casesApi } from './cases';

const { fetchSuiteDataMock, fetchSuitePaginatedMock } = vi.hoisted(() => ({
  fetchSuiteDataMock: vi.fn(),
  fetchSuitePaginatedMock: vi.fn(),
}));

vi.mock('@/lib/suite-api', () => ({
  fetchSuiteData: fetchSuiteDataMock,
  fetchSuitePaginated: fetchSuitePaginatedMock,
}));

beforeEach(() => {
  fetchSuiteDataMock.mockReset();
  fetchSuitePaginatedMock.mockReset();
  fetchSuitePaginatedMock.mockResolvedValue({
    data: [],
    meta: { page: 1, per_page: 100, total: 0, total_pages: 0 },
  });
});

describe('casesApi case-creation catalogues', () => {
  it('uses the approved paginated selectable-classification endpoint', async () => {
    const params = { page: 1, per_page: 100, sort: 'sort', order: 'asc' as const };

    await casesApi.listSelectableClassifications(params);

    expect(fetchSuitePaginatedMock).toHaveBeenCalledWith(
      '/api/v1/lex/case-classifications/selectable',
      params,
    );
  });

  it('uses the tenant court catalogue endpoint with caller-supplied filters', async () => {
    const params = {
      page: 1,
      per_page: 100,
      search: 'commercial',
      filters: { active: 'true' },
    };

    await casesApi.listCourts(params);

    expect(fetchSuitePaginatedMock).toHaveBeenCalledWith(
      '/api/v1/lex/legal-courts',
      params,
    );
  });
});
