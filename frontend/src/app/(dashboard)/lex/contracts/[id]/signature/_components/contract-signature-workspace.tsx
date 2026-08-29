'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  FileSignature,
  LockKeyhole,
  XCircle,
} from 'lucide-react';

import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/hooks/use-auth';
import { enterpriseApi } from '@/lib/enterprise';
import { showApiError, showInfo, showSuccess } from '@/lib/toast';
import { cn } from '@/lib/utils';
import type {
  LexContractRecord,
  LexSignatureRecipient,
} from '@/types/suites';
import { useSignatureWorkspaceLabels } from '../_lib/signature-workspace-labels';

interface ContractSignatureWorkspaceProps {
  contractId: string;
}

const TERMINAL_STATUSES = new Set(['signed', 'declined', 'expired', 'cancelled']);

export function ContractSignatureWorkspace({ contractId }: ContractSignatureWorkspaceProps) {
  const labels = useSignatureWorkspaceLabels();
  const { locale } = useLocaleOrDefault();
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('lex:contract:edit');
  const router = useRouter();
  const queryClient = useQueryClient();
  const [cancelOpen, setCancelOpen] = useState(false);

  const contractQuery = useQuery({
    queryKey: ['lex-contract', contractId],
    queryFn: () => enterpriseApi.lex.getContract(contractId),
    enabled: Boolean(contractId),
  });
  const signaturesQuery = useQuery({
    queryKey: ['lex-contract-signatures', contractId],
    queryFn: () =>
      enterpriseApi.lex.listSignatures({
        page: 1,
        per_page: 25,
        sort: 'updated_at',
        order: 'desc',
        filters: { contract_id: contractId },
      }),
    enabled: Boolean(contractId),
  });

  const envelope = signaturesQuery.data?.data?.[0] ?? null;
  const recipients = useMemo(
    () =>
      [...(envelope?.recipients ?? [])].sort(
        (left, right) => left.signing_order - right.signing_order,
      ),
    [envelope?.recipients],
  );
  const pendingCount = recipients.filter(
    (recipient) => !TERMINAL_STATUSES.has(String(recipient.status)),
  ).length;

  const cancelMutation = useMutation({
    mutationFn: (envelopeId: string) =>
      enterpriseApi.lex.cancelSignature(envelopeId, {
        reason:
          locale === 'ar'
            ? 'تم الإلغاء من مساحة توقيع العقد'
            : 'Cancelled from the contract signature workspace',
      }),
    onSuccess: async () => {
      setCancelOpen(false);
      showSuccess(labels.management.cancelledTitle, labels.management.cancelledDetail);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['lex-contract-signatures', contractId] }),
        queryClient.invalidateQueries({ queryKey: ['lex-signatures'] }),
      ]);
    },
    onError: showApiError,
  });

  if (contractQuery.isLoading || signaturesQuery.isLoading) {
    return (
      <div className="grid gap-6 lg:grid-cols-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} variant="card" />
        ))}
      </div>
    );
  }
  if (contractQuery.isError) {
    return (
      <ErrorState
        message={labels.errors.contract}
        error={contractQuery.error}
        onRetry={() => void contractQuery.refetch()}
      />
    );
  }
  if (signaturesQuery.isError) {
    return (
      <ErrorState
        message={labels.errors.signatures}
        error={signaturesQuery.error}
        onRetry={() => void signaturesQuery.refetch()}
      />
    );
  }

  const contract = contractQuery.data?.contract;
  if (!contract) {
    return <ErrorState message={labels.errors.contract} variant="notFound" />;
  }
  if (!envelope) {
    return (
      <div className="space-y-6">
        <h1 className="sr-only">{contract.title}</h1>
        <SignatureBreadcrumbs contract={contract} />
        <section className="rounded-2xl border border-clario-border bg-white shadow-sm">
          <EmptyState
            icon={FileSignature}
            title={labels.empty.title}
            description={labels.empty.description}
            className="[&_a]:!bg-success-700 [&_a]:!text-white [&_a:hover]:!bg-success-600"
            action={{
              label: labels.empty.create,
              href: `/lex/signatures?create=1&contract_id=${contract.id}`,
              icon: FileSignature,
            }}
          />
        </section>
      </div>
    );
  }

  const activeEnvelope = !TERMINAL_STATUSES.has(String(envelope.status));

  return (
    <div className="space-y-5 text-clario-ink">
      <SignatureBreadcrumbs contract={contract} />

      <div
        dir="ltr"
        className="grid items-start gap-6 xl:grid-cols-[minmax(19rem,0.72fr)_minmax(32rem,1.3fr)]"
      >
        <div dir={locale === 'ar' ? 'rtl' : 'ltr'} className="space-y-6 xl:order-1">
          <section className="rounded-2xl border border-clario-border bg-white p-6 shadow-sm">
            <h2 className="text-base font-bold">{labels.workflow.title}</h2>
            <div className="mt-5">
              {recipients.length ? (
                recipients.map((recipient, index) => (
                  <RecipientTimelineItem
                    key={recipient.id}
                    recipient={recipient}
                    isLast={index === recipients.length - 1}
                  />
                ))
              ) : (
                <p className="text-sm text-clario-muted">{labels.workflow.notSent}</p>
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-clario-border bg-white p-6 shadow-sm">
            <h2 className="text-base font-bold">{labels.management.title}</h2>
            <div className="mt-4 grid gap-3">
              <Button
                className="w-full"
                disabled={!canWrite || pendingCount === 0 || !activeEnvelope}
                onClick={() => {
                  if (pendingCount === 0) {
                    showInfo(
                      labels.management.noReminderTitle,
                      labels.management.noReminderDetail,
                    );
                    return;
                  }
                  showInfo(
                    labels.management.reminderReadyTitle,
                    labels.management.reminderReadyDetail(pendingCount),
                  );
                  router.push(`/lex/signatures?contract_id=${contractId}`);
                }}
              >
                {labels.management.reminder}
              </Button>
              <Button
                variant="outline"
                className="w-full"
                disabled={!canWrite || !activeEnvelope}
                onClick={() => setCancelOpen(true)}
              >
                {labels.management.cancel}
              </Button>
            </div>
          </section>
        </div>

        <div dir={locale === 'ar' ? 'rtl' : 'ltr'} className="space-y-6 xl:order-2">
          <section className="rounded-2xl border border-clario-border bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h1 className="text-xl font-bold">{contract.title}</h1>
                <p className="mt-3 max-w-4xl text-sm leading-6 text-clario-muted">
                  {contract.description || labels.document.locked}
                </p>
              </div>
              <span className="text-sm text-clario-muted">
                {contract.contract_number || contract.id.slice(0, 12)}
              </span>
            </div>
          </section>

          {locale === 'ar' ? (
            <ArabicDocumentPreview recipients={recipients} />
          ) : (
            <EnglishDocumentPreview contract={contract} recipients={recipients} />
          )}
        </div>
      </div>

      <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <AlertDialogContent dir={locale === 'ar' ? 'rtl' : 'ltr'}>
          <AlertDialogHeader>
            <AlertDialogTitle>{labels.management.cancelTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {labels.management.cancelDescription}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{labels.management.cancelBack}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={cancelMutation.isPending}
              onClick={(event) => {
                event.preventDefault();
                cancelMutation.mutate(envelope.id);
              }}
            >
              {labels.management.cancelConfirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SignatureBreadcrumbs({ contract }: { contract: LexContractRecord }) {
  const labels = useSignatureWorkspaceLabels();
  return (
    <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 text-sm">
      <Link href="/lex" className="text-clario-muted hover:text-clario-primary">
        {labels.breadcrumbs.home}
      </Link>
      <ChevronRight className="h-3.5 w-3.5 text-clario-muted rtl:rotate-180" aria-hidden />
      <Link href="/lex/contracts" className="text-clario-muted hover:text-clario-primary">
        {labels.breadcrumbs.contracts}
      </Link>
      <ChevronRight className="h-3.5 w-3.5 text-clario-muted rtl:rotate-180" aria-hidden />
      <Link
        href={`/lex/contracts/${contract.id}`}
        className="text-clario-muted hover:text-clario-primary"
      >
        {contract.contract_number || contract.id.slice(0, 12)}
      </Link>
      <ChevronRight className="h-3.5 w-3.5 text-clario-muted rtl:rotate-180" aria-hidden />
      <span className="font-bold">{labels.breadcrumbs.signature}</span>
    </nav>
  );
}

function RecipientTimelineItem({
  recipient,
  isLast,
}: {
  recipient: LexSignatureRecipient;
  isLast: boolean;
}) {
  const labels = useSignatureWorkspaceLabels();
  const { locale } = useLocaleOrDefault();
  const status = String(recipient.status);
  const signed = status === 'signed';
  const waiting = status === 'sent' || status === 'viewed';
  const failed = ['declined', 'expired', 'cancelled'].includes(status);
  const Icon = signed ? Check : waiting ? Clock3 : failed ? XCircle : LockKeyhole;
  const statusLabel = signed
    ? labels.workflow.signed
    : waiting
      ? labels.workflow.awaiting
      : failed
        ? labels.workflow.unsuccessful
        : labels.workflow.notSent;
  const timestamp = signed
    ? recipient.signed_at
    : waiting
      ? recipient.viewed_at ?? recipient.updated_at
      : null;

  return (
    <div className="grid grid-cols-[28px_minmax(0,1fr)] gap-3">
      <div className="flex flex-col items-center">
        <span
          className={cn(
            'grid h-7 w-7 place-items-center rounded-full',
            signed && 'bg-success-50 text-success-700',
            waiting && 'bg-warning-50 text-warning-700',
            failed && 'bg-destructive/10 text-destructive',
            !signed && !waiting && !failed && 'bg-clario-tint text-clario-muted',
          )}
        >
          <Icon className="h-4 w-4" aria-hidden />
        </span>
        {!isLast ? <span className="h-10 w-px bg-clario-border" aria-hidden /> : null}
      </div>
      <div className={cn('min-w-0 pb-4', isLast && 'pb-0')}>
        <div className="flex items-center justify-between gap-3">
          <p className="truncate text-sm font-bold">{recipient.name}</p>
          <span
            className={cn(
              'shrink-0 rounded px-2 py-0.5 text-[11px] font-bold',
              signed && 'bg-success-50 text-success-700',
              waiting && 'bg-warning-50 text-warning-700',
              failed && 'bg-destructive/10 text-destructive',
              !signed && !waiting && !failed && 'bg-clario-tint text-clario-muted',
            )}
          >
            {statusLabel}
          </span>
        </div>
        <p className="mt-1 text-xs text-clario-muted">{recipient.role || '—'}</p>
        <p className="mt-1 text-[11px] text-clario-muted">
          {timestamp
            ? signed
              ? labels.workflow.signedAt(formatDateTime(timestamp, locale))
              : labels.workflow.sentAt(formatDateTime(timestamp, locale))
            : labels.workflow.pending}
        </p>
      </div>
    </div>
  );
}

function EnglishDocumentPreview({
  contract,
  recipients,
}: {
  contract: LexContractRecord;
  recipients: LexSignatureRecipient[];
}) {
  const labels = useSignatureWorkspaceLabels();
  const first = recipients[0];
  const second = recipients[1];
  return (
    <section className="rounded-2xl border border-clario-border bg-white p-6 shadow-sm sm:p-8">
      <h2 className="text-sm font-bold uppercase tracking-wide">{labels.document.witness}</h2>
      <p className="mt-3 text-sm leading-6 text-clario-muted">
        {trimDocumentText(contract.document_text) || labels.document.witnessBody}
      </p>
      <div className="my-4 h-px bg-clario-border" />
      <div className="grid gap-5 md:grid-cols-2">
        <SignatureBlock
          label={labels.document.firstParty}
          signer={first}
          fallback={contract.owner_name}
          completed
          helper={labels.document.representative}
        />
        <SignatureBlock
          label={labels.document.secondParty}
          signer={second}
          fallback={contract.party_b_name}
          completed={second?.status === 'signed'}
          helper={labels.document.authority}
        />
      </div>
    </section>
  );
}

function SignatureBlock({
  label,
  signer,
  fallback,
  completed,
  helper,
}: {
  label: string;
  signer?: LexSignatureRecipient;
  fallback: string;
  completed: boolean;
  helper: string;
}) {
  const labels = useSignatureWorkspaceLabels();
  const name = signer?.name || fallback;
  return (
    <div className="rounded-lg border border-clario-border bg-clario-tint/60 p-4">
      <p className="text-xs font-bold text-clario-muted">{label}</p>
      <p
        className={cn(
          'mt-4 border-b border-clario-border pb-3 text-xl',
          completed ? 'text-success-700' : 'text-warning-700',
        )}
      >
        {completed ? name : labels.document.awaitingSigner(name)}
      </p>
      <p className="mt-3 text-xs text-clario-muted">{helper}</p>
    </div>
  );
}

function ArabicDocumentPreview({ recipients }: { recipients: LexSignatureRecipient[] }) {
  const labels = useSignatureWorkspaceLabels();
  return (
    <section className="rounded-2xl border border-clario-border bg-white p-6 shadow-sm sm:p-8">
      <h2 className="text-center text-sm font-bold">{labels.document.preparedPreview}</h2>
      <div className="mt-5 grid justify-center gap-4 sm:grid-cols-2">
        <MockDocumentPage
          completed
          label={labels.document.firstPartySigned}
          signer={recipients[0]?.name}
        />
        <MockDocumentPage
          completed={recipients[1]?.status === 'signed'}
          label={labels.document.secondPartySignHere}
          signer={recipients[1]?.name}
        />
      </div>
    </section>
  );
}

function MockDocumentPage({
  completed,
  label,
  signer,
}: {
  completed: boolean;
  label: string;
  signer?: string;
}) {
  return (
    <div className="mx-auto min-h-80 w-full max-w-60 rounded-lg border border-clario-border bg-clario-tint/50 p-4">
      <div className="space-y-3">
        <div className="h-1.5 w-full bg-clario-border" />
        <div className="h-1.5 w-4/5 bg-clario-border" />
        <div className="h-1.5 w-11/12 bg-clario-border" />
        <div className="h-1.5 w-2/3 bg-clario-border" />
      </div>
      <div
        className={cn(
          'mt-8 grid min-h-24 place-items-center rounded-md border p-3 text-center text-xs font-bold',
          completed
            ? 'border-success-500 bg-success-50 text-success-700'
            : 'border-dashed border-status-info/40 bg-status-info/10 text-status-info',
        )}
      >
        <div>
          {completed ? (
            <CheckCircle2 className="mx-auto mb-2 h-6 w-6" aria-hidden />
          ) : (
            <FileSignature className="mx-auto mb-2 h-6 w-6" aria-hidden />
          )}
          <p>{label}</p>
          {signer ? <p className="mt-1 font-normal">{signer}</p> : null}
        </div>
      </div>
    </div>
  );
}

function trimDocumentText(value: string) {
  const text = value.trim().replace(/\s+/g, ' ');
  if (text.length <= 360) return text;
  return `${text.slice(0, 357)}…`;
}

function formatDateTime(value: string, locale: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-SA' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}
