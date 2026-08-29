import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Shared selectors + navigation helpers for the Recovery Operations Console
 * (`/dr`) Playwright journeys.
 *
 * These specs run against the LIVE stack: authentication is supplied by the
 * project-wide storage state produced by `e2e/global-setup.ts` and wired in
 * `playwright.config.ts` (the `chromium` project's `storageState` +
 * `dependencies: ['setup']`). No spec under `e2e/dr/` invents its own login —
 * navigating to a `/dr` route is enough once the auth fixture has run.
 *
 * Every selector here mirrors a STABLE hook that already exists in the real
 * console components (role + accessible name, or an existing `data-testid`); none
 * of them were added for the tests. The console layout (posture banner, command
 * bar, console nav) is mounted on every `/dr` route, so the command-bar and nav
 * locators are the most reliable cross-route anchors.
 */

/** Accessible name of the always-mounted primary command bar (`role="toolbar"`). */
export const COMMAND_BAR_LABEL = 'Recovery operations actions';

/** Accessible name of the always-mounted console sub-navigation (`role="nav"`). */
export const CONSOLE_NAV_LABEL = 'Recovery operations console sections';

/** Stable `data-testid` hooks that already exist in the real components. */
export const TESTID = {
  failoverWizardBody: 'failover-wizard-body',
  runNextAction: 'run-next-action',
  runRtoCountdown: 'run-rto-countdown',
  runGateTimeline: 'run-gate-timeline',
  runActivityFeed: 'run-activity-feed',
  approvalsList: 'approvals-list',
  approvalItem: 'approval-item',
  approvalsCount: 'approvals-count',
} as const;

/** The always-visible command bar toolbar on every `/dr` route. */
export function commandBar(page: Page): Locator {
  return page.getByRole('toolbar', { name: COMMAND_BAR_LABEL });
}

/** The always-visible console section navigation on every `/dr` route. */
export function consoleNav(page: Page): Locator {
  return page.getByRole('navigation', { name: CONSOLE_NAV_LABEL });
}

/**
 * Navigate to a console route and wait for the persistent shell (command bar) to
 * mount, so a journey never races the route's first paint. The command bar lives
 * in the route-group layout, so it is present on every `/dr` page including the
 * war-room and the prove/ledger sub-routes.
 */
export async function gotoConsole(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await expect(commandBar(page)).toBeVisible();
}

/**
 * Open the guided "Declare failover" wizard from the command bar.
 *
 * The trigger is `dr:write`-gated: when the authenticated operator lacks the
 * permission the button is disabled (wrapped for a tooltip), so the wizard cannot
 * open. Returns whether the wizard actually opened so a spec can branch honestly
 * instead of asserting a dialog that a read-only operator can never reach.
 */
export async function openFailoverWizard(page: Page): Promise<boolean> {
  const trigger = commandBar(page).getByRole('button', { name: 'Declare failover' });
  await expect(trigger).toBeVisible();

  if (await trigger.isDisabled()) {
    return false;
  }

  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Guided failover' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId(TESTID.failoverWizardBody)).toBeVisible();
  return true;
}

/** The guided-failover dialog (only present once {@link openFailoverWizard} succeeds). */
export function failoverDialog(page: Page): Locator {
  return page.getByRole('dialog', { name: 'Guided failover' });
}
