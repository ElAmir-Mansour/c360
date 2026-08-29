'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import dagre from 'dagre';
import {
  type ImpactAnalysis,
  type LineageEdge as LineageEdgeType,
  type LineageGraph,
  type LineageNode as LineageNodeType,
} from '@/lib/data-suite';
import { LineageEdge } from '@/app/(dashboard)/data/lineage/_components/lineage-edge';
import { LineageNode, LINEAGE_NODE_HEIGHT, LINEAGE_NODE_WIDTH } from '@/app/(dashboard)/data/lineage/_components/lineage-node';

interface LineageDagProps {
  graph: LineageGraph;
  direction: 'LR' | 'TB';
  selectedNodeId: string | null;
  search: string;
  impact: ImpactAnalysis | null;
  onSelectNode: (node: LineageNodeType) => void;
  onReady?: (api: LineageDagApi) => void;
  onLayoutChange?: (layout: LineageLayoutSnapshot) => void;
  onViewportChange?: (viewport: LineageViewportState) => void;
}

// Categorical node palette — routed through the shared chart/status design
// tokens (globals.css --chart-* / --muted-foreground) so it re-themes in dark
// mode and stays coherent with the deck palette (teal-led). Each type keeps a
// maximally-separated hue.
const NODE_COLORS: Record<string, string> = {
  data_source: 'hsl(var(--chart-1))', // brand teal
  pipeline: 'hsl(var(--chart-3))', // amber
  data_model: 'hsl(var(--chart-2))', // leaf green
  quality_rule: 'hsl(var(--chart-6))', // magenta
  suite_consumer: 'hsl(var(--chart-4))', // violet
  report: 'hsl(var(--muted-foreground))', // neutral
};

interface PositionedNode extends LineageNodeType {
  position: { x: number; y: number; width: number; height: number };
}

interface PositionedEdge extends LineageEdgeType {
  points: Array<{ x: number; y: number }>;
}

export interface LineageLayoutSnapshot {
  nodes: PositionedNode[];
  edges: PositionedEdge[];
  width: number;
  height: number;
}

export interface LineageViewportState {
  x: number;
  y: number;
  k: number;
  viewportWidth: number;
  viewportHeight: number;
}

export interface LineageDagApi {
  fitToScreen: () => void;
  reset: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  fullscreen: () => void;
  centerOn: (x: number, y: number) => void;
}

export function LineageDag({
  graph,
  direction,
  selectedNodeId,
  search,
  impact,
  onSelectNode,
  onReady,
  onLayoutChange,
  onViewportChange,
}: LineageDagProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const viewportRef = useRef<SVGGElement | null>(null);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const [containerSize, setContainerSize] = useState({ width: 960, height: 720 });
  const layout = useMemo(() => {
    const g = new dagre.graphlib.Graph({ directed: true });
    g.setGraph({
      rankdir: direction,
      ranksep: 120,
      nodesep: 60,
      marginx: 40,
      marginy: 40,
    });
    g.setDefaultEdgeLabel(() => ({}));

    graph.nodes.forEach((node) => {
      g.setNode(node.id, {
        width: LINEAGE_NODE_WIDTH,
        height: LINEAGE_NODE_HEIGHT,
      });
    });
    graph.edges.forEach((edge) => {
      g.setEdge(edge.source, edge.target, {});
    });
    dagre.layout(g);

    const nodes = graph.nodes.map((node) => ({
      ...node,
      position: g.node(node.id) as { x: number; y: number; width: number; height: number },
    }));
    const edges = graph.edges.map((edge) => ({
      ...edge,
      points: (g.edge(edge.source, edge.target)?.points ?? []) as Array<{ x: number; y: number }>,
    }));

    const width = Math.max(...nodes.map((node) => node.position.x + LINEAGE_NODE_WIDTH / 2), 800) + 80;
    const height = Math.max(...nodes.map((node) => node.position.y + LINEAGE_NODE_HEIGHT / 2), 600) + 80;

    return { nodes, edges, width, height };
  }, [direction, graph.edges, graph.nodes]);

  const [viewport, setViewport] = useState<LineageViewportState>({
    x: 0,
    y: 0,
    k: 1,
    viewportWidth: containerSize.width,
    viewportHeight: containerSize.height,
  });

  useEffect(() => {
    onLayoutChange?.(layout);
  }, [layout, onLayoutChange]);

  useEffect(() => {
    onViewportChange?.(viewport);
  }, [onViewportChange, viewport]);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }
      setContainerSize({
        width: Math.max(entry.contentRect.width, 640),
        height: Math.max(entry.contentRect.height, 520),
      });
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const applyTransform = useCallback((transform: d3.ZoomTransform) => {
    if (!svgRef.current || !zoomRef.current) {
      return;
    }
    d3.select(svgRef.current)
      .transition()
      .duration(250)
      .call(zoomRef.current.transform, transform);
  }, []);

  const fitToScreen = useCallback(() => {
    const scale = Math.min(
      (containerSize.width - 80) / layout.width,
      (containerSize.height - 80) / layout.height,
      1,
    );
    const transform = d3.zoomIdentity
      .translate(
        (containerSize.width - layout.width * scale) / 2,
        (containerSize.height - layout.height * scale) / 2,
      )
      .scale(scale);
    applyTransform(transform);
  }, [applyTransform, containerSize.width, containerSize.height, layout.width, layout.height]);

  const reset = useCallback(() => {
    applyTransform(d3.zoomIdentity.translate(24, 24).scale(1));
  }, [applyTransform]);

  const zoomIn = useCallback(() => {
    if (!svgRef.current || !zoomRef.current) {
      return;
    }
    d3.select(svgRef.current).transition().duration(180).call(zoomRef.current.scaleBy, 1.2);
  }, []);

  const zoomOut = useCallback(() => {
    if (!svgRef.current || !zoomRef.current) {
      return;
    }
    d3.select(svgRef.current).transition().duration(180).call(zoomRef.current.scaleBy, 0.85);
  }, []);

  const centerOn = useCallback((x: number, y: number) => {
    const transform = d3.zoomIdentity
      .translate(containerSize.width / 2 - x * viewport.k, containerSize.height / 2 - y * viewport.k)
      .scale(viewport.k);
    applyTransform(transform);
  }, [applyTransform, containerSize.width, containerSize.height, viewport.k]);

  const fullscreen = useCallback(() => {
    if (!containerRef.current || !containerRef.current.requestFullscreen) {
      return;
    }
    void containerRef.current.requestFullscreen();
  }, []);

  useEffect(() => {
    if (!svgRef.current || !viewportRef.current) {
      return;
    }

    const selection = d3.select(svgRef.current);
    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 2.8])
      .on('zoom', (event) => {
        const transform = event.transform;
        d3.select(viewportRef.current).attr(
          'transform',
          `translate(${transform.x}, ${transform.y}) scale(${transform.k})`,
        );
        setViewport({
          x: transform.x,
          y: transform.y,
          k: transform.k,
          viewportWidth: containerSize.width,
          viewportHeight: containerSize.height,
        });
      });
    selection.call(zoom);
    zoomRef.current = zoom;
    return () => {
      selection.on('.zoom', null);
    };
  }, [containerSize.height, containerSize.width]);

  useEffect(() => {
    // `direction` triggers a re-fit when the graph orientation changes; fitToScreen
    // already tracks layout/container size via its own dependencies.
    fitToScreen();
  }, [fitToScreen, direction]);

  useEffect(() => {
    onReady?.({
      fitToScreen,
      reset,
      zoomIn,
      zoomOut,
      fullscreen,
      centerOn,
    });
  }, [onReady, fitToScreen, reset, zoomIn, zoomOut, fullscreen, centerOn]);

  const loweredSearch = search.trim().toLowerCase();
  const searchMatches = new Set(
    graph.nodes
      .filter((node) =>
        loweredSearch
          ? `${node.name} ${node.type} ${node.entity_id}`.toLowerCase().includes(loweredSearch)
          : true,
      )
      .map((node) => node.id),
  );

  const selectedEdgeNodeIds = useMemo(() => {
    if (!selectedNodeId) {
      return new Set<string>();
    }
    const ids = new Set<string>([selectedNodeId]);
    graph.edges.forEach((edge) => {
      if (edge.source === selectedNodeId || edge.target === selectedNodeId) {
        ids.add(edge.source);
        ids.add(edge.target);
      }
    });
    return ids;
  }, [graph.edges, selectedNodeId]);

  const directImpactIds = new Set((impact?.directly_affected ?? []).map((item) => item.node.id));
  const indirectImpactIds = new Set((impact?.indirectly_affected ?? []).map((item) => item.node.id));

  return (
    <div ref={containerRef} className="relative h-[720px] overflow-hidden rounded-lg border bg-card">
      <svg ref={svgRef} width="100%" height="100%">
        <defs>
          <marker id="lineage-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="hsl(var(--muted-foreground))" />
          </marker>
        </defs>
        <g ref={viewportRef}>
          {layout.edges.map((edge) => {
            const path = edge.points.reduce((acc, point, index) => {
              return `${acc}${index === 0 ? `M ${point.x} ${point.y}` : ` L ${point.x} ${point.y}`}`;
            }, '');
            const middle = edge.points[Math.floor(edge.points.length / 2)] ?? { x: 0, y: 0 };
            const highlighted = selectedNodeId ? edge.source === selectedNodeId || edge.target === selectedNodeId : false;
            const dimmed =
              (selectedNodeId && !highlighted) ||
              (loweredSearch !== '' && !searchMatches.has(edge.source) && !searchMatches.has(edge.target));
            return (
              <LineageEdge
                key={edge.id}
                edge={edge}
                path={path}
                labelX={middle.x}
                labelY={middle.y - 6}
                highlighted={highlighted}
                dimmed={dimmed}
              />
            );
          })}

          {layout.nodes.map((node) => {
            const selected = node.id === selectedNodeId;
            const dimmed =
              (selectedNodeId && !selectedEdgeNodeIds.has(node.id)) ||
              (loweredSearch !== '' && !searchMatches.has(node.id));

            let fill = NODE_COLORS[node.type] ?? 'hsl(var(--muted-foreground))';
            if (impact) {
              if (node.id === impact.entity.id) {
                fill = 'hsl(var(--primary))'; // focused entity — brand emphasis
              } else if (directImpactIds.has(node.id)) {
                fill = 'hsl(var(--severity-high))'; // direct blast radius
              } else if (indirectImpactIds.has(node.id)) {
                fill = 'hsl(var(--severity-medium))'; // indirect blast radius
              }
            }

            return (
              <g
                key={node.id}
                transform={`translate(${node.position.x}, ${node.position.y})`}
                onClick={() => onSelectNode(node)}
                className="cursor-pointer"
                data-testid={`lineage-node-${node.id}`}
              >
                <LineageNode node={node} selected={selected} dimmed={dimmed} fill={fill} />
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
