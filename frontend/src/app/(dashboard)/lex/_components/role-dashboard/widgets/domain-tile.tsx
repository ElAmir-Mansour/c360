'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

import { Skeleton } from '@/components/ui/skeleton';
import { useLexFormat } from '@/lib/lex/ksa';

import { LEX_DOMAINS } from '../../../_lib/lex-domains';
import { domainTintFor, type DomainTileTint } from './domain-tints';

export type { DomainTileTint } from './domain-tints';

/** Exact WLS-UI-SPEC-LD-001 legal-domain record. */
export interface DomainTile {
  key: string;
  label: string;
  count: number | null;
  tint?: DomainTileTint;
  href: string;
}

export interface DomainTileProps {
  /** Nested so React's reserved `key` field remains part of the exact record. */
  tile: DomainTile;
}

export interface DomainTileSkeletonProps {
  label: string;
}

const DOMAIN_TINT_CLASS: Record<DomainTileTint, string> = {
  blue: 'bg-[var(--wt-domain-blue)]',
  green: 'bg-[var(--wt-domain-green)]',
  teal: 'bg-[var(--wt-domain-teal)]',
  amber: 'bg-[var(--wt-domain-amber)]',
  grey: 'bg-[var(--wt-domain-grey)]',
};

const DOMAIN_ICON_BY_KEY = new Map(
  LEX_DOMAINS.map((domain) => [domain.id, domain.icon] as const),
);

/**
 * Legal-domain navigation primitive adapted from Figma node 1:1305.
 *
 * The icon is resolved from the existing domain registry by the API's stable
 * key. Unknown keys keep the icon disc empty rather than substituting an
 * incorrect glyph. A null count omits the count line; numeric zero remains a
 * visible, locale-formatted value.
 */
export function DomainTile({ tile }: DomainTileProps) {
  const format = useLexFormat();
  const Icon = DOMAIN_ICON_BY_KEY.get(tile.key);
  const tint = tile.tint ?? domainTintFor(tile.key);

  return (
    <Link
      href={tile.href}
      className="group flex min-h-16 items-center gap-3 rounded-[var(--wt-radius-card)] border-[length:var(--wt-card-border-width)] border-solid border-[color:var(--wt-teal-300)] bg-[var(--wt-surface)] px-4 py-3 text-[color:var(--wt-teal-900)] outline-none transition-colors duration-fast motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-[color:var(--wt-teal-700)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--wt-canvas)]"
    >
      <span
        aria-hidden="true"
        data-domain-tint={tint}
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--wt-radius-card)] text-[color:var(--wt-teal-700)] ${DOMAIN_TINT_CLASS[tint]}`}
      >
        {Icon ? <Icon className="h-4 w-4" strokeWidth={2} /> : null}
      </span>

      <span className="min-w-0">
        <span className="block truncate text-[length:var(--wt-font-size-label)] font-extrabold leading-[var(--wt-line-height-label)]">
          {tile.label}
        </span>
        {tile.count !== null ? (
          <span className="mt-0.5 block text-[length:var(--wt-font-size-body)] font-bold leading-[var(--wt-line-height-body)] tabular-nums text-[color:var(--wt-teal-700)]">
            {format.formatNumber(tile.count)}
          </span>
        ) : null}
      </span>

      <ArrowRight
        aria-hidden="true"
        className="ms-auto h-4 w-4 shrink-0 text-[color:var(--wt-teal-700)] transition-transform duration-fast group-hover:translate-x-0.5 motion-reduce:transition-none rtl:-scale-x-100 rtl:group-hover:-translate-x-0.5"
      />
    </Link>
  );
}

/** Layout-stable loading companion for a domain tile. */
export function DomainTileSkeleton({ label }: DomainTileSkeletonProps) {
  return (
    <div
      role="status"
      aria-label={label}
      aria-busy="true"
      className="flex min-h-16 items-center gap-3 rounded-[var(--wt-radius-card)] border-[length:var(--wt-card-border-width)] border-solid border-[color:var(--wt-teal-300)] bg-[var(--wt-surface)] px-4 py-3"
    >
      <Skeleton className="h-9 w-9 shrink-0 rounded-[var(--wt-radius-card)]" />
      <span className="min-w-0 flex-1 space-y-1.5">
        <Skeleton className="h-3 w-20 max-w-full" />
        <Skeleton className="h-3 w-8" />
      </span>
      <Skeleton className="h-4 w-4 shrink-0" />
    </div>
  );
}
