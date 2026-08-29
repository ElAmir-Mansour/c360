import { NextRequest, NextResponse } from 'next/server';
import { COOKIES, SESSION } from '@/lib/constants';
import { isBFFOriginAllowed, bffCSRFRejection } from '@/lib/bff-csrf';
import {
  buildForwardHeaders,
  gatewayFetch,
  safeJson,
} from '@/lib/bff-proxy';

// BFF proxy for WebAuthn / passkey assertion verification (capability #5).
//
// Proxies the signed assertion to the live gateway endpoint
// POST /api/v1/auth/webauthn/verify. On a full-login response the gateway
// returns { access_token, refresh_token, ... } (same shape as /auth/login), and
// this route sets the httpOnly session cookies exactly like /api/auth/session,
// then returns the body to the in-memory client store.
//
// (A3 #1) Remember-me: the client may include `remember: true` in the body.
// When absent/false the cookies are session-scoped (no max-age — they end when
// the browser closes), mirroring the POST /api/auth/session behavior; when true
// they persist for the configured max-ages and the remember marker cookie is
// set so refresh flows keep honoring the choice.
//
// MFA-required responses ({ mfa_required: true, mfa_token }) are passed through
// untouched so the passkey flow stays symmetric with password login.
//
// Graceful degradation: when the gateway is unreachable or answers 404/501/5xx,
// this returns 501 so the client hides the passkey UI gracefully. Auth-shaped
// upstream failures (400/401/403/422/429 — bad assertion, expired challenge,
// lockout) pass through with their status so the client can distinguish
// "this attempt failed" from "passkeys are unavailable".

const cookieSecure = SESSION.COOKIE_SECURE;
const accessMaxAge = SESSION.ACCESS_TOKEN_MAX_AGE;
const refreshMaxAge = SESSION.REFRESH_TOKEN_MAX_AGE;

const PASSKEY_UNAVAILABLE = { error: 'passkey authentication is not available' } as const;

// Upstream statuses that mean "this specific attempt was rejected" rather than
// "the capability is missing" — forwarded verbatim instead of masked as 501.
const PASS_THROUGH_STATUSES = new Set([400, 401, 403, 422, 429]);

// (A3 #1) `maxAge: undefined` yields a session cookie (ends when the browser
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

interface UpstreamVerifyResponse {
  access_token?: string;
  refresh_token?: string;
  mfa_required?: boolean;
  mfa_token?: string;
  [key: string]: unknown;
}

// POST /api/auth/webauthn/verify
// Body: serialized navigator.credentials.get() assertion (PasskeyAssertion),
// optionally extended with { device_id?, remember? }.
export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isBFFOriginAllowed(req)) return bffCSRFRejection();

  let body: Record<string, unknown>;
  try {
    const parsed = (await req.json()) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return NextResponse.json({ error: 'invalid request body' }, { status: 400 });
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid request body' }, { status: 400 });
  }

  // (A3 #1) Default false → session cookies. Only an explicit boolean true
  // upgrades to persistent cookies.
  const remember = body['remember'] === true;

  const result = await gatewayFetch('/api/v1/auth/webauthn/verify', {
    method: 'POST',
    headers: buildForwardHeaders(req, { json: true, device: true }),
    body: JSON.stringify(body),
  });

  if (!result.ok) {
    // Auth-shaped rejections pass through so a failed assertion is reported as
    // a failure, not as "passkeys don't exist here".
    if (
      !result.networkError &&
      result.status !== undefined &&
      PASS_THROUGH_STATUSES.has(result.status) &&
      result.response
    ) {
      const errBody = await safeJson<Record<string, unknown>>(result.response);
      return NextResponse.json(errBody ?? { error: 'passkey verification failed' }, {
        status: result.status,
      });
    }
    // Network error or 404/501/5xx → normalize to 501 so the client treats
    // passkey login as unavailable.
    return NextResponse.json(PASSKEY_UNAVAILABLE, { status: 501 });
  }

  const data = await safeJson<UpstreamVerifyResponse>(result.response);
  if (data === null) {
    return NextResponse.json(PASSKEY_UNAVAILABLE, { status: 501 });
  }

  // MFA challenge — pass through unchanged; no session cookies yet.
  if (data.mfa_required === true) {
    return NextResponse.json(data);
  }

  // Full login — set the httpOnly session cookies (mirrors /api/auth/session,
  // including the remember-me marker semantics).
  if (data.access_token && data.refresh_token) {
    const response = NextResponse.json(data);
    response.cookies.set(
      COOKIES.ACCESS,
      data.access_token,
      cookieOptions(remember ? accessMaxAge : undefined, '/'),
    );
    // Restrict refresh cookie path to /api/auth/* to limit exposure.
    response.cookies.set(
      COOKIES.REFRESH,
      data.refresh_token,
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
  }

  // Upstream returned 2xx but without the expected fields — treat as unavailable.
  return NextResponse.json(PASSKEY_UNAVAILABLE, { status: 501 });
}
