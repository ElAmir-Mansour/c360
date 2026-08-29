'use client';

/**
 * DataTable demo — the full-featured shared table
 * (`@/components/shared/data-table`) driven by a static in-memory dataset so
 * every enterprise affordance can be exercised without a backend:
 * search, select/multi-select filters, sorting, pagination, row selection +
 * bulk actions, row actions, column visibility/reorder/drag-resize, the
 * persisted density toggle, and SavedViewsBar for named filter sets.
 */

import * as React from 'react';
import type { ColumnDef, Row } from '@tanstack/react-table';
import { Archive, ClipboardCopy, Eye } from 'lucide-react';
import { toast } from 'sonner';

import { DataTable } from '@/components/shared/data-table';
import { SavedViewsBar } from '@/components/shared/saved-views-bar';
import { StatusBadge, genericStatusMap } from '@/components/shared/status-badge';
import type { FilterConfig } from '@/types/table';

interface CatalogRow {
  id: string;
  name: string;
  path: string;
  domain: 'ui' | 'shared' | 'common';
  status: 'active' | 'draft' | 'deprecated';
  usage: number;
  updated: string; // ISO date
}

/** The catalog dogfoods itself: the demo rows are the canonical primitives. */
const ROWS: CatalogRow[] = [
  { id: 'button', name: 'Button', path: '@/components/ui/button', domain: 'ui', status: 'active', usage: 412, updated: '2026-06-28' },
  { id: 'badge', name: 'Badge', path: '@/components/ui/badge', domain: 'ui', status: 'active', usage: 198, updated: '2026-06-25' },
  { id: 'status-badge', name: 'StatusBadge', path: '@/components/shared/status-badge', domain: 'shared', status: 'active', usage: 176, updated: '2026-06-30' },
  { id: 'stat-tile', name: 'StatTile', path: '@/components/shared/stat-tile', domain: 'shared', status: 'active', usage: 143, updated: '2026-06-29' },
  { id: 'data-table', name: 'DataTable', path: '@/components/shared/data-table', domain: 'shared', status: 'active', usage: 87, updated: '2026-07-01' },
  { id: 'empty-state', name: 'EmptyState', path: '@/components/common/empty-state', domain: 'common', status: 'active', usage: 94, updated: '2026-06-22' },
  { id: 'skeleton', name: 'Skeleton', path: '@/components/ui/skeleton', domain: 'ui', status: 'active', usage: 121, updated: '2026-06-27' },
  { id: 'page-header', name: 'PageHeader', path: '@/components/common/page-header', domain: 'common', status: 'active', usage: 78, updated: '2026-06-24' },
  { id: 'confirm-dialog', name: 'ConfirmDialog', path: '@/components/shared/confirm-dialog', domain: 'shared', status: 'active', usage: 41, updated: '2026-06-18' },
  { id: 'saved-views', name: 'SavedViewsBar', path: '@/components/shared/saved-views-bar', domain: 'shared', status: 'active', usage: 12, updated: '2026-06-26' },
  { id: 'form-error-summary', name: 'FormErrorSummary', path: '@/components/ui/form-error-summary', domain: 'ui', status: 'active', usage: 23, updated: '2026-06-20' },
  { id: 'status-pill', name: 'StatusPill', path: '@/components/ui/status-pill', domain: 'ui', status: 'deprecated', usage: 9, updated: '2026-05-14' },
  { id: 'stat-card', name: 'StatCard', path: '@/components/shared/stat-card', domain: 'shared', status: 'deprecated', usage: 17, updated: '2026-05-30' },
  { id: 'kpi-card', name: 'KpiCard', path: '@/components/shared/kpi-card', domain: 'shared', status: 'deprecated', usage: 11, updated: '2026-05-30' },
  { id: 'wizard', name: 'Wizard', path: '(not yet extracted)', domain: 'shared', status: 'draft', usage: 0, updated: '2026-07-02' },
  { id: 'metric-tile', name: 'MetricTile', path: '@/components/shared/metric-tile', domain: 'shared', status: 'deprecated', usage: 8, updated: '2026-05-28' },
];

const FILTERS: FilterConfig[] = [
  {
    key: 'domain',
    label: 'Domain',
    type: 'select',
    options: [
      { label: 'ui', value: 'ui' },
      { label: 'shared', value: 'shared' },
      { label: 'common', value: 'common' },
    ],
  },
  {
    key: 'status',
    label: 'Status',
    type: 'multi-select',
    options: [
      { label: 'Active', value: 'active' },
      { label: 'Draft', value: 'draft' },
      { label: 'Deprecated', value: 'deprecated' },
    ],
  },
];

const COLUMNS: ColumnDef<CatalogRow>[] = [
  {
    id: 'name',
    accessorKey: 'name',
    header: 'Component',
    enableSorting: true,
    cell: ({ row }: { row: Row<CatalogRow> }) => (
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-foreground">{row.original.name}</p>
        <p dir="ltr" className="mt-0.5 truncate text-start font-mono text-caption text-muted-foreground">
          {row.original.path}
        </p>
      </div>
    ),
  },
  {
    id: 'domain',
    accessorKey: 'domain',
    header: 'Domain',
    enableSorting: true,
    cell: ({ row }: { row: Row<CatalogRow> }) => (
      <span className="text-sm text-muted-foreground">{row.original.domain}</span>
    ),
  },
  {
    id: 'status',
    accessorKey: 'status',
    header: 'Status',
    enableSorting: true,
    cell: ({ row }: { row: Row<CatalogRow> }) => (
      <StatusBadge status={row.original.status} map={genericStatusMap} size="sm" />
    ),
  },
  {
    id: 'usage',
    accessorKey: 'usage',
    header: 'Call sites',
    enableSorting: true,
    cell: ({ row }: { row: Row<CatalogRow> }) => (
      <span className="text-sm tabular-nums text-foreground">
        {row.original.usage.toLocaleString('en')}
      </span>
    ),
  },
  {
    id: 'updated',
    accessorKey: 'updated',
    header: 'Updated',
    enableSorting: true,
    cell: ({ row }: { row: Row<CatalogRow> }) => (
      <span className="text-sm tabular-nums text-muted-foreground">{row.original.updated}</span>
    ),
  },
];

function compareRows(a: CatalogRow, b: CatalogRow, column: string): number {
  switch (column) {
    case 'usage':
      return a.usage - b.usage;
    case 'updated':
      return a.updated.localeCompare(b.updated);
    case 'domain':
      return a.domain.localeCompare(b.domain);
    case 'status':
      return a.status.localeCompare(b.status);
    default:
      return a.name.localeCompare(b.name);
  }
}

export function DemoDataTable() {
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(10);
  const [sortColumn, setSortColumn] = React.useState<string>('usage');
  const [sortDirection, setSortDirection] = React.useState<'asc' | 'desc'>('desc');
  const [search, setSearch] = React.useState('');
  const [activeFilters, setActiveFilters] = React.useState<
    Record<string, string | string[]>
  >({});

  const filtered = React.useMemo(() => {
    let rows = [...ROWS];
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter(
        (r) => r.name.toLowerCase().includes(q) || r.path.toLowerCase().includes(q),
      );
    }
    const domain = activeFilters.domain;
    if (typeof domain === 'string' && domain) {
      rows = rows.filter((r) => r.domain === domain);
    }
    const status = activeFilters.status;
    if (Array.isArray(status) && status.length > 0) {
      rows = rows.filter((r) => status.includes(r.status));
    } else if (typeof status === 'string' && status) {
      rows = rows.filter((r) => r.status === status);
    }
    rows.sort((a, b) => {
      const cmp = compareRows(a, b, sortColumn);
      return sortDirection === 'asc' ? cmp : -cmp;
    });
    return rows;
  }, [search, activeFilters, sortColumn, sortDirection]);

  const pageRows = React.useMemo(
    () => filtered.slice((page - 1) * pageSize, page * pageSize),
    [filtered, page, pageSize],
  );

  const handleSortChange = React.useCallback(
    (column: string, direction: 'asc' | 'desc') => {
      setSortColumn(column);
      setSortDirection(direction);
      setPage(1);
    },
    [],
  );

  const handleFilterChange = React.useCallback(
    (key: string, value: string | string[] | undefined) => {
      setActiveFilters((prev) => {
        const next = { ...prev };
        if (value === undefined || (Array.isArray(value) && value.length === 0)) {
          delete next[key];
        } else {
          next[key] = value;
        }
        return next;
      });
      setPage(1);
    },
    [],
  );

  const handleClearFilters = React.useCallback(() => {
    setActiveFilters({});
    setSearch('');
    setPage(1);
  }, []);

  const handleApplyView = React.useCallback(
    (params: Record<string, string | string[]>) => {
      setActiveFilters(params);
      setPage(1);
    },
    [],
  );

  return (
    <div className="flex flex-col gap-3">
      <SavedViewsBar
        namespace="design-system.catalog-demo"
        activeFilters={activeFilters}
        onApply={handleApplyView}
      />
      <DataTable<CatalogRow>
        tableId="design-system-catalog-demo"
        columns={COLUMNS}
        data={pageRows}
        totalRows={filtered.length}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        pageSizeOptions={[5, 10, 20]}
        sortColumn={sortColumn}
        sortDirection={sortDirection}
        onSortChange={handleSortChange}
        searchValue={search}
        onSearchChange={(value) => {
          setSearch(value);
          setPage(1);
        }}
        searchPlaceholder="Search primitives…"
        filters={FILTERS}
        activeFilters={activeFilters}
        onFilterChange={handleFilterChange}
        onClearFilters={handleClearFilters}
        enableSelection
        getRowId={(row) => row.id}
        bulkActions={[
          {
            label: 'Archive',
            icon: Archive,
            onClick: async (ids) => {
              toast.success(`Archived ${ids.length} component${ids.length === 1 ? '' : 's'} (demo)`);
            },
          },
        ]}
        rowActions={[
          {
            label: 'View spec',
            icon: Eye,
            onClick: (row) => toast(`Open spec for ${row.name} (demo)`),
          },
          {
            label: 'Copy import path',
            icon: ClipboardCopy,
            onClick: (row) => {
              void navigator.clipboard?.writeText(row.path);
              toast.success(`Copied ${row.path}`);
            },
          },
        ]}
        enableColumnToggle
        enableDensityToggle
        enableColumnReorder
        enableColumnResize
        stickyHeader
        emptyState={{
          icon: Eye,
          title: 'No primitives match',
          description: 'Adjust the search or clear the filters to see the catalog again.',
          action: { label: 'Clear filters', onClick: handleClearFilters },
        }}
      />
    </div>
  );
}
