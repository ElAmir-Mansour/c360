import { Skeleton } from '@/components/ui/skeleton';

// Settings: a header block above a settings form panel.
export default function Loading() {
  return (
    <div className="space-y-6" role="status" aria-busy="true" aria-label="Loading settings">
      <div className="space-y-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-80" />
      </div>
      <Skeleton variant="form" rows={5} />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
