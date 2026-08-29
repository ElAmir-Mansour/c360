import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import { NodeMap } from './node-map';
import {
  topologyToGraph,
  bootPlanToGraph,
  computeNodeCriticalPath,
  layoutGraph,
} from './node-map-graph';
import {
  sampleTopology,
  sampleTopologyCriticalPath,
  sampleTopologyCriticalPathSeconds,
  sampleBootTiers,
  nodeMapLabelsEn,
  nodeMapLabelsAr,
  statusLabelEn,
  statusLabelAr,
} from './node-map-fixtures';

describe('node-map-graph', () => {
  it('maps a DR topology to nodes + edges (real shapes)', () => {
    const { nodes, edges } = topologyToGraph(sampleTopology);
    expect(nodes).toHaveLength(sampleTopology.nodes.length);
    expect(edges).toHaveLength(sampleTopology.edges.length);
    // Node weight is the heaviest inbound replication lag.
    const recovery = nodes.find((n) => n.id === 'n-recovery');
    expect(recovery?.weight).toBe(120);
  });

  it('computes the weighted critical path on the known topology', () => {
    const { nodes, edges } = topologyToGraph(sampleTopology);
    const cp = computeNodeCriticalPath(nodes, edges);
    expect(cp.path).toEqual(sampleTopologyCriticalPath);
    expect(cp.weight).toBe(sampleTopologyCriticalPathSeconds);
  });

  it('lays out the graph deterministically with positioned nodes + routed edges', () => {
    const { nodes, edges } = topologyToGraph(sampleTopology);
    const layout = layoutGraph(nodes, edges);
    expect(layout.nodes).toHaveLength(nodes.length);
    expect(layout.edges).toHaveLength(edges.length);
    // Every node got a real layout box and a dependency rank.
    for (const n of layout.nodes) {
      expect(Number.isFinite(n.x)).toBe(true);
      expect(Number.isFinite(n.y)).toBe(true);
      expect(n.rank).toBeGreaterThanOrEqual(0);
    }
    // The primary site is the root (rank 0); recovery is downstream.
    expect(layout.nodes.find((n) => n.id === 'n-primary')?.rank).toBe(0);
    expect(
      layout.nodes.find((n) => n.id === 'n-recovery')?.rank,
    ).toBeGreaterThan(0);
    // Edges have routed poly-line points.
    for (const e of layout.edges) {
      expect(e.points.length).toBeGreaterThanOrEqual(2);
    }
    // Deterministic: a second layout yields identical node coordinates.
    const layout2 = layoutGraph(nodes, edges);
    expect(layout2.nodes.map((n) => [n.x, n.y])).toEqual(
      layout.nodes.map((n) => [n.x, n.y]),
    );
  });

  it('maps a bootgraph boot plan to a graph with tier-edge dependencies', () => {
    const { nodes, edges } = bootPlanToGraph(sampleBootTiers());
    expect(nodes).toHaveLength(4); // net, dns, db, app
    // tier-2 db depends on BOTH tier-1 services.
    const dbEdges = edges.filter((e) => e.to === 'b-db').map((e) => e.from).sort();
    expect(dbEdges).toEqual(['b-dns', 'b-net']);
  });

  it('does not throw "is not iterable" when the topology is missing nodes/edges', () => {
    // The topology endpoint can return a partial/empty payload (or 404→null)
    // where `nodes`/`edges` are absent — the mapper must default them to [].
    expect(() => topologyToGraph(null)).not.toThrow();
    expect(() => topologyToGraph(undefined)).not.toThrow();
    // A truthy object with missing iterable fields is the real-world crash case.
    const partial = { group_id: 'g' } as unknown as Parameters<typeof topologyToGraph>[0];
    expect(() => topologyToGraph(partial)).not.toThrow();
    expect(topologyToGraph(partial)).toEqual({ nodes: [], edges: [] });
    expect(topologyToGraph(null)).toEqual({ nodes: [], edges: [] });
  });

  it('lays out an empty/undefined graph without iterating undefined', () => {
    expect(() => layoutGraph(undefined, undefined)).not.toThrow();
    const layout = layoutGraph([], []);
    expect(layout.nodes).toHaveLength(0);
    expect(layout.edges).toHaveLength(0);
    expect(layout.criticalPath).toHaveLength(0);
  });

  it('maps an empty/undefined boot plan to an empty graph', () => {
    expect(() => bootPlanToGraph(undefined)).not.toThrow();
    expect(bootPlanToGraph(null)).toEqual({ nodes: [], edges: [] });
  });
});

describe('NodeMap', () => {
  it('renders N nodes and exposes an accessible text alternative (figure + table)', () => {
    const { nodes, edges } = topologyToGraph(sampleTopology);
    renderWithQuery(
      <NodeMap
        nodes={nodes}
        edges={edges}
        labels={nodeMapLabelsEn}
        statusLabel={statusLabelEn}
        title="Recovery topology"
      />,
    );

    // The figure has an accessible name.
    const figure = screen.getByRole('figure', {
      name: nodeMapLabelsEn.figureAriaLabel,
    });
    expect(figure).toBeInTheDocument();

    // The decorative SVG is hidden from assistive tech.
    const svg = figure.querySelector('svg');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');

    // The text-alternative table has a row per node (header row + N rows).
    const table = within(figure).getByRole('table');
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(nodes.length + 1);

    // Every node label appears as a row header.
    for (const n of nodes) {
      expect(
        within(table).getByRole('rowheader', { name: n.label }),
      ).toBeInTheDocument();
    }
  });

  it('renders an N-edge graph: every edge is a routed line in the SVG', () => {
    const { nodes, edges } = topologyToGraph(sampleTopology);
    renderWithQuery(
      <NodeMap
        nodes={nodes}
        edges={edges}
        labels={nodeMapLabelsEn}
        statusLabel={statusLabelEn}
      />,
    );
    const figure = screen.getByRole('figure', {
      name: nodeMapLabelsEn.figureAriaLabel,
    });
    const polylines = figure.querySelectorAll('svg polyline');
    expect(polylines.length).toBe(edges.length);
  });

  it('renders the critical path as an ordered list in the accessible alternative', () => {
    const { nodes, edges } = topologyToGraph(sampleTopology);
    renderWithQuery(
      <NodeMap
        nodes={nodes}
        edges={edges}
        labels={nodeMapLabelsEn}
        statusLabel={statusLabelEn}
      />,
    );
    const heading = screen.getByText(nodeMapLabelsEn.criticalPathHeading);
    const list = heading.parentElement?.querySelector('ol');
    expect(list).not.toBeNull();
    const items = within(list as HTMLElement).getAllByRole('listitem');
    expect(items).toHaveLength(sampleTopologyCriticalPath.length);
    // First node on the critical path is the primary site.
    expect(items[0].textContent).toContain('Riyadh primary');
  });

  it('marks node critical-path membership in the table (Yes/No, not colour-only)', () => {
    const { nodes, edges } = topologyToGraph(sampleTopology);
    renderWithQuery(
      <NodeMap
        nodes={nodes}
        edges={edges}
        labels={nodeMapLabelsEn}
        statusLabel={statusLabelEn}
      />,
    );
    const table = screen.getByRole('table');
    // The off-critical-path standby-b row is marked "No".
    const standbyBRow = within(table)
      .getByRole('rowheader', { name: 'Dammam standby' })
      .closest('tr') as HTMLElement;
    expect(within(standbyBRow).getByText(nodeMapLabelsEn.no)).toBeInTheDocument();
    // The on-critical-path recovery row is marked "Yes".
    const recoveryRow = within(table)
      .getByRole('rowheader', { name: 'Sovereign recovery vault' })
      .closest('tr') as HTMLElement;
    expect(within(recoveryRow).getByText(nodeMapLabelsEn.yes)).toBeInTheDocument();
  });

  it('uses bilingual copy and mirrors flow under RTL (Arabic)', () => {
    const { nodes, edges } = topologyToGraph(sampleTopology);
    renderWithQuery(
      <NodeMap
        nodes={nodes}
        edges={edges}
        labels={nodeMapLabelsAr}
        statusLabel={statusLabelAr}
        rtl
      />,
      { locale: 'ar' },
    );
    const figure = screen.getByRole('figure', {
      name: nodeMapLabelsAr.figureAriaLabel,
    });
    expect(figure).toBeInTheDocument();
    // Arabic critical-path heading is used.
    expect(
      screen.getByText(nodeMapLabelsAr.criticalPathHeading),
    ).toBeInTheDocument();
    // RTL flip transform is applied to the SVG so flow reads start→end in RTL.
    const svg = figure.querySelector('svg');
    expect(svg?.getAttribute('style')).toContain('scaleX(-1)');
  });

  it('renders an empty state when there are no nodes', () => {
    renderWithQuery(
      <NodeMap
        nodes={[]}
        edges={[]}
        labels={nodeMapLabelsEn}
        statusLabel={statusLabelEn}
      />,
    );
    expect(screen.getByText(nodeMapLabelsEn.emptyTitle)).toBeInTheDocument();
  });

  it('renders the empty state (no crash) when nodes/edges arrive undefined', () => {
    // Simulates an errored/empty backing query handing undefined down to the
    // view — the component must guard, not iterate `undefined`.
    renderWithQuery(
      <NodeMap
        nodes={undefined as unknown as never[]}
        edges={undefined as unknown as never[]}
        labels={nodeMapLabelsEn}
        statusLabel={statusLabelEn}
      />,
    );
    expect(screen.getByText(nodeMapLabelsEn.emptyTitle)).toBeInTheDocument();
  });
});
