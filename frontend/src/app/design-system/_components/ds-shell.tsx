'use client';

/**
 * DsShell — shared chrome for the internal design-system reference pages.
 *
 * Header (title + live theme/dir toggles) + subnav across the /design-system
 * area. Internal, English-only surface — but it still uses logical utilities
 * so the RTL preview toggle renders it correctly.
 */

import * as React from 'react';
import Link from 'next/link';
import { Monitor, Moon, PanelLeftOpen, PanelRightOpen, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type DsShellPage =
  | 'catalog'
  | 'do-dont'
  | 'gallery'
  | 'dashboard'
  | 'marketing';

const NAV_ITEMS: ReadonlyArray<{ id: DsShellPage; label: string; href: string }> = [
  { id: 'catalog', label: 'Catalog', href: '/design-system' },
  { id: 'do-dont', label: 'Do & Don’t', href: '/design-system/do-dont' },
  { id: 'gallery', label: 'Story gallery', href: '/design-system/gallery' },
  { id: 'dashboard', label: 'DR proof dashboard', href: '/design-system/dashboard' },
  { id: 'marketing', label: 'Marketing proof', href: '/design-system/marketing' },
];

/* -------------------------------------------------------------------------- */
/* Theme + direction toggles                                                   */
/* -------------------------------------------------------------------------- */

type Dir = 'ltr' | 'rtl';

function segmentedButtonClass(active: boolean): string {
  return cn(
    'h-8 gap-1.5 rounded-lg px-2.5 text-xs font-medium',
    active
      ? 'bg-primary/10 text-primary shadow-elevation-1 hover:bg-primary/10 hover:text-primary'
      : 'text-muted-foreground hover:text-foreground',
  );
}

function SegmentedGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex items-center gap-0.5 rounded-xl border border-border/70 bg-card p-0.5 shadow-elevation-1"
    >
      {children}
    </div>
  );
}

/**
 * Interactive theme (light/dark/system via next-themes) + direction
 * (ltr/rtl, stamped on <html dir>) toggles so reviewers can flip every
 * specimen live without leaving the page.
 *
 * The dir toggle is a *preview* control: it writes the `dir` attribute the
 * LocaleProvider set from the active locale, without changing the locale, so
 * reviewers can audit mirroring with English copy.
 */
export function ThemeDirToggles({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  const [dir, setDir] = React.useState<Dir>('rtl');

  React.useEffect(() => {
    setMounted(true);
    const current = document.documentElement.getAttribute('dir');
    setDir(current === 'ltr' ? 'ltr' : 'rtl');
  }, []);

  const applyDir = React.useCallback((next: Dir) => {
    document.documentElement.setAttribute('dir', next);
    setDir(next);
  }, []);

  const themeOptions = [
    { value: 'light', label: 'Light', icon: Sun },
    { value: 'dark', label: 'Dark', icon: Moon },
    { value: 'system', label: 'System', icon: Monitor },
  ] as const;

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <SegmentedGroup label="Theme">
        {themeOptions.map(({ value, label, icon: Icon }) => {
          const active = mounted && theme === value;
          return (
            <Button
              key={value}
              type="button"
              variant="ghost"
              size="sm"
              aria-pressed={active}
              onClick={() => setTheme(value)}
              className={segmentedButtonClass(active)}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden />
              {label}
            </Button>
          );
        })}
      </SegmentedGroup>

      <SegmentedGroup label="Text direction (preview)">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-pressed={mounted && dir === 'ltr'}
          onClick={() => applyDir('ltr')}
          className={segmentedButtonClass(mounted && dir === 'ltr')}
        >
          <PanelLeftOpen className="h-3.5 w-3.5" aria-hidden />
          LTR
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-pressed={mounted && dir === 'rtl'}
          onClick={() => applyDir('rtl')}
          className={segmentedButtonClass(mounted && dir === 'rtl')}
        >
          <PanelRightOpen className="h-3.5 w-3.5" aria-hidden />
          RTL
        </Button>
      </SegmentedGroup>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Shell                                                                       */
/* -------------------------------------------------------------------------- */

export function DsShell({
  active,
  children,
}: {
  active: DsShellPage;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <a
        href="#ds-main"
        className="sr-only rounded-button bg-card px-4 py-2 text-sm font-semibold text-foreground shadow-elevation-2 focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-50 focus:outline-none focus:ring-2 focus:ring-ring"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-40 border-b border-border/70 bg-background/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-primary bg-[image:var(--ds-gradient-primary)] text-xs font-bold text-primary-foreground shadow-elevation-1"
            >
              DS
            </span>
            <div className="flex flex-col leading-tight">
              <span className="text-sm font-bold text-foreground">
                Clario360 design system
              </span>
              <span className="text-xs text-muted-foreground">
                Internal living reference — English only
              </span>
            </div>
          </div>
          <ThemeDirToggles />
        </div>

        <nav
          aria-label="Design-system pages"
          className="mx-auto w-full max-w-7xl overflow-x-auto px-4 sm:px-6"
        >
          <ul className="flex items-center gap-1 pb-2">
            {NAV_ITEMS.map((item) => {
              const isActive = item.id === active;
              return (
                <li key={item.id}>
                  <Link
                    href={item.href}
                    aria-current={isActive ? 'page' : undefined}
                    className={cn(
                      'inline-flex h-8 items-center whitespace-nowrap rounded-lg px-3 text-xs font-medium outline-none',
                      'transition-colors duration-fast ease-standard',
                      'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
                      isActive
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:bg-accent/70 hover:text-foreground',
                    )}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </header>

      <main id="ds-main" className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
        {children}
      </main>
    </div>
  );
}
