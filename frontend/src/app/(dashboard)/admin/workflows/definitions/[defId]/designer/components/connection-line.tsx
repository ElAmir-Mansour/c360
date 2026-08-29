'use client';

import React from 'react';
import type { WorkflowStep, WorkflowTransition } from '@/types/models';

const NODE_WIDTH = 200;
const NODE_HEIGHT = 80;
const PORT_OFFSET = 8;

const CONNECTION_COLORS: { label_bg_stroke: string } = {
  label_bg_stroke: 'hsl(var(--ds-border-default))',
};

interface ConnectionLineProps {
  fromStep: WorkflowStep;
  toStep: WorkflowStep;
  transition: WorkflowTransition;
  selected: boolean;
  onSelect: (transitionId: string) => void;
}

export const ConnectionLine = React.memo(function ConnectionLine({
  fromStep,
  toStep,
  transition,
  selected,
  onSelect,
}: ConnectionLineProps) {
  const x1 = fromStep.position.x + NODE_WIDTH / 2;
  const y1 = fromStep.position.y + NODE_HEIGHT + PORT_OFFSET;
  const x2 = toStep.position.x + NODE_WIDTH / 2;
  const y2 = toStep.position.y - PORT_OFFSET;

  const midY = (y1 + y2) / 2;
  const path = `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;

  const labelX = (x1 + x2) / 2;
  const labelY = midY;

  return (
    <g>
      {/* Invisible wide path for easier clicking */}
      <path
        d={path}
        fill="none"
        stroke="transparent"
        strokeWidth={12}
        className="cursor-pointer"
        onClick={(e) => {
          e.stopPropagation();
          onSelect(transition.id);
        }}
      />
      <path
        d={path}
        fill="none"
        stroke={selected ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground) / 0.55)'}
        strokeWidth={selected ? 2.5 : 1.5}
        strokeDasharray={selected ? 'none' : 'none'}
        markerEnd="url(#arrowhead)"
        className="pointer-events-none"
      />
      {transition.label && (
        <g>
          <rect
            x={labelX - transition.label.length * 3.5 - 4}
            y={labelY - 8}
            width={transition.label.length * 7 + 8}
            height={16}
            rx={4}
            fill="hsl(var(--card))"
            stroke={CONNECTION_COLORS.label_bg_stroke}
            strokeWidth={1}
          />
          <text
            x={labelX}
            y={labelY + 3}
            textAnchor="middle"
            className="text-[10px] fill-muted-foreground select-none pointer-events-none"
          >
            {transition.label}
          </text>
        </g>
      )}
    </g>
  );
});

interface TempConnectionLineProps {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
}

export function TempConnectionLine({ fromX, fromY, toX, toY }: TempConnectionLineProps) {
  const midY = (fromY + toY) / 2;
  const path = `M ${fromX} ${fromY} C ${fromX} ${midY}, ${toX} ${midY}, ${toX} ${toY}`;
  return (
    <path
      d={path}
      fill="none"
      stroke="hsl(var(--primary))"
      strokeWidth={2}
      strokeDasharray="6 3"
      className="pointer-events-none"
    />
  );
}
