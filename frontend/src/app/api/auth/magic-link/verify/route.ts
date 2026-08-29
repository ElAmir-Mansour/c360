import { NextRequest, NextResponse } from 'next/server';
import { COOKIES, SESSION } from '@/lib/constants';
import { isBFFOriginAllowed, bffCSRFRejection } from '@/lib/bff-csrf';
import {
  buildForwardHeaders,
  gatewayFetch,
  safeJson,
  featureUnavailable,
  FEATURE_UNAVAILABLE_STATUSES,
} from '@/lib/bff-proxy';

// BFF proxy for verifying a magic-link / email-OTP token (capability #6).
//
// Proxies to the live gateway endpoint POST /api/v1/auth/magic-link/verify.
// Graceful by design: when the gateway route is missing (404/501) or the fetch
// throws, this returns 501 so the client hook flags the feature unavailable.
// On a genuine success that yields tokens it establishes the httpOnly session
// cookies — same pattern as /api/auth/session — and returns the access token
// plus any MFA continuation. Token errors (e.g. 400/410) are passed through.

const cookieSecure = SESSION.COOKIE_SECURE;
const accessMaxAge = SESSION.ACCESS_TOKEN_MAX_AGE;
const refreshMaxAge = SESSION.REFRESH_TOKEN_MAX_AGE;

function cookieOptions(maxAge: number, path: string) {
  return {
    httpOnly: true,
    secure: cookieSecure,
    sameSite: SESSION.COOKIE_SAMESITE,
    domain: SESSION.COOKIE_DOMAIN,
    path,
    maxAge,
  } as const;
}

function decodeJWTPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
}

// POST /api/auth/magic-link/verify
// Body: { token }
export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isBFFOriginAllowed(req)) return bffCSRFRejection();

  let body: { token?: string };
  try {
    body = (await req.json()) as { token?: string };
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  if (!body.token || typeof body.token !== 'string') {
    return NextResponse.json({ error: 'token is required' }, { status: 400 });
  }

  const result = await gatewayFetch('/api/v1/auth/magic-link/verify', {
    method: 'POST',
    headers: buildForwardHeaders(req, { json: true, device: true }),
    body: JSON.stringify({ token: body.token }),
  });

  if (!result.ok) {
    if (result.networkError) {
      return featureUnavailable('magic-link sign-in is not available');
    }
    if (result.status !== undefined && FEATURE_UNAVAILABLE_STATUSES.has(result.status)) {
      return featureUnavailable('magic-link sign-in is not available');
    }
    // Token invalid/expired — pass the status through (400/410/etc).
    return NextResponse.json(
      { error: 'magic-link verification failed' },
      { status: result.status ?? 502 },
    );
  }

  const data = await safeJson<Record<string, unknown>>(result.response);
  if (data === null) {
    // Upstream said OK but returned no parseable body — treat as unavailable.
    return featureUnavailable('magic-link sign-in is not available');
  }

  // MFA continuation: backend wants a second factor before issuing tokens.
  if (data['requires_mfa'] === true) {
    return NextResponse.json({
      requires_mfa: true,
      mfa_token: typeof data['mfa_token'] === 'string' ? data['mfa_token'] : undefined,
    });
  }

  const accessToken =
    typeof data['access_token'] === 'string' ? (data['access_token'] as string) : undefined;
  const refreshToken =
    typeof data['refresh_token'] === 'string' ? (data['refresh_token'] as string) : undefined;

  if (!accessToken || !refreshToken) {
    // Success without tokens is not actionable for the session — degrade.
    return featureUnavailable('magic-link sign-in is not available');
  }

  const payload = decodeJWTPayload(accessToken);
  const exp = payload && typeof payload['exp'] === 'number' ? (payload['exp'] as number) : 0;

  const response = NextResponse.json({
    verified: true,
    access_token: accessToken,
    expires_at: exp ? new Date(exp * 1000).toISOString() : undefined,
  });

  response.cookies.set(COOKIES.ACCESS, accessToken, cookieOptions(accessMaxAge, '/'));
  response.cookies.set(COOKIES.REFRESH, refreshToken, cookieOptions(refreshMaxAge, '/api/auth'));

  return response;
}
