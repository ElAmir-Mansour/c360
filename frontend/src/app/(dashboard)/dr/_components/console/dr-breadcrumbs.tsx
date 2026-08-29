'use client';

/**
 * In-page breadcrumb trail for ClarioDR drill-in routes.
 *
 * Deep DR routes (`/dr/runbooks/[id]`, `/dr/runbooks/runs/[runId]`,
 * `/dr/runs/[id]`, `/dr/prove/ledger`, `/dr/prove/compliance`) are reachable from
 * several entry points and carry opaque ids in the URL, so the global path-derived
 * header breadcrumb degrades to a generic "Details" crumb there. This component
 * gives each drill-in page an explicit, entity-aware trail
 * ("Disaster Recovery › Runbooks › <name>") so operators always know where they
 * are and have a one-click path back up the lifecycle.
 *
 * The root crumb ("Disaster Recovery") always links to `/dr`; callers pass the
 * remaining crumbs (parent section + current page). The current page is rendered
 * as plain text (`aria-current="page"`), never a link.
 *
 * RTL-aware: the chevron separator mirrors with the active direction and the
 * whole trail reads right-to-left under `dir`. The root label is bilingual; every
 * caller-supplied label is already locale-resolved by the page.
 */

import { Fragment, useMemo } from 'react';
import Link from 'next/link';
import { ChevronRight, Home } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { resolveDRBilingual, type DRBilingual } from '../../_lib/dr-i18n';

/** A single crumb. Omit `href` for the current (last) page. */
export interface DRCrumb {
  /** Already locale-resolved label for this crumb. */
  label: string;
  /** Link target; when absent the crumb renders as the current page (not a link). */
  href?: string;
}

interface DRBreadcrumbsLabels {
  /** Root crumb label (suite home). */
  home: string;
  /** Accessible name for the <nav> landmark. */
  ariaLabel: string;
}

const breadcrumbLabels: DRBilingual<DRBreadcrumbsLabels> = {
  en: { home: 'Disaster Recovery', ariaLabel: 'Disaster Recovery breadcrumb' },
  ar: { home: 'التعافي من الكوارث', ariaLabel: 'مسار التنقّل في التعافي من الكوارث' },
};

/**
 * Render the DR breadcrumb trail. The "Disaster Recovery" root crumb is prepended
 * automatically; pass only the section + current-page crumbs in `items`.
 */
export function DRBreadcrumbs({ items }: { items: DRCrumb[] }) {
  const { locale, direction } = useLocaleOrDefault();
  const labels = useMemo(() => resolveDRBilingual(breadcrumbLabels, locale), [locale]);

  const crumbs = useMemo<DRCrumb[]>(
    () => [{ label: labels.home, href: '/dr' }, ...items],
    [labels.home, items],
  );

  return (
    <nav aria-label={labels.ariaLabel} dir={direction} className="min-w-0">
      <ol role="list" className="flex min-w-0 flex-wrap items-center gap-1.5 text-body-sm">
        {crumbs.map((crumb, idx) => {
          const isLast = idx === crumbs.length - 1;
          const isRoot = idx === 0;
          return (
            <Fragment key={`${crumb.href ?? 'current'}-${idx}`}>
              {idx > 0 && (
                <li aria-hidden>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50 rtl:-scale-x-100" />
                </li>
              )}
              <li className="min-w-0">
                {isLast || !crumb.href ? (
                  <span
                    aria-current="page"
                    className="inline-flex max-w-[16rem] items-center truncate font-semibold text-foreground"
                  >
                    {isRoot && (
                      <Home className="me-1 inline h-3.5 w-3.5 shrink-0 align-[-2px] text-muted-foreground" aria-hidden />
                    )}
                    <span className="truncate">{crumb.label}</span>
                  </span>
                ) : (
                  <Link
                    href={crumb.href}
                    className={cn(
                      'inline-flex max-w-[14rem] items-center truncate rounded-md text-muted-foreground',
                      'transition-colors hover:text-foreground',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    )}
                  >
                    {isRoot && <Home className="me-1 h-3.5 w-3.5 shrink-0" aria-hidden />}
                    <span className="truncate">{crumb.label}</span>
                  </Link>
                )}
              </li>
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
