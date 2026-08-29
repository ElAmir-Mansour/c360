'use client';

import { memo } from 'react';
import Link from 'next/link';
import { Menu, Search } from 'lucide-react';
import { WatheeqLogo } from '@/components/brand/watheeq-logo';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { useSidebar } from '@/hooks/use-sidebar';
import { useIsMobile } from '@/hooks/use-media-query';
import { useCommandPalette } from '@/hooks/use-command-palette';
import { useNotificationStore } from '@/stores/notification-store';
import { cn } from '@/lib/utils';
import { Breadcrumbs } from './breadcrumbs';
import { NotificationDropdown } from './notification-dropdown';
import { TenantSwitcher } from './tenant-switcher';
import { UserMenu } from './user-menu';
import { ThemeLocaleSwitcher } from './theme-locale-switcher';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { ConnectionStatus } from '@/types/models';
import { useNavigationLabels } from './navigation-labels';
import type { MessageKey } from '@/lib/i18n/messages';

const STATUS_META: Record<
  ConnectionStatus,
  { labelKey: MessageKey; dot: string; text: string; ring: string; pulse: boolean }
> = {
  connected: {
    labelKey: 'shell.live',
    dot: 'bg-success-500',
    text: 'text-success-600',
    ring: 'border-success-500/25 bg-success-500/10',
    pulse: true,
  },
  connecting: {
    labelKey: 'shell.connecting',
    dot: 'bg-warning-500',
    text: 'text-warning-700 dark:text-warning-300',
    ring: 'border-warning-500/25 bg-warning-500/10',
    pulse: true,
  },
  reconnecting: {
    labelKey: 'shell.reconnecting',
    dot: 'bg-warning-500',
    text: 'text-warning-700 dark:text-warning-300',
    ring: 'border-warning-500/25 bg-warning-500/10',
    pulse: true,
  },
  disconnected: {
    labelKey: 'shell.offline',
    dot: 'bg-foreground/40',
    text: 'text-foreground',
    ring: 'border-primary/15 bg-foreground/5',
    pulse: false,
  },
  failed: {
    labelKey: 'shell.offline',
    dot: 'bg-rose-500',
    text: 'text-rose-600',
    ring: 'border-rose-500/25 bg-rose-500/10',
    pulse: false,
  },
};

export const Header = memo(function Header({ watheeq = false }: { watheeq?: boolean }) {
  const { toggleMobileOpen } = useSidebar();
  const isMobile = useIsMobile();
  const { setOpen } = useCommandPalette();
  const { locale } = useLocaleOrDefault();
  const connectionStatus = useNotificationStore((s) => s.connectionStatus);
  const { shell } = useNavigationLabels();

  const status = STATUS_META[connectionStatus] ?? STATUS_META.disconnected;
  const statusLabel = shell(status.labelKey);
  const connectionLabel = shell('shell.realTimeConnection');

  const isMac = typeof window !== 'undefined'
    ? navigator.platform.toUpperCase().includes('MAC')
    : true;
  const shortcutLabel = isMac ? '⌘K' : 'Ctrl+K';

  return (
    <TooltipProvider>
      <header
        className={cn(
          'sticky top-0 z-30 flex h-[calc(3.5rem+env(safe-area-inset-top))] shrink-0 items-center justify-between pb-0 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-[env(safe-area-inset-top)] backdrop-blur-xl sm:pl-[max(1.25rem,env(safe-area-inset-left))] sm:pr-[max(1.25rem,env(safe-area-inset-right))] lg:pl-[max(1.5rem,env(safe-area-inset-left))] lg:pr-[max(1.5rem,env(safe-area-inset-right))]',
          watheeq
            ? // Unified WatheeqTech chrome: Deep Teal (#005E5E) bar merged with
              // the LexTopNav below it, La Rioja (#ABB705) accent at the very top.
              // `dark` flips the breadcrumb/search/menus to legible-on-dark tokens;
              // dropdowns portal out so they keep the real app theme.
              // The `-500` leaf pins canonical La Rioja rather than the
              // brighter theme-aware accent used for dark-mode content.
              'dark border-t-[3px] border-t-brand-accent-500 bg-brand-primary-600 text-white shadow-[0_10px_28px_-18px_rgba(0,0,0,0.55)]'
            : 'border-b border-primary/12 bg-card/92 shadow-[0_8px_24px_-20px_rgba(15,23,42,0.18)]',
        )}
      >
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {isMobile && (
            <button
              onClick={toggleMobileOpen}
              aria-label={shell('shell.openNavigationMenu')}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-primary/15 bg-card text-foreground/65 shadow-sm transition-all hover:border-primary/30 hover:bg-secondary hover:text-primary"
            >
              <Menu className="h-4 w-4" />
            </button>
          )}
          {watheeq && (
            <Link
              href="/lex"
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
          )}
          <div className="min-w-0">
            <Breadcrumbs />
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Tooltip delayDuration={300}>
            <TooltipTrigger asChild>
              <span
                role="status"
                aria-live="polite"
                aria-label={`${connectionLabel}: ${statusLabel}`}
                className={cn(
                  'hidden h-8 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-semibold sm:inline-flex',
                  status.ring,
                  status.text,
                )}
              >
                <span className="relative flex h-2 w-2">
                  {status.pulse && connectionStatus === 'connected' && (
                    <span
                      className={cn(
                        'absolute inline-flex h-full w-full rounded-full opacity-60 motion-safe:animate-ping motion-reduce:hidden',
                        status.dot,
                      )}
                      aria-hidden="true"
                    />
                  )}
                  <span className={cn('relative inline-flex h-2 w-2 rounded-full', status.dot)} />
                </span>
                <span className="hidden md:inline">{statusLabel}</span>
              </span>
            </TooltipTrigger>
            <TooltipContent>{connectionLabel}: {statusLabel}</TooltipContent>
          </Tooltip>

          <Tooltip delayDuration={300}>
            <TooltipTrigger asChild>
              <button
                onClick={() => setOpen(true)}
                aria-label={`${shell('shell.search')} (${shortcutLabel})`}
                className="inline-flex h-9 items-center gap-2.5 rounded-lg border border-primary/20 bg-card px-3 text-[13px] text-foreground shadow-sm transition-all hover:border-primary/35 hover:bg-secondary"
              >
                <Search className="h-3.5 w-3.5 text-primary" />
                {!isMobile && (
                  <>
                    <span className="hidden lg:inline font-medium">{shell('shell.searchOrJumpTo')}</span>
                    <span className="rounded bg-foreground/85 px-1.5 py-0.5 text-overline font-semibold tracking-wide text-background">
                      {shortcutLabel}
                    </span>
                  </>
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent>{shell('shell.search')} ({shortcutLabel})</TooltipContent>
          </Tooltip>

          <TenantSwitcher />
          <ThemeLocaleSwitcher />
          <NotificationDropdown />
          <UserMenu />
        </div>
      </header>
    </TooltipProvider>
  );
});
