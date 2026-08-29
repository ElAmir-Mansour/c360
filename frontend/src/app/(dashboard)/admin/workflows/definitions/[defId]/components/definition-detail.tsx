'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type { ColumnDef } from '@tanstack/react-table';
import {
  ArrowLeft,
  Pencil,
  Upload,
  Archive,
  Copy,
  Calendar,
  Globe,
  MousePointerClick,
  Webhook,
  Loader2,
  Play,
  AlertTriangle,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { StatusBadge } from '@/components/shared/status-badge';
import { PageHeader, type PageHeaderTag } from '@/components/common/page-header';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { ErrorState } from '@/components/common/error-state';
import { DataTable } from '@/components/shared/data-table/data-table';
import {
  actionsColumn,
  dateColumn,
  statusColumn,
} from '@/components/shared/data-table/columns/common-columns';
import { SearchInput } from '@/components/shared/forms/search-input';
import { formatDateTime } from '@/lib/format';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { useDataTable } from '@/hooks/use-data-table';
import {
  useWorkflowDefinition,
  useWorkflowDefinitionVersions,
  usePublishWorkflowDefinition,
  useArchiveWorkflowDefinition,
  useCloneWorkflowDefinition,
} from '@/hooks/use-workflow-definitions';
import { WorkflowCanvas } from '../designer/components/workflow-canvas';
import { StartWorkflowDialog } from '../../../instances/components/start-workflow-dialog';
import { apiGet } from '@/lib/api';
import type { WorkflowInstance } from '@/types/models';
import type { ApiError, ApiValidationError, PaginatedResponse } from '@/types/api';
import { useAdminT } from '../../../../_lib/admin-i18n';
import {
  formatCategoryLabel,
  formatDefinitionStatusLabel,
  formatDurationLabel,
  formatTriggerLabel,
  formatVariableTypeLabel,
  getDefinitionInstanceFilters,
  getDefinitionLabels,
  getDefinitionStatusConfig,
  getWorkflowInstanceStatusConfig,
  type DefinitionLabels,
} from '../../definition-i18n';

const triggerIcons: Record<string, React.ElementType> = {
  manual: MousePointerClick,
  event: Globe,
  schedule: Calendar,
  webhook: Webhook,
};

/** Map a workflow-definition status onto a semantic PageHeader tag tone. */
function definitionStatusTone(status: string): PageHeaderTag['tone'] {
  switch (status) {
    case 'active':
      return 'success';
    case 'draft':
      return 'warning';
    case 'deprecated':
      return 'danger';
    default:
      return 'neutral';
  }
}

function CurrentStepCell({
  instance,
  labels,
}: {
  instance: WorkflowInstance;
  labels: DefinitionLabels;
}) {
  if (instance.status === 'completed') {
    return (
      <span className="text-sm text-primary">
        {labels.instances.completedSteps(instance.total_steps ?? 0)}
      </span>
    );
  }
  if (instance.status === 'failed') {
    return (
      <span className="text-sm text-destructive">
        {labels.instances.failedAt} {instance.current_step_name ?? labels.instances.unknownStep}
      </span>
    );
  }
  if (instance.current_step_name) {
    const stepNum = (instance.completed_steps ?? 0) + 1;
    const total = instance.total_steps ?? 0;
    return (
      <div>
        <span className="text-sm font-medium">{instance.current_step_name}</span>
        <span className="ms-1.5 text-xs text-muted-foreground">
          {labels.instances.stepOf(stepNum, total)}
        </span>
      </div>
    );
  }
  return <span className="text-muted-foreground text-sm">—</span>;
}

function DurationCell({ instance, locale }: { instance: WorkflowInstance; locale: string }) {
  const startTime = new Date(instance.started_at).getTime();
  const endTime = instance.completed_at
    ? new Date(instance.completed_at).getTime()
    : Date.now();
  const seconds = Math.floor((endTime - startTime) / 1000);
  return (
    <span className="text-sm text-muted-foreground">
      {formatDurationLabel(seconds, locale)}
    </span>
  );
}

function StartedByCell({
  instance,
  labels,
}: {
  instance: WorkflowInstance;
  labels: DefinitionLabels;
}) {
  if (!instance.started_by) {
    return <Badge variant="secondary" className="text-xs">{labels.instances.system}</Badge>;
  }
  return <span className="text-sm">{instance.started_by_name ?? instance.started_by}</span>;
}

function getDefinitionInstanceColumns({
  labels,
  locale,
  onView,
  onCancel,
  onRetry,
}: {
  labels: DefinitionLabels;
  locale: string;
  onView: (instance: WorkflowInstance) => void;
  onCancel: (instance: WorkflowInstance) => void;
  onRetry: (instance: WorkflowInstance) => void;
}): ColumnDef<WorkflowInstance>[] {
  return [
    {
      id: 'definition_name',
      accessorKey: 'definition_name',
      header: labels.instances.workflow,
      cell: ({ getValue, row }) => {
        const name = getValue() as string;
        return (
          <button
            onClick={() => onView(row.original)}
            className="text-sm font-medium text-start hover:underline"
          >
            {name}
          </button>
        );
      },
      enableSorting: true,
    },
    {
      id: 'current_step',
      header: labels.instances.currentStep,
      cell: ({ row }) => <CurrentStepCell instance={row.original} labels={labels} />,
      size: 200,
      enableSorting: false,
    },
    statusColumn<WorkflowInstance>(
      'status',
      labels.columns.status,
      getWorkflowInstanceStatusConfig(locale),
    ),
    dateColumn<WorkflowInstance>('started_at', labels.instances.started, { relative: true }),
    {
      id: 'duration',
      header: labels.instances.duration,
      cell: ({ row }) => <DurationCell instance={row.original} locale={locale} />,
      size: 100,
      enableSorting: false,
    },
    {
      id: 'started_by',
      header: labels.instances.startedBy,
      cell: ({ row }) => <StartedByCell instance={row.original} labels={labels} />,
      size: 140,
      enableSorting: false,
    },
    actionsColumn<WorkflowInstance>((instance) => [
      { label: labels.actions.viewDetails, onClick: () => onView(instance) },
      ...(instance.status === 'running'
        ? [
            {
              label: labels.actions.cancel,
              onClick: () => onCancel(instance),
              variant: 'destructive' as const,
            },
          ]
        : []),
      ...(instance.status === 'failed'
        ? [{ label: labels.actions.retry, onClick: () => onRetry(instance) }]
        : []),
    ]),
  ];
}

export function DefinitionDetailClient() {
  const labels = useAdminT();
  const { locale } = useLocaleOrDefault();
  const localLabels = getDefinitionLabels(locale);
  const w = labels.workflowDef;
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const defId = (params?.defId as string | undefined) ?? '';
  const [activeTab, setActiveTab] = useState('overview');
  const [startDialogOpen, setStartDialogOpen] = useState(false);

  const { data: definition, isLoading, isError, refetch } = useWorkflowDefinition(defId);
  const { data: versions = [] } = useWorkflowDefinitionVersions(defId);
  const publishMutation = usePublishWorkflowDefinition();
  const archiveMutation = useArchiveWorkflowDefinition();
  const cloneMutation = useCloneWorkflowDefinition();

  // Structured validation problems from the most recent failed publish, surfaced
  // inline so the author can fix them without re-reading a toast.
  const publishError = publishMutation.error as unknown as ApiError | null;
  const publishValidationErrors: ApiValidationError[] = publishError?.errors ?? [];
  const publishErrorMessage =
    publishMutation.isError && publishValidationErrors.length === 0
      ? publishError?.message ?? null
      : null;

  // Instances tab data table
  const instancesTable = useDataTable<WorkflowInstance>({
    queryKey: `definition-${defId}-instances`,
    defaultPageSize: 10,
    defaultSort: { column: 'started_at', direction: 'desc' },
    fetchFn: (p) =>
      apiGet<PaginatedResponse<WorkflowInstance>>('/api/v1/workflows/instances', {
        page: p.page,
        per_page: p.per_page,
        sort: p.sort ?? 'started_at',
        order: p.order ?? 'desc',
        search: p.search,
        definition_id: defId,
        ...(p.filters?.status
          ? {
              status: Array.isArray(p.filters.status)
                ? p.filters.status.join(',')
                : p.filters.status,
            }
          : {}),
      }),
  });

  const instanceColumns = getDefinitionInstanceColumns({
    labels: localLabels,
    locale,
    onView: (inst) => router.push(`/workflows/${inst.id}`),
    onCancel: () => undefined,
    onRetry: () => undefined,
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <LoadingSkeleton variant="card" count={3} />
      </div>
    );
  }

  if (isError || !definition) {
    return (
      <ErrorState
        message={labels.workflowDef.loadFailed}
        onRetry={() => refetch()}
      />
    );
  }

  const TriggerIcon = triggerIcons[definition.trigger_config.type] ?? Globe;
  return (
    <div className="space-y-6">
      {/* Back button */}
      <button
        onClick={() => router.push('/admin/workflows/definitions')}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        type="button"
      >
        <ArrowLeft className="h-4 w-4" />
        {labels.workflowDef.backToDefinitions}
      </button>

      {/* Header */}
      <PageHeader
        eyebrow={labels.workflowDef.eyebrow}
        title={definition.name}
        description={definition.description || undefined}
        tags={[
          {
            label: formatDefinitionStatusLabel(definition.status, locale),
            tone: definitionStatusTone(definition.status),
          },
          { label: `v${definition.version}`, tone: 'neutral' },
          ...(definition.category
            ? ([{ label: formatCategoryLabel(definition.category, locale), tone: 'neutral' }] as PageHeaderTag[])
            : []),
        ]}
        actions={
          <>
            {definition.status === 'draft' && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    router.push(
                      `/admin/workflows/definitions/${defId}/designer`,
                    )
                  }
                >
                  <Pencil className="me-1 h-3.5 w-3.5" />
                  {labels.workflowDef.edit}
                </Button>
                <Button
                  size="sm"
                  onClick={() => publishMutation.mutate(defId)}
                  disabled={publishMutation.isPending}
                >
                  {publishMutation.isPending ? (
                    <Loader2 className="me-1 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Upload className="me-1 h-3.5 w-3.5" />
                  )}
                  {labels.workflowDef.publish}
                </Button>
              </>
            )}
            {definition.status === 'active' && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => archiveMutation.mutate(defId)}
                disabled={archiveMutation.isPending}
              >
                {archiveMutation.isPending ? (
                  <Loader2 className="me-1 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Archive className="me-1 h-3.5 w-3.5" />
                )}
                {labels.workflowDef.archive}
              </Button>
            )}
            {/* Start instance — only an active definition can be run. When the
                definition is not active the action is disabled with guidance so
                the user knows to publish first. */}
            <Button
              size="sm"
              onClick={() => setStartDialogOpen(true)}
              disabled={definition.status !== 'active'}
              title={
                definition.status === 'active'
                  ? w.startTitleActive
                  : w.startTitleInactive.replace(
                      '{status}',
                      formatDefinitionStatusLabel(definition.status, locale),
                    )
              }
            >
              <Play className="me-1 h-3.5 w-3.5" />
              {labels.workflowDef.startInstance}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => cloneMutation.mutate(defId)}
              disabled={cloneMutation.isPending}
            >
              <Copy className="me-1 h-3.5 w-3.5" />
              {labels.workflowDef.clone}
            </Button>
          </>
        }
      />

      {/* Inline publish validation errors — rendered persistently (not just a
          toast) so the author can read and fix each problem. */}
      {publishValidationErrors.length > 0 && (
        <div
          role="alert"
          data-testid="publish-validation-errors"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-4"
        >
          <div className="flex items-center gap-2 text-sm font-medium text-destructive">
            <AlertTriangle className="h-4 w-4" />
            {labels.workflowDef.publishFailedFix}
          </div>
          <ul className="mt-2 space-y-1 ps-6 text-sm text-destructive list-disc">
            {publishValidationErrors.map((err, i) => (
              <li key={`${err.field}-${err.step_id ?? ''}-${i}`}>
                {err.step_id ? (
                  <span className="font-mono text-xs">[{err.step_id}] </span>
                ) : null}
                <span className="font-mono text-xs">{err.field}</span>:{' '}
                {err.message}
              </li>
            ))}
          </ul>
        </div>
      )}
      {publishErrorMessage && (
        <div
          role="alert"
          data-testid="publish-error"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
        >
          <div className="flex items-center gap-2 font-medium">
            <AlertTriangle className="h-4 w-4" />
            {labels.workflowDef.publishFailed}
          </div>
          <p className="mt-1">{publishErrorMessage}</p>
        </div>
      )}

      {/* When the definition is not active, make clear why instances can't be
          started yet. */}
      {definition.status !== 'active' && (
        <div
          data-testid="start-disabled-hint"
          className="rounded-md border border-warning-300/50 bg-warning-50 p-3 text-sm text-warning-700 dark:border-warning-500/30 dark:bg-warning-700/15 dark:text-warning-300"
        >
          {labels.workflowDef.thisDefinitionIs}{' '}
          <strong>{formatDefinitionStatusLabel(definition.status, locale)}</strong>.{' '}
          {definition.status === 'draft'
            ? labels.workflowDef.draftHint
            : labels.workflowDef.inactiveHint}
        </div>
      )}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="overview">{labels.workflowDef.tabOverview}</TabsTrigger>
          <TabsTrigger value="designer">{labels.workflowDef.tabDesigner}</TabsTrigger>
          <TabsTrigger value="versions">{labels.workflowDef.tabVersions}</TabsTrigger>
          <TabsTrigger value="instances">{labels.workflowDef.tabInstances}</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-4 mt-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Trigger card */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">{labels.workflowDef.cardTrigger}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2">
                  <TriggerIcon className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">
                    {formatTriggerLabel(definition.trigger_config.type, locale)}
                  </span>
                </div>
                {definition.trigger_config.topic && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {labels.workflowDef.topicLabel} {definition.trigger_config.topic}
                  </p>
                )}
                {definition.trigger_config.cron && (
                  <p className="text-xs text-muted-foreground mt-1 font-mono">
                    {definition.trigger_config.cron}
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Stats card */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">{labels.workflowDef.cardStatistics}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{labels.workflowDef.statSteps}</span>
                  <span className="font-medium">{definition.step_count ?? definition.steps.length}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{labels.workflowDef.statInstances}</span>
                  <span className="font-medium">{definition.instance_count ?? 0}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{labels.workflowDef.statVariables}</span>
                  <span className="font-medium">{Object.keys(definition.variables).length}</span>
                </div>
              </CardContent>
            </Card>

            {/* Dates card */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">{labels.workflowDef.cardTimeline}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{labels.workflowDef.tCreated}</span>
                  <span>{formatDateTime(definition.created_at)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{labels.workflowDef.tUpdated}</span>
                  <span>{formatDateTime(definition.updated_at)}</span>
                </div>
                {definition.published_at && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{labels.workflowDef.tPublished}</span>
                    <span>{formatDateTime(definition.published_at)}</span>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Variables */}
          {Object.keys(definition.variables).length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">{labels.workflowDef.cardVariables}</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{labels.workflowDef.varName}</TableHead>
                      <TableHead>{labels.workflowDef.varType}</TableHead>
                      <TableHead>{labels.workflowDef.varSource}</TableHead>
                      <TableHead>{labels.workflowDef.varDefault}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Object.entries(definition.variables).map(([name, v]) => (
                      <TableRow key={name}>
                        <TableCell className="font-mono text-xs">
                          {name}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">
                            {formatVariableTypeLabel(v.type, locale)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {v.source || '—'}
                        </TableCell>
                        <TableCell className="text-xs font-mono">
                          {v.default !== undefined
                            ? String(v.default)
                            : '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Designer Tab (read-only) */}
        <TabsContent value="designer" className="mt-4">
          <Card className="overflow-hidden">
            <div className="h-[500px]">
              <WorkflowCanvas
                definition={definition}
                readOnly
                isSaving={false}
                isPublishing={false}
                onSave={() => undefined}
                onPublish={() => undefined}
              />
            </div>
          </Card>
        </TabsContent>

        {/* Versions Tab */}
        <TabsContent value="versions" className="mt-4">
          <Card>
            <CardContent className="pt-6">
              {versions.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  {labels.workflowDef.noVersionHistory}
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{labels.workflowDef.vhVersion}</TableHead>
                      <TableHead>{labels.workflowDef.vhStatus}</TableHead>
                      <TableHead>{labels.workflowDef.vhPublishedAt}</TableHead>
                      <TableHead>{labels.workflowDef.vhUpdatedBy}</TableHead>
                      <TableHead>{labels.workflowDef.vhUpdatedAt}</TableHead>
                      <TableHead>{labels.workflowDef.vhSteps}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {versions.map((v) => (
                      <TableRow key={v.version}>
                        <TableCell className="font-medium">
                          v{v.version}
                        </TableCell>
                        <TableCell>
                          <StatusBadge
                            status={v.status}
                            config={getDefinitionStatusConfig(locale)}
                          />
                        </TableCell>
                        <TableCell>
                          {v.published_at
                            ? formatDateTime(v.published_at)
                            : '—'}
                        </TableCell>
                        <TableCell className="text-sm">
                          {v.updated_by ?? '—'}
                        </TableCell>
                        <TableCell>
                          {v.updated_at
                            ? formatDateTime(v.updated_at)
                            : '—'}
                        </TableCell>
                        <TableCell>{v.step_count}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Instances Tab */}
        <TabsContent value="instances" className="mt-4">
          <DataTable
            columns={instanceColumns}
            filters={getDefinitionInstanceFilters(locale)}
            searchSlot={
              <SearchInput
                value={instancesTable.searchValue}
                onChange={instancesTable.setSearch}
                placeholder={labels.workflowDef.searchInstances}
              />
            }
            {...instancesTable.tableProps}
            onRowClick={(row) => router.push(`/workflows/${row.id}`)}
          />
        </TabsContent>
      </Tabs>

      {/* Start-instance flow (definition selection + variables). Only reachable
          when the definition is active (the trigger button is disabled otherwise). */}
      <StartWorkflowDialog
        open={startDialogOpen}
        onOpenChange={setStartDialogOpen}
        onSuccess={(instance) => {
          setStartDialogOpen(false);
          router.push(`/workflows/${instance.id}`);
        }}
      />
    </div>
  );
}
