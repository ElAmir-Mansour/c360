'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Download,
  ExternalLink,
  FileText,
  FolderOpen,
  Loader2,
  Plus,
  Search,
  Unlink,
} from 'lucide-react';
import { SectionCard } from '@/components/suites/section-card';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { RelativeTime } from '@/components/shared/relative-time';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { enterpriseApi } from '@/lib/enterprise';
import { settlementsApi } from '@/lib/lex/settlements';
import { formatDateTime } from '@/lib/format';
import { showApiError, showSuccess } from '@/lib/toast';
import type { LexDocument } from '@/types/suites';
import { resolveLexBilingual, type LexBilingual } from '../../_lib/lex-i18n';

/* ------------------------------------------------------------------------- *
 * FEATURE 12 — Settlement document links.
 *
 * Self-contained module for the settlement detail page. Lists existing
 * settlement <-> LegalDocument join rows, links an existing lex document via a
 * search-backed picker (POST {document_id, relationship}), and unlinks a link
 * (the underlying LegalDocument is WORM and never deleted — DELETE removes the
 * LINK row only).
 *
 * fe-client (lib/lex/settlements.ts) owns the shared type + client methods; this
 * file references the agreed method names:
 *   settlementsApi.listSettlementDocuments(settlementId)          -> SettlementDocumentLink[]
 *   settlementsApi.addSettlementDocument(settlementId, payload)   -> SettlementDocumentLink
 *   settlementsApi.removeSettlementDocument(settlementId, linkId) -> void
 *
 * The join shape is mirrored locally so the module compiles independently of the
 * fe-client edit ordering; once settlements.ts exports `SettlementDocumentLink`
 * the page can pass the same shape through verbatim.
 *
 * Backend routes (mounted at /api/v1/lex):
 *   GET    /settlements/{id}/documents          -> {data: SettlementDocumentLink[]} (created_at DESC, hydrated document)
 *   POST   /settlements/{id}/documents          -> 201 {data: SettlementDocumentLink}
 *   DELETE /settlements/{id}/documents/{linkId} -> 204 (soft-delete link; document untouched)
 * ------------------------------------------------------------------------- */

/** A settlement <-> LegalDocument join row (mirrors the FEATURE 12 backend contract). */
export interface SettlementDocumentLink {
  id: string;
  tenant_id: string;
  settlement_id: string;
  document_id: string;
  relationship: string;
  created_by: string;
  created_at: string;
  deleted_at?: string | null;
  /** Hydrated LegalDocument when the linked doc is active; null/omitted otherwise. */
  document?: LexDocument | null;
}

/** POST body for linking an existing document to a settlement. */
export interface AddSettlementDocumentPayload {
  document_id: string;
  relationship?: string;
}

// The fe-client api surface gains these methods in parallel. They are typed here
// against the agreed signatures so this module stays self-contained and compiles
// regardless of the fe-client edit ordering.
type SettlementDocumentApi = {
  listSettlementDocuments: (settlementId: string) => Promise<SettlementDocumentLink[]>;
  addSettlementDocument: (
    settlementId: string,
    payload: AddSettlementDocumentPayload,
  ) => Promise<SettlementDocumentLink>;
  removeSettlementDocument: (settlementId: string, linkId: string) => Promise<void>;
};

function settlementDocumentApi(): SettlementDocumentApi {
  return settlementsApi as unknown as typeof settlementsApi & SettlementDocumentApi;
}

/** Relationship vocabulary for a settlement document link (default: "related"). */
const DOCUMENT_RELATIONSHIPS = [
  'related',
  'agreement',
  'evidence',
  'reference',
  'supporting',
] as const;

type DocumentRelationship = (typeof DOCUMENT_RELATIONSHIPS)[number];

/* ------------------------------------------------------------------------- *
 * Bilingual labels (self-contained, per module-build constraints).
 * ------------------------------------------------------------------------- */

interface SettlementDocumentsLabels {
  title: string;
  description: string;
  link: string;
  loading: string;
  loadError: string;
  emptyTitle: string;
  emptyDescription: string;
  relationship: string;
  version: (value: number) => string;
  confidentiality: string;
  type: string;
  linkedAt: string;
  noFile: string;
  view: string;
  download: string;
  preparing: string;
  unlink: string;
  unlinkTitle: string;
  unlinkDescription: (title: string) => string;
  unlinkConfirm: string;
  cancel: string;
  toastLinked: string;
  toastUnlinked: string;
  dialogTitle: string;
  dialogDescription: string;
  searchPlaceholder: string;
  document: string;
  documentPlaceholder: string;
  loadingDocuments: string;
  noDocuments: string;
  alreadyLinkedHint: string;
  pickerLoadError: string;
  relationshipLabels: Record<string, string>;
}

const settlementDocumentsLabelsBundle: LexBilingual<SettlementDocumentsLabels> = {
  en: {
    title: 'Linked Documents',
    description: 'Documents from the repository linked to this settlement.',
    link: 'Link document',
    loading: 'Loading linked documents…',
    loadError: 'Failed to load linked documents.',
    emptyTitle: 'No linked documents',
    emptyDescription: 'No repository documents are linked to this settlement yet.',
    relationship: 'Relationship',
    version: (value) => `v${value}`,
    confidentiality: 'Confidentiality',
    type: 'Type',
    linkedAt: 'Linked',
    noFile: 'No file attached',
    view: 'View',
    download: 'Download',
    preparing: 'Preparing…',
    unlink: 'Unlink',
    unlinkTitle: 'Unlink document',
    unlinkDescription: (title) =>
      `Remove the link to “${title}”? The document itself is retained in the repository.`,
    unlinkConfirm: 'Unlink',
    cancel: 'Cancel',
    toastLinked: 'Document linked to settlement.',
    toastUnlinked: 'Document unlinked.',
    dialogTitle: 'Link document',
    dialogDescription:
      'Search the document repository and link an existing document to this settlement.',
    searchPlaceholder: 'Search documents by title…',
    document: 'Document',
    documentPlaceholder: 'Select a document',
    loadingDocuments: 'Loading documents…',
    noDocuments: 'No documents match your search.',
    alreadyLinkedHint: 'Documents already linked to this settlement are hidden.',
    pickerLoadError: 'Failed to load documents.',
    relationshipLabels: {
      related: 'Related',
      agreement: 'Agreement',
      evidence: 'Evidence',
      reference: 'Reference',
      supporting: 'Supporting',
    },
  },
  ar: {
    title: 'الوثائق المرتبطة',
    description: 'وثائق من المستودع مرتبطة بهذه التسوية.',
    link: 'ربط وثيقة',
    loading: 'جارٍ تحميل الوثائق المرتبطة…',
    loadError: 'تعذّر تحميل الوثائق المرتبطة.',
    emptyTitle: 'لا توجد وثائق مرتبطة',
    emptyDescription: 'لا توجد وثائق من المستودع مرتبطة بهذه التسوية بعد.',
    relationship: 'العلاقة',
    version: (value) => `الإصدار ${value}`,
    confidentiality: 'السرّية',
    type: 'النوع',
    linkedAt: 'رُبطت',
    noFile: 'لا يوجد ملف مرفق',
    view: 'عرض',
    download: 'تنزيل',
    preparing: 'جارٍ التحضير…',
    unlink: 'إلغاء الربط',
    unlinkTitle: 'إلغاء ربط الوثيقة',
    unlinkDescription: (title) =>
      `هل تريد إزالة الرابط إلى «${title}»؟ تبقى الوثيقة محفوظة في المستودع.`,
    unlinkConfirm: 'إلغاء الربط',
    cancel: 'إلغاء',
    toastLinked: 'تم ربط الوثيقة بالتسوية.',
    toastUnlinked: 'تم إلغاء ربط الوثيقة.',
    dialogTitle: 'ربط وثيقة',
    dialogDescription: 'ابحث في مستودع الوثائق واربط وثيقة قائمة بهذه التسوية.',
    searchPlaceholder: 'ابحث في الوثائق بالعنوان…',
    document: 'الوثيقة',
    documentPlaceholder: 'اختر وثيقة',
    loadingDocuments: 'جارٍ تحميل الوثائق…',
    noDocuments: 'لا توجد وثائق مطابقة لبحثك.',
    alreadyLinkedHint: 'تُخفى الوثائق المرتبطة مسبقًا بهذه التسوية.',
    pickerLoadError: 'تعذّر تحميل الوثائق.',
    relationshipLabels: {
      related: 'مرتبطة',
      agreement: 'اتفاقية',
      evidence: 'دليل',
      reference: 'مرجع',
      supporting: 'داعمة',
    },
  },
};

function formatDocToken(value: string): string {
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

interface SettlementDocumentsSectionProps {
  settlementId: string;
  canWrite: boolean;
}

export function SettlementDocumentsSection({
  settlementId,
  canWrite,
}: SettlementDocumentsSectionProps) {
  const { locale, direction } = useLocaleOrDefault();
  const labels = useMemo(
    () => resolveLexBilingual(settlementDocumentsLabelsBundle, locale),
    [locale],
  );
  const queryClient = useQueryClient();
  const api = settlementDocumentApi();

  const [linkOpen, setLinkOpen] = useState(false);
  const [unlinkTarget, setUnlinkTarget] = useState<SettlementDocumentLink | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const linksQuery = useQuery({
    queryKey: ['lex-settlement-documents', settlementId],
    queryFn: () => api.listSettlementDocuments(settlementId),
    enabled: Boolean(settlementId),
  });

  const links = useMemo(
    () => (linksQuery.data ?? []).filter((link) => !link.deleted_at),
    [linksQuery.data],
  );

  const linkedDocumentIds = useMemo(
    () => new Set(links.map((link) => link.document_id)),
    [links],
  );

  const linkMutation = useMutation({
    mutationFn: (payload: AddSettlementDocumentPayload) =>
      api.addSettlementDocument(settlementId, payload),
    onSuccess: async () => {
      showSuccess(labels.toastLinked);
      setLinkOpen(false);
      await queryClient.invalidateQueries({
        queryKey: ['lex-settlement-documents', settlementId],
      });
    },
    onError: showApiError,
  });

  const unlinkMutation = useMutation({
    mutationFn: (linkId: string) => api.removeSettlementDocument(settlementId, linkId),
    onSuccess: async () => {
      showSuccess(labels.toastUnlinked);
      setUnlinkTarget(null);
      await queryClient.invalidateQueries({
        queryKey: ['lex-settlement-documents', settlementId],
      });
    },
    onError: showApiError,
  });

  const openFile = async (fileId: string, linkId: string) => {
    setDownloadingId(linkId);
    try {
      const presigned = await enterpriseApi.files.getPresignedDownload(fileId);
      if (typeof window !== 'undefined' && presigned.url) {
        window.open(presigned.url, '_blank', 'noopener,noreferrer');
      }
    } catch (error) {
      showApiError(error);
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <SectionCard
      title={labels.title}
      description={labels.description}
      actions={
        canWrite ? (
          <Button size="sm" onClick={() => setLinkOpen(true)}>
            <Plus className="me-1.5 h-3.5 w-3.5" />
            {labels.link}
          </Button>
        ) : undefined
      }
    >
      <div dir={direction} lang={locale}>
        {linksQuery.isLoading ? (
          <LoadingSkeleton variant="list-item" count={3} />
        ) : linksQuery.isError ? (
          <ErrorState message={labels.loadError} onRetry={() => void linksQuery.refetch()} />
        ) : links.length === 0 ? (
          <EmptyState
            icon={FolderOpen}
            title={labels.emptyTitle}
            description={labels.emptyDescription}
          />
        ) : (
          <div className="space-y-3">
            {links.map((link) => {
              const doc = link.document ?? null;
              const title = doc?.title ?? link.document_id;
              const fileId = doc?.file_id ?? null;
              const relationshipLabel =
                labels.relationshipLabels[link.relationship] ?? formatDocToken(link.relationship);
              return (
                <div
                  key={link.id}
                  className="relative overflow-hidden rounded-lg border px-4 py-3 ps-5"
                >
                  <span
                    className="absolute inset-y-0 start-0 w-1 bg-success-300/70"
                    aria-hidden
                  />
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                        <span className="truncate font-medium">{title}</span>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                        {doc?.type ? (
                          <Badge variant="outline">
                            {labels.type}: {formatDocToken(doc.type)}
                          </Badge>
                        ) : null}
                        {doc?.current_version ? (
                          <Badge variant="secondary">{labels.version(doc.current_version)}</Badge>
                        ) : null}
                        {doc?.confidentiality ? (
                          <Badge variant="outline">
                            {labels.confidentiality}: {formatDocToken(doc.confidentiality)}
                          </Badge>
                        ) : null}
                        <Badge variant="outline">{relationshipLabel}</Badge>
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {labels.linkedAt}: <RelativeTime date={link.created_at} /> •{' '}
                        {formatDateTime(link.created_at)}
                      </p>
                      {!fileId ? (
                        <p className="mt-1 text-xs text-muted-foreground">{labels.noFile}</p>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2">
                      {fileId ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={downloadingId === link.id}
                          onClick={() => void openFile(fileId, link.id)}
                        >
                          {downloadingId === link.id ? (
                            <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Download className="me-1.5 h-3.5 w-3.5" />
                          )}
                          {downloadingId === link.id ? labels.preparing : labels.view}
                        </Button>
                      ) : null}
                      {doc ? (
                        <Button size="sm" variant="ghost" asChild>
                          <a href={`/lex/documents/${link.document_id}`}>
                            <ExternalLink className="me-1.5 h-3.5 w-3.5" />
                            {labels.document}
                          </a>
                        </Button>
                      ) : null}
                      {canWrite ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setUnlinkTarget(link)}
                          disabled={unlinkMutation.isPending}
                        >
                          <Unlink className="me-1.5 h-3.5 w-3.5" />
                          {labels.unlink}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {canWrite ? (
        <SettlementLinkDocumentDialog
          open={linkOpen}
          loading={linkMutation.isPending}
          labels={labels}
          linkedDocumentIds={linkedDocumentIds}
          onOpenChange={setLinkOpen}
          onSubmit={(payload) => linkMutation.mutate(payload)}
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(unlinkTarget)}
        onOpenChange={(open) => {
          if (!open) setUnlinkTarget(null);
        }}
        title={labels.unlinkTitle}
        description={labels.unlinkDescription(
          unlinkTarget?.document?.title ?? unlinkTarget?.document_id ?? '',
        )}
        confirmLabel={labels.unlinkConfirm}
        cancelLabel={labels.cancel}
        variant="destructive"
        loading={unlinkMutation.isPending}
        onConfirm={() => {
          if (unlinkTarget) {
            unlinkMutation.mutate(unlinkTarget.id);
          }
        }}
      />
    </SectionCard>
  );
}

interface SettlementLinkDocumentDialogProps {
  open: boolean;
  loading: boolean;
  labels: SettlementDocumentsLabels;
  linkedDocumentIds: Set<string>;
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: AddSettlementDocumentPayload) => void;
}

function SettlementLinkDocumentDialog({
  open,
  loading,
  labels,
  linkedDocumentIds,
  onOpenChange,
  onSubmit,
}: SettlementLinkDocumentDialogProps) {
  const { direction, locale } = useLocaleOrDefault();
  const [search, setSearch] = useState('');
  const [documentId, setDocumentId] = useState('');
  const [relationship, setRelationship] = useState<DocumentRelationship>('related');

  const documentsQuery = useQuery({
    queryKey: ['lex-documents', 'settlement-link-picker'],
    queryFn: () =>
      enterpriseApi.lex.listDocuments({
        page: 1,
        per_page: 200,
        sort: 'updated_at',
        order: 'desc',
      }),
    enabled: open,
  });

  useEffect(() => {
    if (!open) {
      return;
    }
    setSearch('');
    setDocumentId('');
    setRelationship('related');
  }, [open]);

  const availableDocuments = useMemo(() => {
    const all = documentsQuery.data?.data ?? [];
    const term = search.trim().toLowerCase();
    return all
      .filter((doc) => !linkedDocumentIds.has(doc.id))
      .filter((doc) => {
        if (!term) {
          return true;
        }
        return (
          doc.title.toLowerCase().includes(term) ||
          (doc.type ?? '').toLowerCase().includes(term) ||
          (doc.category ?? '').toLowerCase().includes(term)
        );
      });
  }, [documentsQuery.data, linkedDocumentIds, search]);

  // Drop a stale selection if it falls out of the filtered set.
  useEffect(() => {
    if (documentId && !availableDocuments.some((doc) => doc.id === documentId)) {
      setDocumentId('');
    }
  }, [availableDocuments, documentId]);

  const submit = () => {
    if (!documentId) {
      return;
    }
    onSubmit({ document_id: documentId, relationship });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[90vh] overflow-y-auto sm:max-w-lg"
        dir={direction}
        lang={locale}
      >
        <DialogHeader>
          <DialogTitle>{labels.dialogTitle}</DialogTitle>
          <DialogDescription>{labels.dialogDescription}</DialogDescription>
        </DialogHeader>

        {documentsQuery.isError ? (
          <ErrorState
            message={labels.pickerLoadError}
            onRetry={() => void documentsQuery.refetch()}
          />
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="settlement-doc-search">{labels.document}</Label>
              <div className="relative">
                <Search
                  className="pointer-events-none absolute inset-y-0 start-3 my-auto h-4 w-4 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  id="settlement-doc-search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={labels.searchPlaceholder}
                  className="ps-9"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Select
                value={documentId}
                onValueChange={setDocumentId}
                disabled={documentsQuery.isLoading || availableDocuments.length === 0}
              >
                <SelectTrigger aria-label={labels.document}>
                  <SelectValue
                    placeholder={
                      documentsQuery.isLoading
                        ? labels.loadingDocuments
                        : labels.documentPlaceholder
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  <ScrollArea className="max-h-64">
                    {availableDocuments.map((doc: LexDocument) => (
                      <SelectItem key={doc.id} value={doc.id}>
                        {doc.title}
                      </SelectItem>
                    ))}
                  </ScrollArea>
                </SelectContent>
              </Select>
              {!documentsQuery.isLoading && availableDocuments.length === 0 ? (
                <p className="text-sm text-muted-foreground">{labels.noDocuments}</p>
              ) : (
                <p className="text-xs text-muted-foreground">{labels.alreadyLinkedHint}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="settlement-doc-relationship">{labels.relationship}</Label>
              <Select
                value={relationship}
                onValueChange={(value) => setRelationship(value as DocumentRelationship)}
              >
                <SelectTrigger id="settlement-doc-relationship">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DOCUMENT_RELATIONSHIPS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {labels.relationshipLabels[option] ?? formatDocToken(option)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {labels.cancel}
          </Button>
          <Button
            type="button"
            disabled={!documentId || loading || documentsQuery.isLoading}
            onClick={submit}
          >
            {loading ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" /> : null}
            {labels.link}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
