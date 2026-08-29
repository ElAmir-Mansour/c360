'use client';

/**
 * Right-rail "Recent activity" mini-feed for the Settlement detail page.
 *
 * REAL and fully functional: reads the SAME authoritative governance audit log
 * the full Activity tab reads (`GET /settlements/{id}/audit` via
 * `settlementsApi.listAudit`), under the SAME react-query key
 * (`['lex-settlement-audit', settlementId]`) the `SettlementAuditFeed` uses — so
 * the two views share one cache entry and never double-fetch. Renders the last
 * {@link MAX_ENTRIES} entries reverse-chronologically in a tight rail feed sized
 * for a ~360px sidebar, with a "View full audit" affordance that hands control
 * back to the page (switch to the Activity tab).
 *
 * READ-ONLY — the append-only audit trail has no write surface.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, History } from 'lucide-react';
import { SectionCard } from '@/components/suites/section-card';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { EmptyState } from '@/components/common/empty-state';
import { Button } from '@/components/ui/button';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { useLexFormat } from '@/lib/lex/ksa';
import { settlementsApi, type SettlementAuditEntry } from '@/lib/lex/settlements';
import { cn } from '@/lib/utils';
import { useSettlementDetailExtraLabels } from './detail-extra-labels';
import { useSettlementAuditActionLabel, useSettlementStatusLabel } from './settlement-enums-i18n';

export interface SettlementActivityMiniProps {
  settlementId: string;
  /** Called when the user asks to see the full audit — the page switches tabs. */
  onViewAll?: () => void;
  className?: string;
}

const MAX_ENTRIES = 5;

export function SettlementActivityMini({
  settlementId,
  onViewAll,
  className,
}: SettlementActivityMiniProps) {
  const { direction } = useLocaleOrDefault();
  const f = useLexFormat();
  const t = useSettlementDetailExtraLabels().activity;
  const statusLabel = useSettlementStatusLabel();
  const actionLabel = useSettlementAuditActionLabel();

  // Shared cache key with `SettlementAuditFeed` — whichever mounts first fetches.
  const auditQuery = useQuery({
    queryKey: ['lex-settlement-audit', settlementId],
    queryFn: () => settlementsApi.listAudit(settlementId),
    enabled: Boolean(settlementId),
    retry: false,
  });

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
              actionLabel={actionLabel}
              actorPrefix={t.actorPrefix}
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
  entry: SettlementAuditEntry;
  isLast: boolean;
  statusLabel: (status: string) => string;
  actionLabel: (action: string) => string;
  actorPrefix: (id: string) => string;
  formatRelative: (value: string | Date | number | null | undefined) => string;
}

function MiniEntryRow({
  entry,
  isLast,
  statusLabel,
  actionLabel,
  actorPrefix,
  formatRelative,
}: MiniEntryRowProps) {
  const isTransition = Boolean(entry.from_status || entry.to_status);

  return (
    <div className="flex gap-2.5">
      <div className="flex flex-col items-center">
        <div className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
        {!isLast && <div className="mt-1 w-px flex-1 bg-border" aria-hidden />}
      </div>
      <div className={cn('min-w-0 flex-1', !isLast && 'pb-3')}>
        {isTransition ? (
          <div className="flex flex-wrap items-center gap-1 text-xs font-medium leading-snug text-foreground">
            {entry.from_status ? <span className="truncate">{statusLabel(entry.from_status)}</span> : null}
            <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground rtl:-scale-x-100" aria-hidden />
            <span className="truncate">{statusLabel(entry.to_status ?? '')}</span>
          </div>
        ) : (
          <p className="truncate text-xs font-medium leading-snug text-foreground" dir="auto">
            {actionLabel(entry.action)}
          </p>
        )}
        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
          {entry.actor_user_id ? `${actorPrefix(entry.actor_user_id)} · ` : ''}
          {formatRelative(entry.created_at)}
        </p>
      </div>
    </div>
  );
}
