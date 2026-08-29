'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ColumnDef } from '@tanstack/react-table';
import { Edit, Eye, FileBarChart, PlayCircle, Plus, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { RelativeTime } from '@/components/shared/relative-time';
import { DataTable } from '@/components/shared/data-table/data-table';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { Button } from '@/components/ui/button';
import { useDataTable } from '@/hooks/use-data-table';
import { enterpriseApi } from '@/lib/enterprise';
import { showApiError, showSuccess } from '@/lib/toast';
import type { FilterConfig, RowAction } from '@/types/table';
import type { UserDirectoryEntry, VisusReport, VisusReportGeneration } from '@/types/suites';
import { ReportFormDialog } from './_components/report-form-dialog';
import { ReportSnapshotsDialog } from './_components/report-snapshots-dialog';
import {
  pickEnumLabel,
  useVisusEnumLabels,
  useVisusListLabels,
  useVisusReportsPageLabels,
} from '../_lib/visus-i18n';

export default function VisusReportsPage() {
  const t = useVisusListLabels().reports;
  const p = useVisusReportsPageLabels();
  const enums = useVisusEnumLabels();
  const reportFilters: FilterConfig[] = [
    {
      key: 'report_type',
      label: p.filterType,
      type: 'select',
      options: [
        { label: pickEnumLabel(enums.reportType, 'executive_summary'), value: 'executive_summary' },
        { label: pickEnumLabel(enums.reportType, 'security_posture'), value: 'security_posture' },
        { label: pickEnumLabel(enums.reportType, 'data_intelligence'), value: 'data_intelligence' },
        { label: pickEnumLabel(enums.reportType, 'governance'), value: 'governance' },
        { label: pickEnumLabel(enums.reportType, 'legal'), value: 'legal' },
        { label: pickEnumLabel(enums.reportType, 'custom'), value: 'custom' },
      ],
    },
    {
      key: 'auto_send',
      label: p.filterAutoSend,
      type: 'select',
      options: [
        { label: pickEnumLabel(enums.enabledState, 'enabled'), value: 'true' },
        { label: pickEnumLabel(enums.enabledState, 'disabled'), value: 'false' },
      ],
    },
  ];
  const queryClient = useQueryClient();
  const [runningId, setRunningId] = useState<string | null>(null);
  const [previewReportId, setPreviewReportId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<VisusReport | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<VisusReport | null>(null);

  const { tableProps, refetch } = useDataTable<VisusReport>({
    queryKey: 'visus-reports',
    fetchFn: (params) => enterpriseApi.visus.listReports(params),
    defaultPageSize: 25,
    defaultSort: { column: 'updated_at', direction: 'desc' },
  });

  const usersQuery = useQuery({
    queryKey: ['visus-report-users'],
    queryFn: () => enterpriseApi.users.list({ page: 1, per_page: 200, sort: 'first_name', order: 'asc' }),
  });

  const createMutation = useMutation({
    mutationFn: enterpriseApi.visus.createReport,
    onSuccess: async () => {
      showSuccess(p.toastCreated);
      setCreateOpen(false);
      await queryClient.invalidateQueries({ queryKey: ['visus-reports'] });
      refetch();
    },
    onError: showApiError,
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: unknown }) => enterpriseApi.visus.updateReport(id, payload),
    onSuccess: async () => {
      showSuccess(p.toastUpdated);
      setEditTarget(null);
      await queryClient.invalidateQueries({ queryKey: ['visus-reports'] });
      refetch();
    },
    onError: showApiError,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => enterpriseApi.visus.deleteReport(id),
    onSuccess: async () => {
      showSuccess(p.toastDeleted);
      setDeleteTarget(null);
      await queryClient.invalidateQueries({ queryKey: ['visus-reports'] });
      refetch();
    },
    onError: showApiError,
  });

  const generateReport = async (report: VisusReport) => {
    try {
      setRunningId(report.id);
      const response: VisusReportGeneration = await enterpriseApi.visus.generateReport(report.id);
      showSuccess(p.toastGenerationStarted, p.generationQueued(response.id.slice(0, 8), report.name));
      refetch();
    } catch (error) {
      showApiError(error);
    } finally {
      setRunningId(null);
    }
  };

  const rowActions: RowAction<VisusReport>[] = [
    {
      label: p.actionViewSnapshots,
      icon: Eye,
      onClick: (row) => setPreviewReportId(row.id),
    },
    {
      label: p.actionEdit,
      icon: Edit,
      onClick: (row) => setEditTarget(row),
    },
    {
      label: p.actionDelete,
      icon: Trash2,
      variant: 'destructive',
      onClick: (row) => setDeleteTarget(row),
    },
  ];

  const columns: ColumnDef<VisusReport>[] = [
    {
      id: 'name',
      accessorKey: 'name',
      header: p.colReport,
      enableSorting: true,
      cell: ({ row }) => (
        <div>
          <p className="font-medium">{row.original.name}</p>
          <p className="text-xs text-muted-foreground">{pickEnumLabel(enums.reportType, row.original.report_type ?? 'custom')}</p>
        </div>
      ),
    },
    {
      id: 'schedule',
      accessorKey: 'schedule',
      header: p.colSchedule,
      cell: ({ row }) => <span className="text-sm text-muted-foreground">{row.original.schedule ?? p.onDemand}</span>,
    },
    {
      id: 'last_generated_at',
      accessorKey: 'last_generated_at',
      header: p.colLastGenerated,
      enableSorting: true,
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          {row.original.last_generated_at ? (
            <>
              <RelativeTime date={row.original.last_generated_at} />
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={(event) => { event.stopPropagation(); setPreviewReportId(row.original.id); }}>
                <Eye className="h-3.5 w-3.5" />
              </Button>
            </>
          ) : (
            <span className="text-sm text-muted-foreground">{p.never}</span>
          )}
        </div>
      ),
    },
    {
      id: 'total_generated',
      accessorKey: 'total_generated',
      header: p.colGenerations,
      cell: ({ row }) => <span className="text-sm">{row.original.total_generated}</span>,
    },
    {
      id: 'generate',
      header: '',
      cell: ({ row }) => (
        <Button
          variant="outline"
          size="sm"
          onClick={() => void generateReport(row.original)}
          disabled={runningId === row.original.id}
        >
          <PlayCircle className="me-1.5 h-3.5 w-3.5" />
          {runningId === row.original.id ? p.generating : p.generate}
        </Button>
      ),
    },
  ];

  return (
    <PermissionRedirect permission="visus:read">
      <div className="space-y-6">
        <PageHeader
          eyebrow={t.eyebrow}
          title={t.title}
          description={t.description}
          tags={[
            { label: t.tag(tableProps.totalRows), icon: <FileBarChart className="h-3.5 w-3.5" aria-hidden />, tone: 'primary' },
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
          filters={reportFilters}
          rowActions={rowActions}
          emptyState={{
            icon: FileBarChart,
            title: t.emptyTitle,
            description: t.emptyDescription,
          }}
        />
      </div>

      <ReportFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        users={(usersQuery.data?.data ?? []) as UserDirectoryEntry[]}
        pending={createMutation.isPending}
        onSubmit={async (payload) => {
          await createMutation.mutateAsync(payload);
        }}
      />

      <ReportFormDialog
        open={Boolean(editTarget)}
        onOpenChange={(open) => {
          if (!open) setEditTarget(null);
        }}
        report={editTarget}
        users={(usersQuery.data?.data ?? []) as UserDirectoryEntry[]}
        pending={updateMutation.isPending}
        onSubmit={async (payload) => {
          if (!editTarget) return;
          await updateMutation.mutateAsync({ id: editTarget.id, payload });
        }}
      />

      <ReportSnapshotsDialog
        reportId={previewReportId}
        open={previewReportId !== null}
        onOpenChange={(open) => {
          if (!open) setPreviewReportId(null);
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
    </PermissionRedirect>
  );
}
