'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { FileText, Loader2 } from 'lucide-react';
import { enterpriseApi } from '@/lib/enterprise';
import { useLocale } from '@/components/providers/locale-provider';
import { resolveDocTitles } from '../../_lib/library-helpers';
import { useLibraryLabels } from '../../_lib/library-labels';
import { ClassificationChips } from '../../_components/reference-chips';
import type { LexReferenceDocument } from '@/types/suites';

interface RelatedDocumentsProps {
  doc: LexReferenceDocument;
}

/**
 * "Related documents" rail for the detail page — sibling documents from the same
 * corpus category, excluding the current one. Sourced from the same list
 * endpoint (filtered by `category`); each entry deep-links to its own detail
 * route. Fully localized + RTL-aware.
 */
export function RelatedDocuments({ doc }: RelatedDocumentsProps) {
  const labels = useLibraryLabels();
  const { locale } = useLocale();

  const relatedQuery = useQuery({
    queryKey: ['lex-reference-related', doc.category, doc.id],
    queryFn: () =>
      enterpriseApi.lex.referenceLibrary.list({
        page: 1,
        per_page: 8,
        filters: { category: doc.category },
      }),
  });

  const related = (relatedQuery.data?.data ?? []).filter((d) => d.id !== doc.id).slice(0, 6);

  if (relatedQuery.isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      </div>
    );
  }

  if (related.length === 0) {
    return (
      <p className="py-4 text-sm text-muted-foreground">{labels.detail.relatedEmpty}</p>
    );
  }

  return (
    <ul className="space-y-2">
      {related.map((item) => {
        const titles = resolveDocTitles(item, locale);
        return (
          <li key={item.id}>
            <Link
              href={`/lex/library/${item.id}`}
              className="group flex items-start gap-2 rounded-lg border bg-card/50 px-3 py-2 transition-colors hover:border-primary/30 hover:bg-primary/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border/60 bg-muted/40 text-muted-foreground">
                <FileText className="h-3.5 w-3.5" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span
                  dir="auto"
                  className="block truncate text-sm font-medium text-foreground"
                >
                  {titles.primary}
                </span>
                <span className="mt-1 block">
                  <ClassificationChips
                    category={item.category}
                    docType={item.doc_type}
                  />
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
