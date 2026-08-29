import { expect, test } from '@playwright/test';
import { commandBar, consoleNav, gotoConsole } from './_helpers';

/**
 * Attestation-ledger journey — `/dr/prove/ledger` filter + inclusion-proof.
 *
 * Exercises the explorer's two read-only proofs of integrity: applying a filter
 * (the limit select is always populated, so it is the deterministic filter to
 * drive) and verifying a per-entry Merkle inclusion proof. Both depend on real
 * ledger entries; where the ledger is empty in this environment the spec asserts
 * the explorer framing and the empty-proof affordance instead of fabricating a
 * proof.
 *
 * Auth comes from the project storage-state fixture; the ledger reads hit the
 * live attestation service.
 */
test.describe('DR attestation ledger explorer', () => {
  test('renders the ledger explorer within the console shell', async ({ page }) => {
    await gotoConsole(page, '/dr/prove/ledger');

    await expect(commandBar(page)).toBeVisible();
    await expect(
      consoleNav(page).getByRole('link', { name: 'Prove' }),
    ).toHaveAttribute('aria-current', 'page');
    await expect(
      page.getByRole('heading', { name: 'Attestation ledger explorer' }),
    ).toBeVisible();

    // The filter card + the ledger-wide chain-verification card are always present.
    await expect(page.getByRole('heading', { name: 'Filters' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Chain verification' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Apply filters' })).toBeVisible();
  });

  test('applies a filter and reflects the active selection', async ({ page }) => {
    await gotoConsole(page, '/dr/prove/ledger');

    // The "Max rows" select is always populated (25/50/100/200) regardless of
    // whether the ledger has entries — drive it as the deterministic filter.
    const limit = page.getByLabel('Max rows');
    await expect(limit).toBeVisible();
    await limit.click();
    await page.getByRole('option', { name: '25', exact: true }).click();

    // Subject is a free-text server-side filter; narrowing it re-queries the window.
    const subject = page.getByLabel('Subject');
    await subject.fill('fo-');

    await page.getByRole('button', { name: 'Apply filters' }).click();

    // Applying a non-default filter surfaces the active-filters summary + reset.
    const reset = page.getByRole('button', { name: 'Reset' });
    await expect(reset).toBeEnabled();
    await expect(page.getByText('Active filters')).toBeVisible();

    // Resetting clears the applied filters again.
    await reset.click();
    await expect(reset).toBeDisabled();
  });

  test('verifies an inclusion proof for a ledger entry, or shows the empty proof state', async ({ page }) => {
    await gotoConsole(page, '/dr/prove/ledger');

    // The inclusion-proof panel is always rendered; before a selection it shows
    // its empty affordance.
    const proofPanel = page.getByRole('region', { name: 'Inclusion proof' });
    await expect(proofPanel).toBeVisible();

    // Each ledger row exposes a "Verify proof" control keyed by its seq. Wait for
    // the table to settle into either rows or the empty message.
    const verifyButtons = page.getByRole('button', { name: 'Verify proof' });
    await expect
      .poll(
        async () =>
          (await verifyButtons.count()) > 0 ||
          (await page.getByText('No ledger entries match the current filters.').count()) > 0,
        { timeout: 15_000 },
      )
      .toBeTruthy();

    const buttonCount = await verifyButtons.count();
    test.skip(buttonCount === 0, 'No attestation ledger entries are seeded in this environment.');

    // Verify the newest entry's inclusion proof; the panel then renders the
    // Merkle path detail (sequence / leaf index / root) and a verified/mismatch
    // badge — assert the proof detail materialises.
    await verifyButtons.first().click();
    await expect(proofPanel.getByText('Sequence')).toBeVisible({ timeout: 15_000 });
    await expect(proofPanel.getByText('Merkle root')).toBeVisible();
    await expect(
      proofPanel.getByText(/Inclusion verified|Recompute mismatch/),
    ).toBeVisible();
  });
});
