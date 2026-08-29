'use client';

// Tenant lifecycle mutations for the Platform Console (§E.2).
//
// These wrap the EXISTING admin onboarding endpoints (provision/reprovision/
// deprovision/reactivate — §F.1) which the shared `use-tenants.ts` hook does NOT
// cover (it only PUTs the plain `/api/v1/tenants/{id}`). Real suspend/unsuspend
// (G4) and impersonate (G5) live in the shared `use-platform.ts` and are
// consumed directly by the screens. Kept local to this route folder per the
// "create only files under your route folder" rule; all invalidate the shared
// platform tenants query key so the list/detail refetch.

import { useQueryClient } from '@tanstack/react-query';
import { useApiMutation } from '@/hooks/use-api';
import { platformKeys } from '@/hooks/use-platform';
import type { ProvisioningItem } from '@/types/platform';

/** POST /api/v1/admin/tenants/provision — multi-DB async provision (§F.1). */
export interface ProvisionVars {
  name: string;
  slug: string;
  subscription_tier?: string;
  owner_email?: string;
  owner_name?: string;
}

export function useAdminProvisionTenant() {
  const qc = useQueryClient();
  return useApiMutation<ProvisioningItem, ProvisionVars>(
    '/api/v1/admin/tenants/provision',
    'post',
    { onSuccess: () => qc.invalidateQueries({ queryKey: platformKeys.tenants }) },
  );
}

/** POST /api/v1/admin/tenants/{id}/reprovision (§F.1). */
export function useReprovisionTenant() {
  const qc = useQueryClient();
  return useApiMutation<void, { tenantId: string }>(
    '/api/v1/admin/tenants/:id/reprovision',
    'post',
    {
      mutationFn: async (vars) => {
        const { default: api } = await import('@/lib/api');
        await api.post(`/api/v1/admin/tenants/${vars.tenantId}/reprovision`, {});
      },
      onSuccess: () => qc.invalidateQueries({ queryKey: platformKeys.tenants }),
    },
  );
}

/** POST /api/v1/admin/tenants/{id}/deprovision {reason, retain_days} (§F.1). */
export interface DeprovisionVars {
  tenantId: string;
  reason: string;
  retain_days?: number;
}

export function useAdminDeprovisionTenant() {
  const qc = useQueryClient();
  return useApiMutation<void, DeprovisionVars>(
    '/api/v1/admin/tenants/:id/deprovision',
    'post',
    {
      mutationFn: async (vars) => {
        const { default: api } = await import('@/lib/api');
        await api.post(`/api/v1/admin/tenants/${vars.tenantId}/deprovision`, {
          reason: vars.reason,
          retain_days: vars.retain_days,
        });
      },
      onSuccess: () => qc.invalidateQueries({ queryKey: platformKeys.tenants }),
    },
  );
}

/** POST /api/v1/admin/tenants/{id}/reactivate — only within retain_until (§F.1). */
export function useReactivateTenant() {
  const qc = useQueryClient();
  return useApiMutation<void, { tenantId: string }>(
    '/api/v1/admin/tenants/:id/reactivate',
    'post',
    {
      mutationFn: async (vars) => {
        const { default: api } = await import('@/lib/api');
        await api.post(`/api/v1/admin/tenants/${vars.tenantId}/reactivate`, {});
      },
      onSuccess: () => qc.invalidateQueries({ queryKey: platformKeys.tenants }),
    },
  );
}
