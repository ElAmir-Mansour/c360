'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ColumnDef } from '@tanstack/react-table';
import { CopyPlus, LayoutDashboard, Pencil, Plus, Share2, Trash2 } from 'lucide-react';
import { useDataTable } from '@/hooks/use-data-table';
import { PageHeader } from '@/components/common/page-header';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { RelativeTime } from '@/components/shared/relative-time';
import { DataTable } from '@/components/shared/data-table/data-table';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { enterpriseApi } from '@/lib/enterprise';
import { showApiError, showSuccess } from '@/lib/toast';
import type { FilterConfig, RowAction } from '@/types/table';
import type { UserDirectoryEntry, VisusDashboard } from '@/types/suites';
import { DashboardFormDialog } from './_components/dashboard-form-dialog';
import { DashboardShareDialog } from './_components/dashboard-share-dialog';
import {
  pickEnumLabel,
  useVisusDashboardsPageLabels,
  useVisusEnumLabels,
  useVisusListLabels,
} from '../_lib/visus-i18n';

function visibilityVariant(value: VisusDashboard['visibility']): 'default' | 'secondary' | 'outline' {
  if (value === 'public') return 'default';
  if (value === 'organization') return 'secondary';
  return 'outline';
}

export default function VisusDashboardsPage() {
  const t = useVisusListLabels().dashboards;
  const p = useVisusDashboardsPageLabels();
  const enums = useVisusEnumLabels();
  const dashboardFilters: FilterConfig[] = [
    {
      key: 'visibility',
      label: p.filterVisibility,
      type: 'select',
      options: [
        { label: pickEnumLabel(enums.visibility, 'private'), value: 'private' },
        { label: pickEnumLabel(enums.visibility, 'team'), value: 'team' },
        { label: pickEnumLabel(enums.visibility, 'organization'), value: 'organization' },
        { label: pickEnumLabel(enums.visibility, 'public'), value: 'public' },
      ],
    },
  ];
  const router = useRouter();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<VisusDashboard | null>(null);
  const [shareTarget, setShareTarget] = useState<VisusDashboard | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<VisusDashboard | null>(null);

  const usersQuery = useQuery({
    queryKey: ['visus-dashboard-users'],
    queryFn: () => enterpriseApi.users.list({ page: 1, per_page: 200, sort: 'first_name', order: 'asc' }),
  });

  const { tableProps, refetch } = useDataTable<VisusDashboard>({
    queryKey: 'visus-dashboards',
    fetchFn: (params) => enterpriseApi.visus.listDashboards(params),
    defaultPageSize: 25,
    defaultSort: { column: 'updated_at', direction: 'desc' },
  });

  const createMutation = useMutation({
    mutationFn: enterpriseApi.visus.createDashboard,
    onSuccess: async () => {
      showSuccess(p.toastCreated);
      setCreateOpen(false);
      await queryClient.invalidateQueries({ queryKey: ['visus-dashboards'] });
      refetch();
    },
    onError: showApiError,
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: unknown }) => enterpriseApi.visus.updateDashboard(id, payload),
    onSuccess: async () => {
      showSuccess(p.toastUpdated);
      setEditTarget(null);
      await queryClient.invalidateQueries({ queryKey: ['visus-dashboards'] });
      refetch();
    },
    onError: showApiError,
  });

  const shareMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: unknown }) => enterpriseApi.visus.shareDashboard(id, payload),
    onSuccess: async () => {
      showSuccess(p.toastAccessUpdated);
      setShareTarget(null);
      await queryClient.invalidateQueries({ queryKey: ['visus-dashboards'] });
      refetch();
    },
    onError: showApiError,
  });

  const duplicateMutation = useMutation({
    mutationFn: (id: string) => enterpriseApi.visus.duplicateDashboard(id),
    onSuccess: async () => {
      showSuccess(p.toastDuplicated);
      await queryClient.invalidateQueries({ queryKey: ['visus-dashboards'] });
      refetch();
    },
    onError: showApiError,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => enterpriseApi.visus.deleteDashboard(id),
    onSuccess: async () => {
      showSuccess(p.toastDeleted);
      setDeleteTarget(null);
      await queryClient.invalidateQueries({ queryKey: ['visus-dashboards'] });
      refetch();
    },
    onError: showApiError,
  });

  const columns: ColumnDef<VisusDashboard>[] = [
    {
      id: 'name',
      accessorKey: 'name',
      header: p.colDashboard,
      enableSorting: true,
      cell: ({ row }) => (
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Link href={`/visus/dashboards/${row.original.id}`} className="font-medium hover:underline">
              {row.original.name}
            </Link>
            {row.original.is_default ? <Badge variant="secondary">{p.badgeDefault}</Badge> : null}
            {row.original.is_system ? <Badge variant="outline">{p.badgeSystem}</Badge> : null}
          </div>
          <p className="max-w-xl text-xs text-muted-foreground">{row.original.description}</p>
        </div>
      ),
    },
    {
      id: 'visibility',
      accessorKey: 'visibility',
      header: p.colVisibility,
      enableSorting: true,
      cell: ({ row }) => (
        <Badge variant={visibilityVariant(row.original.visibility)}>
          {pickEnumLabel(enums.visibility, row.original.visibility)}
        </Badge>
      ),
    },
    {
      id: 'widget_count',
      accessorKey: 'widget_count',
      header: p.colWidgets,
      cell: ({ row }) => <span className="text-sm">{row.original.widget_count ?? 0}</span>,
    },
    {
      id: 'updated_at',
      accessorKey: 'updated_at',
      header: p.colUpdated,
      enableSorting: true,
      cell: ({ row }) => <RelativeTime date={row.original.updated_at} />,
    },
  ];

  const rowActions: RowAction<VisusDashboard>[] = [
    {
      label: p.actionOpen,
      icon: LayoutDashboard,
      onClick: (row) => {
        router.push(`/visus/dashboards/${row.id}`);
      },
    },
    {
      label: p.actionEdit,
      icon: Pencil,
      onClick: (row) => setEditTarget(row),
      disabled: (row) => row.is_system,
    },
    {
      label: p.actionShare,
      icon: Share2,
      onClick: (row) => setShareTarget(row),
    },
    {
      label: p.actionDuplicate,
      icon: CopyPlus,
      onClick: (row) => duplicateMutation.mutate(row.id),
    },
    {
      label: p.actionDelete,
      icon: Trash2,
      variant: 'destructive',
      onClick: (row) => setDeleteTarget(row),
      hidden: (row) => row.is_system,
    },
  ];

  const users = usersQuery.data?.data ?? ([] as UserDirectoryEntry[]);

  return (
    <PermissionRedirect permission="visus:read">
      <div className="space-y-6">
        <PageHeader
          eyebrow={t.eyebrow}
          title={t.title}
          description={t.description}
          tags={[
            { label: t.tag(tableProps.totalRows), icon: <LayoutDashboard className="h-3.5 w-3.5" aria-hidden />, tone: 'info' },
          ]}
          actions={
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="me-2 h-4 w-4" />
              {t.create}
            </Button>
          }
        />

        <DataTable
          {...tableProps}
          columns={columns}
          filters={dashboardFilters}
          rowActions={rowActions}
          searchPlaceholder={t.searchPlaceholder}
          onRowClick={(row) => {
            router.push(`/visus/dashboards/${row.id}`);
          }}
          emptyState={{
            icon: LayoutDashboard,
            title: t.emptyTitle,
            description: t.emptyDescription,
            action: {
              label: t.create,
              onClick: () => setCreateOpen(true),
              icon: Plus,
            },
          }}
        />

        <DashboardFormDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          users={users}
          pending={createMutation.isPending}
          onSubmit={async (payload) => {
            await createMutation.mutateAsync(payload);
          }}
        />

        <DashboardFormDialog
          open={Boolean(editTarget)}
          onOpenChange={(open) => {
            if (!open) setEditTarget(null);
          }}
          dashboard={editTarget}
          users={users}
          pending={updateMutation.isPending}
          onSubmit={async (payload) => {
            if (!editTarget) return;
            await updateMutation.mutateAsync({ id: editTarget.id, payload });
          }}
        />

        <DashboardShareDialog
          open={Boolean(shareTarget)}
          onOpenChange={(open) => {
            if (!open) setShareTarget(null);
          }}
          dashboard={shareTarget}
          users={users}
          pending={shareMutation.isPending}
          onSubmit={async (payload) => {
            if (!shareTarget) return;
            await shareMutation.mutateAsync({ id: shareTarget.id, payload });
          }}
        />

        <ConfirmDialog
          open={Boolean(deleteTarget)}
          onOpenChange={(open) => {
            if (!open) setDeleteTarget(null);
          }}
          title={p.deleteTitle}
          description={p.deleteDescription(deleteTarget?.name ?? '')}
          confirmLabel={p.deleteConfirm}
          variant="destructive"
          loading={deleteMutation.isPending}
          onConfirm={async () => {
            if (!deleteTarget) return;
            await deleteMutation.mutateAsync(deleteTarget.id);
          }}
        />
      </div>
    </PermissionRedirect>
  );
}
