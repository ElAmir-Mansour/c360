'use client';

// Platform Admin Console — typed TanStack Query hooks over the gap endpoints
// (docs/platform-admin-console.md §F.2). Reads use useApiQuery; writes use
// useApiMutation. Poll cadences follow §H: fleet 30s, tenant list 60s, license
// expiries 5 min, provisioning ticker 10s while in-flight. Until a given backend
// gap is built the query errors and the screen renders its ErrorState — no mocks.

import { useQueryClient } from '@tanstack/react-query';
import { useApiQuery, useApiMutation } from '@/hooks/use-api';
import { useImpersonationStore } from '@/stores/impersonation-store';
import type { PaginatedResponse } from '@/types/api';
import type { AIDashboardData } from '@/types/ai-governance';
import type {
  FleetHealth,
  FleetHealthSummary,
  AdminTenantSummary,
  PlatformTenantsSummary,
  AdminUserSummary,
  FleetLicenseRow,
  ExpiringLicense,
  Override,
  TenantEntitlement,
  SeatRollup,
  EntitlementKey,
  AbacPolicy,
  AbacSimulateRequest,
  AbacSimulateResult,
  GatewayRoute,
  CircuitBreakerState,
  CircuitAction,
  KillSwitch,
  RateLimitConfig,
  AuditAdminLog,
  ProvisioningItem,
  FleetAiModels,
  ImpersonationGrant,
  ImpersonateRequest,
} from '@/types/platform';

interface DataEnvelope<T> {
  data: T;
}

type FleetDriftHealth = FleetAiModels['tenants'][number]['drift_health'];

interface RawFleetAiSummary {
  total_tenants?: number;
  total_models?: number;
  in_production?: number;
  shadow?: number;
  shadow_testing?: number;
  drift_alerts?: number;
}

interface RawFleetAiTenantRow {
  tenant_id?: string;
  tenant_name?: string;
  total_models?: number;
  model_count?: number;
  in_production?: number;
  production_versions?: number;
  production_version?: unknown;
  shadow?: number;
  shadow_versions?: number;
  shadow_testing?: number;
  shadow_version?: unknown;
  drift_alerts?: number;
  open_drift_alerts?: number;
  drift_health?: FleetDriftHealth;
  worst_drift_level?: string;
  drift_status?: string;
}

interface RawFleetAiModelSlug {
  slug?: string;
  display_name?: string;
  name?: string;
  suite?: string;
  tenants_using?: number;
  in_production?: number;
  production_versions?: number;
  production_version?: unknown;
  shadow?: number;
  shadow_versions?: number;
  shadow_testing?: number;
  shadow_version?: unknown;
  drift_alerts?: number;
  open_drift_alerts?: number;
  drift_status?: string;
  risk_tier?: string;
}

interface RawFleetAiModels {
  generated_at?: string;
  summary?: RawFleetAiSummary;
  kpis?: RawFleetAiSummary;
  tenants?: RawFleetAiTenantRow[];
  models?: RawFleetAiModelSlug[];
}

interface RawExpiringLicense {
  tenant_id?: string;
  tenant_name?: string;
  tenant_slug?: string;
  plan_key?: string;
  plan_name?: string;
  status?: string;
  state?: ExpiringLicense['state'];
  seats?: number;
  seats_used?: number;
  expires_at?: string | null;
  grace_days?: number;
  grace_until?: string | null;
  days_remaining?: number;
}

interface RawTenantEntitlementsResponse {
  license_state?: string;
  entitlements?: RawTenantEntitlement[];
}

interface RawTenantEntitlement {
  allowed?: boolean;
  enabled?: boolean;
  key?: string;
  label?: string;
  kind?: string;
  source?: string;
  limit?: number | null;
  used?: number;
}

interface RawTenantUsage {
  key?: string;
  entitlement_key?: string;
  limit?: number | null;
  used?: number;
  value?: number;
}

interface RawSeatRollupTenant {
  tenant_id?: string;
  tenant_name?: string;
  limit?: number;
  used?: number;
}

interface RawSeatRollup {
  key?: string;
  total_limit?: number;
  total_used?: number;
  per_tenant?: RawSeatRollupTenant[];
}

interface RawEntitlementKey {
  key?: string;
  label?: string;
  kind?: string;
}

interface RawAbacSimulateResponse {
  allowed?: boolean;
  decision?: AbacSimulateResult['decision'];
  reason?: string;
  matched_policy_id?: string;
  matched_policy_name?: string;
  evaluated?: AbacSimulateResult['evaluated'];
}

function unwrapDataEnvelope<T>(payload: T | DataEnvelope<T>): T {
  if (payload && typeof payload === 'object' && 'data' in payload) {
    return (payload as DataEnvelope<T>).data;
  }
  return payload;
}

function unwrapQueryData<T>(payload: T): T {
  return unwrapDataEnvelope<T>(payload as T | DataEnvelope<T>);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function driftLevelToHealth(level: unknown): FleetDriftHealth {
  switch (level) {
    case 'significant':
    case 'critical':
      return 'critical';
    case 'moderate':
    case 'warning':
      return 'warning';
    default:
      return 'healthy';
  }
}

function hasDriftSignal(level: unknown): boolean {
  return typeof level === 'string' && level !== '' && level !== 'none';
}

function normalizeFleetAiTenantRow(row: RawFleetAiTenantRow): FleetAiModels['tenants'][number] {
  return {
    tenant_id: row.tenant_id ?? '',
    tenant_name: row.tenant_name ?? row.tenant_id ?? 'Unknown tenant',
    total_models: numberOrZero(row.total_models ?? row.model_count),
    in_production: numberOrZero(
      row.in_production ?? row.production_versions ?? (row.production_version ? 1 : 0),
    ),
    shadow: numberOrZero(
      row.shadow ?? row.shadow_versions ?? row.shadow_testing ?? (row.shadow_version ? 1 : 0),
    ),
    drift_alerts: numberOrZero(
      row.drift_alerts ??
        row.open_drift_alerts ??
        (hasDriftSignal(row.drift_status ?? row.worst_drift_level) ? 1 : 0),
    ),
    drift_health: row.drift_health ?? driftLevelToHealth(row.worst_drift_level ?? row.drift_status),
  };
}

function normalizeFleetAiModelSlug(row: RawFleetAiModelSlug): NonNullable<FleetAiModels['models']>[number] {
  return {
    slug: row.slug ?? '',
    display_name: row.display_name ?? row.name ?? row.slug ?? 'Unknown model',
    suite: row.suite,
    tenants_using: numberOrZero(row.tenants_using),
    in_production: numberOrZero(
      row.in_production ?? row.production_versions ?? (row.production_version ? 1 : 0),
    ),
    shadow: numberOrZero(
      row.shadow ?? row.shadow_versions ?? row.shadow_testing ?? (row.shadow_version ? 1 : 0),
    ),
    drift_alerts: numberOrZero(
      row.drift_alerts ??
        row.open_drift_alerts ??
        (hasDriftSignal(row.drift_status) ? 1 : 0),
    ),
    risk_tier: row.risk_tier,
  };
}

function normalizeFleetAiSummary(raw: RawFleetAiSummary | undefined, tenants: FleetAiModels['tenants']): FleetAiModels['summary'] {
  return {
    total_tenants: numberOrZero(raw?.total_tenants ?? tenants.length),
    total_models: numberOrZero(
      raw?.total_models ?? tenants.reduce((total, tenant) => total + tenant.total_models, 0),
    ),
    in_production: numberOrZero(
      raw?.in_production ?? tenants.reduce((total, tenant) => total + tenant.in_production, 0),
    ),
    shadow: numberOrZero(
      raw?.shadow ?? raw?.shadow_testing ?? tenants.reduce((total, tenant) => total + tenant.shadow, 0),
    ),
    drift_alerts: numberOrZero(
      raw?.drift_alerts ?? tenants.reduce((total, tenant) => total + tenant.drift_alerts, 0),
    ),
  };
}

function normalizeFleetAiModelsPayload(payload: unknown): FleetAiModels {
  const raw = unwrapDataEnvelope(payload as RawFleetAiModels | DataEnvelope<RawFleetAiModels>);
  const tenants = (raw.tenants ?? []).map(normalizeFleetAiTenantRow);
  return {
    generated_at: raw.generated_at,
    summary: normalizeFleetAiSummary(raw.summary ?? raw.kpis, tenants),
    tenants,
    models: (raw.models ?? []).map(normalizeFleetAiModelSlug).filter((model) => model.slug),
  };
}

function normalizeFleetAiDrilldownPayload(payload: unknown): FleetAiModels {
  const raw = unwrapDataEnvelope(payload as RawFleetAiModels | DataEnvelope<RawFleetAiModels>);
  const tenants = (raw.tenants ?? []).map(normalizeFleetAiTenantRow);
  return {
    generated_at: raw.generated_at,
    summary: normalizeFleetAiSummary(raw.summary ?? raw.kpis, tenants),
    tenants,
    models: (raw.models ?? []).map(normalizeFleetAiModelSlug).filter((model) => model.slug),
  };
}

function normalizeFleetAiParams(params?: FleetAiParams): FleetAiParams | undefined {
  if (!params) return undefined;
  const drift =
    params.drift === 'critical'
      ? 'significant'
      : params.drift === 'warning'
        ? 'moderate'
        : params.drift === 'healthy'
          ? undefined
          : params.drift;
  return { ...params, drift };
}

function licenseState(value: unknown): ExpiringLicense['state'] {
  return value === 'in_grace' || value === 'expired' || value === 'suspended'
    ? value
    : 'active';
}

function daysUntil(date: unknown): number {
  if (typeof date !== 'string' || date === '') return 0;
  const expiresAt = Date.parse(date);
  if (!Number.isFinite(expiresAt)) return 0;
  return Math.ceil((expiresAt - Date.now()) / 86_400_000);
}

function graceUntil(expiresAt: unknown, graceDays: unknown): string | null {
  if (typeof expiresAt !== 'string' || expiresAt === '') return null;
  if (typeof graceDays !== 'number' || !Number.isFinite(graceDays) || graceDays <= 0) {
    return null;
  }
  const expires = Date.parse(expiresAt);
  if (!Number.isFinite(expires)) return null;
  return new Date(expires + graceDays * 86_400_000).toISOString();
}

function normalizeExpiringLicense(row: RawExpiringLicense): ExpiringLicense {
  const expiresAt = row.expires_at ?? null;
  return {
    tenant_id: row.tenant_id ?? '',
    tenant_name: row.tenant_name ?? row.tenant_slug ?? row.tenant_id ?? 'Unknown tenant',
    plan_key: row.plan_key ?? '',
    state: licenseState(row.state ?? row.status),
    expires_at: expiresAt ?? '',
    grace_until: row.grace_until ?? graceUntil(expiresAt, row.grace_days),
    days_remaining:
      typeof row.days_remaining === 'number' ? row.days_remaining : daysUntil(expiresAt),
  };
}

function normalizeExpiringLicensesPayload(payload: unknown): ExpiringLicense[] {
  const raw = unwrapDataEnvelope(
    payload as RawExpiringLicense[] | DataEnvelope<RawExpiringLicense[]>,
  );
  return (Array.isArray(raw) ? raw : [])
    .map(normalizeExpiringLicense)
    .filter((row) => row.tenant_id);
}

function normalizeEntitlementKind(kind: unknown): EntitlementKey['kind'] | undefined {
  switch (kind) {
    case 'suite':
    case 'app':
    case 'boolean':
    case 'count':
    case 'seats':
    case 'storage':
    case 'feature':
      return kind;
    case 'seat':
      return 'seats';
    default:
      return undefined;
  }
}

function inferEntitlementKind(key: string): EntitlementKey['kind'] {
  if (key === 'seats.users') return 'seats';
  if (key.startsWith('suite.')) return 'suite';
  if (key.startsWith('app.')) return 'app';
  return 'feature';
}

function entitlementLabel(key: string): string {
  return key
    .split(/[._-]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function normalizeTenantEntitlementsPayload(payload: unknown): TenantEntitlement[] {
  const raw = unwrapDataEnvelope(
    payload as
      | RawTenantEntitlementsResponse
      | RawTenantEntitlement[]
      | DataEnvelope<RawTenantEntitlementsResponse | RawTenantEntitlement[]>,
  );
  const rows = Array.isArray(raw) ? raw : raw.entitlements ?? [];
  return rows
    .map((row) => {
      const key = row.key ?? '';
      const limit =
        typeof row.limit === 'number' || row.limit === null ? row.limit : null;
      const enabled =
        typeof row.enabled === 'boolean'
          ? row.enabled
          : typeof row.allowed === 'boolean'
            ? row.allowed
            : limit !== 0;
      const source: TenantEntitlement['source'] =
        row.source === 'override' ? 'override' : 'plan';
      return {
        key,
        label: row.label ?? entitlementLabel(key),
        kind: normalizeEntitlementKind(row.kind) ?? inferEntitlementKind(key),
        limit,
        used: numberOrZero(row.used),
        source,
        enabled,
      };
    })
    .filter((row) => row.key);
}

function normalizeTenantUsagePayload(payload: unknown): Record<string, { limit: number | null; used: number }> {
  const raw = unwrapDataEnvelope(
    payload as
      | RawTenantUsage[]
      | Record<string, { limit: number | null; used: number }>
      | DataEnvelope<RawTenantUsage[] | Record<string, { limit: number | null; used: number }>>,
  );

  if (Array.isArray(raw)) {
    return raw.reduce<Record<string, { limit: number | null; used: number }>>(
      (acc, row) => {
        const key = row.key ?? row.entitlement_key ?? '';
        if (key) {
          acc[key] = {
            limit: typeof row.limit === 'number' || row.limit === null ? row.limit : null,
            used: numberOrZero(row.used ?? row.value),
          };
        }
        return acc;
      },
      {},
    );
  }

  if (!isRecord(raw)) return {};
  return Object.entries(raw).reduce<Record<string, { limit: number | null; used: number }>>(
    (acc, [key, value]) => {
      if (isRecord(value)) {
        acc[key] = {
          limit:
            typeof value.limit === 'number' || value.limit === null
              ? value.limit
              : null,
          used: numberOrZero(value.used),
        };
      }
      return acc;
    },
    {},
  );
}

function normalizeSeatRollupPayload(payload: unknown): SeatRollup {
  const raw = unwrapDataEnvelope(payload as RawSeatRollup | DataEnvelope<RawSeatRollup>);
  const perTenant = (raw.per_tenant ?? []).map((row) => ({
    tenant_id: row.tenant_id ?? '',
    tenant_name: row.tenant_name ?? row.tenant_id ?? 'Unknown tenant',
    limit: numberOrZero(row.limit),
    used: numberOrZero(row.used),
  }));
  return {
    key: raw.key ?? 'seats.users',
    total_limit: numberOrZero(raw.total_limit),
    total_used: numberOrZero(raw.total_used),
    per_tenant: perTenant.filter((row) => row.tenant_id),
  };
}

function normalizeEntitlementKeysPayload(payload: unknown): EntitlementKey[] {
  const raw = unwrapDataEnvelope(
    payload as RawEntitlementKey[] | DataEnvelope<RawEntitlementKey[]>,
  );
  return (Array.isArray(raw) ? raw : [])
    .map((row) => {
      const key = row.key ?? '';
      return {
        key,
        label: row.label ?? entitlementLabel(key),
        kind: normalizeEntitlementKind(row.kind) ?? inferEntitlementKind(key),
      };
    })
    .filter((row) => row.key);
}

function normalizeAbacSimulatePayload(payload: unknown): AbacSimulateResult {
  const raw = unwrapDataEnvelope(
    payload as RawAbacSimulateResponse | DataEnvelope<RawAbacSimulateResponse>,
  );
  const decision =
    raw.decision === 'allow' || raw.decision === 'deny'
      ? raw.decision
      : raw.allowed
        ? 'allow'
        : 'deny';
  const evaluated =
    raw.evaluated ??
    (raw.matched_policy_id || raw.reason
      ? [
          {
            policy_id: raw.matched_policy_id || 'decision',
            policy_name: raw.matched_policy_name || raw.reason || 'Decision',
            effect: decision,
            matched: Boolean(raw.matched_policy_id || raw.reason),
          },
        ]
      : []);
  return {
    decision,
    matched_policy_id: raw.matched_policy_id || undefined,
    matched_policy_name: raw.matched_policy_name || undefined,
    evaluated,
  };
}

// useApiQuery types its key as string[] for simplicity, but TanStack supports
// arbitrary serializable members (objects/numbers) for cache scoping. qk() builds
// such a key and satisfies the hook's string[] signature without losing scoping.
function qk(...parts: unknown[]): string[] {
  return parts as unknown as string[];
}

// Query-key roots — exported so screens can scope manual invalidations.
export const platformKeys = {
  fleet: ['platform', 'fleet'] as const,
  tenants: ['platform', 'tenants'] as const,
  licensing: ['platform', 'licensing'] as const,
  identity: ['platform', 'identity'] as const,
  abac: ['platform', 'abac'] as const,
  gateway: ['platform', 'gateway'] as const,
  audit: ['platform', 'audit'] as const,
  provisioning: ['platform', 'provisioning'] as const,
  ai: ['platform', 'ai'] as const,
} as const;

// Common list-filter shape accepted by the gap list endpoints.
export interface PlatformListParams {
  search?: string;
  status?: string[];
  tier?: string[];
  plan_key?: string;
  sort?: string;
  order?: 'asc' | 'desc';
  page?: number;
  per_page?: number;
  [key: string]: unknown;
}

// ── G1 / G1b — Fleet health ───────────────────────────────────────────────────

/** G1 — full fleet health grid. Refetch 30s, staleTime 10s. */
export function useFleetHealth() {
  return useApiQuery<FleetHealth>(
    [...platformKeys.fleet, 'health'],
    '/api/v1/platform/fleet/health',
    { refetchInterval: 30_000, staleTime: 10_000 },
  );
}

/** G1b — lightweight summary poll for header/badge. */
export function useFleetSummary() {
  return useApiQuery<FleetHealthSummary>(
    [...platformKeys.fleet, 'summary'],
    '/api/v1/platform/fleet/summary',
    { refetchInterval: 30_000, staleTime: 10_000 },
  );
}

// ── G2 / G3 — Admin tenant list + overview rollup ─────────────────────────────

/** G2 — cross-tenant admin list with aggregates. Refetch 60s. */
export function useAdminTenants(params?: PlatformListParams) {
  return useApiQuery<PaginatedResponse<AdminTenantSummary>>(
    qk(...platformKeys.tenants, 'list', params ?? {}),
    '/api/v1/admin/tenants',
    { refetchInterval: 60_000, requestConfig: { params } },
  );
}

/**
 * G2b — single admin tenant summary by id. Returns the SAME AdminTenantSummary
 * shape as one row of useAdminTenants, but fetched directly so the Tenant Detail
 * page resolves its lifecycle status + slug reliably regardless of which list
 * page is cached. Shares the platformKeys.tenants prefix so lifecycle-action
 * invalidations (suspend/unsuspend/impersonate) also refresh this detail row.
 */
export function useAdminTenant(tenantId: string, enabled = true) {
  return useApiQuery<AdminTenantSummary>(
    [...platformKeys.tenants, 'detail', tenantId],
    `/api/v1/admin/tenants/${tenantId}`,
    {
      enabled: enabled && Boolean(tenantId),
      refetchInterval: 60_000,
      select: (payload) => unwrapQueryData<AdminTenantSummary>(payload),
    },
  );
}

/** G3 — estate-wide tenant rollup for Overview KPIs. */
export function usePlatformTenantsSummary() {
  return useApiQuery<PlatformTenantsSummary>(
    [...platformKeys.tenants, 'summary'],
    '/api/v1/platform/tenants/summary',
    { refetchInterval: 60_000 },
  );
}

// ── G4 — Real suspend / unsuspend (destructive) ───────────────────────────────

export interface SuspendVars {
  tenantId: string;
  reason: string;
}

/** G4 — real suspend (revokes sessions + keys). Invalidates the tenant list. */
export function useSuspendTenant() {
  const qc = useQueryClient();
  return useApiMutation<void, SuspendVars>(
    '/api/v1/admin/tenants/:id/suspend',
    'post',
    {
      mutationFn: async (vars) => {
        const { default: api } = await import('@/lib/api');
        await api.post(`/api/v1/admin/tenants/${vars.tenantId}/suspend`, {
          reason: vars.reason,
        });
      },
      onSuccess: () => qc.invalidateQueries({ queryKey: platformKeys.tenants }),
    },
  );
}

/** G4 — unsuspend. */
export function useUnsuspendTenant() {
  const qc = useQueryClient();
  return useApiMutation<void, { tenantId: string }>(
    '/api/v1/admin/tenants/:id/unsuspend',
    'post',
    {
      mutationFn: async (vars) => {
        const { default: api } = await import('@/lib/api');
        await api.post(`/api/v1/admin/tenants/${vars.tenantId}/unsuspend`, {});
      },
      onSuccess: () => qc.invalidateQueries({ queryKey: platformKeys.tenants }),
    },
  );
}

// ── G5 — Impersonation (security-sensitive) ───────────────────────────────────

export interface ImpersonateVars extends ImpersonateRequest {
  tenantId: string;
  tenantName?: string;
}

/**
 * G5 — mint a short-TTL "view as tenant" grant, store it (impersonation-store),
 * and return the raw mutation. The store override makes the axios interceptor
 * send the impersonation token on every subsequent call. Pair with
 * useStopImpersonation() to end the session (and write the stop audit).
 */
export function useImpersonate() {
  const start = useImpersonationStore((s) => s.start);
  const qc = useQueryClient();
  return useApiMutation<ImpersonationGrant, ImpersonateVars>(
    '/api/v1/admin/tenants/:id/impersonate',
    'post',
    {
      mutationFn: async (vars) => {
        const { default: api } = await import('@/lib/api');
        const { data } = await api.post<ImpersonationGrant>(
          `/api/v1/admin/tenants/${vars.tenantId}/impersonate`,
          { target_user_id: vars.target_user_id, reason: vars.reason, ttl: vars.ttl },
        );
        return data;
      },
      onSuccess: (grant, vars) => {
        start({
          token: grant.access_token,
          tenantId: grant.tenant_id ?? vars.tenantId,
          tenantName: grant.tenant_name ?? vars.tenantName ?? null,
          userId: grant.impersonated_user_id ?? null,
          expiresAt: grant.expires_at,
        });
        // Refetch everything under the impersonated identity.
        qc.invalidateQueries();
      },
    },
  );
}

/**
 * Stop the active impersonation. Best-effort POSTs the stop endpoint (which
 * writes the mandatory `tenant.impersonation.stopped` audit) BEFORE clearing the
 * store, so the stop call is still made with the impersonation token, then
 * clears local state regardless of the call's outcome and refetches as operator.
 */
export function useStopImpersonation() {
  const stop = useImpersonationStore((s) => s.stop);
  const tenantId = useImpersonationStore((s) => s.tenantId);
  const qc = useQueryClient();
  return async () => {
    if (tenantId) {
      try {
        const { default: api } = await import('@/lib/api');
        await api.post(`/api/v1/admin/tenants/${tenantId}/impersonate/stop`, {});
      } catch {
        // Non-fatal: always clear local state so the operator regains control.
      }
    }
    stop();
    qc.invalidateQueries();
  };
}

// ── G6 — Cross-tenant user search (Identity) ──────────────────────────────────

export interface UserSearchParams {
  email?: string;
  query?: string;
  tenant_id?: string;
  status?: string;
  page?: number;
  per_page?: number;
}

/** G6 — cross-tenant user lookup. Disabled until a query/email is provided. */
export function useAdminUserSearch(params: UserSearchParams, enabled = true) {
  const hasQuery = Boolean(params.email || params.query || params.tenant_id);
  return useApiQuery<PaginatedResponse<AdminUserSummary>>(
    qk(...platformKeys.identity, 'users', params),
    '/api/v1/admin/users/search',
    { enabled: enabled && hasQuery, requestConfig: { params } },
  );
}

// ── G7 / G8 — Fleet licenses + expiries (Licensing) ───────────────────────────

/** G7 — every tenant's license in one call. */
export function useFleetLicenses(params?: PlatformListParams) {
  return useApiQuery<PaginatedResponse<FleetLicenseRow>>(
    qk(...platformKeys.licensing, 'tenants', params ?? {}),
    '/api/v1/licensing/admin/tenants',
    { refetchInterval: 60_000, requestConfig: { params } },
  );
}

/** G8 — licenses expiring / in grace / expired. Refetch 5 min. */
export function useExpiringLicenses(withinDays = 30) {
  return useApiQuery<ExpiringLicense[]>(
    qk(...platformKeys.licensing, 'expiring', withinDays),
    '/api/v1/licensing/admin/licenses/expiring',
    {
      refetchInterval: 300_000,
      requestConfig: { params: { within_days: withinDays } },
      select: (payload) => normalizeExpiringLicensesPayload(payload),
    },
  );
}

// ── G9 — Entitlement overrides (read) ─────────────────────────────────────────

/** G9 — list a tenant's entitlement overrides. */
export function useTenantOverrides(tenantId: string, enabled = true) {
  return useApiQuery<Override[]>(
    [...platformKeys.licensing, 'overrides', tenantId],
    `/api/v1/licensing/admin/tenants/${tenantId}/overrides`,
    {
      enabled: enabled && Boolean(tenantId),
      select: (payload) => unwrapQueryData<Override[]>(payload),
    },
  );
}

// ── G10 — Tenant entitlements + usage ─────────────────────────────────────────

/** G10 — resolved entitlements a tenant holds (Suites tab). */
export function useTenantEntitlements(tenantId: string, enabled = true) {
  return useApiQuery<TenantEntitlement[]>(
    [...platformKeys.licensing, 'entitlements', tenantId],
    `/api/v1/licensing/admin/tenants/${tenantId}/entitlements`,
    {
      enabled: enabled && Boolean(tenantId),
      select: (payload) => normalizeTenantEntitlementsPayload(payload),
    },
  );
}

/** G10 — a tenant's usage counters (admin read). */
export function useTenantUsageAdmin(tenantId: string, period?: string, enabled = true) {
  return useApiQuery<Record<string, { limit: number | null; used: number }>>(
    [...platformKeys.licensing, 'usage', tenantId, period ?? 'current'],
    `/api/v1/licensing/admin/tenants/${tenantId}/usage`,
    {
      enabled: enabled && Boolean(tenantId),
      requestConfig: { params: { period } },
      select: (payload) => normalizeTenantUsagePayload(payload),
    },
  );
}

// ── G11 — Seat / usage rollup (Overview + Licensing) ──────────────────────────

/** G11 — cross-tenant seat rollup. */
export function useSeatRollup(key = 'seats.users', period?: string) {
  return useApiQuery<SeatRollup>(
    [...platformKeys.licensing, 'rollup', key, period ?? 'current'],
    '/api/v1/licensing/admin/usage/rollup',
    {
      refetchInterval: 60_000,
      requestConfig: { params: { key, period } },
      select: (payload) => normalizeSeatRollupPayload(payload),
    },
  );
}

// ── G12 — Entitlement key registry (Suites) ───────────────────────────────────

/** G12 — canonical entitlement-key catalog. Long-lived; staleTime 5 min. */
export function useEntitlementKeys() {
  return useApiQuery<EntitlementKey[]>(
    [...platformKeys.licensing, 'entitlement-keys'],
    '/api/v1/licensing/admin/entitlement-keys',
    {
      staleTime: 300_000,
      select: (payload) => normalizeEntitlementKeysPayload(payload),
    },
  );
}

// ── License assign / override mutations (EXISTS endpoints) ─────────────────────

export interface AssignLicenseVars {
  tenantId: string;
  plan_key: string;
  seats?: number;
  expires_at?: string | null;
}

/** Assign / change a tenant's license plan (POST .../tenants/{id}/license). */
export function useAssignLicense() {
  const qc = useQueryClient();
  return useApiMutation<void, AssignLicenseVars>(
    '/api/v1/licensing/admin/tenants/:id/license',
    'post',
    {
      mutationFn: async (vars) => {
        const { default: api } = await import('@/lib/api');
        await api.post(`/api/v1/licensing/admin/tenants/${vars.tenantId}/license`, {
          plan_key: vars.plan_key,
          seats: vars.seats,
          expires_at: vars.expires_at,
        });
      },
      onSuccess: () => qc.invalidateQueries({ queryKey: platformKeys.licensing }),
    },
  );
}

export interface SetOverrideVars {
  tenantId: string;
  key: string;
  limit: number;
  reason?: string;
}

/** Set an entitlement override (PUT .../overrides/{key}); limit 0 == revoke. */
export function useSetOverride() {
  const qc = useQueryClient();
  return useApiMutation<void, SetOverrideVars>(
    '/api/v1/licensing/admin/tenants/:id/overrides/:key',
    'put',
    {
      mutationFn: async (vars) => {
        const { default: api } = await import('@/lib/api');
        await api.put(
          `/api/v1/licensing/admin/tenants/${vars.tenantId}/overrides/${vars.key}`,
          { limit: vars.limit, reason: vars.reason },
        );
      },
      onSuccess: () => qc.invalidateQueries({ queryKey: platformKeys.licensing }),
    },
  );
}

/** Remove an entitlement override (DELETE .../overrides/{key}); restores plan default. */
export function useRemoveOverride() {
  const qc = useQueryClient();
  return useApiMutation<void, { tenantId: string; key: string }>(
    '/api/v1/licensing/admin/tenants/:id/overrides/:key',
    'delete',
    {
      mutationFn: async (vars) => {
        const { default: api } = await import('@/lib/api');
        await api.delete(
          `/api/v1/licensing/admin/tenants/${vars.tenantId}/overrides/${vars.key}`,
        );
      },
      onSuccess: () => qc.invalidateQueries({ queryKey: platformKeys.licensing }),
    },
  );
}

// ── G13 — Gateway route map (Suites/Services) ─────────────────────────────────

/** G13 — compiled gateway route → entitlement map. Long-lived. */
export function useGatewayRoutes() {
  return useApiQuery<GatewayRoute[]>(
    [...platformKeys.gateway, 'routes'],
    '/api/v1/gateway/admin/routes',
    { staleTime: 300_000 },
  );
}

// ── G14 — Cross-tenant audit (Audit) ──────────────────────────────────────────

export interface AuditQueryParams {
  all_tenants?: boolean;
  tenant_id?: string;
  /** Cross-tenant actor alias for user_id (backend: dto/admin_dto.go accepts `actor`). */
  actor?: string;
  /** Source service slug, e.g. `iam-service` (backend: dto/admin_dto.go accepts `service`). */
  service?: string;
  severity?: string;
  action?: string;
  date_from?: string;
  date_to?: string;
  page?: number;
  per_page?: number;
  [key: string]: unknown;
}

/** G14 — fleet-wide audit log query. */
export function usePlatformAuditLogs(params?: AuditQueryParams) {
  return useApiQuery<PaginatedResponse<AuditAdminLog>>(
    qk(...platformKeys.audit, 'logs', params ?? {}),
    '/api/v1/audit/admin/logs',
    { requestConfig: { params: { all_tenants: true, ...params } } },
  );
}

// ── G18 — Circuit breakers (Services) ─────────────────────────────────────────

/** G18 — read all circuit-breaker states. Refetch 30s. */
export function useCircuitBreakers() {
  return useApiQuery<CircuitBreakerState[]>(
    [...platformKeys.gateway, 'circuit'],
    '/api/v1/gateway/admin/circuit',
    { refetchInterval: 30_000 },
  );
}

/** G18 — force a breaker open/close/reset (destructive). */
export function useSetCircuitBreaker() {
  const qc = useQueryClient();
  return useApiMutation<void, { service: string; action: CircuitAction }>(
    '/api/v1/gateway/admin/circuit/:service',
    'post',
    {
      mutationFn: async (vars) => {
        const { default: api } = await import('@/lib/api');
        await api.post(`/api/v1/gateway/admin/circuit/${vars.service}`, {
          action: vars.action,
        });
      },
      onSuccess: () =>
        qc.invalidateQueries({ queryKey: [...platformKeys.gateway, 'circuit'] }),
    },
  );
}

// ── G19 — Kill switches (Services) ────────────────────────────────────────────

/** G19 — list kill switches / feature flags. */
export function useKillSwitches() {
  return useApiQuery<KillSwitch[]>(
    [...platformKeys.gateway, 'killswitch'],
    '/api/v1/gateway/admin/killswitch',
    { refetchInterval: 30_000 },
  );
}

/** G19 — set a kill switch (destructive). */
export function useSetKillSwitch() {
  const qc = useQueryClient();
  return useApiMutation<void, { key: string; enabled: boolean; reason?: string }>(
    '/api/v1/gateway/admin/killswitch',
    'post',
    {
      onSuccess: () =>
        qc.invalidateQueries({ queryKey: [...platformKeys.gateway, 'killswitch'] }),
    },
  );
}

// ── G20 — Rate limits (Services) ──────────────────────────────────────────────

/** G20 — read runtime rate-limit config (global + per-tenant overrides). */
export function useRateLimits() {
  return useApiQuery<RateLimitConfig[]>(
    [...platformKeys.gateway, 'ratelimits'],
    '/api/v1/gateway/admin/ratelimits',
    { refetchInterval: 60_000 },
  );
}

/** G20 — set the global or per-tenant rate limit. */
export function useSetRateLimit() {
  const qc = useQueryClient();
  return useApiMutation<void, RateLimitConfig>(
    '/api/v1/gateway/admin/ratelimits',
    'put',
    {
      mutationFn: async (vars) => {
        const { default: api } = await import('@/lib/api');
        const url = vars.tenant_id
          ? `/api/v1/gateway/admin/ratelimits/tenants/${vars.tenant_id}`
          : '/api/v1/gateway/admin/ratelimits';
        await api.put(url, vars);
      },
      onSuccess: () =>
        qc.invalidateQueries({ queryKey: [...platformKeys.gateway, 'ratelimits'] }),
    },
  );
}

// ── G22 — ABAC policies CRUD + simulate (Identity) ────────────────────────────

/** G22 — list ABAC policies. */
export function useAbacPolicies() {
  return useApiQuery<AbacPolicy[]>(
    [...platformKeys.abac, 'list'],
    '/api/v1/abac/policies',
    { select: (payload) => unwrapQueryData<AbacPolicy[]>(payload) },
  );
}

/** G22 — single ABAC policy. */
export function useAbacPolicy(id: string, enabled = true) {
  return useApiQuery<AbacPolicy>(
    [...platformKeys.abac, 'detail', id],
    `/api/v1/abac/policies/${id}`,
    {
      enabled: enabled && Boolean(id),
      select: (payload) => unwrapQueryData<AbacPolicy>(payload),
    },
  );
}

/** G22 — create an ABAC policy. */
export function useCreateAbacPolicy() {
  const qc = useQueryClient();
  return useApiMutation<AbacPolicy, Partial<AbacPolicy>>(
    '/api/v1/abac/policies',
    'post',
    {
      mutationFn: async (vars) => {
        const { default: api } = await import('@/lib/api');
        const { data } = await api.post<AbacPolicy | DataEnvelope<AbacPolicy>>(
          '/api/v1/abac/policies',
          vars,
        );
        return unwrapDataEnvelope<AbacPolicy>(data);
      },
      onSuccess: () => qc.invalidateQueries({ queryKey: platformKeys.abac }),
    },
  );
}

/** G22 — full update (PUT) of an ABAC policy. */
export function useUpdateAbacPolicy() {
  const qc = useQueryClient();
  return useApiMutation<AbacPolicy, { id: string; data: Partial<AbacPolicy> }>(
    '/api/v1/abac/policies/:id',
    'put',
    {
      mutationFn: async (vars) => {
        const { default: api } = await import('@/lib/api');
        const { data } = await api.put<AbacPolicy | DataEnvelope<AbacPolicy>>(
          `/api/v1/abac/policies/${vars.id}`,
          vars.data,
        );
        return unwrapDataEnvelope<AbacPolicy>(data);
      },
      onSuccess: () => qc.invalidateQueries({ queryKey: platformKeys.abac }),
    },
  );
}

/** G22 — partial update (PATCH), e.g. toggle enabled. */
export function usePatchAbacPolicy() {
  const qc = useQueryClient();
  return useApiMutation<AbacPolicy, { id: string; data: Partial<AbacPolicy> }>(
    '/api/v1/abac/policies/:id',
    'patch',
    {
      mutationFn: async (vars) => {
        const { default: api } = await import('@/lib/api');
        const { data } = await api.patch<AbacPolicy | DataEnvelope<AbacPolicy>>(
          `/api/v1/abac/policies/${vars.id}`,
          vars.data,
        );
        return unwrapDataEnvelope<AbacPolicy>(data);
      },
      onSuccess: () => qc.invalidateQueries({ queryKey: platformKeys.abac }),
    },
  );
}

/** G22 — delete an ABAC policy. */
export function useDeleteAbacPolicy() {
  const qc = useQueryClient();
  return useApiMutation<void, { id: string }>(
    '/api/v1/abac/policies/:id',
    'delete',
    {
      mutationFn: async (vars) => {
        const { default: api } = await import('@/lib/api');
        await api.delete(`/api/v1/abac/policies/${vars.id}`);
      },
      onSuccess: () => qc.invalidateQueries({ queryKey: platformKeys.abac }),
    },
  );
}

/** G22 — simulate a subject/resource/action against the policy set. */
export function useAbacSimulate() {
  return useApiMutation<AbacSimulateResult, AbacSimulateRequest>(
    '/api/v1/abac/policies/simulate',
    'post',
    {
      mutationFn: async (vars) => {
        const { default: api } = await import('@/lib/api');
        const { data } = await api.post<
          RawAbacSimulateResponse | DataEnvelope<RawAbacSimulateResponse>
        >('/api/v1/abac/policies/simulate', vars);
        return normalizeAbacSimulatePayload(data);
      },
    },
  );
}

// ── G23 — AI fleet rollup (AI Governance) ─────────────────────────────────────

export interface FleetAiParams {
  suite?: string;
  drift?: string;
  risk_tier?: string;
  [key: string]: unknown;
}

/** G23 — cross-tenant AI model rollup. */
export function useFleetAiModels(params?: FleetAiParams) {
  const requestParams = normalizeFleetAiParams(params);
  return useApiQuery<FleetAiModels>(
    qk(...platformKeys.ai, 'models', params ?? {}),
    '/api/v1/admin/ai/fleet/models',
    {
      refetchInterval: 60_000,
      requestConfig: { params: requestParams },
      select: (payload) => normalizeFleetAiModelsPayload(payload),
    },
  );
}

/** G23 — per-model-slug fleet drill-down. */
export function useFleetAiModelSlug(slug: string, enabled = true) {
  return useApiQuery<FleetAiModels>(
    [...platformKeys.ai, 'models', 'slug', slug],
    `/api/v1/admin/ai/fleet/models/${slug}`,
    {
      enabled: enabled && Boolean(slug),
      select: (payload) => normalizeFleetAiDrilldownPayload(payload),
    },
  );
}

/** G23 — per-tenant AI summary (tenant detail AI tab). */
export function useTenantAiSummary(tenantId: string, enabled = true) {
  return useApiQuery<AIDashboardData>(
    [...platformKeys.ai, 'tenant', tenantId],
    `/api/v1/admin/tenants/${tenantId}/ai-summary`,
    {
      enabled: enabled && Boolean(tenantId),
      select: (payload) =>
        unwrapDataEnvelope<AIDashboardData>(
          payload as AIDashboardData | DataEnvelope<AIDashboardData>,
        ),
    },
  );
}

// ── G24 — Provisioning oversight (Provisioning) ───────────────────────────────

/**
 * G24 — tenants currently in provisioning. The ticker should poll 10s only while
 * something is in flight; pass `pollWhileActive` to enable that cadence.
 */
export function useProvisioningQueue(
  status = 'in_flight',
  pollWhileActive = false,
) {
  return useApiQuery<ProvisioningItem[]>(
    [...platformKeys.provisioning, 'queue', status],
    '/api/v1/admin/provisioning',
    {
      requestConfig: { params: { status } },
      refetchInterval: pollWhileActive ? 10_000 : false,
      select: (payload) => unwrapQueryData<ProvisioningItem[]>(payload),
    },
  );
}
