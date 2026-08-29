'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ErrorState } from '@/components/common/error-state';
import { PageHeader } from '@/components/common/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { useAuth } from '@/hooks/use-auth';
import { resolveLocalized } from '@/lib/i18n/localized';
import {
  consultationsApi,
  type ArchiveConsultationPayload,
  type Consultation,
  type ConsultationApprovalDecisionPayload,
  type ConsultationApprovalTask,
  type RespondConsultationPayload,
  type StartConsultationApprovalPayload,
} from '@/lib/lex/consultations';
import { showApiError, showSuccess } from '@/lib/toast';
import { LexRouteGuard } from '../../../_guards/lex-route-guard';
import {
  ConsultationApprovalDialog,
  ConsultationArchiveDialog,
} from '../../_components/consultation-dialogs';
import { ConsultationResponseWorkspace } from './_components/consultation-response-workspace';
import { useConsultationResponseCopy } from './_components/response-copy';

const CLOSED_TASK_STATUSES = new Set([
  'completed',
  'approved',
  'rejected',
  'cancelled',
  'expired',
]);

export default function ConsultationResponsePage() {
  const params = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const { locale, direction } = useLocaleOrDefault();
  const copy = useConsultationResponseCopy();
  const id = params?.id ?? '';
  const canWrite = hasPermission('lex:consultation:edit');
  const canApprove = hasPermission('lex:consultation:approve');

  const [approvalOpen, setApprovalOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);

  const consultationQuery = useQuery({
    queryKey: ['lex-consultation', id],
    queryFn: () => consultationsApi.get(id),
    enabled: Boolean(id),
  });

  const isResponded = consultationQuery.data?.status === 'responded';
  const approvalTasksQuery = useQuery({
    queryKey: ['lex-consultation-approval', id],
    queryFn: () => consultationsApi.listApprovalTasks(id),
    enabled: Boolean(id) && isResponded,
    retry: false,
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

  const respondMutation = useMutation({
    mutationFn: (payload: RespondConsultationPayload) =>
      consultationsApi.respond(id, { ...payload, locale }),
    onSuccess: async () => {
      showSuccess(copy.toasts.responseRecorded);
      await refresh();
    },
    onError: showApiError,
  });

  const approvalMutation = useMutation({
    mutationFn: (payload: StartConsultationApprovalPayload) =>
      consultationsApi.startApproval(id, payload),
    onSuccess: async () => {
      showSuccess(copy.toasts.approvalStarted);
      setApprovalOpen(false);
      await refresh();
    },
    onError: showApiError,
  });

  const decisionMutation = useMutation({
    mutationFn: ({
      task,
      payload,
    }: {
      task: ConsultationApprovalTask;
      payload: ConsultationApprovalDecisionPayload;
    }) => {
      const workflowId = String(
        task.workflow_instance_id ??
          consultationQuery.data?.workflow_instance_id ??
          '',
      );
      return consultationsApi.decideApproval(
        id,
        workflowId,
        String(task.id),
        payload,
      );
    },
    onSuccess: async (_data, variables) => {
      showSuccess(
        variables.payload.decision === 'approve'
          ? copy.toasts.responseApproved
          : copy.toasts.revisionRequested,
      );
      await refresh();
    },
    onError: showApiError,
  });

  const archiveMutation = useMutation({
    mutationFn: (payload: ArchiveConsultationPayload) =>
      consultationsApi.archive(id, payload),
    onSuccess: async () => {
      showSuccess(copy.toasts.archived);
      setArchiveOpen(false);
      await refresh();
    },
    onError: showApiError,
  });

  if (consultationQuery.isLoading) {
    return (
      <LexRouteGuard route="/lex/consultations/[id]/response">
        <div className="space-y-6" dir={direction} lang={locale}>
          <PageHeader
            title={copy.loading.title}
            description={copy.loading.description}
          />
          <Skeleton variant="card" className="h-28" />
          <div className="grid gap-6 lg:grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)]">
            <Skeleton variant="card" className="h-[28rem]" />
            <Skeleton variant="card" className="h-[35rem]" />
          </div>
        </div>
      </LexRouteGuard>
    );
  }

  if (consultationQuery.isError || !consultationQuery.data) {
    return (
      <LexRouteGuard route="/lex/consultations/[id]/response">
        <div className="space-y-6" dir={direction} lang={locale}>
          <PageHeader
            title={copy.loading.title}
            description={copy.loading.description}
          />
          <ErrorState
            message={copy.loading.error}
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
  const pendingTask = (approvalTasksQuery.data ?? []).find(
    (task) =>
      !CLOSED_TASK_STATUSES.has(
        String(task.status ?? '').trim().toLowerCase(),
      ),
  );

  return (
    <LexRouteGuard route="/lex/consultations/[id]/response">
      <div dir={direction} lang={locale}>
        <ConsultationResponseWorkspace
          consultation={consultation}
          title={title}
          canWrite={canWrite}
          canApprove={canApprove}
          pendingApprovalTask={pendingTask}
          approvalTasksLoading={approvalTasksQuery.isLoading}
          responsePending={respondMutation.isPending}
          decisionPending={decisionMutation.isPending}
          onSubmitResponse={(payload) => respondMutation.mutate(payload)}
          onStartApproval={() => setApprovalOpen(true)}
          onApprove={(task, notes) =>
            decisionMutation.mutate({
              task,
              payload: {
                decision: 'approve',
                notes: notes.trim() || undefined,
              },
            })
          }
          onRequestRevision={(task, notes) =>
            decisionMutation.mutate({
              task,
              payload: {
                decision: 'reject',
                notes: notes.trim() || undefined,
              },
            })
          }
          onArchive={() => setArchiveOpen(true)}
        />

        {canApprove ? (
          <ConsultationApprovalDialog
            open={approvalOpen}
            loading={approvalMutation.isPending}
            onOpenChange={setApprovalOpen}
            onSubmit={(payload) => approvalMutation.mutate(payload)}
          />
        ) : null}

        {canWrite ? (
          <ConsultationArchiveDialog
            open={archiveOpen}
            loading={archiveMutation.isPending}
            onOpenChange={setArchiveOpen}
            onSubmit={(payload) => archiveMutation.mutate(payload)}
          />
        ) : null}
      </div>
    </LexRouteGuard>
  );
}
