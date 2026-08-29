// Server-side single-flight for the gateway refresh-token exchange.
//
// The backend rotates refresh tokens SINGLE-USE and treats a replayed token as
// theft (revokes every session for the user). The browser-side Web Lock in
// lib/session-refresh serializes rotations initiated by CLIENT code, but three
// rotation paths cannot take a browser lock:
//   - Next.js middleware's per-navigation silent refresh (middleware.ts),
//   - concurrent middleware invocations (parallel RSC/document requests),
//   - tabs still running a pre-lock bundle during a deploy window.
// All of them, plus every client call, funnel through THIS process's BFF
// routes — so a per-token single-flight here makes concurrent rotations of the
// same token idempotent regardless of who initiated them: the first caller
// performs the exchange, every concurrent caller awaits the same result, and a
// near-miss straggler (≤5s) gets the cached pair instead of replaying a
// consumed token into reuse detection.
//
// Scope: in-process. The deployment runs one Next.js server per origin (pm2
// fork mode); a multi-instance deployment would need a shared store instead.

import { createHash } from 'crypto';
import { gatewayBaseUrl } from '@/lib/bff-proxy';

export type UpstreamRefreshResult =
  | { kind: 'ok'; accessToken: string; refreshToken: string }
  /** The gateway/IAM definitively rejected the token — the session is over. */
  | { kind: 'rejected' }
  /** Proves nothing about the session: 5xx, rate limit, network, timeout —
   *  and 404, which infrastructure can synthesize (stale gateway binary,
   *  wrong GATEWAY_INTERNAL_URL); a genuinely deleted user's next attempt
   *  fails 401 and terminates then. */
  | { kind: 'unavailable' };

const DEFINITIVE_REJECTION_STATUSES = new Set([400, 401, 403]);

// Bound the upstream call so a hung gateway connection cannot pin every
// concurrent caller (client tabs queue behind the browser lock, middleware
// awaits this promise) for the platform socket timeout.
const UPSTREAM_TIMEOUT_MS = 15_000;

// Successful exchanges are remembered briefly so a straggler replaying the
// just-consumed token (e.g. a middleware request that raced the winner) gets
// the same new pair instead of tripping backend reuse detection.
const RECENT_OK_TTL_MS = 5_000;

const inflight = new Map<string, Promise<UpstreamRefreshResult>>();
const recentOk = new Map<string, { at: number; result: UpstreamRefreshResult }>();

function keyFor(token: string): string {
  // Hash so raw token material never sits in a long-lived structure.
  return createHash('sha256').update(token).digest('hex');
}

function pruneRecent(now: number): void {
  for (const [k, v] of recentOk) {
    if (now - v.at > RECENT_OK_TTL_MS) recentOk.delete(k);
  }
}

/**
 * Exchange a refresh token at the gateway, deduping concurrent and
 * immediately-repeated exchanges of the SAME token. Never throws.
 */
export function exchangeRefreshToken(
  refreshToken: string,
): Promise<UpstreamRefreshResult> {
  const key = keyFor(refreshToken);
  const now = Date.now();
  pruneRecent(now);

  const cached = recentOk.get(key);
  if (cached) return Promise.resolve(cached.result);

  const existing = inflight.get(key);
  if (existing) return existing;

  const run = (async (): Promise<UpstreamRefreshResult> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    try {
      const resp = await fetch(`${gatewayBaseUrl()}/api/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
        signal: controller.signal,
        cache: 'no-store',
      });

      if (!resp.ok) {
        return DEFINITIVE_REJECTION_STATUSES.has(resp.status)
          ? { kind: 'rejected' }
          : { kind: 'unavailable' };
      }

      const tokens = (await resp.json()) as {
        access_token?: string;
        refresh_token?: string;
      };
      if (!tokens.access_token || !tokens.refresh_token) {
        return { kind: 'unavailable' };
      }

      const result: UpstreamRefreshResult = {
        kind: 'ok',
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
      };
      recentOk.set(key, { at: Date.now(), result });
      return result;
    } catch {
      // Network failure / timeout — transient by definition.
      return { kind: 'unavailable' };
    } finally {
      clearTimeout(timer);
    }
  })();

  inflight.set(key, run);
  void run.finally(() => {
    inflight.delete(key);
  });
  return run;
}
