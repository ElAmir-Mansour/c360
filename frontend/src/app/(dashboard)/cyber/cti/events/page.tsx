'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ColumnDef } from '@tanstack/react-table';
import { Eye, FlagTriangleRight, ShieldCheck, Trash2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { PageHeader } from '@/components/common/page-header';
import { StatusBadge, severityMap } from '@/components/shared/status-badge';
import { ExportMenu } from '@/components/cyber/export-menu';
import { DataTable } from '@/components/shared/data-table/data-table';
import { useAuth } from '@/hooks/use-auth';
import { useCTIThreatEvents } from '@/hooks/use-cti-threat-events';
import { deleteThreatEvent, markEventFalsePositive, resolveEvent } from '@/lib/cti-api';
import { API_ENDPOINTS } from '@/lib/constants';
import { CTI_EVENT_TYPE_LABELS, type CTIThreatEvent } from '@/types/cti';
import type { BulkAction, RowAction } from '@/types/table';
import { useCtiLabels } from '../_lib/cti-i18n';

function countryCodeToFlag(countryCode?: string | null): string {
  if (!countryCode || countryCode.length !== 2) {
    return '🌐';
  }
  return countryCode
    .toUpperCase()
    .split('')
    .map((char) => String.fromCodePoint(127397 + char.charCodeAt(0)))
    .join('');
}

function isFreshEvent(event: CTIThreatEvent): boolean {
  const timestamp = Date.parse(event.created_at || event.first_seen_at);
  return Number.isFinite(timestamp) && Date.now() - timestamp < 60_000;
}

export default function CTIEventsPage() {
  const router = useRouter();
  const { events: t } = useCtiLabels();
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('cyber:write');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const {
    tableProps,
    filters,
    refetch,
    totalRows,
    activeFilters,
  } = useCTIThreatEvents();

  const columns = useMemo<ColumnDef<CTIThreatEvent>[]>(
    () => [
      {
        accessorKey: 'severity_code',
        header: t.colSeverity,
        cell: ({ row }) => <StatusBadge map={severityMap} status={row.original.severity_code} size="sm" />,
        enableSorting: true,
        size: 110,
      },
      {
        accessorKey: 'title',
        header: t.colTitle,
        enableSorting: true,
        size: 300,
        cell: ({ row }) => (
          <div className="max-w-[360px] space-y-1">
            <div className="flex items-center gap-2">
              <span className={isFreshEvent(row.original) ? 'font-medium text-foreground animate-pulse' : 'font-medium'}>
                {row.original.title}
              </span>
              {isFreshEvent(row.original) && (
                <span className="rounded-full bg-primary/15 px-2 py-0.5 text-overline font-semibold uppercase tracking-caps-xwide text-primary">
                  {t.new}
                </span>
              )}
            </div>
            <p className="truncate text-xs text-muted-foreground">
              {row.original.ioc_value || row.original.description || t.noContext}
            </p>
          </div>
        ),
      },
      {
        accessorKey: 'event_type',
        header: t.colEventType,
        enableSorting: true,
        size: 140,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {CTI_EVENT_TYPE_LABELS[row.original.event_type] ?? row.original.event_type}
          </span>
        ),
      },
      {
        accessorKey: 'origin_country_code',
        header: t.colOrigin,
        enableSorting: false,
        size: 170,
        cell: ({ row }) => (
          <span className="text-xs">
            {countryCodeToFlag(row.original.origin_country_code)}{' '}
            {row.original.origin_city || t.unknown}
            {row.original.origin_country_code ? `, ${row.original.origin_country_code.toUpperCase()}` : ''}
          </span>
        ),
      },
      {
        accessorKey: 'sector_label',
        header: t.colTargetSector,
        enableSorting: false,
        size: 140,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {row.original.target_sector_label || row.original.sector_label || '—'}
          </span>
        ),
      },
      {
        accessorKey: 'confidence_score',
        header: t.colConfidence,
        enableSorting: true,
        size: 110,
        cell: ({ row }) => (
          <span className="text-xs font-medium tabular-nums">
            {(row.original.confidence_score * 100).toFixed(0)}%
          </span>
        ),
      },
      {
        accessorKey: 'first_seen_at',
        header: t.colFirstSeen,
        enableSorting: true,
        size: 130,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {formatDistanceToNow(new Date(row.original.first_seen_at), { addSuffix: true })}
          </span>
        ),
      },
    ],
    [t],
  );

  const rowActions = useMemo<RowAction<CTIThreatEvent>[]>(() => {
    const actions: RowAction<CTIThreatEvent>[] = [
      {
        label: t.viewDetail,
        icon: Eye,
        onClick: (event) => router.push(`/cyber/cti/events/${event.id}`),
      },
    ];

    if (!canWrite) {
      return actions;
    }

    actions.push(
      {
        label: t.resolve,
        icon: ShieldCheck,
        hidden: (event) => Boolean(event.resolved_at),
        onClick: (event) => {
          void resolveEvent(event.id)
            .then(() => {
              toast.success(t.eventResolved);
              void refetch();
            })
            .catch(() => {
              toast.error(t.resolveFailed);
            });
        },
      },
      {
        label: t.markFalsePositive,
        icon: FlagTriangleRight,
        hidden: (event) => event.is_false_positive,
        onClick: (event) => {
          void markEventFalsePositive(event.id)
            .then(() => {
              toast.success(t.markedFalsePositive);
              void refetch();
            })
            .catch(() => {
              toast.error(t.updateFailed);
            });
        },
      },
      {
        label: t.delete,
        icon: Trash2,
        variant: 'destructive',
        onClick: (event) => {
          void deleteThreatEvent(event.id)
            .then(() => {
              toast.success(t.deleted);
              void refetch();
            })
            .catch(() => {
              toast.error(t.deleteFailed);
            });
        },
      },
    );

    return actions;
  }, [canWrite, refetch, router, t]);

  const bulkActions = useMemo<BulkAction[]>(() => {
    if (!canWrite) {
      return [];
    }

    return [
      {
        label: t.resolveSelected,
        icon: ShieldCheck,
        onClick: async (ids) => {
          await Promise.all(ids.map((id) => resolveEvent(id)));
          toast.success(t.eventsResolved(ids.length));
          setSelectedIds([]);
          await refetch();
        },
      },
      {
        label: t.markFalsePositive,
        icon: FlagTriangleRight,
        onClick: async (ids) => {
          await Promise.all(ids.map((id) => markEventFalsePositive(id)));
          toast.success(t.eventsUpdated(ids.length));
          setSelectedIds([]);
          await refetch();
        },
      },
    ];
  }, [canWrite, refetch, t]);

  return (
    <PermissionRedirect permission="cyber:read">
      <div className="space-y-6">
        <PageHeader
          title={t.title}
          description={t.description}
          actions={(
            <ExportMenu
              entityType="cti-threat-events"
              baseUrl={API_ENDPOINTS.CTI_EVENTS}
              currentFilters={activeFilters as Record<string, string | string[]>}
              totalCount={totalRows}
              enabledFormats={['csv', 'json']}
              selectedCount={selectedIds.length}
            />
          )}
        />

        <DataTable
          {...tableProps}
          columns={columns}
          filters={filters}
          searchPlaceholder={t.searchPlaceholder}
          getRowId={(row) => row.id}
          onRowClick={(row) => router.push(`/cyber/cti/events/${row.id}`)}
          enableSelection={canWrite}
          onSelectionChange={setSelectedIds}
          bulkActions={bulkActions}
          rowActions={rowActions}
          emptyState={{
            icon: ShieldCheck,
            title: t.emptyTitle,
            description: t.emptyDescription,
          }}
        />
      </div>
    </PermissionRedirect>
  );
}
