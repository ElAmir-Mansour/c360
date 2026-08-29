"use client";
import {
  ArrowDown,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  EyeOff,
} from "lucide-react";
import type { Column, Header } from "@tanstack/react-table";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface DataTableColumnHeaderProps<TData, TValue> {
  column: Column<TData, TValue>;
  title: string;
  className?: string;
  onSortChange?: (columnId: string, direction: "asc" | "desc") => void;
  sortColumn?: string;
  sortDirection?: "asc" | "desc";
  /** Menu-based reorder: move this column one visible slot toward the logical start/end. */
  onMoveColumn?: (columnId: string, direction: "start" | "end") => void;
  canMoveStart?: boolean;
  canMoveEnd?: boolean;
  /** Hide this column (only offered when the column can hide). */
  onHide?: (columnId: string) => void;
}

export function DataTableColumnHeader<TData, TValue>({
  column,
  title,
  className,
  onSortChange,
  sortColumn,
  sortDirection,
  onMoveColumn,
  canMoveStart = false,
  canMoveEnd = false,
  onHide,
}: DataTableColumnHeaderProps<TData, TValue>) {
  const canSort = column.getCanSort();
  const canHide = Boolean(onHide) && column.getCanHide();
  const hasMenu = Boolean(onMoveColumn) || canHide;

  const isCurrentSort = sortColumn === column.id;
  const currentDirection = isCurrentSort ? sortDirection : undefined;

  const handleSort = () => {
    if (!onSortChange) return;
    const nextDirection = currentDirection === "asc" ? "desc" : "asc";
    onSortChange(column.id, nextDirection);
  };

  const ariaSort = isCurrentSort
    ? currentDirection === "asc"
      ? "ascending"
      : "descending"
    : "none";

  const menu = hasMenu ? (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "h-6 w-6 shrink-0 rounded-lg p-0 text-white/65 hover:bg-white/10 hover:text-white",
            // Reveal on hover of the header cell, keyboard focus, or while open.
            "opacity-0 transition-opacity duration-fast group-hover/th:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 motion-reduce:transition-none",
          )}
          aria-label={`${title}: column options`}
        >
          <ChevronDown className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44">
        {onMoveColumn && (
          <>
            <DropdownMenuItem
              disabled={!canMoveStart}
              onClick={() => onMoveColumn(column.id, "start")}
            >
              <ArrowLeftToLine
                className="me-2 h-3.5 w-3.5 rtl:rotate-180"
                aria-hidden
              />
              Move to start
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!canMoveEnd}
              onClick={() => onMoveColumn(column.id, "end")}
            >
              <ArrowRightToLine
                className="me-2 h-3.5 w-3.5 rtl:rotate-180"
                aria-hidden
              />
              Move to end
            </DropdownMenuItem>
          </>
        )}
        {onMoveColumn && canHide && <DropdownMenuSeparator />}
        {canHide && (
          <DropdownMenuItem onClick={() => onHide?.(column.id)}>
            <EyeOff className="me-2 h-3.5 w-3.5" aria-hidden />
            Hide column
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  ) : null;

  if (!canSort) {
    // Inherits the th typography (uppercase overline) so plain headers look the
    // same as before; the menu affordance reveals on hover/focus.
    return (
      <div className={cn("flex items-center gap-1", className)}>
        <span>{title}</span>
        {menu}
      </div>
    );
  }

  return (
    <div className={cn("flex items-center gap-1", className)}>
      <Button
        variant="ghost"
        size="sm"
        className={cn(
          "-ms-3 h-8 rounded-lg px-3 text-[11px] font-semibold uppercase tracking-caps-xwide text-white/80 hover:bg-white/10 hover:text-white data-[state=open]:bg-white/10",
          isCurrentSort && "bg-white/10 text-white",
        )}
        onClick={handleSort}
        aria-label={
          isCurrentSort
            ? `${title}, sorted ${ariaSort}`
            : `${title}, not sorted`
        }
      >
        <span>{title}</span>
        {isCurrentSort ? (
          currentDirection === "desc" ? (
            <ArrowDown className="ms-1 h-4 w-4" />
          ) : (
            <ArrowUp className="ms-1 h-4 w-4" />
          )
        ) : (
          <ArrowUpDown className="ms-1 h-4 w-4 opacity-40" />
        )}
      </Button>
      {menu}
    </div>
  );
}

interface DataTableResizeHandleProps<TData, TValue> {
  header: Header<TData, TValue>;
  /** Friendly column name for the aria-label. */
  label: string;
}

/**
 * Drag handle for column resizing. Rendered inside a `relative` TableHead with
 * the `group/th` class; positioned at the logical inline-end edge (RTL-aware)
 * and revealed on header hover or while actively resizing. Double-click resets
 * the column to its default width.
 */
export function DataTableResizeHandle<TData, TValue>({
  header,
  label,
}: DataTableResizeHandleProps<TData, TValue>) {
  if (!header.column.getCanResize()) return null;
  const isResizing = header.column.getIsResizing();
  return (
    <span
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${label} column`}
      onMouseDown={header.getResizeHandler()}
      onTouchStart={header.getResizeHandler()}
      onDoubleClick={() => header.column.resetSize()}
      onClick={(event) => event.stopPropagation()}
      className={cn(
        "absolute inset-y-0 end-0 z-20 flex w-2.5 cursor-col-resize touch-none select-none items-center justify-center",
        "opacity-0 transition-opacity duration-fast group-hover/th:opacity-100 motion-reduce:transition-none",
        isResizing && "opacity-100",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "h-4 w-0.5 rounded-full bg-white/30 transition-colors duration-fast motion-reduce:transition-none",
          isResizing && "h-full bg-brand-accent-500",
        )}
      />
    </span>
  );
}
