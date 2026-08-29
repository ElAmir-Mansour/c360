'use client';

/**
 * Read-only swimlane lane band: a full-width background row with the lane title
 * pinned to the LEADING edge. For Diagram B role lanes the title IS the
 * localized role name (Department Manager / Executive Manager for the Group /
 * Legal Department Manager). The canvas renders inside a `dir="ltr"` wrapper, so
 * the leading side is chosen explicitly from `direction` rather than via CSS
 * logical properties.
 */

import { memo } from 'react';
import { type NodeProps } from '@xyflow/react';
import { cn } from '@/lib/utils';
import type { LaneFlowNode } from './build-flow';

function LaneNodeImpl({ data }: NodeProps<LaneFlowNode>) {
  const { title, direction, first, last } = data;
  const leadingRight = direction === 'rtl';

  return (
    <div
      className={cn(
        'h-full w-full border-border/70 bg-muted/20',
        'border',
        first ? 'rounded-t-2xl' : 'border-t-0',
        last && 'rounded-b-2xl',
      )}
    >
      <div
        className={cn(
          'absolute inset-y-0 flex w-[184px] flex-col justify-center gap-1 px-4',
          leadingRight
            ? 'end-0 border-s border-border/60 text-end'
            : 'start-0 border-e border-border/60 text-start',
        )}
        dir={direction}
      >
        <span className="text-xs font-semibold uppercase tracking-caps-xwide text-muted-foreground">
          {title}
        </span>
      </div>
    </div>
  );
}

export const LaneNode = memo(LaneNodeImpl);
