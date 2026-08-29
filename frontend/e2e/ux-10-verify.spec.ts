import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/* ==================================================================
 *  UX 10/10 verification (authenticated).
 *  Confirms the assessment's biggest issues are resolved:
 *    - /platform no longer throws (toLowerCase on undefined) and renders an h1
 *    - key routes have no console/page errors and pass axe (serious/critical)
 *    - no horizontal overflow at mobile width
 * ================================================================== */

const ROUTES = [
  '/platform',
  '/dashboard',
  '/lex',
  '/lex/admin/integrations',
  '/admin/billing',
  '/data',
  '/cyber',
];

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

for (const route of ROUTES) {
  test(`${route} — no fatal errors, has h1, axe-clean`, async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

    await page.goto(route, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => undefined);
    // Let loading skeletons clear so axe scans the settled page.
    await page
      .waitForFunction(() => !document.querySelector('[aria-busy="true"]'), undefined, {
        timeout: 8000,
      })
      .catch(() => undefined);
    await page.waitForTimeout(300);

    // No runtime crash (the /platform toLowerCase regression class).
    const fatal = errors.filter((e) =>
      /toLowerCase|Cannot read properties of undefined|Unhandled|pageerror|is not a function/i.test(e),
    );
    expect(fatal, `fatal console/page errors on ${route}:\n${errors.join('\n')}`).toEqual([]);

    // A visible top-level heading (the "no visible h1" regression).
    await expect(page.locator('h1').first()).toBeVisible();

    // Accessibility: no serious/critical axe violations.
    const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    const serious = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(
      serious,
      `axe serious/critical on ${route}:\n${serious.map((v) => `- ${v.id}: ${v.help} (${v.nodes.length})`).join('\n')}`,
    ).toEqual([]);
  });
}

test('/platform — no horizontal overflow at 375px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/platform', { waitUntil: 'networkidle' });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(overflow, 'horizontal overflow at 375px on /platform').toBe(false);
});
