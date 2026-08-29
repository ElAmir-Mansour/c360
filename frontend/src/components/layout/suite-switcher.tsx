'use client';

import { Fragment, useMemo } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Check, ChevronsUpDown, LayoutGrid } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SUITES, familyOf, resolveNavText, resolveTierLabel, suitesByTier } from '@/config/navigation';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { canAccessWith } from '@/lib/permissions';
import { useNavigationLabels } from './navigation-labels';
import { useStickySuiteSegment } from './use-sticky-suite';

interface SuiteSwitcherProps {
  /** Desktop collapsed sidebar renders an icon-only trigger. */
  collapsed?: boolean;
  /** Called after a suite is chosen (e.g. to close the mobile drawer). */
  onNavigate?: () => void;
}

/**
 * Compact suite switcher for the sidebar: shows the active suite and lets the
 * user hop directly to any other suite (or back to the All-Suites hub) without
 * routing through the dashboard. Each entry pairs the suite icon and name with
 * its one-line bilingual description from the navigation config; Radix menu
 * semantics give full keyboard navigation (arrows / typeahead / Enter).
 * Only suites the user can access are listed.
 */
export function SuiteSwitcher({ collapsed = false, onNavigate }: SuiteSwitcherProps) {
  const pathname = usePathname();
  const { hasPermission } = useAuth();
  const { nav, shell } = useNavigationLabels();
  const { locale, direction } = useLocaleOrDefault();

  // Suites are PermissionRequirement-gated (anyOf for Watheeq §8.1) — evaluate
  // through canAccessWith, never hasPermission(string) directly.
  const suites = useMemo(
    () => SUITES.filter((suite) => canAccessWith(hasPermission, suite.permission)),
    [hasPermission],
  );
  // Group the accessible suites into their architecture tiers for the launcher.
  const suiteGroups = useMemo(() => suitesByTier(suites), [suites]);
  // Sticky suite context: on global routes (workspace, admin, …) the switcher
  // keeps showing the suite the user is working in rather than "All Suites".
  const segment = useStickySuiteSegment(pathname);
  // Map nested family segments to their product (e.g. the /dr operations console
  // resolves to the Recover product) so the switcher highlights the right product.
  const active = suites.find((suite) => suite.segment === familyOf(segment)) ?? null;

  if (suites.length === 0) return null;

  const TriggerIcon = active?.icon ?? LayoutGrid;
  const hubDescription =
    direction === 'rtl'
      ? 'كل الحزم في شبكة انطلاق واحدة.'
      : 'Every suite in one launcher grid.';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label={shell('shell.switchSuite')}
          className={cn(
            'sidebar-suite-switcher flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.04] text-white transition-[transform,background-color,box-shadow,border-color] hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent/40 motion-reduce:transition-none',
            collapsed ? 'h-10 w-10 justify-center p-0' : 'w-full px-3 py-2',
          )}
        >
          <span className="sidebar-suite-icon flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[linear-gradient(135deg,theme(colors.brand-bright),theme(colors.brand-primary.600))] ring-1 ring-brand-accent-500/40">
            <TriggerIcon className="h-4 w-4 text-white" aria-hidden />
          </span>
          {!collapsed && (
            <>
              <span className="min-w-0 flex-1 text-start">
                <span className="block truncate text-[13px] font-semibold leading-tight text-white">
                  {active ? nav(active.segment, active.label) : shell('shell.allSuites')}
                </span>
                <span className="block truncate text-overline uppercase tracking-caps-wide text-[color:var(--sidebar-muted)] rtl:tracking-normal">
                  {/* Brand sub-label replaces "SUITE" when provided. */}
                  {active?.subLabel
                    ? resolveNavText(active.subLabel, locale)
                    : shell('shell.suite')}
                </span>
              </span>
              <ChevronsUpDown className="h-4 w-4 shrink-0 text-[color:var(--sidebar-muted)]" aria-hidden />
            </>
          )}
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel className="text-xs text-muted-foreground">{shell('shell.switchSuite')}</DropdownMenuLabel>
        <DropdownMenuItem asChild>
          <Link href="/dashboard" onClick={onNavigate} className="flex items-start gap-3 py-2">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-secondary text-foreground/70">
              <LayoutGrid className="h-4 w-4" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium text-foreground">
                {shell('shell.allSuites')}
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {hubDescription}
              </span>
            </span>
            {!active ? (
              <Check className="mt-1 h-4 w-4 shrink-0 text-primary" aria-hidden />
            ) : null}
          </Link>
        </DropdownMenuItem>
        {suiteGroups.map((group) => (
          <Fragment key={group.tier.id}>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="px-2 pb-0.5 pt-1.5 text-overline font-semibold uppercase tracking-caps text-muted-foreground/80 rtl:tracking-normal">
              {resolveTierLabel(group.tier, locale)}
            </DropdownMenuLabel>
            {group.suites.map((suite) => {
              const Icon = suite.icon;
              const isActive = active?.segment === suite.segment;
              return (
                <DropdownMenuItem key={suite.segment} asChild>
                  <Link
                    href={suite.href}
                    onClick={onNavigate}
                    aria-current={isActive ? 'page' : undefined}
                    className="flex items-start gap-3 py-2"
                  >
                    <span
                      className={cn(
                        'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
                        isActive ? 'bg-primary/15 text-primary' : 'bg-secondary text-foreground/70',
                      )}
                    >
                      <Icon className="h-4 w-4" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span
                        className={cn(
                          'block truncate text-[13px] font-medium',
                          isActive ? 'text-primary' : 'text-foreground',
                        )}
                      >
                        {nav(suite.segment, suite.label)}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {resolveNavText(suite.description, locale)}
                      </span>
                    </span>
                    {isActive ? (
                      <Check className="mt-1 h-4 w-4 shrink-0 text-primary" aria-hidden />
                    ) : null}
                  </Link>
                </DropdownMenuItem>
              );
            })}
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
