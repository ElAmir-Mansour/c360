import { test, expect } from '@playwright/test';

// The live Next.js development host compiles these large authenticated routes
// on demand. Keep the assertion timeouts strict, but allow the first navigation
// enough time to complete a cold compile.
test.setTimeout(180_000);

/* ==================================================================
 *  Watheeq (Clario360 `lex`) — Legal Service Desk, Requests & Intake.
 *
 *  Demo-prep smoke for the two business-module routes:
 *    - /lex/service-desk  (Legal Service Desk — requests list/board)
 *    - /lex/inbox         ("Awaiting me" cross-domain approvals queue)
 *
 *  Authenticated via the storageState loaded by the configured `chromium`
 *  project (see playwright.config.ts / global-setup.ts). For each route this
 *  asserts the page:
 *    - did NOT bounce to /login (session survived) — and the Lex route guard
 *      did not deny us to /dashboard,
 *    - shows no error-boundary / crash text,
 *    - renders its real top-level <h1> (PageHeader heading), and
 *    - stamps a direction on <html> (rtl by default — the app defaults to
 *      Arabic — or ltr).
 * ================================================================== */

const ROUTES = [
  { path: '/lex/service-desk', name: 'Legal Service Desk' },
  { path: '/lex/inbox', name: 'Approvals Inbox (Awaiting me)' },
];

const ERROR_BOUNDARY = /Something went wrong|Application error|Internal Server Error|\b500\b/i;

for (const route of ROUTES) {
  test(`${route.path} — ${route.name}: loads authenticated, no crash, has h1`, async ({ page }) => {
    await page.goto(route.path, { waitUntil: 'commit' });
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => undefined);

    // 1. Session survived — not redirected to the login page, and the Lex route
    //    guard did not deny us (which would replace() to /dashboard).
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page).toHaveURL(new RegExp(`${route.path}(?:[/?#]|$)`));

    // 2. No error boundary / crash surface is visible on the page.
    await expect(page.getByText(ERROR_BOUNDARY).first()).toHaveCount(0);

    // 3. The real page's top-level heading (PageHeader <h1>) is visible. This is
    //    locale-agnostic — the title text is bilingual (Arabic by default) so we
    //    assert the landmark, not a specific string. Its presence also proves the
    //    route guard allowed the page body to render (denied → renders null).
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({
      timeout: 15_000,
    });

    // 4. A document direction is stamped on <html> (rtl or ltr).
    const dir = await page.evaluate(() => document.documentElement.getAttribute('dir'));
    expect(dir, `<html dir> should be present on ${route.path}`).toMatch(/^(rtl|ltr)$/);
  });
}
