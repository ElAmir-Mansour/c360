'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowRight, MessagesSquare, MoreVertical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { LexBoardSkeleton } from '@/components/lex/list-skeleton';
import { LexEmptyState } from '@/components/lex/empty-state';
import { LexPriorityChip } from '@/components/lex/status-chip';
import { rowAccentClass } from '@/components/lex/row-accents';
import { cn } from '@/lib/utils';
import type { AppLocale } from '@/lib/i18n';
import { resolveLocalized } from '@/lib/i18n/localized';
import {
  consultationsApi,
  CONSULTATION_STATUS_VALUES,
  type Consultation,
  type ConsultationStatus,
} from '@/lib/lex/consultations';
import { slaRisk } from './consultation-sla-meta';
import type { ConsultationLabels } from './labels';

/**
 * ConsultationsBoard — Kanban-style board view for consultations (#9).
 *
 * Owns its OWN status-agnostic query (one large page) and groups client-side
 * into the six FSM columns (submitted → … → archived). Cards are draggable;
 * dropping onto an *adjacent forward* column emits `onAdvance(card, target)` so
 * the shell can open the appropriate transition dialog (most transitions need
 * extra data, so the board never mutates directly). A per-card menu offers the
 * same forward advance as a non-drag, keyboard-accessible fallback.
 */
export interface ConsultationsBoardProps {
  /** Resolved consultation labels (English/Arabic already applied). */
  labels: ConsultationLabels;
  /** Active locale, used to resolve the bilingual card title. */
  locale: AppLocale;
  /** Force the loading state regardless of the board's own query. */
  loading?: boolean;
  /** Card click → open the consultation (detail view). */
  onSelect?: (consultation: Consultation) => void;
  /**
   * Forward FSM advance request. Fired on a valid drag-to-adjacent drop or via
   * the card menu; the shell opens the matching transition dialog (the board
   * does NOT mutate because most transitions require extra input).
   */
  onAdvance?: (consultation: Consultation, targetStatus: ConsultationStatus) => void;
}

/** Query key for the board's own (status-agnostic) fetch. */
export const CONSULTATIONS_BOARD_QUERY_KEY = ['lex-consultations-board'] as const;

/** Columns render in FSM order; index drives the "adjacent forward" rule. */
const BOARD_STATUSES: readonly ConsultationStatus[] = CONSULTATION_STATUS_VALUES;

/** SLA risk → dot colour (frozen palette: rose / gold / emerald / slate). */
const SLA_DOT: Record<ReturnType<typeof slaRisk>['level'], string> = {
  breached: 'bg-error-500',
  due_soon: 'bg-warning-500',
  on_track: 'bg-success-500',
  none: 'bg-muted-foreground/40',
};

/**
 * SSR-safe reduced-motion read so the board owns its own motion gating.
 */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(false);
  React.useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(media.matches);
    const listener = (event: MediaQueryListEvent) => setReduced(event.matches);
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, []);
  return reduced;
}

export function ConsultationsBoard({
  labels,
  locale,
  loading,
  onSelect,
  onAdvance,
}: ConsultationsBoardProps) {
  const prefersReducedMotion = usePrefersReducedMotion();

  // The board owns its data: one large, status-agnostic page, grouped client
  // side. Kept separate from the list page's paginated query so switching views
  // never disturbs the table's state.
  const { data, isLoading } = useQuery({
    queryKey: CONSULTATIONS_BOARD_QUERY_KEY,
    queryFn: () =>
      consultationsApi.list({
        page: 1,
        per_page: 200,
        sort: 'updated_at:desc',
      }),
  });

  const busy = loading || isLoading;
  const items = React.useMemo(() => data?.data ?? [], [data]);

  // Group once per data change into the six FSM buckets.
  const grouped = React.useMemo(() => {
    const buckets: Record<ConsultationStatus, Consultation[]> = {
      submitted: [],
      classified: [],
      routed: [],
      responded: [],
      approved: [],
      archived: [],
    };
    for (const item of items) {
      (buckets[item.status] ?? buckets.submitted).push(item);
    }
    return buckets;
  }, [items]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = React.useCallback(
    (event: DragEndEvent) => {
      const cardId = String(event.active.id);
      const target = event.over?.id ? (String(event.over.id) as ConsultationStatus) : null;
      if (!target) return;

      const card = items.find((c) => c.id === cardId);
      if (!card || card.status === target) return;

      // Only allow advancing exactly one step forward; the shell opens the
      // matching dialog. (Backward / multi-step moves are ignored.)
      const fromIdx = BOARD_STATUSES.indexOf(card.status);
      const toIdx = BOARD_STATUSES.indexOf(target);
      if (toIdx !== fromIdx + 1) return;

      onAdvance?.(card, target);
    },
    [items, onAdvance],
  );

  if (busy) {
    return <LexBoardSkeleton columns={BOARD_STATUSES.length} cards={3} />;
  }

  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-border/60 bg-card/40">
        <LexEmptyState
          icon={MessagesSquare}
          title={labels.emptyTitle}
          description={labels.emptyDescription}
        />
      </div>
    );
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        {BOARD_STATUSES.map((status, index) => (
          <BoardColumn
            key={status}
            status={status}
            label={labels.filters.statusOptions[status] ?? status}
            cards={grouped[status]}
            nextStatus={BOARD_STATUSES[index + 1]}
            nextLabel={
              BOARD_STATUSES[index + 1]
                ? labels.filters.statusOptions[BOARD_STATUSES[index + 1]] ??
                  BOARD_STATUSES[index + 1]
                : undefined
            }
            labels={labels}
            locale={locale}
            stagger={!prefersReducedMotion}
            onSelect={onSelect}
            onAdvance={onAdvance}
          />
        ))}
      </div>
    </DndContext>
  );
}

/* ------------------------------------------------------------------------- *
 * Column.
 * ------------------------------------------------------------------------- */

function BoardColumn({
  status,
  label,
  cards,
  nextStatus,
  nextLabel,
  labels,
  locale,
  stagger,
  onSelect,
  onAdvance,
}: {
  status: ConsultationStatus;
  label: string;
  cards: Consultation[];
  nextStatus?: ConsultationStatus;
  nextLabel?: string;
  labels: ConsultationLabels;
  locale: AppLocale;
  stagger: boolean;
  onSelect?: (consultation: Consultation) => void;
  onAdvance?: (consultation: Consultation, targetStatus: ConsultationStatus) => void;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: status });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex flex-col overflow-hidden rounded-xl border bg-card transition-colors duration-200',
        isOver && 'border-primary bg-primary/5',
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2.5">
        <span className="truncate text-sm font-semibold">{label}</span>
        <span className="inline-flex min-w-[1.5rem] items-center justify-center rounded-full border border-transparent bg-muted-foreground/15 px-2 py-0.5 text-xs font-semibold tabular-nums text-muted-foreground">
          {cards.length}
        </span>
      </div>

      <div className="flex-1 space-y-3 p-3">
        {cards.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">{labels.detail.none}</p>
        ) : (
          cards.map((card, idx) => (
            <BoardCard
              key={card.id}
              card={card}
              index={idx}
              stagger={stagger}
              labels={labels}
              locale={locale}
              nextStatus={nextStatus}
              nextLabel={nextLabel}
              onSelect={onSelect}
              onAdvance={onAdvance}
            />
          ))
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------- *
 * Card.
 * ------------------------------------------------------------------------- */

const MAX_STAGGER_INDEX = 8;
const STAGGER_STEP_MS = 40;

function BoardCard({
  card,
  index,
  stagger,
  labels,
  locale,
  nextStatus,
  nextLabel,
  onSelect,
  onAdvance,
}: {
  card: Consultation;
  index: number;
  stagger: boolean;
  labels: ConsultationLabels;
  locale: AppLocale;
  nextStatus?: ConsultationStatus;
  nextLabel?: string;
  onSelect?: (consultation: Consultation) => void;
  onAdvance?: (consultation: Consultation, targetStatus: ConsultationStatus) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: card.id,
  });

  const risk = slaRisk({
    breached: card.sla_breached,
    responseDueAt: card.sla_response_due_at,
    ackDone: card.sla_ack_done,
  });

  const title = resolveLocalized(card.title, locale) || card.consultation_number;

  const dragTransform = transform
    ? `${CSS.Translate.toString(transform)}${isDragging ? ' scale(1.02)' : ''}`
    : undefined;

  const revealStyle: React.CSSProperties = stagger
    ? { animationDelay: `${Math.min(index, MAX_STAGGER_INDEX) * STAGGER_STEP_MS}ms` }
    : {};

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect?.(card);
    }
  };

  return (
    <div
      ref={setNodeRef}
      style={{ transform: dragTransform, ...revealStyle }}
      {...attributes}
      {...listeners}
      role="button"
      tabIndex={0}
      aria-label={title}
      onClick={() => onSelect?.(card)}
      onKeyDown={handleKeyDown}
      className={cn(
        'group cursor-grab rounded-xl border bg-background px-3 py-3 ps-3.5 text-start shadow-sm transition-[box-shadow,border-color] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        // Color-coded, elevated accent rail tinted by the card's FSM status (#2).
        rowAccentClass('status', card.status),
        !isDragging && 'hover:border-primary/20 hover:shadow-md',
        isDragging && 'z-10 cursor-grabbing border-primary/40 opacity-90 shadow-lg',
        stagger && 'motion-safe:animate-fade-up',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          <span
            className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', SLA_DOT[risk.level])}
            aria-hidden
          />
          <p className="min-w-0 truncate font-medium">{title}</p>
        </div>

        {nextStatus && onAdvance ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                aria-label={labels.rowActions.actions}
                onClick={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
                onKeyDown={(event) => event.stopPropagation()}
              >
                <MoreVertical className="h-4 w-4" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              onClick={(event) => event.stopPropagation()}
            >
              <DropdownMenuItem onSelect={() => onSelect?.(card)}>
                {labels.rowActions.open}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onAdvance(card, nextStatus)}>
                <ArrowRight className="me-2 h-4 w-4" aria-hidden />
                {nextLabel}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      <p className="mt-1 text-xs text-muted-foreground">{card.consultation_number}</p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <LexPriorityChip
          value={card.priority}
          labels={labels.filters.priorityOptions}
          size="sm"
        />
        <span className="truncate text-xs text-muted-foreground">
          {card.advisor_name || labels.detail.unassigned}
        </span>
      </div>
    </div>
  );
}
