import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import {
  useFleetHealth,
  useAdminTenants,
  useExpiringLicenses,
  useAbacPolicies,
  useAbacSimulate,
  useEntitlementKeys,
  usePlatformAuditLogs,
  useFleetAiModelSlug,
  useFleetAiModels,
  useProvisioningQueue,
  useSeatRollup,
  useTenantAiSummary,
  useTenantEntitlements,
  useTenantOverrides,
  useTenantUsageAdmin,
} from './use-platform';

// Gateway base URL: mirrors getApiUrl()'s dev default (env.ts) and the jsdom
// origin configured in vitest.config.ts. The axios `api` instance resolves all
// relative paths against this base, so MSW must register absolute URLs here.
const API_URL = 'http://localhost:8080';

// Capture what the hook's request actually looked like so we can assert on the
// resolved URL/method/query params, then return a representative payload that
// the hook should surface as `.data`.
interface CapturedRequest {
  method: string;
  pathname: string;
  search: URLSearchParams;
}

let captured: CapturedRequest | null = null;

function capture(request: Request): void {
  const url = new URL(request.url);
  captured = {
    method: request.method,
    pathname: url.pathname,
    search: url.searchParams,
  };
}

const server = setupServer(
  http.get(`${API_URL}/api/v1/platform/fleet/health`, ({ request }) => {
    capture(request);
    return HttpResponse.json({
      services: [{ name: 'iam-service', status: 'healthy' }],
      generated_at: '2026-06-22T00:00:00Z',
    });
  }),

  http.get(`${API_URL}/api/v1/admin/tenants`, ({ request }) => {
    capture(request);
    return HttpResponse.json({
      data: [{ id: 'tenant-1', name: 'Acme' }],
      pagination: { page: 1, per_page: 20, total: 1, total_pages: 1 },
    });
  }),

  http.get(
    `${API_URL}/api/v1/licensing/admin/licenses/expiring`,
    ({ request }) => {
      capture(request);
      return HttpResponse.json({
        data: [
          {
            tenant_id: 'tenant-1',
            plan_key: 'pro',
            status: 'active',
            state: 'active',
            expires_at: '2026-07-01T00:00:00Z',
            grace_days: 7,
          },
        ],
      });
    },
  ),

  http.get(
    `${API_URL}/api/v1/licensing/admin/tenants/tenant-1/overrides`,
    ({ request }) => {
      capture(request);
      return HttpResponse.json({
        data: [{ tenant_id: 'tenant-1', key: 'app.acta', limit: 0, reason: 'blocked' }],
      });
    },
  ),

  http.get(
    `${API_URL}/api/v1/licensing/admin/tenants/tenant-1/entitlements`,
    ({ request }) => {
      capture(request);
      return HttpResponse.json({
        data: {
          license_state: 'active',
          entitlements: [
            {
              allowed: true,
              key: 'seats.users',
              limit: 10,
              used: 3,
            },
            {
              allowed: false,
              key: 'app.acta',
              limit: 0,
              used: 0,
            },
          ],
        },
      });
    },
  ),

  http.get(
    `${API_URL}/api/v1/licensing/admin/tenants/tenant-1/usage`,
    ({ request }) => {
      capture(request);
      return HttpResponse.json({
        data: [{ tenant_id: 'tenant-1', key: 'seats.users', used: 4 }],
      });
    },
  ),

  http.get(`${API_URL}/api/v1/licensing/admin/usage/rollup`, ({ request }) => {
    capture(request);
    return HttpResponse.json({
      data: {
        key: 'seats.users',
        period: '2026-06',
        total_limit: 12,
        total_used: 4,
        per_tenant: [{ tenant_id: 'tenant-1', limit: 12, used: 4 }],
      },
    });
  }),

  http.get(`${API_URL}/api/v1/licensing/admin/entitlement-keys`, ({ request }) => {
    capture(request);
    return HttpResponse.json({
      data: [
        { key: 'suite.cyber', label: 'Cyber Suite', kind: 'suite' },
        { key: 'seats.users', label: 'User Seats', kind: 'seat' },
      ],
    });
  }),

  http.get(`${API_URL}/api/v1/abac/policies`, ({ request }) => {
    capture(request);
    return HttpResponse.json({
      data: [{ id: 'pol-1', name: 'allow-admins', enabled: true }],
    });
  }),

  http.post(`${API_URL}/api/v1/abac/policies/simulate`, async ({ request }) => {
    capture(request);
    await request.json();
    return HttpResponse.json({
      data: {
        allowed: false,
        reason: 'deny policy matched',
        matched_policy_id: 'pol-1',
      },
    });
  }),

  http.get(`${API_URL}/api/v1/audit/admin/logs`, ({ request }) => {
    capture(request);
    return HttpResponse.json({
      data: [{ id: 'log-1', action: 'tenant.suspend', tenant_id: 'tenant-1' }],
      pagination: { page: 1, per_page: 20, total: 1, total_pages: 1 },
    });
  }),

  http.get(`${API_URL}/api/v1/admin/ai/fleet/models`, ({ request }) => {
    capture(request);
    return HttpResponse.json({
      data: {
        kpis: {
          total_tenants: 2,
          total_models: 6,
          in_production: 4,
          shadow_testing: 1,
          drift_alerts: 3,
        },
        tenants: [
          {
            tenant_id: 'tenant-1',
            tenant_name: 'Acme',
            model_count: 3,
            production_versions: 2,
            shadow_versions: 1,
            open_drift_alerts: 3,
            worst_drift_level: 'significant',
          },
          {
            tenant_id: 'tenant-2',
            tenant_name: 'Beta',
            model_count: 3,
            production_versions: 2,
            shadow_versions: 0,
            open_drift_alerts: 0,
            worst_drift_level: 'low',
          },
        ],
        models: [
          {
            slug: 'risk-engine',
            display_name: 'Risk Engine',
            suite: 'cyber',
            tenants_using: 2,
            in_production: 2,
            shadow: 1,
            drift_alerts: 1,
            risk_tier: 'high',
          },
        ],
      },
    });
  }),

  http.get(`${API_URL}/api/v1/admin/ai/fleet/models/risk-engine`, ({ request }) => {
    capture(request);
    return HttpResponse.json({
      data: {
        slug: 'risk-engine',
        tenants: [
          {
            tenant_id: 'tenant-1',
            tenant_name: 'Acme',
            production_version: { id: 'prod-v1' },
            shadow_version: null,
            drift_status: 'moderate',
            drift_alerts: 2,
          },
        ],
      },
    });
  }),

  http.get(`${API_URL}/api/v1/admin/tenants/tenant-1/ai-summary`, ({ request }) => {
    capture(request);
    return HttpResponse.json({
      data: {
        kpis: {
          total_models: 7,
          in_production: 5,
          shadow_testing: 2,
          predictions_24h: 41,
          drift_alerts: 1,
        },
        models: [],
      },
    });
  }),

  http.get(`${API_URL}/api/v1/admin/provisioning`, ({ request }) => {
    capture(request);
    return HttpResponse.json({
      data: [
        {
          tenant_id: 'tenant-1',
          tenant_name: 'Acme',
          status: 'provisioning',
          progress_pct: 50,
        },
      ],
    });
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  captured = null;
});
afterAll(() => server.close());

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('use-platform hooks', () => {
  it('useFleetHealth (G1) GETs the fleet health endpoint and surfaces data', async () => {
    const { result } = renderHook(() => useFleetHealth(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(captured?.method).toBe('GET');
    expect(captured?.pathname).toBe('/api/v1/platform/fleet/health');
    expect(result.current.data).toEqual({
      services: [{ name: 'iam-service', status: 'healthy' }],
      generated_at: '2026-06-22T00:00:00Z',
    });
  });

  it('useAdminTenants (G2) GETs the admin tenants list and passes list params as query', async () => {
    const { result } = renderHook(
      () => useAdminTenants({ search: 'acme', page: 2, per_page: 25 }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(captured?.method).toBe('GET');
    expect(captured?.pathname).toBe('/api/v1/admin/tenants');
    expect(captured?.search.get('search')).toBe('acme');
    expect(captured?.search.get('page')).toBe('2');
    expect(captured?.search.get('per_page')).toBe('25');
    expect(result.current.data?.data).toHaveLength(1);
    expect(result.current.data?.data[0]).toMatchObject({ id: 'tenant-1', name: 'Acme' });
  });

  it('useExpiringLicenses (G8) GETs the expiring endpoint with within_days param', async () => {
    const { result } = renderHook(() => useExpiringLicenses(45), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(captured?.method).toBe('GET');
    expect(captured?.pathname).toBe('/api/v1/licensing/admin/licenses/expiring');
    expect(captured?.search.get('within_days')).toBe('45');
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0]).toMatchObject({
      tenant_id: 'tenant-1',
      tenant_name: 'tenant-1',
      plan_key: 'pro',
      state: 'active',
      grace_until: '2026-07-08T00:00:00.000Z',
    });
  });

  it('licensing hooks unwrap suite envelopes and normalize tenant usage shapes', async () => {
    const wrapper = createWrapper();
    const overrides = renderHook(() => useTenantOverrides('tenant-1'), { wrapper });
    const entitlements = renderHook(() => useTenantEntitlements('tenant-1'), { wrapper });
    const usage = renderHook(() => useTenantUsageAdmin('tenant-1'), { wrapper });
    const rollup = renderHook(() => useSeatRollup('seats.users'), { wrapper });
    const keys = renderHook(() => useEntitlementKeys(), { wrapper });

    await waitFor(() => expect(overrides.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(entitlements.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(usage.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(rollup.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(keys.result.current.isSuccess).toBe(true));

    expect(overrides.result.current.data?.[0]).toMatchObject({
      key: 'app.acta',
      limit: 0,
    });
    expect(entitlements.result.current.data?.[0]).toMatchObject({
      key: 'seats.users',
      label: 'Seats Users',
      kind: 'seats',
      source: 'plan',
      enabled: true,
      used: 3,
    });
    expect(entitlements.result.current.data?.[1]).toMatchObject({
      key: 'app.acta',
      enabled: false,
    });
    expect(usage.result.current.data).toEqual({
      'seats.users': { limit: null, used: 4 },
    });
    expect(rollup.result.current.data).toMatchObject({
      total_limit: 12,
      total_used: 4,
      per_tenant: [{ tenant_id: 'tenant-1', tenant_name: 'tenant-1', limit: 12, used: 4 }],
    });
    expect(keys.result.current.data).toEqual([
      { key: 'suite.cyber', label: 'Cyber Suite', kind: 'suite' },
      { key: 'seats.users', label: 'User Seats', kind: 'seats' },
    ]);
  });

  it('useAbacPolicies (G22) GETs the ABAC policies list and surfaces the array', async () => {
    const { result } = renderHook(() => useAbacPolicies(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(captured?.method).toBe('GET');
    expect(captured?.pathname).toBe('/api/v1/abac/policies');
    expect(result.current.data).toEqual([
      { id: 'pol-1', name: 'allow-admins', enabled: true },
    ]);
  });

  it('useAbacSimulate (G22) unwraps backend decision payloads', async () => {
    const { result } = renderHook(() => useAbacSimulate(), { wrapper: createWrapper() });

    let response: Awaited<ReturnType<typeof result.current.mutateAsync>> | undefined;
    await act(async () => {
      response = await result.current.mutateAsync({
        action: 'impersonate',
        resource_type: 'platform.tenant',
        subject: { role: 'admin' },
        resource: { tenant_id: 'tenant-1' },
      });
    });

    expect(captured?.method).toBe('POST');
    expect(captured?.pathname).toBe('/api/v1/abac/policies/simulate');
    expect(response).toMatchObject({
      decision: 'deny',
      matched_policy_id: 'pol-1',
      evaluated: [
        {
          policy_id: 'pol-1',
          policy_name: 'deny policy matched',
          effect: 'deny',
          matched: true,
        },
      ],
    });
  });

  it('usePlatformAuditLogs (G14) GETs cross-tenant logs with all_tenants=true default', async () => {
    const { result } = renderHook(
      () => usePlatformAuditLogs({ action: 'tenant.suspend' }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(captured?.method).toBe('GET');
    expect(captured?.pathname).toBe('/api/v1/audit/admin/logs');
    // Hook merges { all_tenants: true } with caller params (see usePlatformAuditLogs).
    expect(captured?.search.get('all_tenants')).toBe('true');
    expect(captured?.search.get('action')).toBe('tenant.suspend');
    expect(result.current.data?.data[0]).toMatchObject({ id: 'log-1', action: 'tenant.suspend' });
  });

  it('useFleetAiModels (G23) normalizes backend kpis and tenant rollup fields', async () => {
    const { result } = renderHook(() => useFleetAiModels({ drift: 'critical' }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(captured?.method).toBe('GET');
    expect(captured?.pathname).toBe('/api/v1/admin/ai/fleet/models');
    expect(captured?.search.get('drift')).toBe('significant');
    expect(result.current.data?.summary).toMatchObject({
      total_tenants: 2,
      total_models: 6,
      in_production: 4,
      shadow: 1,
      drift_alerts: 3,
    });
    expect(result.current.data?.tenants[0]).toMatchObject({
      tenant_id: 'tenant-1',
      total_models: 3,
      in_production: 2,
      shadow: 1,
      drift_alerts: 3,
      drift_health: 'critical',
    });
    expect(result.current.data?.models?.[0]).toMatchObject({
      slug: 'risk-engine',
      tenants_using: 2,
      shadow: 1,
    });
  });

  it('useFleetAiModelSlug (G23) computes drilldown summary from backend tenant rows', async () => {
    const { result } = renderHook(() => useFleetAiModelSlug('risk-engine'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(captured?.method).toBe('GET');
    expect(captured?.pathname).toBe('/api/v1/admin/ai/fleet/models/risk-engine');
    expect(result.current.data?.summary).toMatchObject({
      total_tenants: 1,
      in_production: 1,
      shadow: 0,
      drift_alerts: 2,
    });
    expect(result.current.data?.tenants[0]).toMatchObject({
      tenant_id: 'tenant-1',
      drift_health: 'warning',
    });
  });

  it('useTenantAiSummary (G23) unwraps the per-tenant dashboard payload', async () => {
    const { result } = renderHook(() => useTenantAiSummary('tenant-1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(captured?.method).toBe('GET');
    expect(captured?.pathname).toBe('/api/v1/admin/tenants/tenant-1/ai-summary');
    expect(result.current.data?.kpis).toMatchObject({
      total_models: 7,
      in_production: 5,
      shadow_testing: 2,
      drift_alerts: 1,
    });
  });

  it('useProvisioningQueue (G24) unwraps the in-flight provisioning list', async () => {
    const { result } = renderHook(() => useProvisioningQueue('in_flight'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(captured?.method).toBe('GET');
    expect(captured?.pathname).toBe('/api/v1/admin/provisioning');
    expect(result.current.data).toEqual([
      {
        tenant_id: 'tenant-1',
        tenant_name: 'Acme',
        status: 'provisioning',
        progress_pct: 50,
      },
    ]);
  });
});
