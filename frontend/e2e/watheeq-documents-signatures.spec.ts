import { test, expect } from '@playwright/test';

/* ==================================================================
 *  Watheeq legal suite (lex) — demo-readiness smoke.
 *
 *  Module coverage: DOCUMENTS, E-SIGNATURE, CALENDAR, NOTIFICATIONS,
 *  COMPLIANCE, REGULATIONS, ENTITIES.
 *
 *  Runs authenticated (chromium project storageState). For each route:
 *    - it navigates and is NOT bounced to /login (auth session honored)
 *      nor redirected off the route by the lex route-guard (denied →
 *      /dashboard);
 *    - no Next.js error boundary (route-error.tsx) is rendered;
 *    - a real top-level <h1> heading is visible (every lex page renders
 *      one via PageHeader / LexListShell);
 *    - the document carries a `dir` attribute (root <html> is stamped
 *      lang+dir by the Arabic-first locale layout);
 *    - no fatal console/page runtime crash fires.
 *
 *  Modeled on e2e/ux-10-verify.spec.ts (data-driven route loop, console
 *  error capture) and e2e/dashboard.spec.ts (heading assertions).
 * ================================================================== */

const ROUTES = [
  '/lex/documents',
  '/lex/signatures',
  '/lex/calendar',
  '/lex/notifications',
  '/lex/compliance',
  '/lex/regulations',
  '/lex/entities',
] as const;

// Copy rendered by the shared error boundary (components/common/route-error.tsx).
const ERROR_BOUNDARY_COPY = /Something went wrong|Couldn.?t load|Application error/i;

for (const route of ROUTES) {
  test(`${route} — authenticated, no error boundary, heading + dir`, async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

    await page.goto(route, { waitUntil: 'commit' });
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => undefined);
    // Let the route-guard "deciding" null-render and any loading skeletons settle
    // before asserting, so we scan the resolved page.
    await page
      .waitForFunction(() => !document.querySelector('[aria-busy="true"]'), undefined, {
        timeout: 8000,
      })
      .catch(() => undefined);
    await page.waitForTimeout(300);

    // 1) Auth session honored (not bounced to /login) AND the lex route-guard did
    //    not redirect a denied user to /dashboard — the URL stays on the route.
    const { pathname } = new URL(page.url());
    expect(pathname, `unexpectedly redirected to login from ${route}`).not.toContain('/login');
    expect(pathname, `route guard redirected ${route} → ${pathname}`).toContain(route);

    // 2) No Next.js error boundary rendered.
    await expect(
      page.getByText(ERROR_BOUNDARY_COPY),
      `error boundary visible on ${route}`,
    ).toHaveCount(0);

    // 3) A real top-level heading is visible.
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({ timeout: 15_000 });

    // 4) The document carries a dir attribute (root <html dir> from the locale layout).
    const dir = await page.evaluate(() => document.documentElement.getAttribute('dir'));
    expect(dir, `<html dir> missing on ${route}`).toBeTruthy();

    // 5) No fatal runtime crash (the regression class ux-10-verify guards against).
    const fatal = errors.filter((e) =>
      /Cannot read properties of undefined|is not a function|Unhandled|pageerror/i.test(e),
    );
    expect(fatal, `fatal console/page errors on ${route}:\n${errors.join('\n')}`).toEqual([]);
  });
}
