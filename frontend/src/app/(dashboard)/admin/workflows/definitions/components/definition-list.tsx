'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Layout } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
import { PageHeader } from '@/components/common/page-header';
import { DataTable } from '@/components/shared/data-table/data-table';
import { SearchInput } from '@/components/shared/forms/search-input';
import { ErrorState } from '@/components/common/error-state';
import { useDataTable } from '@/hooks/use-data-table';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import {
  useDeleteWorkflowDefinition,
  usePublishWorkflowDefinition,
  useArchiveWorkflowDefinition,
  useCloneWorkflowDefinition,
  useCreateWorkflowDefinition,
} from '@/hooks/use-workflow-definitions';
import { getDefinitionColumns } from './definition-columns';
import { DefinitionKpiCards } from '../_components/definition-kpi-cards';
import { apiGet } from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import type { WorkflowDefinition } from '@/types/models';
import type { PaginatedResponse } from '@/types/api';
import { useAdminT } from '../../../_lib/admin-i18n';
import {
  getDefinitionFilters,
  getDefinitionLabels,
} from '../definition-i18n';

export function DefinitionList({ hideHeader = false }: { hideHeader?: boolean } = {}) {
  const labels = useAdminT();
  const { locale } = useLocaleOrDefault();
  const localLabels = getDefinitionLabels(locale);
  const w = labels.workflowDef;
  const router = useRouter();
  const [deleteTarget, setDeleteTarget] = useState<WorkflowDefinition | null>(null);
  const [publishTarget, setPublishTarget] = useState<WorkflowDefinition | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<WorkflowDefinition | null>(null);

  const deleteMutation = useDeleteWorkflowDefinition();
  const publishMutation = usePublishWorkflowDefinition();
  const archiveMutation = useArchiveWorkflowDefinition();
  const cloneMutation = useCloneWorkflowDefinition();
  const createMutation = useCreateWorkflowDefinition();

  const table = useDataTable<WorkflowDefinition>({
    queryKey: 'workflow-definitions',
    defaultPageSize: 25,
    defaultSort: { column: 'updated_at', direction: 'desc' },
    fetchFn: (params) =>
      apiGet<PaginatedResponse<WorkflowDefinition>>(
        API_ENDPOINTS.WORKFLOWS_DEFINITIONS,
        {
          page: params.page,
          per_page: params.per_page,
          sort: params.sort ?? 'updated_at',
          order: params.order ?? 'desc',
          search: params.search,
          ...(params.filters?.status
            ? {
                status: Array.isArray(params.filters.status)
                  ? params.filters.status.join(',')
                  : params.filters.status,
              }
            : {}),
          ...(params.filters?.category
            ? {
                category: Array.isArray(params.filters.category)
                  ? params.filters.category.join(',')
                  : params.filters.category,
              }
            : {}),
        },
      ),
  });

  const columns = getDefinitionColumns({
    labels: localLabels,
    locale,
    onEdit: (def) =>
      router.push(`/admin/workflows/definitions/${def.id}/designer`),
    onView: (def) =>
      router.push(`/admin/workflows/definitions/${def.id}`),
    onPublish: (def) => setPublishTarget(def),
    onArchive: (def) => setArchiveTarget(def),
    onClone: (def) => cloneMutation.mutate(def.id),
    onDelete: (def) => setDeleteTarget(def),
  });

  function handleCreate() {
    const defaultName = `${localLabels.defaults.workflowName} ${new Date()
      .toISOString()
      .replace(/\D/g, '')}`;
    createMutation.mutate(
      {
        name: defaultName,
        description: '',
        category: 'custom',
        trigger_config: { type: 'manual' },
        // Seed a publishable default: a "Start" human task that transitions to an
        // end step. This satisfies the engine's validation rules (>=2 steps,
        // exactly one end step, human_task requires form_fields + assignee_role)
        // so a brand-new workflow can be published with zero designer edits.
        steps: [
          {
            id: 'start',
            type: 'human_task',
            name: localLabels.defaults.startStep,
            config: {
              assignee_role: 'admin',
              form_fields: [],
            },
            transitions: [{ target: 'end' }],
          },
          {
            id: 'end',
            type: 'end',
            name: localLabels.defaults.endStep,
            config: {},
            transitions: [],
          },
        ],
        variables: {},
      },
      {
        onSuccess: (newDef) => {
          router.push(`/admin/workflows/definitions/${newDef.id}/designer`);
        },
      },
    );
  }

  if (table.error) {
    return (
      <div className="space-y-6">
        {!hideHeader && (
          <PageHeader
            eyebrow={labels.workflowDef.eyebrow}
            title={labels.workflowDef.listTitle}
            description={labels.workflowDef.listDescription}
          />
        )}
        <ErrorState
          message={labels.workflowDef.loadListFailed}
          onRetry={() => table.refetch()}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {!hideHeader && (
        <PageHeader
          eyebrow={labels.workflowDef.eyebrow}
          title={labels.workflowDef.listTitle}
          description={labels.workflowDef.listDescription}
          actions={
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => router.push('/admin/workflows/templates')}
              >
                <Layout className="me-1.5 h-3.5 w-3.5" />
                {labels.workflowDef.fromTemplate}
              </Button>
              <Button size="sm" onClick={handleCreate} disabled={createMutation.isPending}>
                <Plus className="me-1.5 h-3.5 w-3.5" />
                {labels.workflowDef.createDefinition}
              </Button>
            </div>
          }
        />
      )}

      <DefinitionKpiCards />

      <DataTable
        columns={columns}
        filters={getDefinitionFilters(locale)}
        searchSlot={
          <SearchInput
            value={table.searchValue}
            onChange={table.setSearch}
            placeholder={labels.workflowDef.searchDefinitions}
          />
        }
        {...table.tableProps}
        onRowClick={(row) =>
          router.push(`/admin/workflows/definitions/${row.id}`)
        }
        emptyState={{
          icon: Layout,
          title: w.noDefinitionsTitle,
          description: w.noDefinitionsDesc,
          action: {
            label: w.createDefinition,
            onClick: handleCreate,
            icon: Plus,
          },
        }}
      />

      {/* Delete confirmation */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{labels.workflowDef.deleteTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {w.deleteConfirm.replace('{name}', deleteTarget?.name ?? '')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{labels.workflowDef.cancel}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deleteTarget) {
                  deleteMutation.mutate(deleteTarget.id, {
                    onSuccess: () => setDeleteTarget(null),
                  });
                }
              }}
            >
              {labels.workflowDef.delete}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Publish confirmation */}
      <AlertDialog
        open={!!publishTarget}
        onOpenChange={(open) => {
          if (!open) setPublishTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{labels.workflowDef.publishTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {w.publishConfirm.replace('{name}', publishTarget?.name ?? '')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{labels.workflowDef.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (publishTarget) {
                  publishMutation.mutate(publishTarget.id, {
                    onSuccess: () => setPublishTarget(null),
                  });
                }
              }}
            >
              {labels.workflowDef.publish}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Archive confirmation */}
      <AlertDialog
        open={!!archiveTarget}
        onOpenChange={(open) => {
          if (!open) setArchiveTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{labels.workflowDef.archiveTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {w.archiveConfirm.replace('{name}', archiveTarget?.name ?? '')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{labels.workflowDef.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (archiveTarget) {
                  archiveMutation.mutate(archiveTarget.id, {
                    onSuccess: () => setArchiveTarget(null),
                  });
                }
              }}
            >
              {labels.workflowDef.archive}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
