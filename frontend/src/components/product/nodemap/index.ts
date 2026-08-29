/**
 * ClarioDR node map — Phase-3 product components.
 * ===============================================
 * Composable, token-driven, bilingual-ready visualisation of the recovery
 * process graph, wired to the real DR data contract (topology nodes/edges +
 * bootgraph tiers). No full page assembly — these are the building blocks the
 * Phase-4 recovery-dashboard PROOF screen composes.
 */

export { NodeMap } from './node-map';
export type { NodeMapProps, NodeMapLabels } from './node-map';

export {
  layoutGraph,
  topoOrderNodes,
  computeNodeCriticalPath,
  topologyToGraph,
  bootPlanToGraph,
  edgePointsToPolyline,
  statusToTone,
} from './node-map-graph';
export type {
  NodeMapNode,
  NodeMapEdge,
  LaidOutNode,
  LaidOutEdge,
  NodeMapLayout,
  LayoutOptions,
} from './node-map-graph';
