/**
 * node-map-graph.ts — deterministic graph layout + critical-path math for the
 * ClarioDR NodeMap.
 * ============================================================================
 *
 * Builds a laid-out, directed graph from the REAL DR topology shapes
 * (`DRTopologyNode` / `DRTopologyEdge`, and `DRTopology.topo_order`) — and can
 * also lay out a bootgraph boot plan (tiers of `DRBootService`) or a
 * runbookstudio task DAG. Layout uses `dagre` (already a dependency) for a real
 * layered DAG layout; results are deterministic for a given input so the SVG and
 * its screen-reader text alternative agree exactly.
 *
 * The longest-dependency-chain ("critical path") over the graph is computed with
 * the SAME longest-path-in-a-DAG recurrence as the runbook engine, weighted by a
 * per-node cost (replication lag, boot timeout, or unit weight). Edges and nodes
 * on that chain are emphasised.
 *
 * Pure (no React, no DOM) so it is unit-tested with fixtures.
 */

import dagre from 'dagre';
import type {
  DRTopology,
  DRTopologyNode,
  DRTopologyEdge,
  DRBootService,
} from '@/types/clario-dr';

/** A generic graph node the layout engine + view consume. */
export interface NodeMapNode {
  id: string;
  /** Primary display label (site/service/task name). */
  label: string;
  /** Secondary line (role / kind / site). */
  sublabel?: string;
  /** Node category — drives the icon + accessible kind text. */
  kind: 'site' | 'service' | 'task';
  /** Health/status token used for the status pill (never colour-only). */
  status: string;
  /** Longest-path weight (seconds) — lag, boot timeout, or unit. */
  weight: number;
}

/** A generic directed edge (a dependency / replication link). */
export interface NodeMapEdge {
  id: string;
  from: string;
  to: string;
  /** Edge label (mode / priority). */
  label?: string;
  /** Edge health/status token. */
  status?: string;
}

/** A node with its computed layout box (centre x/y + size). */
export interface LaidOutNode extends NodeMapNode {
  x: number;
  y: number;
  width: number;
  height: number;
  /** 0-based dependency rank (layer) — every predecessor has a lower rank. */
  rank: number;
  onCriticalPath: boolean;
}

/** An edge with its routed poly-line points. */
export interface LaidOutEdge extends NodeMapEdge {
  points: Array<{ x: number; y: number }>;
  onCriticalPath: boolean;
}

export interface NodeMapLayout {
  nodes: LaidOutNode[];
  edges: LaidOutEdge[];
  /** Overall SVG canvas size. */
  width: number;
  height: number;
  /** Ordered node IDs on the longest dependency chain. */
  criticalPath: string[];
  /** Total weight (seconds) of the longest chain. */
  criticalPathWeight: number;
}

export interface LayoutOptions {
  /** Layout direction. 'LR' (left→right) by default; mirrored for RTL in view. */
  rankdir?: 'LR' | 'TB';
  nodeWidth?: number;
  nodeHeight?: number;
  nodesep?: number;
  ranksep?: number;
}

const DEFAULTS: Required<LayoutOptions> = {
  rankdir: 'LR',
  nodeWidth: 200,
  nodeHeight: 76,
  nodesep: 28,
  ranksep: 96,
};

/** Build the forward adjacency for a generic edge list. */
function adjacency(edges: NodeMapEdge[]): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    const list = adj.get(e.from) ?? [];
    list.push(e.to);
    adj.set(e.from, [...new Set(list)].sort());
  }
  return adj;
}

/**
 * Kahn topological order over the node set (deterministic, sorted ready queue).
 * Returns null on a cycle (defensive — DR topology is a replication DAG).
 */
export function topoOrderNodes(
  nodes: NodeMapNode[],
  edges: NodeMapEdge[],
): string[] | null {
  const present = new Set(nodes.map((n) => n.id));
  const adj = adjacency(edges);
  const indeg = new Map<string, number>();
  for (const n of nodes) indeg.set(n.id, 0);
  for (const e of edges) {
    if (present.has(e.from) && present.has(e.to)) {
      indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
    }
  }
  const ready = nodes
    .map((n) => n.id)
    .filter((id) => (indeg.get(id) ?? 0) === 0)
    .sort();
  const order: string[] = [];
  while (ready.length > 0) {
    ready.sort();
    const cur = ready.shift() as string;
    order.push(cur);
    for (const succ of adj.get(cur) ?? []) {
      indeg.set(succ, (indeg.get(succ) ?? 0) - 1);
      if ((indeg.get(succ) ?? 0) === 0) ready.push(succ);
    }
  }
  return order.length === nodes.length ? order : null;
}

/**
 * Longest weighted dependency chain through the graph (longest-path-in-a-DAG over
 * the topological order). Each node's earliest finish = its weight + the max
 * earliest finish of its predecessors; the chain is recovered by walking the
 * chosen predecessors back. Deterministic tie-break (sorted predecessors, then
 * lexically-first finishing node). Mirrors the runbook engine's CriticalPath.
 */
export function computeNodeCriticalPath(
  nodes: NodeMapNode[],
  edges: NodeMapEdge[],
): { path: string[]; weight: number; pathSet: Set<string> } {
  const order = topoOrderNodes(nodes, edges);
  if (!order) return { path: [], weight: 0, pathSet: new Set() };
  const weightOf = new Map(nodes.map((n) => [n.id, Math.max(0, n.weight)]));
  const preds = new Map<string, string[]>();
  for (const e of edges) {
    const list = preds.get(e.to) ?? [];
    list.push(e.from);
    preds.set(e.to, list);
  }
  const earliestFinish = new Map<string, number>();
  const best = new Map<string, string>();
  for (const id of order) {
    let start = 0;
    let chosen = '';
    // The binding predecessor is the one with the MAX earliest finish (ties
    // broken lexically by the sorted scan). It is recorded even when its finish
    // is 0, so the recovered chain connects through zero-weight roots (a DR
    // topology root site weighs 0). The earliest-start is the max finish.
    const p = [...(preds.get(id) ?? [])].sort();
    for (const pre of p) {
      const pf = earliestFinish.get(pre) ?? 0;
      if (chosen === '' || pf > start) {
        start = pf;
        chosen = pre;
      }
    }
    earliestFinish.set(id, start + (weightOf.get(id) ?? 0));
    if (chosen) best.set(id, chosen);
  }
  let total = 0;
  let finish = '';
  for (const id of [...order].sort()) {
    const ef = earliestFinish.get(id) ?? 0;
    if (ef > total) {
      total = ef;
      finish = id;
    }
  }
  const rev: string[] = [];
  for (let cur = finish; cur; cur = best.get(cur) ?? '') {
    rev.push(cur);
    if (!best.has(cur)) break;
  }
  const path = rev.reverse();
  return { path, weight: total, pathSet: new Set(path) };
}

/**
 * Lay out a generic node/edge graph with dagre and annotate the critical path.
 * Deterministic for a given input (dagre + a fixed config). The returned node
 * positions are CENTRE points (dagre convention); the view offsets by half size.
 */
export function layoutGraph(
  nodesInput: NodeMapNode[] | null | undefined,
  edgesInput: NodeMapEdge[] | null | undefined,
  options: LayoutOptions = {},
): NodeMapLayout {
  // Guard the entry point: callers may pass undefined/null (e.g. the NodeMap
  // view fed by an errored/empty query) — treat a missing list as empty rather
  // than iterating `undefined`.
  const nodes = nodesInput ?? [];
  const edges = edgesInput ?? [];
  const opts = { ...DEFAULTS, ...options };
  const { path, weight, pathSet } = computeNodeCriticalPath(nodes, edges);

  // Dependency rank (layer) from the topological order — predecessors below.
  const order = topoOrderNodes(nodes, edges);
  const rankOf = new Map<string, number>();
  if (order) {
    const preds = new Map<string, string[]>();
    for (const e of edges) {
      const list = preds.get(e.to) ?? [];
      list.push(e.from);
      preds.set(e.to, list);
    }
    for (const id of order) {
      const p = preds.get(id) ?? [];
      const r = p.length === 0 ? 0 : Math.max(...p.map((x) => (rankOf.get(x) ?? 0) + 1));
      rankOf.set(id, r);
    }
  } else {
    nodes.forEach((n, i) => rankOf.set(n.id, i));
  }

  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({
    rankdir: opts.rankdir,
    nodesep: opts.nodesep,
    ranksep: opts.ranksep,
    marginx: 16,
    marginy: 16,
  });
  g.setDefaultEdgeLabel(() => ({}));

  const present = new Set(nodes.map((n) => n.id));
  for (const n of nodes) {
    g.setNode(n.id, { width: opts.nodeWidth, height: opts.nodeHeight });
  }
  for (const e of edges) {
    if (present.has(e.from) && present.has(e.to)) {
      g.setEdge(e.from, e.to, {}, e.id);
    }
  }

  dagre.layout(g);

  const laidNodes: LaidOutNode[] = nodes.map((n) => {
    const pos = g.node(n.id) as { x: number; y: number } | undefined;
    return {
      ...n,
      x: pos?.x ?? 0,
      y: pos?.y ?? 0,
      width: opts.nodeWidth,
      height: opts.nodeHeight,
      rank: rankOf.get(n.id) ?? 0,
      onCriticalPath: pathSet.has(n.id),
    };
  });

  const laidEdges: LaidOutEdge[] = edges.map((e) => {
    let points: Array<{ x: number; y: number }> = [];
    if (present.has(e.from) && present.has(e.to)) {
      const ge = g.edge({ v: e.from, w: e.to, name: e.id }) as
        | { points: Array<{ x: number; y: number }> }
        | undefined;
      points = ge?.points ?? [];
    }
    if (points.length === 0) {
      const a = g.node(e.from) as { x: number; y: number } | undefined;
      const b = g.node(e.to) as { x: number; y: number } | undefined;
      if (a && b) points = [a, b];
    }
    return {
      ...e,
      points,
      onCriticalPath: pathSet.has(e.from) && pathSet.has(e.to),
    };
  });

  const graph = g.graph() as { width?: number; height?: number };
  return {
    nodes: laidNodes,
    edges: laidEdges,
    width: Math.max(opts.nodeWidth, Math.ceil(graph.width ?? 0)),
    height: Math.max(opts.nodeHeight, Math.ceil(graph.height ?? 0)),
    criticalPath: path,
    criticalPathWeight: weight,
  };
}

/**
 * Map a DR replication topology (sites + replication edges) to the generic graph.
 * Node weight is the replication lag on the heaviest INBOUND edge (so the chain
 * approximates worst-case recovery lag); a site with no inbound edge weighs 0.
 */
export function topologyToGraph(topology: DRTopology | null | undefined): {
  nodes: NodeMapNode[];
  edges: NodeMapEdge[];
} {
  // The backing topology endpoint can return a partial/empty payload (e.g. a
  // freshly-created group, or a 404 mapped to null) where `nodes`/`edges` are
  // missing. Default both to [] so the mapper never iterates `undefined` and
  // throws "x is not iterable" — the consumer then renders its empty state.
  const topoNodes = topology?.nodes ?? [];
  const topoEdges = topology?.edges ?? [];
  const inboundLag = new Map<string, number>();
  for (const e of topoEdges) {
    const lag = e.lag_seconds ?? 0;
    inboundLag.set(e.to_node_id, Math.max(inboundLag.get(e.to_node_id) ?? 0, lag));
  }
  const nodes: NodeMapNode[] = topoNodes.map((n: DRTopologyNode) => ({
    id: n.id,
    label: n.site_name,
    sublabel: n.role,
    kind: 'site',
    status: roleToStatus(n.role),
    weight: inboundLag.get(n.id) ?? 0,
  }));
  const edges: NodeMapEdge[] = topoEdges.map((e: DRTopologyEdge) => ({
    id: e.id,
    from: e.from_node_id,
    to: e.to_node_id,
    label: e.mode,
    status: e.health,
  }));
  return { nodes, edges };
}

/** A topology node's role mapped to a status token (primary/standby/recovery). */
function roleToStatus(role: string): string {
  const r = role.trim().toLowerCase();
  if (r === 'primary' || r === 'source') return 'primary';
  if (r === 'recovery' || r === 'target' || r === 'failover') return 'recovery';
  if (r === 'standby' || r === 'replica') return 'standby';
  return r || 'unknown';
}

/**
 * Map a bootgraph boot plan (tiers of services) to a graph: each service is a
 * node, and every service in tier N+1 depends on every service in tier N (the
 * bootgraph "next tier after this tier" contract). Node weight is the boot
 * timeout (seconds). Edge IDs are stable for deterministic layout.
 */
export function bootPlanToGraph(
  tiers: DRBootService[][] | null | undefined,
): {
  nodes: NodeMapNode[];
  edges: NodeMapEdge[];
} {
  const nodes: NodeMapNode[] = [];
  const edges: NodeMapEdge[] = [];
  let prev: string[] = [];
  (tiers ?? []).forEach((tier, tierIndex) => {
    const current: string[] = [];
    for (const svc of tier ?? []) {
      current.push(svc.id);
      nodes.push({
        id: svc.id,
        label: svc.name,
        sublabel: `${svc.kind} · tier ${tierIndex + 1}`,
        kind: 'service',
        status: 'pending',
        weight: Math.max(0, svc.boot_timeout_seconds ?? 0),
      });
      for (const p of prev) {
        edges.push({
          id: `${p}->${svc.id}`,
          from: p,
          to: svc.id,
          label: 'boot order',
        });
      }
    }
    prev = current;
  });
  return { nodes, edges };
}

/** Build an SVG poly-line `points` attribute from routed edge points. */
export function edgePointsToPolyline(
  points: Array<{ x: number; y: number }>,
): string {
  return points.map((p) => `${p.x},${p.y}`).join(' ');
}

/** Status token → status-chip tone (never colour-only; pairs with text). */
export function statusToTone(
  status: string,
): 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info' {
  const s = status.trim().toLowerCase();
  switch (s) {
    case 'primary':
    case 'source':
    case 'healthy':
    case 'streaming':
    case 'complete':
    case 'completed':
      return 'success';
    case 'recovery':
    case 'target':
    case 'failover':
      return 'info';
    case 'standby':
    case 'replica':
    case 'pending':
    case 'paused':
      return 'neutral';
    case 'warning':
    case 'watch':
    case 'degraded':
    case 'seeding':
      return 'warning';
    case 'critical':
    case 'error':
    case 'failed':
      return 'danger';
    default:
      return 'neutral';
  }
}
