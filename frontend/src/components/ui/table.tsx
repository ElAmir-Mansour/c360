"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { densityPadding, type Density } from "@/components/ui/ui-system";
import { useDensity } from "@/components/ui/use-density";
import { Skeleton } from "@/components/ui/skeleton";
import {
  EmptyState,
  type EmptyStateProps,
} from "@/components/common/empty-state";

interface TableProps extends React.HTMLAttributes<HTMLTableElement> {
  /** Makes a horizontally scrollable table region keyboard reachable. */
  scrollRegionLabel?: string;
}

const Table = React.forwardRef<HTMLTableElement, TableProps>(
({ className, scrollRegionLabel, ...props }, ref) => (
  <div
    className="relative w-full overflow-auto outline-none focus-visible:ring-2 focus-visible:ring-ring"
    role={scrollRegionLabel ? "region" : undefined}
    aria-label={scrollRegionLabel}
    tabIndex={scrollRegionLabel ? 0 : undefined}
  >
    <table
      ref={ref}
      className={cn(
        "w-full caption-bottom border-separate border-spacing-0 text-body-sm",
        className,
      )}
      {...props}
    />
  </div>
));
Table.displayName = "Table";

const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead ref={ref} className={cn(className)} {...props} />
));
TableHeader.displayName = "TableHeader";

/**
 * TableBody. Set `zebra` to stripe even rows with a whisper of `bg-muted` for
 * long dense tables — optional and off by default so the standard look is
 * unchanged. Striping is applied via a child selector so callers don't have to
 * thread a prop onto every <TableRow>.
 */
interface TableBodyProps extends React.HTMLAttributes<HTMLTableSectionElement> {
  /** Stripe even rows for easier row tracking in long tables. Default: false. */
  zebra?: boolean;
}

const TableBody = React.forwardRef<HTMLTableSectionElement, TableBodyProps>(
  ({ className, zebra = false, ...props }, ref) => (
    <tbody
      ref={ref}
      className={cn(
        "[&_tr:last-child_td]:border-b-0",
        // Zebra: a faint wash on even rows. Kept below hover/selected emphasis.
        zebra && "[&>tr:nth-child(even)]:bg-muted/20",
        className,
      )}
      {...props}
    />
  ),
);
TableBody.displayName = "TableBody";

const TableFooter = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tfoot
    ref={ref}
    className={cn(
      "border-t border-border bg-muted/50 font-medium [&>tr]:last:border-b-0",
      className,
    )}
    {...props}
  />
));
TableFooter.displayName = "TableFooter";

const TableRow = React.forwardRef<
  HTMLTableRowElement,
  React.HTMLAttributes<HTMLTableRowElement>
>(({ className, onClick, tabIndex, onKeyDown, ...props }, ref) => {
  // A row is "interactive" when the consumer wires up an onClick — that's the
  // clickable-row affordance signal. We then add a pointer cursor, a stronger
  // hover emphasis, keyboard focusability, and Enter/Space activation so the
  // row behaves like the button it visually becomes.
  const interactive = onClick != null;

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTableRowElement>) => {
    onKeyDown?.(event);
    if (!interactive || event.defaultPrevented) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      // Synthesize a click so a single onClick handler serves mouse + keyboard.
      event.currentTarget.click();
    }
  };

  return (
    <tr
      ref={ref}
      onClick={onClick}
      // Make interactive rows keyboard-reachable (callers may still override).
      // NB: no role="button" — the row keeps its implicit `row` role so it can
      // contain interactive cells (links/menus) without violating WCAG 4.1.2
      // (nested-interactive) or aria-allowed-attr (aria-selected on a button).
      // Keyboard activation is preserved via tabIndex + Enter/Space handler.
      tabIndex={interactive ? (tabIndex ?? 0) : tabIndex}
      onKeyDown={interactive ? handleKeyDown : onKeyDown}
      className={cn(
        // `group` so a <TableActionCell> inside can reveal its actions on row
        // hover / focus. Token-bound border + motion limited to the properties
        // that actually change (never transition-all), at fast standard motion.
        "group border-b border-border/60 transition-[background-color,box-shadow] duration-fast ease-standard",
        // Consistent resting hover across the kit: a calm brand wash.
        "hover:bg-primary/[0.045]",
        // Selected state (row selection). Driven by either the Radix-style
        // data-[state=selected] or a plain aria-selected="true"; both get a soft
        // brand tint plus a subtle inset accent ring (no layout shift, RTL-safe).
        "data-[state=selected]:bg-primary/5 data-[state=selected]:ring-1 data-[state=selected]:ring-inset data-[state=selected]:ring-primary/30",
        "aria-selected:bg-primary/5 aria-selected:ring-1 aria-selected:ring-inset aria-selected:ring-primary/30",
        // Keyboard focus ring — uses the design-system focus elevation token so
        // it reads consistently across light/dark and matches other primitives.
        "outline-none focus-visible:relative focus-visible:z-10 focus-visible:shadow-focus-ring",
        // Clickable affordance: pointer + a slightly stronger brand wash. Rows
        // stay physically stable so dense values remain easy to track.
        interactive && "cursor-pointer hover:bg-primary/[0.065]",
        className,
      )}
      {...props}
    />
  );
});
TableRow.displayName = "TableRow";

interface TableHeadProps extends React.ThHTMLAttributes<HTMLTableCellElement> {
  /** Cell density; inherits the nearest DensityProvider, else 'comfortable'. */
  density?: Density;
}

const TableHead = React.forwardRef<HTMLTableCellElement, TableHeadProps>(
  ({ className, density: densityProp, ...props }, ref) => {
    const density = useDensity(densityProp);
    return (
      <th
        ref={ref}
        className={cn(
          // Sticky header with a stronger treatment: a subtle shadow sits *under*
          // the header (elevation-1) so rows read as sliding beneath it on scroll,
          // plus a token-blurred translucent fill.
          "sticky top-0 z-10 bg-muted/95 text-start align-middle text-overline font-semibold uppercase text-muted-foreground shadow-elevation-1 backdrop-blur-sm supports-[backdrop-filter]:bg-muted/80",
          "border-b border-border/70 [&:has([role=checkbox])]:pe-0",
          density === "compact" ? "h-10" : "h-12",
          densityPadding.tableCell[density],
          className,
        )}
        {...props}
      />
    );
  },
);
TableHead.displayName = "TableHead";

interface TableCellProps extends React.TdHTMLAttributes<HTMLTableCellElement> {
  /** Cell density; inherits the nearest DensityProvider, else 'comfortable'. */
  density?: Density;
}

const TableCell = React.forwardRef<HTMLTableCellElement, TableCellProps>(
  ({ className, density: densityProp, ...props }, ref) => {
    const density = useDensity(densityProp);
    return (
      <td
        ref={ref}
        className={cn(
          "border-b border-border/60 align-middle text-foreground [&:has([role=checkbox])]:pe-0",
          densityPadding.tableCell[density],
          className,
        )}
        {...props}
      />
    );
  },
);
TableCell.displayName = "TableCell";

/**
 * TableActionCell — the consistent end-of-row actions cell (icon buttons,
 * kebab menu, …). End-aligned and RTL-safe (logical `justify-end` + `text-end`);
 * the actions stay hidden until the row is hovered or anything inside gains
 * focus, and are always shown on touch/coarse-pointer devices (no hover) and
 * for reduced-motion users, so they are never unreachable.
 */
const TableActionCell = React.forwardRef<HTMLTableCellElement, TableCellProps>(
  ({ className, density: densityProp, children, ...props }, ref) => {
    const density = useDensity(densityProp);
    return (
      <td
        ref={ref}
        className={cn(
          "border-b border-border/60 align-middle text-end",
          densityPadding.tableCell[density],
          className,
        )}
        {...props}
      >
        <div
          className={cn(
            "flex items-center justify-end gap-1",
            // Reveal on hover / focus. The transition is motion-safe; reduced-motion
            // users see the actions immediately (opacity is only lowered when motion
            // is allowed). Coarse pointers (touch) always show them.
            "transition-opacity duration-fast ease-standard",
            "motion-safe:opacity-0 motion-safe:group-hover:opacity-100 motion-safe:group-focus-within:opacity-100 motion-safe:focus-within:opacity-100",
            "[@media(hover:none)]:opacity-100",
          )}
        >
          {children}
        </div>
      </td>
    );
  },
);
TableActionCell.displayName = "TableActionCell";

const TableCaption = React.forwardRef<
  HTMLTableCaptionElement,
  React.HTMLAttributes<HTMLTableCaptionElement>
>(({ className, ...props }, ref) => (
  <caption
    ref={ref}
    className={cn("mt-4 text-body-sm text-muted-foreground", className)}
    {...props}
  />
));
TableCaption.displayName = "TableCaption";

export interface TableEmptyProps extends EmptyStateProps {
  /** Column count to span so the empty state centres across the whole table. */
  colSpan: number;
}

/**
 * TableEmpty — a polished zero-state row that spans the table and composes the
 * canonical <EmptyState> (icon/illustration + title + description + actions).
 * Drop it inside <TableBody> when there are no rows.
 */
const TableEmpty = React.forwardRef<HTMLTableRowElement, TableEmptyProps>(
  ({ colSpan, ...emptyProps }, ref) => (
    <tr ref={ref}>
      <td colSpan={colSpan} className="p-0 align-middle">
        <EmptyState size="compact" {...emptyProps} />
      </td>
    </tr>
  ),
);
TableEmpty.displayName = "TableEmpty";

export interface TableLoadingRowsProps {
  /** Number of placeholder rows. Default: 5. */
  rows?: number;
  /** Number of cells per row (match your column count). */
  cols: number;
  /** Cell density; inherits the nearest DensityProvider, else 'comfortable'. */
  density?: Density;
  className?: string;
}

/**
 * TableLoadingRows — placeholder <tr>s that compose the shared <Skeleton> shimmer
 * so loading tables match the resting layout (cell padding follows density). Wrap
 * your table (or set aria-busy) so assistive tech announces the loading state.
 */
function TableLoadingRows({
  rows = 5,
  cols,
  density: densityProp,
  className,
}: TableLoadingRowsProps) {
  const density = useDensity(densityProp);
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r} aria-hidden className="border-b border-border/60">
          {Array.from({ length: cols }).map((_, c) => (
            <td
              key={c}
              className={cn(
                "align-middle",
                densityPadding.tableCell[density],
                className,
              )}
            >
              <Skeleton className={cn("h-4", c === 0 ? "w-1/2" : "w-3/4")} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableActionCell,
  TableCaption,
  TableEmpty,
  TableLoadingRows,
};
