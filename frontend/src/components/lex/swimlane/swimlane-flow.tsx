'use client';

/**
 * Read-only xyflow renderer for a PRD swimlane. All interaction is OFF (no
 * dragging, connecting, selecting, scroll-zoom); the canvas simply fits the
 * static diagram to view. xyflow's coordinate space is LTR-only, so the canvas
 * is wrapped in `dir="ltr"` while node label text carries the locale direction
 * (handled in the node components) — `build-flow` reflects the x coordinates so
 * an Arabic reader still sees the flow run leading-to-trailing.
 */

import { useMemo } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { LaneNode } from './lane-node';
import { StageNode } from './stage-node';
import { buildFlow } from './build-flow';
import type { SwimlaneModel, ActiveProjection } from './diagram-models';
import { useSwimlaneLabels } from './use-swimlane-labels';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';

const NODE_TYPES: NodeTypes = { lane: LaneNode, stage: StageNode };

interface SwimlaneFlowProps {
  model: SwimlaneModel;
  active: ActiveProjection;
}

export function SwimlaneFlow({ model, active }: SwimlaneFlowProps) {
  const labels = useSwimlaneLabels();
  const { direction } = useLocaleOrDefault();

  const { nodes, edges, height } = useMemo(
    () => buildFlow(model, active, labels, direction),
    [model, active, labels, direction],
  );

  // Fixed height from the lane count keeps the canvas from collapsing while the
  // width is fitView-scaled to the container.
  const canvasHeight = height + 48;

  return (
    <div
      dir="ltr"
      className="w-full overflow-hidden rounded-2xl border bg-card/40"
      style={{ height: canvasHeight }}
      role="img"
      aria-label={labels.ariaDiagram}
    >
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          fitView
          fitViewOptions={{ padding: 0.12 }}
          minZoom={0.2}
          maxZoom={1.5}
          nodesDraggable={false}
          nodesConnectable={false}
          nodesFocusable={false}
          edgesFocusable={false}
          elementsSelectable={false}
          panOnDrag
          panOnScroll={false}
          zoomOnScroll={false}
          zoomOnPinch={false}
          zoomOnDoubleClick={false}
          preventScrolling={false}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} className="opacity-40" />
          <Controls showInteractive={false} position="bottom-right" />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}
