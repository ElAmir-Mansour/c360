/**
 * Persona-aware POST-LOGIN landing resolution (§6 "Post-Login Routing").
 *
 * After a successful login + session storage, the login form asks "where do I
 * send this user?". The default is the (already open-redirect-validated)
 * `redirectTo` (usually `/dashboard`). This helper upgrades that decision for
 * LEGAL users:
 *
 *   - If the caller supplied an EXPLICIT redirect (anything other than the bare
 *     `/dashboard` default), honour it — the user asked for a specific page.
 *   - Otherwise fetch `GET /api/v1/lex/me`; if the user has a legal persona
 *     (access_state === 'READY'), land on their persona landing IF it is a
 *     known-existing route, else `/lex` (the persona-aware home). NEVER 404.
 *   - If the user has no legal role (or the fetch fails), fall through to the
 *     supplied `redirectTo` so non-legal users are completely unaffected.
 *
 * This is intentionally a plain async function (not a hook) so the login form
 * can `await` it inside its existing submit handler without extra renders, and
 * so it is trivially unit-testable offline by mocking `fetchLexMe`.
 */

import { fetchLexMe } from './me';
import { resolvePersonaLanding } from './persona-landing';

/** The bare default the login form uses when no explicit redirect was supplied. */
const DEFAULT_DASHBOARD = '/dashboard';

export interface ResolvePostLoginOptions {
  /**
   * The (safe) redirect target the login flow would otherwise use. When this is
   * something OTHER than the bare dashboard default, it is treated as an
   * explicit user intent and returned as-is.
   */
  redirectTo: string;
  /**
   * True when the user's ONLY accessible suite is lex (a Watheeq-only user).
   * Such a user is sent to their sidebarless /lex home even if they hold no
   * specific legal PERSONA role — so they never land on the all-suites
   * dashboard. Computed by the caller from the freshly-authenticated session.
   */
  isWatheeqOnly?: boolean;
  /**
   * Test seam / override: the bare default that signals "no explicit redirect".
   * Defaults to `/dashboard`.
   */
  dashboardDefault?: string;
}

/**
 * Resolve the final post-login destination, upgrading the default dashboard
 * landing to a legal user's persona landing when applicable. Always resolves
 * (never rejects); on any error it returns the supplied `redirectTo`.
 */
export async function resolvePostLoginLanding({
  redirectTo,
  isWatheeqOnly = false,
  dashboardDefault = DEFAULT_DASHBOARD,
}: ResolvePostLoginOptions): Promise<string> {
  // An explicit, non-default redirect is the user's intent — honour it verbatim.
  if (redirectTo !== dashboardDefault) {
    return redirectTo;
  }

  try {
    const me = await fetchLexMe();
    // Legal-persona users → their persona landing. Watheeq-only users → their
    // /lex home even without a persona role (persona_landing falls back to /lex).
    if ((me.access_state === 'READY' && me.active_legal_role) || isWatheeqOnly) {
      return resolvePersonaLanding(me.persona_landing);
    }
  } catch {
    // On a fetch hiccup, still send a known Watheeq-only user to their /lex home;
    // otherwise fall through to the default so non-legal users are unaffected.
    if (isWatheeqOnly) {
      return resolvePersonaLanding(undefined);
    }
  }

  return redirectTo;
}
