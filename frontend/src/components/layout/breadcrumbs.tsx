'use client';

import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { useBreadcrumbs } from '@/hooks/use-breadcrumbs';
import { useNavigationLabels } from './navigation-labels';

export function Breadcrumbs() {
  const crumbs = useBreadcrumbs();
  const { shell } = useNavigationLabels();

  if (crumbs.length <= 1) return null;

  return (
    <nav
      key={crumbs[crumbs.length - 1]?.href}
      aria-label={shell('shell.breadcrumb')}
      className="min-w-0 motion-safe:animate-fade-up"
    >
      <ol role="list" className="flex min-w-0 flex-wrap items-center gap-1 text-[13px]">
        {crumbs.map((crumb, idx) => (
          <li key={crumb.href} className="flex items-center gap-1">
            {idx > 0 && (
              <ChevronRight className="h-3 w-3 text-foreground/35 rtl:rotate-180" aria-hidden="true" />
            )}
            {crumb.isLast ? (
              <span
                aria-current="page"
                className="inline-flex max-w-[220px] items-center truncate text-[13px] font-semibold tracking-tight text-foreground"
              >
                {crumb.label}
              </span>
            ) : (
              <Link
                href={crumb.href}
                className="inline-flex max-w-[180px] items-center truncate text-[13px] font-medium text-foreground/60 transition-colors hover:text-primary"
              >
                {crumb.label}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
