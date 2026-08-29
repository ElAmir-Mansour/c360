'use client';

import { type ColumnDef } from '@tanstack/react-table';
import Link from 'next/link';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/shared/data-table/data-table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { type DataSource } from '@/lib/data-suite';
import {
  formatMaybeBytes,
  formatMaybeCompact,
  getSourceTypeVisual,
  getStatusTone,
  humanizeCronOrFrequency,
} from '@/lib/data-suite/utils';
import type { DataTableControlledProps, FilterConfig } from '@/types/table';
import { SearchInput } from '@/components/shared/forms/search-input';
import { useDataLabels } from '@/app/(dashboard)/data/_lib/data-i18n';

interface SourceTableViewProps {
  tableProps: DataTableControlledProps<DataSource>;
  searchValue: string;
  setSearch: (value: string) => void;
  filters: FilterConfig[];
  onRowClick: (source: DataSource) => void;
  onEdit: (source: DataSource) => void;
  onDelete: (source: DataSource) => void;
  onTest: (source: DataSource) => void;
  onSync: (source: DataSource) => void;
  onToggleStatus?: (source: DataSource) => void;
}

export function SourceTableView({
  tableProps,
  searchValue,
  setSearch,
  filters,
  onRowClick,
  onEdit,
  onDelete,
  onTest,
  onSync,
  onToggleStatus,
}: SourceTableViewProps) {
  const labels = useDataLabels();
  const columns: ColumnDef<DataSource>[] = [
    {
      id: 'name',
      header: labels.common.name,
      accessorKey: 'name',
      cell: ({ row }) => {
        const visual = getSourceTypeVisual(row.original.type);
        const Icon = visual.icon;
        return (
          <div className="flex items-center gap-3">
            <Icon className={`h-4 w-4 ${visual.accentClass}`} />
            <div>
              <div className="font-medium">{row.original.name}</div>
              <div className="text-xs text-muted-foreground">{visual.label}</div>
            </div>
          </div>
        );
      },
    },
    {
      id: 'status',
      header: labels.common.status,
      accessorKey: 'status',
      cell: ({ row }) => (
        <span className="inline-flex items-center gap-2 text-xs font-medium capitalize">
          <span className={`h-2.5 w-2.5 rounded-full ${getStatusTone(row.original.status)}`} />
          {row.original.status}
        </span>
      ),
    },
    {
      id: 'tables',
      header: labels.sources.colTables,
      cell: ({ row }) => row.original.table_count ?? 0,
    },
    {
      id: 'rows',
      header: labels.sources.colRows,
      cell: ({ row }) => formatMaybeCompact(row.original.total_row_count),
    },
    {
      id: 'size',
      header: labels.sources.colSize,
      cell: ({ row }) => formatMaybeBytes(row.original.total_size_bytes),
    },
    {
      id: 'last_synced_at',
      header: labels.sources.colLastSynced,
      cell: ({ row }) => row.original.last_synced_at ? new Date(row.original.last_synced_at).toLocaleString() : labels.sources.never,
    },
    {
      id: 'sync_frequency',
      header: labels.sources.colSchedule,
      cell: ({ row }) => humanizeCronOrFrequency(row.original.sync_frequency),
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="outline" onClick={(event) => { event.stopPropagation(); onTest(row.original); }}>
            {labels.sources.test}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={(event) => { event.stopPropagation(); onSync(row.original); }}>
            {labels.sources.sync}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild onClick={(event) => event.stopPropagation()}>
              <Button type="button" size="icon" variant="ghost">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link href={`/data/sources/${row.original.id}`}>{labels.sources.open}</Link>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onEdit(row.original)}>
                {labels.common.edit}
              </DropdownMenuItem>
              {onToggleStatus && (row.original.status === 'active' || row.original.status === 'inactive') && (
                <DropdownMenuItem onClick={() => onToggleStatus(row.original)}>
                  {row.original.status === 'active' ? labels.sources.deactivate : labels.sources.activate}
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => onDelete(row.original)}>
                {labels.common.delete}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ),
    },
  ];

  return (
    <DataTable
      {...tableProps}
      columns={columns}
      filters={filters}
      onRowClick={onRowClick}
      searchSlot={
        <SearchInput
          value={searchValue}
          onChange={setSearch}
          placeholder={labels.sources.searchPlaceholder}
          loading={tableProps.isLoading}
        />
      }
    />
  );
}
