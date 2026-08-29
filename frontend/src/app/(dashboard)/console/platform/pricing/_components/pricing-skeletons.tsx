'use client';

// Skeleton placeholders for the calculator's result surfaces (deal summary strip
// + the 4 tier cards), shown while the FIRST /compute is pending. On a refetch we
// keep the previous data (keepPreviousData) and only dim it, so these skeletons
// are strictly the cold-start affordance and never blank an existing result.

import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

/** The deal-summary strip skeleton: four stat slots on one prominent bar. */
export function DealSummarySkeleton() {
  return (
    <Card aria-hidden data-testid="deal-summary-skeleton">
      <CardContent className="grid grid-cols-2 gap-6 p-6 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-7 w-28" />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/** A single tier-card skeleton. */
function TierCardSkeleton() {
  return (
    <Card>
      <CardHeader className="space-y-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-3 w-full" />
      </CardHeader>
      <CardContent className="space-y-4">
        <Skeleton className="h-9 w-32" />
        <div className="space-y-2">
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-5/6" />
          <Skeleton className="h-3 w-4/6" />
        </div>
        <Skeleton className="h-9 w-full rounded-lg" />
      </CardContent>
    </Card>
  );
}

/** The 4-card grid skeleton. */
export function TierCardsSkeleton() {
  return (
    <div
      aria-hidden
      data-testid="tier-cards-skeleton"
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
    >
      {Array.from({ length: 4 }).map((_, i) => (
        <TierCardSkeleton key={i} />
      ))}
    </div>
  );
}

/** The full cold-start skeleton: summary strip + cards. */
export function PricingResultSkeleton() {
  return (
    <div className="space-y-6">
      <DealSummarySkeleton />
      <TierCardsSkeleton />
    </div>
  );
}
