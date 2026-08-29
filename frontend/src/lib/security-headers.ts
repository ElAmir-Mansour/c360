/**
 * Security headers configuration for Next.js.
 *
 * These headers are applied via next.config.mjs or the Next.js middleware.
 * They mirror the backend security headers for the frontend routes.
 */

export interface SecurityHeadersConfig {
  environment: 'development' | 'staging' | 'production';
  apiUrl: string;
  cspReportUri?: string;
}

function getWebSocketSource(apiUrl: string): string | null {
  try {
    const url = new URL(apiUrl);
    if (url.protocol === 'http:') {
      url.protocol = 'ws:';
    } else if (url.protocol === 'https:') {
      url.protocol = 'wss:';
    } else if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function getOrigin(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function getMapTileConnectSources(): string[] {
  const configuredSources = (process.env.NEXT_PUBLIC_MAP_TILE_CONNECT_SRC ?? '')
    .split(/[\s,]+/)
    .map((source) => source.trim())
    .filter(Boolean);

  return [
    'https://tile.openstreetmap.org',
    getOrigin(process.env.NEXT_PUBLIC_MAP_TILE_URL_TEMPLATE),
    ...configuredSources,
  ].filter((source): source is string => Boolean(source));
}

export function buildConnectSrc(apiUrl: string): string {
  // `blob:` lets the reference-library PDF viewer read the downloaded document's
  // bytes (fetch of the same-origin object URL) so pdf.js can render it to canvas.
  const sources = ["'self'", 'blob:', apiUrl, getWebSocketSource(apiUrl), 'wss:', ...getMapTileConnectSources()].filter(
    (source): source is string => Boolean(source),
  );
  return `connect-src ${Array.from(new Set(sources)).join(' ')}`;
}

/**
 * Builds the Content-Security-Policy header value for the frontend.
 */
export function buildCSP(config: SecurityHeadersConfig): string {
  const isDev = config.environment === 'development';

  const directives: string[] = [
    "default-src 'self'",
    isDev
      ? "script-src 'self' 'unsafe-eval' 'unsafe-inline'" // HMR requires eval + inline
      : "script-src 'self'",
    "style-src 'self' 'unsafe-inline'", // Tailwind JIT requires unsafe-inline
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    buildConnectSrc(config.apiUrl),
    "worker-src 'self' blob:",
    // `blob:` lets the reference-library viewer frame a downloaded PDF as a native
    // <iframe> fallback (when pdf.js canvas rendering is unavailable).
    "frame-src 'self' blob:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ];

  if (!isDev) {
    directives.push('upgrade-insecure-requests');
  }

  if (config.cspReportUri && !isDev) {
    directives.push(`report-uri ${config.cspReportUri}`);
  }

  return directives.join('; ');
}

/**
 * Returns all security headers for Next.js configuration.
 */
export function getSecurityHeaders(config: SecurityHeadersConfig): Array<{ key: string; value: string }> {
  const isDev = config.environment === 'development';

  const headers: Array<{ key: string; value: string }> = [
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'X-XSS-Protection', value: '0' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    {
      key: 'Permissions-Policy',
      value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
    },
    { key: 'Content-Security-Policy', value: buildCSP(config) },
  ];

  if (!isDev) {
    headers.push({
      key: 'Strict-Transport-Security',
      value: 'max-age=31536000; includeSubDomains; preload',
    });
    headers.push({ key: 'Cross-Origin-Embedder-Policy', value: 'require-corp' });
    headers.push({ key: 'Cross-Origin-Opener-Policy', value: 'same-origin' });
    headers.push({ key: 'Cross-Origin-Resource-Policy', value: 'same-origin' });
  }

  return headers;
}
