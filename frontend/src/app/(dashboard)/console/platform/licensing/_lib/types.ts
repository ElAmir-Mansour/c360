// Local licensing types for the Plans tab + plan-detail entitlements editor.
//
// The shared foundation (src/types/platform.ts) covers the *fleet* shapes
// (FleetLicenseRow, ExpiringLicense, Override, SeatRollup, EntitlementKey,
// TenantEntitlement) but intentionally omits the plan catalog — there are no
// plan hooks in src/hooks/use-platform.ts. These mirror the license-service
// model (backend/internal/license/model/model.go:50-68) exactly so the local
// hooks bind the JSON without a transform.

/** Limit semantics (model.go:62-68): null = granted w/o quota, >0 = metered, 0 = revoked. */
export interface PlanEntitlement {
  key: string;
  /** null/absent == unlimited; 0 == explicitly revoked; >0 == quota. */
  limit?: number | null;
}

export type PlanStatus = 'active' | 'retired' | string;

export interface LicensePlan {
  id: string;
  key: string;
  name: string;
  description: string;
  source: string;
  status: PlanStatus;
  entitlements?: PlanEntitlement[];
  created_at: string;
  updated_at: string;
}

export interface CreatePlanInput {
  key: string;
  name: string;
  description?: string;
  entitlements?: PlanEntitlement[];
}

export interface UpdatePlanInput {
  key: string;
  name: string;
  description?: string;
}

