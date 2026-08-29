'use client';

import * as React from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/common/empty-state';
import { FOCUS_RING, densityPadding, type Density } from '@/components/ui/ui-system';
import { useDensity } from '@/components/ui/use-density';
import type { SortDirection, SortState } from '@/components/ui/table-sort-header';

export type { SortDirection, SortState } from '@/components/ui/table-sort-header';

export interface VirtualTableColumn<T> {
  /** Stable key; also used as the sort key. */
  key: string;
  /** Header label. */
  header: React.ReactNode;
  /** Cell renderer; falls back to `String(row[key])`. */
  render?: (item: T, index: number) => React.ReactNode;
  /** CSS grid track size for this column (e.g. `minmax(0,1fr)`, `120px`). */
  width?: string;
  /** Whether this column participates in sorting. */
  sortable?: boolean;
  /** Cell/header alignment. */
  align?: 'left' | 'right' | 'center';
}

interface VirtualTableProps<T> {
  columns: VirtualTableColumn<T>[];
  data: T[];
  /** Estimated row height in px (used by the virtualizer). */
  estimateRowHeight?: number;
  /** Extra rows rendered above/below the viewport. */
  overscan?: number;
  /** Max height of the scroll viewport. */
  maxHeight?: number | string;
  loading?: boolean;
  emptyMessage?: string;
  sort?: SortState;
  onSortChange?: (column: string, direction: SortDirection) => void;
  /** Stable key extractor; defaults to the row index. */
  getRowKey?: (item: T, index: number) => React.Key;
  onRowClick?: (item: T, index: number) => void;
  /** Optional predicate marking a row selected (adds aria-selected + accent). */
  isRowSelected?: (item: T, index: number) => boolean;
  /** Stripe even rows for easier tracking in long tables. Default: false. */
  zebra?: boolean;
  /** Cell density; inherits the nearest DensityProvider, else 'comfortable'. */
  density?: Density;
  className?: string;
  ariaLabel?: string;
}

/**
 * Windowed, accessible table for large datasets. Uses @tanstack/react-virtual to
 * render only the visible rows. Because virtualization breaks native `<table>`
 * row contiguity, it uses ARIA grid roles on a CSS-grid layout so assistive tech
 * still announces structure, sort direction, and row/column position.
 *
 * Styling mirrors the shared `<Table>` primitives (sticky uppercase header,
 * calm neutral row hover, soft brand selected accent, token-bound borders)
 * without requiring a `<table>` element, so both tables read as one system.
 *
 * NOTE: if you already render the full-featured shared DataTable
 * (`@/components/shared/data-table`), prefer its `enableVirtual` prop — it
 * windows rows with the same @tanstack/react-virtual engine while keeping the
 * toolbar, selection, filters, sticky header and pagination intact. This
 * standalone component remains for ad-hoc large lists outside that table.
 */
export function VirtualTable<T>({
  columns,
  data,
  estimateRowHeight = 52,
  overscan = 8,
  maxHeight = 480,
  loading = false,
  emptyMessage = 'No data found',
  sort,
  onSortChange,
  getRowKey,
  onRowClick,
  isRowSelected,
  zebra = false,
  density: densityProp,
  className,
  ariaLabel = 'Data table',
}: VirtualTableProps<T>) {
  const density = useDensity(densityProp);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: data.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimateRowHeight,
    overscan,
  });

  const gridTemplate = React.useMemo(
    () => columns.map((c) => c.width ?? 'minmax(0, 1fr)').join(' '),
    [columns],
  );

  // Logical (RTL-safe) alignment: `right` follows the reading direction's end,
  // `left` its start, so numeric columns flip correctly under `dir="rtl"`.
  const alignClass = (align?: VirtualTableColumn<T>['align']) =>
    align === 'right'
      ? 'justify-end text-end'
      : align === 'center'
        ? 'justify-center text-center'
        : 'justify-start text-start';

  if (loading) {
    return (
      <div
        role="status"
        aria-busy="true"
        aria-live="polite"
        className={cn('w-full overflow-hidden rounded-lg border border-border bg-card', className)}
      >
        <Skeleton variant="table" rows={8} cols={columns.length} className="rounded-none border-0 bg-transparent" />
        <span className="sr-only">Loading…</span>
      </div>
    );
  }

  const virtualRows = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();

  return (
    <div
      className={cn(
        'w-full overflow-hidden rounded-lg border border-border bg-card',
        className,
      )}
    >
      <div
        role="grid"
        aria-label={ariaLabel}
        aria-rowcount={data.length + 1}
        aria-colcount={columns.length}
      >
        {/* Header */}
        <div
          role="row"
          aria-rowindex={1}
          className={cn(
            'sticky top-0 z-10 grid items-center gap-4 border-b border-border/70 bg-muted/95 shadow-elevation-1 backdrop-blur-sm supports-[backdrop-filter]:bg-muted/80',
            densityPadding.tableCell[density],
          )}
          style={{ gridTemplateColumns: gridTemplate }}
        >
          {columns.map((col) => {
            const sortable = col.sortable !== false && Boolean(onSortChange);
            const isActive = sortable && sort?.column === col.key;
            const direction = isActive ? sort?.direction : undefined;
            const ariaSort: React.AriaAttributes['aria-sort'] = !sortable
              ? undefined
              : isActive
                ? direction === 'asc'
                  ? 'ascending'
                  : 'descending'
                : 'none';

            const label = (
              <span className="text-overline font-semibold uppercase text-muted-foreground">
                {col.header}
              </span>
            );

            return (
              <div
                key={col.key}
                role="columnheader"
                aria-sort={ariaSort}
                className={cn('flex items-center', alignClass(col.align))}
              >
                {sortable ? (
                  <button
                    type="button"
                    onClick={() =>
                      onSortChange?.(
                        col.key,
                        direction === 'asc' ? 'desc' : 'asc',
                      )
                    }
                    className={cn(
                      'group inline-flex items-center gap-1.5 rounded-md transition-colors duration-fast ease-standard hover:text-foreground',
                      FOCUS_RING,
                    )}
                  >
                    {label}
                    {isActive ? (
                      direction === 'asc' ? (
                        <ArrowUp className="h-3.5 w-3.5" aria-hidden />
                      ) : (
                        <ArrowDown className="h-3.5 w-3.5" aria-hidden />
                      )
                    ) : (
                      <ChevronsUpDown
                        className="h-3.5 w-3.5 opacity-40 transition-opacity duration-fast ease-standard group-hover:opacity-70"
                        aria-hidden
                      />
                    )}
                  </button>
                ) : (
                  label
                )}
              </div>
            );
          })}
        </div>

        {/* Body */}
        {data.length === 0 ? (
          <div role="row">
            <div role="gridcell">
              <EmptyState
                illustration="search"
                title={emptyMessage}
                size="compact"
              />
            </div>
          </div>
        ) : (
          <div
            ref={scrollRef}
            className="overflow-auto"
            style={{
              maxHeight:
                typeof maxHeight === 'number' ? `${maxHeight}px` : maxHeight,
            }}
          >
            <div
              style={{ height: totalSize, position: 'relative', width: '100%' }}
            >
              {virtualRows.map((vRow) => {
                const item = data[vRow.index];
                const rowKey = getRowKey
                  ? getRowKey(item, vRow.index)
                  : vRow.index;
                const interactive = Boolean(onRowClick);
                const selected = isRowSelected?.(item, vRow.index) ?? false;
                const handleClick = onRowClick
                  ? () => onRowClick(item, vRow.index)
                  : undefined;
                return (
                  <div
                    key={rowKey}
                    role="row"
                    aria-rowindex={vRow.index + 2}
                    aria-selected={selected || undefined}
                    data-index={vRow.index}
                    ref={rowVirtualizer.measureElement}
                    onClick={handleClick}
                    tabIndex={interactive ? 0 : undefined}
                    onKeyDown={
                      interactive
                        ? (event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              handleClick?.();
                            }
                          }
                        : undefined
                    }
                    className={cn(
                      'group grid items-center gap-4 border-b border-border/60 text-body-sm text-foreground',
                      densityPadding.tableCell[density],
                      'transition-[background-color,box-shadow] duration-fast ease-standard hover:bg-muted/40',
                      FOCUS_RING,
                      // Zebra wash sits below hover/selected emphasis.
                      zebra && vRow.index % 2 === 1 && 'bg-muted/20',
                      // Selected: soft brand tint + subtle inset accent ring.
                      selected &&
                        'bg-primary/5 ring-1 ring-inset ring-primary/30',
                      interactive && 'cursor-pointer hover:bg-muted/60',
                    )}
                    style={{
                      gridTemplateColumns: gridTemplate,
                      position: 'absolute',
                      insetInlineStart: 0,
                      top: 0,
                      width: '100%',
                      transform: `translateY(${vRow.start}px)`,
                    }}
                  >
                    {columns.map((col) => (
                      <div
                        key={col.key}
                        role="gridcell"
                        className={cn(
                          'flex min-w-0 items-center',
                          alignClass(col.align),
                        )}
                      >
                        {col.render
                          ? col.render(item, vRow.index)
                          : String(
                              (item as Record<string, unknown>)[col.key] ?? '',
                            )}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
