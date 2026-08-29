import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LocaleProvider } from '@/components/providers/locale-provider';
import { getLocaleDirection, type AppLocale } from '@/lib/i18n';
import { getMessages } from '@/lib/i18n/messages';
import { Header } from './header';

vi.mock('@/hooks/use-sidebar', () => ({
  useSidebar: () => ({ toggleMobileOpen: vi.fn() }),
}));

vi.mock('@/hooks/use-media-query', () => ({
  useIsMobile: () => false,
}));

vi.mock('@/hooks/use-command-palette', () => ({
  useCommandPalette: () => ({ setOpen: vi.fn() }),
}));

vi.mock('@/stores/notification-store', () => ({
  useNotificationStore: (selector: (state: { connectionStatus: string }) => unknown) =>
    selector({ connectionStatus: 'connected' }),
}));

vi.mock('./navigation-labels', () => ({
  useNavigationLabels: () => ({
    shell: (key: string) => key,
  }),
}));

vi.mock('./breadcrumbs', () => ({ Breadcrumbs: () => null }));
vi.mock('./notification-dropdown', () => ({ NotificationDropdown: () => null }));
vi.mock('./tenant-switcher', () => ({ TenantSwitcher: () => null }));
vi.mock('./user-menu', () => ({ UserMenu: () => null }));
vi.mock('./theme-locale-switcher', () => ({ ThemeLocaleSwitcher: () => null }));

vi.mock('@/components/ui/tooltip', () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) => children,
  Tooltip: ({ children }: { children: React.ReactNode }) => children,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => children,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

function renderHeader(locale: AppLocale = 'en', watheeq = true) {
  return render(
    <LocaleProvider
      locale={locale}
      direction={getLocaleDirection(locale)}
      messages={getMessages(locale)}
    >
      <Header watheeq={watheeq} />
    </LocaleProvider>,
  );
}

describe('Header WatheeqTech branding', () => {
  it('shows the English on-dark logo in the Watheeq header and links it home', () => {
    renderHeader('en');

    const homeLink = screen.getByRole('link', { name: 'WatheeqTech home' });
    expect(homeLink).toHaveAttribute('href', '/lex');
    expect(
      homeLink.querySelector('img[src="/brand/watheeqtech/logo-green-bg.svg"]'),
    ).toBeInTheDocument();
    expect(
      homeLink.querySelector('img[src="/brand/watheeqtech/mark-green-bg.svg"]'),
    ).toBeInTheDocument();
  });

  it('uses the Arabic lockup and localizes the home label for Arabic', () => {
    renderHeader('ar');

    const homeLink = screen.getByRole('link', { name: 'وثيقتك — الرئيسية' });
    expect(
      homeLink.querySelector('img[src="/brand/watheeqtech/arabic-logo-green-bg.svg"]'),
    ).toBeInTheDocument();
  });

  it('does not add the WatheeqTech brand link to other suite headers', () => {
    renderHeader('en', false);

    expect(screen.queryByRole('link', { name: 'WatheeqTech home' })).not.toBeInTheDocument();
  });
});
