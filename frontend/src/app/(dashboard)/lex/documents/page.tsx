'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  AlertCircle,
  ChevronDown,
  ClipboardCheck,
  Download,
  Eye,
  File,
  FilePenLine,
  FileSignature,
  Gauge,
  LayoutGrid,
  Library,
  Link2,
  List,
  Lock,
  Loader2,
  MessagesSquare,
  MoreHorizontal,
  Pencil,
  Plus,
  Save,
  ScrollText,
  Scale,
  ShieldCheck,
  Share2,
  Sparkles,
  Tags,
  Trash2,
  Upload,
  UsersRound,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { LexRouteGuard } from '../_guards/lex-route-guard';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { DataTable } from '@/components/shared/data-table/data-table';
import { SavedViewsBar } from '@/components/shared/saved-views-bar';
import { SearchInput } from '@/components/shared/forms/search-input';
import { LexListShell } from '@/components/lex/list-shell';
import { LexKpiStrip, type LexKpiItem } from '@/components/lex/kpi-strip';
import { LexStatusChip } from '@/components/lex/status-chip';
import { useLexFormat } from '@/lib/lex/ksa';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { useDataTable } from '@/hooks/use-data-table';
import { useAuth } from '@/hooks/use-auth';
import { useLocale } from '@/components/providers/locale-provider';
import { API_ENDPOINTS } from '@/lib/constants';
import { enterpriseApi } from '@/lib/enterprise';
import { formatNumber } from '@/lib/format';
import { fetchSuitePaginated } from '@/lib/suite-api';
import { showApiError, showSuccess } from '@/lib/toast';
import type { FetchParams } from '@/types/table';
import type {
  LexDocument,
  LexDocumentBulkImportResult,
  LexDocumentConfidentiality,
  LexDocumentRepositorySummary,
  LexDocumentSearchHit,
} from '@/types/suites';
import { DocumentFormDialog } from './_components/document-form-dialog';
import { LexDocumentPreviewSheet } from './_components/document-preview-sheet';
import { GuidedBulkImportDialog } from './_components/bulk-import-csv-dialog';
import { UploadVersionDialog } from './_components/upload-version-dialog';
import { DocumentSnippet } from './_components/document-snippet';
import { DocumentQuickFilters } from './_components/document-quick-filters';
import { BulkAddTagsDialog, BulkConfidentialityDialog } from './_components/document-bulk-dialogs';
import { DocumentThumb, DocumentConfidentialityChip } from './_components/document-row-treatment';
import { DocumentsBoard } from './_components/documents-board';
import { RepositoryFolderTree, FolderBreadcrumb } from './_components/repository-folder-tree';
import { DocumentDropzone } from './_components/document-dropzone';
import { DocumentEmptyState, type DocumentEmptyStateVariant } from './_components/document-empty-state';
import {
  DocumentsBoardShell,
  DocumentsErrorState,
  FolderTreeSkeleton,
} from './_components/documents-view-states';
import {
  buildDocumentUpdatePayload,
  buildDocumentEditorHref,
  DOCUMENT_EDITOR_MATURITY_PANELS,
  type DocumentEditorMaturityPanel,
  documentHasRetentionPolicy,
  exportDocuments,
  getDocumentEditorAvailability,
  mergeTags,
  parseTagInput,
  summarizeSettled,
} from './_lib/documents-helpers';
import { type DocumentsLabels, useDocumentsLabels } from './_lib/documents-labels';
import { useLexLabels } from '../_lib/lex-i18n';

function buildDocumentFilters(
  labels: DocumentsLabels,
  categoryOptions: string[],
  locale: string,
) {
  const typeKeys = [
    'policy', 'regulation', 'template', 'memo', 'opinion', 'filing',
    'correspondence', 'resolution', 'power_of_attorney', 'other',
  ] as const;
  const statusKeys = ['draft', 'active', 'archived', 'superseded'] as const;
  const confidentialityKeys = ['public', 'internal', 'confidential', 'privileged'] as const;
  return [
    {
      key: 'type',
      label: labels.filters.type,
      type: 'select' as const,
      options: typeKeys.map((value) => ({ label: labels.filters.typeOptions[value], value })),
    },
    {
      key: 'status',
      label: labels.filters.status,
      type: 'select' as const,
      options: statusKeys.map((value) => ({ label: labels.filters.statusOptions[value], value })),
    },
    {
      key: 'confidentiality',
      label: labels.filtersExtra.confidentiality,
      type: 'select' as const,
      options: confidentialityKeys.map((value) => ({
        label: labels.enums.confidentiality[value] ??
          (locale === 'ar' ? 'سرية غير معروفة' : value),
        value,
      })),
    },
    {
      key: 'category',
      label: labels.filtersExtra.category,
      type: 'select' as const,
      options: categoryOptions.map((value) => ({ label: value, value })),
    },
  ];
}

const BULK_IMPORT_EXAMPLE = JSON.stringify([
  {
    title: 'Legacy Board Policy',
    type: 'policy',
    description: 'Migrated policy with OCR text.',
    category: 'Governance',
    confidentiality: 'privileged',
    tags: ['board', 'ksa'],
    metadata: {
      source_record_id: 'LEG-001',
      folder_path: 'Legacy/Governance',
      jurisdiction: 'KSA',
      retention_policy: 'board-records-10y',
    },
    document: {
      file_id: '00000000-0000-0000-0000-000000000000',
      file_name: 'legacy-board-policy.pdf',
      file_size_bytes: 2048,
      content_hash: 'sha256:legacy-board',
      extracted_text: 'Legacy OCR text for repository indexing.',
      change_summary: 'Initial legacy import.',
    },
  },
], null, 2);

type BulkImportDocumentPayload = Record<string, unknown>;

/** URL-param filter keys a saved view may carry; applied verbatim via setFilter. */
const SAVED_VIEW_FILTER_KEYS = ['type', 'status', 'confidentiality', 'category', 'folder_path'] as const;

/** Filter keys the KPI "All documents" tile clears (the document-scoping axes). */
const KPI_SCOPE_FILTER_KEYS = [
  'type',
  'status',
  'confidentiality',
  'category',
  'folder_path',
  'disposition_due',
  'missing_retention_policy',
] as const;

/** Every managed filter key the "Clear filters" empty-state CTA resets. */
const ALL_MANAGED_FILTER_KEYS = KPI_SCOPE_FILTER_KEYS;

/**
 * saveBlob downloads an in-memory Blob via a transient object-URL anchor. SSR
 * guarded so the page module imports cleanly on the server.
 */
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

const maturityPanelIcons: Record<DocumentEditorMaturityPanel, typeof MessagesSquare> = {
  'negotiation-room': MessagesSquare,
  'playbook-enforcement': ShieldCheck,
  'terms-cross-references': Link2,
  'section-assignments': UsersRound,
  'guest-review-links': Share2,
  'legal-issues': Scale,
  'signature-readiness': FileSignature,
  'clause-ai-actions': Sparkles,
  'health-score': Gauge,
  'privileged-controls': Lock,
};

export default function LexDocumentsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { hasAnyPermission } = useAuth();
  const { locale, direction } = useLocale();
  const f = useLexFormat();
  const labels = useDocumentsLabels();
  const { commonActions } = useLexLabels();
  // §9/§18.4 — document authoring/upload maps to the document add/edit verbs.
  const canWrite = hasAnyPermission(['lex:document:add', 'lex:document:edit']);

  const [createOpen, setCreateOpen] = useState(false);
  const [bulkImportOpen, setBulkImportOpen] = useState(false);
  const [guidedImportOpen, setGuidedImportOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<LexDocument | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<LexDocument | null>(null);
  const [uploadTarget, setUploadTarget] = useState<LexDocument | null>(null);
  const [previewTarget, setPreviewTarget] = useState<LexDocument | null>(null);
  const [privilegeGuardTarget, setPrivilegeGuardTarget] = useState<LexDocument | null>(null);
  const handledDocumentDeepLink = useRef('');
  // P0 #6: privileged downloads route through their own confirm gate.
  const [downloadGuardTarget, setDownloadGuardTarget] = useState<LexDocument | null>(null);
  // P0 #2: files dropped onto the repository surface, surfaced to the user when
  // the create dialog opens (the dialog cannot yet be pre-seeded — see openIssues).
  const [droppedFiles, setDroppedFiles] = useState<File[]>([]);

  // Feature #1: full-text content search toggle. When ON with a non-empty query
  // the table data source switches to the FTS endpoint.
  const [contentMode, setContentMode] = useState(false);

  // M18: list (table) vs board (status kanban) view. The board groups the
  // already-fetched rows by status (confidentiality fallback) and reuses the
  // shared BoardView, mirroring the cases/settlements/contracts boards.
  const [view, setView] = useState<'table' | 'board'>('table');

  // Feature #3: row selection + bulk actions.
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkConfidentialityOpen, setBulkConfidentialityOpen] = useState(false);
  const [bulkAddTagsOpen, setBulkAddTagsOpen] = useState(false);
  const [bulkPending, setBulkPending] = useState(false);

  const repositorySummaryQuery = useQuery({
    queryKey: ['lex-document-repository-summary'],
    queryFn: () => enterpriseApi.lex.getDocumentRepositorySummary(),
  });
  const summary = repositorySummaryQuery.data;
  const requestedDocumentId = searchParams?.get('document')?.trim() ?? '';
  const requestedDocumentQuery = useQuery({
    queryKey: ['lex-document-deep-link', requestedDocumentId],
    queryFn: () => enterpriseApi.lex.getDocument(requestedDocumentId),
    enabled: Boolean(requestedDocumentId),
    retry: false,
  });
  const categoryOptions = useMemo(
    () => Object.keys(summary?.by_category ?? {}),
    [summary],
  );

  // Feature #1: the data-source switch. The queryKey carries the mode so that
  // toggling Metadata <-> Contents forces a refetch (and resets pagination via
  // the differing cache key). The fetchFn branches inside on the same mode/query.
  const { tableProps, searchValue, setSearch, setFilter, activeFilters } = useDataTable<LexDocument>({
    queryKey: contentMode ? 'lex-documents-fts' : 'lex-documents',
    fetchFn: (params) => fetchDocuments(params, contentMode),
    defaultPageSize: 25,
    defaultSort: { column: 'updated_at', direction: 'desc' },
  });

  const loadedDocuments = tableProps.data;
  const contentModeEmpty = contentMode && !searchValue.trim();

  const deleteMutation = useMutation({
    mutationFn: (id: string) => enterpriseApi.lex.deleteDocument(id),
    onSuccess: async () => {
      showSuccess(labels.toasts.deletedTitle, labels.toasts.deletedDescription);
      await invalidateDocuments(queryClient);
      setDeleteTarget(null);
    },
    onError: showApiError,
  });

  const checkOutMutation = useMutation({
    mutationFn: (doc: LexDocument) =>
      enterpriseApi.lex.checkOutDocument(doc.id, {
        current_version: doc.current_version,
        source: 'lex-documents',
      }),
    onSuccess: async (_lock, doc) => {
      showSuccess(labels.toasts.checkedOutTitle, labels.toasts.checkedOutDescription(doc.title));
      await invalidateDocumentEditorData(queryClient, doc.id);
    },
    onError: showApiError,
  });

  const preflightMutation = useMutation({
    mutationFn: (doc: LexDocument) =>
      enterpriseApi.lex.runDocumentPreflight(doc.id, {
        current_version: doc.current_version,
        source: 'lex-documents',
      }),
    onSuccess: (result, doc) => {
      const issueCount = result.issues?.length ?? 0;
      if (result.ready === false || result.status === 'blocked' || issueCount > 0) {
        showSuccess(
          labels.toasts.preflightReviewTitle,
          labels.toasts.preflightReviewDescription(formatNumber(issueCount)),
        );
        return;
      }
      showSuccess(labels.toasts.preflightPassedTitle, labels.toasts.preflightPassedDescription(doc.title));
    },
    onError: showApiError,
  });

  const snapshotMutation = useMutation({
    mutationFn: (doc: LexDocument) =>
      enterpriseApi.lex.createDocumentVersionSnapshot(doc.id, {
        current_version: doc.current_version,
        source: 'lex-documents',
        change_summary: labels.editor.snapshotSummary(doc.title),
      }),
    onSuccess: async (_snapshot, doc) => {
      showSuccess(labels.toasts.snapshotCreatedTitle, labels.toasts.snapshotCreatedDescription(doc.title));
      await invalidateDocumentEditorData(queryClient, doc.id);
    },
    onError: showApiError,
  });

  /**
   * Feature #8 guardrail: privileged documents route through a confirm gate
   * before the preview sheet opens; everything else opens directly.
   */
  const openPreview = useCallback((doc: LexDocument) => {
    if (doc.confidentiality === 'privileged') {
      setPrivilegeGuardTarget(doc);
      return;
    }
    setPreviewTarget(doc);
  }, []);

  useEffect(() => {
    const document = requestedDocumentQuery.data;
    if (!document || handledDocumentDeepLink.current === document.id) return;
    handledDocumentDeepLink.current = document.id;
    openPreview(document);
  }, [openPreview, requestedDocumentQuery.data]);

  // P0 #1: the folder filter is just the `folder_path` URL-param. Reading + writing
  // it through the shared `setFilter` keeps it in sync with saved views and the
  // list query (which honours `folder_path`), so the tree, breadcrumb and table
  // never drift apart.
  const activeFolderPath = firstFilter(activeFilters.folder_path);

  /** Clears every list-scoping filter the KPI "All documents" tile resets. */
  function clearScopeFilters() {
    for (const key of KPI_SCOPE_FILTER_KEYS) {
      setFilter(key, undefined);
    }
  }

  /**
   * Clears all managed filters, the folder, the retention quick-filters, the
   * search query and resets content-mode back to metadata — the canonical
   * "Clear filters" action surfaced by the no-results empty state.
   */
  function clearAllFilters() {
    for (const key of ALL_MANAGED_FILTER_KEYS) {
      setFilter(key, undefined);
    }
    setSearch('');
    setContentMode(false);
  }

  // P0 #6: download a single document's current-version file via the files API.
  // Reuses the same presigned-less blob path the preview sheet falls back to,
  // honouring the privileged-gate (privileged downloads route through confirm).
  async function downloadDocument(doc: LexDocument) {
    const fileId = doc.file_id;
    if (!fileId) return;
    try {
      const blob = await enterpriseApi.files.download(fileId);
      const filename = doc.file_name ?? `${doc.title}.bin`;
      saveBlob(blob, filename);
    } catch (error) {
      showApiError(error);
    }
  }

  function requestDownload(doc: LexDocument) {
    if (doc.confidentiality === 'privileged') {
      setDownloadGuardTarget(doc);
      return;
    }
    void downloadDocument(doc);
  }

  /**
   * P0 #6: bulk download. There is no server-side zip endpoint, so we download
   * the selected documents' files sequentially (throttled slightly so browsers
   * don't drop concurrent anchor clicks). Documents without a file are skipped.
   */
  async function runBulkDownload() {
    const targets = loadedDocuments.filter(
      (doc) => selectedIds.includes(doc.id) && doc.file_id,
    );
    if (targets.length === 0) return;
    setBulkPending(true);
    showSuccess(labels.bulkDownload.label, labels.bulkDownload.preparing);
    try {
      for (const doc of targets) {
        // Sequential (not Promise.all) so browsers don't drop concurrent
        // download anchor clicks.
        await downloadDocument(doc);
      }
      showSuccess(labels.bulkDownload.label, labels.bulkDownload.done);
    } finally {
      setBulkPending(false);
    }
  }

  /**
   * P0 #2: a drop on the repository surface opens the create dialog. The create
   * dialog does not yet accept a pre-seeded File (see openIssues), so we surface
   * the dropped file via a one-shot banner and open the create dialog so the user
   * attaches it in the dialog's file field. Single-file drops target Create;
   * gated on `canWrite` by the dropzone `disabled` prop.
   */
  function handleDroppedFiles(files: File[]) {
    setDroppedFiles(files);
    // The create dialog cannot yet be pre-seeded with a File (see openIssues),
    // so we name the dropped file(s) and open Create for the user to attach.
    const names = files.map((file) => file.name).join(', ');
    showSuccess(labels.actions.createDocument, labels.form.selectedPrefix(names));
    setCreateOpen(true);
  }

  // Any dialog that owns an upload/create flow — used to disable the dropzone so
  // a drop never lands behind an open modal.
  const anyUploadDialogOpen =
    createOpen ||
    bulkImportOpen ||
    guidedImportOpen ||
    editTarget !== null ||
    uploadTarget !== null;

  function handleOpenEditor(doc: LexDocument) {
    const availability = getDocumentEditorAvailability(doc);
    if (!availability.canOpen) {
      return;
    }
    void enterpriseApi.lex.openDocumentEditor(doc.id, {
      current_version: doc.current_version,
      source: 'lex-documents',
    }).catch(() => undefined);
    router.push(buildDocumentEditorHref(doc));
  }

  function handleOpenAudit(doc: LexDocument) {
    void enterpriseApi.lex.listDocumentAudit(doc.id).catch(() => undefined);
    router.push(buildDocumentEditorHref(doc, { panel: 'audit' }));
  }

  function handleOpenEditorPanel(doc: LexDocument, panel: DocumentEditorMaturityPanel) {
    const availability = getDocumentEditorAvailability(doc);
    if (!availability.canOpen) {
      return;
    }
    router.push(buildDocumentEditorHref(doc, { panel }));
  }

  /**
   * Feature #3: fan out a per-id update over the current selection with
   * `Promise.allSettled`, then summarise + invalidate. There is no bulk backend
   * endpoint, so each call reuses the full edit payload to avoid wiping fields.
   */
  async function runBulkUpdate(buildPayload: (doc: LexDocument) => Record<string, unknown>) {
    const targets = loadedDocuments.filter((doc) => selectedIds.includes(doc.id));
    if (targets.length === 0) return;
    setBulkPending(true);
    try {
      const results = await Promise.allSettled(
        targets.map((doc) => enterpriseApi.lex.updateDocument(doc.id, buildPayload(doc))),
      );
      const { updated, failed } = summarizeSettled(results);
      showSuccess(
        labels.bulkActions.summaryTitle,
        labels.bulkActions.summaryDescription(formatNumber(updated), formatNumber(failed)),
      );
      await invalidateDocuments(queryClient);
    } finally {
      setBulkPending(false);
    }
  }

  async function runBulkDelete() {
    const targets = loadedDocuments.filter((doc) => selectedIds.includes(doc.id));
    if (targets.length === 0) return;
    setBulkPending(true);
    try {
      const results = await Promise.allSettled(
        targets.map((doc) => enterpriseApi.lex.deleteDocument(doc.id)),
      );
      const { updated, failed } = summarizeSettled(results);
      showSuccess(
        labels.bulkActions.summaryTitle,
        labels.bulkActions.summaryDescription(formatNumber(updated), formatNumber(failed)),
      );
      await invalidateDocuments(queryClient);
    } finally {
      setBulkPending(false);
      setBulkDeleteOpen(false);
    }
  }

  // Feature #3: bulk-action bar entries. Write actions are gated on `canWrite`.
  const bulkActions = canWrite
    ? [
        {
          label: labels.bulkActions.archive,
          icon: Archive,
          onClick: async () => {
            await runBulkUpdate((doc) => buildDocumentUpdatePayload(doc, { status: 'archived' }));
          },
        },
        {
          label: labels.bulkActions.changeConfidentiality,
          icon: ShieldCheck,
          onClick: async () => {
            setBulkConfidentialityOpen(true);
          },
        },
        {
          label: labels.bulkActions.addTags,
          icon: Tags,
          onClick: async () => {
            setBulkAddTagsOpen(true);
          },
        },
        {
          label: labels.bulkActions.exportSelected,
          icon: Upload,
          onClick: async () => {
            exportDocuments(
              loadedDocuments.filter((doc) => selectedIds.includes(doc.id)),
              'csv',
            );
          },
        },
        {
          label: labels.bulkDownload.label,
          icon: Download,
          onClick: runBulkDownload,
        },
        {
          label: labels.bulkActions.delete,
          icon: Trash2,
          variant: 'destructive' as const,
          onClick: async () => {
            setBulkDeleteOpen(true);
          },
        },
      ]
    : [
        {
          label: labels.bulkActions.exportSelected,
          icon: Upload,
          onClick: async () => {
            exportDocuments(
              loadedDocuments.filter((doc) => selectedIds.includes(doc.id)),
              'csv',
            );
          },
        },
        {
          label: labels.bulkDownload.label,
          icon: Download,
          onClick: runBulkDownload,
        },
      ];

  const columns: ColumnDef<LexDocument>[] = [
    {
      id: 'title',
      accessorKey: 'title',
      header: labels.columns.document,
      enableSorting: true,
      cell: ({ row }) => {
        const doc = row.original;
        const hit = doc as Partial<LexDocumentSearchHit>;
        return (
          <div className="group flex min-w-0 items-start gap-3">
            <DocumentThumb confidentiality={doc.confidentiality} className="mt-0.5" />
            <div className="min-w-0">
              <p dir="auto" className="truncate font-medium text-foreground">{doc.title}</p>
              <p className="text-xs text-muted-foreground">
                {resolveEnum(labels.enums.types, doc.type, locale, labels.bulkImport.typeUnknown)}
              </p>
              {!documentHasRetentionPolicy(doc) ? (
                <Badge variant="secondary" className="mt-1 normal-case tracking-normal text-overline">
                  {labels.retention.noPolicyBadge}
                </Badge>
              ) : null}
              {contentMode && hit.snippet ? (
                <DocumentSnippet
                  snippet={hit.snippet}
                  rank={hit.rank ?? 0}
                  relevanceLabel={labels.search.relevanceLabel}
                />
              ) : null}
            </div>
          </div>
        );
      },
    },
    {
      id: 'status',
      accessorKey: 'status',
      header: labels.columns.status,
      enableSorting: true,
      cell: ({ row }) => (
        <LexStatusChip
          value={row.original.status}
          domain="generic"
          labels={labels.enums.statuses}
          size="sm"
        />
      ),
    },
    {
      id: 'confidentiality',
      header: labels.columns.confidentiality,
      cell: ({ row }) => (
        <DocumentConfidentialityChip
          confidentiality={row.original.confidentiality}
          label={
            labels.enums.confidentiality[row.original.confidentiality] ??
            (locale === 'ar' ? 'سرية غير معروفة' : row.original.confidentiality)
          }
        />
      ),
    },
    {
      id: 'current_version',
      accessorKey: 'current_version',
      header: labels.columns.version,
      enableSorting: true,
      cell: ({ row }) => (
        <div className="leading-tight">
          <span className="text-sm font-medium tabular-nums">
            {labels.cells.versionPrefix(f.formatNumber(row.original.current_version))}
          </span>
          <span className="block text-xs text-muted-foreground">
            {labels.preview.versionsCount(f.formatNumber(row.original.current_version))}
          </span>
        </div>
      ),
    },
    {
      id: 'tags',
      header: labels.columns.tags,
      cell: ({ row }) => (
        <span dir="auto" className="text-sm text-muted-foreground">
          {row.original.tags.length > 0 ? row.original.tags.join(', ') : labels.cells.noTags}
        </span>
      ),
    },
    {
      id: 'updated_at',
      accessorKey: 'updated_at',
      header: labels.columns.updated,
      enableSorting: true,
      cell: ({ row }) => (
        <time
          dateTime={row.original.updated_at}
          title={f.formatDual(row.original.updated_at)}
          className="text-sm tabular-nums text-muted-foreground"
        >
          {f.formatRelative(row.original.updated_at)}
        </time>
      ),
    },
    {
      id: 'actions',
      header: '',
      enableHiding: false,
      cell: ({ row }: { row: { original: LexDocument } }) => (
        <DocumentRowActions
          document={row.original}
          canWrite={canWrite}
          labels={labels}
          onPreview={openPreview}
          onDownload={requestDownload}
          onOpenEditor={handleOpenEditor}
          onOpenAudit={handleOpenAudit}
          onOpenEditorPanel={handleOpenEditorPanel}
          onCheckOut={(doc) => checkOutMutation.mutate(doc)}
          onRunPreflight={(doc) => preflightMutation.mutate(doc)}
          onCreateSnapshot={(doc) => snapshotMutation.mutate(doc)}
          onEdit={setEditTarget}
          onUploadVersion={setUploadTarget}
          onArchive={archiveDocument}
          onDelete={setDeleteTarget}
        />
      ),
    } satisfies ColumnDef<LexDocument>,
  ];

  // P0 #4: per-row quick actions surfaced through the DataTable's own kebab.
  // Preview/Download honour the privileged-gate; write actions are gated on
  // `canWrite` via `hidden`. The richer editor workspace submenu stays in the
  // dedicated 'actions' column kebab (DocumentRowActions).
  // P0 #4 row quick-actions are surfaced through the single DocumentRowActions
  // kebab (the rich editor-aware menu) to avoid a duplicate actions column.
  // Archive is the one stateful quick-action; download/preview/edit/version/delete
  // are already wired into that menu.
  const archiveDocument = (doc: LexDocument) => {
    void enterpriseApi.lex
      .updateDocument(doc.id, buildDocumentUpdatePayload(doc, { status: 'archived' }))
      .then(() => {
        showSuccess(labels.bulkActions.summaryTitle, labels.bulkActions.summaryDescription('1', '0'));
        return invalidateDocuments(queryClient);
      })
      .catch(showApiError);
  };

  // Feature #3 (KPI strip): a premium, KSA-localized header computed entirely from
  // the already-fetched repository summary — no extra endpoint. Confidentiality is
  // the document risk axis, so privileged / confidential lead.
  const kpiEntries = useMemo<DocumentKpiEntry[]>(
    () => buildDocumentKpis(summary, labels),
    [summary, labels],
  );

  const headerActions = (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" asChild>
        <Link href="/lex/library">
          <Library className="me-1.5 h-4 w-4" aria-hidden />
          {commonActions.browseLibrary}
        </Link>
      </Button>
      {canWrite ? (
        <>
          <div className="flex items-center">
            <Button
              variant="outline"
              className="rounded-e-none"
              onClick={() => setGuidedImportOpen(true)}
            >
              <Upload className="me-1.5 h-4 w-4" />
              {labels.actions.bulkImport}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="rounded-s-none border-s-0 px-2">
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setGuidedImportOpen(true)}>
                  <Upload className="me-2 h-4 w-4" />
                  {labels.actions.bulkImportGuided}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setBulkImportOpen(true)}>
                  <File className="me-2 h-4 w-4" />
                  {labels.actions.bulkImportAdvanced}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <Button
            onClick={() => setCreateOpen(true)}
            className="motion-safe:duration-fast motion-safe:ease-emphasized"
          >
            <Plus className="me-1.5 h-4 w-4" />
            {labels.actions.createDocument}
          </Button>
        </>
      ) : null}
    </div>
  );

  return (
    <LexRouteGuard route="/lex/documents">
      <div dir={direction} lang={locale}>
        <LexListShell
          title={labels.pageTitle}
          description={labels.pageDescription}
          eyebrow={labels.eyebrow}
          actions={headerActions}
          dir={direction === 'rtl' ? 'rtl' : 'ltr'}
          kpi={
            <ClickableKpiStrip
              entries={kpiEntries}
              activeFilters={activeFilters}
              onApplyFilter={(key, value) => setFilter(key, value || undefined)}
              onClearScope={clearScopeFilters}
              dir={direction === 'rtl' ? 'rtl' : 'ltr'}
            />
          }
          framedBody={false}
          filters={
            <div className="space-y-3">
              <SavedViewsBar
                namespace="lex-documents"
                activeFilters={activeFilters}
                onApply={(params) => {
                  // Clear the managed filter keys that the saved view does not
                  // declare, then apply every key the view carries — so a saved
                  // view round-trips faithfully and never leaves a stale filter.
                  for (const key of SAVED_VIEW_FILTER_KEYS) {
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
                  {labels.summary.folders}
                </p>
                {repositorySummaryQuery.isLoading ? (
                  <FolderTreeSkeleton />
                ) : repositorySummaryQuery.isError ? (
                  <DocumentsErrorState
                    message={
                      repositorySummaryQuery.error instanceof Error
                        ? repositorySummaryQuery.error.message
                        : null
                    }
                    onRetry={() => void repositorySummaryQuery.refetch()}
                    className="py-6"
                  />
                ) : (summary?.folders?.length ?? 0) > 0 ? (
                  <RepositoryFolderTree
                    folders={summary?.folders ?? []}
                    activeFolderPath={activeFolderPath}
                    onSelect={(path) => setFilter('folder_path', path)}
                  />
                ) : (
                  <DocumentEmptyState variant="no-folders" canWrite={canWrite} className="py-8" />
                )}
              </div>
              <DocumentQuickFilters
                summary={summary}
                labels={labels}
                activeFilters={activeFilters}
                setFilter={setFilter}
              />
            </div>
          }
        >
        {(() => {
          // The empty-state variant: any active filter/search/folder means the
          // user filtered everything out ('no-results'); otherwise the scope is
          // genuinely empty ('no-documents').
          const hasActiveScope =
            Boolean(searchValue.trim()) ||
            ALL_MANAGED_FILTER_KEYS.some((key) => firstFilter(activeFilters[key]));
          const emptyVariant: DocumentEmptyStateVariant = hasActiveScope
            ? 'no-results'
            : 'no-documents';

          // M18: the search + search-mode + list/board view toggle controls.
          // Shared between the table view (DataTable searchSlot) and the board
          // view (standalone toolbar) so search/filters stay intact in both.
          const searchControls = (
            <div className="flex w-full flex-wrap items-center gap-2">
              <div className="min-w-[200px] flex-1">
                <SearchInput
                  value={searchValue}
                  onChange={setSearch}
                  placeholder={labels.table.searchPlaceholder}
                  loading={tableProps.isLoading}
                />
              </div>
              <div className="inline-flex items-center gap-1 rounded-full border p-0.5">
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
              <div
                className="inline-flex items-center gap-0.5 rounded-lg border bg-muted/60 p-0.5"
                role="group"
                aria-label={labels.view.label}
              >
                <ViewToggle
                  active={view === 'table'}
                  onClick={() => setView('table')}
                  icon={List}
                  label={labels.view.table}
                />
                <ViewToggle
                  active={view === 'board'}
                  onClick={() => setView('board')}
                  icon={LayoutGrid}
                  label={labels.view.board}
                />
              </div>
            </div>
          );

          // P0 #1: breadcrumb above the body whenever a folder is active.
          const breadcrumb = activeFolderPath ? (
            <FolderBreadcrumb
              path={activeFolderPath}
              onNavigate={(path) => setFilter('folder_path', path)}
              className="px-1"
            />
          ) : null;

          const body =
            view === 'board' ? (
              <div className="space-y-3">
                {searchControls}
                {breadcrumb}
                <DocumentsBoardShell
                  loading={
                    Boolean(tableProps.isLoading) &&
                    loadedDocuments.length === 0 &&
                    !contentModeEmpty
                  }
                  error={contentModeEmpty ? null : tableProps.error}
                  onRetry={() => void invalidateDocuments(queryClient)}
                >
                  {contentModeEmpty ? (
                    <div className="rounded-xl border border-dashed border-border bg-card/40 px-4 py-12 text-center">
                      <p className="text-sm font-medium text-foreground">
                        {labels.search.contentsHint}
                      </p>
                    </div>
                  ) : loadedDocuments.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-border bg-card/40">
                      <DocumentEmptyState
                        variant={emptyVariant}
                        canWrite={canWrite}
                        onCreate={() => setCreateOpen(true)}
                        onImport={() => setGuidedImportOpen(true)}
                        onClearFilters={clearAllFilters}
                      />
                    </div>
                  ) : (
                    <DocumentsBoard
                      documents={loadedDocuments}
                      labels={labels}
                      dir={direction === 'rtl' ? 'rtl' : 'ltr'}
                      onSelect={openPreview}
                    />
                  )}
                </DocumentsBoardShell>
              </div>
            ) : (
              <div className="space-y-3">
                {breadcrumb}
                <DataTable
                  {...tableProps}
                  columns={columns}
                  filters={buildDocumentFilters(labels, categoryOptions, locale)}
                  enableSelection
                  onSelectionChange={setSelectedIds}
                  getRowId={(row) => row.id}
                  bulkActions={bulkActions}
                  onRowClick={openPreview}
                  enableColumnToggle
                  enableDensityToggle
                  stickyHeader
                  striped
                  tableId="lex-documents"
                  enableExport
                  onExport={(format) => exportDocuments(loadedDocuments, format)}
                  searchSlot={searchControls}
                  emptyState={{
                    icon: File,
                    title: contentModeEmpty ? labels.search.contentsHint : labels.table.emptyTitle,
                    description: contentModeEmpty
                      ? labels.search.contentsHint
                      : labels.table.emptyDescription,
                    action:
                      canWrite && !contentModeEmpty && !hasActiveScope
                        ? {
                            label: labels.emptyCta,
                            icon: Plus,
                            onClick: () => setCreateOpen(true),
                          }
                        : undefined,
                  }}
                />
              </div>
            );

          // P0 #2: drag-drop upload wraps the whole repository body. Disabled
          // while no write permission OR a create/upload/import dialog is open
          // so a drop never fights an open modal. Keyboard users still have the
          // explicit Create / Bulk import buttons in the header.
          return (
            <DocumentDropzone
              disabled={!canWrite || anyUploadDialogOpen}
              onFiles={handleDroppedFiles}
            >
              {body}
            </DocumentDropzone>
          );
        })()}
        </LexListShell>
        <DocumentFormDialog
          open={createOpen}
          initialFile={droppedFiles[0] ?? null}
          onOpenChange={(open) => {
            setCreateOpen(open);
            if (!open) setDroppedFiles([]);
          }}
        />
        <GuidedBulkImportDialog open={guidedImportOpen} onOpenChange={setGuidedImportOpen} />
        <BulkImportDocumentsDialog
          open={bulkImportOpen}
          onOpenChange={setBulkImportOpen}
          labels={labels}
        />
        {editTarget ? (
          <DocumentFormDialog
            open
            document={editTarget}
            onOpenChange={(open) => { if (!open) setEditTarget(null); }}
          />
        ) : null}
        <ConfirmDialog
          open={deleteTarget !== null}
          onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
          title={labels.deleteDialog.title}
          description={labels.deleteDialog.description(deleteTarget?.title ?? '')}
          confirmLabel={labels.deleteDialog.confirm}
          variant="destructive"
          loading={deleteMutation.isPending}
          onConfirm={() => {
            if (deleteTarget) deleteMutation.mutate(deleteTarget.id);
          }}
        />
        <ConfirmDialog
          open={bulkDeleteOpen}
          onOpenChange={setBulkDeleteOpen}
          title={labels.bulkActions.deleteConfirmTitle}
          description={labels.bulkActions.deleteConfirmDescription(formatNumber(selectedIds.length))}
          confirmLabel={labels.bulkActions.deleteConfirm}
          variant="destructive"
          loading={bulkPending}
          onConfirm={runBulkDelete}
        />
        <BulkConfidentialityDialog
          open={bulkConfidentialityOpen}
          onOpenChange={setBulkConfidentialityOpen}
          pending={bulkPending}
          labels={labels}
          onApply={async (value: LexDocumentConfidentiality) => {
            await runBulkUpdate((doc) => buildDocumentUpdatePayload(doc, { confidentiality: value }));
            setBulkConfidentialityOpen(false);
          }}
        />
        <BulkAddTagsDialog
          open={bulkAddTagsOpen}
          onOpenChange={setBulkAddTagsOpen}
          pending={bulkPending}
          labels={labels}
          onApply={async (rawTags: string) => {
            const incoming = parseTagInput(rawTags);
            await runBulkUpdate((doc) =>
              buildDocumentUpdatePayload(doc, { tags: mergeTags(doc.tags, incoming) }),
            );
            setBulkAddTagsOpen(false);
          }}
        />
        <UploadVersionDialog
          document={uploadTarget}
          open={uploadTarget !== null}
          onOpenChange={(open) => { if (!open) setUploadTarget(null); }}
        />
        <ConfirmDialog
          open={privilegeGuardTarget !== null}
          onOpenChange={(open) => { if (!open) setPrivilegeGuardTarget(null); }}
          title={labels.privilegeGuard.title}
          description={labels.privilegeGuard.description}
          confirmLabel={labels.privilegeGuard.confirm}
          cancelLabel={labels.privilegeGuard.cancel}
          variant="destructive"
          onConfirm={() => {
            if (privilegeGuardTarget) {
              setPreviewTarget(privilegeGuardTarget);
              setPrivilegeGuardTarget(null);
            }
          }}
        />
        <ConfirmDialog
          open={downloadGuardTarget !== null}
          onOpenChange={(open) => { if (!open) setDownloadGuardTarget(null); }}
          title={labels.privilegeGuard.title}
          description={labels.privilegeGuard.description}
          confirmLabel={labels.privilegeGuard.confirm}
          cancelLabel={labels.privilegeGuard.cancel}
          variant="destructive"
          onConfirm={() => {
            if (downloadGuardTarget) {
              void downloadDocument(downloadGuardTarget);
              setDownloadGuardTarget(null);
            }
          }}
        />
        <LexDocumentPreviewSheet
          document={previewTarget}
          open={previewTarget !== null}
          canWrite={canWrite}
          onOpenChange={(open) => { if (!open) setPreviewTarget(null); }}
        />
      </div>
    </LexRouteGuard>
  );
}

/**
 * Feature #1 data-source switch: in content-mode with a non-empty query, hit the
 * full-text search endpoint (snippets + rank); otherwise the standard paginated
 * list endpoint (which honours all URL-param filters). The returned hits widen
 * `LexDocument` with `rank`/`snippet`, so they render through the same columns.
 */
function fetchDocuments(params: FetchParams, contentMode: boolean) {
  const query = params.search?.trim() ?? '';
  if (contentMode && query) {
    const filters = params.filters ?? {};
    return enterpriseApi.lex.searchDocuments(
      {
        query,
        type: firstFilter(filters.type),
        status: firstFilter(filters.status),
        confidentiality: firstFilter(filters.confidentiality),
        category: firstFilter(filters.category),
      },
      params.page,
      params.per_page,
    );
  }
  return fetchSuitePaginated<LexDocument>(API_ENDPOINTS.LEX_DOCUMENTS, params);
}

function firstFilter(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value || undefined;
}

async function invalidateDocuments(queryClient: ReturnType<typeof useQueryClient>) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['lex-documents'] }),
    queryClient.invalidateQueries({ queryKey: ['lex-documents-fts'] }),
    queryClient.invalidateQueries({ queryKey: ['lex-document-repository-summary'] }),
    queryClient.invalidateQueries({ queryKey: ['lex-overview'] }),
  ]);
}

async function invalidateDocumentEditorData(
  queryClient: ReturnType<typeof useQueryClient>,
  documentId: string,
) {
  await Promise.all([
    invalidateDocuments(queryClient),
    queryClient.invalidateQueries({ queryKey: ['lex-document', documentId] }),
    queryClient.invalidateQueries({ queryKey: ['lex-document-versions', documentId] }),
    queryClient.invalidateQueries({ queryKey: ['lex-document-editor', documentId] }),
    queryClient.invalidateQueries({ queryKey: ['lex-document-audit', documentId] }),
    queryClient.invalidateQueries({ queryKey: ['lex-document-health-score', documentId] }),
    queryClient.invalidateQueries({ queryKey: ['lex-document-signature-readiness', documentId] }),
    queryClient.invalidateQueries({ queryKey: ['lex-document-legal-issues', documentId] }),
    queryClient.invalidateQueries({ queryKey: ['lex-document-privileged-controls', documentId] }),
  ]);
}

function DocumentRowActions({
  document,
  canWrite,
  labels,
  onPreview,
  onDownload,
  onOpenEditor,
  onOpenAudit,
  onOpenEditorPanel,
  onCheckOut,
  onRunPreflight,
  onCreateSnapshot,
  onEdit,
  onUploadVersion,
  onArchive,
  onDelete,
}: {
  document: LexDocument;
  canWrite: boolean;
  labels: DocumentsLabels;
  onPreview: (doc: LexDocument) => void;
  onDownload: (doc: LexDocument) => void;
  onOpenEditor: (doc: LexDocument) => void;
  onOpenAudit: (doc: LexDocument) => void;
  onOpenEditorPanel: (doc: LexDocument, panel: DocumentEditorMaturityPanel) => void;
  onCheckOut: (doc: LexDocument) => void;
  onRunPreflight: (doc: LexDocument) => void;
  onCreateSnapshot: (doc: LexDocument) => void;
  onEdit: (doc: LexDocument) => void;
  onUploadVersion: (doc: LexDocument) => void;
  onArchive: (doc: LexDocument) => void;
  onDelete: (doc: LexDocument) => void;
}) {
  const availability = getDocumentEditorAvailability(document);
  const unavailableTitle =
    availability.reason === 'missing_file'
      ? labels.editor.unavailableMissingFile
      : labels.editor.unavailableUnsupportedFormat;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={(event) => event.stopPropagation()}
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}>
        <DropdownMenuItem onClick={() => onPreview(document)}>
          <Eye className="me-2 h-4 w-4" />
          {labels.actions.preview}
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!document.file_id}
          onClick={() => onDownload(document)}
        >
          <Download className="me-2 h-4 w-4" />
          {labels.rowActions.download}
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!availability.canOpen}
          title={!availability.canOpen ? unavailableTitle : undefined}
          onClick={() => onOpenEditor(document)}
        >
          <FilePenLine className="me-2 h-4 w-4" />
          {labels.actions.openInEditor}
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!availability.canOpen}
          title={!availability.canOpen ? unavailableTitle : undefined}
          onClick={() => onOpenAudit(document)}
        >
          <ScrollText className="me-2 h-4 w-4" />
          {labels.actions.auditTrail}
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger
            disabled={!availability.canOpen}
            title={!availability.canOpen ? unavailableTitle : undefined}
          >
            <FilePenLine className="me-2 h-4 w-4" />
            {labels.editor.workspace}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="min-w-56">
            {DOCUMENT_EDITOR_MATURITY_PANELS.map((panel) => {
              const Icon = maturityPanelIcons[panel];
              return (
                <DropdownMenuItem
                  key={panel}
                  onClick={() => onOpenEditorPanel(document, panel)}
                >
                  <Icon className="me-2 h-4 w-4" />
                  {labels.editor.featureLabels[panel]}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        {canWrite ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={!availability.canOpen}
              title={!availability.canOpen ? unavailableTitle : undefined}
              onClick={() => onCheckOut(document)}
            >
              <Lock className="me-2 h-4 w-4" />
              {labels.actions.checkOutLock}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!availability.canOpen}
              title={!availability.canOpen ? unavailableTitle : undefined}
              onClick={() => onRunPreflight(document)}
            >
              <ClipboardCheck className="me-2 h-4 w-4" />
              {labels.actions.runPreflight}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!availability.canOpen}
              title={!availability.canOpen ? unavailableTitle : undefined}
              onClick={() => onCreateSnapshot(document)}
            >
              <Save className="me-2 h-4 w-4" />
              {labels.actions.createSnapshot}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onEdit(document)}>
              <Pencil className="me-2 h-4 w-4" />
              {labels.actions.edit}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onUploadVersion(document)}>
              <Upload className="me-2 h-4 w-4" />
              {labels.actions.uploadVersion}
            </DropdownMenuItem>
            {document.status !== 'archived' ? (
              <DropdownMenuItem onClick={() => onArchive(document)}>
                <Archive className="me-2 h-4 w-4" />
                {labels.rowActions.archive}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive"
              onClick={() => onDelete(document)}
            >
              <Trash2 className="me-2 h-4 w-4" />
              {labels.actions.delete}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * M18: list/board view toggle button — mirrors the contracts/settlements toggle
 * UI (segmented control, icon + label, aria-pressed).
 */
function ViewToggle({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active
          ? 'bg-background text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      {label}
    </button>
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
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-full px-3 py-1 text-xs font-medium transition-colors',
        active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {label}
    </button>
  );
}

function BulkImportDocumentsDialog({
  onOpenChange,
  open,
  labels,
}: {
  onOpenChange: (open: boolean) => void;
  open: boolean;
  labels: DocumentsLabels;
}) {
  const queryClient = useQueryClient();
  const t = labels.bulkImport;
  const [batchId, setBatchId] = useState('');
  const [sourceSystem, setSourceSystem] = useState('');
  const [shouldIndex, setShouldIndex] = useState(true);
  const [rawDocuments, setRawDocuments] = useState('');
  const [parseError, setParseError] = useState<string | null>(null);
  const [preview, setPreview] = useState<BulkImportDocumentPayload[] | null>(null);
  const [result, setResult] = useState<LexDocumentBulkImportResult | null>(null);

  const bulkImportMutation = useMutation({
    mutationFn: (documents: BulkImportDocumentPayload[]) =>
      enterpriseApi.lex.bulkImportDocuments({
        ...(batchId.trim() ? { batch_id: batchId.trim() } : {}),
        ...(sourceSystem.trim() ? { source_system: sourceSystem.trim() } : {}),
        index: shouldIndex,
        documents,
      }),
    onSuccess: async (importResult) => {
      setResult(importResult);
      showSuccess(
        labels.toasts.bulkImportTitle,
        labels.toasts.bulkImportDescription(
          formatNumber(importResult.succeeded),
          formatNumber(importResult.failed),
          formatNumber(importResult.requested),
        ),
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['lex-documents'] }),
        queryClient.invalidateQueries({ queryKey: ['lex-document-repository-summary'] }),
        queryClient.invalidateQueries({ queryKey: ['lex-overview'] }),
      ]);
    },
    onError: showApiError,
  });

  function reset() {
    setBatchId('');
    setSourceSystem('');
    setShouldIndex(true);
    setRawDocuments('');
    setParseError(null);
    setPreview(null);
    setResult(null);
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      reset();
    }
    onOpenChange(nextOpen);
  }

  function handlePreview() {
    setParseError(null);
    setResult(null);

    try {
      const parsed = JSON.parse(rawDocuments) as unknown;
      if (!Array.isArray(parsed)) {
        setParseError(t.errors.mustBeArray);
        return;
      }
      if (parsed.length === 0) {
        setParseError(t.errors.addAtLeastOne);
        return;
      }
      if (parsed.length > 250) {
        setParseError(t.errors.tooMany);
        return;
      }

      const invalidIndex = parsed.findIndex((item) => !isRecord(item));
      if (invalidIndex >= 0) {
        setParseError(t.errors.itemMustBeObject(invalidIndex + 1));
        return;
      }

      setPreview(parsed as BulkImportDocumentPayload[]);
    } catch (error) {
      setParseError(t.errors.invalidJson((error as Error).message));
    }
  }

  function handleImport() {
    if (!preview) {
      return;
    }
    bulkImportMutation.mutate(preview);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t.title}</DialogTitle>
          <DialogDescription>{t.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="bulk-import-batch">{t.batchId}</Label>
              <Input
                id="bulk-import-batch"
                value={batchId}
                onChange={(event) => setBatchId(event.target.value)}
                placeholder={t.batchIdPlaceholder}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bulk-import-source">{t.sourceSystem}</Label>
              <Input
                id="bulk-import-source"
                value={sourceSystem}
                onChange={(event) => setSourceSystem(event.target.value)}
                placeholder={t.sourceSystemPlaceholder}
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-4 rounded-md border px-3 py-2">
            <div>
              <Label htmlFor="bulk-import-index">{t.indexLabel}</Label>
              <p className="text-xs text-muted-foreground">{t.indexHint}</p>
            </div>
            <Switch
              id="bulk-import-index"
              checked={shouldIndex}
              onCheckedChange={setShouldIndex}
              aria-label={t.indexAria}
            />
          </div>

          {!preview ? (
            <div className="space-y-1.5">
              <Label htmlFor="bulk-import-json">{t.documentsJson}</Label>
              <Textarea
                id="bulk-import-json"
                value={rawDocuments}
                onChange={(event) => setRawDocuments(event.target.value)}
                placeholder={BULK_IMPORT_EXAMPLE}
                className="min-h-72 font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground">{t.documentsHint}</p>
            </div>
          ) : (
            <BulkImportPreviewSummary
              documents={preview}
              onEdit={() => {
                setPreview(null);
                setResult(null);
              }}
              result={result}
              labels={labels}
            />
          )}

          {parseError ? (
            <div className="flex items-center gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{parseError}</span>
            </div>
          ) : null}

          {result ? <BulkImportResultSummary result={result} labels={labels} /> : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
            {result ? t.close : t.cancel}
          </Button>
          {!preview ? (
            <Button type="button" variant="outline" onClick={handlePreview} disabled={!rawDocuments.trim()}>
              {t.validatePreview}
            </Button>
          ) : null}
          {preview && !result ? (
            <Button type="button" onClick={handleImport} disabled={bulkImportMutation.isPending}>
              {bulkImportMutation.isPending ? (
                <Loader2 className="me-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Upload className="me-1.5 h-4 w-4" />
              )}
              {t.importButton(formatNumber(preview.length))}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function isRecord(value: unknown): value is BulkImportDocumentPayload {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function BulkImportPreviewSummary({
  documents,
  onEdit,
  result,
  labels,
}: {
  documents: BulkImportDocumentPayload[];
  onEdit: () => void;
  result: LexDocumentBulkImportResult | null;
  labels: DocumentsLabels;
}) {
  const t = labels.bulkImport;
  return (
    <div className="rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">{t.previewReady(formatNumber(documents.length))}</p>
        {!result ? (
          <Button type="button" variant="ghost" size="sm" onClick={onEdit}>
            {t.editJson}
          </Button>
        ) : null}
      </div>
      <div className="mt-3 space-y-2 text-sm">
        {documents.slice(0, 5).map((document, index) => (
          <div key={`${textValue(document.title, 'document')}-${index}`} className="rounded-md bg-muted/40 px-3 py-2">
            <p className="font-medium">{textValue(document.title, t.documentFallback(index + 1))}</p>
            <p className="text-xs text-muted-foreground">
              {textValue(document.type, t.typeUnknown)} / {textValue(document.confidentiality, t.confidentialityFallback)}
            </p>
          </div>
        ))}
        {documents.length > 5 ? (
          <p className="text-xs text-muted-foreground">{t.andMore(formatNumber(documents.length - 5))}</p>
        ) : null}
      </div>
    </div>
  );
}

function BulkImportResultSummary({ result, labels }: { result: LexDocumentBulkImportResult; labels: DocumentsLabels }) {
  const t = labels.bulkImport;
  const failedItems = result.items.filter((item) => item.status !== 'imported').slice(0, 5);

  return (
    <div className="rounded-md border p-3 text-sm">
      <p className="font-medium">{t.resultTitle}</p>
      <p className="mt-1 text-muted-foreground">
        {t.resultSummary(
          result.batch_id,
          formatNumber(result.succeeded),
          formatNumber(result.failed),
          formatNumber(result.requested),
        )}
      </p>
      {failedItems.length > 0 ? (
        <div className="mt-3 space-y-1 text-xs text-destructive">
          {failedItems.map((item) => (
            <p key={`${item.index}-${item.title ?? 'item'}`}>
              {t.itemError(item.index + 1, item.error || t.itemErrorFallback)}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function textValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

/**
 * resolveEnum returns the localized label for a raw backend token, falling back
 * to the de-tokenized form so unknown values still render gracefully.
 */
function resolveEnum(
  map: Record<string, string>,
  token: string,
  locale: string,
  fallback: string,
): string {
  return map[token] ?? (locale === 'ar' ? fallback : token.replace(/_/g, ' '));
}

/**
 * Build the KPI strip from the already-fetched repository summary (no extra
 * endpoint). Confidentiality (the document risk axis) leads: privileged /
 * confidential, then the active document count, then the retention signals.
 * Numbers are localized by <LexKpiStrip> (Arabic-Indic in ar mode).
 */
/** Stable KPI tile ids; also the key used to look up its aria hint + click filter. */
type DocumentKpiId =
  | 'total'
  | 'privileged'
  | 'confidential'
  | 'active'
  | 'retentionDue'
  | 'missingPolicy';

/** A KPI tile descriptor enriched with its id, aria hint and click-to-filter intent. */
interface DocumentKpiEntry {
  item: Omit<LexKpiItem, 'href' | 'onAction' | 'pressed'>;
  /** Aria/title hint surfaced on the clickable tile wrapper. */
  hint: string;
  /** The URL-param filter a click applies (toggles off when already active). */
  filter: { key: string; value: string } | null;
}

/**
 * Build the KPI strip entries from the already-fetched repository summary (no
 * extra endpoint). Confidentiality (the document risk axis) leads: privileged /
 * confidential, then the active document count, then the retention signals.
 * Each entry carries a click-to-filter intent (P0 #3): clicking a tile sets the
 * matching list filter; clicking the leading "total" tile clears scope.
 */
function buildDocumentKpis(
  summary: LexDocumentRepositorySummary | undefined,
  labels: DocumentsLabels,
): DocumentKpiEntry[] {
  const conf = summary?.by_confidentiality ?? {};
  const status = summary?.by_status ?? {};
  const retention = summary?.retention;
  const total = summary?.total_documents ?? 0;
  const share = (value: number | undefined): number =>
    total > 0 ? Math.round(((value ?? 0) / total) * 100) : 0;
  return [
    {
      item: {
        id: 'total',
        label: labels.kpis.total,
        value: total,
        theme: 'primary',
        icon: File,
        description: labels.kpiHints.total,
        detail: labels.kpis.total,
        detailValue: total,
      },
      hint: labels.kpiHints.total,
      filter: null,
    },
    {
      item: {
        id: 'privileged',
        label: labels.kpis.privileged,
        value: conf.privileged ?? 0,
        theme: 'red',
        icon: Lock,
        description: labels.kpiHints.privileged,
        progress: share(conf.privileged),
        progressLabel: labels.kpis.total,
        detail: labels.kpis.total,
        detailValue: `${share(conf.privileged)}%`,
      },
      hint: labels.kpiHints.privileged,
      filter: { key: 'confidentiality', value: 'privileged' },
    },
    {
      item: {
        id: 'confidential',
        label: labels.kpis.confidential,
        value: conf.confidential ?? 0,
        theme: 'orange',
        icon: ShieldCheck,
        description: labels.kpiHints.confidential,
        progress: share(conf.confidential),
        progressLabel: labels.kpis.total,
        detail: labels.kpis.total,
        detailValue: `${share(conf.confidential)}%`,
      },
      hint: labels.kpiHints.confidential,
      filter: { key: 'confidentiality', value: 'confidential' },
    },
    {
      item: {
        id: 'active',
        label: labels.kpis.active,
        value: status.active ?? 0,
        theme: 'emerald',
        icon: ClipboardCheck,
        description: labels.kpiHints.active,
        progress: share(status.active),
        progressLabel: labels.kpis.total,
        detail: labels.kpis.total,
        detailValue: `${share(status.active)}%`,
      },
      hint: labels.kpiHints.active,
      filter: { key: 'status', value: 'active' },
    },
    {
      item: {
        id: 'retentionDue',
        label: labels.kpis.retentionDue,
        value: retention?.disposition_due ?? 0,
        theme: 'amber',
        icon: Archive,
        description: labels.kpiHints.retentionDue,
        progress: share(retention?.disposition_due),
        progressLabel: labels.kpis.total,
        detail: labels.kpis.total,
        detailValue: `${share(retention?.disposition_due)}%`,
      },
      hint: labels.kpiHints.retentionDue,
      filter: { key: 'disposition_due', value: 'true' },
    },
    {
      item: {
        id: 'missingPolicy',
        label: labels.kpis.missingPolicy,
        value: retention?.missing_policy ?? 0,
        theme: 'yellow',
        icon: AlertCircle,
        description: labels.kpiHints.missingPolicy,
        progress: share(retention?.missing_policy),
        progressLabel: labels.kpis.total,
        detail: labels.kpis.total,
        detailValue: `${share(retention?.missing_policy)}%`,
      },
      hint: labels.kpiHints.missingPolicy,
      filter: { key: 'missing_retention_policy', value: 'true' },
    },
  ];
}

/**
 * Clickable KPI strip (P0 #3). `LexKpiStrip` / `LexKpiItem` expose only a
 * whole-card `href` — no `onClick` — so rather than edit the shared component we
 * wrap each tile in a transparent, accessible button overlay that applies the
 * tile's click-to-filter intent. Tiles whose `filter` is null (the leading
 * "All documents" total) clear every managed list filter instead.
 */
function ClickableKpiStrip({
  entries,
  activeFilters,
  onApplyFilter,
  onClearScope,
  dir,
}: {
  entries: DocumentKpiEntry[];
  activeFilters: Record<string, string | string[]>;
  onApplyFilter: (key: string, value: string) => void;
  onClearScope: () => void;
  dir: 'ltr' | 'rtl';
}) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6" dir={dir}>
      {entries.map((entry) => {
        const { filter, hint, item } = entry;
        const current = filter ? activeFilters[filter.key] : undefined;
        const active = filter
          ? Array.isArray(current)
            ? current.includes(filter.value)
            : current === filter.value
          : false;
        const actionableItem: LexKpiItem = {
          ...item,
          pressed: filter ? active : undefined,
          onAction: () => {
            if (!filter) {
              onClearScope();
              return;
            }
            onApplyFilter(filter.key, active ? '' : filter.value);
          },
        };
        return (
          <div key={item.id ?? item.label} aria-label={hint} title={hint}>
            <LexKpiStrip items={[actionableItem]} dir={dir} columns={1} className="h-full" />
          </div>
        );
      })}
    </div>
  );
}
