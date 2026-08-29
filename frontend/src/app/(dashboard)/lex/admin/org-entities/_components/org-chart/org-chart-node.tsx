'use client';

import { useDraggable, useDroppable } from '@dnd-kit/core';
import { ChevronDown, ChevronRight, GripVertical, ShieldAlert, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { resolveLocalized } from '@/lib/i18n/localized';
import type { AppLocale } from '@/lib/i18n';
import { NODE_HEIGHT, NODE_WIDTH, type PositionedNode } from '../../_lib/org-chart-layout';
import type { OrgChartLabels } from '../../_lib/org-chart-i18n';

interface OrgChartNodeProps {
  node: PositionedNode;
  t: OrgChartLabels;
  locale: AppLocale;
  canWrite: boolean;
  /** Highlighted by an active search match (centered + ring). */
  highlighted: boolean;
  /** True while ANY node is being dragged (dims non-droppable targets). */
  dragActive: boolean;
  /** True when this node is a forbidden drop target for the current drag. */
  dropForbidden: boolean;
  onToggle: (id: string) => void;
  onOpen: (id: string) => void;
}

/**
 * A single org-chart card. Positioned absolutely by the canvas; this component
 * owns only its own visuals + drag/drop wiring. Rendered inside an SVG
 * <foreignObject> so the HTML/Tailwind card serialises into PNG/SVG exports.
 */
export function OrgChartNode({
  node,
  t,
  locale,
  canWrite,
  highlighted,
  dragActive,
  dropForbidden,
  onToggle,
  onOpen,
}: OrgChartNodeProps) {
  const entity = node.entity;
  const id = node.id;

  // dnd-kit hooks must be called unconditionally; disable when not writable.
  const draggable = useDraggable({ id, disabled: !canWrite });
  const droppable = useDroppable({ id, disabled: !canWrite });

  if (!entity) return null;

  const name = resolveLocalized(entity.name, locale) || entity.code;
  const coverage = node.coverage;
  const isDropTarget = droppable.isOver && canWrite && !dropForbidden;
  const isBeingDragged = draggable.isDragging;

  return (
    <div
      ref={(el) => {
        draggable.setNodeRef(el);
        droppable.setNodeRef(el);
      }}
      style={{ width: NODE_WIDTH, height: NODE_HEIGHT }}
      className={cn(
        'group relative flex flex-col justify-between rounded-xl border bg-card p-3 text-start shadow-sm transition',
        'hover:border-primary/30 hover:shadow-md',
        highlighted && 'border-primary ring-2 ring-primary/40',
        isDropTarget && 'border-success-500 ring-2 ring-success-300',
        dragActive && dropForbidden && 'opacity-40',
        isBeingDragged && 'opacity-50',
        !entity.active && 'border-dashed bg-muted/40',
      )}
    >
      {/* Header: drag handle + code + active dot */}
      <div className="flex items-start gap-1.5">
        {canWrite ? (
          <button
            type="button"
            aria-label={t.node.dragHint}
            title={t.node.dragHint}
            className="mt-0.5 cursor-grab touch-none text-muted-foreground/60 hover:text-muted-foreground active:cursor-grabbing"
            {...draggable.listeners}
            {...draggable.attributes}
          >
            <GripVertical className="h-3.5 w-3.5" aria-hidden />
          </button>
        ) : null}

        <button
          type="button"
          onClick={() => onOpen(id)}
          className="min-w-0 flex-1 text-start"
          title={t.node.open}
        >
          <span className="block truncate font-mono text-caption text-muted-foreground">
            {entity.code}
          </span>
          <span className="block truncate text-sm font-semibold leading-tight" dir="auto">
            {name}
          </span>
        </button>

        <span
          className={cn(
            'mt-1 h-2 w-2 shrink-0 rounded-full',
            entity.active ? 'bg-success-500' : 'bg-muted-foreground/40',
          )}
          title={entity.active ? t.node.active : t.node.inactive}
          aria-label={entity.active ? t.node.active : t.node.inactive}
        />
      </div>

      {/* Footer: type badge + escalation chip */}
      <div className="flex items-center justify-between gap-1.5">
        <Badge variant="secondary" className="px-1.5 py-0 text-caption">
          {t.entityTypes[entity.entity_type] ?? entity.entity_type}
        </Badge>

        {coverage ? (
          coverage.ready ? (
            <span
              className="inline-flex items-center gap-1 rounded-full border border-success-300 bg-success-50 px-1.5 py-0.5 text-caption font-medium text-success-700"
              title={t.node.escalationReady}
            >
              <ShieldCheck className="h-3 w-3" aria-hidden />
              {t.node.escalationReady}
            </span>
          ) : (
            <span
              className="inline-flex items-center gap-1 rounded-full border border-warning-300 bg-warning-50 px-1.5 py-0.5 text-caption font-medium text-warning-700"
              title={coverage.missing
                .map((r) => t.escalationRoles[r])
                .join(' · ')}
            >
              <ShieldAlert className="h-3 w-3" aria-hidden />
              {t.node.escalationMissing(coverage.missing.length)}
            </span>
          )
        ) : null}
      </div>

      {/* Collapse / expand toggle (bottom-center, anchored to card edge) */}
      {node.totalChildren > 0 ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggle(id);
          }}
          aria-label={node.collapsed ? t.node.expand : t.node.collapse}
          title={
            node.collapsed
              ? `${t.node.expand} · ${t.node.childrenCount(node.totalChildren)}`
              : t.node.collapse
          }
          className={cn(
            'absolute -bottom-3 left-1/2 z-10 inline-flex h-6 -translate-x-1/2 items-center gap-0.5 rounded-full border bg-card px-1.5 text-caption font-medium shadow-sm transition',
            node.collapsed
              ? 'border-primary/40 text-primary hover:bg-primary/5'
              : 'border-border/70 text-muted-foreground hover:bg-accent/60',
          )}
        >
          {node.collapsed ? (
            <ChevronRight className="h-3 w-3" aria-hidden />
          ) : (
            <ChevronDown className="h-3 w-3" aria-hidden />
          )}
          {node.collapsed ? node.totalChildren : null}
        </button>
      ) : null}
    </div>
  );
}
