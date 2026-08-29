'use client';

import * as React from 'react';
import { DndContext, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { AlertTriangle, ArrowRightCircle, CheckCircle2, Loader2, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { daysOverdue } from '@/lib/enterprise';
import type { ActaActionItem, ActaActionItemStatus } from '@/types/suites';

interface ActionItemKanbanProps {
  items: ActaActionItem[];
  onMove: (item: ActaActionItem, nextStatus: ActaActionItemStatus) => void;
}

/**
 * Per-column visual tone. Each column owns a semantic tone so the board header
 * band, count chip, and droppable-hover affordance read at a glance and never
 * rely on a single colour cue. Tokens stay within the frozen palette (muted /
 * primary / emerald / destructive) used elsewhere in the suite.
 */
interface ColumnTone {
  /** Header band background + text. */
  header: string;
  /** Accent rail down the column's leading edge. */
  rail: string;
  /** Count chip. */
  chip: string;
  /** Border + tint applied while a card is dragged over the column. */
  over: string;
}

const COLUMNS: Array<{ key: ActaActionItemStatus; label: string; tone: ColumnTone }> = [
  {
    key: 'pending',
    label: 'Pending',
    tone: {
      header: 'bg-muted/60 text-foreground',
      rail: 'bg-muted-foreground/40',
      chip: 'border-transparent bg-muted-foreground/15 text-muted-foreground',
      over: 'border-muted-foreground/40 bg-muted/40',
    },
  },
  {
    key: 'in_progress',
    label: 'In Progress',
    tone: {
      header: 'bg-primary/10 text-primary',
      rail: 'bg-primary/60',
      chip: 'border-transparent bg-primary/15 text-primary',
      over: 'border-primary bg-primary/10',
    },
  },
  {
    key: 'completed',
    label: 'Completed',
    tone: {
      header: 'bg-success-500/10 text-success-700 dark:text-success-300',
      rail: 'bg-success-500/60',
      chip: 'border-transparent bg-success-500/15 text-success-700 dark:text-success-300',
      over: 'border-success-500 bg-success-500/10',
    },
  },
  {
    key: 'overdue',
    label: 'Overdue',
    tone: {
      header: 'bg-destructive/10 text-destructive',
      rail: 'bg-destructive/60',
      chip: 'border-transparent bg-destructive/15 text-destructive',
      over: 'border-destructive bg-destructive/10',
    },
  },
];

/** Cap the entrance cascade so long columns reveal promptly. */
const MAX_STAGGER_INDEX = 8;
const STAGGER_STEP_MS = 40;

/**
 * Reads the OS "reduce motion" preference locally so this component owns its
 * motion gating. SSR-safe: starts `false`, resolves on mount.
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

export function ActionItemKanban({ items, onMove }: ActionItemKanbanProps) {
  const prefersReducedMotion = usePrefersReducedMotion();
  const [selected, setSelected] = React.useState<Set<string>>(() => new Set());
  const [bulkBusy, setBulkBusy] = React.useState(false);

  // Drop any selected ids that no longer exist after a data refresh so the
  // toolbar count stays truthful.
  React.useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const live = new Set(items.map((item) => item.id));
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (live.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [items]);

  const toggleSelect = React.useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clearSelection = React.useCallback(() => setSelected(new Set()), []);

  const selectedItems = React.useMemo(
    () => items.filter((item) => selected.has(item.id)),
    [items, selected],
  );

  // Bulk transition through the SAME `onMove` data path used by drag-and-drop —
  // one call per item, skipping items already in the target column. The
  // 'completed' transition is intentionally excluded here because the page routes
  // completion through a per-item evidence dialog (not a silent status flip).
  const bulkMove = React.useCallback(
    (nextStatus: Exclude<ActaActionItemStatus, 'completed'>) => {
      if (selectedItems.length === 0) return;
      setBulkBusy(true);
      for (const item of selectedItems) {
        if (item.status !== nextStatus) onMove(item, nextStatus);
      }
      setSelected(new Set());
      // Brief busy flash; the page's query invalidation drives the real refresh.
      window.setTimeout(() => setBulkBusy(false), 400);
    },
    [selectedItems, onMove],
  );

  // 8px activation distance avoids accidental drags on click/tap; TouchSensor
  // mirrors it for touch (short press delay preserves vertical scroll); keyboard
  // sensor keeps the board operable without a pointer.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const itemId = String(event.active.id);
    const nextStatus = event.over?.id ? String(event.over.id) as ActaActionItemStatus : null;
    if (!nextStatus) {
      return;
    }
    const item = items.find((candidate) => candidate.id === itemId);
    if (!item || item.status === nextStatus) {
      return;
    }
    onMove(item, nextStatus);
  };

  return (
    <div className="space-y-4">
      <BulkToolbar
        count={selected.size}
        busy={bulkBusy}
        animate={!prefersReducedMotion}
        onMarkInProgress={() => bulkMove('in_progress')}
        onMarkPending={() => bulkMove('pending')}
        onClear={clearSelection}
      />

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-4">
          {COLUMNS.map((column) => (
            <KanbanColumn
              key={column.key}
              id={column.key}
              label={column.label}
              tone={column.tone}
              items={items.filter((item) => item.status === column.key)}
              stagger={!prefersReducedMotion}
              selected={selected}
              onToggleSelect={toggleSelect}
            />
          ))}
        </div>
      </DndContext>
    </div>
  );
}

/**
 * Bulk action toolbar — appears when one or more cards are selected and animates
 * in (slide + scale) unless reduced motion is requested. Bulk transitions reuse
 * the board's `onMove` data path so permissions and query invalidation are
 * identical to a single drag.
 */
function BulkToolbar({
  count,
  busy,
  animate,
  onMarkInProgress,
  onMarkPending,
  onClear,
}: {
  count: number;
  busy: boolean;
  animate: boolean;
  onMarkInProgress: () => void;
  onMarkPending: () => void;
  onClear: () => void;
}) {
  if (count === 0) {
    return null;
  }

  return (
    <div
      role="region"
      aria-label="Bulk actions"
      className={cn(
        'flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 shadow-sm',
        animate && 'animate-scale-in',
      )}
    >
      <span className="inline-flex items-center gap-2 text-sm font-medium">
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none text-primary" aria-hidden />
        ) : (
          <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden />
        )}
        {count} selected
      </span>
      <div className="ms-auto flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onMarkPending}>
          Mark pending
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onMarkInProgress}>
          <ArrowRightCircle className="me-1.5 h-4 w-4" aria-hidden />
          Mark in progress
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onClear}>
          <X className="me-1.5 h-4 w-4" aria-hidden />
          Clear
        </Button>
      </div>
    </div>
  );
}

function KanbanColumn({
  id,
  label,
  tone,
  items,
  stagger,
  selected,
  onToggleSelect,
}: {
  id: ActaActionItemStatus;
  label: string;
  tone: ColumnTone;
  items: ActaActionItem[];
  stagger: boolean;
  selected: Set<string>;
  onToggleSelect: (id: string) => void;
}) {
  const { isOver, setNodeRef } = useDroppable({ id });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'overflow-hidden rounded-xl border bg-card transition-colors duration-200',
        isOver && tone.over,
      )}
    >
      {/* Tonal column header band. */}
      <div className={cn('flex items-center justify-between gap-2 px-3 py-2.5', tone.header)}>
        <div className="flex min-w-0 items-center gap-2 font-semibold">
          <span className={cn('h-3.5 w-1 shrink-0 rounded-full', tone.rail)} aria-hidden />
          <span className="truncate">{label}</span>
        </div>
        <span
          className={cn(
            'inline-flex min-w-[1.5rem] items-center justify-center rounded-full border px-2 py-0.5 text-xs font-semibold tabular-nums',
            tone.chip,
          )}
        >
          {items.length}
        </span>
      </div>

      <div className="space-y-3 p-3">
        {items.map((item, index) => (
          <DraggableCard
            key={item.id}
            item={item}
            stagger={stagger}
            index={index}
            selected={selected.has(item.id)}
            onToggleSelect={onToggleSelect}
          />
        ))}
      </div>
    </div>
  );
}

function DraggableCard({
  item,
  stagger,
  index,
  selected,
  onToggleSelect,
}: {
  item: ActaActionItem;
  stagger: boolean;
  index: number;
  selected: boolean;
  onToggleSelect: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: item.id });
  const overdueDays = item.status === 'overdue' ? daysOverdue(item.due_date) : 0;

  // Bake the lift scale into dnd-kit's inline transform (an inline style would
  // otherwise override a Tailwind scale-* class).
  const dragTransform = transform
    ? `${CSS.Translate.toString(transform)}${isDragging ? ' scale(1.02)' : ''}`
    : undefined;

  // Entrance cascade; `stagger` is already false under prefers-reduced-motion so
  // a card never sits invisibly waiting on its delay.
  const revealStyle: React.CSSProperties = stagger
    ? { animationDelay: `${Math.min(index, MAX_STAGGER_INDEX) * STAGGER_STEP_MS}ms` }
    : {};

  return (
    <div
      ref={setNodeRef}
      style={{ transform: dragTransform, ...revealStyle }}
      {...listeners}
      {...attributes}
      className={cn(
        'cursor-grab rounded-xl border bg-background px-3 py-3 shadow-sm transition-[box-shadow,border-color] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        !isDragging && 'hover:border-primary/20 hover:shadow-md hover:transition-[box-shadow,border-color]',
        isDragging && 'z-10 cursor-grabbing border-primary/40 opacity-90 shadow-lg',
        selected && 'border-primary/60 ring-1 ring-primary/40',
        stagger && 'animate-fade-up',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          {/* Selection checkbox. `pointer-down` is stopped so toggling never
              starts a drag (the 8px activation lives on the card itself). */}
          <input
            type="checkbox"
            checked={selected}
            aria-label={selected ? `Deselect ${item.title}` : `Select ${item.title}`}
            onChange={() => onToggleSelect(item.id)}
            onPointerDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
            className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-input accent-primary"
          />
          <p className="min-w-0 font-medium">{item.title}</p>
        </div>
        <Badge variant="outline" className="capitalize">
          {item.priority}
        </Badge>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{item.assignee_name}</p>
      <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
        <span>{item.committee_id.slice(0, 8)}…</span>
        <span>Due {item.due_date}</span>
        {item.status === 'overdue' ? (
          <span className="inline-flex items-center gap-1 text-destructive">
            <AlertTriangle className="h-3.5 w-3.5" />
            {overdueDays} day{overdueDays === 1 ? '' : 's'} overdue
          </span>
        ) : null}
      </div>
    </div>
  );
}
