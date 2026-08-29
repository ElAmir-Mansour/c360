'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, Eye, FileText, Loader2, Paperclip, ShieldCheck, ShieldX } from 'lucide-react';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { SectionCard } from '@/components/suites/section-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useLocale } from '@/components/providers/locale-provider';
import { downloadBlob, formatBytes } from '@/lib/format';
import { lexRequestsApi, type LegalRequestAttachment } from '@/lib/lex/requests';
import { showApiError } from '@/lib/toast';
import { ReviewRoundSeparator } from './review-round-separator';
import { groupByReviewRound, hasMultipleRounds } from './review-rounds';

interface AttachmentReviewState {
  loading: boolean;
  error: boolean;
  ready: boolean;
  count: number;
}

interface RequestAttachmentsPanelProps {
  requestId: string;
  onReviewStateChange?: (state: AttachmentReviewState) => void;
  title?: string;
}

const COPY = {
  en: {
    title: 'Documents and attachments',
    description: 'Evidence submitted with this request. Approval is tied to these exact file versions.',
    empty: 'No documents were submitted with this request.',
    preview: 'Preview',
    download: 'Download',
    clean: 'Security scan passed',
    unavailable: 'Unavailable for review',
    version: (value: number) => `Version ${value}`,
    slot: 'Document slot',
  },
  ar: {
    title: 'المستندات والمرفقات',
    description: 'الأدلة المقدمة مع هذا الطلب. ترتبط الموافقة بهذه الإصدارات المحددة من الملفات.',
    empty: 'لم تُقدَّم مستندات مع هذا الطلب.',
    preview: 'معاينة',
    download: 'تنزيل',
    clean: 'اجتاز الفحص الأمني',
    unavailable: 'غير متاح للمراجعة',
    version: (value: number) => `الإصدار ${value}`,
    slot: 'نوع المستند',
  },
} as const;

function isClean(attachment: LegalRequestAttachment): boolean {
  return attachment.virus_scan_status.trim().toLowerCase() === 'clean';
}

export function RequestAttachmentsPanel({
  requestId,
  onReviewStateChange,
  title,
}: RequestAttachmentsPanelProps) {
  const { locale } = useLocale();
  const copy = locale === 'ar' ? COPY.ar : COPY.en;
  const [busyId, setBusyId] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ['lex-request-attachments', requestId],
    queryFn: () => lexRequestsApi.listRequestAttachments(requestId),
    enabled: Boolean(requestId),
    retry: false,
  });
  const attachments = useMemo(() => query.data ?? [], [query.data]);

  // Uploads are grouped by the review round they arrived in, so a file sent back
  // on the third round is attributable to that round. Separators appear only once
  // the request has actually been returned at least once.
  const attachmentRounds = useMemo(() => groupByReviewRound(attachments), [attachments]);
  const showRounds = hasMultipleRounds(attachmentRounds);
  const currentRound =
    attachmentRounds.length > 0 ? attachmentRounds[attachmentRounds.length - 1].cycle : 1;
  const ready = useMemo(() => attachments.every(isClean), [attachments]);

  useEffect(() => {
    onReviewStateChange?.({
      loading: query.isLoading,
      error: query.isError,
      ready: !query.isLoading && !query.isError && ready,
      count: attachments.length,
    });
  }, [attachments.length, onReviewStateChange, query.isError, query.isLoading, ready]);

  const preview = async (attachment: LegalRequestAttachment) => {
    const popup = window.open('about:blank', '_blank');
    if (popup) popup.opener = null;
    setBusyId(attachment.id);
    try {
      const { blob } = await lexRequestsApi.getRequestAttachmentContent(
        requestId,
        attachment.id,
        'inline',
      );
      const url = URL.createObjectURL(blob);
      if (popup) popup.location.href = url;
      else window.open(url, '_blank', 'noopener,noreferrer');
      window.setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000);
    } catch (error) {
      popup?.close();
      showApiError(error);
    } finally {
      setBusyId(null);
    }
  };

  const download = async (attachment: LegalRequestAttachment) => {
    setBusyId(attachment.id);
    try {
      const result = await lexRequestsApi.getRequestAttachmentContent(
        requestId,
        attachment.id,
        'attachment',
      );
      downloadBlob(result.blob, result.filename || attachment.original_name);
    } catch (error) {
      showApiError(error);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <SectionCard
      title={title ?? copy.title}
      description={copy.description}
      isLoading={query.isLoading}
      loadingVariant="list-item"
      loadingCount={2}
    >
      {query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : attachments.length === 0 ? (
        <EmptyState icon={Paperclip} title={copy.empty} description="" />
      ) : (
        <div className="space-y-2">
          {attachmentRounds.map((round) => (
            <Fragment key={round.cycle}>
              {showRounds ? (
                <ReviewRoundSeparator
                  as="div"
                  cycle={round.cycle}
                  isCurrent={round.cycle === currentRound}
                />
              ) : null}
              {round.items.map((attachment) => {
            const clean = isClean(attachment);
            const busy = busyId === attachment.id;
            return (
              <div
                key={attachment.id}
                className="flex flex-col gap-3 rounded-lg border border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                    <FileText className="h-4 w-4" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium" title={attachment.original_name}>
                      {attachment.original_name}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {formatBytes(attachment.size_bytes)} · {copy.version(attachment.file_version)}
                      {attachment.slot_key ? ` · ${copy.slot}: ${attachment.slot_key}` : ''}
                    </p>
                    <Badge
                      variant={clean ? 'success' : 'destructive'}
                      className="mt-2 inline-flex items-center gap-1"
                    >
                      {clean ? <ShieldCheck className="h-3 w-3" /> : <ShieldX className="h-3 w-3" />}
                      {clean ? copy.clean : copy.unavailable}
                    </Badge>
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!clean || busy}
                    onClick={() => void preview(attachment)}
                  >
                    {busy ? <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" /> : <Eye className="me-1.5 h-3.5 w-3.5" />}
                    {copy.preview}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!clean || busy}
                    onClick={() => void download(attachment)}
                  >
                    <Download className="me-1.5 h-3.5 w-3.5" />
                    {copy.download}
                  </Button>
                </div>
              </div>
            );
              })}
            </Fragment>
          ))}
        </div>
      )}
    </SectionCard>
  );
}
