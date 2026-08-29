'use client';

import Link from 'next/link';
import { Activity, ArrowUpRight, FileCheck2, GitCommitVertical, ServerCog } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { IconBadge } from '@/components/shared/icon-badge';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { useLocale } from '@/components/providers/locale-provider';
import { formatTimestamp } from '@/components/product';
import { cn } from '@/lib/utils';
import type { ActivityEvent, ActivitySource } from '../../_lib/collaboration';
import { useActivityFeedLabels, type ActivityFeedCopy } from './activity-feed-labels';

/**
 * ActivityFeed — the war-room's immutable "decision & action record".
 *
 * Renders a time-ordered (newest-first) stream of {@link ActivityEvent}s produced
 * by the foundation selector `ledgerToActivity()`, which merges the REAL immutable
 * attestation ledger with the run's REAL failover driver steps. Each row shows the
 * actor (or "system" when the source carries no actor), the human verb derived
 * from the entry type / step, the subject acted on, and the recorded timestamp.
 * Ledger-sourced events deep-link into the attestation ledger explorer
 * (`/dr/prove/ledger`), the canonical evidence surface.
 *
 * This IS the decision-log: it satisfies the decision-record intent from the real
 * attestation trail. There is no free-text note input — manual operator notes are
 * deferred and there is no backend to persist them, so none is faked here. There
 * are no presence avatars for the same reason (no presence channel exists).
 *
 * Presentational: the caller (war-room) owns the data fetch + liveness wiring and
 * passes `events` plus loading/error flags. Token-driven, RTL via logical props
 * (`text-start`, `ms-*`), and AA — source is conveyed by an icon + text chip, not
 * colour alone.
 */

export interface ActivityFeedProps {
  /** Time-ordered events from `ledgerToActivity()` (already newest-first). */
  events: ActivityEvent[];
  /** True while the first load is in flight (no data yet). */
  loading?: boolean;
  /** True when the underlying queries failed and no data is available. */
  errored?: boolean;
  /** Retry handler for the error state. */
  onRetry?: () => void;
  /**
   * Optional copy override; when omitted the feed resolves the bilingual
   * feature-local strings against the active locale (English fallback).
   */
  copy?: ActivityFeedCopy;
  className?: string;
}

/** Per-source presentation: an accessible label + a token-toned icon. */
const SOURCE_META: Record<
  ActivitySource,
  { icon: typeof FileCheck2; tone: 'primary' | 'info'; labelKey: 'sourceLedger' | 'sourceStep' }
> = {
  ledger: { icon: FileCheck2, tone: 'primary', labelKey: 'sourceLedger' },
  step: { icon: ServerCog, tone: 'info', labelKey: 'sourceStep' },
};

export function ActivityFeed({
  events,
  loading = false,
  errored = false,
  onRetry,
  copy: copyOverride,
  className,
}: ActivityFeedProps) {
  const { locale } = useLocale();
  const resolvedCopy = useActivityFeedLabels();
  const copy = copyOverride ?? resolvedCopy;

  return (
    <Card className={className} data-testid="run-activity-feed">
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4 shrink-0 text-content-muted" aria-hidden />
            {copy.heading}
          </CardTitle>
          <CardDescription>{copy.description}</CardDescription>
        </div>
        {!loading && !errored ? (
          <Badge variant="outline" className="shrink-0 tabular-nums">
            {events.length} {copy.eventsBadge}
          </Badge>
        ) : null}
      </CardHeader>

      <CardContent>
        {loading ? (
          <LoadingSkeleton variant="list-item" count={4} />
        ) : errored ? (
          <ErrorState message={copy.loadError} onRetry={onRetry} />
        ) : events.length === 0 ? (
          <EmptyState
            icon={GitCommitVertical}
            title={copy.emptyTitle}
            description={copy.emptyDescription}
            className="border border-dashed border-outline-subtle bg-surface-card"
            size="compact"
          />
        ) : (
          <ol className="flex flex-col gap-3" aria-label={copy.listLabel}>
            {events.map((event, index) => (
              <ActivityRow
                key={event.key}
                event={event}
                copy={copy}
                locale={locale}
                isLast={index === events.length - 1}
              />
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

function ActivityRow({
  event,
  copy,
  locale,
  isLast,
}: {
  event: ActivityEvent;
  copy: ActivityFeedCopy;
  locale: Parameters<typeof formatTimestamp>[1];
  isLast: boolean;
}) {
  const meta = SOURCE_META[event.source];
  const sourceLabel = copy[meta.labelKey];

  return (
    <li className="flex gap-3" data-source={event.source}>
      {/* Spine: a source-toned node + connecting rail (decorative). */}
      <div className="flex flex-col items-center">
        <IconBadge icon={meta.icon} tone={meta.tone} size="sm" />
        {!isLast ? <span className="mt-1 w-px flex-1 bg-outline-subtle" aria-hidden /> : null}
      </div>

      <div className="min-w-0 flex-1 pb-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <p className="min-w-0 text-body-sm text-content-primary">
            <span className="font-semibold">{event.actor}</span>{' '}
            <span className="text-content-secondary">{event.verb}</span>
          </p>
          <Badge variant="outline" className="shrink-0 normal-case">
            {sourceLabel}
          </Badge>
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-content-muted">
          <time dateTime={isParseable(event.at) ? event.at : undefined}>
            {formatTimestamp(event.at, locale)}
          </time>
          <span className="inline-flex min-w-0 items-center gap-1">
            <span className="uppercase tracking-caps text-content-muted">{copy.subjectLabel}</span>
            <span
              dir="ltr"
              title={event.subjectId}
              className="inline-block max-w-[20ch] truncate align-bottom font-mono text-content-secondary"
            >
              {event.subjectId}
            </span>
          </span>
          {event.source === 'ledger' ? (
            <Link
              href={ledgerHref(event.subjectId)}
              className={cn(
                'inline-flex items-center gap-1 rounded-button font-medium text-primary',
                'underline-offset-2 hover:underline focus-visible:outline-none',
                'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
              )}
            >
              {copy.ledgerLinkLabel}
              <ArrowUpRight className="h-3 w-3 shrink-0" aria-hidden />
            </Link>
          ) : null}
        </div>
      </div>
    </li>
  );
}

/**
 * Deep link to the immutable attestation ledger explorer, pre-seeding the
 * `subject` filter with the ledger entry's subject so the operator lands on the
 * exact subject's entries. `/dr/prove/ledger` is the only real ledger surface;
 * the `subject` query param matches the explorer's server-supported filter.
 */
function ledgerHref(subjectId: string): string {
  const params = new URLSearchParams({ subject: subjectId });
  return `/dr/prove/ledger?${params.toString()}`;
}

function isParseable(value: string): boolean {
  return !Number.isNaN(Date.parse(value));
}

export default ActivityFeed;
