'use client';

import { memo, useMemo } from 'react';
import { ChevronLeft, ChevronRight, Star } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useSidebar } from '@/hooks/use-sidebar';
import { useAuth } from '@/hooks/use-auth';
import { useBadgeCounts } from '@/hooks/use-badge-counts';
import { useIsMobile } from '@/hooks/use-media-query';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SidebarSection } from './sidebar-section';
import { SidebarTierHeader } from './sidebar-tier-header';
import { SidebarNavItem } from './sidebar-nav-item';
import { SidebarUserFooter } from './sidebar-user-footer';
import { SuiteSwitcher } from './suite-switcher';
import { useSectionExpansion, usePinnedNavItems } from './sidebar-nav-state';
import { Logo } from '@/components/brand/logo';
import { WatheeqLogo } from '@/components/brand/watheeq-logo';
import {
  navigation,
  filterSectionsForRoute,
  filterRecoverNavByEntitlement,
  filterNavItems,
  canAccessNavBadge,
  collectNavBadgeConfigs,
  groupSectionsByTier,
  resolveTierLabel,
  applyWatheeqNavPresentation,
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

type VisibleSection = NavSection & { visibleItems: NavItem[] };

/**
 * Resolve the user's pinned item ids against the CURRENTLY visible nav tree
 * (post permission + entitlement filtering), preserving pin order. Pinned
 * entries always render as leaves — pinning a child row surfaces that row
 * itself, never its whole group.
 */
function resolvePinnedItems(
  pinnedIds: readonly string[],
  sections: VisibleSection[],
): NavItem[] {
  const byId = new Map<string, NavItem>();
  for (const section of sections) {
    for (const item of section.visibleItems) {
      if (!byId.has(item.id)) byId.set(item.id, item);
      for (const child of item.children ?? []) {
        if (!byId.has(child.id)) byId.set(child.id, child);
      }
    }
  }
  const resolved: NavItem[] = [];
  for (const id of pinnedIds) {
    const item = byId.get(id);
    if (item) resolved.push({ ...item, children: undefined });
  }
  return resolved;
}

export const Sidebar = memo(function Sidebar() {
  const { collapsed, toggleCollapsed } = useSidebar();
  const { hasPermission } = useAuth();
  const isMobile = useIsMobile();
  const pathname = usePathname();
  const { direction, nav, shell } = useNavigationLabels();
  const { locale } = useLocaleOrDefault();

  // Live Recover entitlement: drives sub-solution nav visibility. `null` while
  // the entitlement query has not yet resolved (or the user lacks dr:read so it
  // never fires) — in that case the Recover section is left intact and the
  // server-side route guard remains the authoritative control.
  const recoverProductsQuery = useRecoverProducts();
  const entitledRecoverSlugs = useMemo<string[] | null>(() => {
    if (!recoverProductsQuery.isSuccess) return null;
    return entitledSubSolutionSlugs(recoverProductsQuery.data);
  }, [recoverProductsQuery.isSuccess, recoverProductsQuery.data]);

  // WatheeqTech brand presentation: inside /lex (or for WatheeqTech-only
  // tenants) the sidebar renders the WatheeqTech brand experience. The sticky
  // suite segment keeps that experience on global routes (workspace, admin, …)
  // launched from within the suite instead of flipping to the all-suites view.
  const effectiveSegment = useStickySuiteSegment(pathname);
  const watheeqMode = useMemo(() => {
    const accessible = SUITES.filter((suite) => canAccessWith(hasPermission, suite.permission));
    return isWatheeqNavContext(effectiveSegment, accessible);
  }, [hasPermission, effectiveSegment]);
  const navTree = useMemo(
    () => (watheeqMode ? applyWatheeqNavPresentation(navigation) : navigation),
    [watheeqMode],
  );

  // Memoize the navigation tree to avoid re-filtering on every badge tick.
  // Per-suite: only the active suite's sections (+ global sections) are shown.
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
        .filter((s) => s.visibleItems.length > 0),
    [hasPermission, pathname, effectiveSegment, entitledRecoverSlugs, navTree],
  );

  // Progressive disclosure: first 2 sections per suite expanded by default,
  // persisted user toggles override, the active route's section auto-expands.
  const { isExpanded, toggleSection } = useSectionExpansion(visibleSections, pathname);

  // User-curated pinned shortcuts. Resolved against the FULL permitted tree
  // (permission + entitlement filtered, but NOT route-scoped) so a pin made in
  // one suite stays reachable while working in another — pins are cross-suite
  // quick access by design.
  const { pinnedIds, isPinned, togglePin } = usePinnedNavItems();
  const allPermittedSections = useMemo(
    () =>
      filterRecoverNavByEntitlement(navTree, entitledRecoverSlugs)
        .filter(
          (section) =>
            section.permission === '*:read' || hasPermission(section.permission),
        )
        .map((section) => ({
          ...section,
          visibleItems: filterNavItems(section.items, hasPermission),
        }))
        .filter((s) => s.visibleItems.length > 0),
    [hasPermission, entitledRecoverSlugs, navTree],
  );
  const pinnedItems = useMemo(
    () => resolvePinnedItems(pinnedIds, allPermittedSections),
    [pinnedIds, allPermittedSections],
  );
  const pinnedLabel = direction === 'rtl' ? 'المثبّتة' : 'Pinned';

  const badgeConfigs = useMemo(
    () =>
      isMobile
        ? []
        : visibleSections.flatMap((section) =>
            collectNavBadgeConfigs(section.visibleItems, hasPermission),
          ),
    [hasPermission, isMobile, visibleSections],
  );
  const badgeCounts = useBadgeCounts(badgeConfigs);

  // Group the visible sections into the five platform-architecture tiers. Empty
  // tiers are dropped, so a tier header only renders above ≥1 visible section.
  const tierGroups = useMemo(() => groupSectionsByTier(visibleSections), [visibleSections]);

  if (isMobile) return null;

  const CollapseIcon = direction === 'rtl' ? ChevronRight : ChevronLeft;
  const ExpandIcon = direction === 'rtl' ? ChevronLeft : ChevronRight;

  const renderSection = (section: VisibleSection) => (
    <SidebarSection
      key={section.id}
      label={nav(section.id, section.label)}
      collapsed={collapsed}
      count={section.visibleItems.length}
      expanded={isExpanded(section.id)}
      onToggle={() => toggleSection(section.id)}
    >
      {section.visibleItems.map(renderItem)}
    </SidebarSection>
  );

  const renderItem = (item: NavItem) => {
    const count =
      item.badge && canAccessNavBadge(item, hasPermission)
        ? badgeCounts.get(item.badge.endpoint)
        : undefined;
    return (
      <SidebarNavItem
        key={item.id}
        item={{
          ...item,
          label: nav(item.id, item.label),
          children: item.children?.map((child) => ({
            ...child,
            label: nav(child.id, child.label),
          })),
        }}
        collapsed={collapsed}
        badgeCount={count}
        isPinned={isPinned}
        onTogglePin={togglePin}
      />
    );
  };

  return (
    <TooltipProvider>
      <aside
        aria-label={shell('shell.mainNavigation')}
        data-watheeq={watheeqMode ? 'true' : undefined}
        className={cn(
          'flex h-full shrink-0 flex-col overflow-hidden border-e border-[color:var(--sidebar-border)] [background:var(--sidebar-bg)] text-white transition-[width] duration-300 ease-out motion-reduce:transition-none',
          collapsed ? 'w-[80px]' : 'w-[264px]',
        )}
      >
        <div className="border-b border-white/10 px-3 py-3.5">
          {!collapsed ? (
            <Link
              href="/dashboard"
              aria-label={watheeqMode ? 'وثيقتك' : 'Clario360 home'}
              className="sidebar-brand-card flex items-center gap-3 rounded-xl px-3 py-3 transition-[transform,background-color,box-shadow] hover:bg-[var(--sidebar-hover)] motion-reduce:transition-none"
            >
              {watheeqMode ? (
                // WatheeqTech lockup.
                <div className="min-w-0">
                  <WatheeqLogo variant="wordmark" tone="onDark" locale={locale} className="h-7 w-auto" title="وثيقتك" />
                  <p className="mt-1 truncate text-xs font-medium text-[color:var(--sidebar-muted)]">
                    {locale === 'ar' ? WATHEEQ_LOGO_TAGLINE_AR : WATHEEQ_LOGO_TAGLINE}
                  </p>
                </div>
              ) : (
                <>
                  <Logo variant="mark" tone="onDark" className="h-9 w-9 shrink-0" decorative />
                  <div className="min-w-0">
                    <Logo variant="wordmark" tone="onDark" className="h-[18px] w-auto" title="Clario360" />
                    <p className="mt-1 truncate text-xs font-medium text-[color:var(--sidebar-muted)]">
                      {locale === 'ar'
                        ? 'منصة الذكاء المؤسسي'
                        : 'The Enterprise Intelligence Platform'}
                    </p>
                  </div>
                </>
              )}
            </Link>
          ) : (
            <Link
              href="/dashboard"
              aria-label={watheeqMode ? 'وثيقتك' : 'Clario360 home'}
              className="sidebar-brand-card mx-auto flex h-11 w-11 items-center justify-center rounded-xl transition-[transform,background-color,box-shadow] hover:bg-[var(--sidebar-hover)] motion-reduce:transition-none"
            >
              {watheeqMode ? (
                <WatheeqLogo variant="mark" tone="onDark" className="h-8 w-8" title="وثيقتك" />
              ) : (
                <Logo variant="mark" tone="onDark" className="h-7 w-7" title="Clario360" />
              )}
            </Link>
          )}
        </div>

        <div className="border-b border-white/10 px-3 py-3">
          <SuiteSwitcher collapsed={collapsed} />
        </div>

        <nav className="sidebar-scroll flex-1 overflow-y-auto px-3 py-4">
          {pinnedItems.length > 0 && (
            <div role="group" aria-label={pinnedLabel} className="mb-3">
              {!collapsed ? (
                <div className="mb-1 flex items-center gap-2 px-3">
                  <Star className="h-3 w-3 shrink-0 text-brand-gold/80" aria-hidden="true" />
                  <p className="flex-1 truncate text-xs font-medium text-[color:var(--sidebar-muted)]">
                    {pinnedLabel}
                  </p>
                  <span className="flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-white/10 px-1 text-overline font-medium tabular-nums text-[color:var(--sidebar-muted)]">
                    {pinnedItems.length}
                  </span>
                </div>
              ) : (
                <div className="mx-3 mb-1.5 h-px bg-white/10" />
              )}
              <div className="space-y-0.5">{pinnedItems.map(renderItem)}</div>
            </div>
          )}

          {tierGroups.map((group, index) => {
            if (!group.tier) {
              // Tier-less lead block (Dashboard / Notebooks) — no tier header.
              return (
                <div key="__lead" className="mb-1">
                  {group.sections.map(renderSection)}
                </div>
              );
            }
            // Watheeq brand re-org: the PLATFORM CORE tier header is removed —
            // its sections render as normal groups, like the rest of the links.
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
                <SidebarTierHeader label={tierLabel} collapsed={collapsed} first={index === 0} />
                {group.sections.map(renderSection)}
              </div>
            );
          })}
        </nav>

        <div className="border-t border-white/10 px-3 py-2.5">
          <button
            onClick={toggleCollapsed}
            aria-label={collapsed ? shell('shell.expandSidebar') : shell('shell.collapseSidebar')}
            className="sidebar-collapse-control flex w-full items-center justify-center rounded-lg p-2 text-white/70 transition-[transform,background-color,color,box-shadow] hover:bg-[var(--sidebar-hover)] hover:text-white motion-reduce:transition-none"
          >
            {collapsed ? (
              <ExpandIcon className="h-4 w-4" />
            ) : (
              <div className="flex w-full items-center justify-between px-1 text-xs font-medium">
                <span>{shell('shell.collapse')}</span>
                <CollapseIcon className="h-4 w-4" />
              </div>
            )}
          </button>
        </div>

        <div className="border-t border-white/10 px-3 pb-3 pt-1">
          <SidebarUserFooter collapsed={collapsed} />
        </div>
      </aside>
    </TooltipProvider>
  );
});
