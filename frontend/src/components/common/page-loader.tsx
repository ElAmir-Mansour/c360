import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { cn } from '@/lib/utils';

interface PageLoaderProps {
  /** Number of KPI cards to render in the top grid (0 to hide). */
  kpis?: number;
  /** Show a chart-shaped block above the table. */
  withChart?: boolean;
  /** Number of table rows to render (0 to hide the table block). */
  rows?: number;
  className?: string;
}

/**
 * Generic full-page loading skeleton used by App Router `loading.tsx`
 * boundaries. Mirrors the common page shape: header → KPI grid → table.
 * Server-safe (no client hooks). Tailor with props per suite.
 */
export function PageLoader({
  kpis = 4,
  withChart = false,
  rows = 6,
  className,
}: PageLoaderProps) {
  return (
    <div
      className={cn('space-y-6 animate-fade-in', className)}
      role="status"
      aria-busy="true"
      aria-label="Loading page"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-2">
          <div className="h-7 w-56 animate-pulse rounded-md bg-muted" />
          <div className="h-4 w-80 animate-pulse rounded-md bg-muted/70" />
        </div>
        <div className="h-9 w-32 animate-pulse rounded-lg bg-muted" />
      </div>

      {/* KPI grid */}
      {kpis > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: kpis }).map((_, i) => (
            <LoadingSkeleton key={i} variant="card" />
          ))}
        </div>
      )}

      {withChart && <LoadingSkeleton variant="chart" />}

      {/* Table */}
      {rows > 0 && (
        <div className="overflow-hidden rounded-xl border bg-card">
          <div className="border-b px-4 py-3">
            <div className="h-4 w-40 animate-pulse rounded-md bg-muted" />
          </div>
          <LoadingSkeleton variant="table-row" count={rows} className="space-y-0" />
        </div>
      )}
    </div>
  );
}
