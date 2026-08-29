'use client';

/**
 * Read-only swimlane stage box. Reuses the lifecycle stepper's exact visual
 * language: done = primary fill + check, current = primary tint + pulsing ring,
 * future = hollow border, offpath = dashed muted. Two non-interactive handles
 * (source/target) are rendered so xyflow can route the connector arrows; they
 * are visually hidden and never connectable.
 */

import { memo } from 'react';
import { Handle, type NodeProps } from '@xyflow/react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { stageHandlePositions, type StageFlowNode } from './build-flow';

const HIDDEN_HANDLE: React.CSSProperties = {
  opacity: 0,
  width: 1,
  height: 1,
  minWidth: 1,
  minHeight: 1,
  border: 'none',
  background: 'transparent',
  pointerEvents: 'none',
};

function StageNodeImpl({ data }: NodeProps<StageFlowNode>) {
  const { label, state, direction } = data;
  const handles = stageHandlePositions(direction);
  const isDone = state === 'done';
  const isCurrent = state === 'current';
  const isOffpath = state === 'offpath';

  return (
    <div
      className={cn(
        'flex h-full w-full items-center gap-2 rounded-xl border px-3 py-2 text-start shadow-sm transition-colors',
        isDone && 'border-primary/70 bg-primary/10 text-foreground',
        isCurrent &&
          'border-primary bg-primary/15 text-foreground ring-2 ring-primary/30 motion-safe:animate-pulse',
        !isDone && !isCurrent && !isOffpath && 'border-border bg-card text-muted-foreground',
        isOffpath && 'border-dashed border-border/70 bg-muted/40 text-muted-foreground',
      )}
      dir={direction}
      aria-current={isCurrent ? 'step' : undefined}
    >
      <span
        className={cn(
          'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border',
          isDone
            ? 'border-primary bg-primary text-primary-foreground'
            : isCurrent
              ? 'border-primary bg-primary/20 text-primary'
              : isOffpath
                ? 'border-dashed border-border bg-muted'
                : 'border-border bg-background',
        )}
        aria-hidden
      >
        {isDone ? (
          <Check className="h-3.5 w-3.5" aria-hidden />
        ) : isCurrent ? (
          <span className="h-2 w-2 rounded-full bg-primary" aria-hidden />
        ) : null}
      </span>
      <span
        className={cn(
          'min-w-0 flex-1 truncate text-caption leading-tight',
          isCurrent ? 'font-semibold text-foreground' : isDone ? 'text-foreground/80' : undefined,
        )}
        title={label}
      >
        {label}
      </span>

      <Handle
        type="target"
        id="t"
        position={handles.target}
        isConnectable={false}
        style={HIDDEN_HANDLE}
      />
      <Handle
        type="source"
        id="s"
        position={handles.source}
        isConnectable={false}
        style={HIDDEN_HANDLE}
      />
    </div>
  );
}

export const StageNode = memo(StageNodeImpl);
