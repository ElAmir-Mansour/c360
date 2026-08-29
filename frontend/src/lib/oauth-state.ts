import { getDeviceId } from '@/hooks/use-device-trust';
import { safeRedirect } from '@/lib/safe-redirect';

/**
 * Builds the base64 OAuth/SSO `state` payload shared by every external
 * identity redirect (OAuth providers, discovered enterprise SSO): the
 * sanitized post-login target plus the trusted-device id, so the callback can
 * route the user back to their deep link and associate the session with this
 * device. `redirectTo` is attacker-controllable (query param) — it is passed
 * through safeRedirect() so only same-origin relative paths survive.
 */
export function buildOAuthState(provider: string, redirectTo: string): string {
  const deviceId = getDeviceId();
  return btoa(
    JSON.stringify({
      provider,
      redirect_to: safeRedirect(redirectTo, '/dashboard'),
      ...(deviceId ? { device_id: deviceId } : {}),
    }),
  );
}

/**
 * Returns true when the authorize URL's QUERY STRING already carries a `state`
 * parameter. Discovered enterprise-SSO authorize URLs are minted by the backend
 * with a server-persisted `state` the IdP will echo back — appending a second
 * one would produce `state=A&state=B`, which IdPs may reject outright or
 * resolve to the wrong value, breaking CSRF validation at the callback.
 *
 * Only the query string counts: a `state` inside the fragment (never sent to
 * the server) or in the path does not.
 */
function hasStateParam(authorizeUrl: string): boolean {
  try {
    // Base URL only matters for relative inputs; any placeholder origin works.
    return new URL(authorizeUrl, 'https://relative.invalid').searchParams.has('state');
  } catch {
    // Unparseable input — fall back to a conservative query-string scan.
    const queryStart = authorizeUrl.indexOf('?');
    if (queryStart === -1) return false;
    const query = authorizeUrl.slice(queryStart + 1).split('#', 1)[0];
    return /(^|&)state=/.test(query);
  }
}

/**
 * Appends the `state` query param to an authorize URL, tolerating URLs that
 * already carry a query string (discovered SSO authorize URLs often do).
 *
 * When the URL ALREADY carries a `state` param (enterprise-SSO authorize URLs
 * minted with server-persisted state), the URL is returned unchanged — the
 * server's state must win, and a duplicate param risks IdP rejection.
 */
export function withOAuthState(authorizeUrl: string, state: string): string {
  if (hasStateParam(authorizeUrl)) {
    return authorizeUrl;
  }
  const separator = authorizeUrl.includes('?') ? '&' : '?';
  return `${authorizeUrl}${separator}state=${encodeURIComponent(state)}`;
}
