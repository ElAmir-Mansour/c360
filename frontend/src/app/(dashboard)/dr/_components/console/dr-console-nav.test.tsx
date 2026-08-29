import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';

// usePathname drives the active tab; set it per render via the ref.
const pathnameRef = { current: '/dr' };

// Stable prefetch spy so the hover/focus prefetch (#20b) can be asserted.
const { prefetchMock } = vi.hoisted(() => ({ prefetchMock: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    prefetch: prefetchMock,
    refresh: vi.fn(),
  }),
  usePathname: () => pathnameRef.current,
  useSearchParams: () => new URLSearchParams(''),
}));

import { DRConsoleNav } from './dr-console-nav';

const EXPECTED_LINKS: Array<[label: string, href: string]> = [
  ['Overview', '/dr'],
  ['Protect', '/dr/protect'],
  ['Recover', '/recover/it-dr/recover'],
  ['Rehearse', '/recover/it-dr/rehearse'],
  ['Prove', '/recover/it-dr/prove'],
  ['Readiness', '/dr/readiness'],
  ['Insights', '/dr/insights'],
  ['Integrations', '/dr/integrations'],
];

describe('DRConsoleNav', () => {
  afterEach(() => {
    prefetchMock.mockClear();
  });

  it('renders all console section links with correct hrefs', () => {
    pathnameRef.current = '/dr';
    renderWithQuery(<DRConsoleNav />);

    const links = screen.getAllByRole('link');
    expect(links.length).toBeGreaterThanOrEqual(6);

    for (const [label, href] of EXPECTED_LINKS) {
      const link = screen.getByRole('link', { name: label });
      expect(link).toHaveAttribute('href', href);
    }
  });

  it('marks the exact-match Overview tab active on /dr', () => {
    pathnameRef.current = '/dr';
    renderWithQuery(<DRConsoleNav />);

    const overview = screen.getByRole('link', { name: 'Overview' });
    expect(overview).toHaveAttribute('aria-current', 'page');

    // Overview must NOT stay active on nested routes (exact match only).
    const recover = screen.getByRole('link', { name: 'Recover' });
    expect(recover).not.toHaveAttribute('aria-current');
  });

  it('marks the Recover tab active on its own route and removes it from Overview', () => {
    pathnameRef.current = '/recover/it-dr/recover';
    renderWithQuery(<DRConsoleNav />);

    expect(screen.getByRole('link', { name: 'Recover' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('link', { name: 'Overview' })).not.toHaveAttribute(
      'aria-current',
    );
  });

  it('keeps the Recover tab active on the /dr/runs drill-in (alsoActiveFor)', () => {
    pathnameRef.current = '/dr/runs/run-123';
    renderWithQuery(<DRConsoleNav />);

    expect(screen.getByRole('link', { name: 'Recover' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    // Only one tab is active at a time.
    const active = screen
      .getAllByRole('link')
      .filter((el) => el.getAttribute('aria-current') === 'page');
    expect(active).toHaveLength(1);
  });

  // #20b — hover/focus prefetch warms the target route bundle; the current route
  // is skipped (already loaded).
  it('prefetches a non-active route on hover and skips the active route', async () => {
    pathnameRef.current = '/dr';
    const user = userEvent.setup();
    renderWithQuery(<DRConsoleNav />);

    await user.hover(screen.getByRole('link', { name: 'Readiness' }));
    expect(prefetchMock).toHaveBeenCalledWith('/dr/readiness');

    prefetchMock.mockClear();
    // The active route (Overview on /dr) must NOT be prefetched.
    await user.hover(screen.getByRole('link', { name: 'Overview' }));
    expect(prefetchMock).not.toHaveBeenCalled();
  });

  // Arabic / RTL: the same console renders fully localized professional MSA copy
  // when the active locale is `ar`, and the routing/active-state behaviour (which
  // RTL needs to stay correct) is unchanged.
  it('renders professional MSA tab labels and the active state under the ar locale', () => {
    pathnameRef.current = '/recover/it-dr/recover';
    renderWithQuery(<DRConsoleNav />, { locale: 'ar' });

    // The nav landmark is named in Arabic, and English copy is gone.
    const nav = screen.getByRole('navigation', {
      name: 'أقسام وحدة التحكّم بعمليات الاسترداد',
    });
    expect(nav).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Overview' })).not.toBeInTheDocument();

    // Tab labels resolve to MSA.
    expect(screen.getByRole('link', { name: 'نظرة عامة' })).toHaveAttribute('href', '/dr');
    const recover = screen.getByRole('link', { name: 'الاسترداد' });
    expect(recover).toHaveAttribute('href', '/recover/it-dr/recover');

    // Active-state behaviour is locale-independent (logical, not physical).
    expect(recover).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'نظرة عامة' })).not.toHaveAttribute('aria-current');
  });
});
