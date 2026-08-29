import { NextResponse } from 'next/server';
import { gatewayBaseUrl } from '@/lib/bff-proxy';

// GET /api/status — graceful BFF system-status probe.
//
// Pings the upstream gateway's /healthz endpoint and maps the result to a
// coarse, public-safe status the auth surface can render without exposing
// internals. The gateway base URL is resolved by the shared helper
// (GATEWAY_INTERNAL_URL → NEXT_PUBLIC_API_URL → dev default).
//
// Contract: this route NEVER returns a non-2xx. It always responds 200 with
// `{ status: 'operational' | 'degraded' | 'unknown' }` so the client hook stays
// simple and degrades gracefully. 'unknown' is used whenever the gateway is
// unreachable, misconfigured, or times out.
export const dynamic = 'force-dynamic';

type SystemStatus = 'operational' | 'degraded' | 'unknown';

const HEALTH_TIMEOUT_MS = 3000;

export async function GET(): Promise<NextResponse> {
  const base = gatewayBaseUrl();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);

  try {
    const upstream = await fetch(`${base}/healthz`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
      cache: 'no-store',
    });

    const status: SystemStatus = upstream.ok ? 'operational' : 'degraded';
    return NextResponse.json<{ status: SystemStatus }>({ status }, { status: 200 });
  } catch {
    // Network error, timeout/abort, DNS failure — treat as unknown rather than
    // failing the request. The UI hides or neutralizes itself on 'unknown'.
    return NextResponse.json<{ status: SystemStatus }>(
      { status: 'unknown' },
      { status: 200 },
    );
  } finally {
    clearTimeout(timer);
  }
}
