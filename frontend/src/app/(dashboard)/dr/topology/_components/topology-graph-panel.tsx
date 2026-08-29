'use client';

import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import {
  NodeMap,
  topologyToGraph,
  type NodeMapEdge,
  type NodeMapNode,
} from '@/components/product';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type {
  DRProtectedSite,
  DRReplicationStream,
  DRTopology,
  DRTopologyAddEdgeRequest,
} from '@/types/clario-dr';
import { makeDRStatusLabel } from '../../_lib/dr-i18n';
import { DRWriteGate } from '../../_components/console/dr-write-gate';
import { useTopologyLabels } from '../../_components/topology/topology-labels';
import { AddEdgeDialog } from './add-edge-dialog';

/**
 * Recovery-topology graph panel: renders the group's directed replication graph
 * via the design-system {@link NodeMap} (fed by the real `topologyToGraph`
 * mapper) and lets a `dr:write` operator author a new dependency edge.
 *
 * The NodeMap `labels` come from the foundation `useTopologyLabels().nodeMap`
 * (the exact DS prop) paired with a locale-bound `statusLabel` from
 * `makeDRStatusLabel`; the SVG flow is mirrored under RTL via the `rtl` prop
 * driven by the active locale direction. The add-edge control is wrapped in the
 * shared `DRWriteGate`, so it is honestly disabled (and explained) for readers.
 */
export function TopologyGraphPanel({
  topology,
  sites,
  streams,
  loading,
  error,
  canWrite,
  onAddEdge,
  addEdgePending,
  onRetry,
}: {
  topology: DRTopology | null;
  sites: DRProtectedSite[];
  streams: DRReplicationStream[];
  loading: boolean;
  error: unknown;
  canWrite: boolean;
  onAddEdge: (payload: DRTopologyAddEdgeRequest) => void;
  addEdgePending: boolean;
  onRetry: () => void;
}) {
  const labels = useTopologyLabels();
  const { locale, direction } = useLocaleOrDefault();
  const [dialogOpen, setDialogOpen] = useState(false);

  const statusLabel = useMemo(() => makeDRStatusLabel(locale), [locale]);

  const graph = useMemo<{ nodes: NodeMapNode[]; edges: NodeMapEdge[] }>(
    () => (topology ? topologyToGraph(topology) : { nodes: [], edges: [] }),
    [topology],
  );

  if (loading && !topology) {
    return <LoadingSkeleton variant="card" count={1} />;
  }

  if (error && !topology) {
    return <ErrorState message={labels.errorDescription} onRetry={onRetry} />;
  }

  return (
    <section className="space-y-4" aria-label={labels.title}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-h4 font-semibold text-content-primary">{labels.title}</h2>
          <p className="max-w-2xl text-sm text-content-secondary">{labels.description}</p>
        </div>
        <DRWriteGate canWrite={canWrite} description={labels.description}>
          <Button type="button" size="sm" onClick={() => setDialogOpen(true)}>
            <Plus className="me-1.5 h-4 w-4" aria-hidden />
            {labels.addEdgeTriggerLabel}
          </Button>
        </DRWriteGate>
      </div>

      <NodeMap
        nodes={graph.nodes}
        edges={graph.edges}
        labels={labels.nodeMap}
        statusLabel={statusLabel}
        rtl={direction === 'rtl'}
      />

      <AddEdgeDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onAddEdge={(payload) => {
          onAddEdge(payload);
          setDialogOpen(false);
        }}
        submitting={addEdgePending}
        sites={sites}
        streams={streams}
      />
    </section>
  );
}
