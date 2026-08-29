// Clario Recover product types.
//
// These mirror the `GET /api/recover/products` response published by the backend
// in `RECOVER_CONTRACT.md` (Prompt 1). The product is a productization layer over
// the existing `dr/*` services: one product (`recover`) with three sub-solutions
// (`it-dr`, `cloud-dr`, `cyber-recovery`), each carrying live per-tenant
// entitlement state and the composed DR capabilities.

/** Stable sub-solution slugs — navigation, routing and analytics key off these. */
export type RecoverSubSolutionSlug = 'it-dr' | 'cloud-dr' | 'cyber-recovery';

export const RECOVER_SUB_SOLUTION_SLUGS: readonly RecoverSubSolutionSlug[] = [
  'it-dr',
  'cloud-dr',
  'cyber-recovery',
] as const;

/** Live, per-tenant entitlement state for one sub-solution. */
export interface RecoverEntitlementState {
  /** Licensing key, e.g. `recover.it_dr`. */
  key: string;
  /** Licensed for this tenant (resolved live by the licensing engine). */
  active: boolean;
  /** Tenant has explicitly turned the sub-solution on (onboarding). */
  activated: boolean;
  /** Denial reason when `active === false`. */
  reason: string;
}

/** One composed DR capability backing a sub-solution. */
export interface RecoverCapability {
  id: string;
  label: string;
  description: string;
  /** Fully-qualified Go package path of the backing DR service. */
  service: string;
}

/** One sub-solution within the Recover product. */
export interface RecoverSubSolution {
  id: RecoverSubSolutionSlug;
  label: string;
  value_prop: string;
  entitlement_key: string;
  entitlement: RecoverEntitlementState;
  capabilities: RecoverCapability[];
}

/** The Recover product view returned by `GET /api/recover/products`. */
export interface RecoverProductView {
  product: string;
  label: string;
  sub_solutions: RecoverSubSolution[];
}

// --- Onboarding sub-solution selection + demo templates (Prompt 9) ----------
// Mirrors POST /api/recover/onboarding/activate and
// DELETE /api/recover/onboarding/demo-data (see internal/recover/ONBOARDING_README.md).

/** Request body for the onboarding activation: the selected sub-solution slugs. */
export interface RecoverOnboardRequest {
  sub_solutions: RecoverSubSolutionSlug[];
}

/** Per-sub-solution outcome of an onboarding activation + demo seed. */
export interface RecoverSubSolutionSeedResult {
  sub_solution: RecoverSubSolutionSlug;
  activated: boolean;
  /** True when the sub-solution already had demo content (seed was a no-op). */
  already_seeded: boolean;
  /** The demo application keys present for the sub-solution (namespaced `demo-…`). */
  application_keys: string[];
  application_count: number;
  runbook_count: number;
}

/** Response of POST /api/recover/onboarding/activate. */
export interface RecoverOnboardResult {
  results: RecoverSubSolutionSeedResult[];
}

/** Response of DELETE /api/recover/onboarding/demo-data. */
export interface RecoverRemoveDemoResult {
  runbooks_removed: number;
  applications_removed: number;
}
