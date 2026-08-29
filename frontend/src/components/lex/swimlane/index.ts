/**
 * Read-only PRD swimlane visualization (Al Othaim Diagram A / Diagram B).
 * Public surface consumed by the Legal Service Desk request-detail flow tab.
 */

export {
  DIAGRAM_A,
  DIAGRAM_B,
  DIAGRAM_B_REQUEST_TYPE,
  LITIGATION_ROLE_ORDER,
  selectDiagram,
  resolveActiveStage,
  statusToHappyIndex,
  type SwimlaneModel,
  type SwimlaneLane,
  type SwimlaneStage,
  type SwimlaneEdge,
  type StageState,
  type ActiveProjection,
  type LaneLabelKey,
  type StageLabelKey,
} from './diagram-models';
export { buildFlow, stageHandlePositions } from './build-flow';
export type {
  BuiltFlow,
  LaneNodeData,
  StageNodeData,
  LaneFlowNode,
  StageFlowNode,
  SwimlaneFlowNode,
} from './build-flow';
export { SwimlaneFlow } from './swimlane-flow';
export { SwimlaneLegend } from './swimlane-legend';
export { swimlaneLabels, type SwimlaneLabels } from './swimlane-labels';
export { useSwimlaneLabels } from './use-swimlane-labels';
