'use client';

// Single-tenant license read for the Platform Console detail License tab (§E.2).
// Runtime gateways may not expose the dedicated per-tenant license route, while
// the fleet license list is already available for the licensing screen. Query
// that fleet list and select the current tenant locally.

import { useApiQuery } from '@/hooks/use-api';
import { platformKeys } from '@/hooks/use-platform';
import type { FleetLicenseRow, LicenseState } from '@/types/platform';

export interface TenantLicense {
  tenant_id?: string;
  plan_key?: string;
  plan_name?: string;
  state?: LicenseState;
  seats?: number;
  seats_used?: number;
  issued_at?: string | null;
  expires_at?: string | null;
  grace_until?: string | null;
  [key: string]: unknown;
}

interface FleetLicenseEnvelope {
  data?: RawFleetLicenseRow[];
}

interface RawFleetLicenseRow extends Omit<FleetLicenseRow, 'state'> {
  status?: string;
  state?: string;
  grace_days?: number;
}

function licenseState(value: unknown): LicenseState | undefined {
  return value === 'active' || value === 'in_grace' || value === 'expired' || value === 'suspended'
    ? value
    : undefined;
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

function normalizeTenantLicense(payload: unknown, tenantId: string): TenantLicense | null {
  const rows = (payload as FleetLicenseEnvelope | undefined)?.data;
  const row = Array.isArray(rows) ? rows.find((item) => item.tenant_id === tenantId) : undefined;
  if (!row) return null;
  return {
    tenant_id: row.tenant_id,
    plan_key: row.plan_key,
    plan_name: row.plan_name,
    state: licenseState(row.state),
    seats: row.seats,
    seats_used: row.seats_used,
    expires_at: row.expires_at,
    grace_until: row.grace_until ?? graceUntil(row.expires_at, row.grace_days),
  };
}

export function useTenantLicense(tenantId: string, enabled = true) {
  return useApiQuery<TenantLicense | null>(
    [...platformKeys.licensing, 'license', tenantId],
    '/api/v1/licensing/admin/tenants',
    {
      enabled: enabled && Boolean(tenantId),
      requestConfig: { params: { page: 1, per_page: 1000 } },
      select: (payload) => normalizeTenantLicense(payload, tenantId),
    },
  );
}
