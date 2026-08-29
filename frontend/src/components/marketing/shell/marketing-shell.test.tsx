import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import { MarketingShell, type MarketingShellLabels } from './marketing-shell';
import { MarketingFooter } from './marketing-footer';
import {
  clarioDrBrand,
  clarioDrFooterModel,
  clarioDrNavModel,
} from './nav-model';

const labels: MarketingShellLabels = {
  skipToContent: 'Skip to content',
  navAriaLabel: 'Main navigation',
  mobileOpenLabel: 'Open menu',
  mobileCloseLabel: 'Close menu',
  mobileTitle: 'Menu',
};

const announcement = {
  id: 'phase-2-launch',
  message: 'ClarioDR DR Day: live failover rehearsal walkthrough.',
  link: { label: 'Reserve a seat', href: '/events/dr-day' },
  dismissLabel: 'Dismiss announcement',
};

function renderShell(
  locale: 'en' | 'ar' = 'en',
  options: { withAnnouncement?: boolean } = {},
) {
  return renderWithQuery(
    <MarketingShell
      brand={clarioDrBrand}
      nav={clarioDrNavModel}
      labels={locale === 'ar' ? { ...labels, navAriaLabel: 'التنقل الرئيسي' } : labels}
      announcement={options.withAnnouncement ? announcement : undefined}
      headerActions={<button type="button">Start free</button>}
      footer={
        <MarketingFooter
          brand={clarioDrBrand}
          columns={clarioDrFooterModel}
          copyright="© 2026 ClarioDR."
          ariaLabel="Footer"
        />
      }
    >
      <h1>Recover with confidence</h1>
    </MarketingShell>,
    { locale },
  );
}

describe('MarketingShell', () => {
  it('renders the brand, nav, content (main landmark) and footer', () => {
    renderShell();

    // The header is a banner landmark; the brand home link lives inside it.
    const banner = screen.getByRole('banner');
    expect(
      within(banner).getByRole('link', { name: 'ClarioDR — home' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('navigation', { name: 'Main navigation' }),
    ).toBeInTheDocument();

    const main = screen.getByRole('main');
    expect(
      within(main).getByRole('heading', { name: 'Recover with confidence' }),
    ).toBeInTheDocument();

    expect(screen.getByRole('contentinfo', { name: 'Footer' })).toBeInTheDocument();
  });

  it('provides a skip link targeting the main landmark', () => {
    renderShell();
    const skip = screen.getByRole('link', { name: 'Skip to content' });
    expect(skip).toHaveAttribute('href', '#marketing-main');
    expect(screen.getByRole('main')).toHaveAttribute('id', 'marketing-main');
  });

  it('shows the announcement bar and dismisses it without persisted storage', async () => {
    const user = userEvent.setup();
    renderShell('en', { withAnnouncement: true });

    const bar = screen.getByTestId('announcement-bar');
    expect(
      within(bar).getByText(/live failover rehearsal walkthrough/),
    ).toBeInTheDocument();
    expect(
      within(bar).getByRole('link', { name: 'Reserve a seat' }),
    ).toHaveAttribute('href', '/events/dr-day');

    await user.click(screen.getByTestId('announcement-dismiss'));

    await waitFor(() =>
      expect(screen.queryByTestId('announcement-bar')).not.toBeInTheDocument(),
    );
    expect(window.localStorage.length).toBe(0);
  });

  it('does not hide announcements based on previously persisted browser state', () => {
    window.localStorage.setItem('clario360_announcement_dismissed:phase-2-launch', '1');

    renderShell('en', { withAnnouncement: true });

    expect(screen.getByTestId('announcement-bar')).toBeInTheDocument();
  });

  it('renders desktop header actions', () => {
    renderShell();
    expect(
      screen.getByRole('button', { name: 'Start free' }),
    ).toBeInTheDocument();
  });

  it('renders with correct logical direction under the ar (RTL) locale', () => {
    renderWithQuery(
      <div dir="rtl" data-testid="rtl-root">
        <MarketingShell
          brand={clarioDrBrand}
          nav={clarioDrNavModel}
          labels={{ ...labels, navAriaLabel: 'التنقل الرئيسي' }}
        >
          <h1>الصفحة</h1>
        </MarketingShell>
      </div>,
      { locale: 'ar' },
    );

    const rtlRoot = screen.getByTestId('rtl-root');
    expect(rtlRoot).toHaveAttribute('dir', 'rtl');
    expect(screen.getByRole('main').closest('[dir="rtl"]')).toBe(rtlRoot);
  });
});
