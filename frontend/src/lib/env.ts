/**
 * Typed, validated environment access for the frontend.
 *
 * Goals:
 *  - Fail loud in production: getApiUrl()/getWsUrl()/getAppUrl() throw if the
 *    backing env var is missing.
 *  - Forgiving in development: fall back to documented localhost defaults and
 *    emit a single console.warn per process so the developer notices.
 *  - Single source of truth: a zod schema validates the public env surface at
 *    module load time. All call sites should go through these helpers instead
 *    of reading process.env directly.
 *
 * Notes:
 *  - Next.js inlines `process.env.NEXT_PUBLIC_*` at build time on the client,
 *    so we explicitly reference each key (no dynamic indexing) to keep the
 *    inlining intact.
 *  - Server-only env vars (e.g. `APP_PUBLIC_ORIGIN`, `API_URL`) are also
 *    described here, but only read on the server side. On the client they will
 *    simply be `undefined`.
 */

import { z } from 'zod';

// ── Schema ───────────────────────────────────────────────────────────────────

/**
 * URL string with protocol — http(s) or ws(s) acceptable.
 * Empty string is rejected (use `optional()` for optional values).
 */
const urlString = z
  .string()
  .min(1)
  .refine(
    (v) => /^(https?|wss?):\/\//.test(v),
    'must be an absolute URL with protocol (http://, https://, ws://, wss://)',
  );

const publicEnvSchema = z.object({
  /** Public API base URL used by the browser (and SSR fetches). */
  NEXT_PUBLIC_API_URL: urlString.optional(),
  /** Optional public app URL (used by some BFF/CSRF flows for origin checks). */
  NEXT_PUBLIC_APP_URL: urlString.optional(),
});

const serverEnvSchema = z.object({
  /** Server-only origin used for BFF CSRF/SameSite checks. */
  APP_PUBLIC_ORIGIN: urlString.optional(),
  /** Server-only fallback API base for SSR; usually mirrors NEXT_PUBLIC_API_URL. */
  API_URL: urlString.optional(),
});

// ── Defaults ─────────────────────────────────────────────────────────────────

const DEV_DEFAULT_API_URL = 'http://localhost:8080';
const DEV_DEFAULT_APP_URL = 'http://localhost:3002';

// ── Validation ───────────────────────────────────────────────────────────────

const isProd = process.env.NODE_ENV === 'production';

// Read raw values via explicit references so Next inlines them on the client.
const rawPublic = {
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
};

const rawServer = {
  APP_PUBLIC_ORIGIN: process.env.APP_PUBLIC_ORIGIN,
  API_URL: process.env.API_URL,
};

const publicResult = publicEnvSchema.safeParse(rawPublic);
const serverResult =
  typeof window === 'undefined' ? serverEnvSchema.safeParse(rawServer) : null;

if (!publicResult.success) {
  const issues = publicResult.error.issues
    .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
    .join('\n');
  // Fail-loud at module load: malformed values are always a hard error,
  // independent of NODE_ENV. (Missing values are tolerated in dev below.)
  throw new Error(
    `[env] Invalid public environment variables:\n${issues}\n` +
      `Set the corresponding NEXT_PUBLIC_* values in your environment or .env file.`,
  );
}

if (serverResult && !serverResult.success) {
  const issues = serverResult.error.issues
    .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
    .join('\n');
  throw new Error(`[env] Invalid server environment variables:\n${issues}`);
}

const publicEnv = publicResult.data;
const serverEnv = serverResult?.success ? serverResult.data : ({} as z.infer<typeof serverEnvSchema>);

// ── Warn-once helpers ────────────────────────────────────────────────────────

const warned = new Set<string>();
function warnOnce(key: string, fallback: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(
    `[env] ${key} is not set; falling back to ${fallback}. ` +
      `Set ${key} in your environment to silence this warning.`,
  );
}

function failMissing(key: string): never {
  throw new Error(
    `[env] ${key} is required in production but was not set. ` +
      `Configure it in your deployment environment.`,
  );
}

// ── Public getters ───────────────────────────────────────────────────────────

/**
 * Returns the public API base URL.
 *  - Production: throws if NEXT_PUBLIC_API_URL is unset.
 *  - Development: warns once and returns http://localhost:8080.
 */
export function getApiUrl(): string {
  const v = publicEnv.NEXT_PUBLIC_API_URL;
  if (v) return v;
  if (isProd) failMissing('NEXT_PUBLIC_API_URL');
  warnOnce('NEXT_PUBLIC_API_URL', DEV_DEFAULT_API_URL);
  return DEV_DEFAULT_API_URL;
}

/**
 * Returns the public WebSocket base URL, derived from the API URL by swapping
 * http(s) → ws(s). The returned value has no trailing path; callers append the
 * specific WS path (e.g. `/ws/v1/notifications`).
 */
export function getWsUrl(): string {
  const apiUrl = getApiUrl();
  return apiUrl.replace(/^http(s?):\/\//, 'ws$1://');
}

/**
 * Returns the public app URL (frontend origin). Optional in production —
 * returns undefined if not set. Use this only for places that already tolerate
 * a missing value (e.g. CSRF origin allowlists with multiple sources).
 */
export function getAppUrlOptional(): string | undefined {
  const v = publicEnv.NEXT_PUBLIC_APP_URL;
  if (v) return v;
  if (!isProd && typeof window === 'undefined') {
    // On the server during dev, surface a one-time hint, but don't fall back
    // — the caller may legitimately not need this value.
    return undefined;
  }
  return undefined;
}

/**
 * Returns the public app URL with a dev fallback. Use this when callers
 * unambiguously need a URL (e.g. building absolute redirect URLs in dev tools).
 */
export function getAppUrl(): string {
  const v = publicEnv.NEXT_PUBLIC_APP_URL;
  if (v) return v;
  if (isProd) failMissing('NEXT_PUBLIC_APP_URL');
  warnOnce('NEXT_PUBLIC_APP_URL', DEV_DEFAULT_APP_URL);
  return DEV_DEFAULT_APP_URL;
}

// ── Server-only getters ──────────────────────────────────────────────────────

/**
 * Returns the server-only APP_PUBLIC_ORIGIN, falling back to NEXT_PUBLIC_APP_URL.
 * Returns undefined if neither is set — callers (e.g. BFF CSRF) decide whether
 * that's fatal at request time.
 */
export function getServerAppOrigin(): string | undefined {
  return serverEnv.APP_PUBLIC_ORIGIN ?? publicEnv.NEXT_PUBLIC_APP_URL;
}

/**
 * Returns the server-side API URL. Prefers NEXT_PUBLIC_API_URL (so SSR matches
 * the browser), then API_URL, then dev default. Throws in production if none set.
 */
export function getServerApiUrl(): string {
  const v = publicEnv.NEXT_PUBLIC_API_URL ?? serverEnv.API_URL;
  if (v) return v;
  if (isProd) failMissing('NEXT_PUBLIC_API_URL');
  warnOnce('NEXT_PUBLIC_API_URL/API_URL', DEV_DEFAULT_API_URL);
  return DEV_DEFAULT_API_URL;
}
