'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, XCircle, RotateCcw, PauseCircle, PlayCircle, Loader2 } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { PageHeader, type PageHeaderTag } from '@/components/common/page-header';
import { WorkflowInstanceDetail } from '@/components/workflows/workflow-instance-detail';
import { WorkflowCancelDialog } from '@/components/workflows/workflow-cancel-dialog';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { ErrorState } from '@/components/common/error-state';
import { titleCase } from '@/lib/format';
import { formatDateTime } from '@/lib/utils';
import { showSuccess, showError } from '@/lib/toast';
import { useAuth } from '@/hooks/use-auth';
import { useWorkflowPageLabels, workflowLabel } from '../_lib/workflow-page-i18n';
import type { WorkflowInstance, StepExecution } from '@/types/models';

/** Map a workflow instance status onto a semantic PageHeader tag tone. */
function instanceStatusTone(status: string): PageHeaderTag['tone'] {
  switch (status) {
    case 'running':
      return 'info';
    case 'completed':
      return 'success';
    case 'failed':
      return 'danger';
    case 'suspended':
      return 'warning';
    default:
      return 'neutral';
  }
}

export function WorkflowInstancePageClient() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const labels = useWorkflowPageLabels();
  const instanceId = (params?.id as string | undefined) ?? '';
  const [cancelOpen, setCancelOpen] = useState(false);
  const { hasAnyPermission, user } = useAuth();

  const { data: instance, isLoading, isError, refetch } = useQuery({
    queryKey: ['workflow-instances', instanceId],
    queryFn: () => apiGet<WorkflowInstance>(`/api/v1/workflows/instances/${instanceId}`),
  });

  const { data: history, isLoading: historyLoading } = useQuery({
    queryKey: ['workflow-instances', instanceId, 'history'],
    queryFn: async () => {
      const resp = await apiGet<{ instance_id: string; step_executions: StepExecution[] }>(
        `/api/v1/workflows/instances/${instanceId}/history`,
      );
      return { steps: resp.step_executions ?? [] };
    },
    enabled: !!instanceId,
  });

  const retryMutation = useMutation({
    mutationFn: () => apiPost(`/api/v1/workflows/instances/${instanceId}/retry`),
    onSuccess: () => {
      showSuccess(labels.common.retryInitiated);
      queryClient.invalidateQueries({ queryKey: ['workflow-instances', instanceId] });
    },
    onError: () => showError(labels.instance.failedToRetry),
  });

  const suspendMutation = useMutation({
    mutationFn: () => apiPost(`/api/v1/workflows/instances/${instanceId}/suspend`),
    onSuccess: () => {
      showSuccess(labels.instance.suspended);
      queryClient.invalidateQueries({ queryKey: ['workflow-instances', instanceId] });
    },
    onError: () => showError(labels.instance.failedToSuspend),
  });

  const resumeMutation = useMutation({
    mutationFn: () => apiPost(`/api/v1/workflows/instances/${instanceId}/resume`),
    onSuccess: () => {
      showSuccess(labels.instance.resumed);
      queryClient.invalidateQueries({ queryKey: ['workflow-instances', instanceId] });
    },
    onError: () => showError(labels.instance.failedToResume),
  });

  if (isLoading || historyLoading) {
    return (
      <div className="space-y-6">
        <LoadingSkeleton variant="card" count={3} />
      </div>
    );
  }

  if (isError || !instance) {
    return (
      <ErrorState
        message={labels.instance.failedToLoad}
        onRetry={() => refetch()}
      />
    );
  }

  // The engine authorizes suspend / cancel / retry / resume to the user who
  // started the instance, or to a workflow operator. Anyone else — including a
  // colleague who merely approved a step — is deep-linked here from their own
  // work and gets a read-only view rather than buttons that return 403.
  const mayControl =
    hasAnyPermission(['workflow:admin', 'workflow:incident']) ||
    (!!user?.id && instance.started_by === user.id);
  const isRunning = instance.status === 'running' && mayControl;
  const isFailed = instance.status === 'failed' && mayControl;
  const isSuspended = instance.status === 'suspended' && mayControl;

  return (
    <div className="space-y-6">
      <div>
        <button
          onClick={() => router.push('/workflows')}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          type="button"
        >
          <ArrowLeft className="h-4 w-4" />
          {labels.instance.backToWorkflows}
        </button>
      </div>

      <PageHeader
        eyebrow={labels.common.eyebrow}
        title={instance.definition_name ?? labels.instance.fallbackTitle}
        description={
          <>
            {labels.instance.startedAt(formatDateTime(instance.started_at))}
            {instance.started_by_name && labels.instance.startedBy(instance.started_by_name)}
          </>
        }
        tags={[
          {
            label: workflowLabel(labels, instance.status, titleCase(instance.status)),
            tone: instanceStatusTone(instance.status),
          },
        ]}
        actions={
          <>
            {isRunning && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => suspendMutation.mutate()}
                  disabled={suspendMutation.isPending}
                >
                  {suspendMutation.isPending ? (
                    <Loader2 className="me-1 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <PauseCircle className="me-1 h-3.5 w-3.5" />
                  )}
                  {labels.instance.suspend}
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setCancelOpen(true)}
                >
                  <XCircle className="me-1 h-3.5 w-3.5" />
                  {labels.instance.cancelWorkflow}
                </Button>
              </>
            )}
            {isFailed && (
              <Button
                size="sm"
                onClick={() => retryMutation.mutate()}
                disabled={retryMutation.isPending}
              >
                {retryMutation.isPending ? (
                  <Loader2 className="me-1 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RotateCcw className="me-1 h-3.5 w-3.5" />
                )}
                {labels.instance.retry}
              </Button>
            )}
            {isSuspended && (
              <Button
                size="sm"
                onClick={() => resumeMutation.mutate()}
                disabled={resumeMutation.isPending}
              >
                {resumeMutation.isPending ? (
                  <Loader2 className="me-1 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <PlayCircle className="me-1 h-3.5 w-3.5" />
                )}
                {labels.instance.resume}
              </Button>
            )}
          </>
        }
      />

      <WorkflowInstanceDetail
        instance={instance}
        history={history?.steps ?? []}
      />

      <WorkflowCancelDialog
        instanceId={instanceId}
        definitionName={instance.definition_name ?? labels.common.workflow}
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        onSuccess={() => {
          setCancelOpen(false);
          queryClient.invalidateQueries({ queryKey: ['workflow-instances', instanceId] });
        }}
      />
    </div>
  );
}
