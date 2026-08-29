'use client';

/**
 * #5 Matter detail right rail — compact "Recent activity" mini-feed.
 *
 * Reads the SAME append-only matter audit log the full Activity tab reads
 * (`listMatterAudit`) under the SAME react-query key (`['lex-matter-audit',
 * matterId]`), so the rail and the tab share one cache entry and never
 * double-fetch. It renders the last {@link MAX_ENTRIES} entries
 * reverse-chronologically in a tight rail feed, with a "View all" affordance
 * that hands control back to the page (switch to the full Activity tab).
 *
 * READ-ONLY: the audit trail has no write surface. Degrades quietly — the matter
 * audit stream is empty for many matters today, which renders a friendly empty
 * state rather than an error.
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
import { enterpriseApi } from '@/lib/enterprise';
import type { LexMatterAuditEntry } from '@/types/suites';
import { cn } from '@/lib/utils';
import { useMatterActivityMiniLabels } from './matter-detail-labels';
import { useMatterStatusLabel, prettify } from './matter-enums-i18n';

export interface MatterActivityMiniProps {
  matterId: string;
  /** Called when the user asks to see the full history (switch to Activity tab). */
  onViewAll?: () => void;
  className?: string;
}

/** Rail is compact by design — only the freshest entries are worth the space. */
const MAX_ENTRIES = 5;

export function MatterActivityMini({ matterId, onViewAll, className }: MatterActivityMiniProps) {
  const { direction } = useLocaleOrDefault();
  const f = useLexFormat();
  const t = useMatterActivityMiniLabels();
  const statusLabel = useMatterStatusLabel();

  const auditQuery = useQuery({
    queryKey: ['lex-matter-audit', matterId],
    queryFn: () => enterpriseApi.lex.listMatterAudit(matterId),
    enabled: Boolean(matterId),
    retry: false,
  });

  const entries = useMemo<LexMatterAuditEntry[]>(() => {
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
              statusSet={t.statusSet}
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

function MiniEntryRow({
  entry,
  isLast,
  statusLabel,
  statusSet,
  actorPrefix,
  formatRelative,
}: {
  entry: LexMatterAuditEntry;
  isLast: boolean;
  statusLabel: (token: string) => string;
  statusSet: (to: string) => string;
  actorPrefix: (actor: string) => string;
  formatRelative: (value: string | Date | number | null | undefined) => string;
}) {
  const from = entry.from_status?.trim();
  const to = entry.to_status?.trim();
  const isTransition = Boolean(from && to);
  const actor = entry.actor_user_id?.trim();

  return (
    <div className="flex gap-2.5">
      <div className="flex flex-col items-center">
        <div className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
        {!isLast && <div className="mt-1 w-px flex-1 bg-border" aria-hidden />}
      </div>
      <div className={cn('min-w-0 flex-1', !isLast && 'pb-3')}>
        {isTransition ? (
          <div className="flex flex-wrap items-center gap-1 text-xs font-medium leading-snug text-foreground">
            <span className="truncate">{statusLabel(from!)}</span>
            <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground rtl:-scale-x-100" aria-hidden />
            <span className="truncate">{statusLabel(to!)}</span>
          </div>
        ) : (
          <p className="truncate text-xs font-medium leading-snug text-foreground" dir="auto">
            {to ? statusSet(statusLabel(to)) : prettify(entry.action || '')}
          </p>
        )}
        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
          {actor ? `${actorPrefix(actor)} · ` : ''}
          {formatRelative(entry.created_at)}
        </p>
      </div>
    </div>
  );
}
