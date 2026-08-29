import { NextRequest, NextResponse } from 'next/server';
import { isBFFOriginAllowed, bffCSRFRejection } from '@/lib/bff-csrf';
import {
  DEVICE_ID_HEADER,
  buildForwardHeaders,
  gatewayFetch,
  safeJson,
} from '@/lib/bff-proxy';

// BFF proxy for device-trust registration + listing (capability #12: DEVICE
// TRUST + step-up).
//
// The gateway's /api/v1/auth/devices is AUTHENTICATED (returns 401 without a
// JWT). This route forwards the access token from the httpOnly session cookie
// as `Authorization: Bearer …` server-side — the browser's in-memory token is
// never required and the refresh/session cookie machinery stays the single
// source of truth.
//
// Graceful degradation: any non-2xx / network error is surfaced as a non-fatal
// shape the client can detect (registration is best-effort and never blocks the
// auth flow). The actual "step-up" decision is owned by the backend login
// response (`requiresMFA`); this endpoint only persists/announces the device id.

interface RegisterDeviceBody {
  device_id?: string;
  trusted?: boolean;
  user_agent?: string;
}

// POST /api/auth/devices
// Body: { device_id, trusted?, user_agent? }
// Forwards (with auth) to the gateway device registry; degrades to 501 otherwise.
export async function POST(req: NextRequest): Promise<NextResponse> {
  // Mutating verb — gate cross-origin requests (defense-in-depth alongside CSRF).
  if (!isBFFOriginAllowed(req)) return bffCSRFRejection();

  let body: RegisterDeviceBody;
  try {
    body = (await req.json()) as RegisterDeviceBody;
  } catch {
    return NextResponse.json({ error: 'invalid request body' }, { status: 400 });
  }

  if (!body.device_id || typeof body.device_id !== 'string') {
    return NextResponse.json({ error: 'device_id is required' }, { status: 400 });
  }

  // Forward auth (JWT from cookie) so the gateway can associate the device with
  // the authenticated user. The X-Device-Id header lets the backend correlate
  // even if it ignores the body field.
  const headers = buildForwardHeaders(req, { json: true, auth: true, device: true });
  headers[DEVICE_ID_HEADER] = body.device_id;

  const result = await gatewayFetch('/api/v1/auth/devices', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      device_id: body.device_id,
      trusted: body.trusted ?? false,
      user_agent: body.user_agent ?? req.headers.get('user-agent') ?? '',
    }),
  });

  if (!result.ok) {
    // Backend route missing/rejected or unreachable → unavailable, non-fatal.
    return NextResponse.json(
      { registered: false, reason: 'device registry unavailable' },
      { status: 501 },
    );
  }

  const data = await safeJson(result.response);
  return NextResponse.json({ registered: true, device: data ?? null });
}

// GET /api/auth/devices
// Authenticated: forwards the JWT from the session cookie so the gateway returns
// this user's devices. Graceful: returns an empty list (200) when unavailable so
// callers can render without special-casing a missing/unauthenticated backend.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const result = await gatewayFetch('/api/v1/auth/devices', {
    method: 'GET',
    headers: buildForwardHeaders(req, { auth: true, device: true }),
  });

  if (!result.ok) {
    // Authentication/authorization failures must be surfaced to the caller, not
    // masked as an empty list — an unauthenticated request has to learn it is
    // unauthenticated so it can prompt for sign-in / step-up.
    if (result.status === 401 || result.status === 403) {
      return NextResponse.json(
        { devices: [], available: false, error: 'unauthorized' },
        { status: result.status },
      );
    }
    // Network error or a backend that hasn't shipped the endpoint → non-fatal
    // empty list so the UI can still render.
    return NextResponse.json({ devices: [], available: false });
  }

  const data = await safeJson(result.response);
  return NextResponse.json({ devices: data ?? [], available: true });
}
