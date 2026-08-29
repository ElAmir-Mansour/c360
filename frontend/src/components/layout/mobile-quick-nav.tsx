'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/use-auth';
import { useIsMobile } from '@/hooks/use-media-query';
import { useSidebar } from '@/hooks/use-sidebar';
import { navigation, SUITES, type NavSection } from '@/config/navigation';
import { canAccessWith } from '@/lib/permissions';
import { useNavigationLabels } from './navigation-labels';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import {
  KNOWLEDGE_QUICK_NAV,
  activeKnowledgeQuickNavHref,
  isKnowledgeQuickNavPath,
} from '@/components/lex/shell/knowledge-quick-nav';

interface QuickNavTab {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
  /** Top-level route segment used for active matching. */
  segment: string;
}

/**
 * Maximum number of route tabs before the "More" button. Keeps the bottom bar
 * to a thumb-reachable, single-row tab strip.
 */
const MAX_TABS = 4;

function sectionSegment(section: NavSection): string {
  const href = section.items[0]?.href ?? '';
  return href.split('/').filter(Boolean)[0] ?? '';
}

export function MobileQuickNav() {
  const isMobile = useIsMobile();
  const { hasPermission } = useAuth();
  const { toggleMobileOpen } = useSidebar();
  const pathname = usePathname();
  const { locale } = useLocaleOrDefault();
  const { nav, shell } = useNavigationLabels();
  const currentSegment = (pathname ?? '').split('/').filter(Boolean)[0] ?? '';
  const currentPath = pathname ?? '';
  const useKnowledgeTabs = isKnowledgeQuickNavPath(currentPath);
  const activeKnowledgeHref = activeKnowledgeQuickNavHref(currentPath);

  // Derive the bottom-tab destinations from the SAME permission-filtered
  // navigation config the sidebar consumes — never hardcode routes. We take the
  // lead (first) item of each top-level section the user can access, dedupe by
  // route segment, and keep the first MAX_TABS. "More" always opens the existing
  // focus-trapped mobile drawer for the full tree.
  const tabs = useMemo<QuickNavTab[]>(() => {
    const result: QuickNavTab[] = [];
    const seenSegments = new Set<string>();

    for (const section of navigation) {
      // Respect section-level permission (mirrors sidebar filtering).
      if (section.permission !== '*:read' && !hasPermission(section.permission)) {
        continue;
      }
      // Lead item the user is actually allowed to see.
      const lead = section.items.find(
        (item) =>
          item.permission === '*:read' ||
          canAccessWith(hasPermission, item.permission),
      );
      if (!lead) continue;

      const segment = sectionSegment(section);
      if (seenSegments.has(segment)) continue;
      seenSegments.add(segment);

      // Caption the tab with the suite (or section) name, never the lead
      // page's own title — every suite leads with an "Overview" page, which
      // would render several identically-labeled tabs.
      const suite = SUITES.find((s) => s.segment === segment);
      const label = suite
        ? nav(suite.segment, suite.label)
        : section.label
          ? nav(section.id, section.label)
          : nav(lead.id, lead.label);

      result.push({
        id: section.id,
        label,
        href: lead.href,
        icon: lead.icon,
        segment,
      });
    }

    return result.slice(0, MAX_TABS);
  }, [hasPermission, nav]);

  const knowledgeTabs = useMemo<QuickNavTab[]>(
    () =>
      KNOWLEDGE_QUICK_NAV.filter((item) =>
        canAccessWith(hasPermission, item.permission),
      ).map((item) => ({
        id: item.id,
        label: locale === 'ar' ? item.labelAr : item.labelEn,
        href: item.href,
        icon: item.icon,
        segment: 'lex-knowledge',
      })),
    [hasPermission, locale],
  );

  const visibleTabs = useKnowledgeTabs ? knowledgeTabs : tabs;

  if (!isMobile || visibleTabs.length === 0) return null;

  return (
    <nav
      aria-label={shell('shell.quickNavigation')}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-[color:var(--panel-border)] bg-card/95 pb-[max(0.25rem,env(safe-area-inset-bottom))] pl-[max(0.25rem,env(safe-area-inset-left))] pr-[max(0.25rem,env(safe-area-inset-right))] pt-1 shadow-[0_-8px_24px_-18px_rgba(15,23,42,0.35)] backdrop-blur-xl md:hidden"
    >
      <ul role="list" className="flex items-stretch justify-around gap-0.5">
        {visibleTabs.map((tab) => {
          const isActive = useKnowledgeTabs
            ? tab.href === activeKnowledgeHref
            : tab.segment === 'dashboard'
              ? currentSegment === 'dashboard'
              : currentSegment === tab.segment;
          const Icon = tab.icon;
          return (
            <li key={tab.id} className="min-w-0 flex-1">
              <Link
                href={tab.href}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'flex flex-col items-center justify-center gap-0.5 rounded-lg px-1 py-1.5',
                  'transition-[color,background-color] duration-200 ease-spring motion-reduce:transition-none',
                  isActive
                    ? 'text-primary'
                    : 'text-foreground/75 hover:text-foreground',
                )}
              >
                <span className="relative flex items-center justify-center">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                  {isActive && (
                    <span
                      aria-hidden="true"
                      className="absolute -bottom-1.5 h-1 w-1 rounded-full bg-primary"
                    />
                  )}
                </span>
                <span className="max-w-full truncate text-[10px] font-medium leading-tight">
                  {tab.label}
                </span>
              </Link>
            </li>
          );
        })}
        {!useKnowledgeTabs ? (
          <li className="min-w-0 flex-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={toggleMobileOpen}
              aria-label={shell('shell.openFullNavigationMenu')}
              className="h-auto w-full flex-col gap-0.5 rounded-lg px-1 py-1.5 text-foreground/75 transition-[color] duration-200 ease-spring hover:bg-transparent hover:text-foreground motion-reduce:transition-none"
            >
              <Menu className="h-5 w-5" aria-hidden="true" />
              <span className="text-[10px] font-medium leading-tight">{shell('shell.more')}</span>
            </Button>
          </li>
        ) : null}
      </ul>
    </nav>
  );
}
