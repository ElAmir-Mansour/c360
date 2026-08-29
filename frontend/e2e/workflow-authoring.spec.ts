import { test, expect, type Page } from '@playwright/test';

/**
 * Work-stream 3 of the Workflow Module design: prove the create -> publish ->
 * start -> complete flow works with ZERO designer edits.
 *
 * Root cause this guards against: the "Create" button used to seed a 1-step
 * (end-only) definition while publish requires >= 2 steps, so Publish failed
 * instantly. Create now seeds a publishable default (a "Start" human_task that
 * transitions to an end step), so a brand-new definition publishes as-is.
 */

const DEFINITIONS_URL = '/admin/workflows/definitions';

/** Create a fresh definition from the list page and return its id. The Create
 *  button seeds the publishable default and redirects to the designer, whose
 *  URL carries the new definition id. */
async function createDefaultDefinition(page: Page): Promise<string> {
  await page.goto(DEFINITIONS_URL);
  await expect(page.getByRole('heading', { name: /Workflow Definitions/i })).toBeVisible({
    timeout: 20_000,
  });

  await page.getByRole('button', { name: /Create Definition/i }).click();

  // The new definition opens in the designer: /admin/workflows/definitions/{id}/designer
  await page.waitForURL(/\/admin\/workflows\/definitions\/[^/]+\/designer/, {
    timeout: 20_000,
  });
  const match = page.url().match(/\/definitions\/([^/]+)\/designer/);
  expect(match, 'designer URL should carry the new definition id').toBeTruthy();
  return match![1];
}

test.describe('Workflow authoring — create / publish / start / complete', () => {
  test('version browser survives detail-to-designer cache reuse', async ({
    page,
  }) => {
    const defId = await createDefaultDefinition(page);
    const runtimeErrors: string[] = [];
    let versionsRequests = 0;

    page.on('pageerror', (error) => runtimeErrors.push(error.message));
    page.on('console', (message) => {
      if (
        message.type() === 'error' &&
        /not iterable|\[route-error\]|Minified React error #185/i.test(
          message.text(),
        )
      ) {
        runtimeErrors.push(message.text());
      }
    });

    // The fallback is what exposed the cache-shape collision in production.
    // Force lineage to be unavailable and keep the version response stable so
    // this test exercises detail -> client-side Edit -> designer with one cache.
    await page.route(
      `**/api/v1/workflows/definitions/${defId}/lineage`,
      (route) =>
        route.fulfill({
          status: 501,
          contentType: 'application/json',
          body: JSON.stringify({
            code: 'NOT_IMPLEMENTED',
            message: 'lineage unavailable in this test',
          }),
        }),
    );
    await page.route(
      `**/api/v1/workflows/definitions/${defId}/versions`,
      (route) => {
        versionsRequests += 1;
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            versions: [
              {
                id: defId,
                name: 'Cache regression v1',
                version: 1,
                status: 'draft',
              },
            ],
          }),
        });
      },
    );

    const versionsLoaded = page.waitForResponse(
      (response) =>
        response.url().includes(`/definitions/${defId}/versions`) &&
        response.status() === 200,
    );
    await page.goto(`${DEFINITIONS_URL}/${defId}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({
      timeout: 20_000,
    });
    await versionsLoaded;

    // Use the SPA action: a hard navigation would discard React Query's cache
    // and would not reproduce the original navigation-order failure.
    await page.getByRole('button', { name: /^Edit$/i }).click();
    await page.waitForURL(
      new RegExp(`/admin/workflows/definitions/${defId}/designer(?:[/?#]|$)`),
      { timeout: 20_000 },
    );
    await page.getByRole('button', { name: /^Versions$/i }).click();

    const dialog = page.getByRole('dialog');
    await expect(
      dialog.getByRole('heading', { name: /Workflow Versions/i }),
    ).toBeVisible();
    await expect(dialog.getByText('Cache regression v1')).toBeVisible();
    await expect(dialog.getByText(/No versions found/i)).toHaveCount(0);
    expect(versionsRequests).toBe(1);
    expect(runtimeErrors).toEqual([]);
  });

  test('a freshly created definition publishes with zero designer edits, then runs to completion', async ({
    page,
  }) => {
    const defId = await createDefaultDefinition(page);

    // Go to the definition detail page and publish — no designer edits.
    await page.goto(`${DEFINITIONS_URL}/${defId}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 20_000 });

    // It starts as a draft and surfaces the "publish first" hint.
    await expect(page.getByTestId('start-disabled-hint')).toBeVisible();

    await page.getByRole('button', { name: /^Publish$/i }).click();

    // Publish must succeed with zero edits: no validation banner, status active.
    await expect(page.getByTestId('publish-validation-errors')).toHaveCount(0);
    await expect(page.getByText(/^Active$/i).first()).toBeVisible({ timeout: 20_000 });

    // The publish-first hint disappears and Start instance becomes enabled.
    await expect(page.getByTestId('start-disabled-hint')).toHaveCount(0);
    const startButton = page.getByRole('button', { name: /Start instance/i });
    await expect(startButton).toBeEnabled();

    // Start an instance via the dialog (select this definition -> start).
    await startButton.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: /Untitled Workflow/i }).first().click();
    // Step 2: no input variables on the default -> Review -> Start.
    await dialog.getByRole('button', { name: /^Review$/i }).click();
    await dialog.getByRole('button', { name: /^Start Workflow$/i }).click();

    // We land on the instance detail page.
    await page.waitForURL(/\/workflows\/[^/]+$/, { timeout: 20_000 });
    const instanceMatch = page.url().match(/\/workflows\/([^/]+)$/);
    expect(instanceMatch, 'should navigate to the new instance detail page').toBeTruthy();

    // The instance is running and parked on the "Start" human task.
    await expect(page.getByText(/Running/i).first()).toBeVisible({ timeout: 20_000 });

    // Complete the human task to drive the instance to completion. The default
    // task is assigned to the admin role; find it in the admin task inbox.
    await page.goto('/admin/workflows/tasks');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 20_000 });

    const startTaskRow = page.getByText('Start', { exact: true }).first();
    await expect(startTaskRow).toBeVisible({ timeout: 20_000 });
    await startTaskRow.click();

    await page.waitForURL(/\/admin\/workflows\/tasks\/[^/]+$/, { timeout: 20_000 });

    // Claim if required, then Complete.
    const claimButton = page.getByRole('button', { name: /^Claim$/i });
    if (await claimButton.count()) {
      await claimButton.first().click();
    }
    await page.getByRole('button', { name: /^Complete$/i }).click();

    // Back on the instance, assert it reached completed.
    const instanceId = instanceMatch![1];
    await page.goto(`/workflows/${instanceId}`);
    await expect(page.getByText(/Completed/i).first()).toBeVisible({ timeout: 30_000 });
  });

  test('the create default is publishable (regression guard for the >=2-steps break)', async ({
    page,
  }) => {
    const defId = await createDefaultDefinition(page);

    await page.goto(`${DEFINITIONS_URL}/${defId}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 20_000 });

    await page.getByRole('button', { name: /^Publish$/i }).click();

    // No structured validation errors must appear for the default definition.
    await expect(page.getByTestId('publish-validation-errors')).toHaveCount(0);
    await expect(page.getByTestId('publish-error')).toHaveCount(0);
    await expect(page.getByText(/^Active$/i).first()).toBeVisible({ timeout: 20_000 });
  });
});
