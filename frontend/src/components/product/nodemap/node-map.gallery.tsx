'use client';

/**
 * NodeMap — gallery (Storybook-ready demos).
 * ==========================================
 *
 * Composable, dependency-free demos for the ClarioDR recovery node map. NOT
 * imported by any route (never ships in the app bundle) and NOT a test (not
 * collected by Vitest). Wrap a demo in a `LocaleProvider` (and `next-themes`
 * `ThemeProvider`) to exercise bilingual / light-dark / RTL; pass `locale="ar"`
 * and `rtl` for the RTL Arabic variant.
 *
 * Sample data is the REAL DR shape (`DRTopology`, `DRBootService`) mapped through
 * the public graph helpers — no fake contract masking.
 */

import { NodeMap } from './node-map';
import { topologyToGraph, bootPlanToGraph } from './node-map-graph';
import {
  sampleTopology,
  sampleBootTiers,
  nodeMapLabelsEn,
  nodeMapLabelsAr,
  statusLabelEn,
  statusLabelAr,
} from './node-map-fixtures';

/** Replication topology — sites + replication edges, critical path emphasised. */
export function ReplicationTopologyStory() {
  const { nodes, edges } = topologyToGraph(sampleTopology);
  return (
    <div className="bg-bg-page p-section-x">
      <NodeMap
        nodes={nodes}
        edges={edges}
        labels={nodeMapLabelsEn}
        statusLabel={statusLabelEn}
        title="Replication topology"
        description="Multi-region replication graph; the heaviest-lag dependency chain is the critical path."
      />
    </div>
  );
}

/** Boot plan — bootgraph tiers as a service dependency graph. */
export function BootPlanStory() {
  const { nodes, edges } = bootPlanToGraph(sampleBootTiers());
  return (
    <div className="bg-bg-page p-section-x">
      <NodeMap
        nodes={nodes}
        edges={edges}
        labels={nodeMapLabelsEn}
        statusLabel={statusLabelEn}
        title="Boot plan — tiered service start order"
        description="Bootgraph tiers; tier N+1 services depend on every service in tier N."
        layoutOptions={{ rankdir: 'TB' }}
      />
    </div>
  );
}

/** RTL / Arabic variant — flow mirrors so it still reads start→end. */
export function ArabicRtlStory() {
  const { nodes, edges } = topologyToGraph(sampleTopology);
  return (
    <div dir="rtl" className="bg-bg-page p-section-x">
      <NodeMap
        nodes={nodes}
        edges={edges}
        labels={nodeMapLabelsAr}
        statusLabel={statusLabelAr}
        rtl
        title="طوبولوجيا النسخ المتماثل"
        description="مخطّط النسخ المتماثل متعدّد المناطق؛ سلسلة التبعية الأثقل هي المسار الحرج."
      />
    </div>
  );
}

const gallery = {
  title: 'Product/NodeMap/NodeMap',
  stories: {
    ReplicationTopology: ReplicationTopologyStory,
    BootPlan: BootPlanStory,
    ArabicRtl: ArabicRtlStory,
  },
};

export default gallery;
