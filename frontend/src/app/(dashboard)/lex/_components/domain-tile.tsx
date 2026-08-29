/**
 * A single Watheeq Legal-Affairs DOMAIN entry tile for the `/lex` command
 * center. A thin wrapper over the shared {@link DomainTileCard} command-ui
 * primitive: it owns only the count STATE resolution, delegating all
 * look-and-feel (IconBadge, hover-lift, RTL-aware sliding arrow, focus ring) to
 * the primitive so the tile matches every other section verbatim.
 *
 * The count region resolves in four states:
 *   - loading  → a Skeleton placeholder (`count.isLoading`)
 *   - value>0  → locale-formatted number
 *   - value=0  → muted "0"
 *   - none     → muted em-dash for count-bearing domains, or omitted entirely
 *                for navigational domains (`domain.hasCount === false`)
 *
 * Localized name comes from `domains.<id>` via {@link useLexLabels}; numerals
 * are shaped by {@link useLexFormat} (Arabic-Indic in ar). Permission gating is
 * the parent grid's job ({@link import('./domain-tiles').DomainTiles}).
 */

'use client';

import type { ReactNode } from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import { useLexFormat } from '@/lib/lex/ksa';

import { DomainTileCard } from './command-ui';
import { useLexLabels } from '../_lib/lex-i18n';
import type { LexDomain } from '../_lib/lex-domains';
import type { DomainCount } from '../_lib/use-lex-command-center';
import type { LexDomainId } from '../_lib/lex-i18n';

export interface DomainTileProps {
  /** Tile descriptor from {@link LEX_DOMAINS}. */
  domain: LexDomain;
  /** Live count slice for this domain (id-keyed) from `useLexDomainCounts()`. */
  count: DomainCount;
}

/**
 * Renders a single navigational domain tile via {@link DomainTileCard},
 * resolving the count display node + tone from the domain descriptor and its
 * live count slice.
 */
export function DomainTile({ domain, count }: DomainTileProps) {
  const labels = useLexLabels();
  const f = useLexFormat();
  const { overview } = labels;

  // `domains` is keyed by the closed LexDomainId union; domain.id is the same
  // string set by construction, so resolve through that key.
  const name = overview.domains[domain.id as LexDomainId];

  const showCount = domain.hasCount;
  const isLoading = showCount && count.isLoading;
  const hasValue = showCount && typeof count.count === 'number';
  const numericValue = hasValue ? (count.count as number) : null;

  let display: ReactNode;
  if (!showCount) {
    // Navigational domains (drafting / reports / admin) surface no count.
    display = undefined;
  } else if (isLoading) {
    display = <Skeleton className="h-5 w-8 rounded-soft" />;
  } else if (numericValue !== null) {
    const formatted = f.formatNumber(numericValue);
    display =
      numericValue > 0 ? (
        formatted
      ) : (
        <span className="text-muted-foreground">{formatted}</span>
      );
  } else {
    display = <span className="text-muted-foreground">—</span>;
  }

  return (
    <DomainTileCard
      icon={domain.icon}
      name={name}
      count={display}
      href={domain.href}
      tone={domain.tone}
    />
  );
}

export default DomainTile;
