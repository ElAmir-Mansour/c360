'use client';

import { useMemo } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  type Edge,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import type {
  MigrateDependencyGraph,
  MigrateDepEdgeType,
  MigrateDepGraphNode,
} from '@/types/migrate';
import { useMigrateLabels } from '../_lib/migrate-i18n';

// statusTone maps a live entity status to the colour the node is filled/bordered
// with, so the graph reads as a status heat-map (the primary encoding the audit
// asked for). It covers the workload, move-group and wave lifecycle vocabularies
// plus the DR site roles overlaid from the topology bridge; unknown values fall
// back to a neutral slate rather than mis-colouring.
function statusTone(status: string): { border: string; fill: string } {
  switch (status) {
    // Completed / live / healthy terminal states.
    case 'live':
    case 'validated':
    case 'completed':
    case 'approved':
    case 'healthy':
      return { border: 'hsl(var(--status-success))', fill: 'hsl(var(--status-success) / 0.14)' };
    // In-flight / active states.
    case 'in_migration':
    case 'in_progress':
    case 'cutover':
      return { border: 'hsl(var(--status-info))', fill: 'hsl(var(--status-info) / 0.14)' };
    // Pending / planned / not-yet-started states.
    case 'discovered':
    case 'assessed':
    case 'planned':
    case 'ready':
    case 'draft':
    case 'approval_pending':
      return { border: 'hsl(var(--status-warning))', fill: 'hsl(var(--status-warning) / 0.12)' };
    // Failure / rollback / degraded states.
    case 'rolled_back':
    case 'rejected':
    case 'completeness_issue':
    case 'paused':
    case 'degraded':
    case 'failed':
      return { border: 'hsl(var(--status-error))', fill: 'hsl(var(--status-error) / 0.12)' };
    // DR site roles (source/relay/target) overlaid from the topology bridge —
    // distinguished by the DR-site type stripe + role label.
    case 'source':
    case 'relay':
    case 'target':
      return { border: 'hsl(var(--chart-4))', fill: 'hsl(var(--chart-4) / 0.12)' };
    case 'decommissioned':
      return { border: 'hsl(var(--muted-foreground))', fill: 'hsl(var(--muted-foreground) / 0.14)' };
    default:
      return { border: 'hsl(var(--muted-foreground) / 0.55)', fill: 'hsl(var(--muted-foreground) / 0.10)' };
  }
}

// typeAccent is the small left border-stripe colour that keeps the three node
// kinds (move group / workload / DR site) distinguishable even though the fill is
// now driven by status.
function typeAccent(type: MigrateDepGraphNode['type']): string {
  switch (type) {
    case 'move_group':
      return 'hsl(var(--status-success))';
    case 'dr_site':
      return 'hsl(var(--chart-4))';
    case 'workload':
    default:
      return 'hsl(var(--status-info))';
  }
}

// nodeStyle fills/borders a node by its live STATUS (the primary encoding) while a
// thicker left stripe keeps its TYPE readable.
function nodeStyle(node: MigrateDepGraphNode): React.CSSProperties {
  const tone = statusTone(node.status);
  return {
    padding: '8px 12px',
    borderRadius: 10,
    border: `1px solid ${tone.border}`,
    borderLeft: `5px solid ${typeAccent(node.type)}`,
    background: tone.fill,
    fontSize: 12,
    lineHeight: 1.3,
    minWidth: 150,
    textAlign: 'center',
    boxShadow: 'var(--ds-elevation-1)',
  };
}

// edgeStyle maps an edge type to a stroke colour + dash so the four edge kinds
// (contains, dependency, sequence, replication) are distinguishable.
function edgeStyle(type: MigrateDepEdgeType): { stroke: string; dash?: string; animated: boolean } {
  switch (type) {
    case 'dependency':
      return { stroke: 'hsl(var(--status-error))', animated: false };
    case 'sequence':
      return { stroke: 'hsl(var(--status-warning))', dash: '6 4', animated: false };
    case 'replication':
      return { stroke: 'hsl(var(--chart-4))', dash: '2 3', animated: true };
    case 'contains':
    default:
      return { stroke: 'hsl(var(--muted-foreground) / 0.6)', animated: false };
  }
}

// layoutColumns assigns each node an X column from the topo order and stacks nodes
// that share a column vertically. The topo order is the real dependency ordering
// the backend computed by reusing the DR topology engine, so the left-to-right
// placement reflects true execution order without a client-side layout engine.
function buildFlow(graph: MigrateDependencyGraph): { nodes: Node[]; edges: Edge[] } {
  const orderIndex = new Map<string, number>();
  graph.topo_order.forEach((id, i) => orderIndex.set(id, i));

  // Column = rank in a simple longest-path layering derived from the topo order:
  // a node's column is 1 + max(column of its incoming-native-edge sources). We
  // approximate with the topo position bucketed so independent nodes can share a
  // column, then place same-column nodes in separate rows.
  const incoming = new Map<string, string[]>();
  for (const e of graph.edges) {
    if (e.type === 'replication') continue; // overlay edges do not drive layout
    const list = incoming.get(e.target) ?? [];
    list.push(e.source);
    incoming.set(e.target, list);
  }
  const column = new Map<string, number>();
  const columnOf = (id: string): number => {
    if (column.has(id)) return column.get(id)!;
    const preds = incoming.get(id) ?? [];
    let col = 0;
    for (const p of preds) {
      col = Math.max(col, columnOf(p) + 1);
    }
    column.set(id, col);
    return col;
  };
  // Resolve columns in topo order so predecessors are settled first.
  const ordered = [...graph.nodes].sort(
    (a, b) => (orderIndex.get(a.id) ?? 0) - (orderIndex.get(b.id) ?? 0),
  );
  for (const n of ordered) columnOf(n.id);

  const rowByColumn = new Map<number, number>();
  const nodes: Node[] = ordered.map((n) => {
    const col = column.get(n.id) ?? 0;
    const row = rowByColumn.get(col) ?? 0;
    rowByColumn.set(col, row + 1);
    const durationSuffix =
      n.type === 'workload' && n.duration_seconds
        ? `\n${Math.round(n.duration_seconds / 3600)}h`
        : '';
    return {
      id: n.id,
      position: { x: col * 240, y: row * 96 },
      data: { label: `${n.label}\n${n.status}${durationSuffix}` },
      style: { ...nodeStyle(n), whiteSpace: 'pre-line' },
      draggable: true,
    };
  });

  const edges: Edge[] = graph.edges.map((e) => {
    const style = edgeStyle(e.type);
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      label: e.label,
      animated: style.animated,
      style: { stroke: style.stroke, strokeDasharray: style.dash },
      markerEnd: { type: MarkerType.ArrowClosed, color: style.stroke },
    };
  });

  return { nodes, edges };
}

// MigrateDependencyGraphView renders the wave's move-group / workload dependency
// graph (with any DR replication overlay) as an interactive react-flow diagram.
export function MigrateDependencyGraphView({ graph }: { graph: MigrateDependencyGraph }) {
  const labels = useMigrateLabels();
  const { nodes, edges } = useMemo(() => buildFlow(graph), [graph]);

  if (nodes.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {labels.graph.empty}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {graph.has_cycle ? (
        <p className="rounded-md border border-amber-400 bg-amber-50 px-3 py-2 text-xs text-warning-700">
          {labels.graph.cycleWarning}
        </p>
      ) : null}
      <div className="h-[420px] w-full rounded-lg border bg-card">
        <ReactFlowProvider>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            fitView
            proOptions={{ hideAttribution: true }}
            nodesConnectable={false}
            nodesDraggable
            elementsSelectable
          >
            <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
            <Controls showInteractive={false} />
          </ReactFlow>
        </ReactFlowProvider>
      </div>
      <div className="flex flex-col gap-2 text-overline text-muted-foreground">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-medium text-foreground">{labels.graph.typeLegend}</span>
          <LegendSwatch color="hsl(var(--status-info))" label={labels.graph.workload} stripe />
          <LegendSwatch color="hsl(var(--status-success))" label={labels.graph.moveGroup} stripe />
          <LegendSwatch color="hsl(var(--chart-4))" label={labels.graph.drSite} stripe />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-medium text-foreground">{labels.graph.statusLegend}</span>
          <LegendSwatch color="hsl(var(--status-success))" label={labels.graph.completeLive} />
          <LegendSwatch color="hsl(var(--status-info))" label={labels.graph.inProgress} />
          <LegendSwatch color="hsl(var(--status-warning))" label={labels.graph.plannedPending} />
          <LegendSwatch color="hsl(var(--status-error))" label={labels.graph.failedRolledBack} />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-medium text-foreground">{labels.graph.edgesLegend}</span>
          <LegendSwatch color="hsl(var(--status-error))" label={labels.graph.dependency} line />
          <LegendSwatch color="hsl(var(--status-warning))" label={labels.graph.sequence} line dashed />
          <LegendSwatch color="hsl(var(--muted-foreground) / 0.6)" label={labels.graph.contains} line />
          <LegendSwatch color="hsl(var(--chart-4))" label={labels.graph.replication} line dashed />
        </div>
      </div>
    </div>
  );
}

function LegendSwatch({
  color,
  label,
  line,
  dashed,
  stripe,
}: {
  color: string;
  label: string;
  line?: boolean;
  dashed?: boolean;
  stripe?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {line ? (
        <span
          className="inline-block h-0 w-4 border-t-2"
          style={{ borderColor: color, borderStyle: dashed ? 'dashed' : 'solid' }}
        />
      ) : stripe ? (
        <span
          className="inline-block h-3 w-3 rounded-sm border border-border bg-muted"
          style={{ borderLeft: `4px solid ${color}` }}
        />
      ) : (
        <span className="inline-block h-3 w-3 rounded" style={{ background: color, opacity: 0.35, border: `1px solid ${color}` }} />
      )}
      {label}
    </span>
  );
}
