'use client';

import { useState } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { RelativeTime } from '@/components/shared/relative-time';
import { StatCard, type StatTone } from '@/components/shared/stat-card';
import { DataTable } from '@/components/shared/data-table/data-table';
import { useDataTable } from '@/hooks/use-data-table';
import { enterpriseApi } from '@/lib/enterprise';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { showApiError, showSuccess } from '@/lib/toast';
import type { FilterConfig } from '@/types/table';
import type { VisusExecutiveAlert } from '@/types/suites';
import { DismissAlertDialog } from './_components/dismiss-alert-dialog';
import {
  pickEnumLabel,
  useVisusAlertsPageLabels,
  useVisusEnumLabels,
  useVisusListLabels,
} from '../_lib/visus-i18n';

export default function VisusAlertsPage() {
  const t = useVisusListLabels().alerts;
  const p = useVisusAlertsPageLabels();
  const enums = useVisusEnumLabels();
  const alertFilters: FilterConfig[] = [
    {
      key: 'severity',
      label: p.filterSeverity,
      type: 'select',
      options: (['critical', 'high', 'medium', 'low', 'info'] as const).map((value) => ({
        label: pickEnumLabel(enums.severity, value),
        value,
      })),
    },
    {
      key: 'status',
      label: p.filterStatus,
      type: 'select',
      options: (['new', 'viewed', 'acknowledged', 'actioned', 'dismissed', 'escalated'] as const).map(
        (value) => ({ label: pickEnumLabel(enums.alertStatus, value), value }),
      ),
    },
    {
      key: 'category',
      label: p.filterCategory,
      type: 'select',
      options: (
        ['risk', 'compliance', 'data_quality', 'governance', 'legal', 'operational', 'financial', 'strategic'] as const
      ).map((value) => ({ label: pickEnumLabel(enums.alertCategory, value), value })),
    },
  ];
  const queryClient = useQueryClient();
  const [dismissTarget, setDismissTarget] = useState<VisusExecutiveAlert | null>(null);
  const { tableProps } = useDataTable<VisusExecutiveAlert>({
    queryKey: 'visus-alerts',
    fetchFn: (params) => enterpriseApi.visus.listAlerts(params),
    defaultPageSize: 25,
    defaultSort: { column: 'created_at', direction: 'desc' },
  });
  const statsQuery = useQuery({
    queryKey: ['visus-alert-stats'],
    queryFn: () => enterpriseApi.visus.getAlertStats(),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, status, dismiss_reason }: { id: string; status: VisusExecutiveAlert['status']; dismiss_reason?: string }) =>
      enterpriseApi.visus.updateAlertStatus(id, { status, dismiss_reason }),
    onSuccess: async () => {
      showSuccess(p.toastUpdated);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['visus-alerts'] }),
        queryClient.invalidateQueries({ queryKey: ['visus-alert-stats'] }),
      ]);
    },
    onError: showApiError,
  });

  const handleDismissConfirm = (id: string, dismissReason?: string) => {
    updateMutation.mutate({ id, status: 'dismissed', dismiss_reason: dismissReason });
    setDismissTarget(null);
  };

  const columns: ColumnDef<VisusExecutiveAlert>[] = [
    {
      id: 'title',
      accessorKey: 'title',
      header: p.colAlert,
      enableSorting: true,
      cell: ({ row }) => (
        <div>
          <p className="font-medium">{row.original.title}</p>
          <p className="text-xs text-muted-foreground">{row.original.description}</p>
        </div>
      ),
    },
    {
      id: 'severity',
      accessorKey: 'severity',
      header: p.colSeverity,
      enableSorting: true,
      cell: ({ row }) => (
        <Badge variant={severityVariant(row.original.severity)}>
          {pickEnumLabel(enums.severity, row.original.severity)}
        </Badge>
      ),
    },
    {
      id: 'category',
      accessorKey: 'category',
      header: p.colCategory,
      enableSorting: true,
      cell: ({ row }) => <Badge variant="outline">{pickEnumLabel(enums.alertCategory, row.original.category)}</Badge>,
    },
    {
      id: 'status',
      accessorKey: 'status',
      header: p.colStatus,
      enableSorting: true,
      cell: ({ row }) => <Badge variant="outline">{pickEnumLabel(enums.alertStatus, row.original.status)}</Badge>,
    },
    {
      id: 'created_at',
      accessorKey: 'created_at',
      header: p.colCreated,
      enableSorting: true,
      cell: ({ row }) => <RelativeTime date={row.original.created_at} />,
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => updateMutation.mutate({ id: row.original.id, status: 'acknowledged' })}>
            {p.acknowledge}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setDismissTarget(row.original)}>
            {p.dismiss}
          </Button>
        </div>
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
            { label: t.tag(statsQuery.data?.total ?? 0), icon: <Bell className="h-3.5 w-3.5" aria-hidden /> },
          ]}
        />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {Object.entries(statsQuery.data?.by_severity ?? {}).map(([severity, count]) => (
            <StatCard
              key={severity}
              label={pickEnumLabel(enums.severity, severity)}
              value={count}
              icon={Bell}
              tone={severityTone(severity)}
            />
          ))}
        </div>
        <DataTable
          {...tableProps}
          columns={columns}
          filters={alertFilters}
          searchPlaceholder={t.searchPlaceholder}
          emptyState={{
            icon: Bell,
            title: t.emptyTitle,
            description: t.emptyDescription,
          }}
        />
      </div>
      <DismissAlertDialog
        alert={dismissTarget}
        open={dismissTarget !== null}
        onOpenChange={(open) => { if (!open) setDismissTarget(null); }}
        onConfirm={handleDismissConfirm}
      />
    </PermissionRedirect>
  );
}

function severityVariant(severity: string): 'default' | 'warning' | 'destructive' | 'outline' {
  if (severity === 'critical' || severity === 'high') return 'destructive';
  if (severity === 'medium') return 'warning';
  if (severity === 'low') return 'default';
  return 'outline';
}

/** Map an alert severity onto the Stream-E tonal stat palette. */
function severityTone(severity: string): StatTone {
  if (severity === 'critical' || severity === 'high') return 'rose';
  if (severity === 'medium') return 'gold';
  if (severity === 'low') return 'emerald';
  return 'sky';
}
