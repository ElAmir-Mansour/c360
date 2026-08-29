/**
 * Types for the Recover Application Metastore seam (Prompt 7).
 *
 * The Metastore is the CMDB-like source of truth for the recovery-relevant
 * metadata a runbook is built from. These mirror the Go `metastore.Application`
 * / `PopulateResult` / `SyncResult` shapes published by
 * `internal/recover/metastore` (METASTORE_SEAM.md).
 */

export type RecoveryTier =
  | 'mission_critical'
  | 'tier_1'
  | 'tier_2'
  | 'tier_3';

export type EnvironmentKind =
  | 'production'
  | 'disaster_recovery'
  | 'staging'
  | 'test'
  | 'development';

export type DependencyCriticality = 'hard' | 'soft';

export type CloudProvider = 'aws' | 'azure' | 'gcp' | 'oci' | 'on_prem';

export interface MetastoreOwner {
  role: string;
  name: string;
  contact?: string;
}

export interface MetastoreEnvironment {
  key: string;
  kind: EnvironmentKind;
  region?: string;
  is_recovery_target: boolean;
}

export interface MetastoreDependency {
  depends_on_app_key: string;
  criticality: DependencyCriticality;
}

export interface MetastoreCloudAccount {
  provider: CloudProvider;
  account_ref: string;
  region?: string;
}

export interface MetastoreRunbookLink {
  runbook_id: string;
  source_revision: number;
  source_hash: string;
  created_at: string;
  updated_at: string;
}

export interface MetastoreApplication {
  id: string;
  tenant_id: string;
  app_key: string;
  name: string;
  description?: string;
  recovery_tier: RecoveryTier;
  rto_target_seconds: number;
  owners: MetastoreOwner[];
  environments: MetastoreEnvironment[];
  dependencies: MetastoreDependency[];
  cloud_accounts: MetastoreCloudAccount[];
  linked_runbooks: MetastoreRunbookLink[];
  metadata_revision: number;
  metadata_hash: string;
  created_at: string;
  updated_at: string;
}

/** Create/update payload for an application's recovery metadata. */
export interface MetastoreApplicationInput {
  app_key: string;
  name: string;
  description?: string;
  recovery_tier: RecoveryTier;
  rto_target_seconds: number;
  owners: MetastoreOwner[];
  environments: MetastoreEnvironment[];
  dependencies: MetastoreDependency[];
  cloud_accounts: MetastoreCloudAccount[];
}

/** Outcome of populating a runbook from an application's metadata. */
export interface MetastorePopulateResult {
  application_id: string;
  app_key: string;
  runbook_id: string;
  runbook_name: string;
  task_count: number;
  source_revision: number;
}

export type MetastoreDriftKind = 'none' | 'stale';

export interface MetastoreDriftField {
  field: string;
  summary: string;
}

/** Outcome of a sync (drift) of a linked runbook against current metadata. */
export interface MetastoreSyncResult {
  application_id: string;
  app_key: string;
  runbook_id: string;
  drifted: boolean;
  kind: MetastoreDriftKind;
  source_revision: number;
  current_revision: number;
  source_hash: string;
  current_hash: string;
  changed_fields: MetastoreDriftField[] | null;
}

/** Paginated application list payload (the `{data, meta}` envelope). */
export interface MetastoreApplicationsPage {
  data: MetastoreApplication[];
  meta: {
    page: number;
    per_page: number;
    total: number;
    total_pages: number;
  };
}
