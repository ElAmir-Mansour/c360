// Platform Admin Console types.
//
// Shapes mirror the backend gap-endpoint contracts in
// docs/platform-admin-console.md §F.2 (G1..G24) and §J.4. Field names match the
// JSON the endpoints return (snake_case) so they bind directly to TanStack Query
// results without a transform layer. Optional members reflect the "always return
// 200, degrade per-field" resilience contract (§H): a service with no admin port
// yields a null/absent `metrics` block that screens render as "—", never "0".

// ── Shared enums ──────────────────────────────────────────────────────────────

export type FleetServiceStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
export type FleetReadiness = 'healthy' | 'degraded' | 'unhealthy';
export type CircuitState = 'closed' | 'open' | 'half-open';
export type TenantLifecycleStatus =
  | 'active'
  | 'suspended'
  | 'trial'
  | 'provisioning'
  | 'deprovisioning'
  | 'deprovisioned';
export type SubscriptionTier = 'free' | 'starter' | 'professional' | 'enterprise';
export type LicenseState = 'active' | 'in_grace' | 'expired' | 'suspended';
export type ProvisioningStatus = 'pending' | 'provisioning' | 'failed' | 'completed';

// ── G1 / G1b — Fleet health (Overview + Services) ─────────────────────────────

export interface FleetServiceMetrics {
  rps: number;
  error_rate_pct: number;
  p50: number;
  p95: number;
  p99: number;
  active: number;
  db_pool_pct?: number;
  cpu_pct?: number;
  mem_mb?: number;
}

export interface FleetServiceCheck {
  status: string;
  latency_ms?: number;
}

export interface FleetService {
  name: string;
  suite?: string;
  role: string;
  version: string;
  uptime?: string;
  status: FleetServiceStatus;
  liveness: boolean;
  readiness: FleetReadiness;
  /** Per-dependency readiness (postgres/redis/kafka/...). */
  checks?: Record<string, FleetServiceCheck>;
  circuit_breaker?: CircuitState;
  endpoints?: { http: string; admin?: string };
  metrics?: FleetServiceMetrics;
  last_scraped_at?: string;
  /** Present when the per-service scrape failed; render inline, not as ErrorState. */
  scrape_error?: string;
}

export interface FleetSummary {
  total: number;
  healthy: number;
  degraded: number;
  unhealthy: number;
  unknown: number;
  /** Overview-only rollups merged into the summary by the aggregator. */
  tenants?: number;
  seats_used?: number;
  critical_audit_24h?: number;
}

export interface FleetHealth {
  generated_at: string;
  overall_status: FleetReadiness;
  summary: FleetSummary;
  services: FleetService[];
}

/** G1b — lightweight badge/header poll. */
export interface FleetHealthSummary {
  summary: FleetSummary;
  unhealthy: number;
}

// ── G2 — Admin tenant list with aggregates ────────────────────────────────────

export interface AdminTenantSummary {
  id: string;
  name: string;
  slug: string;
  status: TenantLifecycleStatus;
  subscription_tier: SubscriptionTier;
  user_count: number;
  active_user_count: number;
  storage_used_bytes: number;
  license_state: LicenseState;
  seats: number;
  seats_used: number;
  provisioning_status?: ProvisioningStatus;
  deprovisioned_at?: string | null;
  retain_until?: string | null;
  created_at: string;
  last_activity_at?: string | null;
}

// ── G3 — Tenant rollup (Overview) ─────────────────────────────────────────────

export interface PlatformTenantsSummary {
  tenant_count: number;
  active: number;
  suspended: number;
  trial: number;
  deprovisioned: number;
  total_users: number;
  total_storage_bytes: number;
  api_calls_24h: number;
  /** Tenants needing operator attention (drives the Tenants nav badge). */
  attention: number;
}

// ── G6 — Cross-tenant user search (Identity) ──────────────────────────────────

export interface AdminUserSummary {
  id: string;
  email: string;
  name: string;
  tenant_id: string;
  tenant_name: string;
  status: string;
  roles: string[];
  last_login_at?: string | null;
}

// ── G7 / G8 — Fleet license rows + expiries (Licensing) ───────────────────────

export interface FleetLicenseRow {
  tenant_id: string;
  tenant_name: string;
  tenant_slug?: string;
  plan_key: string;
  plan_name?: string;
  state: LicenseState;
  seats: number;
  seats_used: number;
  expires_at?: string | null;
  grace_until?: string | null;
}

export interface ExpiringLicense {
  tenant_id: string;
  tenant_name: string;
  plan_key: string;
  state: LicenseState;
  expires_at: string;
  grace_until?: string | null;
  /** Negative = already expired, positive = days remaining. */
  days_remaining: number;
}

// ── G9 — Entitlement overrides (Licensing) ────────────────────────────────────

export interface Override {
  tenant_id: string;
  key: EntitlementKey['key'];
  /** limit 0 == revoked (verified semantics, service.go:398). */
  limit: number;
  reason?: string;
  set_by?: string;
  set_at?: string;
  expires_at?: string | null;
}

// ── G10 — Tenant entitlements (Suites tab) ────────────────────────────────────

export interface TenantEntitlement {
  key: string;
  label?: string;
  kind?: EntitlementKind;
  /** Resolved limit after plan + overrides. null/undefined == unlimited. */
  limit?: number | null;
  used?: number;
  source: 'plan' | 'override';
  enabled: boolean;
}

// ── G11 — Seat / usage rollup (Overview + Licensing) ──────────────────────────

export interface SeatRollupTenant {
  tenant_id: string;
  tenant_name: string;
  limit: number;
  used: number;
}

export interface SeatRollup {
  key: string;
  total_limit: number;
  total_used: number;
  per_tenant: SeatRollupTenant[];
}

// ── G12 — Entitlement key registry (Suites) ───────────────────────────────────

export type EntitlementKind =
  | 'suite'
  | 'app'
  | 'boolean'
  | 'count'
  | 'seats'
  | 'storage'
  | 'feature';

export interface EntitlementKey {
  key: string;
  label: string;
  kind: EntitlementKind;
}

// ── G22 — ABAC policies + simulate (Identity) ─────────────────────────────────

export type AbacEffect = 'allow' | 'deny';

export interface AbacCondition {
  attribute: string;
  operator: string;
  value: unknown;
}

export interface AbacPolicy {
  id: string;
  tenant_id?: string;
  name: string;
  description?: string;
  effect: AbacEffect;
  action: string;
  resource_type: string;
  priority: number;
  enabled: boolean;
  conditions: AbacCondition[];
  created_at?: string;
  updated_at?: string;
}

export interface AbacSimulateRequest {
  subject: Record<string, unknown>;
  resource: Record<string, unknown>;
  action: string;
  resource_type: string;
}

export interface AbacSimulateResult {
  decision: AbacEffect;
  matched_policy_id?: string;
  matched_policy_name?: string;
  /** Ordered trace of policy evaluation for the simulator UI. */
  evaluated: Array<{
    policy_id: string;
    policy_name: string;
    effect: AbacEffect;
    matched: boolean;
  }>;
}

// ── G13 — Gateway route map (Suites/Services) ─────────────────────────────────

/**
 * A route's versioning contract. The gateway returns this as a structured
 * object (id/version/apiVersion/phase); some older builds returned a bare
 * string. Consumers MUST format it via `formatRouteContract` before rendering —
 * rendering the object directly crashes React (error #31).
 */
export interface RouteContract {
  id?: string;
  version?: string;
  apiVersion?: string;
  phase?: string;
}

export interface GatewayRoute {
  prefix: string;
  service: string;
  public: boolean;
  group?: string;
  entitlement?: string;
  contract?: string | RouteContract;
}

// ── G18 — Circuit breakers (Services) ─────────────────────────────────────────

export interface CircuitBreakerState {
  service: string;
  state: CircuitState;
  failures?: number;
  last_changed_at?: string;
}

export type CircuitAction = 'open' | 'close' | 'reset';

// ── G19 — Kill switches (Services) ────────────────────────────────────────────

export interface KillSwitch {
  key: string;
  enabled: boolean;
  reason?: string;
  set_by?: string;
  set_at?: string;
}

// ── G20 — Rate limits (Services) ──────────────────────────────────────────────

export interface RateLimitConfig {
  /** Empty/absent tenant_id == the global default. */
  tenant_id?: string;
  tenant_name?: string;
  tier?: SubscriptionTier;
  requests_per_second: number;
  burst: number;
}

// ── G14 — Cross-tenant audit (Audit) ──────────────────────────────────────────

export interface AuditAdminLog {
  id: string;
  tenant_id: string;
  tenant_name: string;
  actor_id?: string;
  actor_email?: string;
  action: string;
  resource_type?: string;
  resource_id?: string;
  severity?: 'low' | 'medium' | 'high' | 'critical';
  service?: string;
  ip_address?: string;
  created_at: string;
  entry_hash?: string;
  prev_hash?: string;
  old_value?: unknown;
  new_value?: unknown;
}

// ── G24 — Provisioning oversight (Provisioning) ───────────────────────────────

export interface ProvisioningStep {
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  started_at?: string;
  finished_at?: string;
  duration_ms?: number;
  error?: string;
}

export interface ProvisioningItem {
  tenant_id: string;
  tenant_name: string;
  tenant_slug?: string;
  status: ProvisioningStatus;
  progress_pct: number;
  started_at?: string;
  steps?: ProvisioningStep[];
}

// ── G23 — AI fleet rollup (AI Governance) ─────────────────────────────────────

export interface FleetAiTenantRow {
  tenant_id: string;
  tenant_name: string;
  total_models: number;
  in_production: number;
  shadow: number;
  drift_alerts: number;
  /** Worst per-tenant drift health, for the table tone. */
  drift_health: 'healthy' | 'warning' | 'critical';
}

export interface FleetAiModelSlug {
  slug: string;
  display_name: string;
  suite?: string;
  tenants_using: number;
  in_production: number;
  shadow: number;
  drift_alerts: number;
  risk_tier?: string;
}

export interface FleetAiModels {
  generated_at?: string;
  summary: {
    total_tenants: number;
    total_models: number;
    in_production: number;
    shadow: number;
    drift_alerts: number;
  };
  tenants: FleetAiTenantRow[];
  models?: FleetAiModelSlug[];
}

// ── G5 — Impersonation grant (client-side, security-sensitive) ────────────────

export interface ImpersonationGrant {
  access_token: string;
  expires_at: string;
  impersonated_user_id?: string;
  tenant_id: string;
  tenant_name?: string;
  readonly: boolean;
}

export interface ImpersonateRequest {
  target_user_id?: string;
  reason: string;
  /** Seconds; backend hard-caps at 900 (≤15 min, §E.2). */
  ttl: number;
}
