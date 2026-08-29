import { expect, test } from '@playwright/test';
import {
  TESTID,
  commandBar,
  consoleNav,
  failoverDialog,
  gotoConsole,
  openFailoverWizard,
} from './_helpers';

/**
 * Critical DR journey — declare → war-room → approve → evidence.
 *
 * Open `/dr` → command bar visible → declare-failover wizard pre-flight
 * (readiness blocking/warnings) → drill mode → run appears → open the
 * `/dr/runs/[id]` war room (gate timeline + RTO countdown) → approve gate →
 * evidence/prove reachable.
 *
 * Runs against the LIVE stack with the project auth fixture (storage state from
 * `e2e/global-setup.ts`). It does not assume a seeded protection group: where a
 * step depends on real data (a selectable group, an awaiting-approval run) the
 * spec branches honestly rather than asserting fabricated state, so it stays
 * meaningful whether or not the backend has DR fixtures loaded.
 */
test.describe('DR critical path — declare → war-room → approve → evidence', () => {
  test('the console shell is mounted with the command bar and section nav', async ({ page }) => {
    await gotoConsole(page, '/dr');

    await expect(page).toHaveURL(/\/dr(?:[?#]|$)/);
    await expect(commandBar(page)).toBeVisible();
    await expect(consoleNav(page)).toBeVisible();

    // The four lifecycle-spanning command-bar actions are always rendered (they
    // may be disabled until a group is selected / dr:write is held).
    const bar = commandBar(page);
    await expect(bar.getByRole('button', { name: 'Declare failover' })).toBeVisible();
    await expect(bar.getByRole('button', { name: 'Rehearse' })).toBeVisible();
    await expect(bar.getByRole('button', { name: 'Run a runbook' })).toBeVisible();
    await expect(bar.getByRole('button', { name: 'Seal recovery point' })).toBeVisible();

    // Every console section is reachable from the persistent nav.
    const nav = consoleNav(page);
    for (const label of ['Overview', 'Protect', 'Recover', 'Rehearse', 'Prove', 'Readiness', 'Integrations']) {
      await expect(nav.getByRole('link', { name: label })).toBeVisible();
    }
  });

  test('the declare-failover wizard pre-flights readiness before allowing a drill', async ({ page }) => {
    await gotoConsole(page, '/dr');

    const opened = await openFailoverWizard(page);
    test.skip(!opened, 'Declare failover is gated by dr:write and/or a selected protection group.');

    const dialog = failoverDialog(page);

    // Step 1 is the readiness pre-flight. The wizard hard-blocks "Continue" until
    // readiness reports cleanly (or warnings are acknowledged), so the pre-flight
    // is genuinely a gate — assert the step rail + the Continue control exist.
    await expect(dialog.getByRole('heading', { name: 'Readiness pre-flight' })).toBeVisible();
    const continueButton = dialog.getByRole('button', { name: 'Continue' });
    await expect(continueButton).toBeVisible();

    // If readiness surfaced acknowledgeable warnings, ticking the acknowledgement
    // is what clears the soft block — exercise it when present.
    const ackCheckbox = dialog.getByRole('checkbox', {
      name: 'I acknowledge all warnings above and accept the risk.',
    });
    if (await ackCheckbox.count()) {
      await ackCheckbox.check();
      await expect(ackCheckbox).toBeChecked();
    }

    // Advance into the recovery plan only when the pre-flight has cleared; a
    // hard-blocked group keeps Continue disabled, which is the correct behaviour.
    if (await continueButton.isEnabled()) {
      await continueButton.click();
      await expect(dialog.getByRole('heading', { name: 'Choose the recovery plan' })).toBeVisible();

      // Drill mode is the default, non-disruptive path; confirm it is selectable.
      const drillMode = dialog.getByRole('radio', { name: /Drill — non-disruptive rehearsal/ });
      await expect(drillMode).toBeVisible();
      await drillMode.check();
      await expect(drillMode).toBeChecked();
    }

    // Cancelling never declares a run — close the wizard cleanly.
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
  });

  test('the Recover lifecycle lists runs and deep-links into the war room', async ({ page }) => {
    await gotoConsole(page, '/dr/recover');

    // The Recover tab is the active console section.
    await expect(
      consoleNav(page).getByRole('link', { name: 'Recover' }),
    ).toHaveAttribute('aria-current', 'page');

    // Reach the war room either by following a run link the Recover page exposes,
    // or — when no run is seeded — assert the route renders its own framing.
    const runLink = page.locator('a[href^="/dr/runs/"]').first();
    if (await runLink.count()) {
      await runLink.click();
      await expect(page).toHaveURL(/\/dr\/runs\/.+/);
      await expect(page.getByTestId(TESTID.runRtoCountdown)).toBeVisible();
    } else {
      test.skip(true, 'No failover run is seeded in this environment to drill into.');
    }
  });

  test('the war room surfaces the RTO countdown, gate timeline and next required action', async ({ page }) => {
    // Enter via Recover so the war-room is reached the way an operator would.
    await gotoConsole(page, '/dr/recover');

    const runLink = page.locator('a[href^="/dr/runs/"]').first();
    test.skip((await runLink.count()) === 0, 'No failover run is seeded to open the war room.');

    await runLink.click();
    await expect(page).toHaveURL(/\/dr\/runs\/.+/);

    // The action-first war-room centrepiece: live RTO countdown + four-gate
    // timeline + the derived "next required action" panel.
    await expect(page.getByTestId(TESTID.runRtoCountdown)).toBeVisible();
    await expect(page.getByTestId(TESTID.runGateTimeline)).toBeVisible();
    const nextAction = page.getByTestId(TESTID.runNextAction);
    await expect(nextAction).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Incident command' })).toBeVisible();

    // When the run is paused at the approval gate the panel renders the gated
    // "Approve failover" CTA; approve it when it is actionable.
    if ((await nextAction.getAttribute('data-action-kind')) === 'approve') {
      const approve = nextAction.getByRole('button', { name: 'Approve failover' });
      await expect(approve).toBeVisible();
      if (await approve.isEnabled()) {
        await approve.click();
        // After approving, the war-room re-derives from the live run; the panel
        // stays mounted (its action kind advances away from "approve").
        await expect(nextAction).toBeVisible();
      }
    }

    // Evidence is reachable from the console nav (Prove) at any point in the run.
    await consoleNav(page).getByRole('link', { name: 'Prove' }).click();
    await expect(page).toHaveURL(/\/dr\/prove(?:[/?#]|$)/);
    await expect(page.getByRole('heading', { name: 'Prove', exact: true })).toBeVisible();
  });

  test('evidence / prove is reachable directly and exposes the ledger explorer', async ({ page }) => {
    await gotoConsole(page, '/dr/prove');

    await expect(
      consoleNav(page).getByRole('link', { name: 'Prove' }),
    ).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('heading', { name: 'Prove', exact: true })).toBeVisible();

    // The immutable attestation ledger is the prove sub-route the journey ends on.
    await gotoConsole(page, '/dr/prove/ledger');
    await expect(
      page.getByRole('heading', { name: 'Attestation ledger explorer' }),
    ).toBeVisible();
  });
});
