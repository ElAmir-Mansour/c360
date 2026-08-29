import { expect, test } from '@playwright/test';
import { commandBar, consoleNav, gotoConsole } from './_helpers';

/**
 * Integrations CRUD journey — `/dr/integrations` create → test → delete.
 *
 * Drives the real recovery-connector lifecycle through the form dialog, the
 * per-row connection test, and the destructive delete confirm dialog. All writes
 * are `dr:write`-gated: when the authenticated operator is read-only the "Add
 * integration" affordance is absent, so the create/test/delete flow is skipped
 * honestly rather than failing.
 *
 * Auth comes from the project storage-state fixture. The connection test hits the
 * live integrations service; the spec tolerates either a success or error verdict
 * (both are valid outcomes for a freshly created, never-reachable connector) and
 * only asserts that the action round-trips and a toast is shown.
 */
test.describe('DR integrations CRUD', () => {
  test('renders the integrations page within the console shell', async ({ page }) => {
    await gotoConsole(page, '/dr/integrations');

    await expect(commandBar(page)).toBeVisible();
    await expect(
      consoleNav(page).getByRole('link', { name: 'Integrations' }),
    ).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('heading', { name: 'Recovery Integrations' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Refresh' })).toBeVisible();
  });

  test('creates, tests, and deletes a recovery integration', async ({ page }) => {
    await gotoConsole(page, '/dr/integrations');

    const addButton = page.getByRole('button', { name: 'Add integration' });
    test.skip((await addButton.count()) === 0, 'Creating an integration requires the dr:write permission.');

    // Unique name so the row is unambiguous in the table and safe to clean up.
    const name = `e2e-vsphere-${Date.now()}`;

    // --- CREATE -------------------------------------------------------------
    await addButton.click();
    const dialog = page.getByRole('dialog', { name: 'New recovery integration' });
    await expect(dialog).toBeVisible();

    await dialog.getByLabel('Name', { exact: true }).fill(name);
    await dialog.getByLabel('Endpoint', { exact: true }).fill('https://vcenter.e2e.local');
    // Kind/Vendor default to a valid hypervisor pairing; leave them as-is.
    await dialog.getByRole('button', { name: 'Create integration' }).click();
    await expect(dialog).toBeHidden();

    // The new connector appears as a row keyed by its unique name.
    const row = page.getByRole('row', { name: new RegExp(name) });
    await expect(row).toBeVisible({ timeout: 15_000 });

    // --- TEST ---------------------------------------------------------------
    // The per-row test action round-trips to the live integrations service. A
    // success or failure verdict is acceptable for a brand-new connector; assert
    // a result toast is shown either way.
    await row.getByRole('button', { name: 'Test' }).click();
    await expect(
      page.getByText(new RegExp(`Connection test (succeeded|failed)`)),
    ).toBeVisible({ timeout: 20_000 });

    // --- DELETE -------------------------------------------------------------
    await row.getByRole('button', { name: 'Delete' }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Delete integration' });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Delete' }).click();

    // The row is removed and a deletion toast confirms the destructive action.
    await expect(row).toBeHidden({ timeout: 15_000 });
    await expect(page.getByText(`Integration "${name}" deleted`)).toBeVisible();
  });

  test('validates the create form before allowing submit', async ({ page }) => {
    await gotoConsole(page, '/dr/integrations');

    const addButton = page.getByRole('button', { name: 'Add integration' });
    test.skip((await addButton.count()) === 0, 'Creating an integration requires the dr:write permission.');

    await addButton.click();
    const dialog = page.getByRole('dialog', { name: 'New recovery integration' });
    await expect(dialog).toBeVisible();

    // With name + endpoint empty the submit is disabled (required-field guard).
    const submit = dialog.getByRole('button', { name: 'Create integration' });
    await expect(submit).toBeDisabled();

    // Filling the required fields enables it.
    await dialog.getByLabel('Name', { exact: true }).fill('e2e-validation-check');
    await dialog.getByLabel('Endpoint', { exact: true }).fill('https://array.e2e.local');
    await expect(submit).toBeEnabled();

    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
  });
});
