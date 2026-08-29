/**
 * Unwraps the suiteapi response envelope used by every `/api/recover/*` endpoint.
 *
 * The backend wraps single resources as `{ data: <payload> }` and paginated
 * lists as `{ data: [...], meta: {...} }`. The shared `apiGet`/`apiPost` helpers
 * return the RAW HTTP body — the global axios response interceptor is an identity
 * function and does NOT strip this envelope (unlike the suite `/api/v1/*` APIs,
 * which return their payload directly). Recover fetchers must therefore unwrap
 * here, or consumers read `.sub_solutions`/`.items` off the envelope wrapper and
 * crash (`Cannot read properties of undefined`).
 *
 * Tolerant by design: a value that is NOT a data-enveloped object — a bare array
 * or primitive, an already-unwrapped domain object (e.g. a unit-test mock), or an
 * object carrying sibling keys beyond `data`/`meta` — is returned unchanged. This
 * makes the helper safe to apply unconditionally and keeps existing tests that
 * mock the already-unwrapped shape valid.
 */
export function unwrapRecoverEnvelope<T>(raw: unknown): T {
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw) && 'data' in raw) {
    // Only a pure `{ data }` or `{ data, meta }` shape is the suiteapi envelope.
    // Any other sibling key means this is a real payload that happens to own a
    // `data` field — leave it intact.
    const extraKeys = Object.keys(raw).filter((k) => k !== 'data' && k !== 'meta');
    if (extraKeys.length === 0) {
      return (raw as { data: T }).data;
    }
  }
  return raw as T;
}
