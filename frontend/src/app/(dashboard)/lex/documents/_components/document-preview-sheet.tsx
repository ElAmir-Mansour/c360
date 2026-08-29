'use client';

import { type MouseEvent, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ClipboardCheck,
  Copy,
  Download,
  ExternalLink,
  FilePenLine,
  FileSignature,
  Fingerprint,
  Gauge,
  Lock,
  Save,
  ScrollText,
  Scale,
  Sparkles,
} from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { DocumentViewer } from '@/components/shared/document-viewer';
import { useLocale } from '@/components/providers/locale-provider';
import { enterpriseApi } from '@/lib/enterprise';
import { extractDocxTextFromBlob, isDocxDocument } from '@/lib/documents/word';
import { isPdfDocument } from '@/lib/documents/pdf-text';
import { formatBytes } from '@/lib/format';
import { showApiError, showSuccess, showError } from '@/lib/toast';
import { cn } from '@/lib/utils';
import type { FilePresignedDownload } from '@/types/models';
import type { JsonObject, LexDocument, LexDocumentVersion } from '@/types/suites';
import {
  buildDocumentEditorHref,
  getDocumentEditorAvailability,
  type DocumentEditorAvailabilityReason,
} from '../_lib/documents-helpers';
import { usePreviewLabels } from './preview-labels';
import { DocumentArchiveAction } from './document-archive-action';
import type { DocumentArchiveInfo } from '../_lib/document-archive-api';
import { DocumentVersionHistory } from './document-version-history';
import {
  DocumentPdfProcessingStatus,
  type PdfProcessingDisplayStatus,
} from './document-pdf-processing-status';

interface LexDocumentPreviewSheetProps {
  document: LexDocument | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canWrite?: boolean;
}

/** Reads a string field off the document metadata bag, tolerating missing keys. */
function metadataString(metadata: JsonObject | undefined, key: string): string | undefined {
  const value = metadata?.[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function metadataRecord(metadata: JsonObject | undefined, key: string): JsonObject | undefined {
  const value = metadata?.[key];
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : undefined;
}

function metadataNumber(metadata: JsonObject | undefined, key: string): number | undefined {
  const value = metadata?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Source whose file is currently shown in the viewer: the base document or a version. */
interface PreviewSource {
  fileId?: string;
  fileName?: string;
  /** Version number when previewing a specific revision; null for the base document. */
  version: number | null;
  contentHash?: string;
  fileSizeBytes?: number;
  extractedText?: string;
}

/**
 * Escapes a user query for safe use inside a RegExp, so "find in document"
 * never throws on regex metacharacters in the search text.
 */
function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Lex-aware document preview sheet. Composes its own side {@link Sheet} (RTL-aware)
 * around a richer surface than the generic viewer:
 *  - a toolbar (download / open in new tab / copy link / find-in-document) plus an
 *    integrity strip surfacing file size and content hash;
 *  - the lower-level {@link DocumentViewer} rendering the active file (the base
 *    document or any selected version, resolved to a short-lived presigned URL);
 *  - a {@link DocumentVersionHistory} timeline whose Preview/Download actions swap
 *    the viewed revision.
 *
 * Public contract is unchanged so the host page needs no edit.
 */
export function LexDocumentPreviewSheet({
  document,
  open,
  onOpenChange,
  canWrite = false,
}: LexDocumentPreviewSheetProps) {
  const labels = usePreviewLabels();
  const { direction, locale } = useLocale();
  const queryClient = useQueryClient();
  const noDocumentSelected = locale === 'ar' ? 'لم تُحدَّد وثيقة' : 'No document selected';

  // Which revision the viewer is showing. `null` version === the base document.
  const [source, setSource] = useState<PreviewSource | null>(null);
  const [previewingVersion, setPreviewingVersion] = useState<number | null>(null);
  const [downloadingVersion, setDownloadingVersion] = useState<number | null>(null);
  const [findQuery, setFindQuery] = useState('');

  // Reset to the base document whenever the sheet opens for a (new) document.
  useEffect(() => {
    if (!open || !document) {
      setSource(null);
      setFindQuery('');
      return;
    }
    setSource({
      fileId: document.file_id ?? undefined,
      fileName: document.file_name ?? undefined,
      version: null,
      contentHash: metadataString(document.metadata, 'content_hash'),
      fileSizeBytes: document.file_size_bytes ?? undefined,
      extractedText: document.extracted_text ?? metadataString(document.metadata, 'extracted_text'),
    });
    setFindQuery('');
  }, [open, document]);

  const activeFileId = source?.fileId;

  const presignedQuery = useQuery({
    queryKey: ['lex-document-preview-url', document?.id, activeFileId],
    queryFn: () => enterpriseApi.files.getPresignedDownload(activeFileId ?? ''),
    enabled: open && !!activeFileId,
  });

  const presignedFor = (fileId: string) =>
    queryClient.fetchQuery({
      queryKey: ['lex-document-preview-url', document?.id, fileId],
      queryFn: () => enterpriseApi.files.getPresignedDownload(fileId),
    });

  const fileName = source?.fileName ?? document?.file_name ?? undefined;
  const mimeType =
    metadataString(document?.metadata, 'content_type') ??
    metadataString(document?.metadata, 'mime_type');
  const url = activeFileId ? presignedQuery.data?.url : undefined;
  const wordDocument = isDocxDocument(fileName, mimeType);
  const historicalVersionSelected = source?.version != null;
  const storedExtractedText = historicalVersionSelected
    ? source?.extractedText
    : source?.extractedText ??
      document?.extracted_text ??
      metadataString(document?.metadata, 'extracted_text');
  const docxTextQuery = useQuery({
    queryKey: ['lex-document-docx-text', document?.id, activeFileId],
    queryFn: async () => {
      const blob = await enterpriseApi.files.download(activeFileId ?? '');
      return extractDocxTextFromBlob(blob, fileName);
    },
    enabled: open && !!activeFileId && wordDocument && !storedExtractedText,
  });
  const extractedText = storedExtractedText ?? docxTextQuery.data;
  const pdfDocument = isPdfDocument(fileName, mimeType);
  const extractionMetadata = source?.version == null
    ? metadataRecord(document?.metadata, 'text_extraction')
    : undefined;
  const ocrMetadata = source?.version == null
    ? metadataRecord(document?.metadata, 'ocr')
    : undefined;
  const pdfProcessingStatus = pdfDocument
    ? resolvePreviewPdfStatus(extractedText, extractionMetadata, ocrMetadata)
    : undefined;

  const fileSizeBytes = source?.fileSizeBytes;
  const contentHash =
    source?.contentHash ?? metadataString(document?.metadata, 'content_hash');
  const editorAvailability = document
    ? getDocumentEditorAvailability(document)
    : { canOpen: false, reason: 'missing_file' as DocumentEditorAvailabilityReason };
  const editorUnavailableDescription = editorAvailability.reason === 'missing_file'
    ? labels.editor.unavailableMissingFile
    : labels.editor.unavailableUnsupportedFormat;
  const editorHref = document ? buildDocumentEditorHref(document) : '#';
  const editorAuditHref = document ? buildDocumentEditorHref(document, { panel: 'audit' }) : '#';
  const legalIssuesHref = document ? buildDocumentEditorHref(document, { panel: 'legal-issues' }) : '#';
  const clauseAIHref = document ? buildDocumentEditorHref(document, { panel: 'clause-ai-actions' }) : '#';
  const privilegedControlsHref = document
    ? buildDocumentEditorHref(document, { panel: 'privileged-controls' })
    : '#';

  const versionSuffix =
    source && source.version !== null
      ? source.version
      : document?.current_version;
  const title = document
    ? `${document.title} · ${labels.versionLabel(versionSuffix ?? document.current_version)}`
    : labels.fallbackTitle;

  // Highlight find-matches within the extracted OCR text.
  const { segments, matchCount } = useMemo(
    () => highlightSegments(extractedText ?? '', findQuery),
    [extractedText, findQuery],
  );

  async function handlePreviewVersion(version: LexDocumentVersion) {
    setPreviewingVersion(version.version);
    try {
      await presignedFor(version.file_id); // warm the cache so the viewer query resolves instantly
      setSource({
        fileId: version.file_id,
        fileName: version.file_name,
        version: version.version,
        contentHash: version.content_hash,
        fileSizeBytes: version.file_size_bytes,
        extractedText: version.extracted_text ?? undefined,
      });
    } catch {
      showError(labels.toolbar.copyUnavailableTitle, labels.versions.loadError);
    } finally {
      setPreviewingVersion(null);
    }
  }

  async function triggerDownload(fileId: string, name: string) {
    const presigned: FilePresignedDownload = await presignedFor(fileId);
    const anchor = window.document.createElement('a');
    anchor.href = presigned.url;
    anchor.download = name;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    window.document.body.appendChild(anchor);
    anchor.click();
    window.document.body.removeChild(anchor);
  }

  async function handleDownloadVersion(version: LexDocumentVersion) {
    setDownloadingVersion(version.version);
    try {
      await triggerDownload(version.file_id, version.file_name);
    } catch {
      showError(labels.versions.loadError);
    } finally {
      setDownloadingVersion(null);
    }
  }

  async function handleCopyLink() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      showSuccess(labels.toolbar.linkCopiedTitle, labels.toolbar.linkCopiedDescription);
    } catch {
      showError(labels.toolbar.copyUnavailableTitle, labels.toolbar.copyUnavailableDescription);
    }
  }

  async function handleCopyHash() {
    if (!contentHash) return;
    try {
      await navigator.clipboard.writeText(contentHash);
      showSuccess(labels.integrity.hashCopiedTitle);
    } catch {
      showError(labels.toolbar.copyUnavailableTitle, labels.toolbar.copyUnavailableDescription);
    }
  }

  function handleOpenEditorLink(event: MouseEvent<HTMLAnchorElement>) {
    if (!document || !editorAvailability.canOpen) {
      event.preventDefault();
      showError(labels.editor.unavailableTitle, editorUnavailableDescription);
      return;
    }
    void enterpriseApi.lex.openDocumentEditor(document.id, {
      current_version: document.current_version,
      source: 'lex-document-preview',
    }).catch(() => undefined);
  }

  function handleOpenAuditLink(event: MouseEvent<HTMLAnchorElement>) {
    if (!document || !editorAvailability.canOpen) {
      event.preventDefault();
      showError(labels.editor.unavailableTitle, editorUnavailableDescription);
      return;
    }
    void enterpriseApi.lex.listDocumentAudit(document.id).catch(() => undefined);
  }

  function handleEditorPanelLink(event: MouseEvent<HTMLAnchorElement>) {
    if (!document || !editorAvailability.canOpen) {
      event.preventDefault();
      showError(labels.editor.unavailableTitle, editorUnavailableDescription);
    }
  }

  const checkOutMutation = useMutation({
    mutationFn: () => {
      if (!document) throw new Error(noDocumentSelected);
      return enterpriseApi.lex.checkOutDocument(document.id, {
        current_version: document.current_version,
        source: 'lex-document-preview',
      });
    },
    onSuccess: async () => {
      if (!document) return;
      showSuccess(labels.editor.checkedOutTitle, labels.editor.checkedOutDescription(document.title));
      await invalidateEditorQueries(queryClient, document.id);
    },
    onError: showApiError,
  });

  const preflightMutation = useMutation({
    mutationFn: () => {
      if (!document) throw new Error(noDocumentSelected);
      return enterpriseApi.lex.runDocumentPreflight(document.id, {
        current_version: document.current_version,
        source: 'lex-document-preview',
      });
    },
    onSuccess: (result) => {
      if (!document) return;
      const issueCount = result.issues?.length ?? 0;
      if (result.ready === false || result.status === 'blocked' || issueCount > 0) {
        showSuccess(labels.editor.preflightReviewTitle, labels.editor.preflightReviewDescription(issueCount));
        return;
      }
      showSuccess(labels.editor.preflightPassedTitle, labels.editor.preflightPassedDescription(document.title));
    },
    onError: showApiError,
  });

  const snapshotMutation = useMutation({
    mutationFn: () => {
      if (!document) throw new Error(noDocumentSelected);
      return enterpriseApi.lex.createDocumentVersionSnapshot(document.id, {
        current_version: document.current_version,
        source: 'lex-document-preview',
        change_summary: labels.editor.snapshotSummary(document.title),
      });
    },
    onSuccess: async () => {
      if (!document) return;
      showSuccess(labels.editor.snapshotCreatedTitle, labels.editor.snapshotCreatedDescription(document.title));
      await invalidateEditorQueries(queryClient, document.id);
    },
    onError: showApiError,
  });

  const healthScoreMutation = useMutation({
    mutationFn: () => {
      if (!document) throw new Error(noDocumentSelected);
      return enterpriseApi.lex.refreshDocumentHealthScore(document.id, {
        current_version: document.current_version,
        source: 'lex-document-preview',
        include_ai_signals: true,
      });
    },
    onSuccess: async (result) => {
      if (!document) return;
      showSuccess(
        labels.maturity.healthUpdatedTitle,
        labels.maturity.healthUpdatedDescription(Math.round(result.score)),
      );
      await invalidateEditorQueries(queryClient, document.id);
    },
    onError: showApiError,
  });

  const signatureReadinessMutation = useMutation({
    mutationFn: () => {
      if (!document) throw new Error(noDocumentSelected);
      return enterpriseApi.lex.runDocumentSignatureReadiness(document.id, {
        current_version: document.current_version,
        source: 'lex-document-preview',
      });
    },
    onSuccess: async (result) => {
      if (!document) return;
      if (result.ready) {
        showSuccess(labels.maturity.signatureReadyTitle);
      } else {
        const failedChecks = result.checks.filter((check) => check.status !== 'passed').length;
        showSuccess(
          labels.maturity.signatureReviewTitle,
          labels.maturity.signatureReviewDescription(failedChecks),
        );
      }
      await invalidateEditorQueries(queryClient, document.id);
    },
    onError: showApiError,
  });

  const findActive = findQuery.trim().length > 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={direction === 'rtl' ? 'left' : 'right'}
        dir={direction}
        className="w-full max-w-3xl sm:max-w-3xl overflow-y-auto"
        aria-describedby={undefined}
      >
        <SheetHeader>
          <SheetTitle className="text-start">{title}</SheetTitle>
        </SheetHeader>

        {/* Toolbar */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button
            asChild
            size="sm"
            variant="default"
            disabled={!editorAvailability.canOpen}
            aria-disabled={!editorAvailability.canOpen}
            className={cn(!editorAvailability.canOpen && 'pointer-events-none opacity-50')}
            title={!editorAvailability.canOpen ? editorUnavailableDescription : undefined}
          >
            <a href={editorHref} onClick={handleOpenEditorLink}>
              <FilePenLine className="me-1.5 h-4 w-4" aria-hidden />
              {labels.toolbar.openInEditor}
            </a>
          </Button>
          <Button
            asChild
            size="sm"
            variant="outline"
            disabled={!url}
            aria-disabled={!url}
            className={cn(!url && 'pointer-events-none opacity-50')}
          >
            <a href={url ?? '#'} download={fileName} target="_blank" rel="noopener noreferrer">
              <Download className="me-1.5 h-4 w-4" aria-hidden />
              {labels.toolbar.download}
            </a>
          </Button>
          <Button
            asChild
            size="sm"
            variant="outline"
            disabled={!url}
            aria-disabled={!url}
            className={cn(!url && 'pointer-events-none opacity-50')}
          >
            <a href={url ?? '#'} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="me-1.5 h-4 w-4" aria-hidden />
              {labels.toolbar.openInNewTab}
            </a>
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!url}
            onClick={handleCopyLink}
          >
            <Copy className="me-1.5 h-4 w-4" aria-hidden />
            {labels.toolbar.copyLink}
          </Button>
          <Button
            asChild
            size="sm"
            variant="outline"
            disabled={!editorAvailability.canOpen}
            aria-disabled={!editorAvailability.canOpen}
            className={cn(!editorAvailability.canOpen && 'pointer-events-none opacity-50')}
            title={!editorAvailability.canOpen ? editorUnavailableDescription : undefined}
          >
            <a href={editorAuditHref} onClick={handleOpenAuditLink}>
              <ScrollText className="me-1.5 h-4 w-4" aria-hidden />
              {labels.toolbar.auditTrail}
            </a>
          </Button>
          {canWrite ? (
            <>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!editorAvailability.canOpen || checkOutMutation.isPending}
                title={!editorAvailability.canOpen ? editorUnavailableDescription : undefined}
                onClick={() => checkOutMutation.mutate()}
              >
                {checkOutMutation.isPending ? (
                  <LoaderIcon />
                ) : (
                  <Lock className="me-1.5 h-4 w-4" aria-hidden />
                )}
                {labels.toolbar.checkOutLock}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!editorAvailability.canOpen || preflightMutation.isPending}
                title={!editorAvailability.canOpen ? editorUnavailableDescription : undefined}
                onClick={() => preflightMutation.mutate()}
              >
                {preflightMutation.isPending ? (
                  <LoaderIcon />
                ) : (
                  <ClipboardCheck className="me-1.5 h-4 w-4" aria-hidden />
                )}
                {labels.toolbar.runPreflight}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!editorAvailability.canOpen || snapshotMutation.isPending}
                title={!editorAvailability.canOpen ? editorUnavailableDescription : undefined}
                onClick={() => snapshotMutation.mutate()}
              >
                {snapshotMutation.isPending ? (
                  <LoaderIcon />
                ) : (
                  <Save className="me-1.5 h-4 w-4" aria-hidden />
                )}
                {labels.toolbar.createSnapshot}
              </Button>
            </>
          ) : null}

          {extractedText && (
            <div className="ms-auto flex items-center gap-2">
              <Input
                value={findQuery}
                onChange={(e) => setFindQuery(e.target.value)}
                placeholder={labels.toolbar.findPlaceholder}
                aria-label={labels.toolbar.findAria}
                className="h-8 w-48"
              />
              {findActive && (
                <span className="shrink-0 text-xs text-muted-foreground">
                  {matchCount > 0
                    ? labels.toolbar.matchCount(matchCount, matchCount)
                    : labels.toolbar.noMatches}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Integrity strip */}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border bg-muted/30 px-3 py-2 text-xs">
          <span className="font-medium uppercase tracking-wide text-muted-foreground">
            {labels.integrity.title}
          </span>
          <span className="text-foreground">
            {labels.integrity.fileSize}:{' '}
            {typeof fileSizeBytes === 'number'
              ? formatBytes(fileSizeBytes)
              : labels.integrity.unavailable}
          </span>
          <span className="flex min-w-0 items-center gap-1.5 text-foreground">
            <Fingerprint className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="shrink-0">{labels.integrity.contentHash}:</span>
            {contentHash ? (
              <>
                <code className="truncate font-mono text-[11px]">{contentHash}</code>
                <button
                  type="button"
                  onClick={handleCopyHash}
                  aria-label={labels.integrity.copyHashAria}
                  className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Copy className="h-3.5 w-3.5" aria-hidden />
                </button>
              </>
            ) : (
              <span className="text-muted-foreground">{labels.integrity.unavailable}</span>
            )}
          </span>
        </div>

        {pdfProcessingStatus ? (
          <DocumentPdfProcessingStatus
            className="mt-3"
            status={pdfProcessingStatus}
            pageCount={metadataNumber(extractionMetadata, 'page_count')}
            pagesWithText={metadataNumber(extractionMetadata, 'pages_with_text')}
          />
        ) : null}

        <div className="mt-3 rounded-lg border bg-card/70 px-3 py-3">
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {labels.maturity.title}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!editorAvailability.canOpen || healthScoreMutation.isPending}
              title={!editorAvailability.canOpen ? editorUnavailableDescription : undefined}
              onClick={() => healthScoreMutation.mutate()}
            >
              {healthScoreMutation.isPending ? (
                <LoaderIcon />
              ) : (
                <Gauge className="me-1.5 h-4 w-4" aria-hidden />
              )}
              {labels.maturity.healthScore}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!editorAvailability.canOpen || signatureReadinessMutation.isPending}
              title={!editorAvailability.canOpen ? editorUnavailableDescription : undefined}
              onClick={() => signatureReadinessMutation.mutate()}
            >
              {signatureReadinessMutation.isPending ? (
                <LoaderIcon />
              ) : (
                <FileSignature className="me-1.5 h-4 w-4" aria-hidden />
              )}
              {labels.maturity.signatureReadiness}
            </Button>
            <Button
              asChild
              size="sm"
              variant="outline"
              disabled={!editorAvailability.canOpen}
              aria-disabled={!editorAvailability.canOpen}
              className={cn(!editorAvailability.canOpen && 'pointer-events-none opacity-50')}
              title={!editorAvailability.canOpen ? editorUnavailableDescription : undefined}
            >
              <a href={legalIssuesHref} onClick={handleEditorPanelLink}>
                <Scale className="me-1.5 h-4 w-4" aria-hidden />
                {labels.maturity.legalIssues}
              </a>
            </Button>
            <Button
              asChild
              size="sm"
              variant="outline"
              disabled={!editorAvailability.canOpen}
              aria-disabled={!editorAvailability.canOpen}
              className={cn(!editorAvailability.canOpen && 'pointer-events-none opacity-50')}
              title={!editorAvailability.canOpen ? editorUnavailableDescription : undefined}
            >
              <a href={clauseAIHref} onClick={handleEditorPanelLink}>
                <Sparkles className="me-1.5 h-4 w-4" aria-hidden />
                {labels.maturity.clauseAI}
              </a>
            </Button>
            {document?.confidentiality === 'privileged' ? (
              <Button
                asChild
                size="sm"
                variant="outline"
                disabled={!editorAvailability.canOpen}
                aria-disabled={!editorAvailability.canOpen}
                className={cn(!editorAvailability.canOpen && 'pointer-events-none opacity-50')}
                title={!editorAvailability.canOpen ? editorUnavailableDescription : undefined}
              >
                <a href={privilegedControlsHref} onClick={handleEditorPanelLink}>
                  <Lock className="me-1.5 h-4 w-4" aria-hidden />
                  {labels.maturity.privilegedControls}
                </a>
              </Button>
            ) : null}
          </div>
        </div>

        {/* e-Archive action + reference (Othaim PRD 14.1). */}
        {document ? (
          <DocumentArchiveAction
            documentId={document.id}
            canWrite={canWrite}
            initialArchive={
              (metadataRecord(document.metadata, 'archive') as unknown as DocumentArchiveInfo | undefined) ?? null
            }
          />
        ) : null}

        {/* Viewer */}
        <div className="mt-4">
          <DocumentViewer
            dir={direction}
            url={url}
            mimeType={mimeType}
            fileName={fileName}
            // PDFs/images own their visual preview; Word documents need the text
            // layer in-view because browsers do not render DOCX natively.
            extractedText={wordDocument ? extractedText : url ? undefined : extractedText}
            height={520}
          />
        </div>

        {/* Find-in-document highlighted OCR text */}
        {extractedText && url && !wordDocument && (
          <div className="mt-3">
            <pre className="max-h-72 overflow-auto rounded-lg border bg-card p-4 text-sm leading-6 text-foreground whitespace-pre-wrap break-words font-sans">
              {segments.map((seg, i) =>
                seg.match ? (
                  <mark key={i} className="rounded bg-yellow-200 px-0.5 text-foreground dark:bg-yellow-500/40">
                    {seg.text}
                  </mark>
                ) : (
                  <span key={i}>{seg.text}</span>
                ),
              )}
            </pre>
          </div>
        )}

        <Separator className="my-5" />

        {/* Version history */}
        <DocumentVersionHistory
          documentId={document?.id}
          currentVersion={document?.current_version}
          enabled={open}
          selectedVersion={source?.version ?? document?.current_version ?? null}
          onPreviewVersion={handlePreviewVersion}
          previewingVersion={previewingVersion}
          onDownloadVersion={handleDownloadVersion}
          downloadingVersion={downloadingVersion}
        />
      </SheetContent>
    </Sheet>
  );
}

function resolvePreviewPdfStatus(
  extractedText: string | undefined,
  extractionMetadata: JsonObject | undefined,
  ocrMetadata: JsonObject | undefined,
): PdfProcessingDisplayStatus {
  const hasText = !!extractedText?.trim();
  const method = metadataString(extractionMetadata, 'method');
  const ocrStatus = metadataString(ocrMetadata, 'status');

  if (!hasText) return 'ocr_pending';
  if (method === 'manual' && ocrStatus === 'pending') return 'manual_text_ocr_pending';
  if (ocrStatus === 'partial_pending' || metadataNumber(extractionMetadata, 'pages_needing_ocr')) {
    return 'partial_ocr_pending';
  }
  // Only page-level text-layer proof may claim OCR is unnecessary. Legacy or
  // API-provided text remains useful/searchable without inventing provenance.
  if (method === 'pdf_text_layer' && ocrStatus === 'not_required') return 'text_extracted';
  return 'provided_text_ocr_unknown';
}

function LoaderIcon() {
  return (
    <span
      className="me-1.5 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
      aria-hidden
    />
  );
}

async function invalidateEditorQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  documentId: string,
) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['lex-documents'] }),
    queryClient.invalidateQueries({ queryKey: ['lex-documents-fts'] }),
    queryClient.invalidateQueries({ queryKey: ['lex-document', documentId] }),
    queryClient.invalidateQueries({ queryKey: ['lex-document-versions', documentId] }),
    queryClient.invalidateQueries({ queryKey: ['lex-document-editor', documentId] }),
    queryClient.invalidateQueries({ queryKey: ['lex-document-audit', documentId] }),
    queryClient.invalidateQueries({ queryKey: ['lex-document-health-score', documentId] }),
    queryClient.invalidateQueries({ queryKey: ['lex-document-signature-readiness', documentId] }),
    queryClient.invalidateQueries({ queryKey: ['lex-document-legal-issues', documentId] }),
    queryClient.invalidateQueries({ queryKey: ['lex-document-privileged-controls', documentId] }),
    queryClient.invalidateQueries({ queryKey: ['lex-document-repository-summary'] }),
  ]);
}

interface HighlightSegment {
  text: string;
  match: boolean;
}

/**
 * Splits `text` into highlight segments around case-insensitive matches of
 * `query`. Returns the raw text as a single non-match segment when the query is
 * empty, and the total match count for the result chip.
 */
function highlightSegments(
  text: string,
  query: string,
): { segments: HighlightSegment[]; matchCount: number } {
  const trimmed = query.trim();
  if (!trimmed || !text) {
    return { segments: [{ text, match: false }], matchCount: 0 };
  }
  const regex = new RegExp(`(${escapeRegExp(trimmed)})`, 'gi');
  const parts = text.split(regex);
  const lower = trimmed.toLowerCase();
  let matchCount = 0;
  const segments: HighlightSegment[] = parts
    .filter((part) => part.length > 0)
    .map((part) => {
      const isMatch = part.toLowerCase() === lower;
      if (isMatch) matchCount += 1;
      return { text: part, match: isMatch };
    });
  return { segments, matchCount };
}
