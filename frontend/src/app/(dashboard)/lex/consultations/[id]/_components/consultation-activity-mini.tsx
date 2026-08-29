'use client';

/**
 * Right-rail "Recent activity" mini-feed for the consultation detail page.
 *
 * REAL and fully functional: reads the SAME governance audit log the full
 * Activity tab reads (`consultationsApi.listAudit`) under the SAME react-query
 * key (`['lex-consultation-audit', id]`) the page + lifecycle stepper use — so
 * every view shares one cache entry and never double-fetches. It renders the
 * last {@link MAX_ENTRIES} entries reverse-chronologically in a tight rail feed,
 * with a "View all" affordance that hands control back to the page (switch to
 * the full Activity tab). READ-ONLY — the audit trail has no write surface.
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
import { cn } from '@/lib/utils';
import { consultationsApi, type ConsultationAuditEntry } from '@/lib/lex/consultations';
import { useConsultationDetailLabels } from './detail-extra-labels';
import { useConsultationActionLabel, useConsultationStatusLabel } from './consultation-enums-i18n';

export interface ConsultationActivityMiniProps {
  consultationId: string;
  /** Called when the user asks to see the full history (switch to Activity tab). */
  onViewAll?: () => void;
  className?: string;
}

/** Rail is compact by design — only the freshest entries are worth the space. */
const MAX_ENTRIES = 5;

export function ConsultationActivityMini({
  consultationId,
  onViewAll,
  className,
}: ConsultationActivityMiniProps) {
  const { direction } = useLocaleOrDefault();
  const f = useLexFormat();
  const t = useConsultationDetailLabels().activityMini;
  const actionLabel = useConsultationActionLabel();
  const statusLabel = useConsultationStatusLabel();

  // Shared cache key with the page's audit query + the lifecycle stepper.
  const auditQuery = useQuery({
    queryKey: ['lex-consultation-audit', consultationId],
    queryFn: () => consultationsApi.listAudit(consultationId),
    enabled: Boolean(consultationId),
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
              actionLabel={actionLabel}
              statusLabel={statusLabel}
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
  entry: ConsultationAuditEntry;
  isLast: boolean;
  actionLabel: (action: string) => string;
  statusLabel: (status: string) => string;
  actorPrefix: (actor: string) => string;
  formatRelative: (value: string | Date | number | null | undefined) => string;
}

function MiniEntryRow({
  entry,
  isLast,
  actionLabel,
  statusLabel,
  actorPrefix,
  formatRelative,
}: MiniEntryRowProps) {
  const isTransition = Boolean(entry.from_status || entry.to_status);
  const actor = entry.actor_user_id ? entry.actor_user_id.slice(0, 8) : '';

  return (
    <div className="flex gap-2.5">
      <div className="flex flex-col items-center">
        <div className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
        {!isLast && <div className="mt-1 w-px flex-1 bg-border" aria-hidden />}
      </div>
      <div className={cn('min-w-0 flex-1', !isLast && 'pb-3')}>
        {isTransition ? (
          <div className="flex flex-wrap items-center gap-1 text-xs font-medium leading-snug text-foreground">
            {entry.from_status ? (
              <span className="truncate">{statusLabel(entry.from_status)}</span>
            ) : null}
            {entry.from_status && entry.to_status ? (
              <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground rtl:-scale-x-100" aria-hidden />
            ) : null}
            {entry.to_status ? (
              <span className="truncate">{statusLabel(entry.to_status)}</span>
            ) : null}
          </div>
        ) : (
          <p className="truncate text-xs font-medium leading-snug text-foreground" dir="auto">
            {actionLabel(entry.action)}
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
