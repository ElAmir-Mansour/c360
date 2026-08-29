import { test, expect } from '@playwright/test';

/* ==================================================================
 *  Watheeq (Clario360 `lex`) — Contracts & Contract Lifecycle (CLM)
 *  demo-readiness smoke (authenticated).
 *
 *  Modelled on e2e/ux-10-verify.spec.ts + e2e/dashboard.spec.ts:
 *  runs against baseURL http://localhost:3000 with the shared
 *  authenticated storageState (see e2e/global-setup.ts).
 *
 *  For each core CLM route it asserts the page is demo-safe:
 *    - the app did NOT bounce us to /login (session is honoured),
 *    - the LexRouteGuard did NOT deny access and redirect to
 *      /dashboard (the signed-in super-admin can reach the module),
 *    - no route-level error boundary rendered (role="alert" with the
 *      "Something went wrong" / "Couldn’t load …" copy),
 *    - a real top-level heading (h1) inside a <header> landmark is
 *      visible (content mounted, not just a loading skeleton),
 *    - the <html> element carries a `dir` attribute (RTL/LTR ready).
 * ================================================================== */

interface LexRoute {
  path: string;
  /** A substring expected in the page's <h1> once content mounts. */
  heading: RegExp;
}

const ROUTES: LexRoute[] = [
  { path: '/lex/contracts', heading: /contract/i },
  { path: '/lex/contracts/archived', heading: /archiv/i },
  { path: '/lex/drafting', heading: /draft/i },
  { path: '/lex/clause-library', heading: /clause/i },
  { path: '/lex/playbooks', heading: /playbook/i },
];

for (const route of ROUTES) {
  test(`${route.path} — reachable, no error boundary, heading + dir present`, async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(`pageerror: ${e.message}`));

    await page.goto(route.path, { waitUntil: 'commit' });
    // Best-effort settle; some Lex pages keep websockets/polling open so
    // networkidle can legitimately never fire — never let that fail the test.
    await page
      .waitForLoadState('networkidle', { timeout: 6000 })
      .catch(() => undefined);

    // 1. Session honoured: we were NOT redirected to the login screen.
    expect(page.url(), `redirected to /login from ${route.path}`).not.toContain('/login');

    // 2. Access granted: the LexRouteGuard did not deny + bounce to /dashboard.
    //    (admin@clario.dev is super-admin, so the CLM routes must resolve.)
    await expect
      .poll(() => new URL(page.url()).pathname, {
        message: `access denied — bounced off ${route.path}`,
        timeout: 8000,
      })
      .toContain('/lex');

    // 3. No route-level error boundary (src/components/common/route-error.tsx).
    const errorBoundary = page
      .getByRole('alert')
      .filter({ hasText: /Something went wrong|Couldn’t load|Couldn't load/i });
    await expect(
      errorBoundary,
      `error boundary rendered on ${route.path}`,
    ).toHaveCount(0);

    // 4. A real, visible top-level heading (content mounted past the guard's
    //    loading skeleton). PageHeader renders the h1 inside a <header> landmark.
    const h1 = page.locator('h1').first();
    await expect(h1, `no visible h1 on ${route.path}`).toBeVisible({ timeout: 15_000 });
    await expect(h1, `unexpected h1 copy on ${route.path}`).toHaveText(route.heading);

    // The <header> landmark that wraps the page title should also be present.
    await expect(
      page.locator('header').first(),
      `no header landmark on ${route.path}`,
    ).toBeVisible();

    // 5. Localization-ready: <html dir="…"> is set (ltr or rtl).
    const dir = await page.locator('html').getAttribute('dir');
    expect(dir, `<html> missing dir attribute on ${route.path}`).toMatch(/^(ltr|rtl)$/);

    // 6. No uncaught runtime exceptions while rendering the route.
    expect(
      pageErrors,
      `uncaught page errors on ${route.path}:\n${pageErrors.join('\n')}`,
    ).toEqual([]);
  });
}
