import { NextRequest, NextResponse } from 'next/server';
import { buildForwardHeaders, gatewayFetch, safeJson } from '@/lib/bff-proxy';

// GET /api/auth/sso/discover?domain=acme.com
//
// SSO discovery by email domain. Proxies to the live gateway endpoint
// GET /api/v1/auth/sso/discover?domain=…, which resolves an email domain to an
// enterprise SSO provider + authorize URL.
//
// Graceful degradation (always returns JSON the client can detect, so the UI can
// silently hide the SSO CTA rather than surfacing an error):
//   - Missing/blank domain        -> 200 with { provider: null }
//   - Upstream 404 (no mapping)   -> 200 with { provider: null }
//   - Upstream 501 (not built)    -> 501 with { provider: null }
//   - Upstream error / network    -> 501 with { provider: null }
//
// READ-ONLY (no cookie mutation), so the BFF CSRF origin gate (which guards
// mutating verbs) is intentionally not applied.

interface SsoDiscoveryResult {
  provider: string | null;
  authorizeUrl: string | null;
}

const EMPTY: SsoDiscoveryResult = { provider: null, authorizeUrl: null };

function normalizeUpstream(raw: unknown): SsoDiscoveryResult {
  if (!raw || typeof raw !== 'object') return EMPTY;
  const obj = raw as Record<string, unknown>;
  const provider =
    typeof obj['provider'] === 'string' && obj['provider'].length > 0
      ? (obj['provider'] as string)
      : null;
  // Accept both camelCase (authorizeUrl) and snake_case (authorize_url) so the
  // gateway contract can settle either way.
  const authorizeRaw = obj['authorizeUrl'] ?? obj['authorize_url'];
  const authorizeUrl =
    typeof authorizeRaw === 'string' && authorizeRaw.length > 0
      ? (authorizeRaw as string)
      : null;
  if (!provider || !authorizeUrl) return EMPTY;
  return { provider, authorizeUrl };
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const domain = req.nextUrl.searchParams.get('domain')?.trim().toLowerCase();

  if (!domain) {
    return NextResponse.json(EMPTY);
  }

  const result = await gatewayFetch(
    `/api/v1/auth/sso/discover?domain=${encodeURIComponent(domain)}`,
    {
      method: 'GET',
      headers: buildForwardHeaders(req),
    },
  );

  if (!result.ok) {
    // No mapping for this domain (404) is a normal, expected outcome. Return
    // 200 so browser DevTools does not report a handled discovery miss as a
    // login-page error.
    if (result.status === 404) {
      return NextResponse.json(EMPTY);
    }
    return NextResponse.json(EMPTY, { status: 501 });
  }

  const data = await safeJson(result.response);
  return NextResponse.json(normalizeUpstream(data));
}
