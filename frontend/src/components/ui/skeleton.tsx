import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Skeleton — the canonical loading-placeholder primitive plus its shaped
 * variants (text / kpi / chart / table / card / list / …), consolidated from
 * `common/loading-skeleton` and `lex/list-skeleton` so every suite shares one
 * shimmer language.
 *
 * Usage:
 *   <Skeleton className="h-4 w-24" />          // primitive block (unchanged API)
 *   <Skeleton variant="kpi" />                 // shaped variant via prop
 *   <Skeleton.Table rows={8} cols={5} />       // shaped variant via compound
 *
 * Motion safety: the base layers the design-system `skeleton-shimmer` sweep
 * (already `prefers-reduced-motion`-gated in globals.css) over a
 * `motion-safe:` pulse, so the placeholder still reads as "loading" with
 * motion disabled — via the static muted fill.
 */

export type SkeletonShape =
  | "text"
  | "card"
  | "chart"
  | "kpi"
  | "kpi-row"
  | "table"
  | "list"
  | "table-row"
  | "list-item"
  | "avatar"
  | "detail"
  | "form"
  | "board"
  | "grid"
  | "page";

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Shaped variant. Omit for the plain shimmer block (historic behavior). */
  variant?: SkeletonShape;
  /**
   * Row / item count for the `table` / `list` / `form` / `grid` / `kpi-row`
   * composites (interpreted as columns for `board`, matching existing usage).
   */
  rows?: number;
  /** Column count for the `table` / `grid` composites. */
  cols?: number;
}

/** Per-row stagger step (ms), capped so long lists don't drift out of phase. */
const STAGGER_STEP_MS = 70;
const STAGGER_CAP_MS = 560;
function staggerDelay(index: number): string {
  return `${Math.min(index * STAGGER_STEP_MS, STAGGER_CAP_MS)}ms`;
}

/** Single shimmering block — the primitive every shape composes. */
function SkeletonBlock({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-md bg-muted motion-safe:animate-pulse skeleton-shimmer",
        className,
      )}
      {...props}
    />
  );
}

/* ---- shaped variants ------------------------------------------------------ */

function SkeletonText({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("space-y-2", className)} {...props}>
      <SkeletonBlock className="h-4 w-full" />
      <SkeletonBlock className="h-4 w-5/6" />
      <SkeletonBlock className="h-4 w-4/6" />
    </div>
  );
}

function SkeletonCard({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("space-y-3 rounded-lg border bg-card p-6", className)} {...props}>
      <SkeletonBlock className="h-4 w-1/3" />
      <SkeletonBlock className="h-8 w-1/2" />
      <SkeletonBlock className="h-3 w-2/3" />
    </div>
  );
}

function SkeletonChart({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("rounded-lg border bg-card p-6", className)} {...props}>
      <SkeletonBlock className="mb-4 h-4 w-1/4" />
      <SkeletonBlock className="h-40 w-full" />
    </div>
  );
}

/** KPI stat tile: label, big value, delta line, with an icon chip aside. */
function SkeletonKpi({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex items-start justify-between rounded-xl border bg-card p-5", className)}
      {...props}
    >
      <div className="space-y-3">
        <SkeletonBlock className="h-3 w-20" />
        <SkeletonBlock className="h-7 w-28" />
        <SkeletonBlock className="h-3 w-16" />
      </div>
      <SkeletonBlock className="h-10 w-10 rounded-xl" />
    </div>
  );
}

function SkeletonTableRow({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("flex items-center gap-4 border-b px-4 py-3", className)} {...props}>
      <SkeletonBlock className="h-4 w-16" />
      <SkeletonBlock className="h-4 flex-1" />
      <SkeletonBlock className="h-4 w-20" />
      <SkeletonBlock className="h-4 w-24" />
    </div>
  );
}

function SkeletonListItem({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("flex items-center gap-3 py-3", className)} {...props}>
      <SkeletonBlock className="h-8 w-8 rounded-full" />
      <div className="flex-1 space-y-1.5">
        <SkeletonBlock className="h-3.5 w-3/4" />
        <SkeletonBlock className="h-3 w-1/2" />
      </div>
    </div>
  );
}

function SkeletonAvatar({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <SkeletonBlock className={cn("h-8 w-8 rounded-full", className)} {...props} />;
}

export interface SkeletonTableProps extends React.HTMLAttributes<HTMLDivElement> {
  rows?: number;
  cols?: number;
}

/**
 * Full table placeholder: header band + `rows` staggered shimmer rows of
 * `cols` cells (the sweep cascades down the table; delays are capped).
 */
function SkeletonTable({ rows = 5, cols = 4, className, ...props }: SkeletonTableProps) {
  return (
    <div
      className={cn(
        "w-full overflow-hidden rounded-xl border border-border/60 bg-card/40",
        className,
      )}
      {...props}
    >
      <div className="flex items-center gap-4 border-b border-border/60 bg-muted/40 px-4 py-3">
        {Array.from({ length: cols }).map((_, c) => (
          <SkeletonBlock
            key={`h-${c}`}
            className={cn("h-3 bg-muted/60", c === 0 ? "w-28" : "flex-1")}
          />
        ))}
      </div>
      <div className="divide-y divide-border/50">
        {Array.from({ length: rows }).map((_, r) => (
          <div
            key={`r-${r}`}
            className="flex items-center gap-4 px-4 py-3.5 motion-safe:animate-fade-up"
            style={{ animationDelay: staggerDelay(r) }}
          >
            {Array.from({ length: cols }).map((_, c) => (
              <SkeletonBlock
                key={`r-${r}-c-${c}`}
                className={cn(
                  "h-4 bg-muted/50",
                  c === 0 ? "w-32 shrink-0" : "flex-1",
                  // Vary widths so the placeholder reads like real content.
                  c > 0 && c % 3 === 0 && "max-w-[60%]",
                  c > 0 && c % 2 === 0 && "max-w-[80%]",
                )}
                style={{ animationDelay: staggerDelay(r) }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export interface SkeletonListProps extends React.HTMLAttributes<HTMLDivElement> {
  rows?: number;
}

/** Vertical list of `rows` items inside a single bordered card. */
function SkeletonList({ rows = 5, className, ...props }: SkeletonListProps) {
  return (
    <div className={cn("divide-y rounded-lg border bg-card px-4", className)} {...props}>
      {Array.from({ length: rows }).map((_, idx) => (
        <SkeletonListItem key={idx} />
      ))}
    </div>
  );
}

/** Detail panel: title block + paired label/value field rows. */
function SkeletonDetail({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("space-y-6 rounded-lg border bg-card p-6", className)} {...props}>
      <div className="space-y-2">
        <SkeletonBlock className="h-6 w-1/2" />
        <SkeletonBlock className="h-3.5 w-1/3" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {Array.from({ length: 6 }).map((_, idx) => (
          <div key={idx} className="space-y-2">
            <SkeletonBlock className="h-3 w-20" />
            <SkeletonBlock className="h-4 w-3/4" />
          </div>
        ))}
      </div>
    </div>
  );
}

export interface SkeletonFormProps extends React.HTMLAttributes<HTMLDivElement> {
  rows?: number;
}

/** Form: `rows` label + control field rows plus a trailing action bar. */
function SkeletonForm({ rows = 4, className, ...props }: SkeletonFormProps) {
  return (
    <div className={cn("space-y-5 rounded-lg border bg-card p-6", className)} {...props}>
      {Array.from({ length: rows }).map((_, idx) => (
        <div key={idx} className="space-y-2">
          <SkeletonBlock className="h-3.5 w-28" />
          <SkeletonBlock className="h-11 w-full rounded-lg" />
        </div>
      ))}
      <div className="flex justify-end gap-3 pt-2">
        <SkeletonBlock className="h-11 w-24 rounded-lg" />
        <SkeletonBlock className="h-11 w-28 rounded-lg" />
      </div>
    </div>
  );
}

export interface SkeletonBoardProps extends React.HTMLAttributes<HTMLDivElement> {
  columns?: number;
  /** Cards rendered per column. */
  cards?: number;
}

/** Kanban placeholder: column headers + a few card-shaped shimmer blocks each. */
function SkeletonBoard({ columns = 4, cards = 3, className, ...props }: SkeletonBoardProps) {
  return (
    <div className={cn("flex gap-4 overflow-x-auto pb-2", className)} {...props}>
      {Array.from({ length: columns }).map((_, col) => (
        <div
          key={`col-${col}`}
          className="flex w-72 shrink-0 flex-col gap-3 rounded-xl border border-border/60 bg-card/40 p-3 motion-safe:animate-fade-up"
          style={{ animationDelay: staggerDelay(col) }}
        >
          <div className="flex items-center justify-between">
            <SkeletonBlock className="h-3.5 w-24 bg-muted/60" />
            <SkeletonBlock className="h-5 w-6 rounded-full bg-muted/50" />
          </div>
          {Array.from({ length: cards }).map((_, card) => (
            <div
              key={`col-${col}-card-${card}`}
              className="space-y-2.5 rounded-lg border border-border/50 bg-background/60 p-3"
              style={{ animationDelay: staggerDelay(col + card) }}
            >
              <SkeletonBlock className="h-4 w-5/6 bg-muted/50" />
              <SkeletonBlock className="h-3 w-1/2 bg-muted/40" />
              <div className="flex items-center gap-2 pt-1">
                <SkeletonBlock className="h-5 w-16 rounded-full bg-muted/40" />
                <SkeletonBlock className="h-3 w-12 bg-muted/30" />
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export interface SkeletonKpiRowProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Number of stat tiles in the responsive row. */
  count?: number;
}

/**
 * Responsive row of KPI tiles — the dashboard header pattern (a `SkeletonKpi`
 * grid). Mirrors the `4-up` layout the deprecated `LoadingSkeleton` used for
 * its `kpi` variant so pages get an identical shell.
 */
function SkeletonKpiRow({ count = 4, className, ...props }: SkeletonKpiRowProps) {
  return (
    <div
      className={cn("grid gap-4 sm:grid-cols-2 lg:grid-cols-4", className)}
      {...props}
    >
      {Array.from({ length: count }).map((_, idx) => (
        <div key={idx} className="motion-safe:animate-fade-up" style={{ animationDelay: staggerDelay(idx) }}>
          <SkeletonKpi />
        </div>
      ))}
    </div>
  );
}

export interface SkeletonGridProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Total card placeholders rendered. */
  items?: number;
  /** Columns at the largest breakpoint (1|2|3|4). */
  cols?: number;
}

/** Responsive grid of card placeholders — the card-list / gallery pattern. */
function SkeletonGrid({ items = 6, cols = 3, className, ...props }: SkeletonGridProps) {
  // Static class map (Tailwind cannot see dynamically-built class names).
  const colsClass =
    cols === 1
      ? "sm:grid-cols-1"
      : cols === 2
        ? "sm:grid-cols-2"
        : cols >= 4
          ? "sm:grid-cols-2 lg:grid-cols-4"
          : "sm:grid-cols-2 lg:grid-cols-3";
  return (
    <div className={cn("grid gap-4", colsClass, className)} {...props}>
      {Array.from({ length: items }).map((_, idx) => (
        <div key={idx} className="motion-safe:animate-fade-up" style={{ animationDelay: staggerDelay(idx) }}>
          <SkeletonCard />
        </div>
      ))}
    </div>
  );
}

/**
 * Page scaffold: a title/subtitle header band, a trailing action chip, then a
 * KPI row and a table — the shape most list/index routes fall back to while
 * their data loads. Purely additive; pages that want finer control still
 * compose the shaped pieces directly.
 */
function SkeletonPage({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("space-y-6", className)} {...props}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <SkeletonBlock className="h-7 w-56" />
          <SkeletonBlock className="h-4 w-72" />
        </div>
        <SkeletonBlock className="h-10 w-32 rounded-lg" />
      </div>
      <SkeletonKpiRow />
      <SkeletonTable />
    </div>
  );
}

/* ---- primitive + variant dispatch ---------------------------------------- */

function SkeletonImpl({ variant, rows, cols, className, ...props }: SkeletonProps) {
  switch (variant) {
    case "text":
      return <SkeletonText className={className} {...props} />;
    case "card":
      return <SkeletonCard className={className} {...props} />;
    case "chart":
      return <SkeletonChart className={className} {...props} />;
    case "kpi":
      return <SkeletonKpi className={className} {...props} />;
    case "kpi-row":
      return <SkeletonKpiRow count={rows} className={className} {...props} />;
    case "table":
      return <SkeletonTable rows={rows} cols={cols} className={className} {...props} />;
    case "list":
      return <SkeletonList rows={rows} className={className} {...props} />;
    case "table-row":
      return <SkeletonTableRow className={className} {...props} />;
    case "list-item":
      return <SkeletonListItem className={className} {...props} />;
    case "avatar":
      return <SkeletonAvatar className={className} {...props} />;
    case "detail":
      return <SkeletonDetail className={className} {...props} />;
    case "form":
      return <SkeletonForm rows={rows} className={className} {...props} />;
    case "board":
      return <SkeletonBoard columns={rows} className={className} {...props} />;
    case "grid":
      return <SkeletonGrid items={rows} cols={cols} className={className} {...props} />;
    case "page":
      return <SkeletonPage className={className} {...props} />;
    default:
      return <SkeletonBlock className={className} {...props} />;
  }
}

const Skeleton = Object.assign(SkeletonImpl, {
  /** The bare shimmer block (identical to `<Skeleton />` without a variant). */
  Block: SkeletonBlock,
  Text: SkeletonText,
  Card: SkeletonCard,
  Chart: SkeletonChart,
  Kpi: SkeletonKpi,
  KpiRow: SkeletonKpiRow,
  Table: SkeletonTable,
  List: SkeletonList,
  TableRow: SkeletonTableRow,
  ListItem: SkeletonListItem,
  Avatar: SkeletonAvatar,
  Detail: SkeletonDetail,
  Form: SkeletonForm,
  Board: SkeletonBoard,
  Grid: SkeletonGrid,
  Page: SkeletonPage,
});

export { Skeleton };
