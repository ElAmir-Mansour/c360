import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/* ================================================================== */
/*  Accessibility gate (WCAG 2.1 A/AA)                                 */
/*  Runs axe-core against public pages that need no authentication.    */
/*  Catches contrast, labelling, landmark and ARIA regressions in the  */
/*  shared design system before they reach authenticated surfaces.     */
/* ================================================================== */

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function analyze(page: import('@playwright/test').Page) {
  return new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
}

test.describe('Accessibility — public pages', () => {
  test('login page has no serious/critical violations', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');
    const results = await analyze(page);
    const serious = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(
      serious,
      `Accessibility violations:\n${serious.map((v) => `- ${v.id}: ${v.help}`).join('\n')}`,
    ).toEqual([]);
  });

  test('not-found page has no serious/critical violations', async ({ page }) => {
    await page.goto('/this-route-does-not-exist');
    await page.waitForLoadState('networkidle');
    const results = await analyze(page);
    const serious = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(
      serious,
      `Accessibility violations:\n${serious.map((v) => `- ${v.id}: ${v.help}`).join('\n')}`,
    ).toEqual([]);
  });
});
