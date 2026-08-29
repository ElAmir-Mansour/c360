import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider as NextThemesProvider } from 'next-themes';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeLocaleSwitcher } from './theme-locale-switcher';
import { LocaleProvider } from '@/components/providers/locale-provider';
import { getMessages } from '@/lib/i18n/messages';
import { getLocaleDirection, LOCALE_COOKIE_NAME, type AppLocale } from '@/lib/i18n';

const refreshMock = vi.fn();

// The global setup mocks next/navigation but omits refresh(); provide it here so
// the live locale switch can call router.refresh().
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
    refresh: refreshMock,
  }),
  usePathname: () => '/',
  useSearchParams: () => ({ get: () => null, forEach: () => undefined }),
  useParams: () => ({}),
  redirect: vi.fn(),
}));

function renderSwitcher(locale: AppLocale) {
  return render(
    <NextThemesProvider attribute="class" defaultTheme="light" enableSystem={false}>
      <LocaleProvider
        locale={locale}
        direction={getLocaleDirection(locale)}
        messages={getMessages(locale)}
      >
        <ThemeLocaleSwitcher />
      </LocaleProvider>
    </NextThemesProvider>,
  );
}

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId('theme-locale-trigger'));
  // Wait for the Radix menu content to mount.
  await waitFor(() => expect(screen.getByTestId('theme-option-dark')).toBeInTheDocument());
}

describe('ThemeLocaleSwitcher', () => {
  beforeEach(() => {
    refreshMock.mockClear();
    // Reset html attributes + persisted theme + cookie between tests.
    document.documentElement.className = '';
    document.documentElement.removeAttribute('dir');
    document.documentElement.removeAttribute('lang');
    localStorage.clear();
    document.cookie = `${LOCALE_COOKIE_NAME}=; path=/; max-age=0`;
  });

  afterEach(() => {
    document.documentElement.className = '';
  });

  it('toggles the dark class on <html> and persists the choice', async () => {
    const user = userEvent.setup();
    renderSwitcher('en');

    expect(document.documentElement.classList.contains('dark')).toBe(false);

    await openMenu(user);
    await user.click(screen.getByTestId('theme-option-dark'));

    // next-themes applies the `dark` class to <html> and persists to storage.
    await waitFor(() => {
      expect(document.documentElement.classList.contains('dark')).toBe(true);
    });
    expect(localStorage.getItem('theme')).toBe('dark');

    // Switching back to light removes the class and re-persists.
    await openMenu(user);
    await user.click(screen.getByTestId('theme-option-light'));
    await waitFor(() => {
      expect(document.documentElement.classList.contains('dark')).toBe(false);
    });
    expect(localStorage.getItem('theme')).toBe('light');
  });

  it('shows English labels in LTR and switches locale EN -> AR (cookie + dir=rtl)', async () => {
    const user = userEvent.setup();
    renderSwitcher('en');

    await openMenu(user);

    // English copy is rendered via the LocaleProvider.
    expect(screen.getByText('Theme')).toBeInTheDocument();
    expect(screen.getByText('Language')).toBeInTheDocument();

    const arOption = screen.getByTestId('locale-option-ar');
    // The Arabic option presents its native label.
    expect(within(arOption).getByText('العربية')).toBeInTheDocument();

    await user.click(arOption);

    // Cookie written for the server to resolve Arabic on the next render.
    await waitFor(() => {
      expect(document.cookie).toContain(`${LOCALE_COOKIE_NAME}=ar`);
    });

    // Direction flipped live to RTL on <html>, lang set to ar.
    expect(document.documentElement.getAttribute('dir')).toBe('rtl');
    expect(document.documentElement.getAttribute('lang')).toBe('ar');

    // Server tree refresh requested so labels re-render.
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it('renders Arabic labels and marks AR selected when locale is ar (RTL)', async () => {
    const user = userEvent.setup();
    renderSwitcher('ar');

    await openMenu(user);

    // Arabic shell copy for the section headers.
    expect(screen.getByText('السمة')).toBeInTheDocument(); // "Theme"
    expect(screen.getByText('اللغة')).toBeInTheDocument(); // "Language"

    // The Arabic locale option is marked selected for assistive tech.
    expect(screen.getByTestId('locale-option-ar')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('locale-option-en')).toHaveAttribute('aria-checked', 'false');
  });
});
