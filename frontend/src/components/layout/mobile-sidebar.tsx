'use client';

import { useEffect, useMemo, useRef } from 'react';
import { X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useSidebar } from '@/hooks/use-sidebar';
import { useAuth } from '@/hooks/use-auth';
import { useBadgeCounts } from '@/hooks/use-badge-counts';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SidebarSection } from './sidebar-section';
import { SidebarTierHeader } from './sidebar-tier-header';
import { SidebarNavItem } from './sidebar-nav-item';
import { SidebarUserFooter } from './sidebar-user-footer';
import { Logo } from '@/components/brand/logo';
import { WatheeqLogo } from '@/components/brand/watheeq-logo';
import { SuiteSwitcher } from './suite-switcher';
import {
  navigation,
  filterSectionsForRoute,
  filterRecoverNavByEntitlement,
  filterNavItems,
  canAccessNavBadge,
  collectNavBadgeConfigs,
  groupSectionsByTier,
  resolveTierLabel,
  isWatheeqNavContext,
  SUITES,
  WATHEEQ_BRAND_TIER_ID,
  WATHEEQ_BRAND_TIER_LABEL,
  WATHEEQ_LOGO_TAGLINE,
  WATHEEQ_LOGO_TAGLINE_AR,
  type NavItem,
  type NavSection,
} from '@/config/navigation';
import { canAccessWith } from '@/lib/permissions';
import { useRecoverProducts } from '@/lib/recover/use-recover-products';
import { entitledSubSolutionSlugs } from '@/lib/recover/products';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { useNavigationLabels } from './navigation-labels';
import { useStickySuiteSegment } from './use-sticky-suite';
import { LEX_NAV_GROUPS } from '@/components/lex/shell/lex-routes';
import { useLexShellLabels } from '@/components/lex/shell/lex-shell-labels';

type VisibleSection = NavSection & { visibleItems: NavItem[] };

export function MobileSidebar() {
  const { mobileOpen, setMobileOpen } = useSidebar();
  const { hasPermission } = useAuth();
  const pathname = usePathname();
  const { nav, shell } = useNavigationLabels();
  const lexLabels = useLexShellLabels();
  const { locale } = useLocaleOrDefault();
  const panelRef = useRef<HTMLElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const recoverProductsQuery = useRecoverProducts();
  const entitledRecoverSlugs = useMemo<string[] | null>(() => {
    if (!recoverProductsQuery.isSuccess) return null;
    return entitledSubSolutionSlugs(recoverProductsQuery.data);
  }, [recoverProductsQuery.isSuccess, recoverProductsQuery.data]);
  // WatheeqTech brand presentation: mirror the desktop rail's experience,
  // including the sticky suite context on global routes.
  const effectiveSegment = useStickySuiteSegment(pathname);
  const watheeqMode = useMemo(() => {
    const accessible = SUITES.filter((suite) => canAccessWith(hasPermission, suite.permission));
    return isWatheeqNavContext(effectiveSegment, accessible);
  }, [hasPermission, effectiveSegment]);
  const navTree = useMemo(
    () =>
      watheeqMode
        ? LEX_NAV_GROUPS.map<NavSection>((group) => ({
            id: `lex-${group.id}`,
            label: lexLabels.groups[group.id],
            permission: '*:read',
            tier: WATHEEQ_BRAND_TIER_ID,
            items: group.routes.map((route) => ({
              ...route,
              label: lexLabels.routes[route.id] ?? route.id,
            })),
          }))
        : navigation,
    [lexLabels.groups, lexLabels.routes, watheeqMode],
  );
  const visibleSections = useMemo(
    () =>
      filterRecoverNavByEntitlement(
        filterSectionsForRoute(navTree, pathname, effectiveSegment),
        entitledRecoverSlugs,
      )
        .filter(
          (section) =>
            section.permission === '*:read' || hasPermission(section.permission),
        )
        .map((section) => ({
          ...section,
          visibleItems: filterNavItems(section.items, hasPermission),
        }))
        .filter((section) => section.visibleItems.length > 0),
    [hasPermission, pathname, effectiveSegment, entitledRecoverSlugs, navTree],
  );
  const badgeConfigs = useMemo(
    () =>
      mobileOpen
        ? visibleSections.flatMap((section) =>
            collectNavBadgeConfigs(section.visibleItems, hasPermission),
          )
        : [],
    [hasPermission, mobileOpen, visibleSections],
  );
  const badgeCounts = useBadgeCounts(badgeConfigs);

  // Group the visible sections into the five platform-architecture tiers so the
  // mobile drawer mirrors the desktop rail's tiered structure.
  const tierGroups = useMemo(() => groupSectionsByTier(visibleSections), [visibleSections]);

  // Focus management: trap focus inside the open drawer, focus the first item on
  // open, close on Escape, and restore focus to the trigger on close (WCAG 2.4.3 / 2.1.2).
  useEffect(() => {
    if (!mobileOpen) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const getFocusable = () =>
      panelRef.current
        ? Array.from(
            panelRef.current.querySelectorAll<HTMLElement>(
              'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
            ),
          ).filter((el) => el.offsetParent !== null)
        : [];
    getFocusable()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMobileOpen(false);
        return;
      }
      if (event.key !== 'Tab') return;
      const items = getFocusable();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previousFocusRef.current?.focus?.();
    };
  }, [mobileOpen, setMobileOpen]);

  if (!mobileOpen) return null;

  return (
    <TooltipProvider>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
        onClick={() => setMobileOpen(false)}
        aria-hidden="true"
      />

      {/* Sidebar panel */}
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={shell('shell.mobileNavigation')}
        data-watheeq={watheeqMode ? 'true' : undefined}
        className={cn(
          'fixed bottom-[max(0.75rem,env(safe-area-inset-bottom))] left-[max(0.75rem,env(safe-area-inset-left))] top-[max(0.75rem,env(safe-area-inset-top))] z-50 flex w-[calc(100vw-1.5rem)] max-w-[320px] flex-col overflow-hidden rounded-softest border border-[color:var(--sidebar-border)] [background:var(--sidebar-bg)] text-white shadow-[0_35px_85px_-45px_rgba(15,23,42,0.9)]',
          'animate-in slide-in-from-left-0 duration-200 rtl:left-auto rtl:right-[max(0.75rem,env(safe-area-inset-right))] rtl:slide-in-from-right-0',
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-4">
          <Link
            href="/dashboard"
            aria-label={watheeqMode ? 'وثيقتك' : 'Clario360 home'}
            className="flex items-center gap-3"
            onClick={() => setMobileOpen(false)}
          >
            {watheeqMode ? (
              // WatheeqTech lockup.
              <div>
                <WatheeqLogo variant="wordmark" tone="onDark" locale={locale} className="h-8 w-auto" title="وثيقتك" />
                <p className="mt-1 text-overline uppercase tracking-caps-xwide text-[color:var(--sidebar-muted)]">
                  {locale === 'ar' ? WATHEEQ_LOGO_TAGLINE_AR : WATHEEQ_LOGO_TAGLINE}
                </p>
              </div>
            ) : (
              <>
                <Logo variant="mark" tone="onDark" className="h-10 w-10 shrink-0" decorative />
                <div>
                  <Logo variant="wordmark" tone="onDark" className="h-5 w-auto" title="Clario360" />
                  <p className="mt-1 text-overline uppercase tracking-caps-xwide text-[color:var(--sidebar-muted)]">
                    {locale === 'ar'
                      ? 'منصة الذكاء المؤسسي'
                      : 'The Enterprise Intelligence Platform'}
                  </p>
                </div>
              </>
            )}
          </Link>
          <button
            onClick={() => setMobileOpen(false)}
            aria-label={shell('shell.closeNavigationMenu')}
            className="rounded-lg border border-white/10 bg-white/[0.04] p-1.5 text-white/65 transition-colors hover:bg-white/[0.08] hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="border-b border-white/10 px-3 py-3">
          <SuiteSwitcher onNavigate={() => setMobileOpen(false)} />
        </div>

        {/* Navigation */}
        <nav className="sidebar-scroll flex-1 overflow-y-auto px-3 py-4">
          {tierGroups.map((group, index) => {
            const renderSection = (section: VisibleSection) => (
              <SidebarSection key={section.id} label={nav(section.id, section.label)} collapsed={false}>
                {section.visibleItems.map((item) => {
                  const count =
                    item.badge && canAccessNavBadge(item, hasPermission)
                      ? badgeCounts.get(item.badge.endpoint)
                      : undefined;
                  return (
                    <div key={item.id} onClick={() => setMobileOpen(false)}>
                      <SidebarNavItem
                        item={{
                          ...item,
                          label: nav(item.id, item.label),
                          children: item.children?.map((child) => ({
                            ...child,
                            label: nav(child.id, child.label),
                          })),
                        }}
                        collapsed={false}
                        badgeCount={count}
                      />
                    </div>
                  );
                })}
              </SidebarSection>
            );

            if (!group.tier) {
              return (
                <div key="__lead" className="mb-1">
                  {group.sections.map(renderSection)}
                </div>
              );
            }
            // Watheeq brand re-org: drop the PLATFORM CORE tier header — its
            // sections render as normal groups, like the rest of the links.
            if (watheeqMode && group.tier.id === 'platform-core') {
              return (
                <div key={group.tier.id} className="mb-1">
                  {group.sections.map(renderSection)}
                </div>
              );
            }
            // WatheeqTech brand presentation: Business+ tier reads WatheeqTech.
            const tierLabel =
              watheeqMode && group.tier.id === WATHEEQ_BRAND_TIER_ID
                ? WATHEEQ_BRAND_TIER_LABEL
                : resolveTierLabel(group.tier, locale);
            return (
              <div key={group.tier.id} role="group" aria-label={tierLabel} className="mb-1">
                <SidebarTierHeader label={tierLabel} collapsed={false} first={index === 0} />
                {group.sections.map(renderSection)}
              </div>
            );
          })}
        </nav>

        <div className="border-t border-white/10 px-3 pb-3 pt-1">
          <SidebarUserFooter collapsed={false} />
        </div>
      </aside>
    </TooltipProvider>
  );
}
