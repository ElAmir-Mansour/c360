'use client';

/**
 * ENTITY-360 detail — right-rail "Recent activity" mini-feed (#5).
 *
 * A tight, rail-sized (≈360px) view of the SAME humanized activity story the
 * full Activity tab renders: it is fed the pre-built `LexActivityEvent[]` the
 * page derives from the org's linked-record updates (contracts / cases /
 * settlements `updated_at`), so the two views share one derivation and never
 * diverge. Shows the freshest {@link MAX_ENTRIES} events reverse-chronologically
 * with a tone-colored dot rail, plus a "View full activity" affordance that hands
 * control back to the page (switch to the Activity tab).
 *
 * READ-ONLY and honest: there is no per-entity audit endpoint (an entity is an
 * aggregation, not a record), so this is derived from linked-record timestamps —
 * the same, honest basis as the Activity tab. Mirrors the service-desk
 * `RequestActivityMini`.
 */

import { useMemo } from 'react';
import { History } from 'lucide-react';
import { SectionCard } from '@/components/suites/section-card';
import { EmptyState } from '@/components/common/empty-state';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { useLexFormat } from '@/lib/lex/ksa';
import type { LexActivityEvent, LexActivityTone } from '@/components/lex/activity-timeline';
import { useEntityDetailLabels } from './entity-detail-labels';

export interface EntityActivityMiniProps {
  events: LexActivityEvent[];
  /** Called when the user asks to see the full history (switch to Activity tab). */
  onViewAll?: () => void;
  className?: string;
}

const MAX_ENTRIES = 5;

const TONE_DOT: Record<LexActivityTone, string> = {
  neutral: 'bg-muted-foreground/50',
  info: 'bg-info-500',
  success: 'bg-primary',
  warning: 'bg-warning-500',
  danger: 'bg-error-500',
};

export function EntityActivityMini({ events, onViewAll, className }: EntityActivityMiniProps) {
  const { direction } = useLocaleOrDefault();
  const f = useLexFormat();
  const t = useEntityDetailLabels().activityMini;

  const entries = useMemo(
    () =>
      [...events]
        .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
        .slice(0, MAX_ENTRIES),
    [events],
  );

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
      {entries.length === 0 ? (
        <EmptyState size="compact" title={t.empty} description="" />
      ) : (
        <div dir={direction} className="space-y-0">
          {entries.map((entry, idx) => (
            <MiniEntryRow
              key={entry.id}
              event={entry}
              isLast={idx === entries.length - 1}
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
  event,
  isLast,
  actorPrefix,
  formatRelative,
}: {
  event: LexActivityEvent;
  isLast: boolean;
  actorPrefix: (actor: string) => string;
  formatRelative: (value: string | Date | number | null | undefined) => string;
}) {
  const dot = TONE_DOT[event.tone ?? 'neutral'];
  return (
    <div className="flex gap-2.5">
      <div className="flex flex-col items-center">
        <div className={cn('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', dot)} aria-hidden />
        {!isLast && <div className="mt-1 w-px flex-1 bg-border" aria-hidden />}
      </div>
      <div className={cn('min-w-0 flex-1', !isLast && 'pb-3')}>
        <p className="truncate text-xs font-medium leading-snug text-foreground" dir="auto">
          <span className="text-muted-foreground">{event.action}</span>
          {event.target ? <span className="text-foreground"> {event.target}</span> : null}
        </p>
        <p className="mt-0.5 truncate text-[11px] text-muted-foreground" dir="auto">
          {`${actorPrefix(event.actor.name)} · `}
          {formatRelative(event.at)}
        </p>
      </div>
    </div>
  );
}
