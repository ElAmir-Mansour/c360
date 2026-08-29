import { test, expect } from '@playwright/test';

/* ==================================================================
 *  Watheeq legal suite — Consultations & Investigations smoke (authenticated).
 *
 *  Demo-prep guard for the two Lex list surfaces:
 *    - /lex/consultations
 *    - /lex/investigations
 *
 *  Both pages render inside <LexRouteGuard> (redirects denied/unauth users to
 *  /dashboard) and <LexListShell> → <PageHeader> (the page title is an <h1>).
 *  The seeded demo user (admin@clario.dev, super-admin `["*"]`) satisfies the
 *  `lex:consultation:view` / `lex:investigation:view` requirements via wildcard,
 *  so a healthy page must:
 *    - NOT bounce to /login (or get pushed off its own route by the guard),
 *    - NOT show the shared route error boundary (role="alert" — "Couldn't load"
 *      / "Something went wrong"),
 *    - expose a real top-level heading (the h1 landmark), and
 *    - stamp a direction (dir) on <html> so RTL/LTR is applied.
 *
 *  Modelled on e2e/ux-10-verify.spec.ts + e2e/dashboard.spec.ts (chromium project
 *  with the authenticated storageState from global-setup; baseURL :3000).
 * ================================================================== */

const ROUTES = [
  { path: '/lex/consultations', name: 'Consultations' },
  {
    path: '/lex/consultations/archive',
    name: 'Legal Consultations Archive',
  },
  { path: '/lex/investigations', name: 'Investigations' },
] as const;

for (const route of ROUTES) {
  test(`${route.path} — loads, authenticated, has heading, no error boundary`, async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(`pageerror: ${e.message}`));

    await page.goto(route.path, { waitUntil: 'commit' });
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => undefined);

    // --- Not kicked out to the login page (session/storageState is honoured). ---
    await expect(page, 'redirected to /login — session not honoured').not.toHaveURL(/\/login/);

    // --- The route guard did NOT bounce us off this page (e.g. to /dashboard). ---
    await expect(page, `guard redirected away from ${route.path}`).toHaveURL(
      new RegExp(`${route.path}(\\?|/|$)`),
    );

    // --- The shared route error boundary must not be showing. ---
    await expect(
      page.getByText(/Something went wrong|Couldn.t load/i).first(),
      `route error boundary visible on ${route.path}`,
    ).toBeHidden();

    // --- A real top-level heading landmark is visible (the PageHeader <h1>). ---
    await expect(
      page.getByRole('heading', { level: 1 }).first(),
      `no visible h1 on ${route.path}`,
    ).toBeVisible({ timeout: 20_000 });

    // --- <html> carries a direction (RTL/LTR applied). ---
    const dir = await page.locator('html').getAttribute('dir');
    expect(dir, `<html> has no dir attribute on ${route.path}`).toBeTruthy();

    // --- No uncaught runtime crash while rendering. ---
    expect(
      pageErrors,
      `uncaught page errors on ${route.path}:\n${pageErrors.join('\n')}`,
    ).toEqual([]);
  });
}
