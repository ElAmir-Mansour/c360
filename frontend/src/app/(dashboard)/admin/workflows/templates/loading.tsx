import { LoadingSkeleton } from '@/components/common/loading-skeleton';

/**
 * Route-segment fallback that mirrors the Templates gallery layout:
 * header band → responsive grid of template cards.
 */
export default function Loading() {
  return (
    <div className="space-y-6" role="status" aria-busy="true">
      <div className="space-y-2">
        <LoadingSkeleton variant="text" className="h-8 w-56" />
        <LoadingSkeleton variant="text" className="h-4 w-80" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <LoadingSkeleton variant="card" count={6} />
      </div>
    </div>
  );
}
