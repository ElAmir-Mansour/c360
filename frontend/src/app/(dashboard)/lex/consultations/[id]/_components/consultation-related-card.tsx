'use client';

/**
 * Right-rail "Related & attachments" card for the consultation detail page. It
 * gathers, in one ~360px card, everything the consultation *connects to*:
 *
 *   1. LINKED LEGAL REQUEST — a compact deep link to the service-desk request
 *      this consultation was spawned from (when `legal_request_id` is set). The
 *      route mirrors the one the detail page already used.
 *   2. DOCUMENTS — the attached supporting documents (name + kind + date), with
 *      a header counter. Read-only here (no download URL is exposed on the API);
 *      attach/detach lives in the main Documents tab.
 *   3. TAGS — the consultation's tag set as chips.
 *
 * Degrades gracefully: each subsection renders only when it has content; if the
 * consultation connects to nothing, a single compact empty state shows.
 */

import type { ReactNode } from 'react';
import Link from 'next/link';
import { ExternalLink, FileText, Link2, Paperclip, Tag } from 'lucide-react';
import { SectionCard } from '@/components/suites/section-card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/common/empty-state';
import { useLexFormat } from '@/lib/lex/ksa';
import type { Consultation } from '@/lib/lex/consultations';
import { useConsultationDetailLabels } from './detail-extra-labels';

export interface ConsultationRelatedCardProps {
  consultation: Consultation;
  className?: string;
}

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

export function ConsultationRelatedCard({ consultation, className }: ConsultationRelatedCardProps) {
  const t = useConsultationDetailLabels().related;
  const f = useLexFormat();

  const documents = consultation.documents ?? [];
  const tags = consultation.tags ?? [];
  const legalRequestId = consultation.legal_request_id?.trim();

  const blocks: ReactNode[] = [];

  // 1) LINKED LEGAL REQUEST.
  if (legalRequestId) {
    blocks.push(
      <section key="linked">
        <RailSubheading icon={Link2}>{t.linkedRequestHeading}</RailSubheading>
        <Link
          href={`/lex/legal-requests/${legalRequestId}`}
          aria-label={t.openLinkedRequest}
          className="group flex items-center gap-2.5 rounded-lg border border-border/60 bg-card/50 px-2.5 py-2 shadow-elevation-1 transition-colors duration-fast ease-standard hover:border-primary/30 hover:bg-primary/5"
        >
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
            <FileText className="h-4 w-4" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-mono text-xs text-foreground" dir="ltr" title={legalRequestId}>
              {legalRequestId}
            </span>
          </span>
          <ExternalLink
            className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-primary"
            aria-hidden
          />
        </Link>
      </section>,
    );
  }

  // 2) DOCUMENTS (read-only status; attach/detach is on the Documents tab).
  if (documents.length > 0) {
    blocks.push(
      <section key="documents">
        <RailSubheading
          icon={Paperclip}
          trailing={
            <Badge variant="neutral" size="sm" className="tabular-nums">
              {t.documentsCounter(documents.length)}
            </Badge>
          }
        >
          {t.documentsHeading}
        </RailSubheading>
        <ul className="space-y-2">
          {documents.map((doc) => (
            <li key={doc.id} className="flex items-start gap-2.5">
              <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground" dir="auto" title={doc.file_name}>
                  {doc.file_name}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {doc.kind} • {f.formatDual(doc.created_at)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </section>,
    );
  }

  // 3) TAGS.
  if (tags.length > 0) {
    blocks.push(
      <section key="tags">
        <RailSubheading icon={Tag}>{t.tagsHeading}</RailSubheading>
        <div className="flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <Badge key={tag} variant="outline" size="sm">
              {tag}
            </Badge>
          ))}
        </div>
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
