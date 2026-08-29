import { expect, test, type Locator, type Page } from '@playwright/test';

const PALETTE = {
  '--lex-landing-primary': '#005E5E',
  '--lex-landing-dark-teal': '#06352F',
  '--lex-landing-accent': '#ABB705',
  '--lex-landing-spring-teal': '#0DA7A8',
  '--lex-landing-canvas': '#FDFFF6',
  '--lex-landing-tint': '#D1D8D5',
  '--lex-landing-border': '#D1D8D5',
  '--lex-landing-ink': '#06352F',
  '--lex-landing-muted': '#6C7874',
} as const;

async function openLanding(page: Page): Promise<Locator> {
  await page.goto('/lex', { waitUntil: 'commit' });
  await expect(page).not.toHaveURL(/\/login(?:[/?#]|$)/);
  const root = page.locator('[data-lex-landing-theme="watheeq"]');
  await expect(root).toBeVisible({ timeout: 60_000 });
  await expect(root.getByRole('heading', { level: 1 })).toBeVisible();
  return root;
}

test.describe('Watheeq landing brand contract', () => {
  test('groups related daily-work destinations in the top navigation', async ({
    page,
  }) => {
    // Regression: the full English wordmark previously consumed enough room
    // to clip the last daily-work trigger behind the pinned Governance menu.
    await page.setViewportSize({ width: 1792, height: 1000 });
    await openLanding(page);
    const nav = page.locator('.lex-top-nav');

    await nav
      .getByRole('button', { name: 'Contracts and Consultations' })
      .click();
    const contractsMenu = page.getByRole('menu');
    await expect(
      contractsMenu.getByRole('menuitem', { name: 'Contracts', exact: true }),
    ).toHaveAttribute('href', '/lex/contracts');
    await expect(
      contractsMenu.getByRole('menuitem', {
        name: 'Consultations',
        exact: true,
      }),
    ).toHaveAttribute('href', '/lex/consultations');
    await expect(
      contractsMenu.getByRole('menuitem', { name: 'AI Drafting', exact: true }),
    ).toHaveAttribute('href', '/lex/drafting');
    await page.keyboard.press('Escape');

    await nav.getByRole('button', { name: 'Cases and Investigations' }).click();
    const casesMenu = page.getByRole('menu');
    await expect(
      casesMenu.getByRole('menuitem', { name: 'Cases', exact: true }),
    ).toHaveAttribute('href', '/lex/cases');
    await expect(
      casesMenu.getByRole('menuitem', { name: 'Investigations', exact: true }),
    ).toHaveAttribute('href', '/lex/investigations');
    await page.keyboard.press('Escape');

    const referencesTrigger = nav.getByRole('button', {
      name: 'References and Library',
    });
    await expect(referencesTrigger).toBeInViewport({ ratio: 1 });
    await referencesTrigger.click();
    const referencesMenu = page.getByRole('menu');
    await expect(
      referencesMenu.getByRole('menuitem', { name: 'References', exact: true }),
    ).toHaveAttribute('href', '/lex/library');
    await expect(
      referencesMenu.getByRole('menuitem', {
        name: 'Clause Library',
        exact: true,
      }),
    ).toHaveAttribute('href', '/lex/clause-library');
    await expect(
      referencesMenu.getByRole('menuitem', {
        name: 'Documents & Attachments',
        exact: true,
      }),
    ).toHaveAttribute('href', '/lex/documents');
  });

  test('resolves the approved palette in the rendered English landing', async ({
    page,
  }) => {
    const root = await openLanding(page);

    const computed = await root.evaluate((element, names) => {
      const style = getComputedStyle(element);
      return {
        tokens: Object.fromEntries(
          names.map((name) => [name, style.getPropertyValue(name).trim()]),
        ),
        backgroundColor: style.backgroundColor,
        color: style.color,
      };
    }, Object.keys(PALETTE));

    expect(computed.tokens).toEqual(PALETTE);
    expect(computed.backgroundColor).toBe('rgb(253, 255, 246)');
    expect(computed.color).toBe('rgb(6, 53, 47)');

    const nav = page.locator('.lex-top-nav');
    await expect(nav).toBeVisible();
    expect(
      await nav.evaluate(
        (element) => getComputedStyle(element).backgroundColor,
      ),
    ).toBe('rgb(0, 94, 94)');

    const header = page.getByRole('banner');
    expect(
      await header.evaluate(
        (element) => getComputedStyle(element).backgroundColor,
      ),
    ).toBe('rgb(0, 94, 94)');

    const bodyFont = await page
      .locator('body')
      .evaluate((element) => getComputedStyle(element).fontFamily);
    expect(bodyFont).toContain('DIN Next LT Pro');
  });

  test('uses the DIN Arabic stack and RTL geometry in Arabic', async ({
    page,
    baseURL,
  }) => {
    const origin = new URL(baseURL ?? 'http://localhost:3002');
    await page.context().addCookies([
      {
        name: 'clario360_locale',
        value: 'ar',
        domain: origin.hostname,
        path: '/',
        sameSite: 'Lax',
      },
    ]);

    const root = await openLanding(page);
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

    const bodyFont = await page
      .locator('body')
      .evaluate((element) => getComputedStyle(element).fontFamily);
    expect(bodyFont).toContain('DIN Next LT Arabic');

    const heading = root.getByRole('heading', { level: 1 });
    const headingStyle = await heading.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        direction: style.direction,
        letterSpacing: style.letterSpacing,
        textAlign: style.textAlign,
      };
    });
    expect(headingStyle).toEqual({
      direction: 'rtl',
      letterSpacing: 'normal',
      textAlign: 'start',
    });
  });
});
