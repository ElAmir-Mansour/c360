'use client';

/**
 * Right-rail "Related & linked" card for the Settlement detail page. Gathers, in
 * one cohesive ~360px card, everything a settlement *connects to*:
 *
 *   1. OWNING MATTER — a compact deep link to the legal matter this settlement
 *      resolves (always available from `settlement.matter_id`).
 *   2. LINKED DOCUMENTS — a summary of the WORM repository documents linked to
 *      the settlement. Reuses the SAME react-query key the full documents
 *      section uses (`['lex-settlement-documents', settlementId]`) so the two
 *      views share one cache entry and never double-fetch. Read-only summary
 *      (title + count); the full link/unlink surface lives in the Documents tab,
 *      reached via "Manage documents".
 *
 * Degrades gracefully: while the links load the documents subsection skeletons
 * (the matter link still renders); if the links query errors the documents
 * subsection is quietly hidden. Bilingual (EN + MSA) and RTL-correct via logical
 * utilities.
 */

import type { ReactNode } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, FileText, Gavel, Link2, Paperclip } from 'lucide-react';
import { SectionCard } from '@/components/suites/section-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/common/empty-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { settlementsApi, type Settlement } from '@/lib/lex/settlements';
import { useSettlementDetailExtraLabels } from './detail-extra-labels';

export interface SettlementRelatedCardProps {
  settlement: Settlement;
  /** Switch the detail tabs to the full Documents panel. */
  onViewDocuments?: () => void;
  className?: string;
}

/** Rail is compact — only the freshest few document titles are worth the space. */
const MAX_DOCS = 4;

function RailSubheading({
  icon: Icon,
  children,
  trailing,
}: {
  icon: typeof Paperclip;
  children: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <div className="mb-2.5 flex items-center gap-2">
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="text-overline font-semibold uppercase tracking-wide text-muted-foreground">
        {children}
      </span>
      {trailing ? <span className="ms-auto">{trailing}</span> : null}
    </div>
  );
}

export function SettlementRelatedCard({
  settlement,
  onViewDocuments,
  className,
}: SettlementRelatedCardProps) {
  const t = useSettlementDetailExtraLabels().related;

  // Shared cache key with `SettlementDocumentsSection` — whichever mounts first
  // fetches, the other reads the same cached result. `retry:false` so an
  // absent/broken links endpoint never blocks the matter link from rendering.
  const linksQuery = useQuery({
    queryKey: ['lex-settlement-documents', settlement.id],
    queryFn: () => settlementsApi.listSettlementDocuments(settlement.id),
    enabled: Boolean(settlement.id),
    retry: false,
  });

  const links = linksQuery.data ?? [];
  const shown = links.slice(0, MAX_DOCS);

  const blocks: ReactNode[] = [];

  // 1) OWNING MATTER — always available from the settlement.
  blocks.push(
    <section key="matter">
      <RailSubheading icon={Link2}>{t.matterHeading}</RailSubheading>
      <Link
        href={`/lex/matters/${settlement.matter_id}`}
        aria-label={t.viewMatter}
        className="group flex items-center gap-2.5 rounded-lg border border-border/60 bg-card/50 px-2.5 py-2 shadow-elevation-1 transition-colors duration-fast ease-standard hover:border-primary/30 hover:bg-primary/5"
      >
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
          <Gavel className="h-4 w-4" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-foreground">{t.viewMatter}</span>
          <span className="block truncate font-mono text-xs text-muted-foreground" title={settlement.matter_id}>
            {t.matterRef(settlement.matter_id.slice(0, 12))}
          </span>
        </span>
        <ExternalLink
          className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-primary"
          aria-hidden
        />
      </Link>
    </section>,
  );

  // 2) LINKED DOCUMENTS — skeleton while loading, hidden on error, else summary.
  if (linksQuery.isLoading) {
    blocks.push(
      <section key="documents" aria-busy>
        <RailSubheading icon={Paperclip}>{t.documentsHeading}</RailSubheading>
        <LoadingSkeleton variant="list" count={2} />
      </section>,
    );
  } else if (!linksQuery.isError) {
    blocks.push(
      <section key="documents">
        <RailSubheading
          icon={Paperclip}
          trailing={
            links.length > 0 ? (
              <Badge variant="neutral" size="sm" className="tabular-nums">
                {t.documentsCounter(links.length)}
              </Badge>
            ) : null
          }
        >
          {t.documentsHeading}
        </RailSubheading>
        {links.length > 0 ? (
          <ul className="space-y-2">
            {shown.map((link) => (
              <li key={link.id} className="flex items-start gap-2.5">
                <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-sm text-foreground" dir="auto">
                  {link.document?.title?.trim() || t.documentUntitled}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{t.noDocuments}</p>
        )}
        {onViewDocuments ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-2 w-full justify-center text-xs"
            onClick={onViewDocuments}
          >
            {t.viewAllDocuments}
          </Button>
        ) : null}
      </section>,
    );
  }

  return (
    <SectionCard title={t.title} description={t.description} className={className}>
      {blocks.length > 0 ? (
        <div className="divide-y divide-border/60">
          {blocks.map((block, i) => (
            <div key={i} className="py-4 first:pt-0 last:pb-0">
              {block}
            </div>
          ))}
        </div>
      ) : (
        <EmptyState icon={Paperclip} title={t.emptyAll} size="compact" />
      )}
    </SectionCard>
  );
}
