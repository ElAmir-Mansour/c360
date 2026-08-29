import { test, expect } from '@playwright/test';

/* ==================================================================
 *  Watheeq (Clario360 `lex`) — Settlements, Matters & Obligations.
 *
 *  Demo-prep smoke for the three legal-work module routes:
 *    - /lex/settlements  (Settlements register — negotiation → executed)
 *    - /lex/matters      (Cross-domain legal matters — intake/triage/board)
 *    - /lex/obligations  (Contract obligations — reminders/escalation/calendar)
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
  { path: '/lex/settlements', name: 'Settlements Register' },
  { path: '/lex/matters', name: 'Legal Matters' },
  { path: '/lex/obligations', name: 'Contract Obligations' },
];

const ERROR_BOUNDARY = /Something went wrong|Application error|Internal Server Error/i;

for (const route of ROUTES) {
  test(`${route.path} — ${route.name}: loads authenticated, no crash, has h1`, async ({ page }) => {
    await page.goto(route.path, { waitUntil: 'commit' });
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => undefined);

    // 1. Session survived — not redirected to the login page, and the Lex route
    //    guard did not deny us (which would replace() to /dashboard).
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page).toHaveURL(new RegExp(`${route.path}(?:[/?#]|$)`));

    // 2. No error boundary / crash surface is visible on the page.
    const routeError = page
      .getByRole('alert')
      .filter({ hasText: ERROR_BOUNDARY });
    await expect(routeError).toHaveCount(0);

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
