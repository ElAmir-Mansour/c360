'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { ArrowUpRight, ChevronDown, Lock, LayoutGrid } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/use-auth';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { useNavigationLabels } from '@/components/layout/navigation-labels';
import { canAccessWith } from '@/lib/permissions';
import { IconBadge } from '@/components/shared/icon-badge';
import {
  SUITES,
  suiteQuickLinks,
  suitesByTier,
  resolveNavText,
  resolveTierLabel,
  type NavItem,
  type NavLocalizedText,
  type SuiteEntry,
} from '@/config/navigation';

/** Launcher copy kept bilingual in-component (same pattern as the nav config). */
const COPY: Record<string, NavLocalizedText> = {
  heading: { en: 'All suites', ar: 'كل الحزم' },
  subheading: {
    en: 'Launch any product suite, or jump straight to its top pages.',
    ar: 'افتح أي حزمة منتجات أو انتقل مباشرة إلى أهم صفحاتها.',
  },
  available: { en: 'Available', ar: 'متاحة' },
  noAccess: { en: 'No access', ar: 'لا وصول' },
  noAccessHint: {
    en: 'Ask your administrator for access to this suite.',
    ar: 'اطلب من مسؤول النظام منحك الوصول إلى هذه الحزمة.',
  },
  open: { en: 'Open', ar: 'فتح' },
  quickLinks: { en: 'Quick links', ar: 'روابط سريعة' },
  availableSuites: { en: 'Available', ar: 'المتاحة' },
  yourSuites: { en: 'Your workspace', ar: 'مساحة عملك' },
  exploreMore: { en: 'Explore more suites', ar: 'استكشف حزمًا إضافية' },
  of: { en: 'of', ar: 'من' },
};

interface LauncherSuite {
  suite: SuiteEntry;
  entitled: boolean;
  quickLinks: NavItem[];
}

/**
 * All-Suites launcher grid for the dashboard hub: one flattened `.card` per
 * product suite with its icon, bilingual one-line description, entitlement
 * state, and quick links to its top 3 pages (permission-filtered from the
 * navigation config). Suites the user cannot access render as quiet, locked
 * cards so the full platform footprint stays visible without being clickable.
 */
export function SuitesLauncher() {
  const { hasPermission } = useAuth();
  const { locale } = useLocaleOrDefault();
  const { nav } = useNavigationLabels();
  const t = (key: keyof typeof COPY) => resolveNavText(COPY[key], locale);

  const launcherSuites = useMemo<LauncherSuite[]>(
    () =>
      SUITES.map((suite) => {
        const entitled = canAccessWith(hasPermission, suite.permission);
        return {
          suite,
          entitled,
          quickLinks: entitled ? suiteQuickLinks(suite.segment, hasPermission, 3) : [],
        };
      }),
    [hasPermission],
  );

  const availableCount = launcherSuites.filter((entry) => entry.entitled).length;
  const availableSuites = launcherSuites.filter((entry) => entry.entitled);
  const restrictedSuites = launcherSuites.filter((entry) => !entry.entitled);

  // Group the launcher cards into the platform-architecture tiers (AI Services /
  // DataStream / Business+). `suitesByTier` yields only tiers that own a suite,
  // in the canonical NAV_TIERS order.
  const availableTierGroups = suitesByTier(availableSuites.map((entry) => entry.suite));
  const restrictedTierGroups = suitesByTier(restrictedSuites.map((entry) => entry.suite));

  const renderCard = ({ suite, entitled, quickLinks }: LauncherSuite) => {
    const suiteName = nav(suite.segment, suite.label);
    return (
      <li key={suite.segment} className="min-w-0">
        <div
          className={cn(
            'card group/suite relative flex h-full flex-col gap-3 p-4',
            entitled
              ? 'transition-[border-color,box-shadow] duration-fast ease-standard hover:border-primary/30 hover:shadow-elevation-2 focus-within:border-primary/30'
              : 'opacity-70',
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <IconBadge icon={suite.icon} tone={entitled ? 'primary' : 'muted'} size="md" />
            <span className={cn('badge-base', entitled ? 'badge-success' : 'badge-neutral')}>
              {entitled ? (
                t('available')
              ) : (
                <span className="inline-flex items-center gap-1">
                  <Lock className="h-3 w-3" aria-hidden="true" />
                  {t('noAccess')}
                </span>
              )}
            </span>
          </div>

          <div className="min-w-0">
            <h4 className="text-body font-semibold tracking-tight text-foreground">
              {entitled ? (
                <Link
                  href={suite.href}
                  className="outline-none after:absolute after:inset-0 after:rounded-[inherit] after:content-[''] focus-visible:text-primary"
                  aria-label={`${t('open')} ${suiteName}`}
                >
                  {suiteName}
                  <ArrowUpRight
                    className="ms-1 inline h-3.5 w-3.5 align-[-2px] text-muted-foreground opacity-0 transition-opacity duration-fast ease-standard group-hover/suite:opacity-100 rtl:-scale-x-100"
                    aria-hidden="true"
                  />
                </Link>
              ) : (
                suiteName
              )}
            </h4>
            <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
              {resolveNavText(suite.description, locale)}
            </p>
          </div>

          {entitled && quickLinks.length > 0 ? (
            <div className="relative z-[1] mt-auto border-t border-border/60 pt-3">
              <p className="text-overline font-semibold uppercase text-muted-foreground">
                {t('quickLinks')}
              </p>
              <ul role="list" className="mt-1.5 space-y-0.5">
                {quickLinks.map((link) => {
                  const LinkIcon = link.icon;
                  return (
                    <li key={link.id}>
                      <Link
                        href={link.href}
                        className="group/link flex items-center gap-2 rounded-lg px-1.5 py-1 text-body-sm font-medium text-foreground/70 transition-colors duration-fast ease-standard hover:bg-secondary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <LinkIcon
                          className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-colors group-hover/link:text-primary"
                          aria-hidden="true"
                        />
                        <span className="min-w-0 flex-1 truncate">{nav(link.id, link.label)}</span>
                        <ArrowUpRight
                          className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition-opacity duration-fast ease-standard group-hover/link:opacity-100 rtl:-scale-x-100"
                          aria-hidden="true"
                        />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : !entitled ? (
            <p className="mt-auto border-t border-border/60 pt-3 text-xs text-muted-foreground">
              {t('noAccessHint')}
            </p>
          ) : null}
        </div>
      </li>
    );
  };

  return (
    <section aria-labelledby="suites-launcher-heading" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2
            id="suites-launcher-heading"
            className="flex items-center gap-2 text-h4 font-semibold tracking-tight text-foreground"
          >
            <LayoutGrid className="h-4 w-4 text-primary" aria-hidden="true" />
            {t('heading')}
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{t('subheading')}</p>
        </div>
        <p className="badge-base badge-success">
          {t('yourSuites')}: {availableCount} {t('of')} {launcherSuites.length}
        </p>
      </div>

      <div className="space-y-6">
        {availableTierGroups.map((group) => {
          const entries = availableSuites.filter((entry) => entry.suite.tier === group.tier.id);
          if (entries.length === 0) return null;
          return (
            <div key={group.tier.id} className="space-y-3">
              <h3 className="flex items-center gap-2 text-overline font-semibold uppercase tracking-caps text-muted-foreground">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-accent" aria-hidden="true" />
                {resolveTierLabel(group.tier, locale)}
              </h3>
              <ul role="list" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {entries.map(renderCard)}
              </ul>
            </div>
          );
        })}

        {restrictedSuites.length > 0 && (
          <details className="group/explore rounded-2xl border border-border bg-card/40">
            <summary className="flex cursor-pointer list-none items-center gap-3 rounded-2xl px-4 py-3 text-sm font-semibold text-foreground outline-none transition-colors hover:bg-secondary/60 focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <Lock className="h-4 w-4" aria-hidden="true" />
              </span>
              <span className="flex-1">
                {t('exploreMore')} ({restrictedSuites.length})
              </span>
              <ChevronDown
                className="h-4 w-4 text-muted-foreground transition-transform group-open/explore:rotate-180"
                aria-hidden="true"
              />
            </summary>
            <div className="space-y-6 border-t border-border px-4 py-5">
              {restrictedTierGroups.map((group) => {
                const entries = restrictedSuites.filter(
                  (entry) => entry.suite.tier === group.tier.id,
                );
                if (entries.length === 0) return null;
                return (
                  <div key={group.tier.id} className="space-y-3">
                    <h3 className="text-overline font-semibold uppercase tracking-caps text-muted-foreground">
                      {resolveTierLabel(group.tier, locale)}
                    </h3>
                    <ul role="list" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      {entries.map(renderCard)}
                    </ul>
                  </div>
                );
              })}
            </div>
          </details>
        )}
      </div>
    </section>
  );
}
