'use client';

import * as React from 'react';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export type SortDirection = 'asc' | 'desc';

export interface SortState {
  /** Column key currently sorted, or null when unsorted. */
  column: string | null;
  direction: SortDirection;
}

interface TableSortHeaderProps {
  /** Stable key identifying this column for sort state. */
  column: string;
  /** Visible header label. */
  children: React.ReactNode;
  /** Current table sort state. */
  sort?: SortState;
  /** Fired with the column key and the next direction when toggled. */
  onSortChange?: (column: string, direction: SortDirection) => void;
  /** When false the header renders as a plain, non-interactive label. */
  sortable?: boolean;
  /** Text alignment of the header content. */
  align?: 'left' | 'right' | 'center';
  className?: string;
}

/**
 * Accessible, typed sortable column header for use inside a native `<thead>`.
 * Renders a real `<th>` carrying the correct `aria-sort` value and an inner
 * button so keyboard and pointer users can toggle sort. Direction-cycling is
 * asc → desc → asc (callers wanting a tristate can ignore the helper and drive
 * `onSortChange` directly).
 *
 * Deliberately framework-agnostic (no @tanstack/react-table dependency) so it
 * composes with both the lightweight DataTable and the VirtualTable.
 */
export function TableSortHeader({
  column,
  children,
  sort,
  onSortChange,
  sortable = true,
  align = 'left',
  className,
}: TableSortHeaderProps) {
  const isActive = sortable && sort?.column === column;
  const direction = isActive ? sort?.direction : undefined;

  const ariaSort: React.AriaAttributes['aria-sort'] = !sortable
    ? undefined
    : isActive
      ? direction === 'asc'
        ? 'ascending'
        : 'descending'
      : 'none';

  const handleToggle = () => {
    if (!sortable || !onSortChange) return;
    const next: SortDirection = direction === 'asc' ? 'desc' : 'asc';
    onSortChange(column, next);
  };

  const alignClass =
    align === 'right'
      ? 'justify-end text-right'
      : align === 'center'
        ? 'justify-center text-center'
        : 'justify-start text-left';

  if (!sortable) {
    return (
      <th scope="col" className={className}>
        <span className={cn('flex items-center', alignClass)}>{children}</span>
      </th>
    );
  }

  return (
    <th scope="col" aria-sort={ariaSort} className={className}>
      <button
        type="button"
        onClick={handleToggle}
        className={cn(
          'group inline-flex w-full items-center gap-1.5 rounded-md outline-none',
          'transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
          alignClass,
        )}
        aria-label={
          isActive
            ? `Sorted ${direction === 'asc' ? 'ascending' : 'descending'}. Activate to change sort.`
            : 'Sort by this column'
        }
      >
        <span>{children}</span>
        <SortGlyph active={!!isActive} direction={direction} />
      </button>
    </th>
  );
}

function SortGlyph({
  active,
  direction,
}: {
  active: boolean;
  direction?: SortDirection;
}) {
  if (active) {
    return direction === 'asc' ? (
      <ArrowUp className="h-3.5 w-3.5" aria-hidden />
    ) : (
      <ArrowDown className="h-3.5 w-3.5" aria-hidden />
    );
  }
  return (
    <ChevronsUpDown
      className="h-3.5 w-3.5 opacity-40 transition-opacity group-hover:opacity-70"
      aria-hidden
    />
  );
}
