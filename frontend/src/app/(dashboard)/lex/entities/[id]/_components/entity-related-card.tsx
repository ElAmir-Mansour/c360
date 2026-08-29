'use client';

/**
 * ENTITY-360 detail — right-rail Linked-records card (#5), the CENTRAL surface
 * for a counterparty profile. In one ~360px card it gathers everything the
 * organization is a party to across the suite: contracts, cases and settlements.
 *
 * Each of the three kinds gets a subsection with a total-count badge and up to
 * {@link MAX_PER_KIND} of the most-recent deep links (title + localized
 * kind/status/relative-time meta), plus a "View all N" affordance that hands
 * control back to the page to switch the matching full-list tab. Kinds with no
 * records are omitted; a (theoretical) org with nothing linked shows an empty
 * state. Derived from the `entity` prop — no fetch. Mirrors the service-desk
 * `RequestRelatedCard` structure (RailSubheading + RailLinkRow).
 */

import type { ReactNode } from 'react';
import Link from 'next/link';
import { ExternalLink, FileText, Gavel, Handshake, Link2, type LucideIcon } from 'lucide-react';
import { SectionCard } from '@/components/suites/section-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/common/empty-state';
import type { LexFormatter } from '@/lib/lex/ksa';
import type { EntityFootprint, EntityLink, EntityRecordKind } from '../../_lib/entity-data';
import { useEntityLabels } from '../../_lib/entity-i18n';
import { useEntityDetailLabels } from './entity-detail-labels';
import { useEntityStatusLabel, useRecordKindLabel } from './entity-enums-i18n';

export type EntityRelatedTab = 'contracts' | 'cases' | 'settlements';

export interface EntityRelatedCardProps {
  entity: EntityFootprint;
  f: LexFormatter;
  onGoToTab: (tab: EntityRelatedTab) => void;
  className?: string;
}

/** Rail is compact — only the freshest few records of each kind are worth space. */
const MAX_PER_KIND = 3;

const KIND_ICON: Record<EntityRecordKind, LucideIcon> = {
  contract: FileText,
  case: Gavel,
  settlement: Handshake,
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
  title,
  meta,
}: {
  href: string;
  title: string;
  meta: string;
}) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-2.5 rounded-lg border border-border/60 bg-card/50 px-2.5 py-2 shadow-elevation-1 transition-colors duration-fast ease-standard hover:border-primary/30 hover:bg-primary/5"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground group-hover:text-primary" dir="auto">
          {title}
        </span>
        <span className="block truncate text-xs text-muted-foreground" dir="auto">
          {meta}
        </span>
      </span>
      <ExternalLink
        className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-primary rtl:-scale-x-100"
        aria-hidden
      />
    </Link>
  );
}

export function EntityRelatedCard({ entity, f, onGoToTab, className }: EntityRelatedCardProps) {
  const t = useEntityDetailLabels().related;
  const shared = useEntityLabels().detail;
  const kindLabel = useRecordKindLabel();
  const statusLabel = useEntityStatusLabel();

  // Annotate the literal (not the filtered result) so the string literals keep
  // their narrow EntityRecordKind/EntityRelatedTab types through .filter().
  const sections = (
    [
      { kind: 'contract', tab: 'contracts', heading: shared.sections.contracts, records: entity.contracts },
      { kind: 'case', tab: 'cases', heading: shared.sections.cases, records: entity.cases },
      { kind: 'settlement', tab: 'settlements', heading: shared.sections.settlements, records: entity.settlements },
    ] satisfies {
      kind: EntityRecordKind;
      tab: EntityRelatedTab;
      heading: string;
      records: EntityLink[];
    }[]
  ).filter((s) => s.records.length > 0);

  if (sections.length === 0) {
    return (
      <SectionCard title={t.title} description={t.description} className={className}>
        <EmptyState icon={Link2} title={t.empty} size="compact" />
      </SectionCard>
    );
  }

  return (
    <SectionCard title={t.title} description={t.description} className={className}>
      <div className="divide-y divide-border/60">
        {sections.map((section) => {
          const Icon = KIND_ICON[section.kind];
          const shown = section.records.slice(0, MAX_PER_KIND);
          const total = section.records.length;
          return (
            <section key={section.kind} className="py-4 first:pt-0 last:pb-0">
              <RailSubheading
                icon={Icon}
                trailing={
                  <Badge variant="neutral" size="sm" className="tabular-nums">
                    {f.formatNumber(total)}
                  </Badge>
                }
              >
                {section.heading}
              </RailSubheading>
              <ul className="space-y-2">
                {shown.map((record) => (
                  <li key={`${record.kind}-${record.id}`}>
                    <RailLinkRow
                      href={record.href}
                      title={record.title || (record.reference ?? '—')}
                      meta={[
                        kindLabel(record.kind),
                        statusLabel(record.kind, record.status),
                        f.formatRelative(record.updatedAt),
                      ].join(' · ')}
                    />
                  </li>
                ))}
              </ul>
              {total > shown.length ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="mt-2 w-full justify-center text-xs"
                  onClick={() => onGoToTab(section.tab)}
                >
                  {t.viewAll(f.formatNumber(total))}
                </Button>
              ) : null}
            </section>
          );
        })}
      </div>
    </SectionCard>
  );
}
