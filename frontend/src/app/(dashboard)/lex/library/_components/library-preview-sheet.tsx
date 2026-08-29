'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  Copy,
  Download,
  Fingerprint,
  Link2,
  Maximize2,
} from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { useLocale } from '@/components/providers/locale-provider';
import { useLexFormat } from '@/lib/lex/ksa';
import { enterpriseApi } from '@/lib/enterprise';
import { formatBytes } from '@/lib/format';
import { showSuccess, showError } from '@/lib/toast';
import { resolveDocTitles } from '../_lib/library-helpers';
import { useLibraryLabels } from '../_lib/library-labels';
import { recordView } from '../_lib/recent-views';
import { ClassificationChips } from './reference-chips';
import { PdfViewer, type PdfViewerCommand } from './pdf/pdf-viewer';

interface LibraryPreviewSheetProps {
  documentId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Deep-link: jump to a page in the viewer (citation / contents-search). */
  deepLinkPage?: number | null;
  /** Deep-link: highlight this snippet/term in the viewer. */
  deepLinkTerm?: string | null;
}

/**
 * Read-only reference-library preview sheet. A stripped twin of the lex document
 * preview: it embeds the rich {@link PdfViewer} (pdf.js engine with in-doc search
 * / zoom / thumbnails / page nav, native `<iframe>` fallback) but drops EVERY
 * write action (no check-out / snapshot / editor / version history). Bytes are
 * streamed from the reference-library download endpoint as a Blob, turned into a
 * short-lived `URL.createObjectURL(...)` and fed to the viewer — the object URL
 * is revoked when the blob changes or the sheet closes. Citations and contents
 * hits can DEEP-LINK the viewer to a page + highlight a snippet.
 */
export function LibraryPreviewSheet({
  documentId,
  open,
  onOpenChange,
  deepLinkPage,
  deepLinkTerm,
}: LibraryPreviewSheetProps) {
  const labels = useLibraryLabels();
  const { direction, locale } = useLocale();
  const f = useLexFormat();
  const [objectUrl, setObjectUrl] = useState<string | undefined>();
  const [command, setCommand] = useState<PdfViewerCommand | undefined>();
  const nonceRef = useRef(0);

  const docQuery = useQuery({
    queryKey: ['lex-reference-doc', documentId],
    queryFn: () => enterpriseApi.lex.referenceLibrary.get(documentId ?? ''),
    enabled: open && !!documentId,
  });

  const downloadQuery = useQuery({
    queryKey: ['lex-reference-download', documentId],
    queryFn: () => enterpriseApi.lex.referenceLibrary.download(documentId ?? ''),
    enabled: open && !!documentId,
  });

  // Turn the fetched Blob into an object URL for the inline viewer; revoke it
  // when the blob changes or the sheet unmounts so we never leak object URLs.
  useEffect(() => {
    const blob = downloadQuery.data;
    if (!blob) {
      setObjectUrl(undefined);
      return;
    }
    const url = URL.createObjectURL(blob);
    setObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [downloadQuery.data]);

  // Record the open for the client-local "recently viewed" rail.
  useEffect(() => {
    if (open && documentId) recordView(documentId);
  }, [open, documentId]);

  // Translate an incoming deep-link into a viewer command (page + highlight).
  useEffect(() => {
    if (!open || !documentId) return;
    const hasPage = typeof deepLinkPage === 'number' && deepLinkPage > 0;
    const hasTerm = !!deepLinkTerm && deepLinkTerm.trim().length > 0;
    if (hasPage || hasTerm) {
      nonceRef.current += 1;
      setCommand({
        page: hasPage ? deepLinkPage ?? undefined : undefined,
        term: hasTerm ? deepLinkTerm ?? undefined : undefined,
        nonce: nonceRef.current,
      });
    } else {
      setCommand(undefined);
    }
  }, [open, documentId, deepLinkPage, deepLinkTerm]);

  const doc = docQuery.data;
  const titles = doc
    ? resolveDocTitles(doc, locale)
    : { primary: labels.preview.fallbackTitle, secondary: undefined };
  const fileName = `${titles.primary}.pdf`;
  const sourceUrl = doc?.source_url?.trim() || undefined;
  const issued = doc?.gregorian_date
    ? f.formatDual(doc.gregorian_date)
    : doc?.hijri_date || undefined;

  function handleDownload() {
    const blob = downloadQuery.data;
    if (!blob || typeof window === 'undefined') return;
    const url = URL.createObjectURL(blob);
    const anchor = window.document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    window.document.body.appendChild(anchor);
    anchor.click();
    window.document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }

  async function handleCopyLink() {
    if (!documentId || typeof window === 'undefined') return;
    const link = `${window.location.origin}/lex/library/${documentId}`;
    try {
      await navigator.clipboard.writeText(link);
      showSuccess(labels.preview.linkCopied);
    } catch {
      showError(labels.preview.copyFailed);
    }
  }

  async function handleCopySource() {
    if (!sourceUrl) {
      showError(labels.preview.sourceUnavailable);
      return;
    }
    try {
      await navigator.clipboard.writeText(sourceUrl);
      showSuccess(labels.preview.sourceCopied);
    } catch {
      showError(labels.preview.copyFailed);
    }
  }

  async function handleCopyHash() {
    const hash = doc?.content_hash;
    if (!hash) return;
    try {
      await navigator.clipboard.writeText(hash);
      showSuccess(labels.preview.hashCopied);
    } catch {
      showError(labels.preview.copyFailed);
    }
  }

  const loadingBytes = downloadQuery.isLoading || docQuery.isLoading;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={direction === 'rtl' ? 'left' : 'right'}
        dir={direction}
        className="w-full max-w-3xl sm:max-w-3xl overflow-y-auto"
        aria-describedby={undefined}
      >
        <SheetHeader>
          <SheetTitle dir="auto" className="text-start">
            {titles.primary}
          </SheetTitle>
          {titles.secondary ? (
            <p dir="auto" className="text-start text-sm text-muted-foreground">
              {titles.secondary}
            </p>
          ) : null}
        </SheetHeader>

        {doc ? (
          <div className="mt-3">
            <ClassificationChips category={doc.category} docType={doc.doc_type} />
          </div>
        ) : null}

        {/* Toolbar — read-only actions only */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="default"
            disabled={!downloadQuery.data}
            onClick={handleDownload}
          >
            <Download className="me-1.5 h-4 w-4" aria-hidden />
            {labels.preview.download}
          </Button>
          {documentId ? (
            <Button asChild type="button" size="sm" variant="outline">
              <Link href={`/lex/library/${documentId}`}>
                <Maximize2 className="me-1.5 h-4 w-4" aria-hidden />
                {labels.preview.viewFullPage}
              </Link>
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!documentId}
            onClick={handleCopyLink}
          >
            <Link2 className="me-1.5 h-4 w-4" aria-hidden />
            {labels.preview.copyLink}
          </Button>
          {sourceUrl ? (
            <Button type="button" size="sm" variant="ghost" onClick={handleCopySource}>
              <Link2 className="me-1.5 h-4 w-4" aria-hidden />
              {labels.preview.copySource}
            </Button>
          ) : null}
        </div>

        {/* Metadata + integrity strip */}
        <div className="mt-3 grid gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-xs sm:grid-cols-2">
          <MetaRow label={labels.preview.authority}>
            <span dir="auto" className="text-foreground">
              {doc?.authority?.trim() || labels.preview.unavailable}
            </span>
          </MetaRow>
          <MetaRow label={labels.preview.jurisdiction}>
            <span dir="auto" className="text-foreground">
              {doc?.jurisdiction?.trim() || labels.preview.unavailable}
            </span>
          </MetaRow>
          {issued ? (
            <MetaRow label={labels.preview.issued}>
              <span dir="auto" className="tabular-nums text-foreground">
                {issued}
              </span>
            </MetaRow>
          ) : null}
          <MetaRow label={labels.preview.fileSize}>
            <span className="tabular-nums text-foreground">
              {typeof doc?.file_size_bytes === 'number'
                ? formatBytes(doc.file_size_bytes)
                : labels.preview.unavailable}
            </span>
          </MetaRow>
          <div className="flex min-w-0 items-center gap-1.5 sm:col-span-2">
            <Fingerprint className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="shrink-0 font-medium uppercase tracking-wide text-muted-foreground">
              {labels.preview.contentHash}:
            </span>
            {doc?.content_hash ? (
              <>
                <code className="truncate font-mono text-[11px] text-foreground">
                  {doc.content_hash}
                </code>
                <button
                  type="button"
                  onClick={handleCopyHash}
                  aria-label={labels.preview.copyHashAria}
                  className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Copy className="h-3.5 w-3.5" aria-hidden />
                </button>
              </>
            ) : (
              <span className="text-muted-foreground">{labels.preview.unavailable}</span>
            )}
          </div>
        </div>

        {/* Viewer */}
        <div className="mt-4">
          <PdfViewer
            url={objectUrl}
            fileName={fileName}
            dir={direction === 'rtl' ? 'rtl' : 'ltr'}
            height={520}
            loading={loadingBytes}
            command={command}
            labels={labels.viewer}
            onDownload={handleDownload}
          />
        </div>

        {/* Description */}
        {doc && (locale === 'ar' ? doc.description_ar : doc.description_en)?.trim() ? (
          <>
            <Separator className="my-5" />
            <div>
              <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {labels.preview.description}
              </h3>
              <p dir="auto" className="text-sm leading-6 text-foreground">
                {locale === 'ar' ? doc.description_ar : doc.description_en}
              </p>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="shrink-0 font-medium uppercase tracking-wide text-muted-foreground">
        {label}:
      </span>
      {children}
    </div>
  );
}
