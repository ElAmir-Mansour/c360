/**
 * middleware-utils — origin derivation for Edge middleware behind a proxy.
 *
 * Behind nginx the Next.js server is reached on an internal loopback address
 * (`127.0.0.1:3010`), so `req.url` / `req.nextUrl.origin` resolve to that
 * internal host rather than the public origin the browser actually used. Any
 * absolute redirect built from `req.url` therefore leaks the internal host into
 * the `Location` header (e.g. `https://localhost:3010/login?...`).
 *
 * `getPublicOrigin` reconstructs the public-facing origin from the standard
 * reverse-proxy forwarding headers so absolute redirects keep the browser on the
 * origin it came in on:
 *
 *   1. `X-Forwarded-Host` + `X-Forwarded-Proto`  (proxy-aware, preferred)
 *   2. `Host` + `X-Forwarded-Proto`/`req` protocol (direct or partial proxy)
 *   3. `NEXT_PUBLIC_APP_URL`                       (configured fallback)
 *   4. `req.nextUrl.origin`                        (last resort, internal host)
 *
 * `redirectToPublic` builds a same-origin redirect URL against the public
 * origin, preserving the request pathname when the caller passes a relative
 * path. Callers that prefer the simplest, most robust option can pass a relative
 * path straight to `NextResponse.redirect` and let the browser resolve it; this
 * helper exists for the cases that genuinely need an absolute URL.
 */
import { NextRequest, NextResponse } from 'next/server';

/**
 * Pick the first forwarded value. `X-Forwarded-*` headers may carry a
 * comma-separated chain (`client, proxy1, proxy2`); the left-most entry is the
 * value the original client saw.
 */
function firstForwardedValue(headerValue: string | null): string | null {
  if (!headerValue) return null;
  const first = headerValue.split(',')[0]?.trim();
  return first && first.length > 0 ? first : null;
}

function normalizeProto(proto: string | null): string | null {
  if (!proto) return null;
  const value = proto.trim().toLowerCase();
  return value === 'http' || value === 'https' ? value : null;
}

/**
 * Derive the public-facing origin (e.g. `https://devops.ofpsplatform.com`) for a
 * request that may have arrived through a reverse proxy.
 */
export function getPublicOrigin(req: NextRequest): string {
  const forwardedHost = firstForwardedValue(req.headers.get('x-forwarded-host'));
  const forwardedProto = normalizeProto(
    firstForwardedValue(req.headers.get('x-forwarded-proto')),
  );

  // 1. Proxy-aware: X-Forwarded-Host (+ X-Forwarded-Proto).
  if (forwardedHost) {
    const proto = forwardedProto ?? req.nextUrl.protocol.replace(/:$/, '') ?? 'https';
    return `${proto}://${forwardedHost}`;
  }

  // 2. Host header (+ forwarded/request protocol).
  const host = req.headers.get('host');
  if (host) {
    const proto =
      forwardedProto ?? req.nextUrl.protocol.replace(/:$/, '') ?? 'https';
    return `${proto}://${host}`;
  }

  // 3. Configured public origin.
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      // ignore malformed config and fall through
    }
  }

  // 4. Last resort: whatever origin the request resolved to (internal host).
  return req.nextUrl.origin;
}

/**
 * Build a redirect response targeting the public origin.
 *
 * `target` may be a relative path (`/login?redirect=%2Fdashboard`) — it is
 * resolved against the derived public origin so the `Location` header never
 * leaks the internal loopback host.
 */
export function publicRedirect(req: NextRequest, target: string): NextResponse {
  const url = new URL(target, getPublicOrigin(req));
  return NextResponse.redirect(url);
}
