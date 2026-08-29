'use client';

import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCheck, GitMerge, ShieldAlert, UserCheck } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/common/page-header';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { PermissionGate } from '@/components/auth/permission-gate';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { DataTable } from '@/components/shared/data-table/data-table';
import { useDataTable } from '@/hooks/use-data-table';
import { useAuth } from '@/hooks/use-auth';
import { apiGet, apiPut } from '@/lib/api';
import { API_ENDPOINTS, ROUTES } from '@/lib/constants';
import type { PaginatedResponse } from '@/types/api';
import type { BulkAction, FetchParams } from '@/types/table';
import type { CyberAlert, MITRETacticItem } from '@/types/cyber';

import { AlertAssignDialog } from './_components/alert-assign-dialog';
import { getAlertColumns } from './_components/alert-columns';
import { AlertEscalateDialog } from './_components/alert-escalate-dialog';
import { AlertFalsePositiveDialog } from './_components/alert-false-positive-dialog';
import { buildAlertFilters, flattenAlertFetchParams } from './_components/alert-filters';
import { AlertMergeDialog } from './_components/alert-merge-dialog';
import { AlertStatsBar } from './_components/alert-stats-bar';
import { useAlertLabels } from './_lib/alerts-i18n';

function fetchAlerts(params: FetchParams): Promise<PaginatedResponse<CyberAlert>> {
  return apiGet<PaginatedResponse<CyberAlert>>(
    API_ENDPOINTS.CYBER_ALERTS,
    flattenAlertFetchParams(params),
  );
}

export default function CyberAlertsPage() {
  const router = useRouter();
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('cyber:write');
  const t = useAlertLabels();

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [tableResetKey, setTableResetKey] = useState(0);
  const [assignTarget, setAssignTarget] = useState<CyberAlert | null>(null);
  const [assignBulkIds, setAssignBulkIds] = useState<string[]>([]);
  const [escalateTarget, setEscalateTarget] = useState<CyberAlert | null>(null);
  const [falsePositiveIds, setFalsePositiveIds] = useState<string[]>([]);
  const [mergeIds, setMergeIds] = useState<string[]>([]);
  const [ackTarget, setAckTarget] = useState<CyberAlert | null>(null);

  const { tableProps, setFilter, refetch } = useDataTable<CyberAlert>({
    fetchFn: fetchAlerts,
    queryKey: 'cyber-alerts',
    defaultPageSize: 25,
    defaultSort: { column: 'created_at', direction: 'desc' },
    wsTopics: [
      'cyber.alert.created',
      'cyber.alert.status_changed',
      'cyber.alert.assigned',
      'cyber.alert.escalated',
      'cyber.alert.merged',
    ],
  });

  const tacticsQuery = useQuery({
    queryKey: ['cyber-mitre-tactics'],
    queryFn: () => apiGet<{ data: MITRETacticItem[] }>(API_ENDPOINTS.CYBER_MITRE_TACTICS),
  });

  const handleMutationComplete = useCallback(async () => {
    setSelectedIds([]);
    setTableResetKey((value) => value + 1);
    await refetch();
    void tacticsQuery.refetch();
  }, [refetch, tacticsQuery]);

  const filters = useMemo(
    () => buildAlertFilters(tacticsQuery.data?.data ?? [], t.filters),
    [tacticsQuery.data?.data, t.filters],
  );

  const currentAlerts = tableProps.data;
  const mergeAlerts = currentAlerts.filter((alert) => mergeIds.includes(alert.id));

  const columns = useMemo(
    () => getAlertColumns({
      includeSelection: canWrite,
      onAssign: canWrite ? setAssignTarget : undefined,
      onEscalate: canWrite ? setEscalateTarget : undefined,
      onAcknowledge: canWrite ? setAckTarget : undefined,
      labels: t.columns,
    }),
    [canWrite, t.columns],
  );

  const bulkActions = useMemo<BulkAction[]>(() => {
    if (!canWrite) {
      return [];
    }

    return [
      {
        label: t.bulk.acknowledgeSelected,
        icon: CheckCheck,
        onClick: async (ids) => {
          if (ids.length === 0) {
            toast.error(t.bulk.selectAtLeastOne);
            return;
          }
          await apiPut(API_ENDPOINTS.CYBER_ALERT_BULK_STATUS, { alert_ids: ids, status: 'acknowledged' });
          toast.success(t.bulk.acknowledged(ids.length));
          await handleMutationComplete();
        },
      },
      {
        label: t.bulk.assignToAnalyst,
        icon: UserCheck,
        onClick: async (ids) => {
          if (ids.length === 0) {
            toast.error(t.bulk.selectAtLeastOne);
            return;
          }
          setAssignBulkIds(ids);
        },
      },
      {
        label: t.bulk.markFalsePositive,
        icon: ShieldAlert,
        onClick: async (ids) => {
          if (ids.length === 0) {
            toast.error(t.bulk.selectAtLeastOne);
            return;
          }
          setFalsePositiveIds(ids);
        },
      },
      {
        label: t.bulk.mergeSelectedAlerts,
        icon: GitMerge,
        onClick: async (ids) => {
          if (ids.length < 2) {
            toast.error(t.bulk.selectAtLeastTwo);
            return;
          }
          setMergeIds(ids);
        },
      },
    ];
  }, [canWrite, handleMutationComplete, t.bulk]);

  async function handleAcknowledge(alert: CyberAlert) {
    await apiPut(API_ENDPOINTS.CYBER_ALERT_STATUS(alert.id), { status: 'acknowledged' });
    toast.success(t.bulk.alertAcknowledged);
    await handleMutationComplete();
  }

  return (
    <PermissionRedirect permission="cyber:read">
      <div className="space-y-6">
        <PageHeader
          eyebrow={t.list.eyebrow}
          title={t.list.title}
          description={t.list.description}
          tags={[
            { label: t.list.tagSocTriage, tone: 'primary', icon: <ShieldAlert className="h-3.5 w-3.5" aria-hidden /> },
            { label: 'MITRE ATT&CK', tone: 'info' },
          ]}
        />

        <AlertStatsBar onFilterByStatus={(status) => setFilter('status', status)} />

        <DataTable
          key={tableResetKey}
          {...tableProps}
          columns={columns}
          filters={filters}
          savedViews={{ routeKey: 'cyber-alerts' }}
          searchPlaceholder={t.list.searchPlaceholder}
          getRowId={(row) => row.id}
          onRowClick={(row) => router.push(`${ROUTES.CYBER_ALERTS}/${row.id}`)}
          enableSelection={canWrite}
          onSelectionChange={setSelectedIds}
          bulkActions={bulkActions}
          emptyState={{
            icon: AlertTriangle,
            title: t.list.emptyTitle,
            description: t.list.emptyDescription,
          }}
        />
      </div>

      <PermissionGate permission="cyber:write">
        <AlertAssignDialog
          open={Boolean(assignTarget) || assignBulkIds.length > 0}
          onOpenChange={(open) => {
            if (!open) {
              setAssignTarget(null);
              setAssignBulkIds([]);
            }
          }}
          alert={assignTarget}
          alertIds={assignBulkIds}
          onSuccess={() => {
            setAssignTarget(null);
            setAssignBulkIds([]);
            void handleMutationComplete();
          }}
        />

        {escalateTarget && (
          <AlertEscalateDialog
            open={Boolean(escalateTarget)}
            onOpenChange={(open) => {
              if (!open) {
                setEscalateTarget(null);
              }
            }}
            alert={escalateTarget}
            onSuccess={() => {
              setEscalateTarget(null);
              void handleMutationComplete();
            }}
          />
        )}

        <AlertFalsePositiveDialog
          open={falsePositiveIds.length > 0}
          onOpenChange={(open) => {
            if (!open) {
              setFalsePositiveIds([]);
            }
          }}
          alertIds={falsePositiveIds}
          onSuccess={() => {
            setFalsePositiveIds([]);
            void handleMutationComplete();
          }}
        />

        <AlertMergeDialog
          open={mergeIds.length > 0}
          onOpenChange={(open) => {
            if (!open) {
              setMergeIds([]);
            }
          }}
          alerts={mergeAlerts}
          onSuccess={() => {
            setMergeIds([]);
            void handleMutationComplete();
          }}
        />

        {ackTarget && (
          <ConfirmDialog
            open={Boolean(ackTarget)}
            onOpenChange={(open) => {
              if (!open) {
                setAckTarget(null);
              }
            }}
            title={t.ackDialog.title}
            description={t.ackDialog.description(ackTarget.title)}
            confirmLabel={t.ackDialog.confirm}
            onConfirm={async () => {
              if (ackTarget) {
                await handleAcknowledge(ackTarget);
                setAckTarget(null);
              }
            }}
          />
        )}
      </PermissionGate>
    </PermissionRedirect>
  );
}
