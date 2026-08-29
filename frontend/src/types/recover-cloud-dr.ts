// Types for the Cloud Disaster Recovery sub-solution workspace (Prompt 5).
//
// These mirror the backend `GET /api/recover/cloud-dr/*` payloads exactly
// (internal/recover/cloud_dr.go). The Cloud DR workspace composes the existing
// dr/* services — bootgraph (dependency-aware boot sequencing), vmcapture +
// iacdr (workloads), and the DR failover-run history — so every value here is
// real, server-computed state, never canned.

/** One captured VM source (vmcapture) backing Cloud DR. */
export interface VMSourceSummary {
  id: string;
  name: string;
  source_kind: string;
  enabled: boolean;
  epoch_count: number;
  last_run_at?: string | null;
}

/** One ingested infrastructure-as-code snapshot (iacdr). */
export interface IaCSnapshotSummary {
  id: string;
  name: string;
  source_kind: string;
  version: number;
  resource_count: number;
  created_at: string;
}

/** The protected-workload summary backing Cloud DR. */
export interface WorkloadSummary {
  vm_sources: number;
  vm_sources_list: VMSourceSummary[];
  iac_snapshots: number;
  iac_snapshots_list: IaCSnapshotSummary[];
}

/** The most-recent failover/drill run, with RTO objective vs captured actual. */
export interface FailoverTestSummary {
  id: string;
  group_id: string;
  mode: string;
  status: string;
  rto_objective_seconds: number;
  rto_actual_seconds?: number | null;
  initiated_at: string;
  completed_at?: string | null;
}

/** One recovery scope's (region/AZ) boot-graph status. */
export interface RegionBootStatus {
  group_id: string;
  group_name: string;
  site_names: string[];
  tier_count: number;
  service_count: number;
  has_plan: boolean;
}

/** Aggregated boot-graph status across recovery scopes. */
export interface BootGraphSummary {
  total_scopes: number;
  scopes_with_plan: number;
  total_services: number;
  scopes: RegionBootStatus[];
}

/** The full Cloud DR overview payload. */
export interface CloudDROverview {
  workloads: WorkloadSummary;
  last_failover_test?: FailoverTestSummary | null;
  boot_graph: BootGraphSummary;
}

/** One service vertex in a boot tier (bootgraph). */
export interface BootGraphService {
  id: string;
  name: string;
  kind: string;
  group_id?: string;
  boot_action?: string;
  probe_kind?: string;
  probe_target?: string;
}

/** The real, dependency-ordered boot plan for one recovery scope. */
export interface RegionFailoverPlan {
  group_id: string;
  group_name: string;
  site_names: string[];
  tier_count: number;
  service_count: number;
  // Tiers[0] boots first; services within a tier boot in parallel once the prior
  // tier's health gate passes. This ordering comes from the bootgraph engine.
  tiers: BootGraphService[][];
}
