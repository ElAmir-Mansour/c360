'use client';

/**
 * Related & documents card — the right-rail surface for a Litigation Case
 * detail page. Gathers, in one cohesive ~360px card, everything a case connects
 * to:
 *
 *   1. ORIGINATING REQUEST — a deep link to the service-desk request this case
 *      was spawned from (`request_id`), when present.
 *   2. CASE RECORDS — compact in-page deep links (with live counts) to the
 *      litigation sub-collections: hearings, judgments, statement-of-claim
 *      pleadings (plaintiff), the incoming-lawsuit register (defendant), and the
 *      documents tab.
 *
 * The record rows navigate WITHIN the detail page (tab switch via `onOpenTab`);
 * only the originating request is an external route. Mirrors the service-desk
 * `RequestRelatedCard` gold standard. Bilingual + RTL via logical utilities.
 */

import type { ReactNode } from 'react';
import Link from 'next/link';
import {
  ExternalLink,
  FileText,
  Gavel,
  Inbox,
  Link2,
  ScrollText,
  Scale,
} from 'lucide-react';
import { SectionCard } from '@/components/suites/section-card';
import { Badge } from '@/components/ui/badge';
import { useCaseDetailExtraLabels } from './case-detail-labels';
import type { LegalCase } from '@/lib/lex/cases';

export interface CaseRelatedCardProps {
  legalCase: LegalCase;
  isPlaintiff: boolean;
  isDefendant: boolean;
  counts: {
    hearings: number;
    judgments: number;
    pleadings: number;
    defendant: number;
  };
  onOpenTab: (tab: string) => void;
  className?: string;
}

function RailSubheading({ icon: Icon, children }: { icon: typeof Link2; children: ReactNode }) {
  return (
    <div className="mb-2.5 flex items-center gap-2">
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="text-overline font-semibold uppercase tracking-wide text-muted-foreground">
        {children}
      </span>
    </div>
  );
}

/** A compact row that either links externally (`href`) or switches tabs (`onClick`). */
function RailRow({
  icon: Icon,
  title,
  href,
  onClick,
  ariaLabel,
  count,
  external = false,
}: {
  icon: typeof Gavel;
  title: string;
  href?: string;
  onClick?: () => void;
  ariaLabel: string;
  count?: string;
  external?: boolean;
}) {
  const inner = (
    <>
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground" dir="auto">
        {title}
      </span>
      {count !== undefined ? (
        <Badge variant="neutral" size="sm" className="tabular-nums">
          {count}
        </Badge>
      ) : null}
      {external ? (
        <ExternalLink
          className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-primary"
          aria-hidden
        />
      ) : null}
    </>
  );

  const shared =
    'group flex items-center gap-2.5 rounded-lg border border-border/60 bg-card/50 px-2.5 py-2 shadow-elevation-1 transition-colors duration-fast ease-standard hover:border-primary/30 hover:bg-primary/5';

  if (href) {
    return (
      <Link href={href} aria-label={ariaLabel} className={shared}>
        {inner}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} aria-label={ariaLabel} className={`${shared} w-full text-start`}>
      {inner}
    </button>
  );
}

export function CaseRelatedCard({
  legalCase,
  isPlaintiff,
  isDefendant,
  counts,
  onOpenTab,
  className,
}: CaseRelatedCardProps) {
  const t = useCaseDetailExtraLabels().related;

  const records: ReactNode[] = [
    <RailRow
      key="hearings"
      icon={Gavel}
      title={t.hearings}
      onClick={() => onOpenTab('hearings')}
      ariaLabel={t.hearings}
      count={t.counter(String(counts.hearings))}
    />,
  ];
  if (isPlaintiff) {
    records.push(
      <RailRow
        key="pleadings"
        icon={ScrollText}
        title={t.pleadings}
        onClick={() => onOpenTab('pleadings')}
        ariaLabel={t.pleadings}
        count={t.counter(String(counts.pleadings))}
      />,
      <RailRow
        key="judgments"
        icon={Scale}
        title={t.judgments}
        onClick={() => onOpenTab('judgments')}
        ariaLabel={t.judgments}
        count={t.counter(String(counts.judgments))}
      />,
    );
  }
  if (isDefendant) {
    records.push(
      <RailRow
        key="defendant"
        icon={Inbox}
        title={t.defendant}
        onClick={() => onOpenTab('defendant')}
        ariaLabel={t.defendant}
        count={t.counter(String(counts.defendant))}
      />,
    );
  }
  records.push(
    <RailRow
      key="documents"
      icon={FileText}
      title={t.documents}
      onClick={() => onOpenTab('documents')}
      ariaLabel={t.documents}
    />,
  );

  return (
    <SectionCard title={t.title} description={t.description} className={className}>
      <div className="divide-y divide-border/60">
        {legalCase.request_id ? (
          <div className="py-4 first:pt-0 last:pb-0">
            <RailSubheading icon={Link2}>{t.linkedRequestHeading}</RailSubheading>
            <RailRow
              icon={ExternalLink}
              title={t.linkedRequestTitle}
              href={`/lex/service-desk/${legalCase.request_id}`}
              ariaLabel={t.viewRequest}
              external
            />
          </div>
        ) : null}

        <div className="py-4 first:pt-0 last:pb-0">
          <RailSubheading icon={FileText}>{t.itemsHeading}</RailSubheading>
          <div className="space-y-2">{records}</div>
        </div>
      </div>
    </SectionCard>
  );
}
