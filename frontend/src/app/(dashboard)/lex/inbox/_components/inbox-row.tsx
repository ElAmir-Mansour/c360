'use client';

/**
 * <InboxRow> — a single "awaiting me" decision row.
 *
 * Color-coded by its status/priority via the shared `rowAccentClass` (left
 * inline-start accent bar + faint wash + hover lift), shows a per-item
 * <SlaCountdown> so the breach risk reads at a glance, attributes the requester,
 * and exposes the quick action: an inline Approve/Decide button when the source
 * carries an action hook, else an Open link to the entity.
 *
 * Bilingual + RTL-safe: logical spacing, `rtl:rotate-180` on the directional
 * chevron; the host stamps `dir`.
 */

import Link from 'next/link';
import { CheckCircle2, ChevronRight, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { SlaCountdown } from '@/components/lex/sla-countdown';
import { rowAccentClass } from '@/components/lex/row-accents';
import type { InboxItem } from '../_lib/use-inbox';
import { useInboxLabels } from '../_lib/labels';

interface InboxRowProps {
  item: InboxItem;
  icon: LucideIcon;
  /** Opens the quick-decision dialog for an actionable item. */
  onDecide: (item: InboxItem) => void;
}

export function InboxRow({ item, icon: Icon, onDecide }: InboxRowProps) {
  const L = useInboxLabels();
  const accent = rowAccentClass('status', item.accentValue);

  return (
    <div
      className={cn(
        'group relative flex flex-col gap-3 rounded-xl px-4 py-3.5 ps-5',
        'border border-border/60 bg-card/40',
        accent,
        'motion-safe:animate-fade-up',
        'sm:flex-row sm:items-center sm:justify-between sm:gap-4',
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        <span
          aria-hidden
          className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-muted/60 text-muted-foreground ring-1 ring-inset ring-border/50"
        >
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 space-y-1">
          <Link
            href={item.href}
            className="block truncate text-sm font-semibold text-foreground hover:underline"
          >
            {item.title}
          </Link>
          {item.requestedBy ? (
            <p className="truncate text-xs text-muted-foreground">
              {L.requestedByPrefix} {item.requestedBy}
            </p>
          ) : (
            <p className="truncate text-xs text-muted-foreground">{L.unknownRequester}</p>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-3 ps-12 sm:ps-0">
        {/* Per-item countdown — compact, no ring, so the row stays scannable. */}
        <SlaCountdown
          dueAt={item.dueAt}
          showRing={false}
          hideTiming={false}
          className="w-36"
          label={item.dueAt ? undefined : L.noDeadline}
        />

        {item.action ? (
          <Button
            type="button"
            className="h-9 gap-1.5"
            onClick={() => onDecide(item)}
          >
            <CheckCircle2 className="h-4 w-4" aria-hidden />
            {L.approve}
          </Button>
        ) : (
          <Button asChild variant="secondary" className="h-9 gap-1.5">
            <Link href={item.href}>
              {L.open}
              <ChevronRight className="h-4 w-4 rtl:rotate-180" aria-hidden />
            </Link>
          </Button>
        )}
      </div>
    </div>
  );
}
