/**
 * node-map-fixtures.ts — sample data for the NodeMap story + tests.
 * =================================================================
 *
 * ORIGINAL ClarioDR content on the REAL DR shapes (`DRTopology` /
 * `DRTopologyNode` / `DRTopologyEdge`, `DRBootService`). The replication graph is
 * a small multi-region topology with parallel branches so the node-map test can
 * assert node/edge counts, the accessible alternative, and a known critical path.
 *
 * Topology (replication edges = recovery dependencies):
 *
 *   primary ──(60s)──▶ standby-a ──(30s)──▶ recovery
 *        └────(15s)──▶ standby-b ──(120s)─▶ recovery
 *
 * Node weight = heaviest inbound replication lag:
 *   primary=0, standby-a=60, standby-b=15, recovery=max(30,120)=120.
 * Weighted longest dependency chain:
 *   primary(0) → standby-a(60) → recovery(120)  → total 180s   (the chain through
 *   standby-a — 60 + 120 — beats the standby-b chain of 15 + 120 = 135s).
 */

import type {
  DRTopology,
  DRTopologyNode,
  DRTopologyEdge,
  DRBootService,
} from '@/types/clario-dr';

const NOW = '2026-06-15T09:00:00Z';

function node(
  id: string,
  siteName: string,
  role: string,
): DRTopologyNode {
  return {
    id,
    tenant_id: 'tenant-clario-dr',
    group_id: 'group-payments',
    site_id: `site-${id}`,
    site_name: siteName,
    role,
    created_at: NOW,
    updated_at: NOW,
  };
}

function edge(
  id: string,
  from: string,
  to: string,
  mode: string,
  health: string,
  lagSeconds: number,
): DRTopologyEdge {
  return {
    id,
    tenant_id: 'tenant-clario-dr',
    group_id: 'group-payments',
    from_node_id: from,
    to_node_id: to,
    stream_id: `stream-${id}`,
    mode,
    priority: 1,
    health,
    lag_seconds: lagSeconds,
    applied_seq: 1000,
    last_progress_at: NOW,
    created_at: NOW,
    updated_at: NOW,
  };
}

/** A multi-region replication topology with two parallel standby branches. */
export const sampleTopology: DRTopology = {
  group_id: 'group-payments',
  nodes: [
    node('n-primary', 'Riyadh primary', 'primary'),
    node('n-standby-a', 'Jeddah standby', 'standby'),
    node('n-standby-b', 'Dammam standby', 'standby'),
    node('n-recovery', 'Sovereign recovery vault', 'recovery'),
  ],
  edges: [
    edge('e-1', 'n-primary', 'n-standby-a', 'sync', 'healthy', 60),
    edge('e-2', 'n-primary', 'n-standby-b', 'async', 'healthy', 15),
    edge('e-3', 'n-standby-a', 'n-recovery', 'async', 'healthy', 30),
    edge('e-4', 'n-standby-b', 'n-recovery', 'async', 'degraded', 120),
  ],
  topo_order: ['n-primary', 'n-standby-a', 'n-standby-b', 'n-recovery'],
};

/** The KNOWN weighted critical path through the sample topology. */
export const sampleTopologyCriticalPath = [
  'n-primary',
  'n-standby-a',
  'n-recovery',
];

/** The KNOWN weighted critical-path total (seconds). */
export const sampleTopologyCriticalPathSeconds = 180;

/** A bootgraph boot plan with parallel tier-1 services. */
export function sampleBootTiers(): DRBootService[][] {
  const svc = (
    id: string,
    name: string,
    kind: string,
    timeout: number,
  ): DRBootService => ({
    id,
    tenant_id: 'tenant-clario-dr',
    group_id: 'group-payments',
    name,
    kind,
    boot_action: 'start',
    site_id: 'site-recovery',
    probe_kind: 'http',
    probe_target: `https://${name}.recovery.local/health`,
    probe_expect_status: 200,
    boot_timeout_seconds: timeout,
    health_retries: 3,
    created_at: NOW,
    updated_at: NOW,
  });
  return [
    [svc('b-net', 'network-fabric', 'network', 120), svc('b-dns', 'dns', 'dns', 60)],
    [svc('b-db', 'payments-db', 'database', 540)],
    [svc('b-app', 'payments-api', 'app', 360)],
  ];
}

/** English copy for the node-map labels. */
export const nodeMapLabelsEn = {
  figureAriaLabel: 'Recovery process node map',
  diagramAriaLabel: 'Recovery process diagram (scrollable)',
  textAlternativeHeading: 'Recovery process — node detail',
  textAlternativeSummary: (nodeCount: number, edgeCount: number) =>
    `${nodeCount} nodes connected by ${edgeCount} dependency links. The longest dependency chain is the critical path.`,
  node: 'Node',
  kind: 'Type',
  status: 'Status',
  dependsOn: 'Depends on',
  criticalPath: 'Critical path',
  criticalPathHeading: 'Critical path (longest dependency chain)',
  onCriticalPath: 'on the critical path',
  yes: 'Yes',
  no: 'No',
  none: 'None',
  kinds: {
    site: 'Site',
    service: 'Service',
    task: 'Task',
  },
  emptyTitle: 'No nodes to map',
  emptyDescription: 'Add sites, services, or tasks to visualise the recovery flow.',
} as const;

/** Arabic copy for the node-map labels (RTL surface). */
export const nodeMapLabelsAr = {
  figureAriaLabel: 'خريطة عُقد عملية التعافي',
  diagramAriaLabel: 'مخطّط عملية التعافي (قابل للتمرير)',
  textAlternativeHeading: 'عملية التعافي — تفاصيل العُقد',
  textAlternativeSummary: (nodeCount: number, edgeCount: number) =>
    `${nodeCount} عقدة مرتبطة بـ ${edgeCount} روابط تبعية. أطول سلسلة تبعية هي المسار الحرج.`,
  node: 'العقدة',
  kind: 'النوع',
  status: 'الحالة',
  dependsOn: 'يعتمد على',
  criticalPath: 'المسار الحرج',
  criticalPathHeading: 'المسار الحرج (أطول سلسلة تبعية)',
  onCriticalPath: 'على المسار الحرج',
  yes: 'نعم',
  no: 'لا',
  none: 'لا شيء',
  kinds: {
    site: 'موقع',
    service: 'خدمة',
    task: 'مهمة',
  },
  emptyTitle: 'لا توجد عُقد للعرض',
  emptyDescription: 'أضِف المواقع أو الخدمات أو المهام لتصوّر تدفّق التعافي.',
} as const;

/** Map a status token to a localized status label (English). */
export const statusLabelEn = (status: string): string => {
  const map: Record<string, string> = {
    primary: 'Primary',
    standby: 'Standby',
    recovery: 'Recovery',
    healthy: 'Healthy',
    degraded: 'Degraded',
    pending: 'Pending',
    unknown: 'Unknown',
  };
  return map[status.toLowerCase()] ?? status;
};

/** Map a status token to a localized status label (Arabic). */
export const statusLabelAr = (status: string): string => {
  const map: Record<string, string> = {
    primary: 'أساسي',
    standby: 'احتياطي',
    recovery: 'التعافي',
    healthy: 'سليم',
    degraded: 'متدهور',
    pending: 'قيد الانتظار',
    unknown: 'غير معروف',
  };
  return map[status.toLowerCase()] ?? status;
};
