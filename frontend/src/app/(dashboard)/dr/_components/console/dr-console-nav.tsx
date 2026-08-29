'use client';

import { useCallback, useMemo } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  BadgeCheck,
  LayoutDashboard,
  LineChart,
  Plug,
  Radar,
  RotateCcw,
  ShieldCheck,
  Swords,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { resolveDRBilingual, type DRBilingual } from '../../_lib/dr-i18n';

/**
 * Link sub-navigation for the Recovery Operations Console.
 *
 * Renders one tab per console route (Overview, Protect, Recover, Rehearse,
 * Prove, Readiness) with the active item derived from `usePathname()`. The
 * Overview tab (`/dr`) matches only its exact path; every other tab matches its
 * path or any nested route. Recover lifecycle tabs point to canonical
 * `/recover/it-dr/*` homes, while `/dr/runs/*` remains an operational drill-in
 * highlighted under Recover.
 *
 * Token-driven (no arbitrary Tailwind), horizontally scrollable on small
 * screens, RTL-safe via logical scroll, and keyboard accessible — each item is
 * a focusable link and the active item is announced with `aria-current="page"`.
 */

/** Stable label key for a console nav tab (excludes the nav landmark name). */
type ConsoleNavKey = Exclude<keyof ConsoleNavLabels, 'navAriaLabel'>;

/** Stable, locale-independent structure for a console nav tab. */
interface ConsoleNavSpec {
  /** Stable key into the bilingual label bundle. */
  key: ConsoleNavKey;
  href: string;
  icon: LucideIcon;
  /** Routes whose prefixes should also mark this tab active (lifecycle drill-ins). */
  alsoActiveFor?: string[];
}

/** A nav tab with its label already resolved for the active locale. */
interface ConsoleNavItem extends ConsoleNavSpec {
  label: string;
}

/** Tab labels keyed by stable nav key, plus the nav landmark's accessible name. */
interface ConsoleNavLabels {
  overview: string;
  protect: string;
  recover: string;
  rehearse: string;
  prove: string;
  readiness: string;
  insights: string;
  integrations: string;
  /** Accessible name for the <nav> landmark. */
  navAriaLabel: string;
}

const ROOT = '/dr';

/** Locale-independent tab specs (icon + route + active-match rules). */
const NAV_SPECS: ConsoleNavSpec[] = [
  { key: 'overview', href: '/dr', icon: LayoutDashboard },
  { key: 'protect', href: '/dr/protect', icon: ShieldCheck },
  { key: 'recover', href: '/recover/it-dr/recover', icon: Swords, alsoActiveFor: ['/dr/runs'] },
  { key: 'rehearse', href: '/recover/it-dr/rehearse', icon: RotateCcw },
  { key: 'prove', href: '/recover/it-dr/prove', icon: BadgeCheck },
  { key: 'readiness', href: '/dr/readiness', icon: Radar },
  { key: 'insights', href: '/dr/insights', icon: LineChart },
  { key: 'integrations', href: '/dr/integrations', icon: Plug },
];

/** Bilingual tab labels resolved against the active locale (en default in tests). */
const consoleNavLabels: DRBilingual<ConsoleNavLabels> = {
  en: {
    overview: 'Overview',
    protect: 'Protect',
    recover: 'Recover',
    rehearse: 'Rehearse',
    prove: 'Prove',
    readiness: 'Readiness',
    insights: 'Insights',
    integrations: 'Integrations',
    navAriaLabel: 'Recovery operations console sections',
  },
  ar: {
    overview: 'نظرة عامة',
    protect: 'الحماية',
    recover: 'الاسترداد',
    rehearse: 'التمرين',
    prove: 'الإثبات',
    readiness: 'الجاهزية',
    insights: 'التحليلات',
    integrations: 'التكاملات',
    navAriaLabel: 'أقسام وحدة التحكّم بعمليات الاسترداد',
  },
};

/** Resolve the nav tab labels for the active locale. */
function useConsoleNavLabels(): ConsoleNavLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveDRBilingual(consoleNavLabels, locale), [locale]);
}

function isItemActive(pathname: string, item: ConsoleNavItem): boolean {
  if (item.href === ROOT) {
    return pathname === ROOT;
  }
  if (pathname === item.href || pathname.startsWith(`${item.href}/`)) {
    return true;
  }
  return (item.alsoActiveFor ?? []).some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function DRConsoleNav() {
  const pathname = usePathname() ?? '';
  const router = useRouter();
  const labels = useConsoleNavLabels();

  const items = useMemo<ConsoleNavItem[]>(
    () => NAV_SPECS.map((spec) => ({ ...spec, label: labels[spec.key] })),
    [labels],
  );

  // Warm the route bundle + data on hover/focus so navigating between the heavy
  // console routes (readiness/recover/prove) is instant. Next.js dedupes repeat
  // prefetches, so firing on every pointer-enter / focus is cheap. The active
  // route is skipped (already loaded).
  const prefetch = useCallback(
    (href: string) => {
      if (href !== pathname) router.prefetch(href);
    },
    [pathname, router],
  );

  return (
    <nav
      aria-label={labels.navAriaLabel}
      className="overflow-x-auto rounded-xl border border-border bg-card p-1.5 shadow-sm"
    >
      <ul className="flex min-w-max items-center gap-1">
        {items.map((item) => {
          const Icon = item.icon;
          const active = isItemActive(pathname, item);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                onMouseEnter={() => prefetch(item.href)}
                onFocus={() => prefetch(item.href)}
                className={cn(
                  'inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                  active
                    ? 'bg-primary/10 text-primary ring-1 ring-primary/30'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
