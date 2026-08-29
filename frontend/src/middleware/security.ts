/**
 * Security middleware utilities for Next.js.
 *
 * These functions can be composed with the existing auth middleware
 * in src/middleware.ts to add security headers to all responses.
 *
 * Usage in middleware.ts:
 *   import { addSecurityHeaders } from '@/middleware/security';
 *   // After auth logic:
 *   const response = NextResponse.next();
 *   addSecurityHeaders(response);
 *   return response;
 */

import { NextResponse } from 'next/server';
import { getApiUrl } from '@/lib/env';
import { buildConnectSrc } from '@/lib/security-headers';

const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const API_URL = getApiUrl();
// Whether this build is actually served over HTTPS (the public origin baked into
// NEXT_PUBLIC_API_URL at build time). HTTP-only deployments (e.g. a bare-IP
// preview) MUST NOT emit `upgrade-insecure-requests` or HSTS, or the browser
// rewrites every same-origin asset to https:// — which has no listener — and the
// page renders unstyled. Rebuilding for a TLS domain re-enables both.
const SERVE_HTTPS = API_URL.startsWith('https://');

/**
 * Returns the CSP string the middleware should set on BOTH request and response.
 * Next.js reads the request-side CSP to discover the nonce and apply it to its
 * inline RSC/streaming bootstrap scripts.
 */
export function buildCSPHeader(nonce?: string): string {
  return buildCSP(nonce);
}

/**
 * Adds security headers to a Next.js response.
 * Call this in your middleware after auth checks.
 *
 * If a nonce is provided, it is injected into script-src so Next.js's
 * inline RSC/streaming bootstrap scripts are allowed in production.
 */
export function addSecurityHeaders(response: NextResponse, nonce?: string): void {
  const headers = response.headers;

  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('X-XSS-Protection', '0');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  );

  headers.set('Content-Security-Policy', buildCSP(nonce));

  if (IS_PRODUCTION) {
    if (SERVE_HTTPS) {
      headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    }
    headers.set('Cross-Origin-Opener-Policy', 'same-origin');
    headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  }

  headers.delete('Server');
  headers.delete('X-Powered-By');
}

/**
 * Builds the CSP for the frontend application.
 *
 * Next.js's App Router emits inline RSC/streaming bootstrap scripts that need
 * either a nonce or 'unsafe-inline'. Per the CSP spec, the PRESENCE of a nonce
 * in script-src makes browsers IGNORE 'unsafe-inline' — and Next 15.5 does not
 * apply the request-propagated nonce to its inline flight/hydration scripts
 * (verified against the standalone production server: zero nonced scripts),
 * which blanks every page in production. So the nonce must NOT be emitted into
 * script-src until the app fully adopts nonce propagation; the parameter is
 * kept (and x-nonce plumbing in middleware.ts preserved) for that future pass.
 * Same-origin script loading is still required (no third-party CDNs).
 */
function buildCSP(_nonce?: string): string {
  const isDev = !IS_PRODUCTION;

  const scriptSrc = isDev
    ? "script-src 'self' 'unsafe-eval' 'unsafe-inline'"
    : "script-src 'self' 'unsafe-inline'";

  const directives: string[] = [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    buildConnectSrc(API_URL),
    "worker-src 'self' blob:",
    // `blob:` allows the reference-library PDF viewer to frame a downloaded PDF as a
    // native <iframe> fallback (pdf.js canvas is the primary path).
    "frame-src 'self' blob:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ];

  if (!isDev && SERVE_HTTPS) {
    directives.push('upgrade-insecure-requests');
  }

  return directives.join('; ');
}
