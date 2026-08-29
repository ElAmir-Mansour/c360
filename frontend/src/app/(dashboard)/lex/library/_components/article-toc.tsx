'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, Hash, List, Loader2 } from 'lucide-react';
import { enterpriseApi } from '@/lib/enterprise';
import { isApiError } from '@/types/api';
import { cn } from '@/lib/utils';
import { useLibraryLabels } from '../_lib/library-labels';

interface ArticleTocProps {
  docId: string;
  /** Jump the viewer to a page (reuses the detail page's jump-to-page command). */
  onJumpToPage: (page: number) => void;
  dir?: 'ltr' | 'rtl';
  className?: string;
}

/**
 * Collapsible "Articles / المواد" table-of-contents for a reference document.
 * Lists each article (number + label/title + page) from
 * `GET /reference-library/{id}/articles`; clicking one jumps the pdf.js viewer
 * to that page. Fully degrades: renders NOTHING when the endpoint is not
 * deployed (404) or returns no articles — it never fabricates an index.
 */
export function ArticleToc({
  docId,
  onJumpToPage,
  dir,
  className,
}: ArticleTocProps) {
  const labels = useLibraryLabels();
  const [open, setOpen] = useState(true);

  const articlesQuery = useQuery({
    queryKey: ['lex-reference-articles', docId],
    queryFn: () => enterpriseApi.lex.referenceLibrary.articles(docId),
    enabled: !!docId,
    // A 404 means "not deployed" — don't retry it into a spinner loop.
    retry: (count, error) =>
      !(isApiError(error) && error.status === 404) && count < 1,
    staleTime: 5 * 60 * 1000,
  });

  const articles = articlesQuery.data ?? [];

  // Graceful degradation: while loading show nothing (no layout jank); on error
  // or an empty index render nothing at all — the panel simply doesn't appear.
  if (articlesQuery.isLoading || articlesQuery.isError || articles.length === 0) {
    return null;
  }

  return (
    <section
      dir={dir}
      className={cn(
        'bg-card shadow-elevation-1 rounded-xl border border-[color:var(--card-border)]',
        className,
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-start focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <List className="h-4 w-4 shrink-0 text-primary" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-foreground">
            {labels.articles.title}
          </span>
          <span className="block text-[11px] text-muted-foreground">
            {labels.articles.count(articles.length)}
          </span>
        </span>
        <ChevronDown
          className={cn(
            'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-180',
          )}
          aria-hidden
        />
      </button>

      {open ? (
        <ul className="max-h-[320px] overflow-y-auto border-t px-1.5 py-1.5">
          {articles.map((article, index) => {
            const label = article.label?.trim() || article.article_no;
            const page = typeof article.page === 'number' ? article.page : undefined;
            return (
              <li key={`${article.article_no}-${index}`}>
                <button
                  type="button"
                  disabled={page === undefined}
                  onClick={() => page !== undefined && onJumpToPage(page)}
                  aria-label={labels.articles.jumpToAria(label)}
                  className="group flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-start transition-colors hover:bg-primary/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-60"
                >
                  <Hash className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span dir="auto" className="block truncate text-sm text-foreground">
                      {label}
                    </span>
                    {article.title?.trim() ? (
                      <span
                        dir="auto"
                        className="block truncate text-xs text-muted-foreground"
                      >
                        {article.title}
                      </span>
                    ) : null}
                  </span>
                  {page !== undefined ? (
                    <span className="shrink-0 rounded-full border border-border/60 bg-muted/50 px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
                      {labels.articles.pageLabel(String(page))}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
