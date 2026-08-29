'use client';

import Link from 'next/link';
import { Clock, FileText, Sparkles } from 'lucide-react';
import { useLocale } from '@/components/providers/locale-provider';
import { useLexFormat } from '@/lib/lex/ksa';
import { Button } from '@/components/ui/button';
import { resolveDocTitles } from '../_lib/library-helpers';
import { useLibraryLabels } from '../_lib/library-labels';
import type { RecentView } from '../_lib/recent-views';
import type { LexReferenceDocument } from '@/types/suites';

interface LibraryHighlightsProps {
  docs: LexReferenceDocument[];
  recent: RecentView[];
  onClearRecent: () => void;
}

/**
 * Analytics surfaces for the library home: "Recently viewed" (client-local, per
 * this browser — honest, never claims org-wide analytics) and "Recently added"
 * (the corpus sorted by creation date). Both link into the shareable detail
 * route. Renders nothing until the corpus is available; the recently-viewed card
 * shows an honest hint when the user has opened nothing yet.
 */
export function LibraryHighlights({
  docs,
  recent,
  onClearRecent,
}: LibraryHighlightsProps) {
  const labels = useLibraryLabels();
  const { locale } = useLocale();
  const f = useLexFormat();

  if (docs.length === 0) return null;

  const byId = new Map(docs.map((d) => [d.id, d]));
  const recentDocs = recent
    .map((r) => byId.get(r.id))
    .filter((d): d is LexReferenceDocument => !!d)
    .slice(0, 5);

  const recentlyAdded = [...docs]
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .slice(0, 5);

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Panel
        icon={Clock}
        title={labels.analytics.recentlyViewed}
        description={labels.analytics.recentlyViewedDescription}
        action={
          recentDocs.length > 0 ? (
            <Button type="button" size="sm" variant="ghost" onClick={onClearRecent}>
              {labels.analytics.clearRecent}
            </Button>
          ) : null
        }
      >
        {recentDocs.length === 0 ? (
          <p className="px-1 py-2 text-xs text-muted-foreground">
            {labels.analytics.recentlyViewedEmpty}
          </p>
        ) : (
          <ul className="space-y-1">
            {recentDocs.map((doc) => (
              <HighlightRow key={doc.id} doc={doc} locale={locale} />
            ))}
          </ul>
        )}
      </Panel>

      <Panel
        icon={Sparkles}
        title={labels.analytics.recentlyAdded}
        description={labels.analytics.recentlyAddedDescription}
      >
        <ul className="space-y-1">
          {recentlyAdded.map((doc) => (
            <HighlightRow
              key={doc.id}
              doc={doc}
              locale={locale}
              meta={`${labels.analytics.addedPrefix} ${f.formatDate(doc.created_at)}`}
            />
          ))}
        </ul>
      </Panel>
    </div>
  );
}

function Panel({
  icon: Icon,
  title,
  description,
  action,
  children,
}: {
  icon: typeof Clock;
  title: string;
  description: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-card shadow-elevation-1 rounded-xl border border-[color:var(--card-border)] p-3">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Icon className="h-4 w-4 text-primary" aria-hidden />
          <div>
            <h3 className="text-sm font-semibold text-foreground">{title}</h3>
            <p className="text-[11px] text-muted-foreground">{description}</p>
          </div>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function HighlightRow({
  doc,
  locale,
  meta,
}: {
  doc: LexReferenceDocument;
  locale: ReturnType<typeof useLocale>['locale'];
  meta?: string;
}) {
  const titles = resolveDocTitles(doc, locale);
  return (
    <li>
      <Link
        href={`/lex/library/${doc.id}`}
        className="group flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-muted/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1">
          <span dir="auto" className="block truncate text-sm text-foreground">
            {titles.primary}
          </span>
          {meta ? (
            <span className="block text-[11px] tabular-nums text-muted-foreground">
              {meta}
            </span>
          ) : null}
        </span>
      </Link>
    </li>
  );
}
