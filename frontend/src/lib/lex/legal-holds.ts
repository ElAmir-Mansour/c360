/**
 * Legal Hold (FR-WATHEEQ-005) API client.
 *
 * Typed HTTP client for the litigation / regulatory preservation vertical. A
 * legal hold freezes a single contract, matter, document, or consultation so it
 * cannot be deleted, archived, or destructively edited while the hold is active;
 * releasing the hold lifts that preservation requirement.
 *
 * Mirrors the `settlementsApi` / `consultationsApi` conventions (axios
 * `apiGet/apiPost` against the gateway baseURL, the `{data}` / `{data, meta}`
 * envelope helpers in `@/lib/suite-api`). It lives in this dedicated module
 * because the shared `enterprise/api.ts` is integrator-owned.
 *
 * Endpoints (backend mounts at /api/v1/lex — handler/routes.go:774-778):
 *   POST   /legal-holds                 apply    (lex:write)  → 201 { data }
 *   GET    /legal-holds                 list     (lex:read)   → { data, meta }
 *   GET    /legal-holds/{id}            get      (lex:read)   → { data }
 *   POST   /legal-holds/{id}/release    release  (lex:write)  → { data }
 *
 * The release body (`{ release_note }`) is optional — the backend decodes it
 * only when a non-empty body is sent (legal_hold_handler.go:73), so
 * `release({})` is valid.
 */

import { apiPost } from '@/lib/api';
import { fetchSuiteData, fetchSuitePaginated } from '@/lib/suite-api';
import type { PaginatedResponse } from '@/types/api';
import type { FetchParams } from '@/types/table';

const LEGAL_HOLDS_ROOT = '/api/v1/lex/legal-holds';

// ---------------------------------------------------------------------------
// Enums (raw backend tokens — model/legal_hold.go)
// ---------------------------------------------------------------------------

/** The four kinds of legal resource a hold can preserve. */
export const LEGAL_HOLD_SUBJECT_TYPE_VALUES = [
  'contract',
  'matter',
  'document',
  'consultation',
] as const;
export type LegalHoldSubjectType = (typeof LEGAL_HOLD_SUBJECT_TYPE_VALUES)[number];

/** Lifecycle state of a hold. */
export const LEGAL_HOLD_STATUS_VALUES = ['active', 'released'] as const;
export type LegalHoldStatus = (typeof LEGAL_HOLD_STATUS_VALUES)[number];

// ---------------------------------------------------------------------------
// Response type (mirrors model.LegalHold JSON)
// ---------------------------------------------------------------------------

export interface LegalHold {
  id: string;
  tenant_id: string;
  subject_type: LegalHoldSubjectType;
  subject_id: string;
  reason: string;
  reference: string;
  status: LegalHoldStatus;
  custodian: string;
  notes: string;
  applied_by: string;
  applied_at: string;
  released_by?: string | null;
  released_at?: string | null;
  release_note: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Request payloads (mirror backend DTOs — dto/legal_hold_dto.go)
// ---------------------------------------------------------------------------

/**
 * Place a new active hold. `reason` is mandatory (a hold is an auditable
 * preservation action); `reference` captures the case/court/matter identifier.
 */
export interface ApplyLegalHoldPayload {
  subject_type: LegalHoldSubjectType;
  subject_id: string;
  reason: string;
  reference?: string;
  custodian?: string;
  notes?: string;
  metadata?: Record<string, unknown>;
}

/** Lift an active hold. The release note documents why preservation ended. */
export interface ReleaseLegalHoldPayload {
  release_note?: string;
}

/** Optional server-side filters for the listing (all tenant-scoped). */
export interface ListLegalHoldsParams {
  subject_type?: LegalHoldSubjectType;
  subject_id?: string;
  status?: LegalHoldStatus;
  reference?: string;
}

// ---------------------------------------------------------------------------
// API surface
// ---------------------------------------------------------------------------

export const legalHoldsApi = {
  /**
   * Tenant-scoped, filtered, paginated set of holds. Filters (`subject_type`,
   * `subject_id`, `status`, `reference`) travel through `FetchParams.filters`
   * and map 1:1 to the backend query params.
   */
  list: (params: FetchParams): Promise<PaginatedResponse<LegalHold>> =>
    fetchSuitePaginated<LegalHold>(LEGAL_HOLDS_ROOT, params),

  /** A single hold by id. */
  get: (id: string): Promise<LegalHold> =>
    fetchSuiteData<LegalHold>(`${LEGAL_HOLDS_ROOT}/${id}`),

  /** Place a new active hold on a contract, matter, document, or consultation. */
  apply: (payload: ApplyLegalHoldPayload): Promise<LegalHold> =>
    apiPost<{ data: LegalHold }>(LEGAL_HOLDS_ROOT, payload).then((res) => res.data),

  /**
   * Release an active hold. The body is optional; an empty `{}` releases the
   * hold without a note.
   */
  release: (id: string, payload: ReleaseLegalHoldPayload = {}): Promise<LegalHold> =>
    apiPost<{ data: LegalHold }>(`${LEGAL_HOLDS_ROOT}/${id}/release`, payload).then(
      (res) => res.data,
    ),
};
