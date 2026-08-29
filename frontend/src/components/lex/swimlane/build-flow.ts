/**
 * Flow-build layer: project a {@link SwimlaneModel} + its live
 * {@link ActiveProjection} into read-only xyflow `nodes` / `edges`.
 *
 * Geometry is fixed (constants below), so nothing is measured at runtime. One
 * background `lane` node is emitted per lane (full content width, header pinned
 * to the leading edge), one `stage` node per stage on a lane-row × column grid,
 * and one xyflow edge per model edge with an arrow marker; traversed edges (both
 * endpoints reached) are styled with the primary colour.
 *
 * RTL: xyflow's coordinate space is LTR-only, so the canvas is rendered inside a
 * `dir="ltr"` wrapper (see `swimlane-flow.tsx`). To keep the flow reading
 * leading-to-trailing for Arabic we REFLECT every node's x about the content
 * width when `direction === 'rtl'` and flip the stage handle sides, while the
 * label text itself carries `dir={direction}` so Arabic renders correctly.
 */

import { MarkerType, Position, type Node, type Edge } from '@xyflow/react';
import type { SwimlaneModel, ActiveProjection, StageState } from './diagram-models';
import type { SwimlaneLabels } from './swimlane-labels';

/* Fixed geometry (px). */
const LANE_H = 128;
const STAGE_W = 154;
const STAGE_H = 68;
const COL_GAP = 48;
const COL_STEP = STAGE_W + COL_GAP;
const HEADER_W = 184; // leading header strip inside each lane
const PAD = 28; // trailing padding after the last column
const STAGE_Y_OFFSET = (LANE_H - STAGE_H) / 2;

export type LaneNodeData = {
  title: string;
  role?: string;
  direction: 'ltr' | 'rtl';
  /** True for the first lane (used only for subtle top-rounded styling). */
  first: boolean;
  last: boolean;
  [key: string]: unknown;
};

export type StageNodeData = {
  label: string;
  state: StageState;
  direction: 'ltr' | 'rtl';
  [key: string]: unknown;
};

export type LaneFlowNode = Node<LaneNodeData, 'lane'>;
export type StageFlowNode = Node<StageNodeData, 'stage'>;
export type SwimlaneFlowNode = LaneFlowNode | StageFlowNode;

export interface BuiltFlow {
  nodes: SwimlaneFlowNode[];
  edges: Edge[];
  /** Total canvas content width — handy for sizing/fitView bounds. */
  width: number;
  height: number;
}

/** True once a stage has been reached (done or current). */
function reached(state: StageState | undefined): boolean {
  return state === 'done' || state === 'current';
}

export function buildFlow(
  model: SwimlaneModel,
  active: ActiveProjection,
  labels: SwimlaneLabels,
  direction: 'ltr' | 'rtl',
): BuiltFlow {
  const rtl = direction === 'rtl';

  // Column index per stage = its position along the happy path (model.stages is
  // authored in happy-path order for both diagrams).
  const columnOf = new Map<string, number>();
  model.stages.forEach((stage, i) => columnOf.set(stage.id, i));
  const numCols = model.stages.length;

  const laneIndexOf = new Map<string, number>();
  model.lanes.forEach((lane, i) => laneIndexOf.set(lane.id, i));

  const contentWidth = HEADER_W + numCols * COL_STEP + PAD;
  const contentHeight = model.lanes.length * LANE_H;

  // Reflect an LTR x into RTL space (about the content width) for a node of the
  // given width; identity in LTR.
  const reflectX = (x: number, w: number): number => (rtl ? contentWidth - x - w : x);

  const nodes: SwimlaneFlowNode[] = [];

  // --- Lane background nodes ---
  model.lanes.forEach((lane, i) => {
    const laneNode: LaneFlowNode = {
      id: `lane-${lane.id}`,
      type: 'lane',
      position: { x: reflectX(0, contentWidth), y: i * LANE_H },
      data: {
        title: labels.lanes[lane.labelKey],
        role: lane.roleKey,
        direction,
        first: i === 0,
        last: i === model.lanes.length - 1,
      },
      draggable: false,
      selectable: false,
      connectable: false,
      focusable: false,
      zIndex: 0,
      style: { width: contentWidth, height: LANE_H },
    };
    nodes.push(laneNode);
  });

  // --- Stage nodes ---
  for (const stage of model.stages) {
    const col = columnOf.get(stage.id) ?? 0;
    const laneIndex = laneIndexOf.get(stage.laneId) ?? 0;
    const xLtr = HEADER_W + col * COL_STEP;
    const stageNode: StageFlowNode = {
      id: stage.id,
      type: 'stage',
      position: {
        x: reflectX(xLtr, STAGE_W),
        y: laneIndex * LANE_H + STAGE_Y_OFFSET,
      },
      data: {
        label: labels.stages[stage.labelKey],
        state: active.stageStates.get(stage.id) ?? 'future',
        direction,
      },
      draggable: false,
      selectable: false,
      connectable: false,
      focusable: false,
      zIndex: 1,
      width: STAGE_W,
      height: STAGE_H,
    };
    nodes.push(stageNode);
  }

  // --- Edges ---
  const edges: Edge[] = model.edges.map((edge) => {
    const fromState = active.stageStates.get(edge.from);
    const toState = active.stageStates.get(edge.to);
    const traversed = reached(fromState) && reached(toState);
    const stroke = traversed ? 'hsl(var(--primary))' : 'hsl(var(--border))';
    return {
      id: `e-${edge.from}-${edge.to}`,
      source: edge.from,
      target: edge.to,
      sourceHandle: 's',
      targetHandle: 't',
      type: 'smoothstep',
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 16,
        height: 16,
        color: stroke,
      },
      style: {
        stroke,
        strokeWidth: traversed ? 2 : 1.5,
        opacity: traversed ? 1 : 0.7,
      },
      selectable: false,
      focusable: false,
    };
  });

  return { nodes, edges, width: contentWidth, height: contentHeight };
}

/** Handle-side positions for a stage, per reading direction. Exposed so the
 * StageNode renders its (non-interactive) handles on the correct edges. */
export function stageHandlePositions(direction: 'ltr' | 'rtl'): {
  source: Position;
  target: Position;
} {
  return direction === 'rtl'
    ? { source: Position.Left, target: Position.Right }
    : { source: Position.Right, target: Position.Left };
}
