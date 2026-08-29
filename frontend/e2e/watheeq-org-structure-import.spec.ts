import { expect, test, type Download, type Locator, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function downloadFromRow(page: Page, row: Locator, format: 'XLSX' | 'CSV' | 'JSON'): Promise<Download> {
  const downloadPromise = page.waitForEvent('download');
  await row.getByRole('button', { name: format, exact: true }).click();
  return downloadPromise;
}

test.describe('Watheeq organizational structure onboarding', () => {
  test('downloads templates and dry-runs the filled XLSX through the browser UI', async ({ page }) => {
    await page.goto('/lex/admin/org-entities', { waitUntil: 'domcontentloaded' });

    await expect(page).not.toHaveURL(/\/login/);
    const importButton = page.getByRole('button', { name: 'Import structure' });
    await expect(importButton).toBeVisible({ timeout: 30_000 });
    await importButton.click();
    const dialog = page.getByRole('dialog', { name: 'Upload organizational structure' });
    await expect(dialog).toBeVisible();

    const blankRow = dialog.getByText('Blank template', { exact: true }).locator('..');
    const sampleRow = dialog.getByText('Simple filled sample', { exact: true }).locator('..');

    const blankCSV = await downloadFromRow(page, blankRow, 'CSV');
    expect(blankCSV.suggestedFilename()).toBe('watheeq-org-structure-template.csv');
    expect(await blankCSV.path()).toBeTruthy();

    const sampleJSON = await downloadFromRow(page, sampleRow, 'JSON');
    expect(sampleJSON.suggestedFilename()).toBe('watheeq-org-structure-filled-sample.json');
    expect(await sampleJSON.path()).toBeTruthy();

    const sampleXLSX = await downloadFromRow(page, sampleRow, 'XLSX');
    expect(sampleXLSX.suggestedFilename()).toBe('watheeq-org-structure-filled-sample.xlsx');
    const xlsxPath = await sampleXLSX.path();
    expect(xlsxPath).toBeTruthy();

    await dialog.locator('input[type="file"]').setInputFiles({
      name: sampleXLSX.suggestedFilename(),
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: await readFile(xlsxPath!),
    });
    await expect(dialog.getByText('5 rows', { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Run dry-run' }).click();

    await expect(page.getByText('Validation result')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/^Validated$/).first()).toBeVisible();
    await expect(page.getByText('All rows passed server validation. No changes were made during this dry-run.')).toBeVisible();
    await expect(page.getByText('5', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('watheeq-org-structure-filled-sample.xlsx', { exact: true }).first()).toBeVisible();

    // A preview must never mutate until the explicit atomic apply action.
    await expect(page.getByRole('button', { name: 'Apply import atomically' })).toBeEnabled();
  });
});
