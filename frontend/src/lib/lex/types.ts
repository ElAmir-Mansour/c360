/**
 * Wire + UX types for the Lex (Watheeq) persona context (`GET /api/v1/lex/me`,
 * `POST /api/v1/lex/persona`).
 *
 * Source of truth: docs/ClarioWatheeq/Lex_Codebase_RBAC_Map.md §4 (Effective Lex
 * Session Contract) and the Wave-1 backend contract — the `/lex/me` endpoint
 * returns these inside the standard suite `{ data }` envelope.
 *
 * These mirror the backend DTOs; the frontend persona UX (role badge, persona
 * switcher, capabilities sheet, persona-aware landing/home) reads exclusively
 * from this shape. Backend authorization remains the security boundary; this is
 * a usability layer only.
 */

/** Tier of a legal persona — controls the business/legal/oversight/admin split. */
export type LegalRoleTier = 'Business' | 'Legal' | 'Oversight' | 'Admin';

/** Escalation ladder level (§4 LegalRoleSummary). */
export type LegalEscalationLevel = 0 | 1 | 2 | 3;

/**
 * Whether the user has a usable Lex persona. `NO_LEX_ROLE_ASSIGNED` means the
 * user authenticated but holds no `legal-*` role — the Lex suite landing should
 * stay generic and persona chrome should not render.
 */
export type LexAccessState = 'READY' | 'NO_LEX_ROLE_ASSIGNED';

/** Compact metadata for one legal role the user holds (§4 LegalRoleSummary). */
export interface LegalRoleSummary {
  slug: string;
  name_en: string;
  name_ar: string;
  tier: LegalRoleTier;
  org_unit: string | null;
  escalation_level: LegalEscalationLevel;
}

/**
 * Boolean capability map (§4). The backend returns an open map of capability
 * keys → boolean; we model it permissively so additive backend keys never break
 * the type. Known keys from §4 are documented for editor help.
 */
export type LexCapabilities = Record<string, boolean> & {
  can_request?: boolean;
  can_handle_cases?: boolean;
  can_handle_contracts?: boolean;
  can_approve_requests?: boolean;
  can_approve_cases?: boolean;
  can_approve_contracts?: boolean;
  can_close_matters?: boolean;
  can_assign_cases?: boolean;
  can_distribute_contracts?: boolean;
  can_audit?: boolean;
  can_manage_configuration?: boolean;
  can_manage_roles?: boolean;
  can_manage_integrations?: boolean;
};

/**
 * Raw `GET /api/v1/lex/me` payload (the value INSIDE the `{ data }` envelope).
 *
 * `effective_permissions` are the active role's backend-expanded keys (granular
 * `lex:<domain>:<verb>` plus cross-cutting grants such as `workflow:read` for
 * Watheeq task participation). They are NOT sourced from the JWT. These are the
 * keys that must be merged into the auth store so the sidebar and page/action
 * gates evaluate true at runtime.
 */
export interface LexMeResponse {
  tenant_id?: string;
  user_id?: string;

  active_legal_role: LegalRoleSummary | null;
  available_legal_roles: LegalRoleSummary[];

  effective_permissions: string[];
  permission_version: string;

  persona_landing: string;
  capabilities: LexCapabilities;

  access_state: LexAccessState;
}

/** POST body for switching the active persona (§17.3). */
export interface LexPersonaSwitchRequest {
  role_slug: string;
}
