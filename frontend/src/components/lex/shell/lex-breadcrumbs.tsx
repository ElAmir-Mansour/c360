'use client';

/**
 * Breadcrumb trail for the lex shell, derived from `usePathname`.
 *
 * Each path segment is mapped to a bilingual label: known shell routes resolve
 * through {@link LEX_NAV_ROUTES} → `lexShellLabels.routes`; the few non-nav
 * segments get their own local labels; anything else (ids, slugs) falls back to
 * a humanised token. The final crumb is the current page (not a link).
 *
 * RTL-aware: the chevron separator mirrors with direction and the whole trail
 * reads right-to-left via `dir`.
 */

import { Fragment, useMemo } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronRight, Home } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLocale } from '@/components/providers/locale-provider';
import { LEX_NAV_ROUTES } from './lex-routes';
import { useLexShellLabels } from './lex-shell-labels';

interface Crumb {
  href: string;
  label: string;
  isCurrent: boolean;
}

/** Humanise an unknown slug/segment: `service-desk` → `Service Desk`. */
function humanise(segment: string): string {
  // Keep raw uuids/numeric ids compact; just title-case kebab/snake words.
  const cleaned = segment.replace(/[-_]+/g, ' ').trim();
  return cleaned
    .split(' ')
    .map((word) => (word.length > 0 ? word[0].toUpperCase() + word.slice(1) : word))
    .join(' ');
}

export function LexBreadcrumbs() {
  const pathname = usePathname() ?? '/lex';
  const { direction } = useLocale();
  const labels = useLexShellLabels();
  const isRtl = direction === 'rtl';

  const crumbs = useMemo<Crumb[]>(() => {
    // Map of full-href → route label for the known nav routes.
    const hrefLabel = new Map<string, string>(
      LEX_NAV_ROUTES.map((r) => [r.href, labels.routes[r.id] ?? r.id]),
    );

    const segments = pathname.split('/').filter(Boolean); // ['lex', 'cases', '123']
    const out: Crumb[] = [];

    // Root crumb → command center.
    out.push({ href: '/lex', label: labels.breadcrumbs.home, isCurrent: pathname === '/lex' });

    let acc = '';
    for (let i = 0; i < segments.length; i += 1) {
      acc += `/${segments[i]}`;
      if (acc === '/lex') continue; // already represented by the root crumb
      const isCurrent = i === segments.length - 1;
      const label = hrefLabel.get(acc) ?? humanise(segments[i]);
      out.push({ href: acc, label, isCurrent });
    }
    return out;
  }, [pathname, labels]);

  // The lone root crumb on `/lex` would be redundant with the page hero; hide it.
  if (crumbs.length <= 1) return null;

  const Separator = isRtl ? (
    <ChevronRight className="h-3.5 w-3.5 shrink-0 -scale-x-100 text-muted-foreground/50" aria-hidden />
  ) : (
    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" aria-hidden />
  );

  return (
    <nav aria-label={labels.breadcrumbs.ariaLabel} dir={direction} className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1.5 text-[13px]">
        {crumbs.map((crumb, idx) => (
          <Fragment key={crumb.href}>
            {idx > 0 && <li aria-hidden>{Separator}</li>}
            <li className="min-w-0">
              {crumb.isCurrent ? (
                <span aria-current="page" className="block truncate font-semibold text-foreground">
                  {idx === 0 && (
                    <Home className="me-1 inline h-3.5 w-3.5 align-[-2px] text-muted-foreground" aria-hidden />
                  )}
                  {crumb.label}
                </span>
              ) : (
                <Link
                  href={crumb.href}
                  className={cn(
                    'inline-flex max-w-[14rem] items-center truncate rounded-md px-1 text-muted-foreground',
                    'transition-colors duration-fast ease-standard hover:text-foreground',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  )}
                >
                  {idx === 0 && <Home className="me-1 h-3.5 w-3.5 shrink-0" aria-hidden />}
                  <span className="truncate">{crumb.label}</span>
                </Link>
              )}
            </li>
          </Fragment>
        ))}
      </ol>
    </nav>
  );
}
