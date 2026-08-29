'use client';

/**
 * Reference-library document detail — shareable, deep-linkable single-document
 * page. Layout follows the lex detail pattern: a flat hero band with a
 * nav/shareability toolbar, then a two-column body — the rich pdf.js viewer +
 * "about" + a scoped "ask about this document" on the left, and a sticky rail
 * (metadata/integrity + related documents) on the right.
 *
 * Deep-linking: `?page=<n>` and `?q=<term>` jump the viewer to a page and
 * highlight a term on load — so a copied link, a citation, or a contents-search
 * hit can land the reader exactly where the passage lives. The scoped Ask panel
 * is bound to this document (`docIds=[id]`); its citations command THIS viewer
 * rather than opening a new sheet.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  CalendarCheck,
  Download,
  ExternalLink,
  Fingerprint,
  Link2,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';
import { LexRouteGuard } from '../../_guards/lex-route-guard';
import { SectionCard } from '@/components/suites/section-card';
import { LexEmptyState } from '@/components/lex/empty-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { Button } from '@/components/ui/button';
import { useLocale } from '@/components/providers/locale-provider';
import { useLexFormat } from '@/lib/lex/ksa';
import { enterpriseApi } from '@/lib/enterprise';
import { formatBytes } from '@/lib/format';
import { isApiError } from '@/types/api';
import { showSuccess, showError } from '@/lib/toast';
import { resolveDocTitles } from '../_lib/library-helpers';
import { useLibraryLabels } from '../_lib/library-labels';
import { recordView } from '../_lib/recent-views';
import { ClassificationChips } from '../_components/reference-chips';
import { PdfViewer, type PdfViewerCommand } from '../_components/pdf/pdf-viewer';
import {
  AskLibraryPanel,
  type OpenDocumentOptions,
} from '../_components/ask-library-panel';
import { ArticleToc } from '../_components/article-toc';
import { RelatedDocuments } from './_components/related-documents';

export default function LexLibraryDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';
  const router = useRouter();
  const searchParams = useSearchParams();
  const labels = useLibraryLabels();
  const { direction, locale } = useLocale();
  const f = useLexFormat();

  const [objectUrl, setObjectUrl] = useState<string | undefined>();
  const [command, setCommand] = useState<PdfViewerCommand | undefined>();
  const nonceRef = useRef(0);
  const appliedUrlRef = useRef(false);

  const docQuery = useQuery({
    queryKey: ['lex-reference-doc', id],
    queryFn: () => enterpriseApi.lex.referenceLibrary.get(id),
    enabled: !!id,
    retry: (count, error) => !(isApiError(error) && error.status === 404) && count < 2,
  });

  const downloadQuery = useQuery({
    queryKey: ['lex-reference-download', id],
    queryFn: () => enterpriseApi.lex.referenceLibrary.download(id),
    enabled: !!id && !!docQuery.data,
  });

  // Blob → object URL for the inline viewer; revoked on change/unmount.
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

  // Record the visit for the client-local "recently viewed" rail.
  useEffect(() => {
    if (id && docQuery.data) recordView(id);
  }, [id, docQuery.data]);

  // Apply the `?page=` / `?q=` deep-link once (subsequent jumps come from Ask).
  useEffect(() => {
    if (appliedUrlRef.current || !searchParams) return;
    const rawPage = searchParams.get('page');
    const parsedPage = rawPage ? Number.parseInt(rawPage, 10) : NaN;
    const term = (searchParams.get('q') ?? searchParams.get('highlight') ?? '').trim();
    const hasPage = Number.isFinite(parsedPage) && parsedPage > 0;
    if (hasPage || term) {
      nonceRef.current += 1;
      setCommand({
        page: hasPage ? parsedPage : undefined,
        term: term || undefined,
        nonce: nonceRef.current,
      });
    }
    appliedUrlRef.current = true;
  }, [searchParams]);

  const doc = docQuery.data;
  const titles = doc
    ? resolveDocTitles(doc, locale)
    : { primary: '', secondary: undefined };
  const fileName = doc ? `${titles.primary}.pdf` : 'document.pdf';
  const sourceUrl = doc?.source_url?.trim() || undefined;
  const issued = doc?.gregorian_date
    ? f.formatDual(doc.gregorian_date)
    : doc?.hijri_date || undefined;
  // "In force as of": prefer an explicit effective date, else the issue date.
  // When none is known we show an honest "confirm the current version" note
  // rather than implying a currency we cannot prove.
  const effectiveDate = doc?.effective_date?.trim()
    ? f.formatDual(doc.effective_date)
    : doc?.gregorian_date?.trim()
      ? f.formatDual(doc.gregorian_date)
      : doc?.hijri_date?.trim() || undefined;
  const description = doc
    ? (locale === 'ar' ? doc.description_ar : doc.description_en)?.trim()
    : '';

  const notFound = isApiError(docQuery.error) && docQuery.error.status === 404;

  function jumpViewer(page?: number, snippet?: string) {
    nonceRef.current += 1;
    setCommand({ page, term: snippet, nonce: nonceRef.current });
  }

  const handleOpenDoc = (docId: string, opts?: OpenDocumentOptions) => {
    if (docId === id) jumpViewer(opts?.page, opts?.snippet);
    else router.push(`/lex/library/${docId}`);
  };

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

  async function copyLink() {
    if (typeof window === 'undefined') return;
    const link = `${window.location.origin}/lex/library/${id}`;
    try {
      await navigator.clipboard.writeText(link);
      showSuccess(labels.detail.linkCopied);
    } catch {
      showError(labels.detail.copyLinkFailed);
    }
  }

  const backLink = (
    <Button asChild type="button" variant="ghost" size="sm">
      <Link href="/lex/library">
        <ArrowLeft className="me-1.5 h-4 w-4" aria-hidden />
        {labels.detail.backToLibrary}
      </Link>
    </Button>
  );

  const metaRows = useMemo(
    () =>
      doc
        ? [
            { label: labels.detail.authority, value: doc.authority?.trim() },
            { label: labels.detail.jurisdiction, value: doc.jurisdiction?.trim() },
            { label: labels.detail.issued, value: issued },
            {
              label: labels.detail.fileSize,
              value:
                typeof doc.file_size_bytes === 'number'
                  ? formatBytes(doc.file_size_bytes)
                  : undefined,
            },
          ]
        : [],
    [doc, issued, labels.detail],
  );

  return (
    <LexRouteGuard route="/lex/library">
      <div dir={direction} lang={locale} className="space-y-4">
        {backLink}

        {docQuery.isLoading ? (
          <LoadingSkeleton variant="card" count={3} />
        ) : notFound || !doc ? (
          <LexEmptyState
            icon={Sparkles}
            title={labels.detail.notFoundTitle}
            description={labels.detail.notFoundDescription}
            action={{
              label: labels.detail.backToLibrary,
              onClick: () => router.push('/lex/library'),
            }}
          />
        ) : (
          <>
            {/* Hero band */}
            <div className="card flex flex-col gap-3 p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h1
                    dir="auto"
                    className="text-xl font-semibold text-foreground sm:text-2xl"
                  >
                    {titles.primary}
                  </h1>
                  {titles.secondary ? (
                    <p dir="auto" className="mt-0.5 text-sm text-muted-foreground">
                      {titles.secondary}
                    </p>
                  ) : null}
                  <div className="mt-2">
                    <ClassificationChips category={doc.category} docType={doc.doc_type} />
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="default"
                    onClick={handleDownload}
                    disabled={!downloadQuery.data}
                  >
                    <Download className="me-1.5 h-4 w-4" aria-hidden />
                    {labels.detail.download}
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={copyLink}>
                    <Link2 className="me-1.5 h-4 w-4" aria-hidden />
                    {labels.detail.copyLink}
                  </Button>
                  {objectUrl ? (
                    <Button asChild type="button" size="sm" variant="outline">
                      <a href={objectUrl} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="me-1.5 h-4 w-4" aria-hidden />
                        {labels.detail.openNewTab}
                      </a>
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>

            {/* Body */}
            <div className="grid gap-4 lg:grid-cols-3">
              <div className="space-y-4 lg:col-span-2">
                <SectionCard title={labels.detail.overview}>
                  <PdfViewer
                    url={objectUrl}
                    fileName={fileName}
                    dir={direction === 'rtl' ? 'rtl' : 'ltr'}
                    height={720}
                    loading={downloadQuery.isLoading}
                    command={command}
                    labels={labels.viewer}
                    onDownload={handleDownload}
                  />
                </SectionCard>

                {/* Article/مادة navigation — jumps the viewer; self-hides when empty. */}
                <ArticleToc
                  docId={id}
                  onJumpToPage={(page) => jumpViewer(page)}
                  dir={direction === 'rtl' ? 'rtl' : 'ltr'}
                />

                {description ? (
                  <SectionCard title={labels.detail.aboutDoc}>
                    <p dir="auto" className="text-sm leading-7 text-foreground">
                      {description}
                    </p>
                  </SectionCard>
                ) : null}
              </div>

              <div className="space-y-4">
                {/* Metadata + integrity */}
                <SectionCard title={labels.detail.metadata}>
                  <dl className="space-y-2.5 text-sm">
                    {metaRows.map((row) => (
                      <div key={row.label} className="flex items-start justify-between gap-3">
                        <dt className="shrink-0 text-muted-foreground">{row.label}</dt>
                        <dd dir="auto" className="min-w-0 text-end text-foreground">
                          {row.value || labels.detail.unavailable}
                        </dd>
                      </div>
                    ))}
                    {doc.tags.length > 0 ? (
                      <div className="flex items-start justify-between gap-3">
                        <dt className="shrink-0 text-muted-foreground">
                          {labels.detail.topics}
                        </dt>
                        <dd dir="auto" className="min-w-0 text-end text-foreground">
                          {doc.tags.join('، ')}
                        </dd>
                      </div>
                    ) : null}
                    {sourceUrl ? (
                      <div className="flex items-start justify-between gap-3">
                        <dt className="shrink-0 text-muted-foreground">
                          {labels.detail.source}
                        </dt>
                        <dd className="min-w-0 truncate text-end">
                          <a
                            href={sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline"
                          >
                            {labels.detail.openNewTab}
                          </a>
                        </dd>
                      </div>
                    ) : null}
                    {doc.content_hash ? (
                      <div className="flex items-center gap-1.5 border-t pt-2 text-xs">
                        <Fingerprint className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                        <span className="shrink-0 text-muted-foreground">
                          {labels.detail.contentHash}
                        </span>
                        <code className="truncate font-mono text-[11px] text-foreground">
                          {doc.content_hash}
                        </code>
                      </div>
                    ) : null}
                  </dl>

                  {/* "As-of" / version-currency trust affordance. */}
                  {effectiveDate ? (
                    <div className="mt-3 flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2">
                      <CalendarCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-foreground">
                          {labels.detail.asOf}
                        </p>
                        <p dir="auto" className="text-xs text-muted-foreground">
                          {effectiveDate}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2">
                      <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-foreground">
                          {labels.detail.confirmCurrencyTitle}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {labels.detail.confirmCurrencyNote}
                        </p>
                        {sourceUrl ? (
                          <a
                            href={sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                          >
                            <ExternalLink className="h-3 w-3" aria-hidden />
                            {labels.detail.confirmCurrencyLink}
                          </a>
                        ) : null}
                      </div>
                    </div>
                  )}
                </SectionCard>

                {/* Scoped Ask */}
                <SectionCard
                  title={
                    <span className="flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-primary" aria-hidden />
                      {labels.ask.scopedTitle(titles.primary)}
                    </span>
                  }
                >
                  <p className="mb-3 text-xs text-muted-foreground">
                    {labels.ask.scopedDescription}
                  </p>
                  <div className="h-[420px]">
                    <AskLibraryPanel docIds={[id]} onOpenDocument={handleOpenDoc} />
                  </div>
                </SectionCard>

                {/* Related */}
                <SectionCard
                  title={labels.detail.relatedTitle}
                  description={labels.detail.relatedDescription}
                >
                  <RelatedDocuments doc={doc} />
                </SectionCard>
              </div>
            </div>
          </>
        )}
      </div>
    </LexRouteGuard>
  );
}
