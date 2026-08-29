import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import type { DRTopology } from '@/types/clario-dr';
import { TopologyGraphPanel } from './topology-graph-panel';

/**
 * Offline regression guard for the DR-console recovery-topology graph.
 *
 * The original crash — `TypeError: e.edges is not iterable` raised inside the
 * `graph` useMemo — fired whenever the backing topology API errored or returned
 * a partial payload (a truthy object whose `nodes`/`edges` fields are missing).
 * `topologyToGraph` then iterated `undefined`. These cases must now render the
 * NodeMap empty state instead of throwing.
 *
 * No network: this test never mounts the real query hooks — it drives the panel
 * directly through its props, exactly as the readiness route wires it.
 */
const noop = vi.fn();

function renderPanel(topology: DRTopology | null) {
  return renderWithQuery(
    <TopologyGraphPanel
      topology={topology}
      sites={[]}
      streams={[]}
      loading={false}
      error={null}
      canWrite={false}
      onAddEdge={noop}
      addEdgePending={false}
      onRetry={noop}
    />,
  );
}

describe('TopologyGraphPanel', () => {
  it('renders without throwing when topology is null (no data yet)', () => {
    expect(() => renderPanel(null)).not.toThrow();
    // The NodeMap falls back to its empty state rather than crashing.
    expect(
      screen.getByText('No sites to map', { exact: false }),
    ).toBeInTheDocument();
  });

  it('does not throw "is not iterable" when topology is missing nodes/edges', () => {
    // The real-world crash payload: a truthy object whose iterable fields are
    // absent (e.g. an errored/partial topology response).
    const partial = { group_id: 'group-payments' } as unknown as DRTopology;
    expect(() => renderPanel(partial)).not.toThrow();
    expect(
      screen.getByText('No sites to map', { exact: false }),
    ).toBeInTheDocument();
  });

  it('renders an explicit empty topology without crashing', () => {
    const empty: DRTopology = { group_id: 'group-payments', nodes: [], edges: [] };
    expect(() => renderPanel(empty)).not.toThrow();
  });
});
