import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const WCAG_21_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const GALLERY = '[data-legal-director-dashboard-gallery]';
const WORKFORCE_GALLERY = '[data-workforce-team-gallery]';
const VIEWPORTS = [1440, 1024, 768, 375] as const;
const LOCALES = [
  { locale: 'en', direction: 'ltr' },
  { locale: 'ar', direction: 'rtl' },
] as const;

test.describe('Legal Director Step 5 full-page gallery', () => {
  test.setTimeout(600_000);

  test('has correct locale direction anchors and no serious or critical WCAG 2.1 A/AA violations', async ({
    page,
  }) => {
    await page.goto('/ui-gallery', { waitUntil: 'networkidle' });
    const gallery = page.locator(GALLERY);
    await expect(gallery).toBeVisible();
    await expect(page.locator(WORKFORCE_GALLERY)).toBeVisible();

    for (const { locale, direction } of LOCALES) {
      const anchor = page.locator(`#legal-director-dashboard-${locale}-ready`);
      await expect(anchor).toBeVisible();
      await expect(anchor.locator('[data-legal-director-dashboard-view]')).toHaveAttribute(
        'dir',
        direction,
      );
      await expect(anchor.locator(`xpath=ancestor::*[@lang='${locale}'][1]`)).toHaveAttribute(
        'dir',
        direction,
      );

      const workforceAnchor = page.locator(`#workforce-team-${locale}-populated`);
      await expect(workforceAnchor).toBeVisible();
      await expect(
        workforceAnchor.locator(`xpath=ancestor::*[@lang='${locale}'][1]`),
      ).toHaveAttribute('dir', direction);
    }

    const results = await new AxeBuilder({ page })
      .include(GALLERY)
      .include(WORKFORCE_GALLERY)
      .withTags(WCAG_21_AA)
      .analyze();
    const serious = results.violations.filter(
      (violation) =>
        violation.impact === 'serious' || violation.impact === 'critical',
    );

    expect(serious).toEqual([]);
  });

  test('captures the ready composition at approved responsive widths in both locales', async ({
    page,
  }, testInfo) => {
    for (const { locale, direction } of LOCALES) {
      for (const width of VIEWPORTS) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`/ui-gallery#legal-director-dashboard-${locale}-ready`, {
          waitUntil: 'domcontentloaded',
        });

        const anchor = page.locator(`#legal-director-dashboard-${locale}-ready`);
        const dashboard = anchor.locator('[data-legal-director-dashboard-view]');
        await expect(anchor).toBeVisible();
        await expect(dashboard).toHaveAttribute('dir', direction);
        expect(
          await dashboard.evaluate(
            (element) => element.scrollWidth <= element.clientWidth,
          ),
        ).toBe(true);

        const donutLayout = await dashboard
          .locator('[data-service-request-donut]')
          .evaluate((element) => {
            const chart = element.querySelector('svg');
            const rows = Array.from(element.querySelectorAll('li'));

            return {
              chartWidth: chart?.getBoundingClientRect().width ?? 0,
              maxLegendRowHeight: Math.max(
                0,
                ...rows.map((row) => row.getBoundingClientRect().height),
              ),
            };
          });
        expect(donutLayout.chartWidth).toBeGreaterThanOrEqual(150);
        expect(donutLayout.maxLegendRowHeight).toBeLessThanOrEqual(48);
        await anchor.scrollIntoViewIfNeeded();

        await page.screenshot({
          path: testInfo.outputPath(`legal-director-dashboard-${locale}-${width}.png`),
          animations: 'disabled',
          fullPage: false,
        });
      }
    }
  });
});
