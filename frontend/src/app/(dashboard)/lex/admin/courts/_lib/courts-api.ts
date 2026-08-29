/**
 * Competent-court reference-list API client.
 *
 * The `legal_courts` table is created empty on purpose: the customer-supplied
 * court list arrived blank, and inventing Saudi court names would be worse than
 * shipping nothing. These mutations are how the list actually gets populated —
 * by the tenant's own administrator, the moment they have the names.
 *
 * Reads gate on `lex:catalog:view`, writes on `lex:catalog:manage`, matching the
 * case-classification reference-data precedent.
 */
import { apiDelete, apiPost, apiPut } from '@/lib/api';
import { fetchSuiteData, fetchSuitePaginated } from '@/lib/suite-api';
import type { LegalCourt } from '@/lib/lex/cases';
import type { PaginatedResponse } from '@/types/api';
import type { FetchParams } from '@/types/table';
import type { LocalizedText } from '@/types/forms';

export const LEX_COURTS_ENDPOINT = '/api/v1/lex/legal-courts';

/** React Query key root shared by the admin table and its invalidations. */
export const LEX_COURTS_QUERY_KEY = 'lex-admin-legal-courts';

/** React Query key for the legacy free-text reconciliation panel. */
export const LEX_COURT_LEGACY_QUERY_KEY = 'lex-admin-legal-court-legacy-values';

export interface CourtInput {
  code: string;
  name: LocalizedText;
  active?: boolean;
  sort?: number;
}

/**
 * One distinct free-text `competent_court` string still carried by cases created
 * before the reference list existed, with the number of cases using it. Shown so
 * an administrator can reconcile deliberately — never auto-mapped, never dropped.
 */
export interface LegacyCourtValue {
  value: string;
  cases: number;
}

export const lexCourtsApi = {
  list: (params: FetchParams): Promise<PaginatedResponse<LegalCourt>> =>
    fetchSuitePaginated<LegalCourt>(LEX_COURTS_ENDPOINT, params),

  create: (payload: CourtInput): Promise<LegalCourt> =>
    apiPost<{ data: LegalCourt }>(LEX_COURTS_ENDPOINT, payload).then((res) => res.data),

  update: (id: string, payload: Partial<CourtInput>): Promise<LegalCourt> =>
    apiPut<{ data: LegalCourt }>(`${LEX_COURTS_ENDPOINT}/${id}`, payload).then((res) => res.data),

  remove: (id: string): Promise<void> => apiDelete(`${LEX_COURTS_ENDPOINT}/${id}`).then(() => undefined),

  legacyValues: (): Promise<LegacyCourtValue[]> =>
    fetchSuiteData<LegacyCourtValue[]>(`${LEX_COURTS_ENDPOINT}/legacy-values`),
};
