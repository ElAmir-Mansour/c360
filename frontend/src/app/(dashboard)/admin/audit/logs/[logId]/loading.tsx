import { Skeleton } from '@/components/ui/skeleton';

// Audit log detail: header + a detail panel of the log entry and its diff.
export default function Loading() {
  return (
    <div className="space-y-6" role="status" aria-busy="true" aria-label="Loading audit log">
      <div className="space-y-2">
        <Skeleton className="h-7 w-72" />
        <Skeleton className="h-4 w-52" />
      </div>
      <Skeleton variant="detail" />
      <Skeleton variant="table" rows={5} cols={3} />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
