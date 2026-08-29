import { NextRequest, NextResponse } from 'next/server';
import { isBFFOriginAllowed, bffCSRFRejection } from '@/lib/bff-csrf';
import {
  buildForwardHeaders,
  gatewayFetch,
  safeJson,
} from '@/lib/bff-proxy';

// BFF proxy for WebAuthn / passkey assertion options (capability #5: PASSKEYS).
//
// Proxies to the live gateway endpoint POST /api/v1/auth/webauthn/options, which
// returns the PublicKeyCredentialRequestOptions JSON the browser needs for
// navigator.credentials.get(). The device-trust id (X-Device-Id) rides along so
// the backend can scope the challenge to this device.
//
// Graceful degradation: if the gateway is unreachable, or answers 404/501/5xx,
// this returns 501 so the client (use-passkey) detects "passkey unavailable"
// and hides the UI rather than crashing the page.

const PASSKEY_UNAVAILABLE = { error: 'passkey authentication is not available' } as const;

// POST /api/auth/webauthn/options
// Body (optional): { email?: string } — email is optional to support
// usernameless / discoverable credentials.
export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isBFFOriginAllowed(req)) return bffCSRFRejection();

  let body: { email?: string } = {};
  try {
    body = (await req.json()) as { email?: string };
  } catch {
    // Empty / malformed body is acceptable for discoverable credentials.
    body = {};
  }

  const result = await gatewayFetch('/api/v1/auth/webauthn/options', {
    method: 'POST',
    headers: buildForwardHeaders(req, { json: true, device: true }),
    body: JSON.stringify(body),
  });

  if (!result.ok) {
    // Network error or any non-2xx (404/501/5xx) → normalize to 501.
    return NextResponse.json(PASSKEY_UNAVAILABLE, { status: 501 });
  }

  const data = await safeJson(result.response);
  if (data === null) {
    return NextResponse.json(PASSKEY_UNAVAILABLE, { status: 501 });
  }

  return NextResponse.json(data);
}
