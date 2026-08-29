'use client';

import { User2 } from 'lucide-react';
import Link from 'next/link';
import { BoardView, type BoardColumn } from '@/components/shared/board-view';
import type { LexMatter } from '@/types/suites';
import { MATTER_STATUS_OPTIONS, type MatterLabels } from './labels';
import { MatterSlaDot } from '../_lib/matter-sla';
import { DueDateEditCell, OwnerEditCell, PriorityEditCell } from './inline-edit-cells';

/** Thin accent bar color per matter lifecycle status. */
const STATUS_ACCENT: Record<string, string> = {
  intake: 'bg-sky-400/60',
  open: 'bg-success-300/60',
  in_review: 'bg-warning-300/60',
  waiting_on_business: 'bg-violet-400/60',
  on_hold: 'bg-warning-300/60',
  closed: 'bg-muted-foreground/40',
  cancelled: 'bg-destructive/40',
};

interface MatterBoardProps {
  matters: LexMatter[];
  labels: MatterLabels;
  dir: 'ltr' | 'rtl';
  onMove?: (matterId: string, toStatus: string) => void;
  isMoving?: boolean;
  /** When true the board cards expose inline triage edit affordances. */
  canWrite?: boolean;
}

export function MatterBoard({ matters, labels, dir, onMove, isMoving, canWrite = false }: MatterBoardProps) {
  const columns: BoardColumn[] = MATTER_STATUS_OPTIONS.map((status) => ({
    id: status,
    label: labels.filters.statusOptions[status] ?? status.replace(/_/g, ' '),
    colorClass: STATUS_ACCENT[status],
  }));

  return (
    <BoardView<LexMatter>
      columns={columns}
      items={matters}
      getItemId={(matter) => matter.id}
      getItemColumnId={(matter) => matter.status}
      onMove={onMove}
      isMoving={isMoving}
      dir={dir}
      emptyColumnLabel={labels.view.boardEmptyColumn}
      renderCard={(matter) => <MatterBoardCard matter={matter} labels={labels} canWrite={canWrite} />}
    />
  );
}

function MatterBoardCard({
  matter,
  labels,
  canWrite,
}: {
  matter: LexMatter;
  labels: MatterLabels;
  canWrite: boolean;
}) {
  // Inline edit triggers must not start a drag/move on the underlying card.
  const stopDrag = (event: React.PointerEvent | React.MouseEvent) => event.stopPropagation();

  return (
    <div className="space-y-2.5 p-3">
      <div className="flex items-start justify-between gap-2">
        <Link
          href={`/lex/matters/${matter.id}`}
          className="min-w-0 text-sm font-medium leading-snug hover:underline"
          onClick={(event) => event.stopPropagation()}
        >
          <span className="line-clamp-2">{matter.title}</span>
        </Link>
        <div onPointerDownCapture={stopDrag} onClick={stopDrag} className="shrink-0">
          <PriorityEditCell matter={matter} canWrite={canWrite} />
        </div>
      </div>
      {matter.matter_number ? (
        <p className="text-xs font-mono text-muted-foreground">{matter.matter_number}</p>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
        <span
          className="inline-flex min-w-0 items-center gap-1"
          onPointerDownCapture={stopDrag}
          onClick={stopDrag}
        >
          <User2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <OwnerEditCell matter={matter} canWrite={canWrite} />
        </span>
        <span onPointerDownCapture={stopDrag} onClick={stopDrag}>
          <DueDateEditCell matter={matter} canWrite={canWrite} />
        </span>
        <MatterSlaDot matter={matter} showText />
      </div>
    </div>
  );
}
