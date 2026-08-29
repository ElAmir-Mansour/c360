import { NextRequest, NextResponse } from 'next/server';
import { COOKIES, SESSION } from '@/lib/constants';
import { isBFFOriginAllowed, bffCSRFRejection } from '@/lib/bff-csrf';
import { gatewayBaseUrl } from '@/lib/bff-proxy';
import { exchangeRefreshToken } from '@/lib/bff-refresh';

const cookieSecure = SESSION.COOKIE_SECURE;
const accessMaxAge = SESSION.ACCESS_TOKEN_MAX_AGE;
const refreshMaxAge = SESSION.REFRESH_TOKEN_MAX_AGE;

// (#8) `maxAge: undefined` yields a session cookie (ends when the browser
// closes) — the non-"remember me" mode. A number persists the cookie.
function cookieOptions(maxAge: number | undefined, path: string) {
  return {
    httpOnly: true,
    secure: cookieSecure,
    sameSite: SESSION.COOKIE_SAMESITE,
    domain: SESSION.COOKIE_DOMAIN,
    path,
    ...(maxAge !== undefined ? { maxAge } : {}),
  } as const;
}

function decodeJWTPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + (4 - (base64.length % 4)) % 4, '=');
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
}

// POST /api/auth/session
// Body: { access_token, refresh_token, remember? }
// Sets httpOnly cookies for both tokens. (#8) When `remember` is falsy the
// cookies are session-scoped (no max-age) so closing the browser ends the
// session; when true they persist for the configured max-ages. The choice is
// recorded in a marker cookie so refresh flows keep honoring it.
export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isBFFOriginAllowed(req)) return bffCSRFRejection();
  try {
    const body = (await req.json()) as {
      access_token?: string;
      refresh_token?: string;
      remember?: boolean;
    };

    if (!body.access_token || !body.refresh_token) {
      return NextResponse.json(
        { error: 'access_token and refresh_token are required' },
        { status: 400 },
      );
    }

    const remember = body.remember === true;
    const response = NextResponse.json({ success: true });

    response.cookies.set(
      COOKIES.ACCESS,
      body.access_token,
      cookieOptions(remember ? accessMaxAge : undefined, '/'),
    );

    // Restrict refresh cookie path to /api/auth/* to limit exposure
    response.cookies.set(
      COOKIES.REFRESH,
      body.refresh_token,
      cookieOptions(remember ? refreshMaxAge : undefined, '/api/auth'),
    );

    if (remember) {
      response.cookies.set(
        COOKIES.REMEMBER,
        '1',
        cookieOptions(refreshMaxAge, '/api/auth'),
      );
    } else {
      // Clear any stale marker from a previous remembered session.
      response.cookies.set(COOKIES.REMEMBER, '', {
        maxAge: 0,
        domain: SESSION.COOKIE_DOMAIN,
        path: '/api/auth',
      });
    }

    return response;
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
}

// GET /api/auth/session
// Reads the access cookie and returns decoded session info + a fresh access_token
// for the in-memory store to use. Also attempts to refresh if expired.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const accessCookie = req.cookies.get(COOKIES.ACCESS);

  if (!accessCookie?.value) {
    return NextResponse.json({ error: 'no session' }, { status: 401 });
  }

  const payload = decodeJWTPayload(accessCookie.value);
  if (!payload) {
    return NextResponse.json({ error: 'invalid token' }, { status: 401 });
  }

  const exp = typeof payload['exp'] === 'number' ? payload['exp'] : 0;
  const nowPlusBuffer = Math.floor(Date.now() / 1000) + 30;

  // If token is still valid (not within 30s of expiry), return it directly
  if (exp > nowPlusBuffer) {
    const apiUrl = gatewayBaseUrl();
    // Fetch full user + tenant from backend
    let user = null;
    let tenant = null;
    try {
      const meResp = await fetch(`${apiUrl}/api/v1/users/me`, {
        headers: {
          Authorization: `Bearer ${accessCookie.value}`,
          'Content-Type': 'application/json',
        },
      });
      if (meResp.ok) {
        const meData = (await meResp.json()) as { user?: unknown; data?: unknown };
        user = meData.user ?? meData.data ?? meData;
      }
    } catch {
      // Non-fatal: return basic info from token
    }

    return NextResponse.json({
      user: user ?? {
        id: payload['sub'],
        email: payload['email'],
        tenant_id: payload['tenant_id'],
        first_name: '',
        last_name: '',
        ...(typeof payload['full_name'] === 'string'
          ? { full_name: payload['full_name'] }
          : {}),
        roles: payload['roles'] ?? [],
        permissions: payload['permissions'] ?? [],
      },
      tenant,
      access_token: accessCookie.value,
      expires_at: new Date(exp * 1000).toISOString(),
    });
  }

  // Token expired — attempt refresh using the refresh cookie
  const refreshCookie = req.cookies.get(COOKIES.REFRESH);
  if (!refreshCookie?.value) {
    return NextResponse.json({ error: 'session expired' }, { status: 401 });
  }

  try {
    // Same per-token single-flight as /api/auth/refresh (lib/bff-refresh):
    // this GET also rotates the single-use cookie, so it must never race the
    // refresh route or middleware into backend reuse detection. Also fixes the
    // old env drift — this path previously read NEXT_PUBLIC_API_URL directly
    // while the refresh route used GATEWAY_INTERNAL_URL.
    const result = await exchangeRefreshToken(refreshCookie.value);

    if (result.kind === 'unavailable') {
      // Mirror /api/auth/refresh: only a definitive backend rejection may
      // destroy the session cookies. An upstream 5xx / rate limit is reported
      // as 503 with the cookies left intact so the session survives the blip.
      return NextResponse.json(
        { error: 'session refresh unavailable' },
        { status: 503 },
      );
    }

    if (result.kind === 'rejected') {
      const response = NextResponse.json({ error: 'session expired' }, { status: 401 });
      response.cookies.set(COOKIES.ACCESS, '', { maxAge: 0, domain: SESSION.COOKIE_DOMAIN, path: '/' });
      response.cookies.set(COOKIES.REFRESH, '', { maxAge: 0, domain: SESSION.COOKIE_DOMAIN, path: '/api/auth' });
      response.cookies.set(COOKIES.REMEMBER, '', { maxAge: 0, domain: SESSION.COOKIE_DOMAIN, path: '/api/auth' });
      return response;
    }

    const tokens = {
      access_token: result.accessToken,
      refresh_token: result.refreshToken,
    };

    // Fetch user with new token
    let user = null;
    try {
      const meResp = await fetch(`${gatewayBaseUrl()}/api/v1/users/me`, {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      if (meResp.ok) {
        const meData = (await meResp.json()) as { user?: unknown; data?: unknown };
        user = meData.user ?? meData.data ?? meData;
      }
    } catch {
      // Non-fatal
    }

    const newPayload = decodeJWTPayload(tokens.access_token);
    const newExp =
      newPayload && typeof newPayload['exp'] === 'number' ? newPayload['exp'] : 0;

    const response = NextResponse.json({
      user,
      tenant: null,
      access_token: tokens.access_token,
      expires_at: new Date(newExp * 1000).toISOString(),
    });

    // (#8) Preserve the original "keep me signed in" choice across refreshes:
    // only remembered sessions get persistent (max-age) cookies.
    const remembered = req.cookies.get(COOKIES.REMEMBER)?.value === '1';
    response.cookies.set(
      COOKIES.ACCESS,
      tokens.access_token,
      cookieOptions(remembered ? accessMaxAge : undefined, '/'),
    );
    response.cookies.set(
      COOKIES.REFRESH,
      tokens.refresh_token,
      cookieOptions(remembered ? refreshMaxAge : undefined, '/api/auth'),
    );

    return response;
  } catch {
    // Network failure reaching the gateway — transient, not a dead session.
    return NextResponse.json(
      { error: 'session refresh unavailable' },
      { status: 503 },
    );
  }
}

// DELETE /api/auth/session — clear cookies (logout)
export async function DELETE(req: NextRequest): Promise<NextResponse> {
  if (!isBFFOriginAllowed(req)) return bffCSRFRejection();
  const response = NextResponse.json({ success: true });
  response.cookies.set(COOKIES.ACCESS, '', { maxAge: 0, domain: SESSION.COOKIE_DOMAIN, path: '/' });
  response.cookies.set(COOKIES.REFRESH, '', { maxAge: 0, domain: SESSION.COOKIE_DOMAIN, path: '/api/auth' });
  response.cookies.set(COOKIES.REMEMBER, '', { maxAge: 0, domain: SESSION.COOKIE_DOMAIN, path: '/api/auth' });
  return response;
}
