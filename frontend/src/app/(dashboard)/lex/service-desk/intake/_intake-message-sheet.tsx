'use client';

/**
 * Intake message detail side-sheet for the Legal Service Desk triage queue.
 *
 * Opens from a row click on the intake page and renders the full message
 * (from / to / subject / status / received / mailbox / attachment count /
 * linked-request link). When the operator has `lex:write` it offers a
 * "Create request from this message" action that deep-links to the new-request
 * wizard. Wizard-side prefill from this message is a follow-up (the wizard does
 * not yet read query params).
 */

import { useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, FilePlus2, Mail, Paperclip } from 'lucide-react';
import { RelativeTime } from '@/components/shared/relative-time';
import { StatusBadge } from '@/components/shared/status-badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useAuth } from '@/hooks/use-auth';
import { useLocale } from '@/components/providers/locale-provider';
import { formatDateTime } from '@/lib/utils';
import { lexRequestsApi, type IntakeMessage } from '@/lib/lex/requests';
import type { StatusConfig } from '@/lib/status-configs';
import { formatIntakeToken, useIntakeLabels } from './_labels';

interface IntakeMessageSheetProps {
  message: IntakeMessage | null;
  statusConfig: StatusConfig;
  onClose: () => void;
}

interface DetailRowProps {
  label: string;
  children: React.ReactNode;
}

function DetailRow({ label, children }: DetailRowProps) {
  return (
    <div className="grid grid-cols-[7rem,1fr] gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words font-medium">{children}</span>
    </div>
  );
}

export function IntakeMessageSheet({ message, statusConfig, onClose }: IntakeMessageSheetProps) {
  const router = useRouter();
  const { hasPermission } = useAuth();
  const { locale, direction } = useLocale();
  const labels = useIntakeLabels();
  const t = labels.sheet;
  // §9 — converting intake into a request is a request add action.
  const canWrite = hasPermission('lex:request:add');

  // Hydrate with the freshest record while keeping the row data as a placeholder.
  const detailQuery = useQuery({
    queryKey: ['lex-intake-message', message?.id],
    queryFn: () => lexRequestsApi.getIntakeMessage(message?.id ?? ''),
    enabled: Boolean(message?.id),
    staleTime: 60_000,
  });

  const record = detailQuery.data ?? message;

  const statusLabel = useMemo(
    () =>
      record
        ? statusConfig[record.status]?.label ?? formatIntakeToken(record.status)
        : '',
    [record, statusConfig],
  );

  const attachmentCount = record?.attachment_file_ids?.length ?? 0;
  const open = Boolean(message);

  return (
    <Sheet open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <SheetContent
        side={direction === 'rtl' ? 'left' : 'right'}
        dir={direction}
        lang={locale}
        className="flex w-full flex-col gap-0 p-0 sm:max-w-md"
      >
        <SheetHeader className="space-y-1.5 border-b p-6 text-start">
          <SheetTitle className="flex items-center gap-2">
            <Mail className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            {t.title}
          </SheetTitle>
          <SheetDescription>{t.description}</SheetDescription>
        </SheetHeader>

        {record ? (
          <ScrollArea className="flex-1">
            <div className="space-y-6 p-6">
              <section className="space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t.sectionMessage}
                </h3>
                <DetailRow label={t.subject}>
                  {record.subject?.trim() || labels.noSubject}
                </DetailRow>
                <DetailRow label={t.from}>{record.from_address}</DetailRow>
                <DetailRow label={t.to}>{record.to_address}</DetailRow>
                <DetailRow label={t.status}>
                  <StatusBadge status={record.status} config={statusConfig} size="sm" />
                  <span className="sr-only">{statusLabel}</span>
                </DetailRow>
                <DetailRow label={t.received}>
                  <span className="inline-flex items-center gap-2">
                    <RelativeTime date={record.created_at} />
                    <span className="text-xs text-muted-foreground">
                      {formatDateTime(record.created_at)}
                    </span>
                  </span>
                </DetailRow>
                <DetailRow label={t.attachments}>
                  <span className="inline-flex items-center gap-1.5">
                    <Paperclip className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                    {labels.attachmentsCount(attachmentCount)}
                  </span>
                </DetailRow>
              </section>

              <Separator />

              <section className="space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t.sectionRouting}
                </h3>
                <DetailRow label={t.mailbox}>
                  {record.mailbox_id ? (
                    <span className="font-mono text-xs">{record.mailbox_id}</span>
                  ) : (
                    <span className="text-muted-foreground">{t.mailboxNone}</span>
                  )}
                </DetailRow>
                <DetailRow label={t.linkedRequest}>
                  {record.legal_request_id ? (
                    <Link
                      href={`/lex/service-desk/${record.legal_request_id}`}
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                    >
                      {t.viewRequest}
                      <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">{t.notLinked}</span>
                  )}
                </DetailRow>
              </section>
            </div>
          </ScrollArea>
        ) : null}

        {canWrite && record && !record.legal_request_id ? (
          <div className="border-t p-6">
            <Button
              className="w-full"
              onClick={() => router.push('/lex/service-desk/new')}
            >
              <FilePlus2 className="me-1.5 h-4 w-4" />
              {t.createRequest}
            </Button>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
