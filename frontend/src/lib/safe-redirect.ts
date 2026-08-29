/**
 * safe-redirect — pure, dependency-free open-redirect guard.
 *
 * Login (and other auth flows) accept a caller-supplied `next`/redirect target
 * (typically from a query string). Forwarding that value verbatim is a classic
 * open-redirect vulnerability: an attacker can craft a link back to our login
 * page that, on success, bounces the victim to an external phishing site or
 * executes a `javascript:` URL.
 *
 * `safeRedirect` returns the supplied target ONLY when it is an unambiguous,
 * same-origin RELATIVE path. Anything else — absolute URLs, protocol-relative
 * URLs, scheme-bearing values, backslash tricks, or strings containing
 * whitespace / control characters — falls back to a safe default.
 *
 * This module is intentionally self-contained (no external deps) so it is
 * trivially unit-testable and safe to import on either the client or server.
 */

/** Default destination used whenever the supplied target is not trusted. */
const DEFAULT_FALLBACK = '/dashboard';
const AUTH_REDIRECT_PATHS = [
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/verify-email',
  '/invite',
  '/callback',
] as const;

/**
 * Matches any ASCII whitespace or control character (0x00–0x20 and 0x7f).
 * Such characters are frequently used to smuggle disallowed values past naive
 * prefix checks (e.g. " /\\evil.com" or "java\nscript:..."), so any presence
 * disqualifies the target.
 */
const CONTROL_OR_WHITESPACE = /[\x00-\x20\x7f]/;

/**
 * Matches a leading URL scheme such as `http:` or `javascript:` per RFC 3986
 * (ALPHA *( ALPHA / DIGIT / "+" / "-" / "." ) ":").
 */
const LEADING_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

/**
 * Return `target` when it is a safe, same-origin relative path; otherwise
 * return `fallback`.
 *
 * A target is considered safe only when ALL of the following hold:
 *  - it is a non-empty string
 *  - it contains no whitespace or ASCII control characters
 *  - it contains no backslashes anywhere (browsers may treat `\` as `/`)
 *  - it starts with a single forward slash (`/foo`), i.e. not `//foo`
 *    (protocol-relative) and not `/\foo` (backslash-normalised by browsers)
 *  - it carries no URL scheme (e.g. `javascript:`, `http:`, `data:`)
 *
 * @param target   the caller-supplied redirect destination
 * @param fallback destination to use when `target` is untrusted (default `/dashboard`)
 */
export function safeRedirect(
  target: string | null | undefined,
  fallback: string = DEFAULT_FALLBACK,
): string {
  if (typeof target !== 'string' || target.length === 0) {
    return fallback;
  }

  // Reject whitespace / control characters used to bypass the checks below.
  if (CONTROL_OR_WHITESPACE.test(target)) {
    return fallback;
  }

  // Backslashes are normalised to forward slashes by browsers, so any backslash
  // makes the target ambiguous (e.g. "/\evil.com" -> "//evil.com").
  if (target.includes('\\')) {
    return fallback;
  }

  // Must be an absolute-path reference: a single leading slash and not "//".
  if (target[0] !== '/' || target[1] === '/') {
    return fallback;
  }

  // Defence in depth: reject anything carrying a URL scheme (e.g. "http:",
  // "javascript:"). A genuine relative path beginning with "/" never does, but
  // this guards against odd inputs slipping through.
  if (LEADING_SCHEME.test(target)) {
    return fallback;
  }

  return target;
}

function getPathname(target: string): string {
  return target.split(/[?#]/, 1)[0] || '/';
}

function isAuthRedirectTarget(target: string): boolean {
  const pathname = getPathname(target);
  return AUTH_REDIRECT_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export function safePostAuthRedirect(
  target: string | null | undefined,
  fallback: string = DEFAULT_FALLBACK,
): string {
  const safeTarget = safeRedirect(target, fallback);
  return isAuthRedirectTarget(safeTarget) ? fallback : safeTarget;
}
