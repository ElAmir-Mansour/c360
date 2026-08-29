import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import { MobileNav } from './mobile-nav';
import { clarioDrNavModel } from './nav-model';

const labels = {
  openLabel: 'Open menu',
  closeLabel: 'Close menu',
  title: 'Menu',
};

function renderMobileNav(
  locale: 'en' | 'ar' = 'en',
  footerSlot?: React.ReactNode,
) {
  return renderWithQuery(
    <MobileNav
      items={clarioDrNavModel}
      openLabel={labels.openLabel}
      closeLabel={labels.closeLabel}
      title={labels.title}
      footerSlot={footerSlot}
    />,
    { locale },
  );
}

async function openDrawer(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId('mobile-nav-trigger'));
  await waitFor(() =>
    expect(screen.getByTestId('mobile-nav-drawer')).toBeInTheDocument(),
  );
}

describe('MobileNav', () => {
  it('toggles aria-expanded on the hamburger trigger', async () => {
    const user = userEvent.setup();
    renderMobileNav();

    const trigger = screen.getByTestId('mobile-nav-trigger');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');

    await user.click(trigger);
    await waitFor(() =>
      expect(trigger).toHaveAttribute('aria-expanded', 'true'),
    );
  });

  it('opens a labelled modal dialog with the nav model rendered', async () => {
    const user = userEvent.setup();
    renderMobileNav();

    await openDrawer(user);

    // Accessible-name comes from the drawer title via aria-labelledby, so the
    // dialog is discoverable by its accessible name "Menu".
    const dialog = screen.getByRole('dialog', { name: 'Menu' });
    expect(dialog).toHaveAttribute('aria-labelledby');
    expect(within(dialog).getByText('Menu')).toBeInTheDocument();

    // Top-level sections appear as accordion buttons.
    expect(
      within(dialog).getByRole('button', { name: /Solutions/ }),
    ).toBeInTheDocument();
    // Plain items render as direct links.
    expect(
      within(dialog).getByRole('link', { name: 'Pricing' }),
    ).toBeInTheDocument();
  });

  it('traps focus inside the drawer (focus stays within the dialog on Tab)', async () => {
    const user = userEvent.setup();
    renderMobileNav();

    await openDrawer(user);
    const dialog = screen.getByRole('dialog');

    // Tab through several stops; focus must never escape the dialog subtree.
    for (let i = 0; i < 12; i += 1) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });

  it('closes on Escape and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    renderMobileNav();

    const trigger = screen.getByTestId('mobile-nav-trigger');
    await openDrawer(user);

    await user.keyboard('{Escape}');

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    // Radix returns focus to the trigger after close.
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('closes via the explicit close button', async () => {
    const user = userEvent.setup();
    renderMobileNav();

    await openDrawer(user);
    await user.click(screen.getByTestId('mobile-nav-close'));

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
  });

  it('expands an accordion section to reveal its grouped links', async () => {
    const user = userEvent.setup();
    renderMobileNav();

    await openDrawer(user);
    const productsSection = screen.getByRole('button', { name: /Products/ });
    expect(productsSection).toHaveAttribute('aria-expanded', 'false');

    await user.click(productsSection);
    await waitFor(() =>
      expect(productsSection).toHaveAttribute('aria-expanded', 'true'),
    );

    expect(
      await screen.findByRole('link', { name: /ClarioMigration/ }),
    ).toBeInTheDocument();
  });

  it('renders the footer slot inside the drawer when provided', async () => {
    const user = userEvent.setup();
    renderMobileNav('en', <button type="button">Start free</button>);

    await openDrawer(user);
    expect(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Start free',
      }),
    ).toBeInTheDocument();
  });

  it('renders the trigger with the localized Arabic label under RTL', () => {
    renderWithQuery(
      <div dir="rtl">
        <MobileNav
          items={clarioDrNavModel}
          openLabel="افتح القائمة"
          closeLabel="أغلق القائمة"
          title="القائمة"
        />
      </div>,
      { locale: 'ar' },
    );

    const trigger = screen.getByTestId('mobile-nav-trigger');
    expect(trigger).toHaveAttribute('aria-label', 'افتح القائمة');
    expect(trigger.closest('[dir="rtl"]')).not.toBeNull();
  });
});
