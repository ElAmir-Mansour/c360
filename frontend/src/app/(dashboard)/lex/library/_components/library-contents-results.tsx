'use client';

import { FileSearch, Loader2, TriangleAlert } from 'lucide-react';
import { useLexFormat } from '@/lib/lex/ksa';
import { useLocale } from '@/components/providers/locale-provider';
import { EmptyState } from '@/components/common/empty-state';
import { cn } from '@/lib/utils';
import { highlightSegments, resolveHitTitles } from '../_lib/library-helpers';
import { useLibraryLabels } from '../_lib/library-labels';
import type { OpenDocumentOptions } from './ask-library-panel';
import type { LexReferenceSearchHit } from '@/types/suites';

interface LibraryContentsResultsProps {
  hits: LexReferenceSearchHit[] | undefined;
  loading: boolean;
  error: boolean;
  query: string;
  onOpenDocument: (docId: string, opts?: OpenDocumentOptions) => void;
}

/**
 * Contents-search ("Second Brain") result list. Renders ranked passages with a
 * highlighted snippet + a relevance meter; a click opens the source document in
 * the read-only preview, DEEP-LINKED to the matching page (when known) and the
 * searched term highlighted in the viewer. Empty and loading states are
 * localized; a query-less contents mode shows a hint instead of firing a search.
 */
export function LibraryContentsResults({
  hits,
  loading,
  error,
  query,
  onOpenDocument,
}: LibraryContentsResultsProps) {
  const labels = useLibraryLabels();
  const { locale } = useLocale();
  const f = useLexFormat();

  if (!query.trim()) {
    return (
      <EmptyState
        icon={FileSearch}
        title={labels.search.contentsHint}
        description={labels.search.contentsEmptyDescription}
        size="compact"
      />
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 px-4 py-12 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        {labels.search.searching}
      </div>
    );
  }

  if (error) {
    return (
      <EmptyState
        icon={TriangleAlert}
        title={labels.error.title}
        description={labels.error.description}
        size="compact"
      />
    );
  }

  if (!hits || hits.length === 0) {
    return (
      <EmptyState
        icon={FileSearch}
        title={labels.search.contentsEmptyTitle}
        description={labels.search.contentsEmptyDescription}
        size="compact"
      />
    );
  }

  return (
    <div className="space-y-2 p-1">
      <p className="px-2 text-xs text-muted-foreground">
        {labels.search.contentsResults(hits.length)}
      </p>
      <ul className="space-y-2">
        {hits.map((hit, index) => {
          const titles = resolveHitTitles(hit, locale);
          const scorePct = Math.round(Math.max(0, Math.min(1, hit.score)) * 100);
          const page = typeof hit.page === 'number' ? hit.page : undefined;
          return (
            <li key={`${hit.doc_id}-${index}`}>
              <button
                type="button"
                onClick={() =>
                  onOpenDocument(hit.doc_id, { page, snippet: query })
                }
                aria-label={labels.search.openAtPageAria(titles.primary)}
                className="group flex w-full flex-col gap-1.5 rounded-xl border bg-card/50 px-4 py-3 text-start transition-colors hover:border-primary/30 hover:bg-primary/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="flex items-start justify-between gap-3">
                  <span
                    dir="auto"
                    className="min-w-0 flex-1 truncate font-medium text-foreground"
                  >
                    {titles.primary}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {page ? (
                      <span className="rounded-full border border-border/60 bg-muted/50 px-2 py-0.5 text-[11px] tabular-nums text-muted-foreground">
                        {labels.viewer.thumbnailPage(f.formatNumber(page))}
                      </span>
                    ) : null}
                    <span className="rounded-full border border-border/60 bg-muted/50 px-2 py-0.5 text-[11px] tabular-nums text-muted-foreground">
                      {labels.search.relevance} {f.formatNumber(scorePct)}%
                    </span>
                  </span>
                </div>
                {titles.secondary ? (
                  <span dir="auto" className="text-xs text-muted-foreground">
                    {titles.secondary}
                  </span>
                ) : null}
                {hit.snippet ? (
                  <span
                    dir="auto"
                    className="text-sm leading-6 text-muted-foreground line-clamp-3"
                  >
                    <HighlightedText text={hit.snippet} query={query} />
                  </span>
                ) : null}
                <RelevanceMeter value={scorePct} />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Arabic-aware highlighted snippet — wraps matched runs in a soft <mark>. */
function HighlightedText({ text, query }: { text: string; query: string }) {
  const segments = highlightSegments(text, query);
  return (
    <>
      {segments.map((segment, i) =>
        segment.match ? (
          <mark
            key={i}
            className="rounded bg-amber-400/40 px-0.5 text-foreground dark:bg-amber-500/30"
          >
            {segment.text}
          </mark>
        ) : (
          <span key={i}>{segment.text}</span>
        ),
      )}
    </>
  );
}

function RelevanceMeter({ value }: { value: number }) {
  return (
    <span className="mt-0.5 block h-1 w-full overflow-hidden rounded-full bg-muted">
      <span
        className={cn('block h-full rounded-full bg-primary/70 transition-[width]')}
        style={{ width: `${Math.max(4, Math.min(100, value))}%` }}
      />
    </span>
  );
}
