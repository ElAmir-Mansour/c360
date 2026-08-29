'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { Edit3, Eye, Plus, Power, Trash2, Users } from 'lucide-react';
import { toast } from 'sonner';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { PageHeader } from '@/components/common/page-header';
import { PermissionGate } from '@/components/auth/permission-gate';
import { ActorFormDialog } from '@/components/cyber/cti/actor-form-dialog';
import { ExportMenu } from '@/components/cyber/export-menu';
import { DataTable } from '@/components/shared/data-table/data-table';
import { selectColumn } from '@/components/shared/data-table/columns/common-columns';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/use-auth';
import { useDataTable } from '@/hooks/use-data-table';
import {
  deleteThreatActor,
  fetchThreatActors,
  flattenThreatActorFetchParams,
  updateThreatActor,
} from '@/lib/cti-api';
import { API_ENDPOINTS, ROUTES } from '@/lib/constants';
import { countryCodeToFlag, formatRelativeTime } from '@/lib/cti-utils';
import { type CTIThreatActor } from '@/types/cti';
import type { PaginatedResponse } from '@/types/api';
import type { BulkAction, FetchParams, FilterConfig, RowAction } from '@/types/table';
import { useCtiLabels } from '../_lib/cti-i18n';

function fetchActorRows(params: FetchParams): Promise<PaginatedResponse<CTIThreatActor>> {
  return fetchThreatActors(flattenThreatActorFetchParams(params));
}

export default function CTIActorsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { actors: t, enumLabels } = useCtiLabels();
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('cyber:write');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editingActor, setEditingActor] = useState<CTIThreatActor | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<CTIThreatActor | null>(null);

  const { tableProps, refetch } = useDataTable<CTIThreatActor>({
    fetchFn: fetchActorRows,
    queryKey: 'cti-actors',
    defaultPageSize: 25,
    defaultSort: { column: 'risk_score', direction: 'desc' },
  });

  const setActorsInCache = (
    updater: (actor: CTIThreatActor) => CTIThreatActor | null,
  ): Array<[readonly unknown[], unknown]> => {
    const snapshots = queryClient.getQueriesData({ queryKey: ['cti-actors'] });
    queryClient.setQueriesData<PaginatedResponse<CTIThreatActor>>(
      { queryKey: ['cti-actors'] },
      (current) => {
        if (!current) {
          return current;
        }

        return {
          ...current,
          data: current.data
            .map((actor) => updater(actor))
            .filter((actor): actor is CTIThreatActor => actor !== null),
        };
      },
    );
    return snapshots;
  };

  const restoreSnapshots = (snapshots?: Array<[readonly unknown[], unknown]>) => {
    snapshots?.forEach(([key, value]) => queryClient.setQueryData(key, value));
  };

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ ids, isActive }: { ids: string[]; isActive: boolean }) => {
      await Promise.all(ids.map((id) => updateThreatActor(id, { is_active: isActive })));
    },
    onMutate: async ({ ids, isActive }) => {
      const snapshots = setActorsInCache((actor) => (
        ids.includes(actor.id)
          ? {
              ...actor,
              is_active: isActive,
            }
          : actor
      ));
      return { snapshots };
    },
    onError: (_error, _variables, context) => {
      restoreSnapshots(context?.snapshots);
      toast.error(t.statusUpdateFailed);
    },
    onSuccess: async (_result, variables) => {
      await queryClient.invalidateQueries({ queryKey: ['cti-actors'] });
      toast.success(t.updated(variables.ids.length));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async ({ ids }: { ids: string[] }) => {
      await Promise.all(ids.map((id) => deleteThreatActor(id)));
    },
    onMutate: async ({ ids }) => {
      const snapshots = setActorsInCache((actor) => (ids.includes(actor.id) ? null : actor));
      return { snapshots };
    },
    onError: (_error, _variables, context) => {
      restoreSnapshots(context?.snapshots);
      toast.error(t.deleteFailed);
    },
    onSuccess: async (_result, variables) => {
      await queryClient.invalidateQueries({ queryKey: ['cti-actors'] });
      toast.success(t.deleted(variables.ids.length));
      setSelectedIds([]);
    },
  });

  const filters = useMemo<FilterConfig[]>(
    () => [
      {
        key: 'actor_type',
        label: t.filterActorType,
        type: 'multi-select',
        options: [
          { label: t.typeStateSponsored, value: 'state_sponsored' },
          { label: t.typeCybercriminal, value: 'cybercriminal' },
          { label: t.typeHacktivist, value: 'hacktivist' },
          { label: t.typeInsider, value: 'insider' },
          { label: t.typeUnknown, value: 'unknown' },
        ],
      },
      {
        key: 'sophistication',
        label: t.filterSophistication,
        type: 'multi-select',
        options: [
          { label: t.sophAdvanced, value: 'advanced' },
          { label: t.sophIntermediate, value: 'intermediate' },
          { label: t.sophBasic, value: 'basic' },
        ],
      },
      {
        key: 'is_active',
        label: t.filterActive,
        type: 'select',
        options: [
          { label: t.active, value: 'true' },
          { label: t.inactive, value: 'false' },
        ],
      },
    ],
    [t],
  );

  const rowActions = useMemo<RowAction<CTIThreatActor>[]>(() => {
    const baseActions: RowAction<CTIThreatActor>[] = [
      {
        label: t.viewActor,
        icon: Eye,
        onClick: (actor) => router.push(`${ROUTES.CYBER_CTI_ACTORS}/${actor.id}`),
      },
    ];

    if (!canWrite) {
      return baseActions;
    }

    return [
      ...baseActions,
      {
        label: t.editActor,
        icon: Edit3,
        onClick: (actor) => setEditingActor(actor),
      },
      {
        label: t.toggleActive,
        icon: Power,
        onClick: (actor) => toggleActiveMutation.mutate({ ids: [actor.id], isActive: !actor.is_active }),
      },
      {
        label: t.deleteActor,
        icon: Trash2,
        variant: 'destructive',
        onClick: (actor) => setDeleteCandidate(actor),
      },
    ];
  }, [canWrite, router, toggleActiveMutation, t]);

  const bulkActions = useMemo<BulkAction[]>(() => {
    if (!canWrite) {
      return [];
    }

    return [
      {
        label: t.activateSelected,
        onClick: async (ids) => toggleActiveMutation.mutateAsync({ ids, isActive: true }),
      },
      {
        label: t.deactivateSelected,
        onClick: async (ids) => toggleActiveMutation.mutateAsync({ ids, isActive: false }),
      },
      {
        label: t.deleteSelected,
        variant: 'destructive',
        onClick: async (ids) => deleteMutation.mutateAsync({ ids }),
      },
    ];
  }, [canWrite, deleteMutation, toggleActiveMutation, t]);

  const columns = useMemo<ColumnDef<CTIThreatActor>[]>(() => {
    const base: ColumnDef<CTIThreatActor>[] = [
      {
        accessorKey: 'name',
        header: t.colActor,
        enableSorting: true,
        size: 260,
        cell: ({ row }) => (
          <div className="space-y-1">
            <Link
              href={`${ROUTES.CYBER_CTI_ACTORS}/${row.original.id}`}
              className="font-medium text-foreground hover:underline"
              onClick={(event) => event.stopPropagation()}
            >
              {row.original.name}
            </Link>
            <p className="line-clamp-1 text-xs text-muted-foreground">
              {row.original.aliases.length > 0 ? row.original.aliases.join(', ') : t.noAliases}
            </p>
          </div>
        ),
      },
      {
        accessorKey: 'actor_type',
        header: t.colType,
        enableSorting: true,
        cell: ({ row }) => enumLabels.actorType[row.original.actor_type] ?? row.original.actor_type,
      },
      {
        accessorKey: 'origin_country_code',
        header: t.colOrigin,
        enableSorting: true,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {countryCodeToFlag(row.original.origin_country_code)} {row.original.origin_country_code?.toUpperCase() ?? t.unknown}
          </span>
        ),
      },
      {
        accessorKey: 'sophistication_level',
        header: t.colSophistication,
        enableSorting: true,
        cell: ({ row }) => enumLabels.sophistication[row.original.sophistication_level],
      },
      {
        accessorKey: 'primary_motivation',
        header: t.colMotivation,
        enableSorting: true,
        cell: ({ row }) => enumLabels.motivation[row.original.primary_motivation] ?? row.original.primary_motivation,
      },
      {
        accessorKey: 'risk_score',
        header: t.colRisk,
        enableSorting: true,
        cell: ({ row }) => <span className="font-medium tabular-nums">{row.original.risk_score.toFixed(1)}</span>,
      },
      {
        accessorKey: 'is_active',
        header: t.colStatus,
        enableSorting: true,
        cell: ({ row }) => (
          <span className={row.original.is_active ? 'text-primary' : 'text-muted-foreground'}>
            {row.original.is_active ? t.active : t.inactive}
          </span>
        ),
      },
      {
        accessorKey: 'last_activity_at',
        header: t.colLastActivity,
        enableSorting: true,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {formatRelativeTime(row.original.last_activity_at)}
          </span>
        ),
      },
    ];

    return canWrite ? [selectColumn<CTIThreatActor>(), ...base] : base;
  }, [canWrite, enumLabels, t]);

  return (
    <PermissionRedirect permission="cyber:read">
      <div className="space-y-6">
        <PageHeader
          title={t.title}
          description={t.description}
          actions={(
            <div className="flex flex-wrap items-center gap-2">
              <ExportMenu
                entityType="cti-actors"
                baseUrl={API_ENDPOINTS.CTI_ACTORS}
                currentFilters={{ ...tableProps.activeFilters, search: tableProps.searchValue ?? '' }}
                totalCount={tableProps.totalRows}
                enabledFormats={['csv', 'json']}
                selectedCount={selectedIds.length}
              />
              <PermissionGate permission="cyber:write">
                <Button size="sm" onClick={() => setFormOpen(true)}>
                  <Plus className="me-1.5 h-3.5 w-3.5" />
                  {t.newActor}
                </Button>
              </PermissionGate>
            </div>
          )}
        />

        <DataTable
          {...tableProps}
          columns={columns}
          filters={filters}
          getRowId={(row) => row.id}
          enableSelection={canWrite}
          onSelectionChange={setSelectedIds}
          bulkActions={bulkActions}
          rowActions={rowActions}
          searchPlaceholder={t.searchPlaceholder}
          emptyState={{
            icon: Users,
            title: t.emptyTitle,
            description: t.emptyDescription,
            action: canWrite
              ? { label: t.createActor, onClick: () => setFormOpen(true), icon: Plus }
              : undefined,
          }}
          onRowClick={(row) => router.push(`${ROUTES.CYBER_CTI_ACTORS}/${row.id}`)}
        />
      </div>

      <ActorFormDialog
        open={formOpen || Boolean(editingActor)}
        onOpenChange={(open) => {
          if (!open) {
            setFormOpen(false);
            setEditingActor(null);
          }
        }}
        actor={editingActor}
        onSuccess={() => {
          setFormOpen(false);
          setEditingActor(null);
          void refetch();
        }}
      />

      <ConfirmDialog
        open={Boolean(deleteCandidate)}
        onOpenChange={(open) => !open && setDeleteCandidate(null)}
        title={t.deleteTitle}
        description={t.deleteDescription}
        confirmLabel={t.deleteConfirm}
        variant="destructive"
        typeToConfirm={deleteCandidate?.name}
        loading={deleteMutation.isPending}
        onConfirm={async () => {
          if (!deleteCandidate) {
            return;
          }
          await deleteMutation.mutateAsync({ ids: [deleteCandidate.id] });
          setDeleteCandidate(null);
        }}
      />
    </PermissionRedirect>
  );
}
