'use client';

/**
 * Lex SIDEBARLESS top navigation bar.
 *
 * Replaces the legacy left rail ({@link import('./lex-sidebar').LexSidebar}) for
 * the Watheeq / Lex surface. It is rendered by the platform shell
 * (`app/(dashboard)/layout.tsx`) — but ONLY while the active route is under
 * `/lex` — as a full-width bar directly beneath the global `Header`, in place of
 * the persistent desktop `Sidebar`. Other suites keep their sidebar untouched.
 *
 * Layout (hybrid model, organized around legal work):
 *
 *   ┌────────────────────────────────────────────────────────────────────────┐
 *   │ ‹Daily Work, flat + scrollable›                 │ Governance▾ Insights▾ │
 *   │  Legal Services · Consultations …               │                       │
 *   └────────────────────────────────────────────────────────────────────────┘
 *
 * - The WatheeqTech wordmark lockup lives in the global header immediately
 *   above this row and links home to the Overview.
 * - Daily Work renders as flat tab-style links, prioritizing the queue and core
 *   matters people use repeatedly. It remains horizontally scrollable.
 * - Governance, Insights, and Admin collapse into pinned dropdown menus at the
 *   trailing edge. A menu whose group owns the active route is marked.
 * - Every entry is permission-gated via {@link canAccessWith}; a group with no
 *   surviving routes is dropped. Everything also stays reachable through the
 *   shared ⌘K command palette — this bar is the persistent, glanceable layer.
 *
 * Shared source of truth: {@link LEX_NAV_GROUPS} + {@link activeRouteHref}
 * (`./lex-routes`) drive both this bar and the palette, so they never drift.
 * Bilingual + RTL via {@link useLexShellLabels} and the active locale `dir`.
 * Desktop only (`md:flex`); on mobile the shared drawer + ⌘K cover navigation.
 */

import { memo, useMemo } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLocale } from '@/components/providers/locale-provider';
import { useAuth } from '@/hooks/use-auth';
import { canAccessWith } from '@/lib/permissions';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  LEX_DAILY_NAV_CLUSTERS,
  LEX_NAV_GROUPS,
  activeRouteHref,
  type LexDailyNavClusterId,
  type LexNavGroup,
  type LexNavRoute,
} from './lex-routes';
import { useLexShellLabels } from './lex-shell-labels';

/** Task-oriented groups rendered after the compact Daily Work rail. */
const MENU_GROUP_IDS = ['governance', 'insights', 'administration'] as const;

type DailyNavItem =
  | { kind: 'route'; route: LexNavRoute }
  | {
      kind: 'cluster';
      id: LexDailyNavClusterId;
      routes: LexNavRoute[];
    };

export const LexTopNav = memo(function LexTopNav() {
  const pathname = usePathname() ?? '';
  const { direction } = useLocale();
  const labels = useLexShellLabels();
  const { hasPermission } = useAuth();
  const isRtl = direction === 'rtl';

  const activeHref = useMemo(() => activeRouteHref(pathname), [pathname]);

  // Permission gating (§7): filter every route through the same
  // `canAccessWith` resolver the sidebar/mobile nav/command palette use, so a
  // persona never sees a module their RBAC keys don't grant. A dropdown group
  // with no surviving routes is dropped entirely.
  const visibleRoutes = useMemo(
    () => (routes: LexNavRoute[]) =>
      routes.filter((route) => canAccessWith(hasPermission, route.permission)),
    [hasPermission],
  );

  const modules = useMemo(() => {
    const group = LEX_NAV_GROUPS.find((g) => g.id === 'daily_work');
    return group ? visibleRoutes(group.routes) : [];
  }, [visibleRoutes]);

  const dailyNavItems = useMemo<DailyNavItem[]>(() => {
    const routesById = new Map(modules.map((route) => [route.id, route]));
    const renderedClusters = new Set<LexDailyNavClusterId>();

    return modules.flatMap((route): DailyNavItem[] => {
      const cluster = LEX_DAILY_NAV_CLUSTERS.find(({ routeIds }) =>
        routeIds.includes(route.id),
      );

      if (!cluster) return [{ kind: 'route', route }];
      if (renderedClusters.has(cluster.id)) return [];
      renderedClusters.add(cluster.id);

      const visibleClusterRoutes = cluster.routeIds.flatMap((routeId) => {
        const visibleRoute = routesById.get(routeId);
        return visibleRoute ? [visibleRoute] : [];
      });

      // Do not advertise access the current persona does not hold. When only
      // one child survives RBAC filtering, retain a direct, specifically named
      // link instead of presenting a one-item combined-domain menu.
      if (visibleClusterRoutes.length === 1) {
        return [{ kind: 'route', route: visibleClusterRoutes[0] }];
      }

      return [
        { kind: 'cluster', id: cluster.id, routes: visibleClusterRoutes },
      ];
    });
  }, [modules]);

  const menuGroups = useMemo(
    () =>
      MENU_GROUP_IDS.map((id) => LEX_NAV_GROUPS.find((g) => g.id === id))
        .filter((g): g is LexNavGroup => Boolean(g))
        .map((g) => ({ id: g.id, routes: visibleRoutes(g.routes) }))
        .filter((g) => g.routes.length > 0),
    [visibleRoutes],
  );

  return (
    <nav
      dir={direction}
      aria-label={labels.sidebar.railLabel}
      className={cn(
        'lex-top-nav relative isolate hidden shrink-0 items-center gap-2 px-4 md:flex',
        'shadow-elevation-2 sm:px-5 lg:px-6',
      )}
    >
      {/* Nav base is pure #005E5E (var(--lex-top-nav-bg)), so it is pixel-identical
          to the deep-teal Header above it. NOTE: the previous 5% accent-gradient
          wash overlay was removed — it tinted this row slightly greener than the
          header and broke the seamless single-block chrome. A solid La Rioja
          hairline marks the base where the chrome meets the cream content. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-px bg-brand-accent-500"
      />

      <div className="relative min-w-0 flex-1">
        <ul
          className="flex min-w-0 items-center gap-1 overflow-x-auto py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {dailyNavItems.map((item) => {
            if (item.kind === 'cluster') {
              const Icon = item.routes[0].icon;
              const isActive = item.routes.some(
                (route) => route.href === activeHref,
              );
              const label = labels.clusters[item.id];

              return (
                <li key={item.id} className="shrink-0">
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      className={cn(
                        'group relative flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-body-sm font-medium outline-none',
                        'transition-colors duration-fast ease-standard motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-ring/70',
                        isActive
                          ? 'bg-[var(--lex-top-nav-active)] text-white shadow-elevation-2'
                          : 'text-white/80 hover:bg-white/10 hover:text-white',
                      )}
                    >
                      <Icon
                        className={cn(
                          'h-[15px] w-[15px] shrink-0 transition-colors',
                          isActive
                            ? 'text-white'
                            : 'text-white/55 group-hover:text-white',
                        )}
                        aria-hidden
                      />
                      <span className="whitespace-nowrap">{label}</span>
                      <ChevronDown
                        className={cn(
                          'h-3.5 w-3.5 shrink-0 transition-transform duration-fast group-data-[state=open]:rotate-180',
                          isActive ? 'text-white' : 'text-white/60',
                        )}
                        aria-hidden
                      />
                      {isActive && (
                        <span
                          aria-hidden
                          className="absolute inset-x-2 -bottom-2 h-[3px] rounded-full bg-brand-accent-500 shadow-[0_1px_8px_-2px_rgba(171,183,5,0.55)] motion-safe:animate-scale-in"
                        />
                      )}
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="start"
                      sideOffset={8}
                      className="min-w-[15rem]"
                    >
                      {item.routes.map((route) => {
                        const RouteIcon = route.icon;
                        const routeActive = route.href === activeHref;
                        return (
                          <DropdownMenuItem key={route.id} asChild>
                            <Link
                              href={route.href}
                              aria-current={routeActive ? 'page' : undefined}
                              className={cn(
                                'gap-2.5',
                                routeActive &&
                                  'bg-brand-accent/10 text-primary',
                              )}
                            >
                              <RouteIcon
                                className={cn(
                                  'h-4 w-4 shrink-0',
                                  routeActive
                                    ? 'text-brand-accent'
                                    : 'text-foreground/50',
                                )}
                                aria-hidden
                              />
                              <span>{labels.routes[route.id] ?? route.id}</span>
                            </Link>
                          </DropdownMenuItem>
                        );
                      })}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </li>
              );
            }

            const route = item.route;
            const Icon = route.icon;
            const isActive = route.href === activeHref;
            const label = labels.routes[route.id] ?? route.id;
            return (
              <li key={route.id} className="shrink-0">
                <Link
                  href={route.href}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    'group relative flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-body-sm font-medium',
                    'transition-colors duration-fast ease-standard motion-reduce:transition-none',
                    isActive
                      ? 'bg-[var(--lex-top-nav-active)] text-white shadow-elevation-2'
                      : 'text-white/80 hover:bg-white/10 hover:text-white',
                  )}
                >
                  <Icon
                    className={cn(
                      'h-[15px] w-[15px] shrink-0 transition-colors',
                      isActive
                        ? 'text-white'
                        : 'text-white/55 group-hover:text-white',
                    )}
                    aria-hidden
                  />
                  <span className="whitespace-nowrap">{label}</span>
                  {/* 2px active underline (tab affordance); flips nothing — it is
                      centered, so RTL-safe by construction. */}
                  {isActive && (
                    <span
                      aria-hidden
                      className="absolute inset-x-2 -bottom-2 h-[3px] rounded-full bg-brand-accent-500 shadow-[0_1px_8px_-2px_rgba(171,183,5,0.55)] motion-safe:animate-scale-in"
                    />
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Divider between the scrollable primary links and the pinned menus. */}
      {menuGroups.length > 0 && (
        <span className="h-5 w-px shrink-0 bg-white/15" aria-hidden />
      )}

      {/* Governance / Insights / Admin — pinned dropdown menus. */}
      <div className="flex shrink-0 items-center gap-1 py-2">
        {menuGroups.map((group) => {
          const groupActive = group.routes.some((r) => r.href === activeHref);
          const groupLabel = labels.groups[group.id];
          return (
            <DropdownMenu key={group.id}>
              <DropdownMenuTrigger
                className={cn(
                  'group flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-body-sm font-medium outline-none',
                  'transition-colors duration-fast ease-standard focus-visible:ring-2 focus-visible:ring-ring/70',
                  groupActive
                    ? 'bg-[var(--lex-top-nav-active)] text-white shadow-elevation-2'
                    : 'text-white/80 hover:bg-white/10 hover:text-white',
                )}
              >
                <span className="whitespace-nowrap">{groupLabel}</span>
                <ChevronDown
                  className={cn(
                    'h-3.5 w-3.5 shrink-0 transition-transform duration-fast group-data-[state=open]:rotate-180',
                    groupActive ? 'text-white' : 'text-white/60',
                  )}
                  aria-hidden
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align={isRtl ? 'start' : 'end'}
                sideOffset={8}
                className="min-w-[13rem]"
              >
                {group.routes.map((route) => {
                  const Icon = route.icon;
                  const isActive = route.href === activeHref;
                  const label = labels.routes[route.id] ?? route.id;
                  return (
                    <DropdownMenuItem key={route.id} asChild>
                      <Link
                        href={route.href}
                        aria-current={isActive ? 'page' : undefined}
                        className={cn(
                          'gap-2.5',
                          isActive && 'bg-brand-accent/10 text-primary',
                        )}
                      >
                        <Icon
                          className={cn(
                            'h-4 w-4 shrink-0',
                            isActive
                              ? 'text-brand-accent'
                              : 'text-foreground/50',
                          )}
                          aria-hidden
                        />
                        <span className="truncate">{label}</span>
                      </Link>
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          );
        })}
      </div>
    </nav>
  );
});
