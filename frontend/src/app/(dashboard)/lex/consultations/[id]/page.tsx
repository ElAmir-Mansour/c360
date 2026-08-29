'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileCheck2, MoreHorizontal, Trash2 } from 'lucide-react';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { ErrorState } from '@/components/common/error-state';
import { PageHeader } from '@/components/common/page-header';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/hooks/use-auth';
import { AskForSupportButton } from '@/components/lex/support-composer';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { resolveLocalized } from '@/lib/i18n/localized';
import { showApiError, showSuccess } from '@/lib/toast';
import {
  type ArchiveConsultationPayload,
  type AttachConsultationDocumentPayload,
  type ClassifyConsultationPayload,
  type Consultation,
  type ConsultationDocument,
  type RouteConsultationPayload,
  type StartConsultationApprovalPayload,
  consultationsApi,
} from '@/lib/lex/consultations';
import { LexRouteGuard } from '../../_guards/lex-route-guard';
import { useConsultationLabels } from '../_components/labels';
import {
  ConsultationApprovalDialog,
  ConsultationArchiveDialog,
  ConsultationAttachDialog,
  ConsultationClassifyDialog,
  ConsultationRouteDialog,
} from '../_components/consultation-dialogs';
import { ConsultationLegalHoldBanner } from '../_components/consultation-legal-hold-banner';
import { ConsultationActionBar } from './_components/consultation-action-bar';
import { ConsultationDetailView } from './_components/consultation-detail-view';
import { useConsultationTypeLabel } from './_components/consultation-enums-i18n';
import { ConsultationToolbarNav } from './_components/consultation-toolbar-nav';

export default function LexConsultationDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const { locale, direction } = useLocaleOrDefault();
  const id = params?.id ?? '';
  const canWrite = hasPermission('lex:consultation:edit');
  const canApprove = hasPermission('lex:consultation:approve');
  // Support requests are raised from the record, not just the inbox/top bar.
  // Same verb the inbox uses for its own "Ask for support" entry point.
  const canAskSupport = hasPermission('lex:support:create');
  const labels = useConsultationLabels();
  const detailLabels = labels.detail;
  const typeLabelOf = useConsultationTypeLabel();

  const [classifyOpen, setClassifyOpen] = useState(false);
  const [routeOpen, setRouteOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [removeDocument, setRemoveDocument] =
    useState<ConsultationDocument | null>(null);

  const consultationQuery = useQuery({
    queryKey: ['lex-consultation', id],
    queryFn: () => consultationsApi.get(id),
    enabled: Boolean(id),
  });

  const auditQuery = useQuery({
    queryKey: ['lex-consultation-audit', id],
    queryFn: () => consultationsApi.listAudit(id),
    enabled: Boolean(id),
  });

  const refresh = async () => {
    await Promise.all([
      consultationQuery.refetch(),
      queryClient.invalidateQueries({ queryKey: ['lex-consultations'] }),
      queryClient.invalidateQueries({
        queryKey: ['lex-consultation-approval', id],
      }),
      queryClient.invalidateQueries({
        queryKey: ['lex-consultation-audit', id],
      }),
    ]);
  };

  const classifyMutation = useMutation({
    mutationFn: (payload: ClassifyConsultationPayload) =>
      consultationsApi.classify(id, payload),
    onSuccess: async () => {
      showSuccess(labels.toast.classified);
      setClassifyOpen(false);
      await refresh();
    },
    onError: showApiError,
  });

  const routeMutation = useMutation({
    mutationFn: (payload: RouteConsultationPayload) =>
      consultationsApi.route(id, payload),
    onSuccess: async () => {
      showSuccess(labels.toast.routed);
      setRouteOpen(false);
      await refresh();
    },
    onError: showApiError,
  });

  const archiveMutation = useMutation({
    mutationFn: (payload: ArchiveConsultationPayload) =>
      consultationsApi.archive(id, payload),
    onSuccess: async () => {
      showSuccess(labels.toast.archived);
      setArchiveOpen(false);
      await refresh();
    },
    onError: showApiError,
  });

  const attachMutation = useMutation({
    mutationFn: (payload: AttachConsultationDocumentPayload) =>
      consultationsApi.attachDocument(id, payload),
    onSuccess: async () => {
      showSuccess(labels.toast.documentAttached);
      setAttachOpen(false);
      await refresh();
    },
    onError: showApiError,
  });

  const detachMutation = useMutation({
    mutationFn: (documentId: string) =>
      consultationsApi.detachDocument(id, documentId),
    onSuccess: async () => {
      showSuccess(labels.toast.documentRemoved);
      setRemoveDocument(null);
      await refresh();
    },
    onError: showApiError,
  });

  const approvalMutation = useMutation({
    mutationFn: (payload: StartConsultationApprovalPayload) =>
      consultationsApi.startApproval(id, payload),
    onSuccess: async () => {
      showSuccess(labels.toast.approvalStarted);
      setApprovalOpen(false);
      await refresh();
    },
    onError: showApiError,
  });

  const deleteMutation = useMutation({
    mutationFn: () => consultationsApi.remove(id),
    onSuccess: async () => {
      showSuccess(labels.toast.deleted);
      await queryClient.invalidateQueries({ queryKey: ['lex-consultations'] });
      router.push('/lex/consultations');
    },
    onError: showApiError,
  });

  if (consultationQuery.isLoading) {
    return (
      <LexRouteGuard route="/lex/consultations/[id]">
        <div className="space-y-6" dir={direction} lang={locale}>
          <PageHeader
            title={detailLabels.loadingTitle}
            description={detailLabels.loadingDescription}
          />
          <div className="space-y-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} variant="card" />
            ))}
          </div>
        </div>
      </LexRouteGuard>
    );
  }

  if (consultationQuery.isError || !consultationQuery.data) {
    return (
      <LexRouteGuard route="/lex/consultations/[id]">
        <div className="space-y-6" dir={direction} lang={locale}>
          <PageHeader
            title={detailLabels.loadingTitle}
            description={detailLabels.fallbackDescription}
          />
          <ErrorState
            message={detailLabels.errorMessage}
            onRetry={() => void consultationQuery.refetch()}
          />
        </div>
      </LexRouteGuard>
    );
  }

  const consultation: Consultation = consultationQuery.data;
  const title =
    resolveLocalized(consultation.title, locale) ||
    consultation.consultation_number;
  const typeLabel = typeLabelOf(consultation.type);
  const onHold = consultation.legal_hold === true;
  const holdReason = onHold ? labels.legalHold.bannerMessage : undefined;
  const responseViewLabel =
    consultation.status === 'routed'
      ? locale === 'ar'
        ? 'إعداد الرد القانوني'
        : 'Prepare legal response'
      : locale === 'ar'
        ? 'عرض الرد القانوني'
        : 'View legal response';

  const toolbar = (
    <>
      <ConsultationToolbarNav
        consultationId={consultation.id}
        consultationNumber={consultation.consultation_number}
      />
      {consultation.status === 'routed' || consultation.response ? (
        <Button variant="outline" asChild>
          <Link href={`/lex/consultations/${consultation.id}/response`}>
            <FileCheck2 className="me-1.5 h-4 w-4" aria-hidden />
            {responseViewLabel}
          </Link>
        </Button>
      ) : null}
      {/*
        Context is passed EXPLICITLY rather than derived from the URL so the
        nested response route binds to this consultation too.
      */}
      {canAskSupport ? (
        <AskForSupportButton context={{ subjectType: 'consultation', subjectId: consultation.id }} />
      ) : null}
      {canWrite ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              aria-label={labels.rowActions.actions}
            >
              <MoreHorizontal className="h-4 w-4" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={() => setDeleteOpen(true)}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="me-2 h-3.5 w-3.5" aria-hidden />
              {detailLabels.delete}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </>
  );

  const actionPanel = (
    <div>
      <ConsultationActionBar
        consultation={consultation}
        canWrite={canWrite}
        canApprove={canApprove}
        onHold={onHold}
        onClassify={() => setClassifyOpen(true)}
        onRoute={() => setRouteOpen(true)}
        onRespond={() =>
          router.push(`/lex/consultations/${consultation.id}/response`)
        }
        onStartApproval={() => setApprovalOpen(true)}
        onArchive={() => setArchiveOpen(true)}
        onChanged={() => void refresh()}
      />
    </div>
  );

  return (
    <LexRouteGuard route="/lex/consultations/[id]">
      <div className="space-y-6" dir={direction} lang={locale}>
        <ConsultationLegalHoldBanner consultation={consultation} />

        <ConsultationDetailView
          consultation={consultation}
          title={title}
          typeLabel={typeLabel}
          audit={auditQuery.data ?? []}
          auditLoading={auditQuery.isLoading}
          canWrite={canWrite}
          onHold={onHold}
          holdReason={holdReason}
          onAttachDocument={() => setAttachOpen(true)}
          onRemoveDocument={setRemoveDocument}
          headerActions={toolbar}
          actionPanel={actionPanel}
        />

        {canWrite ? (
          <>
            <ConsultationClassifyDialog
              open={classifyOpen}
              currentType={consultation.type}
              currentPriority={consultation.priority}
              loading={classifyMutation.isPending}
              onOpenChange={setClassifyOpen}
              onSubmit={(payload) => classifyMutation.mutate(payload)}
            />
            <ConsultationRouteDialog
              open={routeOpen}
              loading={routeMutation.isPending}
              onOpenChange={setRouteOpen}
              onSubmit={(payload) => routeMutation.mutate(payload)}
            />
            <ConsultationArchiveDialog
              open={archiveOpen}
              loading={archiveMutation.isPending}
              onOpenChange={setArchiveOpen}
              onSubmit={(payload) => archiveMutation.mutate(payload)}
            />
            <ConsultationAttachDialog
              open={attachOpen}
              loading={attachMutation.isPending}
              onOpenChange={setAttachOpen}
              onSubmit={(payload) => attachMutation.mutate(payload)}
            />
            <ConfirmDialog
              open={deleteOpen}
              onOpenChange={setDeleteOpen}
              title={labels.confirm.deleteTitle}
              description={labels.confirm.deleteDescription(title)}
              confirmLabel={detailLabels.delete}
              variant="destructive"
              loading={deleteMutation.isPending}
              onConfirm={async () => {
                await deleteMutation.mutateAsync();
              }}
            />
            <ConfirmDialog
              open={Boolean(removeDocument)}
              onOpenChange={(open) => {
                if (!open) setRemoveDocument(null);
              }}
              title={labels.confirm.removeDocumentTitle}
              description={labels.confirm.removeDocumentDescription(
                removeDocument?.file_name ?? '',
              )}
              confirmLabel={labels.confirm.confirm}
              variant="destructive"
              loading={detachMutation.isPending}
              onConfirm={async () => {
                if (removeDocument) {
                  await detachMutation.mutateAsync(removeDocument.id);
                }
              }}
            />
          </>
        ) : null}

        {canApprove ? (
          <ConsultationApprovalDialog
            open={approvalOpen}
            loading={approvalMutation.isPending}
            onOpenChange={setApprovalOpen}
            onSubmit={(payload) => approvalMutation.mutate(payload)}
          />
        ) : null}
      </div>
    </LexRouteGuard>
  );
}
