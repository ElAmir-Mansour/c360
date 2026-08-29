'use client';

/**
 * #5 Related-records rail card — the right-rail "what this matter connects to"
 * surface. A matter is an umbrella work item, so its linked records are central:
 *
 *   1. LINKED CONTRACTS — a compact count summary (the full, writable list with
 *      link/unlink lives in the Overview tab; this rail avoids duplicating the
 *      contract titles and just states how many are attached).
 *   2. RELATED ITEMS — cross-domain edges from the matter to sibling lex entities
 *      (cases / consultations / investigations / settlements / contracts) via
 *      `listMatterRelated`, each a deep link to that record.
 *   3. DOCUMENTS — repository documents linked to the matter via
 *      `listMatterDocuments`, each deep-linking to the document.
 *
 * Both networked subsections reuse the exact query keys the Related and Documents
 * tabs already use (`['lex-matter-related', id]`, `['lex-matter-documents', id]`)
 * so the rail and the tabs share one cached fetch. Each degrades quietly — a
 * loading skeleton while fetching, hidden on error — so transient related-record
 * reads never block the contracts summary (driven purely by the `matter` prop).
 * Bilingual + RTL-correct.
 */

import type { ReactNode } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  ExternalLink,
  FileText,
  Gavel,
  Handshake,
  Link2,
  MessageSquareText,
  Paperclip,
  ScrollText,
  Search,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { SectionCard } from '@/components/suites/section-card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/common/empty-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { enterpriseApi } from '@/lib/enterprise';
import type { LexMatter, LexMatterLink } from '@/types/suites';
import { useMatterRelatedCardLabels } from './matter-detail-labels';

export interface MatterRelatedCardProps {
  matter: LexMatter;
  className?: string;
}

/** Deep-link base per related target type. `legal_case`/`litigation` both route
 * to the cases surface (kept identical to `matter-related-items.tsx`). */
const TARGET_ROUTE_BASE: Record<string, string> = {
  consultation: '/lex/consultations',
  investigation: '/lex/investigations',
  legal_case: '/lex/cases',
  settlement: '/lex/settlements',
  litigation: '/lex/cases',
  contract: '/lex/contracts',
};

const TARGET_ICON: Record<string, LucideIcon> = {
  consultation: MessageSquareText,
  investigation: Search,
  legal_case: Gavel,
  settlement: Handshake,
  litigation: Gavel,
  contract: ScrollText,
};

function RailSubheading({
  icon: Icon,
  children,
  trailing,
}: {
  icon: LucideIcon;
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

function RailLinkRow({
  href,
  icon: Icon,
  title,
  subtitle,
  ariaLabel,
}: {
  href: string;
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  ariaLabel: string;
}) {
  return (
    <Link
      href={href}
      aria-label={ariaLabel}
      className="group flex items-center gap-2.5 rounded-lg border border-border/60 bg-card/50 px-2.5 py-2 shadow-elevation-1 transition-colors duration-fast ease-standard hover:border-primary/30 hover:bg-primary/5"
    >
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground" dir="auto">
          {title}
        </span>
        {subtitle ? (
          <span className="block truncate font-mono text-xs text-muted-foreground" title={subtitle}>
            {subtitle}
          </span>
        ) : null}
      </span>
      <ExternalLink
        className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-primary"
        aria-hidden
      />
    </Link>
  );
}

function relatedTitle(link: LexMatterLink): string {
  return (
    link.target_title?.trim() ||
    link.target_reference?.trim() ||
    link.target_id.slice(0, 12)
  );
}

function relatedHref(link: LexMatterLink): string | null {
  const base = TARGET_ROUTE_BASE[String(link.target_type)];
  return base ? `${base}/${link.target_id}` : null;
}

export function MatterRelatedCard({ matter, className }: MatterRelatedCardProps) {
  const labels = useMatterRelatedCardLabels();

  const relatedQuery = useQuery({
    queryKey: ['lex-matter-related', matter.id],
    queryFn: () => enterpriseApi.lex.listMatterRelated(matter.id),
    enabled: Boolean(matter.id),
    retry: false,
  });

  const documentsQuery = useQuery({
    queryKey: ['lex-matter-documents', matter.id],
    queryFn: () => enterpriseApi.lex.listMatterDocuments(matter.id),
    enabled: Boolean(matter.id),
    retry: false,
  });

  const contractsCount = matter.contracts?.length ?? 0;
  const relatedLinks = (relatedQuery.data ?? []).filter((link) => relatedHref(link) !== null);
  const documents = documentsQuery.data ?? [];

  const blocks: ReactNode[] = [];

  // 1) LINKED CONTRACTS — count summary only (titles + link/unlink live in the
  //    Overview tab); rendered whenever the matter has any linked contracts.
  if (contractsCount > 0) {
    blocks.push(
      <section key="contracts">
        <RailSubheading
          icon={Paperclip}
          trailing={
            <Badge variant="neutral" size="sm" className="tabular-nums">
              {labels.contractsCounter(contractsCount)}
            </Badge>
          }
        >
          {labels.contractsHeading}
        </RailSubheading>
      </section>,
    );
  }

  // 2) RELATED ITEMS — skeleton while loading, hidden on error, list otherwise.
  if (relatedQuery.isLoading) {
    blocks.push(
      <section key="related" aria-busy>
        <RailSubheading icon={Link2}>{labels.relatedHeading}</RailSubheading>
        <LoadingSkeleton variant="list" count={2} />
      </section>,
    );
  } else if (!relatedQuery.isError && relatedLinks.length > 0) {
    blocks.push(
      <section key="related">
        <RailSubheading
          icon={Link2}
          trailing={
            <Badge variant="neutral" size="sm" className="tabular-nums">
              {labels.contractsCounter(relatedLinks.length)}
            </Badge>
          }
        >
          {labels.relatedHeading}
        </RailSubheading>
        <div className="space-y-2">
          {relatedLinks.map((link) => {
            const type = String(link.target_type);
            const typeLabel = labels.targetTypeLabels[type] ?? type.replace(/_/g, ' ');
            return (
              <RailLinkRow
                key={link.id}
                href={relatedHref(link)!}
                icon={TARGET_ICON[type] ?? Link2}
                title={relatedTitle(link)}
                subtitle={typeLabel}
                ariaLabel={`${labels.openAria}: ${relatedTitle(link)}`}
              />
            );
          })}
        </div>
      </section>,
    );
  }

  // 3) DOCUMENTS — skeleton while loading, hidden on error, list otherwise.
  if (documentsQuery.isLoading) {
    blocks.push(
      <section key="documents" aria-busy>
        <RailSubheading icon={FileText}>{labels.documentsHeading}</RailSubheading>
        <LoadingSkeleton variant="list" count={2} label={labels.documentsLoading} />
      </section>,
    );
  } else if (!documentsQuery.isError && documents.length > 0) {
    blocks.push(
      <section key="documents">
        <RailSubheading
          icon={FileText}
          trailing={
            <Badge variant="neutral" size="sm" className="tabular-nums">
              {labels.contractsCounter(documents.length)}
            </Badge>
          }
        >
          {labels.documentsHeading}
        </RailSubheading>
        <div className="space-y-2">
          {documents.map((link) => (
            <RailLinkRow
              key={link.id}
              href={`/lex/documents/${link.document_id}`}
              icon={FileText}
              title={link.document?.title?.trim() || link.document_id.slice(0, 12)}
              ariaLabel={`${labels.openAria}: ${link.document?.title?.trim() || link.document_id}`}
            />
          ))}
        </div>
      </section>,
    );
  }

  return (
    <SectionCard title={labels.title} description={labels.description} className={className}>
      {blocks.length > 0 ? (
        <div className="divide-y divide-border/60">
          {blocks.map((block, i) => (
            <div key={i} className="py-4 first:pt-0 last:pb-0">
              {block}
            </div>
          ))}
        </div>
      ) : (
        <EmptyState icon={Paperclip} title={labels.emptyAll} size="compact" />
      )}
    </SectionCard>
  );
}
