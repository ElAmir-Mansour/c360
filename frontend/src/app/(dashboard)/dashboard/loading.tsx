import { LoadingSkeleton } from '@/components/common/loading-skeleton';

/**
 * Dashboard loading boundary. Mirrors the uplifted page shape: hero header →
 * tonal KPI grid → content. Uses the semantic `kpi` skeleton variant (icon-chip
 * tiles) instead of generic card blocks so the placeholder matches the real
 * layout. Server-safe; shimmer is reduced-motion gated in globals.css.
 */
export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading dashboard">
      {/* Hero header placeholder */}
      <div className="relative overflow-hidden rounded-softest border border-[color:var(--panel-border)] bg-card/60 p-6 sm:p-7">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="w-full max-w-xl space-y-4">
            <div className="h-6 w-44 animate-pulse rounded-full bg-muted" />
            <div className="h-9 w-72 animate-pulse rounded-lg bg-muted" />
            <div className="h-4 w-96 max-w-full animate-pulse rounded-md bg-muted/70" />
            <div className="flex gap-2">
              <div className="h-6 w-24 animate-pulse rounded-full bg-muted/70" />
              <div className="h-6 w-20 animate-pulse rounded-full bg-muted/70" />
              <div className="h-6 w-20 animate-pulse rounded-full bg-muted/70" />
            </div>
          </div>
          <div className="flex gap-3">
            <div className="h-20 w-28 animate-pulse rounded-2xl bg-muted/60" />
            <div className="h-20 w-28 animate-pulse rounded-2xl bg-muted/60" />
          </div>
        </div>
      </div>

      {/* Tonal KPI grid placeholder */}
      <LoadingSkeleton variant="kpi" count={4} label="Loading metrics" />

      {/* Content grid placeholder */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <LoadingSkeleton variant="list" count={5} label="Loading alerts" />
        <LoadingSkeleton variant="list" count={5} label="Loading tasks" />
      </div>
    </div>
  );
}
