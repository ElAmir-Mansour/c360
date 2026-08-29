/**
 * Typed HTTP surface for the Lex (Watheeq) persona endpoints:
 *
 *   GET  /api/v1/lex/me         → effective persona context (active role,
 *                                 available roles, granular effective permissions,
 *                                 capabilities, persona landing, access state).
 *   POST /api/v1/lex/persona    → switch the active persona; returns a refreshed
 *                                 `/me` payload (403 PERSONA_NOT_AVAILABLE if the
 *                                 requested role is not held).
 *
 * Both responses use the standard suite `{ data }` envelope; we reuse the shared
 * `fetchSuiteData` unwrap + `apiPost` (which unwraps `{ data }` for mutations)
 * so the persona layer rides the exact same authenticated axios pipeline (Bearer
 * token, CSRF, 401 refresh) as every other lex client.
 */

import { apiPost } from '@/lib/api';
import { fetchSuiteData } from '@/lib/suite-api';
import type { LexMeResponse, LexPersonaSwitchRequest } from './types';

const ME_ENDPOINT = '/api/v1/lex/me';
const PERSONA_ENDPOINT = '/api/v1/lex/persona';

/** Fetch the caller's effective Lex persona context. Unwraps the `{ data }` envelope. */
export async function fetchLexMe(): Promise<LexMeResponse> {
  return fetchSuiteData<LexMeResponse>(ME_ENDPOINT);
}

/**
 * Switch the active legal persona, returning the refreshed `/me` context.
 *
 * `apiPost` resolves to `response.data` (the axios body), which is the suite
 * `{ data }` envelope; unwrap one more level to the `LexMeResponse`.
 */
export async function switchLexPersona(roleSlug: string): Promise<LexMeResponse> {
  const body: LexPersonaSwitchRequest = { role_slug: roleSlug };
  const envelope = await apiPost<{ data: LexMeResponse }>(PERSONA_ENDPOINT, body);
  return envelope.data;
}
