import { expect, test } from '@playwright/test';
import { TESTID, commandBar, gotoConsole } from './_helpers';

/**
 * Approvals inbox journey — `/dr/approvals` shows an awaiting item → approve.
 *
 * The inbox folds every recovery decision paused at an approval gate (failover
 * gate + failback cutback gate) from the live run lists. Against a backend with
 * no awaiting items the queue is legitimately empty, so the spec asserts the
 * inbox framing unconditionally and only exercises the one-click approval when a
 * real awaiting item is present.
 *
 * Auth comes from the project storage-state fixture; no login is performed here.
 */
test.describe('DR approvals inbox', () => {
  test('renders the approvals inbox framing within the console shell', async ({ page }) => {
    await gotoConsole(page, '/dr/approvals');

    // The persistent console command bar is mounted here too (route-group layout).
    await expect(commandBar(page)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Approvals', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Needs your approval' })).toBeVisible();
  });

  test('shows an awaiting item and approves it, or shows the empty queue', async ({ page }) => {
    await gotoConsole(page, '/dr/approvals');

    const list = page.getByTestId(TESTID.approvalsList);
    const items = page.getByTestId(TESTID.approvalItem);

    // The queue resolves to either a populated list or the empty state; wait for
    // one of the two to settle before branching.
    await expect
      .poll(async () => (await list.count()) > 0 || (await page.getByText('Nothing awaiting approval').count()) > 0, {
        timeout: 15_000,
      })
      .toBeTruthy();

    const itemCount = await items.count();
    test.skip(itemCount === 0, 'No recovery decision is awaiting approval in this environment.');

    // The header count badge reflects the number of awaiting items.
    await expect(page.getByTestId(TESTID.approvalsCount)).toBeVisible();

    const firstItem = items.first();
    await expect(firstItem).toBeVisible();
    // Each item carries its real kind + run id as stable data hooks.
    await expect(firstItem).toHaveAttribute('data-approval-kind', /failover|failback_cutback/);
    await expect(firstItem).toHaveAttribute('data-approval-id', /.+/);

    // The one-click approve CTA is the failover or cutback approval, dr:write-gated.
    const approve = firstItem.getByRole('button', { name: /Approve (failover|cutback)/ });
    await expect(approve).toBeVisible();

    if (await approve.isEnabled()) {
      await approve.click();
      // The mutation toasts + invalidates the live run lists; the approved item
      // leaves the queue (or the whole queue empties).
      await expect
        .poll(async () => await items.count(), { timeout: 15_000 })
        .toBeLessThan(itemCount);
    } else {
      // A read-only operator sees the queue but cannot act — that is correct.
      test.skip(true, 'Approving requires the dr:write permission for this operator.');
    }
  });

  test('an approval item deep-links into its full context', async ({ page }) => {
    await gotoConsole(page, '/dr/approvals');

    const firstItem = page.getByTestId(TESTID.approvalItem).first();
    test.skip((await firstItem.count()) === 0, 'No awaiting approval item to open context for.');

    const openContext = firstItem.getByRole('link', { name: 'Open full context' });
    await expect(openContext).toBeVisible();

    // Failover gate items open the war room; failback cutback items open Recover.
    const kind = await firstItem.getAttribute('data-approval-kind');
    await openContext.click();
    if (kind === 'failback_cutback') {
      await expect(page).toHaveURL(/\/dr\/recover(?:[/?#]|$)/);
    } else {
      await expect(page).toHaveURL(/\/dr\/runs\/.+/);
    }
  });
});
