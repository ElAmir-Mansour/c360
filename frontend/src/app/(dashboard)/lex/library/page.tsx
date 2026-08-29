'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { type ColumnDef } from '@tanstack/react-table';
import { useQuery } from '@tanstack/react-query';
import {
  Building2,
  BookMarked,
  Download,
  Eye,
  FileText,
  GraduationCap,
  Library,
  Scale,
  Gavel,
  Sparkles,
  Tags,
} from 'lucide-react';
import { LexRouteGuard } from '../_guards/lex-route-guard';
import { DataTable } from '@/components/shared/data-table/data-table';
import { SavedViewsBar } from '@/components/shared/saved-views-bar';
import { SearchInput } from '@/components/shared/forms/search-input';
import { LexListShell } from '@/components/lex/list-shell';
import { LexKpiStrip, type LexKpiItem } from '@/components/lex/kpi-strip';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useDataTable } from '@/hooks/use-data-table';
import { useDebounce } from '@/hooks/use-debounce';
import { useLocale } from '@/components/providers/locale-provider';
import { useAuth } from '@/hooks/use-auth';
import { enterpriseApi } from '@/lib/enterprise';
import { canAccessWith, LEX_ROUTE_PERMISSIONS } from '@/lib/permissions';
import { showApiError } from '@/lib/toast';
import type { FetchParams } from '@/types/table';
import type { LexReferenceDocument } from '@/types/suites';
import { resolveDocTitles } from './_lib/library-helpers';
import { useLibraryLabels } from './_lib/library-labels';
import { useRecentlyViewed } from './_lib/recent-views';
import { ClassificationChips } from './_components/reference-chips';
import { LibraryFacetTree } from './_components/library-facet-tree';
import { LibraryContentsResults } from './_components/library-contents-results';
import { LibraryPreviewSheet } from './_components/library-preview-sheet';
import { LibraryHighlights } from './_components/library-highlights';
import { AskLibrarySheet } from './_components/ask-library-sheet';
import {
  LibraryKpiDrilldownSheet,
  type LibraryKpiDrilldownSelection,
} from './_components/library-kpi-drilldown-sheet';
import type { OpenDocumentOptions } from './_components/ask-library-panel';

/** Downloads an in-memory Blob via a transient object-URL anchor (SSR-guarded). */
function saveBlob(blob: Blob, filename: string): void {
  if (typeof window === 'undefined' || typeof URL === 'undefined') return;
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  window.document.body.appendChild(anchor);
  anchor.click();
  window.document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function firstFilter(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value || undefined;
}

export default function LexLibraryPage() {
  const { locale, direction } = useLocale();
  const { hasPermission } = useAuth();
  const labels = useLibraryLabels();
  const canOpenClauseLibrary = canAccessWith(
    hasPermission,
    LEX_ROUTE_PERMISSIONS['/lex/clause-library'],
  );

  const [previewDocId, setPreviewDocId] = useState<string | null>(null);
  const [previewDeepLink, setPreviewDeepLink] = useState<OpenDocumentOptions | null>(
    null,
  );
  const [askOpen, setAskOpen] = useState(false);
  const [kpiDrilldown, setKpiDrilldown] =
    useState<LibraryKpiDrilldownSelection | null>(null);
  // Metadata (catalog) search vs. contents (Second Brain) semantic search.
  const [contentMode, setContentMode] = useState(false);
  const { recent, clear: clearRecent } = useRecentlyViewed();

  const facetsQuery = useQuery({
    queryKey: ['lex-reference-facets'],
    queryFn: () => enterpriseApi.lex.referenceLibrary.facets(),
  });
  const facets = facetsQuery.data;

  // The whole (small) corpus, fetched once, powers the analytics surfaces
  // (recently viewed / recently added) and the distinct-authority/topic KPIs.
  const corpusQuery = useQuery({
    queryKey: ['lex-reference-corpus'],
    queryFn: () =>
      enterpriseApi.lex.referenceLibrary.list({ page: 1, per_page: 200 }),
  });
  const corpus = useMemo(() => corpusQuery.data?.data ?? [], [corpusQuery.data]);

  const openDocument = (docId: string, opts?: OpenDocumentOptions) => {
    setPreviewDeepLink(opts ?? null);
    setPreviewDocId(docId);
  };

  const { tableProps, searchValue, setSearch, setFilter, activeFilters } =
    useDataTable<LexReferenceDocument>({
      queryKey: 'lex-reference-library',
      fetchFn: (params: FetchParams) =>
        enterpriseApi.lex.referenceLibrary.list(params),
      defaultPageSize: 25,
      defaultSort: { column: 'title_ar', direction: 'asc' },
    });

  const activeCategory = firstFilter(activeFilters.category);
  const activeDocType = firstFilter(activeFilters.doc_type);
  const activeTag = firstFilter(activeFilters.tag);

  // Contents search — debounced, only fires in contents mode with a query.
  const debouncedQuery = useDebounce(searchValue, 350);
  const contentsQuery = useQuery({
    queryKey: ['lex-reference-contents', debouncedQuery],
    queryFn: () =>
      enterpriseApi.lex.referenceLibrary.search(debouncedQuery.trim(), 10),
    enabled: contentMode && debouncedQuery.trim().length > 0,
  });

  // Total across the corpus: prefer the summed facets (stable), fall back to the
  // table's server total when facets have not loaded yet.
  const totalCount = useMemo(() => {
    if (facets) {
      return facets.categories.reduce((sum, c) => sum + c.count, 0);
    }
    return tableProps.totalRows;
  }, [facets, tableProps.totalRows]);

  const categoryCount = (key: string): number =>
    facets?.categories.find((c) => c.key === key)?.count ?? 0;

  // Distinct issuing bodies + topics across the corpus (honest counts, not the
  // truncated facet top-N).
  const { authoritiesCount, topicsCount } = useMemo(() => {
    const authorities = new Set<string>();
    const topics = new Set<string>();
    for (const doc of corpus) {
      const authority = doc.authority?.trim();
      if (authority) authorities.add(authority);
      for (const tag of doc.tags) {
        const t = tag.trim();
        if (t) topics.add(t);
      }
    }
    return { authoritiesCount: authorities.size, topicsCount: topics.size };
  }, [corpus]);

  const kpiItems: LexKpiItem[] = [
    {
      id: 'total',
      label: labels.kpis.total,
      value: totalCount,
      description: labels.kpis.totalDescription,
      icon: Library,
      theme: 'primary',
      loading: facetsQuery.isLoading,
      pressed: kpiDrilldown?.id === 'total',
      onAction: () =>
        setKpiDrilldown({
          id: 'total',
          label: labels.kpis.total,
          mode: 'documents',
        }),
    },
    {
      id: 'systems-regulations',
      label: labels.kpis.systemsRegulations,
      value: categoryCount('systems-regulations'),
      icon: Scale,
      theme: 'primary',
      loading: facetsQuery.isLoading,
      pressed: kpiDrilldown?.id === 'systems-regulations',
      onAction: () =>
        setKpiDrilldown({
          id: 'systems-regulations',
          label: labels.kpis.systemsRegulations,
          mode: 'documents',
          category: 'systems-regulations',
        }),
    },
    {
      id: 'judicial-journal',
      label: labels.kpis.judicialJournal,
      value: categoryCount('judicial-journal'),
      icon: Gavel,
      theme: 'primary',
      loading: facetsQuery.isLoading,
      pressed: kpiDrilldown?.id === 'judicial-journal',
      onAction: () =>
        setKpiDrilldown({
          id: 'judicial-journal',
          label: labels.kpis.judicialJournal,
          mode: 'documents',
          category: 'judicial-journal',
        }),
    },
    {
      id: 'research',
      label: labels.kpis.research,
      value: categoryCount('research'),
      icon: GraduationCap,
      theme: 'teal',
      loading: facetsQuery.isLoading,
      pressed: kpiDrilldown?.id === 'research',
      onAction: () =>
        setKpiDrilldown({
          id: 'research',
          label: labels.kpis.research,
          mode: 'documents',
          category: 'research',
        }),
    },
    {
      id: 'authorities',
      label: labels.analytics.authoritiesKpi,
      value: authoritiesCount,
      icon: Building2,
      theme: 'amber',
      loading: corpusQuery.isLoading,
      pressed: kpiDrilldown?.id === 'authorities',
      onAction: () =>
        setKpiDrilldown({
          id: 'authorities',
          label: labels.analytics.authoritiesKpi,
          mode: 'authority',
        }),
    },
    {
      id: 'topics',
      label: labels.analytics.topicsKpi,
      value: topicsCount,
      icon: Tags,
      theme: 'primary',
      loading: corpusQuery.isLoading,
      pressed: kpiDrilldown?.id === 'topics',
      onAction: () =>
        setKpiDrilldown({
          id: 'topics',
          label: labels.analytics.topicsKpi,
          mode: 'topic',
        }),
    },
  ];

  async function downloadReferenceDoc(doc: LexReferenceDocument) {
    if (!doc.file_id) return;
    try {
      const blob = await enterpriseApi.lex.referenceLibrary.download(doc.id);
      const titles = resolveDocTitles(doc, locale);
      saveBlob(blob, `${titles.primary}.pdf`);
    } catch (error) {
      showApiError(error);
    }
  }

  const columns: ColumnDef<LexReferenceDocument>[] = [
    {
      id: 'title_ar',
      accessorKey: 'title_ar',
      header: labels.columns.document,
      enableSorting: true,
      cell: ({ row }) => {
        const doc = row.original;
        const titles = resolveDocTitles(doc, locale);
        return (
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-muted/40 text-muted-foreground">
              <FileText className="h-4 w-4" aria-hidden />
            </span>
            <div className="min-w-0">
              <p dir="auto" className="truncate font-medium text-foreground">
                {titles.primary}
              </p>
              {titles.secondary ? (
                <p dir="auto" className="truncate text-xs text-muted-foreground">
                  {titles.secondary}
                </p>
              ) : null}
            </div>
          </div>
        );
      },
    },
    {
      id: 'classification',
      header: labels.columns.classification,
      cell: ({ row }) => (
        <ClassificationChips
          category={row.original.category}
          docType={row.original.doc_type}
        />
      ),
    },
    {
      id: 'authority',
      header: labels.columns.authority,
      cell: ({ row }) => (
        <span dir="auto" className="text-sm text-foreground">
          {row.original.authority?.trim() || labels.cells.noAuthority}
        </span>
      ),
    },
    {
      id: 'tags',
      header: labels.columns.topics,
      cell: ({ row }) => (
        <span dir="auto" className="text-sm text-muted-foreground">
          {row.original.tags.length > 0
            ? row.original.tags.join('، ')
            : labels.cells.noTopics}
        </span>
      ),
    },
    {
      id: 'actions',
      header: '',
      enableHiding: false,
      cell: ({ row }) => {
        const doc = row.original;
        return (
          <div className="flex items-center justify-end gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label={labels.actions.preview}
              title={labels.actions.preview}
              onClick={(event) => {
                event.stopPropagation();
                setPreviewDocId(doc.id);
              }}
            >
              <Eye className="h-4 w-4" aria-hidden />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              disabled={!doc.file_id}
              aria-label={labels.actions.download}
              title={labels.actions.download}
              onClick={(event) => {
                event.stopPropagation();
                void downloadReferenceDoc(doc);
              }}
            >
              <Download className="h-4 w-4" aria-hidden />
            </Button>
          </div>
        );
      },
    } satisfies ColumnDef<LexReferenceDocument>,
  ];

  const searchControls = (
    <div className="flex w-full flex-wrap items-center gap-2">
      <div className="min-w-[200px] flex-1">
        <SearchInput
          value={searchValue}
          onChange={setSearch}
          placeholder={
            contentMode
              ? labels.search.placeholder
              : labels.table.searchPlaceholder
          }
          loading={contentMode ? contentsQuery.isFetching : tableProps.isLoading}
        />
      </div>
      <div
        className="inline-flex items-center gap-1 rounded-full border p-0.5"
        role="group"
        aria-label={labels.search.modeAria}
      >
        <SearchModeButton
          active={!contentMode}
          label={labels.search.metadataMode}
          onClick={() => setContentMode(false)}
        />
        <SearchModeButton
          active={contentMode}
          label={labels.search.contentsMode}
          onClick={() => setContentMode(true)}
        />
      </div>
    </div>
  );

  const headerActions = (
    <div className="flex flex-wrap items-center gap-2">
      {canOpenClauseLibrary ? (
        <Button asChild variant="outline">
          <Link href="/lex/clause-library">
            <BookMarked className="me-1.5 h-4 w-4" aria-hidden />
            {labels.actions.clauseLibrary}
          </Link>
        </Button>
      ) : null}
      <Button type="button" onClick={() => setAskOpen(true)}>
        <Sparkles className="me-1.5 h-4 w-4" aria-hidden />
        {labels.actions.askLibrary}
      </Button>
    </div>
  );

  return (
    <LexRouteGuard route="/lex/library">
      <div dir={direction} lang={locale}>
        <LexListShell
          title={labels.pageTitle}
          description={labels.pageDescription}
          eyebrow={labels.eyebrow}
          actions={headerActions}
          dir={direction === 'rtl' ? 'rtl' : 'ltr'}
          kpi={<LexKpiStrip items={kpiItems} dir={direction === 'rtl' ? 'rtl' : 'ltr'} />}
          framedBody={false}
        >
          {contentMode ? (
            <div className="space-y-3">
              {searchControls}
              <div className="overflow-hidden rounded-2xl border border-border/60 bg-card/60 shadow-elevation-1">
                <LibraryContentsResults
                  hits={contentsQuery.data}
                  loading={contentsQuery.isFetching}
                  error={contentsQuery.isError}
                  query={debouncedQuery}
                  onOpenDocument={openDocument}
                />
              </div>
            </div>
          ) : (
            // Documents-first layout: the table is the primary content; the facet
            // browser + saved views live in a secondary side rail (start-side on
            // desktop, below the table on mobile), so users land on documents, not
            // chrome. Recently-viewed / added highlights sit below the table.
            <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
              <div className="min-w-0 space-y-4 lg:order-2">
                <DataTable
                  {...tableProps}
                  columns={columns}
                  onRowClick={(row) => openDocument(row.id)}
                  getRowId={(row) => row.id}
                  enableColumnToggle
                  enableDensityToggle
                  stickyHeader
                  striped
                  tableId="lex-reference-library"
                  searchSlot={searchControls}
                  emptyState={{
                    icon: Library,
                    title: labels.table.emptyTitle,
                    description: labels.table.emptyDescription,
                  }}
                />
                <LibraryHighlights
                  docs={corpus}
                  recent={recent}
                  onClearRecent={clearRecent}
                />
              </div>

              <aside className="space-y-3 lg:order-1">
                <SavedViewsBar
                  namespace="lex-library"
                  activeFilters={activeFilters}
                  onApply={(params) => {
                    for (const key of ['category', 'doc_type', 'tag'] as const) {
                      if (!(key in params)) setFilter(key, undefined);
                    }
                    for (const [key, value] of Object.entries(params)) {
                      setFilter(key, value);
                    }
                  }}
                  labels={{
                    save: labels.savedViews.save,
                    saved: labels.savedViews.saved,
                    empty: labels.savedViews.empty,
                  }}
                />
                <div className="bg-card shadow-elevation-1 rounded-xl border border-[color:var(--card-border)] p-3">
                  <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {labels.facets.title}
                  </p>
                  <LibraryFacetTree
                    facets={facets}
                    loading={facetsQuery.isLoading}
                    totalCount={totalCount}
                    activeCategory={activeCategory}
                    activeDocType={activeDocType}
                    activeTag={activeTag}
                    onSelectCategory={(value) => setFilter('category', value)}
                    onSelectDocType={(value) => setFilter('doc_type', value)}
                    onSelectTag={(value) => setFilter('tag', value)}
                  />
                </div>
              </aside>
            </div>
          )}
        </LexListShell>

        <LibraryPreviewSheet
          documentId={previewDocId}
          open={previewDocId !== null}
          deepLinkPage={previewDeepLink?.page ?? null}
          deepLinkTerm={previewDeepLink?.snippet ?? null}
          onOpenChange={(open) => {
            if (!open) {
              setPreviewDocId(null);
              setPreviewDeepLink(null);
            }
          }}
        />
        <LibraryKpiDrilldownSheet
          selection={kpiDrilldown}
          docs={corpus}
          open={kpiDrilldown !== null}
          onOpenChange={(open) => {
            if (!open) setKpiDrilldown(null);
          }}
          onOpenDocument={(documentId) => {
            setKpiDrilldown(null);
            openDocument(documentId);
          }}
        />
        <AskLibrarySheet
          open={askOpen}
          onOpenChange={setAskOpen}
          onOpenDocument={openDocument}
        />
      </div>
    </LexRouteGuard>
  );
}

function SearchModeButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'h-auto rounded-full px-3 py-1 text-xs font-medium transition-colors',
        active
          ? 'bg-primary text-primary-foreground'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {label}
    </Button>
  );
}
