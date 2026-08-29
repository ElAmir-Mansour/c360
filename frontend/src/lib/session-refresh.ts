// Single, serialized entry point for renewing the access token.
//
// The backend rotates refresh tokens SINGLE-USE and treats a replayed token as
// theft: `AuthService.RefreshToken` revokes every session for the user on reuse.
// That makes concurrent refreshes fatal, not merely wasteful — two in-flight
// calls mean the loser replays an already-rotated token and the whole user is
// logged out of every tab.
//
// Historically four call sites refreshed independently (the auth watchdog, the
// axios 401 interceptor, the session-expiry dialog's "Extend" button, and the
// BFF `GET /api/auth/session` route), each with its own private in-flight flag.
// Any two overlapping tripped reuse detection. Everything now funnels through
// here: `refreshAccessToken()` dedupes, and `serializeSessionOp()` chains any
// other cookie-rotating call behind it so refreshes are strictly sequential.
//
// Serialization happens at THREE levels:
//   1. In-tab: a promise chain (`chain`) keeps this tab's rotations sequential.
//   2. Cross-tab: a Web Lock (`navigator.locks`) keeps rotations sequential
//      across every open tab. The refresh cookie is shared browser-wide, so two
//      tabs' watchdogs entering the renewal window together would otherwise
//      race the same single-use token — the loser trips reuse detection and
//      the whole user is revoked. With the lock, the second tab's rotation
//      simply uses the fresh cookie the first tab just wrote (a harmless extra
//      rotation, never a replay). Browsers without Web Locks fall back to
//      in-tab serialization only.
//   3. Server-side: rotations the browser lock CANNOT cover — Next.js
//      middleware's silent refresh, parallel RSC requests, tabs on an older
//      bundle during a deploy — are deduped per-token by lib/bff-refresh's
//      single-flight inside the BFF process, which every rotation path
//      ultimately goes through.

import { getAccessToken, setAccessToken } from '@/lib/auth';
import { API_ENDPOINTS } from '@/lib/constants';

const CROSS_TAB_LOCK = 'clario360:session-rotation';

function withCrossTabLock<T>(op: () => Promise<T>): Promise<T> {
  if (
    typeof navigator !== 'undefined' &&
    'locks' in navigator &&
    typeof navigator.locks?.request === 'function'
  ) {
    return navigator.locks.request(CROSS_TAB_LOCK, op) as Promise<T>;
  }
  return op();
}

// Every operation that may rotate the refresh cookie runs on this chain, so two
// callers never hold the same refresh token at once. Sequential rotation is
// safe (the second call reads the cookie the first one just wrote); concurrent
// rotation is not. Ops must not call serializeSessionOp themselves — the
// cross-tab lock is not reentrant.
let chain: Promise<unknown> = Promise.resolve();

export function serializeSessionOp<T>(op: () => Promise<T>): Promise<T> {
  const locked = () => withCrossTabLock(op);
  // `.then(locked, locked)` so a rejected predecessor still lets the next op run.
  const run = chain.then(locked, locked);
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * Outcome of a refresh attempt. The distinction matters:
 *  - `ok`        → new token in hand.
 *  - `terminal`  → the backend definitively rejected the session (refresh
 *                  cookie missing/expired/revoked). Only this outcome may log
 *                  the user out.
 *  - `transient` → the attempt didn't succeed but proved nothing about the
 *                  session (network blip, gateway 5xx, rate limit). Callers
 *                  must NOT expire the session — retry on a later tick.
 */
export type RefreshResult =
  | { status: 'ok'; token: string }
  | { status: 'terminal' }
  | { status: 'transient' };

let inFlight: Promise<RefreshResult> | null = null;
let lastSuccessAt = 0;

// A token minted moments ago is still good. Without this, a burst of 401s from
// parallel page requests would each queue a rotation behind the last.
const REFRESH_COOLDOWN_MS = 15_000;

// Bound the refresh round trip. The fetch runs while HOLDING the cross-tab
// lock — an unbounded hang would stall refresh AND hydration in every open
// tab for the platform's socket timeout (minutes), not just this one.
const REFRESH_TIMEOUT_MS = 15_000;

/**
 * Renew the access token via the BFF refresh route.
 *
 * Returns a {@link RefreshResult}; this function never redirects or clears
 * state on its own. Only a `terminal` result means the session is over —
 * `transient` covers everything that deserves a retry, and treating it as
 * terminal is exactly the bug that logged users out of every tab on a
 * momentary gateway blip.
 *
 * Concurrent callers share one in-flight request; a caller arriving within
 * `REFRESH_COOLDOWN_MS` of a success gets the current token without a round
 * trip. Pass `force` to bypass the cooldown (e.g. a 401 on a token we thought
 * was fresh).
 */
export function refreshAccessToken(force = false): Promise<RefreshResult> {
  if (inFlight) return inFlight;

  const current = getAccessToken();
  if (!force && current && Date.now() - lastSuccessAt < REFRESH_COOLDOWN_MS) {
    return Promise.resolve({ status: 'ok', token: current });
  }

  inFlight = serializeSessionOp(async (): Promise<RefreshResult> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REFRESH_TIMEOUT_MS);
    try {
      const resp = await fetch(API_ENDPOINTS.BFF_REFRESH, {
        method: 'POST',
        credentials: 'include',
        signal: controller.signal,
      });
      if (resp.status === 401) {
        // The BFF returns 401 only when the refresh cookie is absent or the
        // backend definitively rejected it (and it cleared the cookies).
        return { status: 'terminal' };
      }
      if (resp.status === 403) {
        // The BFF's own origin/CSRF check rejected us — a deployment
        // misconfiguration (origin allowlist / proxy headers), not a dead
        // session. Deliberately NOT terminal (auto-logout on misconfig would
        // be worse), but loud: this never self-heals by retrying.
        console.error(
          '[session-refresh] BFF rejected refresh with 403 — origin/CSRF ' +
            'misconfiguration; the session cannot renew until deployment ' +
            'config is fixed',
        );
        return { status: 'transient' };
      }
      if (!resp.ok) {
        // 503 upstream-unavailable and anything else transient — says
        // nothing about the session itself.
        return { status: 'transient' };
      }
      const data = (await resp.json()) as { access_token?: string };
      if (!data.access_token) return { status: 'transient' };
      setAccessToken(data.access_token);
      lastSuccessAt = Date.now();
      return { status: 'ok', token: data.access_token };
    } catch {
      // Network blip / timeout abort — not a dead session. Callers retry on
      // the next tick.
      return { status: 'transient' };
    } finally {
      clearTimeout(timer);
    }
  })
    .catch((): RefreshResult => {
      // The op itself never throws, but navigator.locks.request can reject
      // (e.g. InvalidStateError while the document is being torn down /
      // entering bfcache). That proves nothing about the session.
      return { status: 'transient' };
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}
