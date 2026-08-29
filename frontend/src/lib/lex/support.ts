/**
 * Typed client for Lex peer-to-peer support requests.
 *
 * The server remains authoritative for tenancy, org membership, visibility,
 * state transitions, and business-calendar expiry. In particular, the client
 * submits a business-day count and never an absolute `expires_at` value.
 */

import { apiGet, apiPost } from '@/lib/api';
import type { PaginatedResponse } from '@/types/api';
import type { LexContractRecord } from '@/types/suites';
import { enterpriseApi } from '@/lib/enterprise';
import { casesApi } from '@/lib/lex/cases';
import { consultationsApi } from '@/lib/lex/consultations';
import { investigationsApi } from '@/lib/lex/investigations';
import { lexRequestsApi } from '@/lib/lex/requests';

const BASE = '/api/v1/lex/support-requests';

export type LexSupportPriority = 'low' | 'normal' | 'high';
export type LexSupportStatus =
  /** The approval gate in front of `open`: submitted, but not routed to anyone yet. */
  | 'pending_manager_approval'
  | 'open'
  | 'accepted'
  | 'resolved'
  | 'declined'
  | 'expired'
  | 'cancelled'
  /** Terminal: the approver refused to route the request. Distinct from `declined`. */
  | 'rejected';

/**
 * How the approver on a request was arrived at. The two `auto_*` routes cleared
 * the gate with no human decision, so any surface that names an approver must
 * check this first rather than implying a person approved the request.
 */
export type LexSupportApprovalRoute = 'manager' | 'unit_head' | 'auto_no_manager' | 'auto_self';
export type LexSupportSubjectType =
  | 'case'
  | 'contract'
  | 'consultation'
  | 'matter'
  | 'investigation'
  | 'request';
/**
 * `approvals` is the approver's own scope — the server returns only rows whose
 * frozen `approver_user_id` is the caller, so it doubles as the authorization
 * gate for the approve/reject controls.
 */
export type LexSupportBox = 'inbox' | 'sent' | 'approvals' | 'all';

export interface LocalizedText {
  en: string;
  ar: string;
}

export interface LexSupportParty {
  id: string;
  first_name: string;
  last_name: string;
  avatar_url?: string | null;
}

export interface LexSupportEntitySummary {
  id: string;
  code: string;
  name: LocalizedText;
  entity_type: string;
}

export interface LexSupportRequest {
  id: string;
  tenant_id: string;
  requester_id: string;
  requester_entity_id?: string | null;
  target_entity_id: string;
  assignee_id: string;
  subject: string;
  body: string;
  priority: LexSupportPriority;
  subject_type?: LexSupportSubjectType | null;
  subject_id?: string | null;
  status: LexSupportStatus;
  resolution_note: string;
  /**
   * Approval gate. Every field below is optional so a pre-gate deployment fails
   * soft: an absent `approval_route` means "unknown", never "auto-approved".
   *
   * `approver_user_id` is frozen at creation and is null only on the
   * `auto_no_manager` route, where nobody above the requester exists.
   */
  approver_user_id?: string | null;
  approval_decided_at?: string | null;
  approval_note?: string;
  approval_route?: LexSupportApprovalRoute | null;
  /** The requested validity window, unmaterialised until the request is routed. */
  business_days?: number | null;
  expires_at?: string | null;
  accepted_at?: string | null;
  closed_at?: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
  /** Read-model enrichment. Optional so an older deployment fails soft. */
  requester?: LexSupportParty | null;
  assignee?: LexSupportParty | null;
  approver?: LexSupportParty | null;
  requester_entity?: LexSupportEntitySummary | null;
  target_entity?: LexSupportEntitySummary | null;
}

export interface LexSupportDirectoryMember {
  user_id: string;
  first_name: string;
  last_name: string;
  employee_code: string;
  title: LocalizedText;
  manager_user_id?: string | null;
  avatar_url?: string | null;
}

export interface LexSupportDirectory {
  entities: LexSupportEntitySummary[];
  selected_entity_id?: string;
  members: LexSupportDirectoryMember[];
}

export interface LexSupportExpiryPreview {
  business_days: number;
  expires_at: string;
}

export interface CreateLexSupportRequest {
  target_entity_id: string;
  assignee_id: string;
  subject: string;
  body?: string;
  priority: LexSupportPriority;
  subject_type?: LexSupportSubjectType;
  subject_id?: string;
  business_days?: number;
}

export interface ListLexSupportRequests {
  box: LexSupportBox;
  status?: LexSupportStatus[];
  entity_id?: string;
  history?: boolean;
  page?: number;
  per_page?: number;
}

function unwrap<T>(response: { data: T }): T {
  return response.data;
}

export const lexSupportApi = {
  list: (params: ListLexSupportRequests): Promise<PaginatedResponse<LexSupportRequest>> =>
    apiGet<PaginatedResponse<LexSupportRequest>>(BASE, params),

  get: (id: string): Promise<LexSupportRequest> =>
    apiGet<{ data: LexSupportRequest }>(`${BASE}/${id}`).then(unwrap),

  create: (payload: CreateLexSupportRequest): Promise<LexSupportRequest> =>
    apiPost<{ data: LexSupportRequest }>(BASE, payload).then(unwrap),

  directory: (entityId?: string): Promise<LexSupportDirectory> =>
    apiGet<{ data: LexSupportDirectory }>(
      `${BASE}/directory`,
      entityId ? { entity_id: entityId } : undefined,
    ).then(unwrap),

  previewExpiry: (businessDays: number): Promise<LexSupportExpiryPreview> =>
    apiGet<{ data: LexSupportExpiryPreview }>(`${BASE}/expiry-preview`, {
      business_days: businessDays,
    }).then(unwrap),

  accept: (id: string): Promise<LexSupportRequest> =>
    apiPost<{ data: LexSupportRequest }>(`${BASE}/${id}/accept`).then(unwrap),

  decline: (id: string, note?: string): Promise<LexSupportRequest> =>
    apiPost<{ data: LexSupportRequest }>(`${BASE}/${id}/decline`, {
      note: note?.trim() || undefined,
    }).then(unwrap),

  resolve: (id: string, note?: string): Promise<LexSupportRequest> =>
    apiPost<{ data: LexSupportRequest }>(`${BASE}/${id}/resolve`, {
      note: note?.trim() || undefined,
    }).then(unwrap),

  cancel: (id: string): Promise<LexSupportRequest> =>
    apiPost<{ data: LexSupportRequest }>(`${BASE}/${id}/cancel`).then(unwrap),

  /**
   * Clear the approval gate. The server is the authority: it answers 403 unless
   * the caller is the frozen approver and 409 unless the request is still
   * `pending_manager_approval`, and it materialises `expires_at` here so a slow
   * approval does not eat the colleague's validity window.
   */
  approve: (id: string, note?: string): Promise<LexSupportRequest> =>
    apiPost<{ data: LexSupportRequest }>(`${BASE}/${id}/approve`, {
      note: note?.trim() || undefined,
    }).then(unwrap),

  /** Refuse to route the request. Terminal; the note is shown to the requester. */
  reject: (id: string, note?: string): Promise<LexSupportRequest> =>
    apiPost<{ data: LexSupportRequest }>(`${BASE}/${id}/reject`, {
      note: note?.trim() || undefined,
    }).then(unwrap),
};

/* --------------------------------------------------------------------------
 * Linked-record (subject) resolution
 *
 * `subject_type` + `subject_id` is all the support API stores. A UUID is not
 * something a requester can recognise, so the composer resolves the *human*
 * identifier — the case number, contract number, consultation reference —
 * from the owning domain catalog. Every read here is best-effort: the caller
 * is expected to fall back to the bare type label when a lookup fails or the
 * requester lacks read permission on that record.
 * ------------------------------------------------------------------------ */

/** A linkable legal record reduced to what a human recognises. */
export interface LexSupportSubjectRecord {
  subject_type: LexSupportSubjectType;
  subject_id: string;
  /** Reference printed on the record (`CASE-2026-014`); empty when unnumbered. */
  number: string;
  title: LocalizedText;
}

/** Picker page size — the picker is a search box, not a browsable catalog. */
const SUBJECT_PAGE_SIZE = 20;

/** A term worth re-checking against reference numbers rather than prose. */
const REFERENCE_LIKE = /\d/;

function bilingual(value: string | null | undefined): LocalizedText {
  const text = value ?? '';
  return { en: text, ar: text };
}

function asLocalized(value: LocalizedText | string | null | undefined): LocalizedText {
  if (!value) return { en: '', ar: '' };
  if (typeof value === 'string') return bilingual(value);
  return { en: value.en ?? '', ar: value.ar ?? '' };
}

function subjectRecord(
  subjectType: LexSupportSubjectType,
  subjectId: string,
  number: string | null | undefined,
  title: LocalizedText | string | null | undefined,
): LexSupportSubjectRecord {
  return {
    subject_type: subjectType,
    subject_id: subjectId,
    number: (number ?? '').trim(),
    title: asLocalized(title),
  };
}

function listParams(search: string) {
  return { page: 1, per_page: SUBJECT_PAGE_SIZE, search: search.trim() || undefined };
}

/**
 * `/lex/contracts` full-text search covers title, counterparty and description
 * but NOT `contract_number`, so a reference-shaped term also pulls the first
 * unfiltered page and matches the number client-side. The supplementary read
 * is best-effort and never fails the search.
 */
async function searchContracts(term: string): Promise<LexContractRecord[]> {
  const trimmed = term.trim();
  const [matched, unfiltered] = await Promise.all([
    enterpriseApi.lex.listContracts(listParams(trimmed)).then((response) => response.data),
    trimmed && REFERENCE_LIKE.test(trimmed)
      ? enterpriseApi.lex
          .listContracts({ page: 1, per_page: SUBJECT_PAGE_SIZE })
          .then((response) => response.data, () => [] as LexContractRecord[])
      : Promise.resolve([] as LexContractRecord[]),
  ]);
  const needle = trimmed.toLocaleLowerCase();
  const seen = new Set(matched.map((record) => record.id));
  const byNumber = unfiltered.filter(
    (record) =>
      !seen.has(record.id) &&
      (record.contract_number ?? '').toLocaleLowerCase().includes(needle),
  );
  return [...matched, ...byNumber];
}

export const lexSupportSubjectApi = {
  /** Resolve one bound record to its human identifier. Rejects when unreadable. */
  async resolve(
    subjectType: LexSupportSubjectType,
    subjectId: string,
  ): Promise<LexSupportSubjectRecord> {
    switch (subjectType) {
      case 'case': {
        const record = await casesApi.getCase(subjectId);
        return subjectRecord(subjectType, subjectId, record.case_number, record.title);
      }
      case 'contract': {
        const detail = await enterpriseApi.lex.getContract(subjectId);
        return subjectRecord(
          subjectType,
          subjectId,
          detail.contract.contract_number,
          detail.contract.title,
        );
      }
      case 'consultation': {
        const record = await consultationsApi.get(subjectId);
        return subjectRecord(subjectType, subjectId, record.consultation_number, record.title);
      }
      case 'matter': {
        const record = await enterpriseApi.lex.getMatter(subjectId);
        return subjectRecord(subjectType, subjectId, record.matter_number, record.title);
      }
      case 'investigation': {
        const record = await investigationsApi.get(subjectId);
        return subjectRecord(
          subjectType,
          subjectId,
          record.investigation_number,
          record.subject,
        );
      }
      case 'request': {
        const record = await lexRequestsApi.getRequest(subjectId);
        return subjectRecord(subjectType, subjectId, record.request_number, record.title);
      }
    }
  },

  /** Search one catalog by reference number or title. */
  async search(
    subjectType: LexSupportSubjectType,
    term: string,
  ): Promise<LexSupportSubjectRecord[]> {
    switch (subjectType) {
      case 'case': {
        const response = await casesApi.listCases(listParams(term));
        return response.data.map((record) =>
          subjectRecord(subjectType, record.id, record.case_number, record.title),
        );
      }
      case 'contract': {
        const records = await searchContracts(term);
        return records.map((record) =>
          subjectRecord(subjectType, record.id, record.contract_number, record.title),
        );
      }
      case 'consultation': {
        const response = await consultationsApi.list(listParams(term));
        return response.data.map((record) =>
          subjectRecord(subjectType, record.id, record.consultation_number, record.title),
        );
      }
      case 'matter': {
        const response = await enterpriseApi.lex.listMatters(listParams(term));
        return response.data.map((record) =>
          subjectRecord(subjectType, record.id, record.matter_number, record.title),
        );
      }
      case 'investigation': {
        const response = await investigationsApi.list(listParams(term));
        return response.data.map((record) =>
          subjectRecord(subjectType, record.id, record.investigation_number, record.subject),
        );
      }
      case 'request': {
        const response = await lexRequestsApi.listRequests(listParams(term));
        return response.data.map((record) =>
          subjectRecord(subjectType, record.id, record.request_number, record.title),
        );
      }
    }
  },
};
