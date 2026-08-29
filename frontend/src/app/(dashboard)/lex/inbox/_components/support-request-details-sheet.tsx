'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, RefreshCw } from 'lucide-react';

import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { useLexFormat } from '@/lib/lex/ksa';
import {
  lexSupportApi,
  type LexSupportParty,
  type LexSupportRequest,
  type LexSupportSubjectType,
} from '@/lib/lex/support';
import { useSupportLabels } from '../_lib/support-i18n';

const SUBJECT_ROUTES: Record<LexSupportSubjectType, string> = {
  case: '/lex/cases',
  contract: '/lex/contracts',
  consultation: '/lex/consultations',
  matter: '/lex/matters',
  investigation: '/lex/investigations',
  request: '/lex/service-desk',
};

export function supportSubjectHref(request: LexSupportRequest): string | null {
  if (!request.subject_type || !request.subject_id) return null;
  return `${SUBJECT_ROUTES[request.subject_type]}/${request.subject_id}`;
}

function partyName(person?: LexSupportParty | null): string {
  return person ? [person.first_name, person.last_name].filter(Boolean).join(' ').trim() : '';
}

function initials(person?: LexSupportParty | null): string {
  if (!person) return '—';
  return [person.first_name, person.last_name]
    .filter(Boolean)
    .map((part) => part.slice(0, 1))
    .join('')
    .slice(0, 2)
    .toUpperCase() || '—';
}

export function SupportRequestDetailsSheet({
  request,
  onOpenChange,
}: {
  request: LexSupportRequest | null;
  onOpenChange: (open: boolean) => void;
}) {
  const labels = useSupportLabels();
  const { locale, direction } = useLocaleOrDefault();
  const format = useLexFormat();
  const detailQuery = useQuery({
    queryKey: ['lex-support-request-detail', request?.id],
    queryFn: () => lexSupportApi.get(request!.id),
    enabled: Boolean(request),
    initialData: request ?? undefined,
    staleTime: 0,
    retry: false,
  });
  const detail = detailQuery.data ?? request;
  const href = detail ? supportSubjectHref(detail) : null;
  const entityName = detail?.target_entity
    ? (locale === 'ar' ? detail.target_entity.name.ar : detail.target_entity.name.en)
      || detail.target_entity.name.en
      || detail.target_entity.name.ar
    : '';

  return (
    <Sheet open={Boolean(request)} onOpenChange={onOpenChange}>
      <SheetContent
        side={direction === 'rtl' ? 'left' : 'right'}
        dir={direction}
        lang={locale}
        className="w-[calc(100vw-1rem)] sm:max-w-lg"
      >
        <SheetHeader className="text-start">
          <SheetTitle>{labels.details.title}</SheetTitle>
          <SheetDescription>{labels.details.description}</SheetDescription>
        </SheetHeader>

        {!detail && detailQuery.isLoading ? (
          <div className="mt-6" aria-busy="true" aria-label={labels.details.loading}>
            <Skeleton.Table rows={5} cols={1} />
          </div>
        ) : null}

        {detailQuery.isError ? (
          <div role="alert" className="mt-6 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            <p>{labels.details.error}</p>
            <Button type="button" variant="secondary" size="sm" className="mt-3 gap-2" onClick={() => detailQuery.refetch()}>
              <RefreshCw className="h-4 w-4" aria-hidden />
              {labels.retry}
            </Button>
          </div>
        ) : null}

        {detail ? (
          <div className="mt-6 space-y-6">
            <div>
              <div className="flex flex-wrap gap-2">
                <span className="badge-base badge-neutral text-foreground">{labels.status[detail.status]}</span>
                <span className="badge-base badge-neutral text-foreground">{labels.priority[detail.priority]}</span>
              </div>
              <h3 className="mt-3 break-words text-lg font-semibold text-foreground">{detail.subject}</h3>
            </div>

            <section aria-labelledby="support-detail-body">
              <h4 id="support-detail-body" className="text-sm font-semibold text-foreground">{labels.details.body}</h4>
              <p className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-muted/40 p-4 text-sm text-foreground">
                {detail.body || labels.details.noBody}
              </p>
            </section>

            <dl className="grid gap-4 text-sm sm:grid-cols-2">
              <DetailPerson label={labels.details.requester} person={detail.requester} fallback={labels.unknownColleague} />
              <DetailPerson label={labels.details.assignee} person={detail.assignee} fallback={labels.unknownColleague} />
              {entityName ? <DetailValue label={labels.details.targetEntity} value={entityName} /> : null}
              <DetailValue label={labels.details.createdAt} value={format.formatDate(detail.created_at, { dateStyle: 'medium', timeStyle: 'short' })} />
              <DetailValue label={labels.details.expiresAt} value={detail.expires_at ? format.formatDate(detail.expires_at, { dateStyle: 'medium', timeStyle: 'short' }) : labels.noDeadline} />
              {detail.accepted_at ? <DetailValue label={labels.details.acceptedAt} value={format.formatDate(detail.accepted_at, { dateStyle: 'medium', timeStyle: 'short' })} /> : null}
              {detail.closed_at ? <DetailValue label={labels.details.closedAt} value={format.formatDate(detail.closed_at, { dateStyle: 'medium', timeStyle: 'short' })} /> : null}
            </dl>

            {detail.resolution_note ? (
              <section aria-labelledby="support-detail-resolution">
                <h4 id="support-detail-resolution" className="text-sm font-semibold text-foreground">{labels.details.resolutionNote}</h4>
                <p className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-muted/40 p-4 text-sm text-foreground">{detail.resolution_note}</p>
              </section>
            ) : null}

            {href && detail.subject_type ? (
              <section aria-labelledby="support-detail-linked">
                <h4 id="support-detail-linked" className="text-sm font-semibold text-foreground">{labels.details.linkedRecord}</h4>
                <Button asChild variant="secondary" className="mt-2 w-full justify-between gap-2">
                  <Link href={href}>
                    <span>{labels.details.openLinkedRecord(labels.subjectType[detail.subject_type])}</span>
                    <ExternalLink className="h-4 w-4 shrink-0" aria-hidden />
                  </Link>
                </Button>
              </section>
            ) : null}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function DetailValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words font-medium text-foreground">{value}</dd>
    </div>
  );
}

function DetailPerson({
  label,
  person,
  fallback,
}: {
  label: string;
  person?: LexSupportParty | null;
  fallback: string;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-1 flex items-center gap-2 font-medium text-foreground">
        <Avatar className="h-7 w-7">
          {person?.avatar_url ? <AvatarImage src={person.avatar_url} alt="" /> : null}
          <AvatarFallback className="text-xs">{initials(person)}</AvatarFallback>
        </Avatar>
        <span className="min-w-0 truncate">{partyName(person) || fallback}</span>
      </dd>
    </div>
  );
}
