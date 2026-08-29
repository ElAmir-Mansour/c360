import { NextRequest, NextResponse } from 'next/server';

// Origin allowlist check for BFF auth routes (/api/auth/*).
//
// Background: BFF routes accept POST/DELETE that mutate the httpOnly auth cookies.
// Browsers always send those cookies automatically, so without an explicit
// Origin check, a malicious cross-site page can trigger token rotation or
// session establishment. SameSite=strict mitigates this in modern browsers,
// but treating it as the only line of defense is fragile (cookie policy may
// loosen, browsers vary). This adds defense-in-depth at the request layer.

function allowedOrigins(req: NextRequest): Set<string> {
  const explicit =
    process.env.APP_PUBLIC_ORIGIN ?? process.env.NEXT_PUBLIC_APP_URL ?? '';
  const set = new Set<string>();
  for (const o of explicit
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)) {
    set.add(o);
  }
  // Same-origin fallback: derive from Host so the route accepts requests from
  // the same deployment without requiring APP_PUBLIC_ORIGIN to be set.
  const host = req.headers.get('host');
  if (host) {
    const proto =
      req.headers.get('x-forwarded-proto') ??
      req.nextUrl.protocol.replace(':', '') ??
      'https';
    set.add(`${proto}://${host}`);
  }
  return set;
}

export function isBFFOriginAllowed(req: NextRequest): boolean {
  const allowed = allowedOrigins(req);
  const origin = req.headers.get('origin');
  if (origin) {
    return allowed.has(origin);
  }
  // No Origin header: fall back to Referer for older clients. Same-origin
  // browsers always send Origin on POST/DELETE, so a missing Origin with no
  // Referer is treated as forged.
  const referer = req.headers.get('referer');
  if (!referer) return false;
  try {
    const refUrl = new URL(referer);
    return allowed.has(`${refUrl.protocol}//${refUrl.host}`);
  } catch {
    return false;
  }
}

export function bffCSRFRejection(): NextResponse {
  return NextResponse.json(
    { error: 'forbidden: cross-origin request blocked' },
    { status: 403 },
  );
}
