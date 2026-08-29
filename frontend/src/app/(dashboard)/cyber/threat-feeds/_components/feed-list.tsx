'use client';

import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { MoreHorizontal, Play, Trash2 } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { DataTable } from '@/components/shared/data-table/data-table';
import { RelativeTime } from '@/components/shared/relative-time';
import { apiGet } from '@/lib/api';
import {
  getThreatFeedTypeLabel,
} from '@/lib/cyber-indicators';
import { API_ENDPOINTS } from '@/lib/constants';
import { formatDateTime, truncate } from '@/lib/utils';
import type { ThreatFeedConfig, ThreatFeedSyncHistory } from '@/types/cyber';
import type { DataTableControlledProps } from '@/types/table';
import { useThreatFeedLabels } from '../_lib/threat-feeds-i18n';

interface FeedListProps {
  tableProps: DataTableControlledProps<ThreatFeedConfig>;
  onSelect: (feed: ThreatFeedConfig) => void;
  onEdit: (feed: ThreatFeedConfig) => void;
  onSync: (feed: ThreatFeedConfig) => void;
  onDelete?: (feed: ThreatFeedConfig) => void;
}

export function FeedList({
  tableProps,
  onSelect,
  onEdit,
  onSync,
  onDelete,
}: FeedListProps) {
  const t = useThreatFeedLabels();
  const historyQueries = useQueries({
    queries: tableProps.data.map((feed) => ({
      queryKey: ['cyber-threat-feed-last-history', feed.id],
      queryFn: () => apiGet<{ data: ThreatFeedSyncHistory[] }>(API_ENDPOINTS.CYBER_THREAT_FEED_HISTORY(feed.id)),
      staleTime: 120_000,
    })),
  });

  const lastImportedMap = useMemo(() => {
    const entries = new Map<string, number | null>();
    tableProps.data.forEach((feed, index) => {
      entries.set(feed.id, historyQueries[index]?.data?.data?.[0]?.indicators_imported ?? null);
    });
    return entries;
  }, [historyQueries, tableProps.data]);

  const columns = useMemo<ColumnDef<ThreatFeedConfig>[]>(() => [
    {
      id: 'name',
      accessorKey: 'name',
      header: t.list.feed,
      cell: ({ row }) => (
        <button
          type="button"
          className="text-start font-medium hover:underline"
          onClick={(event) => {
            event.stopPropagation();
            onSelect(row.original);
          }}
        >
          {row.original.name}
        </button>
      ),
    },
    {
      id: 'type',
      accessorKey: 'type',
      header: t.list.type,
      cell: ({ row }) => (
        <Badge variant="outline">{getThreatFeedTypeLabel(row.original.type)}</Badge>
      ),
    },
    {
      id: 'url',
      accessorKey: 'url',
      header: t.list.url,
      cell: ({ row }) => (
        <span className="max-w-[200px] sm:max-w-[320px] truncate text-sm text-muted-foreground">
          {row.original.url ? truncate(row.original.url, 48) : t.list.manualFeed}
        </span>
      ),
    },
    {
      id: 'status',
      accessorKey: 'status',
      header: t.list.status,
      cell: ({ row }) => (
        <Badge variant={row.original.status === 'error' ? 'destructive' : row.original.enabled ? 'default' : 'secondary'}>
          {row.original.status}
        </Badge>
      ),
    },
    {
      id: 'last_sync_at',
      accessorKey: 'last_sync_at',
      header: t.list.lastSync,
      cell: ({ row }) => (
        row.original.last_sync_at ? <RelativeTime date={row.original.last_sync_at} /> : <span className="text-sm text-muted-foreground">{t.list.never}</span>
      ),
    },
    {
      id: 'indicators_imported',
      header: t.list.imported,
      cell: ({ row }) => (
        <span className="text-sm">
          {lastImportedMap.get(row.original.id) ?? '—'}
        </span>
      ),
    },
    {
      id: 'next_sync_at',
      accessorKey: 'next_sync_at',
      header: t.list.nextSync,
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {row.original.next_sync_at ? formatDateTime(row.original.next_sync_at) : t.list.manual}
        </span>
      ),
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={(event) => event.stopPropagation()}
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onSelect(row.original)}>
              {t.list.viewDetails}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onEdit(row.original)}>
              {t.list.editFeed}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onSync(row.original)}>
              <Play className="me-2 h-4 w-4" />
              {t.list.syncNow}
            </DropdownMenuItem>
            {onDelete && (
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => onDelete(row.original)}
              >
                <Trash2 className="me-2 h-4 w-4" />
                {t.list.deleteFeed}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ], [lastImportedMap, onDelete, onEdit, onSelect, onSync, t.list]);

  return (
    <DataTable
      {...tableProps}
      columns={columns}
      searchPlaceholder={t.list.searchPlaceholder}
      getRowId={(row) => row.id}
      onRowClick={(row) => onSelect(row)}
      enableColumnToggle={false}
    />
  );
}
