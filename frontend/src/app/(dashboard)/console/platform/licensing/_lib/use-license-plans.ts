'use client';

// Plan-catalog + tenant-license-action hooks for the Licensing screen.
//
// The shared foundation hook (src/hooks/use-platform.ts) covers the fleet reads
// (G7/G8/G9/G10/G11/G12) and the override mutations, but NOT the plan catalog or
// the per-tenant license lifecycle actions (assign / suspend / resume / offline).
// We add those here, scoped to this route, against the EXISTING endpoints listed
// in docs/platform-admin-console.md §F.1 (handler.go:76-91, 99-108).
//
// Envelope note: license-service writes via suiteapi.WriteData → `{ "data": … }`
// and suiteapi.WritePaginated → `{ "data": [...], "pagination": {…} }`. The axios
// success interceptor does NOT unwrap, so we read `res.data.data`, tolerating a
// bare payload too so the hooks stay correct if the gateway ever unwraps.

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { AxiosError } from 'axios';
import api from '@/lib/api';
import type { ApiError } from '@/types/api';
import { platformKeys } from '@/hooks/use-platform';
import type {
  LicensePlan,
  PlanEntitlement,
  CreatePlanInput,
  UpdatePlanInput,
} from './types';

const ADMIN = '/api/v1/licensing/admin';

/** Unwrap the `{data}` envelope, tolerating an already-unwrapped body. */
function unwrap<T>(body: unknown): T {
  if (body && typeof body === 'object' && 'data' in (body as Record<string, unknown>)) {
    return (body as { data: T }).data;
  }
  return body as T;
}

const planKeys = {
  all: [...platformKeys.licensing, 'plans'] as const,
  detail: (key: string) => [...platformKeys.licensing, 'plans', key] as const,
};

// ── Reads ─────────────────────────────────────────────────────────────────────

/** List catalog plans (GET .../plans). */
export function useLicensePlans() {
  return useQuery<LicensePlan[], AxiosError<ApiError>>({
    queryKey: planKeys.all,
    queryFn: async () => {
      const res = await api.get(`${ADMIN}/plans`);
      return unwrap<LicensePlan[]>(res.data) ?? [];
    },
  });
}

/** Single plan with its entitlements (GET .../plans/{key}). */
export function useLicensePlan(key: string, enabled = true) {
  return useQuery<LicensePlan, AxiosError<ApiError>>({
    queryKey: planKeys.detail(key),
    enabled: enabled && Boolean(key),
    queryFn: async () => {
      const res = await api.get(`${ADMIN}/plans/${encodeURIComponent(key)}`);
      return unwrap<LicensePlan>(res.data);
    },
  });
}

// ── Plan lifecycle mutations (all EXISTS) ───────────────────────────────────────

function useInvalidatePlans() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: platformKeys.licensing });
}

export function useCreatePlan() {
  const invalidate = useInvalidatePlans();
  return useMutation<LicensePlan, AxiosError<ApiError>, CreatePlanInput>({
    mutationFn: async (input) => {
      const res = await api.post(`${ADMIN}/plans`, input);
      return unwrap<LicensePlan>(res.data);
    },
    onSuccess: invalidate,
  });
}

export function useUpdatePlan() {
  const invalidate = useInvalidatePlans();
  return useMutation<LicensePlan, AxiosError<ApiError>, UpdatePlanInput>({
    mutationFn: async ({ key, name, description }) => {
      const res = await api.put(`${ADMIN}/plans/${encodeURIComponent(key)}`, {
        name,
        description,
      });
      return unwrap<LicensePlan>(res.data);
    },
    onSuccess: invalidate,
  });
}

export function useRetirePlan() {
  const invalidate = useInvalidatePlans();
  return useMutation<LicensePlan, AxiosError<ApiError>, { key: string }>({
    mutationFn: async ({ key }) => {
      const res = await api.post(`${ADMIN}/plans/${encodeURIComponent(key)}/retire`, {});
      return unwrap<LicensePlan>(res.data);
    },
    onSuccess: invalidate,
  });
}

export function useReactivatePlan() {
  const invalidate = useInvalidatePlans();
  return useMutation<LicensePlan, AxiosError<ApiError>, { key: string }>({
    mutationFn: async ({ key }) => {
      const res = await api.post(`${ADMIN}/plans/${encodeURIComponent(key)}/reactivate`, {});
      return unwrap<LicensePlan>(res.data);
    },
    onSuccess: invalidate,
  });
}

/** Replace a plan's full entitlement set (PUT .../plans/{key}/entitlements). */
export function useSetPlanEntitlements() {
  const invalidate = useInvalidatePlans();
  return useMutation<
    LicensePlan,
    AxiosError<ApiError>,
    { key: string; entitlements: PlanEntitlement[] }
  >({
    mutationFn: async ({ key, entitlements }) => {
      const res = await api.put(
        `${ADMIN}/plans/${encodeURIComponent(key)}/entitlements`,
        { entitlements },
      );
      return unwrap<LicensePlan>(res.data);
    },
    onSuccess: invalidate,
  });
}

// ── Tenant-license lifecycle (all EXISTS) ───────────────────────────────────────

export interface AssignLicenseVars {
  tenantId: string;
  plan_key: string;
  seats: number;
  expires_at: string; // ISO-8601
  grace_days?: number;
}

/** Assign / change a tenant's license plan (POST .../tenants/{id}/license). */
export function useAssignTenantLicense() {
  const invalidate = useInvalidatePlans();
  return useMutation<void, AxiosError<ApiError>, AssignLicenseVars>({
    mutationFn: async (v) => {
      await api.post(`${ADMIN}/tenants/${v.tenantId}/license`, {
        plan_key: v.plan_key,
        seats: v.seats,
        expires_at: v.expires_at,
        grace_days: v.grace_days,
      });
    },
    onSuccess: invalidate,
  });
}

/** Suspend a tenant's license (POST .../tenants/{id}/license/suspend). */
export function useSuspendTenantLicense() {
  const invalidate = useInvalidatePlans();
  return useMutation<void, AxiosError<ApiError>, { tenantId: string }>({
    mutationFn: async ({ tenantId }) => {
      await api.post(`${ADMIN}/tenants/${tenantId}/license/suspend`, {});
    },
    onSuccess: invalidate,
  });
}

/** Resume a tenant's license (POST .../tenants/{id}/license/resume). */
export function useResumeTenantLicense() {
  const invalidate = useInvalidatePlans();
  return useMutation<void, AxiosError<ApiError>, { tenantId: string }>({
    mutationFn: async ({ tenantId }) => {
      await api.post(`${ADMIN}/tenants/${tenantId}/license/resume`, {});
    },
    onSuccess: invalidate,
  });
}

/** Issue a signed offline license file (POST .../tenants/{id}/offline-license). */
export function useIssueOfflineLicense() {
  return useMutation<{ license_file: string }, AxiosError<ApiError>, { tenantId: string }>({
    mutationFn: async ({ tenantId }) => {
      const res = await api.post(`${ADMIN}/tenants/${tenantId}/offline-license`, {});
      return unwrap<{ license_file: string }>(res.data);
    },
  });
}
