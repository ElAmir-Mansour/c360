import { NextRequest, NextResponse } from 'next/server';

// BFF proxy for the breached-password (k-anonymity) check — capability #14.
//
// The browser computes SHA-1(password) locally and sends ONLY the 5-char hex
// prefix here as `?prefix=XXXXX`. This route proxies that prefix to an
// upstream range API (if one is configured) and streams back the list of
// `SUFFIX:COUNT` entries. The plaintext password is never transmitted, and the
// browser never talks to the external service directly — sovereign deployments
// keep all egress under operator control via this proxy.
//
// CONFIG (server-side env, never exposed to the client):
//   BREACH_RANGE_API_URL  Base URL of a pwnedpasswords-style range endpoint.
//                         The 5-char prefix is appended as a path segment, e.g.
//                         `https://api.pwnedpasswords.com/range` -> `/range/ABCDE`.
//                         If unset, this route returns 501 and the client UI
//                         silently treats the check as unavailable.
//
// This is a GRACEFUL STUB by design: with no upstream configured it returns a
// 501 the client (`src/lib/breached-password.ts`) detects and degrades on. It
// is read-only (GET), so no cookie mutation and no BFF CSRF origin gate apply.

const PREFIX_PATTERN = /^[0-9A-F]{5}$/;

function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '');
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const prefixRaw = req.nextUrl.searchParams.get('prefix') ?? '';
  const prefix = prefixRaw.toUpperCase();

  if (!PREFIX_PATTERN.test(prefix)) {
    return NextResponse.json(
      { error: 'prefix must be 5 hex characters' },
      { status: 400 },
    );
  }

  const upstreamBase = process.env.BREACH_RANGE_API_URL;
  if (!upstreamBase) {
    // No upstream configured (e.g. sovereign/air-gapped deployment). The client
    // treats 501 as "feature unavailable" and hides/relaxes the check.
    return NextResponse.json(
      { error: 'breach check not configured' },
      { status: 501 },
    );
  }

  const target = `${normalizeBaseUrl(upstreamBase)}/${prefix}`;

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: 'GET',
      headers: {
        Accept: 'text/plain',
        // Request padded responses where supported, so the returned range size
        // does not leak how many suffixes share this prefix.
        'Add-Padding': 'true',
      },
      // Don't cache breach lookups at the fetch layer; freshness over reuse.
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json(
      { error: 'breach upstream unreachable' },
      { status: 502 },
    );
  }

  if (!upstream.ok) {
    return NextResponse.json(
      { error: 'breach upstream error' },
      { status: 502 },
    );
  }

  let body: string;
  try {
    body = await upstream.text();
  } catch {
    return NextResponse.json(
      { error: 'breach upstream read failed' },
      { status: 502 },
    );
  }

  // Return the raw range list as text/plain; the client matches the suffix.
  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
