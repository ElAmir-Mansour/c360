import { Skeleton } from '@/components/ui/skeleton';

// Tenant detail: header + KPI row + a detail panel of tenant fields.
export default function Loading() {
  return (
    <div className="space-y-6" role="status" aria-busy="true" aria-label="Loading tenant">
      <div className="space-y-2">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-4 w-96" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} variant="kpi" />
        ))}
      </div>
      <Skeleton variant="detail" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
