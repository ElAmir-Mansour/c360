// Breached-password check (capability #14) — k-anonymity via a BFF proxy.
//
// The plaintext password NEVER leaves the browser. We SHA-1 the password
// locally with the Web Crypto API, send only the first 5 hex chars of the
// digest (the "prefix") to our own BFF endpoint, and match the remaining
// 35-char "suffix" against the returned range entirely client-side. This is
// the k-anonymity model popularized by Have I Been Pwned's range API.
//
// SOVEREIGNTY: the browser only ever talks to OUR origin (`/api/auth/breach-check`).
// The BFF decides whether to proxy to an external range service or refuse —
// the external service is never contacted directly from the client. In a
// sovereign deployment with no upstream configured, the BFF returns 501 and
// this helper degrades gracefully to `{ unavailable: true }`.

export interface BreachedResult {
  breached: boolean;
  count: number;
}

export interface BreachUnavailable {
  unavailable: true;
}

export type BreachCheckResult = BreachedResult | BreachUnavailable;

/** Type guard: did the check complete (vs. degrade to unavailable)? */
export function isBreachResolved(
  result: BreachCheckResult,
): result is BreachedResult {
  return !('unavailable' in result);
}

const BREACH_CHECK_ENDPOINT = '/api/auth/breach-check';

/**
 * Compute the uppercase hex SHA-1 of a UTF-8 string using Web Crypto.
 * Returns null if the subtle crypto API is unavailable (e.g. insecure
 * context), so callers can degrade gracefully rather than throw.
 */
async function sha1Hex(input: string): Promise<string | null> {
  const subtle =
    typeof globalThis !== 'undefined' &&
    globalThis.crypto &&
    'subtle' in globalThis.crypto
      ? globalThis.crypto.subtle
      : undefined;
  if (!subtle) return null;

  try {
    const data = new TextEncoder().encode(input);
    const digest = await subtle.digest('SHA-1', data);
    const bytes = new Uint8Array(digest);
    let hex = '';
    for (let i = 0; i < bytes.length; i += 1) {
      hex += bytes[i].toString(16).padStart(2, '0');
    }
    return hex.toUpperCase();
  } catch {
    return null;
  }
}

/**
 * Parse a range-API response body into a map of suffix -> count.
 *
 * Expected format (one entry per line, as produced by pwnedpasswords-style
 * range APIs): `SUFFIX:COUNT`, where SUFFIX is the 35 uppercase hex chars
 * following the 5-char prefix. Whitespace and casing are normalized so the
 * caller's uppercase suffix matches regardless of upstream formatting.
 */
function parseRangeBody(body: string): Map<string, number> {
  const map = new Map<string, number>();
  for (const rawLine of body.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const sep = line.indexOf(':');
    if (sep === -1) continue;
    const suffix = line.slice(0, sep).trim().toUpperCase();
    if (!suffix) continue;
    const count = Number.parseInt(line.slice(sep + 1).trim(), 10);
    map.set(suffix, Number.isFinite(count) ? count : 0);
  }
  return map;
}

/**
 * Check whether a password appears in a known-breach corpus using
 * k-anonymity. The plaintext is hashed locally; only a 5-char prefix is sent
 * to the BFF. Any failure (missing crypto, network error, BFF not configured,
 * malformed response) returns `{ unavailable: true }` so the UI can treat the
 * check as advisory and never block the user on infrastructure gaps.
 */
export async function checkBreachedPassword(
  password: string,
): Promise<BreachCheckResult> {
  if (!password) {
    // Empty input can't be "breached"; nothing to hash.
    return { breached: false, count: 0 };
  }

  const hash = await sha1Hex(password);
  if (!hash || hash.length !== 40) {
    return { unavailable: true };
  }

  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);

  let response: Response;
  try {
    response = await fetch(
      `${BREACH_CHECK_ENDPOINT}?prefix=${encodeURIComponent(prefix)}`,
      {
        method: 'GET',
        // Same-origin BFF call; no credentials needed and none leaked.
        headers: { Accept: 'text/plain' },
      },
    );
  } catch {
    return { unavailable: true };
  }

  if (!response.ok) {
    // 501 (no upstream configured), 502/503/etc. — degrade gracefully.
    return { unavailable: true };
  }

  let body: string;
  try {
    body = await response.text();
  } catch {
    return { unavailable: true };
  }

  const ranges = parseRangeBody(body);
  const count = ranges.get(suffix);

  if (count === undefined) {
    return { breached: false, count: 0 };
  }
  return { breached: count > 0, count };
}
