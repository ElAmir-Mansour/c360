import { NextRequest, NextResponse } from 'next/server';
import { COOKIES, SESSION } from '@/lib/constants';
import { isBFFOriginAllowed, bffCSRFRejection } from '@/lib/bff-csrf';
import { exchangeRefreshToken } from '@/lib/bff-refresh';

// POST /api/auth/refresh
// Reads the httpOnly refresh cookie and exchanges it for new tokens.
// The frontend JS never sees the refresh token — cookie-to-cookie only.
//
// The exchange goes through lib/bff-refresh's per-token single-flight, so
// concurrent rotations of the same single-use token (client tabs, middleware's
// silent refresh, parallel RSC requests) collapse into one upstream call
// instead of tripping the backend's replay/reuse detection.
export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isBFFOriginAllowed(req)) return bffCSRFRejection();
  const refreshCookie = req.cookies.get(COOKIES.REFRESH);

  if (!refreshCookie?.value) {
    return NextResponse.json({ error: 'no refresh token' }, { status: 401 });
  }

  try {
    const result = await exchangeRefreshToken(refreshCookie.value);

    if (result.kind === 'unavailable') {
      // Gateway blip / rate limit / infra 404 — proves nothing about the
      // session. Clearing cookies here would turn a momentary upstream outage
      // into a forced logout of every tab, so the cookies survive.
      return NextResponse.json({ error: 'refresh unavailable' }, { status: 503 });
    }

    if (result.kind === 'rejected') {
      // Definitive rejection (token invalid/expired/revoked) — session over.
      const response = NextResponse.json({ error: 'refresh failed' }, { status: 401 });
      response.cookies.set(COOKIES.ACCESS, '', { maxAge: 0, domain: SESSION.COOKIE_DOMAIN, path: '/' });
      response.cookies.set(COOKIES.REFRESH, '', { maxAge: 0, domain: SESSION.COOKIE_DOMAIN, path: '/api/auth' });
      response.cookies.set(COOKIES.REMEMBER, '', { maxAge: 0, domain: SESSION.COOKIE_DOMAIN, path: '/api/auth' });
      return response;
    }

    const tokens = {
      access_token: result.accessToken,
      refresh_token: result.refreshToken,
    };

    const cookieSecure = SESSION.COOKIE_SECURE;
    const cookieSameSite = SESSION.COOKIE_SAMESITE;

    const response = NextResponse.json({ access_token: tokens.access_token });

    // (#8) Only "keep me signed in" sessions get persistent cookies; otherwise
    // the rotated cookies stay session-scoped, matching the original login.
    const remembered = req.cookies.get(COOKIES.REMEMBER)?.value === '1';

    response.cookies.set(COOKIES.ACCESS, tokens.access_token, {
      httpOnly: true,
      secure: cookieSecure,
      sameSite: cookieSameSite,
      domain: SESSION.COOKIE_DOMAIN,
      path: '/',
      ...(remembered ? { maxAge: SESSION.ACCESS_TOKEN_MAX_AGE } : {}),
    });

    response.cookies.set(COOKIES.REFRESH, tokens.refresh_token, {
      httpOnly: true,
      secure: cookieSecure,
      sameSite: cookieSameSite,
      domain: SESSION.COOKIE_DOMAIN,
      path: '/api/auth',
      ...(remembered ? { maxAge: SESSION.REFRESH_TOKEN_MAX_AGE } : {}),
    });

    return response;
  } catch {
    // exchangeRefreshToken never throws; this guards the response assembly.
    return NextResponse.json({ error: 'refresh error' }, { status: 500 });
  }
}
