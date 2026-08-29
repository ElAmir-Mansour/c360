import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import { MarketingFooter } from './marketing-footer';
import { clarioDrBrand, clarioDrFooterModel } from './nav-model';

function renderFooter(locale: 'en' | 'ar' = 'en') {
  return renderWithQuery(
    <MarketingFooter
      brand={clarioDrBrand}
      columns={clarioDrFooterModel}
      copyright="© 2026 ClarioDR. All rights reserved."
      ariaLabel="Footer"
      switcherSlot={<button type="button">Switcher</button>}
    />,
    { locale },
  );
}

describe('MarketingFooter', () => {
  it('renders a contentinfo landmark with a labelled brand home link', () => {
    renderFooter();

    const footer = screen.getByRole('contentinfo', { name: 'Footer' });
    expect(footer).toBeInTheDocument();

    const home = within(footer).getByRole('link', { name: 'ClarioDR — home' });
    expect(home).toHaveAttribute('href', '/');
  });

  it('renders each footer column as a headed nav group', () => {
    renderFooter();

    for (const column of clarioDrFooterModel) {
      const group = screen.getByRole('navigation', { name: column.heading });
      // Heading text is present and every link in the group renders.
      expect(within(group).getByText(column.heading)).toBeInTheDocument();
      for (const link of column.links) {
        expect(
          within(group).getByRole('link', { name: link.label }),
        ).toHaveAttribute('href', link.href);
      }
    }
  });

  it('renders the switcher slot and the copyright line', () => {
    renderFooter();

    expect(
      screen.getByRole('button', { name: 'Switcher' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('© 2026 ClarioDR. All rights reserved.'),
    ).toBeInTheDocument();
  });

  it('renders inside an RTL subtree with the correct logical direction', () => {
    renderWithQuery(
      <div dir="rtl" data-testid="rtl-root">
        <MarketingFooter
          brand={clarioDrBrand}
          columns={clarioDrFooterModel}
          copyright="© 2026 ClarioDR. جميع الحقوق محفوظة."
          ariaLabel="تذييل"
        />
      </div>,
      { locale: 'ar' },
    );

    const footer = screen.getByRole('contentinfo', { name: 'تذييل' });
    const rtlRoot = screen.getByTestId('rtl-root');
    expect(footer.closest('[dir="rtl"]')).toBe(rtlRoot);
  });
});
