'use client';

/**
 * Lex-scoped sub-navigation rail. Renders INSIDE the global dashboard shell (to
 * the right of the app's primary sidebar in LTR), giving the legal suite its own
 * grouped, collapsible domain navigation.
 *
 * - Grouped per {@link LEX_NAV_GROUPS} (Daily Work / Governance / Insights / Admin).
 * - Single active entry via longest-prefix match ({@link activeRouteHref}).
 * - 3px leading accent bar on the active item; RTL-aware (accent + chevrons
 *   flip; collapse chevron mirrors with direction).
 * - Collapsible, persisted to `localStorage['lex.sidebar.collapsed']`,
 *   SSR-safe (defaults expanded until mounted).
 * - Bilingual labels via {@link useLexShellLabels}; `dir` set on the rail.
 */

import { memo, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronLeft, ChevronRight, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLocale } from '@/components/providers/locale-provider';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { LEX_NAV_GROUPS, activeRouteHref } from './lex-routes';
import { useLexShellLabels } from './lex-shell-labels';

const COLLAPSE_KEY = 'lex.sidebar.collapsed';

export const LexSidebar = memo(function LexSidebar() {
  const pathname = usePathname() ?? '';
  const { direction } = useLocale();
  const labels = useLexShellLabels();
  const isRtl = direction === 'rtl';

  const [collapsed, setCollapsed] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Hydrate the persisted collapse state after mount (SSR renders expanded).
  useEffect(() => {
    setMounted(true);
    try {
      setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === '1');
    } catch {
      /* ignore */
    }
  }, []);

  const toggle = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const activeHref = useMemo(() => activeRouteHref(pathname), [pathname]);

  const CollapseIcon = isRtl ? PanelLeftOpen : PanelLeftClose;
  const ExpandIcon = isRtl ? ChevronLeft : ChevronRight;

  return (
    <TooltipProvider delayDuration={300}>
      <aside
        dir={direction}
        aria-label={labels.sidebar.railLabel}
        data-collapsed={collapsed}
        className={cn(
          'shell-sidebar relative hidden shrink-0 flex-col overflow-hidden rounded-3xl border text-sm shadow-elevation-2 md:flex',
          'transition-[width] duration-normal ease-emphasized motion-reduce:transition-none',
          // Avoid a flash of the wrong width before hydration resolves the pref.
          mounted && collapsed ? 'w-[68px]' : 'w-[232px]',
        )}
      >
        {/* Header / brand — `.shell-sidebar` paints a dark gradient, so all
            chrome here is white-on-dark (mirrors the primary app sidebar). */}
        <div className="border-b border-white/10 px-3 py-3">
          <Link
            href="/lex"
            className={cn(
              'group flex items-center gap-2.5 rounded-2xl px-2 py-1.5 transition-colors hover:bg-[var(--sidebar-hover)]',
              collapsed && 'justify-center px-0',
            )}
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[15px] font-bold text-white [background:var(--ds-gradient-primary)]">
              ع
            </span>
            {!collapsed && (
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-semibold tracking-tight text-white">
                  {labels.sidebar.suiteName}
                </span>
                <span className="block truncate text-overline uppercase tracking-caps-wide text-brand-gold">
                  {labels.sidebar.suiteTagline}
                </span>
              </span>
            )}
          </Link>
        </div>

        {/* Grouped nav */}
        <nav className="sidebar-scroll flex-1 overflow-y-auto overflow-x-hidden px-2.5 py-3">
          {LEX_NAV_GROUPS.map((group) => (
            <div key={group.id} className="mb-3 last:mb-0">
              {!collapsed && (
                <p className="px-2 pb-1 pt-1 text-overline font-semibold uppercase tracking-caps-wide text-white/40">
                  {labels.groups[group.id]}
                </p>
              )}
              {collapsed && <div className="mx-2 mb-1.5 h-px bg-white/10 first:hidden" />}
              <ul className="space-y-0.5">
                {group.routes.map((route) => {
                  const Icon = route.icon;
                  const isActive = route.href === activeHref;
                  const label = labels.routes[route.id] ?? route.id;

                  const link = (
                    <Link
                      href={route.href}
                      aria-current={isActive ? 'page' : undefined}
                      className={cn(
                        'shell-sidebar-item group relative flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-[13px] font-medium',
                        'transition-[transform,background-color,color] duration-fast ease-standard motion-reduce:transition-none',
                        collapsed && 'justify-center px-0',
                        isActive
                          ? 'is-active text-white ring-1 ring-inset ring-white/15'
                          : 'text-white/65 hover:text-white motion-safe:hover:translate-x-0.5 rtl:motion-safe:hover:-translate-x-0.5 motion-reduce:hover:translate-x-0',
                      )}
                    >
                      {/* 3px leading accent on active (flips side in RTL). */}
                      {isActive && (
                        <span
                          aria-hidden
                          className="absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-brand-gold rtl:left-auto rtl:right-0 motion-safe:animate-scale-in"
                        />
                      )}
                      <Icon
                        className={cn(
                          'h-[18px] w-[18px] shrink-0 duration-fast ease-standard',
                          isActive
                            ? 'text-white'
                            : 'text-white/55 group-hover:text-white',
                        )}
                        aria-hidden
                      />
                      {!collapsed && <span className="truncate">{label}</span>}
                    </Link>
                  );

                  return (
                    <li key={route.id}>
                      {collapsed ? (
                        <Tooltip>
                          <TooltipTrigger asChild>{link}</TooltipTrigger>
                          <TooltipContent side={isRtl ? 'left' : 'right'} sideOffset={8}>
                            {label}
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        link
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        {/* Collapse toggle */}
        <div className="border-t border-white/10 px-2.5 py-2">
          <button
            type="button"
            onClick={toggle}
            aria-label={collapsed ? labels.sidebar.expand : labels.sidebar.collapse}
            className={cn(
              'flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-[12px] font-medium text-white/60',
              'transition-colors duration-fast ease-standard hover:bg-[var(--sidebar-hover)] hover:text-white',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70',
              collapsed && 'justify-center px-0',
            )}
          >
            {collapsed ? (
              <ExpandIcon className="h-4 w-4" aria-hidden />
            ) : (
              <>
                <CollapseIcon className="h-4 w-4" aria-hidden />
                <span className="flex-1 text-start uppercase tracking-caps-wide">
                  {labels.sidebar.collapse}
                </span>
                {isRtl ? (
                  <ChevronRight className="h-4 w-4" aria-hidden />
                ) : (
                  <ChevronLeft className="h-4 w-4" aria-hidden />
                )}
              </>
            )}
          </button>
        </div>
      </aside>
    </TooltipProvider>
  );
});
