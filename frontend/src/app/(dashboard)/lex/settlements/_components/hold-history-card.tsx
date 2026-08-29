'use client';

/**
 * External-hold history card (feature #12) for the case-timeline panel split.
 *
 * SELF-CONTAINED + read-only: owns its OWN react-query for the matter's
 * external-hold audit trail. The shell only needs to render
 * `<HoldHistoryCard matterId=.. />`. Query key:
 * `['lex-matter-hold-history', matterId]`.
 *
 * Renders a vertical timeline (newest first — the backend already returns
 * descending) where each entry shows the action ("placed on hold" / "hold
 * cleared") with a toned icon (placed=rose, cleared=emerald), the delay
 * category (when present), the reason, the timestamp and a relative time.
 * The whole list is collapsible behind the SectionCard header (native
 * <details>/<summary> for accessibility).
 */

import { useQuery } from '@tanstack/react-query';
import { ChevronDown, History, PauseCircle, PlayCircle } from 'lucide-react';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { RelativeTime } from '@/components/shared/relative-time';
import { SectionCard } from '@/components/suites/section-card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { formatDateTime, shortenUUID } from '@/lib/format';
import { delayCategoryLabel, useSettlementLabels } from './labels';
import { settlementsApi, type HoldHistoryEntry } from '@/lib/lex/settlements';

export interface HoldHistoryCardProps {
  matterId: string;
}

/** Base react-query key for this matter's hold history (shell may invalidate). */
export function holdHistoryQueryKey(matterId: string): [string, string] {
  return ['lex-matter-hold-history', matterId];
}

export function HoldHistoryCard({ matterId }: HoldHistoryCardProps) {
  const L = useSettlementLabels();
  const labels = L.timeline.holdHistory;

  const historyQuery = useQuery({
    queryKey: holdHistoryQueryKey(matterId),
    queryFn: () => settlementsApi.listHoldHistory(matterId),
    enabled: Boolean(matterId),
  });

  const entries = historyQuery.data ?? [];

  const renderEntry = (entry: HoldHistoryEntry) => {
    const placed = entry.action === 'set';
    const Icon = placed ? PauseCircle : PlayCircle;
    return (
      <div key={entry.id} className="relative ps-7">
        <span
          className={cn(
            'absolute start-0 top-0.5 grid h-5 w-5 place-items-center rounded-full',
            placed
              ? 'bg-rose-50 text-rose-600'
              : 'bg-success-50 text-success-600',
          )}
          aria-hidden
        >
          <Icon className="h-3.5 w-3.5" />
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={placed ? 'destructive' : 'success'}>
            {placed ? labels.placed : labels.cleared}
          </Badge>
          {entry.category ? (
            <Badge variant="outline">{delayCategoryLabel(L, entry.category)}</Badge>
          ) : null}
        </div>
        {entry.reason ? <p className="mt-1.5 text-sm">{entry.reason}</p> : null}
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span>{formatDateTime(entry.created_at)}</span>
          <span aria-hidden>•</span>
          <RelativeTime date={entry.created_at} className="text-xs" />
          {entry.created_by ? (
            <span className="font-mono opacity-70">{shortenUUID(entry.created_by)}</span>
          ) : null}
        </div>
      </div>
    );
  };

  return (
    <SectionCard title={labels.title}>
      <details className="group" open>
        <summary className="flex cursor-pointer list-none items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ChevronDown
            className="h-4 w-4 transition-transform group-open:rotate-180 motion-reduce:transition-none"
            aria-hidden
          />
          <span>{labels.title}</span>
        </summary>
        <div className="mt-3">
          {historyQuery.isLoading ? (
            <LoadingSkeleton variant="list-item" count={3} />
          ) : historyQuery.isError ? (
            <ErrorState
              error={historyQuery.error}
              onRetry={() => void historyQuery.refetch()}
            />
          ) : entries.length === 0 ? (
            <EmptyState icon={History} title={labels.empty} description={labels.empty} size="compact" />
          ) : (
            <div className="space-y-4 border-s ps-1">
              {entries.map(renderEntry)}
            </div>
          )}
        </div>
      </details>
    </SectionCard>
  );
}
