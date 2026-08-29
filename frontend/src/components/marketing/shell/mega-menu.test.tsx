import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import { MegaMenu } from './mega-menu';
import { clarioDrNavModel } from './nav-model';

function renderMegaMenu(locale: 'en' | 'ar' = 'en') {
  return renderWithQuery(
    <MegaMenu items={clarioDrNavModel} ariaLabel="Main navigation" />,
    { locale },
  );
}

describe('MegaMenu', () => {
  it('exposes a labelled top-level navigation landmark with triggers collapsed', () => {
    renderMegaMenu();

    const nav = screen.getByRole('navigation', { name: 'Main navigation' });
    expect(nav).toBeInTheDocument();

    // Each mega-menu trigger starts collapsed.
    const solutions = screen.getByRole('button', { name: /Solutions/ });
    expect(solutions).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens a panel via keyboard (Enter) and flips aria-expanded to true', async () => {
    const user = userEvent.setup();
    renderMegaMenu();

    const products = screen.getByRole('button', { name: /Products/ });

    // Move focus to the trigger and activate via keyboard.
    products.focus();
    expect(products).toHaveFocus();
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(products).toHaveAttribute('aria-expanded', 'true');
    });

    // The product column links are now revealed inside the panel.
    expect(
      await screen.findByRole('link', { name: /ClarioDR/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /ClarioSync/ })).toBeInTheDocument();
  });

  it('closes the open panel when Escape is pressed', async () => {
    const user = userEvent.setup();
    renderMegaMenu();

    const products = screen.getByRole('button', { name: /Products/ });
    products.focus();
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(products).toHaveAttribute('aria-expanded', 'true');
    });

    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(products).toHaveAttribute('aria-expanded', 'false');
    });
  });

  it('renders plain top-level links for items without columns', () => {
    renderMegaMenu();

    // "Pricing" has no columns → it is a direct link, not a disclosure trigger.
    const pricing = screen.getByRole('link', { name: 'Pricing' });
    expect(pricing).toHaveAttribute('href', '/pricing');
    expect(
      screen.queryByRole('button', { name: 'Pricing' }),
    ).not.toBeInTheDocument();
  });

  it('exposes the featured callout inside the opened Solutions panel', async () => {
    const user = userEvent.setup();
    renderMegaMenu();

    const solutions = screen.getByRole('button', { name: /Solutions/ });
    solutions.focus();
    await user.keyboard('{Enter}');

    const featured = await screen.findByRole('link', {
      name: /Explore the approach/,
    });
    expect(featured).toHaveAttribute(
      'href',
      '/solutions/fifteen-minute-failover',
    );
    // The featured copy is original ClarioDR content.
    expect(
      within(featured).getByText('The 15-minute failover standard'),
    ).toBeInTheDocument();
  });

  it('renders with the correct logical direction under <… dir="rtl"> (ar locale)', () => {
    renderWithQuery(
      <div dir="rtl" data-testid="rtl-root">
        <MegaMenu items={clarioDrNavModel} ariaLabel="التنقل الرئيسي" />
      </div>,
      { locale: 'ar' },
    );

    const nav = screen.getByRole('navigation', { name: 'التنقل الرئيسي' });
    expect(nav).toBeInTheDocument();

    // The nav lives inside an RTL subtree, so the computed direction resolves to
    // rtl — logical Tailwind utilities (start-*/end-*/ms-*) mirror accordingly.
    const rtlRoot = screen.getByTestId('rtl-root');
    expect(rtlRoot).toHaveAttribute('dir', 'rtl');
    expect(rtlRoot.closest('[dir="rtl"]')).toBe(rtlRoot);
    expect(nav.closest('[dir="rtl"]')).toBe(rtlRoot);
  });
});
