'use client';

import { useEffect, useMemo, useState } from 'react';
import { Building2, ChevronRight, FileText, Tags } from 'lucide-react';

import { useLocale } from '@/components/providers/locale-provider';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import type { LexReferenceDocument } from '@/types/suites';
import { resolveDocTitles } from '../_lib/library-helpers';
import { useLibraryLabels } from '../_lib/library-labels';

export type LibraryKpiDrilldownSelection = {
  id: string;
  label: string;
  mode: 'documents' | 'authority' | 'topic';
  category?: string;
};

type ContributorGroup = {
  key: string;
  count: number;
};

export function LibraryKpiDrilldownSheet({
  selection,
  docs,
  open,
  onOpenChange,
  onOpenDocument,
}: {
  selection: LibraryKpiDrilldownSelection | null;
  docs: LexReferenceDocument[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenDocument: (documentId: string) => void;
}) {
  const { locale, direction } = useLocale();
  const labels = useLibraryLabels();
  const [activeGroup, setActiveGroup] = useState<string | null>(null);

  useEffect(() => setActiveGroup(null), [selection?.id]);

  const directDocuments = useMemo(() => {
    if (!selection || selection.mode !== 'documents') return [];
    if (!selection.category) return docs;
    return docs.filter((doc) => doc.category === selection.category);
  }, [docs, selection]);

  const groups = useMemo<ContributorGroup[]>(() => {
    if (!selection || selection.mode === 'documents') return [];
    const counts = new Map<string, number>();
    for (const doc of docs) {
      const values =
        selection.mode === 'authority'
          ? [doc.authority?.trim()].filter((value): value is string => Boolean(value))
          : doc.tags.map((tag) => tag.trim()).filter(Boolean);
      for (const value of new Set(values)) {
        counts.set(value, (counts.get(value) ?? 0) + 1);
      }
    }
    return Array.from(counts, ([key, count]) => ({ key, count })).sort(
      (left, right) => right.count - left.count || left.key.localeCompare(right.key),
    );
  }, [docs, selection]);

  const groupedDocuments = useMemo(() => {
    if (!selection || !activeGroup) return [];
    return docs.filter((doc) =>
      selection.mode === 'authority'
        ? doc.authority?.trim() === activeGroup
        : doc.tags.some((tag) => tag.trim() === activeGroup),
    );
  }, [activeGroup, docs, selection]);

  const visibleDocuments =
    selection?.mode === 'documents' ? directDocuments : groupedDocuments;
  const description =
    selection?.mode === 'documents'
      ? labels.drilldown.documentCount(directDocuments.length)
      : activeGroup
        ? `${activeGroup} · ${labels.drilldown.documentCount(groupedDocuments.length)}`
        : labels.drilldown.groupCount(groups.length);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={direction === 'rtl' ? 'left' : 'right'}
        dir={direction}
        className="flex w-full flex-col overflow-hidden sm:max-w-2xl"
      >
        <SheetHeader className="text-start">
          <SheetTitle className="flex items-center gap-2 text-start">
            {selection?.mode === 'authority' ? (
              <Building2 className="h-5 w-5 text-primary" aria-hidden />
            ) : selection?.mode === 'topic' ? (
              <Tags className="h-5 w-5 text-primary" aria-hidden />
            ) : (
              <FileText className="h-5 w-5 text-primary" aria-hidden />
            )}
            {selection?.label ?? labels.drilldown.contributingDocuments}
          </SheetTitle>
          <SheetDescription className="text-start">{description}</SheetDescription>
        </SheetHeader>

        <div className="mt-5 min-h-0 flex-1 overflow-y-auto pe-1">
          {selection && selection.mode !== 'documents' && !activeGroup ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {labels.drilldown.selectGroup}
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {groups.map((group) => (
                  <Button
                    key={group.key}
                    type="button"
                    variant="outline"
                    dir="auto"
                    onClick={() => setActiveGroup(group.key)}
                    className="h-auto min-h-12 w-full justify-start gap-3 rounded-xl border-border/70 bg-card px-3 py-2 text-start font-normal hover:border-primary/30 hover:bg-primary/5"
                  >
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {group.key}
                    </span>
                    <span className="tabular-nums text-sm text-muted-foreground">
                      {group.count}
                    </span>
                    <ChevronRight
                      className="h-4 w-4 shrink-0 text-muted-foreground rtl:rotate-180"
                      aria-hidden
                    />
                  </Button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {selection?.mode !== 'documents' && activeGroup ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="px-0"
                  onClick={() => setActiveGroup(null)}
                >
                  <ChevronRight className="me-1.5 h-4 w-4 rotate-180 rtl:rotate-0" aria-hidden />
                  {labels.drilldown.allGroups}
                </Button>
              ) : null}

              {visibleDocuments.length === 0 ? (
                <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                  {labels.drilldown.empty}
                </p>
              ) : (
                visibleDocuments.map((doc) => {
                  const titles = resolveDocTitles(doc, locale);
                  return (
                    <Button
                      key={doc.id}
                      type="button"
                      variant="outline"
                      onClick={() => onOpenDocument(doc.id)}
                      aria-label={labels.drilldown.openDocument(titles.primary)}
                      className="h-auto w-full items-start justify-start gap-3 rounded-xl border-border/70 bg-card p-3 text-start font-normal hover:border-primary/30 hover:bg-primary/5"
                    >
                      <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                        <FileText className="h-4 w-4" aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span dir="auto" className="block truncate font-medium text-foreground">
                          {titles.primary}
                        </span>
                        <span className="mt-1 block truncate text-xs text-muted-foreground">
                          {[doc.authority, labels.category[doc.category] ?? doc.category]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </span>
                      <ChevronRight
                        className="mt-2 h-4 w-4 shrink-0 text-muted-foreground rtl:rotate-180"
                        aria-hidden
                      />
                    </Button>
                  );
                })
              )}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
