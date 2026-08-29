'use client';

/**
 * Recent-activity mini-feed — right-rail SectionCard reading the SAME
 * append-only audit spine the full Audit Trail section reads (passed in as
 * `auditEntries` from the parent's `['lex-investigation-audit', id]` query, so
 * there is NO extra fetch). It renders the last {@link MAX_ENTRIES} entries
 * reverse-chronologically in a tight rail feed, with a "View full audit trail"
 * affordance that hands control back to the page (scroll to the Audit section).
 *
 * READ-ONLY — the audit trail has no write surface. Status transitions render
 * as `from → to` (localized); other actions render via the shared audit-action
 * resolver. Bilingual + RTL-correct.
 */

import { useMemo } from 'react';
import { ArrowRight, History } from 'lucide-react';
import { SectionCard } from '@/components/suites/section-card';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { EmptyState } from '@/components/common/empty-state';
import { Button } from '@/components/ui/button';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { useLexFormat } from '@/lib/lex/ksa';
import { cn } from '@/lib/utils';
import type { InvestigationAuditEntry } from '@/lib/lex/investigations';
import {
  useAuditActionLabel,
  useInvestigationStatusLabel,
} from './investigation-enums-i18n';
import { useInvestigationActivityMiniLabels } from './investigation-activity-mini-labels';

export interface InvestigationActivityMiniProps {
  auditEntries: InvestigationAuditEntry[];
  loading?: boolean;
  error?: boolean;
  /** Called when the user asks for the full history (page scrolls to Audit). */
  onViewAll?: () => void;
  className?: string;
}

/** Rail is compact — only the freshest entries earn the space. */
const MAX_ENTRIES = 5;

/** Render a readable actor from a user id (compact, stable). */
function shortActor(actorId: string): string {
  if (!actorId) return '—';
  return actorId.length > 12 ? `${actorId.slice(0, 8)}…` : actorId;
}

export function InvestigationActivityMini({
  auditEntries,
  loading = false,
  error = false,
  onViewAll,
  className,
}: InvestigationActivityMiniProps) {
  const { direction } = useLocaleOrDefault();
  const f = useLexFormat();
  const t = useInvestigationActivityMiniLabels();
  const statusLabel = useInvestigationStatusLabel();
  const actionLabel = useAuditActionLabel();

  const entries = useMemo(() => {
    return [...(auditEntries ?? [])]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, MAX_ENTRIES);
  }, [auditEntries]);

  const isEmpty = !loading && !error && entries.length === 0;

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
      {loading ? (
        <LoadingSkeleton variant="list-item" count={3} />
      ) : error ? (
        <EmptyState size="compact" title={t.loadError} description="" />
      ) : isEmpty ? (
        <EmptyState size="compact" title={t.empty} description="" />
      ) : (
        <div dir={direction} className="space-y-0">
          {entries.map((entry, idx) => {
            const isTransition = Boolean(entry.from_status || entry.to_status);
            const isLast = idx === entries.length - 1;
            return (
              <div key={entry.id} className="flex gap-2.5">
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
                        <ArrowRight
                          className="h-3 w-3 shrink-0 text-muted-foreground rtl:-scale-x-100"
                          aria-hidden
                        />
                      ) : null}
                      {entry.to_status ? (
                        <span className="truncate">{statusLabel(entry.to_status)}</span>
                      ) : null}
                    </div>
                  ) : (
                    <p className="truncate text-xs font-medium leading-snug text-foreground">
                      {actionLabel(entry.action)}
                    </p>
                  )}
                  <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                    {entry.actor_user_id ? `${t.by(shortActor(entry.actor_user_id))} · ` : ''}
                    {f.formatRelative(entry.created_at)}
                  </p>
                </div>
              </div>
            );
          })}
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
