import { NextRequest, NextResponse } from 'next/server';
import { COOKIES } from '@/lib/constants';

// Shared BFF → API-gateway proxy helpers.
//
// All BFF auth routes under /api/auth/** talk to the Clario360 API gateway.
// This module centralizes:
//   - the gateway base URL (single source of truth + sane fallback),
//   - server-side JWT forwarding (reads the httpOnly access cookie and turns it
//     into an `Authorization: Bearer` header — the browser never sees the token),
//   - device-trust header pass-through (X-Device-Id),
//   - graceful degradation (network errors / 5xx never crash the page).
//
// Routes that need bespoke behavior (cookie setting after login, k-anonymity
// breach proxy, health probe) keep their own logic but still resolve the base
// URL through `gatewayBaseUrl()` so the wiring stays consistent.

/**
 * Resolves the API-gateway base URL.
 *
 * `GATEWAY_INTERNAL_URL` is a server-only override (lets a deployment route BFF
 * traffic to the gateway over an internal address while the browser uses the
 * public `NEXT_PUBLIC_API_URL`). Falls back to the public URL, then to the dev
 * default so local runs work with zero config.
 */
export function gatewayBaseUrl(): string {
  const url =
    process.env.GATEWAY_INTERNAL_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    'http://localhost:8080';
  return url.trim().replace(/\/+$/, '');
}

/** Builds an absolute gateway URL from a leading-slash path. */
export function gatewayUrl(path: string): string {
  return `${gatewayBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`;
}

/** Header name carrying the stable per-browser device id (capability #12). */
export const DEVICE_ID_HEADER = 'X-Device-Id';

/**
 * Reads the httpOnly access-token cookie set by the session/refresh/login BFF
 * routes. Returns `undefined` when no session cookie is present.
 */
export function accessTokenFromRequest(req: NextRequest): string | undefined {
  return req.cookies.get(COOKIES.ACCESS)?.value || undefined;
}

interface ForwardHeaderOptions {
  /** Forward the access cookie as `Authorization: Bearer …` (default: false). */
  auth?: boolean;
  /** Forward the inbound `X-Device-Id` header if present (default: false). */
  device?: boolean;
  /** Set a JSON `Content-Type` (default: false; set true when sending a body). */
  json?: boolean;
}

/**
 * Builds the outbound header set for a gateway request, forwarding only the
 * pieces a given route is allowed to forward. Authentication is read from the
 * httpOnly cookie server-side — the browser's in-memory token is never required
 * for BFF→gateway calls.
 */
export function buildForwardHeaders(
  req: NextRequest,
  opts: ForwardHeaderOptions = {},
): Record<string, string> {
  const headers: Record<string, string> = {};

  if (opts.json) {
    headers['Content-Type'] = 'application/json';
  }
  headers['Accept'] = 'application/json';

  if (opts.auth) {
    const token = accessTokenFromRequest(req);
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
  }

  if (opts.device) {
    const deviceId = req.headers.get(DEVICE_ID_HEADER) ?? req.headers.get('x-device-id');
    if (deviceId) {
      headers[DEVICE_ID_HEADER] = deviceId;
    }
  }

  return headers;
}

/** Statuses that mean "the gateway has not shipped this capability yet". */
export const FEATURE_UNAVAILABLE_STATUSES = new Set([404, 501]);

export interface GatewayFetchOk {
  ok: true;
  status: number;
  response: Response;
}

export interface GatewayFetchErr {
  ok: false;
  /** True when the gateway was unreachable / threw at the network layer. */
  networkError: boolean;
  /** Upstream status when reachable but non-2xx; undefined on network error. */
  status?: number;
  /** The raw response when reachable (lets callers inspect the body). */
  response?: Response;
}

export type GatewayFetchResult = GatewayFetchOk | GatewayFetchErr;

/**
 * Performs a fetch against the gateway and normalizes the outcome into a
 * discriminated result that never throws. Callers decide how to degrade.
 *
 * @param timeoutMs - abort the request after this many ms (default 8000).
 */
export async function gatewayFetch(
  path: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<GatewayFetchResult> {
  const { timeoutMs = 8000, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(gatewayUrl(path), {
      ...rest,
      signal: controller.signal,
      cache: 'no-store',
    });

    if (response.ok) {
      return { ok: true, status: response.status, response };
    }
    return { ok: false, networkError: false, status: response.status, response };
  } catch {
    // Network error, DNS failure, timeout/abort — gateway unreachable.
    return { ok: false, networkError: true };
  } finally {
    clearTimeout(timer);
  }
}

/** Safely parses a JSON body, returning `null` instead of throwing. */
export async function safeJson<T = unknown>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

/** Standard "feature unavailable" 501 body used across the graceful routes. */
export function featureUnavailable(message: string): NextResponse {
  return NextResponse.json(
    { error: message, code: 'FEATURE_UNAVAILABLE' },
    { status: 501 },
  );
}
