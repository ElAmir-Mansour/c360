import { expect, test } from '@playwright/test';

test('References page exposes the Clause Library destination', async ({ page }) => {
  await page.goto('/lex/library?page=1', { waitUntil: 'commit' });
  await expect(page).not.toHaveURL(/\/login(?:[/?#]|$)/);

  const clauseLibraryLink = page.getByRole('link', {
    name: 'Clause Library',
    exact: true,
  });
  await expect(clauseLibraryLink).toBeVisible({ timeout: 60_000 });
  await expect(clauseLibraryLink).toHaveAttribute('href', '/lex/clause-library');

  await clauseLibraryLink.click();
  await expect(page).toHaveURL(/\/lex\/clause-library(?:[/?#]|$)/, {
    timeout: 60_000,
  });
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({
    timeout: 60_000,
  });
});

test('Reference Library KPIs open their contributing documents', async ({
  page,
}) => {
  await page.goto('/lex/library?page=1', { waitUntil: 'commit' });
  await expect(page).not.toHaveURL(/\/login(?:[/?#]|$)/);

  const totalDocuments = page.getByRole('button', {
    name: /Total Documents/i,
  });
  await expect(totalDocuments).toBeVisible({ timeout: 60_000 });
  await totalDocuments.click();

  await expect(
    page.getByRole('heading', { name: 'Total Documents', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/\d+ documents?/i),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: /Open .+/i }).first(),
  ).toBeVisible();
});

test('Reference Library authority and topic KPIs drill through groups to documents', async ({
  page,
}) => {
  await page.goto('/lex/library?page=1', { waitUntil: 'commit' });

  for (const kpi of ['Issuing bodies', 'Topics']) {
    await page
      .getByRole('button', { name: new RegExp(`^${kpi}\\s+\\d+`, 'i') })
      .click();
    const dialog = page.getByRole('dialog', { name: kpi });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/\d+ contributing groups?/i)).toBeVisible();

    await dialog.getByRole('button').first().click();
    await expect(
      dialog.getByRole('button', { name: 'All groups' }),
    ).toBeVisible();
    await expect(
      dialog.getByRole('button', { name: /Open .+/i }).first(),
    ).toBeVisible();

    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toBeHidden();
  }
});
