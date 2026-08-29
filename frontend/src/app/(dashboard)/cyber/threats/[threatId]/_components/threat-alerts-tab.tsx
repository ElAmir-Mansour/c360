'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { apiGet } from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { formatDateTime } from '@/lib/utils';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { ErrorState } from '@/components/common/error-state';
import { EmptyState } from '@/components/common/empty-state';
import { DataTable } from '@/components/shared/data-table/data-table';
import { SeverityIndicator } from '@/components/shared/severity-indicator';
import { StatusBadge } from '@/components/shared/status-badge';
import { alertStatusConfig } from '@/lib/status-configs';
import { AlertTriangle } from 'lucide-react';
import type { CyberAlert } from '@/types/cyber';
import { useThreatLabels } from '../../_lib/threats-i18n';

interface ThreatAlertsTabProps {
  threatId: string;
}

export function ThreatAlertsTab({ threatId }: ThreatAlertsTabProps) {
  const t = useThreatLabels();
  const router = useRouter();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['threat-alerts', threatId],
    queryFn: () => apiGet<{ data: CyberAlert[] }>(API_ENDPOINTS.CYBER_THREAT_ALERTS(threatId)),
  });

  const alerts = data?.data ?? [];
  const columns = useMemo<ColumnDef<CyberAlert>[]>(() => [
    {
      id: 'title',
      accessorKey: 'title',
      header: t.alertsTab.colAlert,
      cell: ({ row }) => (
        <div className="space-y-1">
          <p className="font-medium">{row.original.title}</p>
          <p className="text-xs text-muted-foreground">{row.original.asset_name ?? row.original.source}</p>
        </div>
      ),
    },
    {
      id: 'severity',
      accessorKey: 'severity',
      header: t.alertsTab.colSeverity,
      cell: ({ row }) => <SeverityIndicator severity={row.original.severity} showLabel />,
    },
    {
      id: 'status',
      accessorKey: 'status',
      header: t.alertsTab.colStatus,
      cell: ({ row }) => <StatusBadge status={row.original.status} config={alertStatusConfig} />,
    },
    {
      id: 'confidence_score',
      accessorKey: 'confidence_score',
      header: t.alertsTab.colConfidence,
      cell: ({ row }) => (
        <span className="tabular-nums text-sm text-muted-foreground">
          {Math.round((row.original.confidence_score ?? 0) * 100)}%
        </span>
      ),
    },
    {
      id: 'mitre_technique_name',
      accessorKey: 'mitre_technique_name',
      header: t.alertsTab.colMitreTechnique,
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {row.original.mitre_technique_name ?? row.original.mitre_technique_id ?? '—'}
        </span>
      ),
    },
    {
      id: 'created_at',
      accessorKey: 'created_at',
      header: t.alertsTab.colCreated,
      cell: ({ row }) => <span className="text-xs text-muted-foreground">{formatDateTime(row.original.created_at)}</span>,
    },
  ], [t.alertsTab]);

  if (isLoading) return <LoadingSkeleton variant="card" />;
  if (error) return <ErrorState message={t.alertsTab.failedToLoad} onRetry={() => void refetch()} />;

  if (alerts.length === 0) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title={t.alertsTab.emptyTitle}
        description={t.alertsTab.emptyDescription}
      />
    );
  }

  return (
    <DataTable
      columns={columns}
      data={alerts}
      totalRows={alerts.length}
      page={1}
      pageSize={Math.max(alerts.length, 1)}
      onPageChange={() => undefined}
      onPageSizeChange={() => undefined}
      onSortChange={() => undefined}
      onRowClick={(row) => router.push(`/cyber/alerts/${row.id}`)}
      enableColumnToggle={false}
    />
  );
}
