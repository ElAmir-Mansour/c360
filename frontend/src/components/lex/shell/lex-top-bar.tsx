'use client';

/**
 * Lex UNIFIED top bar — ONE deep-teal row for the whole Watheeq surface.
 *
 * Replaces the previous DOUBLE chrome (global `Header` teal row + `LexTopNav`
 * teal row stacked beneath it). A single bar now carries, left → right:
 *
 *   ┌──────────────────────────────────────────────────────────────────────────┐
 *   │ [☰] WatheeqTech  Dashboard … Settings  Global search  عربي  ⛉ User │
 *   └──────────────────────────────────────────────────────────────────────────┘
 *
 * - Brand lockup links home to the Overview (`/lex`).
 * - The flat {@link LEX_PRIMARY_NAV} renders inline (permission-gated); the
 *   active item (longest-prefix) gets a La Rioja underline. Horizontally
 *   scrollable if it overflows. Desktop only — mobile uses the ☰ drawer.
 * - Right cluster: the global legal search, notifications, a one-click language
 *   toggle (عربي ⇄ English), and the user identity (avatar · name · role) — the
 *   shared `UserMenu`.
 * - The bar carries the `dark` class (like the old header) so token-based
 *   children (`UserMenu`, `NotificationDropdown`) render legibly on teal; their
 *   dropdowns portal out and keep the real app theme.
 * - RTL-safe via the active-locale `dir`; the ☰ opens the shared `MobileSidebar`.
 *
 * Rendered by the platform shell (`app/(dashboard)/layout.tsx`) ONLY in Watheeq
 * mode, in place of `<Header>` + `<LexTopNav>`. Other suites keep their sidebar.
 */

import { Fragment, memo, useMemo } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, Menu } from 'lucide-react';

import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/use-auth';
import { useSidebar } from '@/hooks/use-sidebar';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { canAccessWith } from '@/lib/permissions';
import { useAuthStore } from '@/stores/auth-store';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { WatheeqLogo } from '@/components/brand/watheeq-logo';
import { UserMenu } from '@/components/layout/user-menu';
import { NotificationDropdown } from '@/components/layout/notification-dropdown';
import { LocaleQuickToggle } from '@/components/layout/locale-quick-toggle';
import { useNavigationLabels } from '@/components/layout/navigation-labels';
import { fetchLexMe } from '@/lib/lex/me';
import { LEX_ME_QUERY_KEY } from '@/lib/lex/use-lex-context';

import {
  LEX_PRIMARY_NAV_MORE,
  activePrimaryHref,
  hasRoleSpecificPrimaryNav,
  isMorePathActive,
  primaryNavForRole,
  type LexPrimaryNavItem,
} from './lex-primary-nav';
import { LexGlobalSearch } from './global-search';
import { useLexShellLabels } from './lex-shell-labels';
import {
  AskForSupportButton,
  SupportComposerHost,
  supportContextFromPathname,
} from '@/components/lex/support-composer';

export const LexTopBar = memo(function LexTopBar() {
  const pathname = usePathname() ?? '';
  const { locale, direction } = useLocaleOrDefault();
  const { hasPermission } = useAuth();
  const { toggleMobileOpen } = useSidebar();
  const { shell } = useNavigationLabels();
  const shellLabels = useLexShellLabels();

  // `hasPermission` is a STABLE store-selector ref (its identity never changes),
  // so a memo keyed only on it would freeze the visible nav at first paint —
  // before the granular lex grants arrive from `/lex/me`. Subscribe to the
  // reactive perm signals (`user` = roles load, `permissionsVersion` = external
  // perm hydration) so the nav re-filters the moment access resolves. Mirrors
  // the same guard in `app/(dashboard)/layout.tsx`.
  const user = useAuthStore((s) => s.user);
  const permissionsVersion = useAuthStore((s) => s.permissionsVersion);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isHydrated = useAuthStore((s) => s.isHydrated);

  // The unified top bar is mounted by the outer dashboard shell, above the
  // nested LexContextProvider. Reading the SAME cached `/lex/me` query here
  // gives the bar the active persona without a second network request.
  const personaQuery = useQuery({
    queryKey: LEX_ME_QUERY_KEY,
    queryFn: fetchLexMe,
    enabled: isAuthenticated && isHydrated,
    staleTime: 5 * 60 * 1000,
  });
  const activeRoleSlug = personaQuery.data?.active_legal_role?.slug ?? null;
  const roleSpecificNav = hasRoleSpecificPrimaryNav(activeRoleSlug);
  const supportEnabled = hasPermission('lex:support:create');
  const navCatalog = useMemo(
    () => primaryNavForRole(activeRoleSlug),
    [activeRoleSlug],
  );
  const personaHomeHref =
    navCatalog.find((item) => item.id === 'dashboard')?.href ?? '/lex';

  const activeHref = useMemo(
    () => activePrimaryHref(pathname, navCatalog),
    [navCatalog, pathname],
  );
  const moreActive = useMemo(
    () => !roleSpecificNav && isMorePathActive(pathname),
    [pathname, roleSpecificNav],
  );

  const items = useMemo(
    () => navCatalog.filter((item) => canAccessWith(hasPermission, item.permission)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- user + permissionsVersion are the reactive perm signals; hasPermission itself is a stable ref.
    [hasPermission, navCatalog, user, permissionsVersion],
  );

  // Split Settings out so the "More" overflow sits just before it (the flat
  // items lead, then More ▾, then Settings anchors the trailing edge).
  const settingsItem = useMemo(() => items.find((i) => i.id === 'settings'), [items]);
  const leadItems = useMemo(() => items.filter((i) => i.id !== 'settings'), [items]);

  // The "More" menu: filter each section's leaves through the SAME permission
  // resolver, then drop empty sections. If nothing survives, the trigger hides.
  const moreSections = useMemo(
    () =>
      roleSpecificNav
        ? []
        : LEX_PRIMARY_NAV_MORE.map((section) => ({
            ...section,
            items: section.items.filter((item) => canAccessWith(hasPermission, item.permission)),
          })).filter((section) => section.items.length > 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- perm signals as above.
    [hasPermission, roleSpecificNav, user, permissionsVersion],
  );

  const renderNavLink = (item: LexPrimaryNavItem) => {
    const isActive = item.href === activeHref;
    const label = locale === 'ar' ? item.labelAr : item.labelEn;
    return (
      <li key={item.id} className="shrink-0">
        <Link
          href={item.href}
          aria-current={isActive ? 'page' : undefined}
          className={cn(
            'group relative flex items-center rounded-lg px-3 py-1.5 text-body-sm font-medium',
            'transition-colors duration-fast ease-standard motion-reduce:transition-none',
            isActive
              ? 'text-white'
              : 'text-white/75 hover:bg-white/10 hover:text-white',
          )}
        >
          <span className="whitespace-nowrap">{label}</span>
          {isActive && (
            <span
              aria-hidden
              className="absolute inset-x-2 -bottom-2 h-[3px] rounded-full bg-brand-accent-500 shadow-[0_1px_8px_-2px_rgba(171,183,5,0.55)] motion-safe:animate-scale-in"
            />
          )}
        </Link>
      </li>
    );
  };

  return (
    <header
      dir={direction}
      className={cn(
        // Single unified WatheeqTech chrome: flat Deep Teal (#005E5E), La Rioja
        // accent at the very top. `dark` flips token-based children to
        // legible-on-teal; dropdowns portal out and keep the real theme.
        'dark sticky top-0 z-30 flex h-[calc(3.5rem+env(safe-area-inset-top))] shrink-0 items-center gap-3',
        'border-t-[3px] border-t-brand-accent-500 bg-brand-primary-600 text-white shadow-[0_10px_28px_-18px_rgba(0,0,0,0.55)]',
        'pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-[env(safe-area-inset-top)]',
        'sm:pl-[max(1.25rem,env(safe-area-inset-left))] sm:pr-[max(1.25rem,env(safe-area-inset-right))]',
        'lg:pl-[max(1.5rem,env(safe-area-inset-left))] lg:pr-[max(1.5rem,env(safe-area-inset-right))]',
      )}
    >
      {/* Mobile drawer trigger — the flat nav collapses into the shared MobileSidebar. */}
      <Button
        variant="ghost"
        size="icon"
        onClick={toggleMobileOpen}
        aria-label={shell('shell.openNavigationMenu')}
        className="shrink-0 border border-white/20 text-white/80 hover:bg-white/10 hover:text-white md:hidden"
      >
        <Menu className="h-4 w-4" aria-hidden />
      </Button>

      {/* Brand lockup → Overview home. */}
      <Link
        href={personaHomeHref}
        aria-label={locale === 'ar' ? 'وثيقتك — الرئيسية' : 'WatheeqTech home'}
        className="inline-flex shrink-0 items-center rounded-lg px-1 py-1 outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring/70"
      >
        <WatheeqLogo
          tone="onDark"
          locale={locale}
          height={26}
          className="hidden h-[26px] w-auto sm:block"
          decorative
        />
        <WatheeqLogo
          variant="mark"
          tone="onDark"
          height={26}
          className="h-[26px] w-[26px] sm:hidden"
          decorative
        />
      </Link>

      {/* Flat primary nav (desktop). Horizontally scrollable on overflow. */}
      <nav
        aria-label={shellLabels.sidebar.railLabel}
        className="hidden min-w-0 flex-1 md:block"
      >
        <ul className="flex min-w-0 items-center gap-1 overflow-x-auto py-2 ps-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {leadItems.map(renderNavLink)}

          {moreSections.length > 0 && (
            <li className="shrink-0">
              <DropdownMenu>
                <DropdownMenuTrigger
                  className={cn(
                    'group relative flex items-center gap-1 rounded-lg px-3 py-1.5 text-body-sm font-medium outline-none',
                    'transition-colors duration-fast ease-standard motion-reduce:transition-none',
                    'focus-visible:ring-2 focus-visible:ring-ring/70',
                    moreActive ? 'text-white' : 'text-white/75 hover:bg-white/10 hover:text-white',
                  )}
                >
                  <span className="whitespace-nowrap">
                    {locale === 'ar' ? 'المزيد' : 'More'}
                  </span>
                  <ChevronDown
                    className="h-3.5 w-3.5 shrink-0 transition-transform duration-fast group-data-[state=open]:rotate-180"
                    aria-hidden
                  />
                  {moreActive && (
                    <span
                      aria-hidden
                      className="absolute inset-x-2 -bottom-2 h-[3px] rounded-full bg-brand-accent-500 shadow-[0_1px_8px_-2px_rgba(171,183,5,0.55)]"
                    />
                  )}
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align={direction === 'rtl' ? 'end' : 'start'}
                  className="max-h-[70vh] w-60 overflow-y-auto"
                >
                  {moreSections.map((section, index) => (
                    <Fragment key={section.id}>
                      {index > 0 && <DropdownMenuSeparator />}
                      <DropdownMenuLabel className="text-caption uppercase tracking-wide text-muted-foreground">
                        {locale === 'ar' ? section.labelAr : section.labelEn}
                      </DropdownMenuLabel>
                      {section.items.map((item) => (
                        <DropdownMenuItem key={item.id} asChild>
                          <Link href={item.href} aria-current={item.href === activeHref ? 'page' : undefined}>
                            {locale === 'ar' ? item.labelAr : item.labelEn}
                          </Link>
                        </DropdownMenuItem>
                      ))}
                    </Fragment>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          )}

          {settingsItem && renderNavLink(settingsItem)}
        </ul>
      </nav>

      {/* Right cluster: keeps global search and account controls reachable at
          every breakpoint. The search field collapses to an icon before xl so
          the primary navigation keeps useful room on compact desktops. */}
      <div className="ms-auto flex shrink-0 items-center gap-2 md:ms-0">
        {supportEnabled ? (
          <AskForSupportButton
            compact
            context={supportContextFromPathname(pathname)}
            className="border border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white"
          />
        ) : null}
        <LexGlobalSearch className="shrink-0 xl:w-56 2xl:w-64" />
        <NotificationDropdown />
        {/* Language toggle stays reachable at every breakpoint — the app
            defaults to Arabic, so a mobile English user must not be stranded. */}
        <LocaleQuickToggle />
        <UserMenu />
      </div>
      {supportEnabled ? <SupportComposerHost /> : null}
    </header>
  );
});
