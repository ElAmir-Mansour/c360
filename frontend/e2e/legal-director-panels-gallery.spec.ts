import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const WCAG_21_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

test('Legal Director Step 4 gallery has no serious or critical axe violations', async ({
  page,
}) => {
  await page.goto('/ui-gallery', { waitUntil: 'domcontentloaded' });
  const gallery = page.locator('[data-legal-director-panels-gallery]');
  await expect(gallery).toBeVisible();

  const results = await new AxeBuilder({ page })
    .include('[data-legal-director-panels-gallery]')
    .withTags(WCAG_21_AA)
    .analyze();
  const serious = results.violations.filter(
    (violation) =>
      violation.impact === 'serious' || violation.impact === 'critical',
  );

  expect(serious).toEqual([]);
});
