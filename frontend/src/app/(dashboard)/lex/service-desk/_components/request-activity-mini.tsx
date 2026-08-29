'use client';

/**
 * #9 Request detail right rail — compact "Recent activity" mini-feed.
 *
 * REAL and fully functional: reads the SAME authoritative spine audit log the
 * full Activity tab reads (`GET /legal-requests/{id}/audit` via
 * `lexRequestsApi.listRequestAudit`), under the SAME react-query key
 * (`['lex-request-audit', requestId]`) `RequestActivityTimeline` uses — so the
 * two views share one cache entry and never double-fetch. It renders the
 * last {@link MAX_ENTRIES} entries reverse-chronologically in a tight rail
 * feed sized for a ~360px sidebar, with a "View all" affordance that hands
 * control back to the page (switch to the full Activity tab).
 *
 * This widget is READ-ONLY — the audit trail has no write surface. See
 * `request-note-composer.tsx` for the (honestly disabled) write side of #9.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, History } from 'lucide-react';
import { SectionCard } from '@/components/suites/section-card';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { EmptyState } from '@/components/common/empty-state';
import { Button } from '@/components/ui/button';
import { useLocale } from '@/components/providers/locale-provider';
import { useLexFormat } from '@/lib/lex/ksa';
import { lexRequestsApi, type LegalRequestAuditEntry } from '@/lib/lex/requests';
import { cn } from '@/lib/utils';
import { useServiceDeskLabels } from './labels';
import { useDetailExtraLabels, type DetailExtraLabels } from './detail-extra-labels';
import { useRequestActivityMiniLabels } from './request-activity-mini-labels';

export interface RequestActivityMiniProps {
  requestId: string;
  /** Called when the user asks to see the full history — the page decides
   *  what that means (typically: switch to the Activity tab). */
  onViewAll?: () => void;
  className?: string;
}

/** Rail is compact by design — only the freshest entries are worth the space. */
const MAX_ENTRIES = 5;

export function RequestActivityMini({ requestId, onViewAll, className }: RequestActivityMiniProps) {
  const { direction } = useLocale();
  const f = useLexFormat();
  const baseLabels = useServiceDeskLabels();
  const activityLabels = useDetailExtraLabels().activity;
  const t = useRequestActivityMiniLabels().mini;

  // Shared cache key with `RequestActivityTimeline` — whichever mounts first
  // fetches, the other reads the same cached result.
  const auditQuery = useQuery({
    queryKey: ['lex-request-audit', requestId],
    queryFn: () => lexRequestsApi.listRequestAudit(requestId),
    enabled: Boolean(requestId),
    retry: false,
  });

  const statusLabel = (token?: string | null): string =>
    token ? baseLabels.statusOptions[token] ?? token.replace(/_/g, ' ') : '—';

  const entries = useMemo(() => {
    const data = auditQuery.data ?? [];
    return [...data]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, MAX_ENTRIES);
  }, [auditQuery.data]);

  const isLoading = auditQuery.isLoading;
  const isError = auditQuery.isError;
  const isEmpty = !isLoading && !isError && entries.length === 0;

  return (
    <SectionCard
      title={
        <span className="inline-flex items-center gap-2">
          <History className="h-4 w-4 text-muted-foreground" aria-hidden />
          {t.title}
        </span>
      }
      className={className}
      contentClassName="space-y-3"
    >
      {isLoading ? (
        <LoadingSkeleton variant="list-item" count={3} />
      ) : isError ? (
        <EmptyState size="compact" title={t.loadError} description="" />
      ) : isEmpty ? (
        <EmptyState size="compact" title={t.empty} description="" />
      ) : (
        <div dir={direction} className="space-y-0">
          {entries.map((entry, idx) => (
            <MiniEntryRow
              key={entry.id}
              entry={entry}
              isLast={idx === entries.length - 1}
              statusLabel={statusLabel}
              activityLabels={activityLabels}
              formatRelative={f.formatRelative}
            />
          ))}
        </div>
      )}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="w-full justify-center text-xs"
        onClick={() => onViewAll?.()}
      >
        {t.viewAll}
      </Button>
    </SectionCard>
  );
}

interface MiniEntryRowProps {
  entry: LegalRequestAuditEntry;
  isLast: boolean;
  statusLabel: (token?: string | null) => string;
  activityLabels: DetailExtraLabels['activity'];
  formatRelative: (value: string | Date | number | null | undefined) => string;
}

function MiniEntryRow({ entry, isLast, statusLabel, activityLabels, formatRelative }: MiniEntryRowProps) {
  const isTransition = Boolean(entry.from_status || entry.to_status);
  const actor = entry.actor_name ?? entry.actor_user_id;

  return (
    <div className="flex gap-2.5">
      <div className="flex flex-col items-center">
        <div className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
        {!isLast && <div className="mt-1 w-px flex-1 bg-border" aria-hidden />}
      </div>
      <div className={cn('min-w-0 flex-1', !isLast && 'pb-3')}>
        {isTransition ? (
          <div className="flex flex-wrap items-center gap-1 text-xs font-medium leading-snug text-foreground">
            <span className="truncate">{statusLabel(entry.from_status)}</span>
            <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground rtl:-scale-x-100" aria-hidden />
            <span className="truncate">{statusLabel(entry.to_status)}</span>
          </div>
        ) : (
          <p className="truncate text-xs font-medium leading-snug text-foreground">
            {activityLabels.auditAction(entry.reason || entry.action.replace(/_/g, ' '))}
          </p>
        )}
        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
          {actor ? `${activityLabels.actorPrefix(actor)} · ` : ''}
          {formatRelative(entry.created_at)}
        </p>
      </div>
    </div>
  );
}
