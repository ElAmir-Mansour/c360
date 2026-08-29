import { NextRequest, NextResponse } from 'next/server';
import { isBFFOriginAllowed, bffCSRFRejection } from '@/lib/bff-csrf';
import {
  buildForwardHeaders,
  gatewayFetch,
  featureUnavailable,
  FEATURE_UNAVAILABLE_STATUSES,
} from '@/lib/bff-proxy';

// BFF proxy for the magic-link / email-OTP request (capability #6).
//
// Proxies to the live gateway endpoint POST /api/v1/auth/magic-link/request.
// Graceful by design: when the upstream answers 404/501 (or the fetch throws)
// this returns 501 so the client hook flags the feature unavailable and hides
// it. The success response is intentionally non-disclosing (never reveals
// whether the email exists).

// POST /api/auth/magic-link/request
// Body: { email }
export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isBFFOriginAllowed(req)) return bffCSRFRejection();

  let body: { email?: string };
  try {
    body = (await req.json()) as { email?: string };
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  if (!body.email || typeof body.email !== 'string') {
    return NextResponse.json({ error: 'email is required' }, { status: 400 });
  }

  const result = await gatewayFetch('/api/v1/auth/magic-link/request', {
    method: 'POST',
    headers: buildForwardHeaders(req, { json: true, device: true }),
    body: JSON.stringify({ email: body.email }),
  });

  if (!result.ok) {
    // Network error → degrade gracefully.
    if (result.networkError) {
      return featureUnavailable('magic-link sign-in is not available');
    }
    // Capability not shipped upstream (404/501) → tell the client to degrade.
    if (result.status !== undefined && FEATURE_UNAVAILABLE_STATUSES.has(result.status)) {
      return featureUnavailable('magic-link sign-in is not available');
    }
    // Pass through other statuses so the client can react (e.g. 429 rate limit).
    return NextResponse.json(
      { error: 'magic-link request failed' },
      { status: result.status ?? 502 },
    );
  }

  // Non-disclosing success: do not echo whether the email exists.
  return NextResponse.json({ sent: true });
}
