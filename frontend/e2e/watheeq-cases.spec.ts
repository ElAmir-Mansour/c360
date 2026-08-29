import { test, expect, type Page } from '@playwright/test';

/* ==================================================================
 *  Watheeq (Clario360 `lex`) — Legal Cases & Litigation demo smoke.
 *
 *  Authenticated (storageState) coverage for the heaviest legal flow:
 *  the litigation case LIST (/lex/cases) and the standalone case-timeline
 *  workspace (/lex/case-timeline), plus an opportunistic list -> detail
 *  navigation when demo data exists.
 *
 *  Each route is asserted to:
 *    - render, not bounce to /login, and not get replaced to /dashboard by
 *      the LexRouteGuard (an access denial replaces() to /dashboard);
 *    - show a real top-level <h1> heading (the PageHeader landmark) — the app
 *      defaults to Arabic, so we assert the landmark, never exact text;
 *    - NOT render the App Router error boundary (RouteError "Couldn't load Lex");
 *    - carry a document text-direction (dir) attribute (RTL/LTR-aware shell);
 *    - throw no fatal runtime errors.
 *
 *  Modeled on e2e/ux-10-verify.spec.ts and e2e/dashboard.spec.ts.
 * ================================================================== */

const ROUTES = ['/lex/cases', '/lex/case-timeline'] as const;

// The runtime-crash class the UX assessment cares about (mirrors ux-10-verify).
const FATAL = /toLowerCase|Cannot read propert|Unhandled|is not a function|pageerror/i;

/** The App Router error boundary body (RouteError) renders "Couldn't load Lex". */
async function expectNoErrorBoundary(page: Page): Promise<void> {
  await expect(page.getByText(/Couldn.t load/i)).toHaveCount(0);
}

for (const route of ROUTES) {
  test(`${route} — renders authenticated, no error boundary`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

    await page.goto(route, { waitUntil: 'commit' });

    // The LexRouteGuard shows a loading skeleton until the session hydrates,
    // then swaps in the page body whose PageHeader renders an <h1>.
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({
      timeout: 20_000,
    });

    // Auth is present via storageState, so we are not bounced to /login.
    await expect(page).not.toHaveURL(/\/login(\?|\/|$)/);
    // Still on the requested lex route — the guard would router.replace()
    // to /dashboard on an access denial.
    expect(new URL(page.url()).pathname).toBe(route);

    // No error boundary rendered for this lex segment.
    await expectNoErrorBoundary(page);

    // RTL/LTR-aware shell: the root <html> carries a direction attribute.
    const dir = await page.locator('html').getAttribute('dir');
    expect(dir).toMatch(/^(rtl|ltr)$/);

    // No fatal runtime crash on this route.
    const fatal = errors.filter((e) => FATAL.test(e));
    expect(fatal, `fatal errors on ${route}:\n${errors.join('\n')}`).toEqual([]);
  });
}

test('/lex/cases — opens a case detail from the list when demo data exists', async ({
  page,
}) => {
  await page.goto('/lex/cases', { waitUntil: 'commit' });
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({
    timeout: 20_000,
  });

  // Let the paginated cases table fetch its first page.
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => undefined);

  // Row title links point at /lex/cases/<uuid>; the header "classifications"
  // link (also under /lex/cases/) is deliberately excluded.
  const hrefs = await page
    .locator('a[href^="/lex/cases/"]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('href') ?? ''));
  const detailHref = hrefs.find(
    (h) => /^\/lex\/cases\/[0-9a-fA-F-]{8,}/.test(h) && !h.includes('classifications'),
  );

  // Data-dependent: skip cleanly (not fail) when the list is empty.
  test.skip(!detailHref, 'no seeded litigation cases to open (list is empty)');

  await page.locator(`a[href="${detailHref}"]`).first().click();

  const escaped = detailHref!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Generous timeout: in dev mode the first hit to /lex/cases/[id] compiles the
  // route (10–20s), so allow the client-side navigation time to settle.
  await expect(page).toHaveURL(new RegExp(escaped), { timeout: 25_000 });

  // The case detail page renders its own PageHeader <h1> and must not fault.
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({
    timeout: 20_000,
  });
  await expectNoErrorBoundary(page);
});
