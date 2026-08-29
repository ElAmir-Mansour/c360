import { NextRequest, NextResponse } from 'next/server';
import { COOKIES } from '@/lib/constants';
import { addSecurityHeaders, buildCSPHeader } from '@/middleware/security';
import { publicRedirect } from '@/lib/middleware-utils';
import { safeRedirect } from '@/lib/safe-redirect';

function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function withSecurityHeaders(response: NextResponse, nonce?: string): NextResponse {
  addSecurityHeaders(response, nonce);
  return response;
}

function nextWithNonce(req: NextRequest, nonce: string): NextResponse {
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-nonce', nonce);
  // Next.js reads the request-side CSP header to discover the nonce
  // and applies it to its inline RSC/streaming bootstrap scripts.
  requestHeaders.set('Content-Security-Policy', buildCSPHeader(nonce));
  return NextResponse.next({ request: { headers: requestHeaders } });
}

// Routes that do NOT require authentication
const PUBLIC_PATH_PREFIXES = [
  '/login',
  '/register',
  '/verify',
  '/verify-email',
  '/invite',
  '/forgot-password',
  '/reset-password',
  '/api/',
  '/monaco/',
  '/_next/',
  '/favicon.ico',
  '/design-system',
  '/ui-gallery',
  '/trust',
  '/datastream',
  '/business-plus',
  '/clariosec',
  '/clarioinsight',
  '/solutions',
  '/sovereignty',
  '/resources',
  '/docs',
  '/compare',
  '/pricing',
  '/about',
  '/contact',
  '/respond/stakeholder',
];

// Top-level authenticated app surfaces. Unknown paths outside this set are
// allowed to fall through so the public site can render a real 404 instead of
// redirecting anonymous users to login for a typo like `/platfrom`.
const PROTECTED_PATH_PREFIXES = [
  '/acta',
  '/admin',
  '/console',
  '/cyber',
  '/dashboard',
  '/data',
  '/dr',
  '/files',
  '/lex',
  '/migrate',
  '/notebooks',
  '/notifications',
  '/respond',
  '/settings',
  '/setup',
  '/visus',
  '/workflows',
];

/**
 * Build the relative `/login?redirect=<path>` target for a protected route that
 * needs authentication. The post-login destination is passed through
 * `safeRedirect` so a hostile pathname can never become an open-redirect; for
 * genuine in-app paths this is an identity and the query is preserved verbatim.
 */
function buildLoginPath(pathname: string): string {
  const params = new URLSearchParams({ redirect: safeRedirect(pathname) });
  return `/login?${params.toString()}`;
}

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function decodeJWTExpiry(token: string): number | null {
  // Edge middleware: no Node.js crypto, base64 decode only (no sig verification)
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(
      base64.length + (4 - (base64.length % 4)) % 4,
      '=',
    );
    const decoded = atob(padded);
    const payload = JSON.parse(decoded) as Record<string, unknown>;
    return typeof payload['exp'] === 'number' ? payload['exp'] : null;
  } catch {
    return null;
  }
}

function isAccessCookieValid(req: NextRequest, bufferSeconds = 0): boolean {
  const accessCookie = req.cookies.get(COOKIES.ACCESS);
  if (!accessCookie?.value) return false;
  const exp = decodeJWTExpiry(accessCookie.value);
  return Boolean(exp && exp > Math.floor(Date.now() / 1000) + bufferSeconds);
}

async function refreshSessionForRequest(
  req: NextRequest,
  nonce: string,
): Promise<NextResponse | null> {
  const refreshCookie = req.cookies.get(COOKIES.REFRESH);
  if (!refreshCookie?.value) return null;

  try {
    const refreshUrl = new URL('/api/auth/refresh', req.url);
    // Explicit Origin header so the BFF CSRF check accepts this server-side
    // refresh attempt as same-origin.
    const sameOrigin = `${refreshUrl.protocol}//${refreshUrl.host}`;
    const refreshResp = await fetch(refreshUrl.toString(), {
      method: 'POST',
      headers: {
        cookie: `${COOKIES.REFRESH}=${refreshCookie.value}`,
        origin: sameOrigin,
      },
    });

    if (!refreshResp.ok) return null;

    const nextResp = nextWithNonce(req, nonce);
    const setCookieHeader = refreshResp.headers.get('set-cookie');
    if (setCookieHeader) {
      nextResp.headers.set('set-cookie', setCookieHeader);
    }
    return nextResp;
  } catch {
    return null;
  }
}

function copySetCookie(source: NextResponse, target: NextResponse): NextResponse {
  const setCookieHeader = source.headers.get('set-cookie');
  if (setCookieHeader) {
    target.headers.set('set-cookie', setCookieHeader);
  }
  return target;
}

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl;
  const nonce = generateNonce();

  /*
   * Public marketing vs. authenticated app boundary.
   *
   * These paths intentionally change behavior based on session state, so keep
   * all of that branching in this one block:
   *
   * - `/` is the public marketing home for anonymous visitors, but an active
   *   authenticated session redirects to `/dashboard`.
   * - `/platform/*` is public marketing for anonymous visitors, but active
   *   authenticated sessions are internally rewritten to `/console/platform/*`.
   *   The rewrite preserves the browser URL (`/platform/...`) so existing app
   *   links and bookmarks remain stable while public SEO pages can own the same
   *   visible URL for unauthenticated traffic.
   * - `/console/*` is NEVER public. It is the protected internal destination for
   *   the rewrite above and must fall through to the normal protected-route
   *   checks below when requested directly.
   *
   * Expired access cookies with a refresh cookie are treated as authenticated if
   * the BFF refresh succeeds. If refresh fails, `/` and `/platform/*` degrade to
   * public marketing instead of redirecting anonymous users to sign in.
   */
  const isMarketingHome = pathname === '/';
  const isSessionSplitPlatform =
    pathname === '/platform' || pathname.startsWith('/platform/');

  if (isMarketingHome || isSessionSplitPlatform) {
    let refreshedResponse: NextResponse | null = null;
    const hasValidSession =
      isAccessCookieValid(req) ||
      Boolean((refreshedResponse = await refreshSessionForRequest(req, nonce)));

    if (isMarketingHome) {
      if (hasValidSession) {
        // Redirect against the PUBLIC origin (X-Forwarded-Host) so we never leak
        // the internal loopback host (127.0.0.1:3010) into the Location header.
        const redirectResponse = publicRedirect(req, '/dashboard');
        return withSecurityHeaders(
          refreshedResponse
            ? copySetCookie(refreshedResponse, redirectResponse)
            : redirectResponse,
          nonce,
        );
      }

      return withSecurityHeaders(nextWithNonce(req, nonce), nonce);
    }

    if (hasValidSession) {
      const rewriteUrl = req.nextUrl.clone();
      rewriteUrl.pathname = `/console${pathname}`;
      // The Next standalone server listens on plain HTTP on the loopback. Behind a
      // TLS-terminating proxy, X-Forwarded-Proto makes req.nextUrl.protocol 'https',
      // so Next sub-fetches this internal rewrite over https://<loopback> and fails
      // with EPROTO ("wrong version number") against the HTTP listener — which 500s
      // every authenticated /platform/* admin-console route. Pin the rewrite to the
      // scheme the server actually speaks. The browser URL is unaffected (rewrite is
      // server-internal); in local/dev the server is already http, so this is a no-op.
      rewriteUrl.protocol = 'http:';
      const rewriteResponse = NextResponse.rewrite(rewriteUrl);
      return withSecurityHeaders(
        refreshedResponse ? copySetCookie(refreshedResponse, rewriteResponse) : rewriteResponse,
        nonce,
      );
    }

    return withSecurityHeaders(nextWithNonce(req, nonce), nonce);
  }

  // Always allow public paths
  if (isPublicPath(pathname)) {
    // If authenticated user visits /login → redirect to /dashboard
    if (pathname === '/login') {
      const accessCookie = req.cookies.get(COOKIES.ACCESS);
      if (accessCookie?.value) {
        const exp = decodeJWTExpiry(accessCookie.value);
        if (exp && exp > Math.floor(Date.now() / 1000)) {
          return withSecurityHeaders(publicRedirect(req, '/dashboard'), nonce);
        }
      }
    }
    return withSecurityHeaders(nextWithNonce(req, nonce), nonce);
  }

  if (!isProtectedPath(pathname)) {
    return withSecurityHeaders(nextWithNonce(req, nonce), nonce);
  }

  // Protected routes — require valid session
  if (!req.cookies.get(COOKIES.ACCESS)?.value) {
    return withSecurityHeaders(publicRedirect(req, buildLoginPath(pathname)), nonce);
  }

  // Token valid — proceed
  if (isAccessCookieValid(req, 30)) {
    return withSecurityHeaders(nextWithNonce(req, nonce), nonce);
  }

  // Token expired — attempt silent refresh via BFF
  const refreshedResponse = await refreshSessionForRequest(req, nonce);
  if (refreshedResponse) {
    return withSecurityHeaders(refreshedResponse, nonce);
  }

  return withSecurityHeaders(publicRedirect(req, buildLoginPath(pathname)), nonce);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/).*)'],
};
