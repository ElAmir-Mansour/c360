'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import { WorkflowStepTimeline } from './workflow-step-timeline';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/common/error-state';
import {
  formatWorkflowDateTime,
  useWorkflowPageLabels,
  type WorkflowPageLabels,
} from '@/app/(dashboard)/workflows/_lib/workflow-page-i18n';
import type { HumanTask, StepExecution, WorkflowInstance } from '@/types/models';

interface TaskContextPanelProps {
  task: HumanTask;
  instanceId: string;
}

interface AlertSummary {
  id: string;
  severity: string;
  title: string;
  description: string;
}

interface ContractSummary {
  id: string;
  name: string;
  counterparty: string;
  expiry_date: string;
}

interface MeetingSummary {
  id: string;
  title: string;
  scheduled_at: string;
  attendance?: unknown[];
}

interface RelatedEntityContext {
  type: 'alert' | 'contract' | 'meeting';
  id: string;
}

function MetadataRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-2 py-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value ?? '—'}</span>
    </div>
  );
}

export function TaskContextPanel({ task, instanceId }: TaskContextPanelProps) {
  const labels = useWorkflowPageLabels();
  const {
    data: instance,
    isLoading: instanceLoading,
    isError: instanceError,
    refetch: refetchInstance,
  } = useQuery({
    queryKey: ['workflow-instance', instanceId],
    queryFn: () => apiGet<WorkflowInstance>(`/api/v1/workflows/instances/${instanceId}`),
    enabled: !!instanceId,
  });

  const {
    data: history,
    isLoading: historyLoading,
    isError: historyError,
    refetch: refetchHistory,
  } = useQuery({
    queryKey: ['workflow-instance-history', instanceId],
    queryFn: () =>
      apiGet<{ steps: StepExecution[] }>(`/api/v1/workflows/instances/${instanceId}/history`),
    enabled: !!instanceId,
  });

  const relatedEntity = useMemo(() => getRelatedEntityContext(task, instance), [instance, task]);
  const relatedEntityQuery = useQuery({
    queryKey: ['task-related-entity', relatedEntity?.type, relatedEntity?.id],
    queryFn: async () => {
      if (!relatedEntity) {
        return null;
      }

      switch (relatedEntity.type) {
        case 'alert':
          return apiGet<AlertSummary>(`/api/v1/cyber/alerts/${relatedEntity.id}`);
        case 'contract':
          return apiGet<ContractSummary>(`/api/v1/lex/contracts/${relatedEntity.id}`);
        case 'meeting':
          return apiGet<MeetingSummary>(`/api/v1/acta/meetings/${relatedEntity.id}`);
      }
    },
    enabled: Boolean(relatedEntity),
    retry: 1,
  });

  const metadata = task.metadata ?? {};

  return (
    <div className="space-y-6">
      <div>
        <h3 className="mb-3 text-sm font-semibold">{labels.tasks.detail.workflowProgress}</h3>
        {instanceLoading || historyLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="flex items-start gap-3">
                <Skeleton className="h-5 w-5 rounded-full" />
                <div className="flex-1 space-y-1">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : instanceError || historyError ? (
          <ErrorState
            message={labels.tasks.detail.failedToLoadWorkflowProgress}
            onRetry={() => {
              refetchInstance();
              refetchHistory();
            }}
          />
        ) : (
          <WorkflowStepTimeline
            steps={history?.steps ?? []}
            currentStepId={instance?.current_step_id ?? null}
            definitionSteps={instance?.definition_steps ?? []}
          />
        )}
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold">{labels.tasks.detail.relatedEntity}</h3>
        <div className="rounded-lg border p-3">
          {!relatedEntity ? (
            <p className="text-sm text-muted-foreground">{labels.tasks.detail.noRelatedEntity}</p>
          ) : relatedEntityQuery.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          ) : relatedEntityQuery.error || !relatedEntityQuery.data ? (
            <div className="space-y-1 text-sm">
              <p className="font-medium">
                {entityTypeLabel(relatedEntity.type, labels)} {relatedEntity.id}
              </p>
              <p className="text-muted-foreground">
                {labels.tasks.detail.detailUnavailable}
              </p>
              <EntityLink entity={relatedEntity} labels={labels} />
            </div>
          ) : (
            <EntitySummary entity={relatedEntity} data={relatedEntityQuery.data} labels={labels} />
          )}
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold">{labels.tasks.detail.taskMetadata}</h3>
        <div className="divide-y rounded-lg border">
          <div className="px-3">
            <MetadataRow label={labels.tasks.detail.created} value={formatWorkflowDateTime(task.created_at, labels)} />
            <MetadataRow
              label={labels.tasks.detail.assignedBy}
              value={(metadata.assigned_by_name as string | undefined) ?? labels.tasks.detail.system}
            />
            <MetadataRow
              label={labels.tasks.detail.slaDeadline}
              value={
                task.sla_deadline ? (
                  <span className={task.sla_breached ? 'text-destructive' : undefined}>
                    {formatWorkflowDateTime(task.sla_deadline, labels)}
                    {task.sla_breached && ` (${labels.tasks.detail.overdueSuffix})`}
                  </span>
                ) : (
                  labels.sla.noDeadline
                )
              }
            />
            <MetadataRow label={labels.tasks.detail.requiredRole} value={task.assignee_role ?? labels.tasks.detail.anyRole} />
            <MetadataRow
              label={labels.tasks.detail.timesClaimed}
              value={String((metadata.claim_count as number | undefined) ?? 0)}
            />
            <MetadataRow
              label={labels.tasks.detail.timesDelegated}
              value={String((metadata.delegation_count as number | undefined) ?? 0)}
            />
            {instance && <MetadataRow label={labels.common.workflow} value={instance.definition_name} />}
          </div>
        </div>
      </div>

      {instance && Object.keys(instance.variables).length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold">{labels.tasks.detail.contextVariables}</h3>
          <div className="rounded-lg border">
            <div className="divide-y px-3">
              {Object.entries(instance.variables)
                .slice(0, 8)
                .map(([key, value]) => (
                  <MetadataRow
                    key={key}
                    label={key}
                    value={
                      <span className="font-mono text-xs">
                        {typeof value === 'object' ? JSON.stringify(value) : String(value ?? '—')}
                      </span>
                    }
                  />
                ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function getRelatedEntityContext(
  task: HumanTask,
  instance: WorkflowInstance | undefined,
): RelatedEntityContext | null {
  const metadata = task.metadata ?? {};
  const entityType = metadata.entity_type;
  const entityId = metadata.entity_id;

  if (typeof entityType === 'string' && typeof entityId === 'string') {
    if (entityType === 'alert' || entityType === 'contract' || entityType === 'meeting') {
      return { type: entityType, id: entityId };
    }
  }

  const variables = instance?.variables ?? {};
  if (typeof variables.alert_id === 'string') {
    return { type: 'alert', id: variables.alert_id };
  }
  if (typeof variables.contract_id === 'string') {
    return { type: 'contract', id: variables.contract_id };
  }
  if (typeof variables.meeting_id === 'string') {
    return { type: 'meeting', id: variables.meeting_id };
  }

  return null;
}

function EntitySummary({
  entity,
  data,
  labels,
}: {
  entity: RelatedEntityContext;
  data: AlertSummary | ContractSummary | MeetingSummary;
  labels: WorkflowPageLabels;
}) {
  if (entity.type === 'alert') {
    const alert = data as AlertSummary;
    return (
      <div className="space-y-1 text-sm">
        <p className="font-medium">{alert.title}</p>
        <p className="text-muted-foreground">{labels.tasks.detail.entitySeverity}: {alert.severity}</p>
        <p className="text-muted-foreground">{alert.description}</p>
        <EntityLink entity={entity} labels={labels} />
      </div>
    );
  }

  if (entity.type === 'contract') {
    const contract = data as ContractSummary;
    return (
      <div className="space-y-1 text-sm">
        <p className="font-medium">{contract.name}</p>
        <p className="text-muted-foreground">{labels.tasks.detail.entityCounterparty}: {contract.counterparty}</p>
        <p className="text-muted-foreground">
          {labels.tasks.detail.entityExpiry}: {formatWorkflowDateTime(contract.expiry_date, labels)}
        </p>
        <EntityLink entity={entity} labels={labels} />
      </div>
    );
  }

  const meeting = data as MeetingSummary;
  return (
    <div className="space-y-1 text-sm">
      <p className="font-medium">{meeting.title}</p>
      <p className="text-muted-foreground">
        {labels.tasks.detail.entityScheduled}: {formatWorkflowDateTime(meeting.scheduled_at, labels)}
      </p>
      <p className="text-muted-foreground">
        {labels.tasks.detail.entityAttendees}: {Array.isArray(meeting.attendance) ? meeting.attendance.length : 0}
      </p>
      <EntityLink entity={entity} labels={labels} />
    </div>
  );
}

function EntityLink({ entity, labels }: { entity: RelatedEntityContext; labels: WorkflowPageLabels }) {
  const href =
    entity.type === 'alert'
      ? `/cyber/alerts/${entity.id}`
      : entity.type === 'contract'
        ? `/lex/contracts/${entity.id}`
        : `/acta/meetings/${entity.id}`;

  return (
    <Link href={href} className="text-sm text-primary hover:underline">
      {labels.tasks.detail.viewEntity(entityTypeLabel(entity.type, labels))}
    </Link>
  );
}

function entityTypeLabel(type: RelatedEntityContext['type'], labels: WorkflowPageLabels): string {
  if (type === 'alert') {
    return labels.tasks.detail.entityAlert;
  }
  if (type === 'contract') {
    return labels.tasks.detail.entityContract;
  }
  return labels.tasks.detail.entityMeeting;
}
