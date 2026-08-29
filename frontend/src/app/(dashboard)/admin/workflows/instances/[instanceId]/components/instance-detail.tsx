'use client';

import { useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  XCircle,
  RotateCcw,
  PauseCircle,
  PlayCircle,
  Loader2,
  AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { PageHeader, type PageHeaderTag } from '@/components/common/page-header';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { ErrorState } from '@/components/common/error-state';
import { useLocaleOrDefault, useT } from '@/components/providers/locale-provider';
import {
  useWorkflowInstance,
  useWorkflowInstanceHistory,
  usePauseWorkflowInstance,
  useResumeWorkflowInstance,
  useRetryWorkflowInstance,
} from '@/hooks/use-workflow-instances-ext';
import { useWorkflowDefinition } from '@/hooks/use-workflow-definitions';
import { WorkflowCanvas } from '../../../definitions/[defId]/designer/components/workflow-canvas';
import { StepHistory } from './step-history';
import { InstanceProgress } from './instance-progress';
import { AdminWorkflowCancelDialog } from '../../components/admin-workflow-cancel-dialog';
import {
  formatAdminDateTime,
  getWorkflowStatusLabel,
} from '../../../tasks/_lib/admin-workflow-i18n';

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

export function InstanceDetailClient() {
  const t = useT('admin');
  const { locale } = useLocaleOrDefault();
  const params = useParams();
  const router = useRouter();
  const instanceId = (params?.instanceId as string | undefined) ?? '';
  const [cancelOpen, setCancelOpen] = useState(false);

  const {
    data: instance,
    isLoading,
    isError,
    refetch,
  } = useWorkflowInstance(instanceId);

  const { data: historyData, isLoading: historyLoading } =
    useWorkflowInstanceHistory(instanceId);

  const { data: definition } = useWorkflowDefinition(
    instance?.definition_id ?? '',
  );

  const pauseMutation = usePauseWorkflowInstance();
  const resumeMutation = useResumeWorkflowInstance();
  const retryMutation = useRetryWorkflowInstance();

  // Step status map for the WorkflowCanvas overlay. MEMOIZED on the query data
  // so its object identity is stable across renders. Building it inline in the
  // render body (a fresh object every render) made WorkflowCanvas's `nodes`/
  // `edges` memos — which list `stepStatuses` as a dep — recompute every render,
  // which re-synced React Flow's internal store in a tight loop and threw
  // React #185 ("Maximum update depth exceeded"). Declared BEFORE the early
  // returns to satisfy the Rules of Hooks.
  const stepStatuses = useMemo<
    Record<string, 'completed' | 'running' | 'failed' | 'pending'>
  >(() => {
    const map: Record<string, 'completed' | 'running' | 'failed' | 'pending'> = {};
    for (const step of historyData?.steps ?? []) {
      if (step.status === 'completed') map[step.step_id] = 'completed';
      else if (step.status === 'running') map[step.step_id] = 'running';
      else if (step.status === 'failed') map[step.step_id] = 'failed';
      else map[step.step_id] = 'pending';
    }
    return map;
  }, [historyData?.steps]);

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
        message={t('idc.failedLoad')}
        onRetry={() => refetch()}
      />
    );
  }

  const history = historyData?.steps ?? [];
  const isRunning = instance.status === 'running';
  const isFailed = instance.status === 'failed';
  const isSuspended = instance.status === 'suspended';

  return (
    <div className="space-y-6">
      {/* Back */}
      <button
        onClick={() => router.push('/admin/workflows/instances')}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        type="button"
      >
        <ArrowLeft className="h-4 w-4" />
        {t('idc.back')}
      </button>

      {/* Header */}
      <PageHeader
        eyebrow={t('idc.eyebrow')}
        title={instance.definition_name ?? t('idc.fallbackTitle')}
        description={
          instance.started_by_name
            ? t('idc.startedByName', { date: formatAdminDateTime(instance.started_at, locale), who: instance.started_by_name })
            : t('idc.started', { date: formatAdminDateTime(instance.started_at, locale) })
        }
        tags={[
          {
            label: getWorkflowStatusLabel(instance.status, locale),
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
                  onClick={() => pauseMutation.mutate(instanceId)}
                  disabled={pauseMutation.isPending}
                >
                  {pauseMutation.isPending ? (
                    <Loader2 className="me-1 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <PauseCircle className="me-1 h-3.5 w-3.5" />
                  )}
                  {t('idc.pause')}
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setCancelOpen(true)}
                >
                  <XCircle className="me-1 h-3.5 w-3.5" />
                  {t('idc.cancel')}
                </Button>
              </>
            )}
            {isFailed && (
              <Button
                size="sm"
                onClick={() => retryMutation.mutate(instanceId)}
                disabled={retryMutation.isPending}
              >
                {retryMutation.isPending ? (
                  <Loader2 className="me-1 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RotateCcw className="me-1 h-3.5 w-3.5" />
                )}
                {t('idc.retry')}
              </Button>
            )}
            {isSuspended && (
              <Button
                size="sm"
                onClick={() => resumeMutation.mutate(instanceId)}
                disabled={resumeMutation.isPending}
              >
                {resumeMutation.isPending ? (
                  <Loader2 className="me-1 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <PlayCircle className="me-1 h-3.5 w-3.5" />
                )}
                {t('idc.resume')}
              </Button>
            )}
          </>
        }
      />

      <AdminWorkflowCancelDialog
        instanceId={instance.id}
        definitionName={instance.definition_name ?? t('idc.fallbackTitle')}
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        onSuccess={() => {
          void refetch();
        }}
      />

      {/* Error alert */}
      {isFailed && instance.error_message && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{instance.error_message}</AlertDescription>
        </Alert>
      )}

      {/* Progress bar */}
      <InstanceProgress instance={instance} />

      {/* Visual canvas (if definition loaded) */}
      {definition && (
        <Card className="overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              {t('idc.workflowProgress')}
            </CardTitle>
          </CardHeader>
          <div className="h-[400px]">
            <WorkflowCanvas
              definition={definition}
              readOnly
              isSaving={false}
              isPublishing={false}
              stepStatuses={stepStatuses}
              onSave={() => undefined}
              onPublish={() => undefined}
            />
          </div>
        </Card>
      )}

      {/* Variables */}
      {Object.keys(instance.variables).length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">{t('idc.variables')}</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('idc.colName')}</TableHead>
                  <TableHead>{t('idc.colValue')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.entries(instance.variables).map(([key, value]) => (
                  <TableRow key={key}>
                    <TableCell className="font-mono text-xs">{key}</TableCell>
                    <TableCell className="text-xs font-mono">
                      {typeof value === 'object'
                        ? JSON.stringify(value)
                        : String(value)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Step execution history */}
      <StepHistory steps={history} />
    </div>
  );
}
