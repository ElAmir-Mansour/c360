'use client';

import * as React from 'react';
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
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

export interface BoardColumn {
  id: string;
  label: string;
  /** Tailwind class applied to the thin accent bar at the top of the column. */
  colorClass?: string;
  /** Optional explicit count; falls back to the number of items in the column. */
  count?: number;
}

export interface BoardViewProps<T> {
  columns: BoardColumn[];
  items: T[];
  getItemId: (item: T) => string;
  getItemColumnId: (item: T) => string;
  renderCard: (item: T) => React.ReactNode;
  /** When provided the board is interactive (drag-and-drop enabled). */
  onMove?: (itemId: string, toColumnId: string) => void;
  isMoving?: boolean;
  dir?: 'ltr' | 'rtl';
  emptyColumnLabel?: string;
  /**
   * Stagger the entrance reveal of cards within each column. Defaults to `true`;
   * automatically becomes a no-op under `prefers-reduced-motion`.
   */
  animateReveal?: boolean;
}

/**
 * Reads the OS "reduce motion" preference. Lives locally (rather than importing a
 * shared hook) so this component owns its motion gating end-to-end. SSR-safe:
 * starts `false` and resolves on mount.
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

export function BoardView<T>({
  columns,
  items,
  getItemId,
  getItemColumnId,
  renderCard,
  onMove,
  isMoving = false,
  dir = 'ltr',
  emptyColumnLabel = 'No items',
  animateReveal = true,
}: BoardViewProps<T>) {
  const isRtl = dir === 'rtl';
  const readOnly = !onMove;
  const prefersReducedMotion = usePrefersReducedMotion();
  const stagger = animateReveal && !prefersReducedMotion;

  // Activation distance of 8px prevents accidental drags from a click/tap while
  // keeping the gesture responsive. TouchSensor mirrors it for touch devices with
  // a short press delay so vertical scroll still works inside a column.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 120, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Group items by column for stable rendering.
  const itemsByColumn = React.useMemo(() => {
    const map = new Map<string, T[]>();
    for (const column of columns) {
      map.set(column.id, []);
    }
    for (const item of items) {
      const columnId = getItemColumnId(item);
      const bucket = map.get(columnId);
      if (bucket) {
        bucket.push(item);
      }
    }
    return map;
  }, [columns, items, getItemColumnId]);

  const handleDragEnd = (event: DragEndEvent) => {
    if (!onMove) {
      return;
    }
    const itemId = String(event.active.id);
    const toColumnId = event.over?.id ? String(event.over.id) : null;
    if (!toColumnId) {
      return;
    }
    const item = items.find((candidate) => getItemId(candidate) === itemId);
    if (!item) {
      return;
    }
    if (getItemColumnId(item) === toColumnId) {
      return;
    }
    onMove(itemId, toColumnId);
  };

  const board = (
    <div
      className={cn(
        'flex gap-4 overflow-x-auto pb-2',
        isRtl && 'flex-row-reverse',
      )}
      dir={dir}
    >
      {columns.map((column) => {
        const columnItems = itemsByColumn.get(column.id) ?? [];
        const count = column.count ?? columnItems.length;
        return (
          <BoardColumnView
            key={column.id}
            column={column}
            count={count}
            readOnly={readOnly}
            isMoving={isMoving}
            isRtl={isRtl}
            emptyColumnLabel={emptyColumnLabel}
          >
            {columnItems.map((item, index) => {
              const id = getItemId(item);
              return (
                <BoardCard
                  key={id}
                  id={id}
                  readOnly={readOnly}
                  isMoving={isMoving}
                  stagger={stagger}
                  index={index}
                >
                  {renderCard(item)}
                </BoardCard>
              );
            })}
          </BoardColumnView>
        );
      })}
    </div>
  );

  if (readOnly) {
    return board;
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      {board}
    </DndContext>
  );
}

interface BoardColumnViewProps {
  column: BoardColumn;
  count: number;
  readOnly: boolean;
  isMoving: boolean;
  isRtl: boolean;
  emptyColumnLabel: string;
  children: React.ReactNode;
}

function BoardColumnView({
  column,
  count,
  readOnly,
  isMoving,
  isRtl,
  emptyColumnLabel,
  children,
}: BoardColumnViewProps) {
  const droppable = useDroppable({ id: column.id, disabled: readOnly });
  const isEmpty = React.Children.count(children) === 0;

  const content = (
    <div
      ref={readOnly ? undefined : droppable.setNodeRef}
      className={cn(
        'flex w-72 shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-card/40 transition-colors duration-200',
        !readOnly && droppable.isOver && 'border-primary bg-accent/20',
        isMoving && 'opacity-70',
      )}
    >
      <div className={cn('h-1 w-full', column.colorClass ?? 'bg-primary/40')} aria-hidden />
      <div
        className={cn(
          'flex items-center justify-between gap-2 px-3 py-2.5',
          isRtl && 'flex-row-reverse',
        )}
      >
        <span className="truncate text-sm font-semibold text-foreground">{column.label}</span>
        <Badge variant="outline" className="shrink-0">
          {count}
        </Badge>
      </div>
      <div className="flex min-h-[4rem] flex-1 flex-col gap-3 px-3 pb-3">
        {isEmpty ? (
          <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
            {emptyColumnLabel}
          </p>
        ) : (
          children
        )}
      </div>
    </div>
  );

  return content;
}

interface BoardCardProps {
  id: string;
  readOnly: boolean;
  isMoving: boolean;
  stagger: boolean;
  index: number;
  children: React.ReactNode;
}

/** Cap the cascade so long columns don't trail in for an uncomfortably long time. */
const MAX_STAGGER_INDEX = 8;
const STAGGER_STEP_MS = 40;

function BoardCard({ id, readOnly, isMoving, stagger, index, children }: BoardCardProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id,
    disabled: readOnly,
  });

  // Entrance cascade via per-card animation-delay. Gated by `stagger`, which is
  // already false under prefers-reduced-motion, so cards never sit invisibly
  // waiting on a delay when motion is disabled.
  const revealStyle: React.CSSProperties | undefined = stagger
    ? { animationDelay: `${Math.min(index, MAX_STAGGER_INDEX) * STAGGER_STEP_MS}ms` }
    : undefined;
  const revealClass = stagger ? 'animate-fade-up' : undefined;

  if (readOnly) {
    return (
      <div
        style={revealStyle}
        className={cn(
          'rounded-xl border border-border bg-background shadow-sm transition-[box-shadow,border-color] duration-200 hover:border-primary/20 hover:shadow-md',
          revealClass,
        )}
      >
        {children}
      </div>
    );
  }

  // dnd-kit writes `transform` inline, so the lift scale must be baked into that
  // same string — a Tailwind `scale-*` class would be overridden by the inline
  // style. When idle the hover-lift is handled purely by the className transition.
  const dragTransform = transform
    ? `${CSS.Translate.toString(transform)}${isDragging ? ' scale(1.02)' : ''}`
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={{ transform: dragTransform, ...revealStyle }}
      {...listeners}
      {...attributes}
      className={cn(
        'cursor-grab touch-none rounded-xl border border-border bg-background shadow-sm transition-[box-shadow,border-color] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        !isDragging && 'hover:border-primary/20 hover:shadow-md hover:transition-[box-shadow,border-color]',
        isDragging && 'z-10 cursor-grabbing border-primary/40 opacity-90 shadow-lg',
        isMoving && 'pointer-events-none opacity-70',
        revealClass,
      )}
    >
      {children}
    </div>
  );
}
