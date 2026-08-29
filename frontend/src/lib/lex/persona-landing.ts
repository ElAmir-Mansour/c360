/**
 * Persona-aware landing resolution (§6 "Post-Login Routing").
 *
 * The backend returns a `persona_landing` per active role (e.g.
 * `/lex/command-center`, `/lex/my-work`, `/lex/oversight`). Several of those
 * design routes do NOT yet exist as pages in this app (only `/lex` and the
 * concrete domain routes do). Routing a user to a non-existent route would 404,
 * which §6 explicitly forbids: "Do NOT 404 — prefer `/lex` (the persona-aware
 * home) as the safe universal landing."
 *
 * `resolvePersonaLanding` therefore returns the backend landing ONLY when it is
 * a known-existing lex route; otherwise it falls back to `/lex`, which is itself
 * persona-aware (see app/(dashboard)/lex/page.tsx). The resolver also honours a
 * caller-supplied `redirectTo` first when present (already validated by the auth
 * flow), per §6 step 5.
 */

/**
 * The set of lex routes that physically exist as pages today (one entry per
 * `app/(dashboard)/lex/<route>/page.tsx`). Used to validate a backend-supplied
 * `persona_landing` before we navigate to it. `/lex` is always allowed.
 *
 * Kept as an explicit allow-list (not derived) so adding a real page is a
 * deliberate, reviewable change and a stale backend landing can never 404 the
 * user. When a design landing route (e.g. `/lex/command-center`) is later built,
 * add it here to start honouring it.
 */
export const KNOWN_LEX_ROUTES: ReadonlySet<string> = new Set<string>([
  '/lex',
  '/lex/cases',
  '/lex/cases/control',
  '/lex/case-timeline',
  '/lex/matters',
  '/lex/contracts',
  '/lex/contracts/control',
  '/lex/settlements',
  '/lex/service-desk',
  '/lex/investigations',
  '/lex/consultations',
  '/lex/obligations',
  '/lex/signatures',
  '/lex/documents',
  '/lex/clause-library',
  '/lex/playbooks',
  '/lex/regulations',
  '/lex/calendar',
  '/lex/inbox',
  '/lex/tasks',
  '/lex/analytics',
  '/lex/analytics/risk',
  '/lex/entities',
  '/lex/compliance',
  '/lex/drafting',
  '/lex/reports',
  '/lex/workflow-policies',
  '/lex/admin',
  '/lex/notifications',
]);

/** The safe universal landing — `/lex` is persona-aware and always exists. */
export const SAFE_LEX_LANDING = '/lex';

/** Strip any query string / hash so we test the pathname against the allow-list. */
function pathnameOf(target: string): string {
  return target.split(/[?#]/, 1)[0] || '';
}

/** True when `target`'s pathname is a lex page that actually exists in this app. */
export function isKnownLexRoute(target: string | null | undefined): boolean {
  if (typeof target !== 'string' || target.length === 0) return false;
  return KNOWN_LEX_ROUTES.has(pathnameOf(target));
}

/**
 * Resolve where to send a user after login / persona switch.
 *
 * Precedence (§6):
 *   1. `redirectTo` — when present AND a known-existing lex route (the auth flow
 *      has already open-redirect-validated it). A non-lex `redirectTo` is left to
 *      the caller's generic post-auth handling and is NOT returned here.
 *   2. the backend `persona_landing` — when it is a known-existing lex route.
 *   3. `/lex` — the safe, persona-aware universal landing (never 404s).
 */
export function resolvePersonaLanding(
  personaLanding: string | null | undefined,
  redirectTo?: string | null,
): string {
  if (redirectTo && isKnownLexRoute(redirectTo)) {
    return redirectTo;
  }
  if (isKnownLexRoute(personaLanding)) {
    return personaLanding as string;
  }
  return SAFE_LEX_LANDING;
}
