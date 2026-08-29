/**
 * <ObligationsBoard> — an optional status kanban over the obligation lifecycle.
 *
 * Columns are the obligation statuses in workflow order; cards summarise each
 * obligation (title, owner, source link, due-date SLA aging) and link nowhere
 * destructive. Dragging a card onto another column performs a direct status
 * update via the integrator's `onChangeStatus` (the obligation status field is a
 * free transition, unlike the gated settlement FSM). When the user lacks write
 * permission the board is read-only.
 *
 * Cards consume `rowAccentClass('status', …)` for a color-coded inline-start
 * accent + hover lift, and `<SlaAgingBadge>` for due-date proximity — so the
 * board speaks the same staleness language as the list. Self-contained drag
 * mechanics are delegated to the shared {@link BoardView} (dnd-kit).
 *
 * Bilingual + RTL safe via the active locale and the passed-in label bundle.
 */

'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { Building2, CalendarClock, User2 } from 'lucide-react';
import { BoardView, type BoardColumn } from '@/components/shared/board-view';
import { LexPriorityChip } from '@/components/lex/status-chip';
import { SlaAgingBadge } from '@/components/lex/sla-aging-badge';
import { rowAccentClass } from '@/components/lex/row-accents';
import { useLexFormat } from '@/lib/lex/ksa';
import { cn } from '@/lib/utils';
import type { LexObligation } from '@/types/suites';
import type { ObligationsLabels } from '../_lib/obligations-labels';

/** Lifecycle order: active lanes first, terminal lanes at the end. */
const BOARD_COLUMN_ORDER = ['open', 'in_progress', 'blocked', 'completed', 'waived', 'cancelled'] as const;

/** Status → thin column accent bar (top of each column). */
const COLUMN_ACCENT: Record<string, string> = {
  open: 'bg-warning-500',
  in_progress: 'bg-[hsl(var(--ds-brand-primary))]',
  blocked: 'bg-warning-500',
  completed: 'bg-success-500',
  waived: 'bg-neutral-400',
  cancelled: 'bg-rose-500',
};

export interface ObligationsBoardProps {
  obligations: LexObligation[];
  canWrite: boolean;
  dir: 'ltr' | 'rtl';
  labels: ObligationsLabels;
  /** Performs a direct status change; when omitted the board is read-only. */
  onChangeStatus?: (obligation: LexObligation, status: string) => void;
  isMoving?: boolean;
}

export function ObligationsBoard({
  obligations,
  canWrite,
  dir,
  labels,
  onChangeStatus,
  isMoving,
}: ObligationsBoardProps) {
  const columns: BoardColumn[] = useMemo(
    () =>
      BOARD_COLUMN_ORDER.map((status) => ({
        id: status,
        label: resolveEnum(labels.enums.statuses, status),
        colorClass: COLUMN_ACCENT[status],
      })),
    [labels],
  );

  const byId = useMemo(() => {
    const map = new Map<string, LexObligation>();
    for (const obligation of obligations) {
      map.set(obligation.id, obligation);
    }
    return map;
  }, [obligations]);

  const interactive = canWrite && Boolean(onChangeStatus);

  const handleMove = (obligationId: string, toColumnId: string) => {
    if (!onChangeStatus) return;
    const obligation = byId.get(obligationId);
    if (!obligation || obligation.status === toColumnId) return;
    onChangeStatus(obligation, toColumnId);
  };

  return (
    <BoardView<LexObligation>
      columns={columns}
      items={obligations}
      getItemId={(obligation) => obligation.id}
      getItemColumnId={(obligation) => String(obligation.status)}
      onMove={interactive ? handleMove : undefined}
      isMoving={isMoving}
      dir={dir}
      emptyColumnLabel={labels.board.emptyColumn}
      renderCard={(obligation) => <ObligationBoardCard obligation={obligation} labels={labels} />}
    />
  );
}

function ObligationBoardCard({
  obligation,
  labels,
}: {
  obligation: LexObligation;
  labels: ObligationsLabels;
}) {
  const f = useLexFormat();
  const source = obligation.contract_id
    ? { href: `/lex/contracts/${obligation.contract_id}`, label: obligation.contract_title ?? labels.cells.contractFallback }
    : null;

  return (
    <div className={cn('space-y-2.5 rounded-md p-3', rowAccentClass('status', obligation.status))}>
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 text-sm font-medium leading-snug">
          <span className="line-clamp-2">{obligation.title}</span>
        </p>
        {obligation.priority ? (
          <LexPriorityChip value={obligation.priority} labels={labels.enums.priorities} size="sm" />
        ) : null}
      </div>

      <p className="text-xs text-muted-foreground">
        {resolveEnum(labels.enums.types, obligation.type ?? 'contractual')}
      </p>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <User2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="truncate">{obligation.owner_name || labels.cells.unassigned}</span>
        </span>
        {source ? (
          <Link
            href={source.href}
            className="inline-flex min-w-0 items-center gap-1 hover:text-foreground hover:underline"
            onClick={(event) => event.stopPropagation()}
          >
            <Building2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="truncate">{source.label}</span>
          </Link>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-2 pt-0.5">
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <CalendarClock className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="tabular-nums">{obligation.due_date ? f.formatDate(obligation.due_date) : labels.cells.noDueDate}</span>
        </span>
        <SlaAgingBadge dueAt={obligation.due_date} status={obligation.status} size="sm" hideTiming />
      </div>
    </div>
  );
}

/** Localized enum resolver mirroring the page helper. */
function resolveEnum(map: Record<string, string>, token: string): string {
  return map[token] ?? token.replace(/_/g, ' ');
}
