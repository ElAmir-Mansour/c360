// Pricing & Quoting console DTOs — mirror backend/internal/pricing/model/model.go
// EXACTLY so the axios JSON binds without a transform.
//
// STRUCTURAL MASKING (model.go §7-9): ClientTier physically omits the internal
// margin block; InternalTier embeds ClientTier and ADDS an `internal` object.
// The backend serializes InternalTier ONLY for callers holding pricing:admin —
// even when ?include_internal=true is requested by a non-admin the server
// silently downgrades to ClientTier. The frontend mirrors that: it only asks for
// include_internal when the user has pricing:admin, and the margin panel is
// rendered only when `internal` is present on the row.

export type PricingModel = 'per_user' | 'per_core';

/** Deployment codes (model.go §27-34). */
export type Deployment = 1 | 2 | 3; // 1=SaaS, 2=On-Prem, 3=Air-Gapped

export type PricingTier =
  | 'standard'
  | 'growth'
  | 'professional'
  | 'customized';

/** The canonical output ordering (model.go Tiers). */
export const TIER_ORDER: PricingTier[] = [
  'standard',
  'growth',
  'professional',
  'customized',
];

/**
 * Client-facing per-tier line breakdown (model.go LineItems). Field names are
 * model-neutral: `data_storage` carries the per_user storage line (0 on
 * per_core) and `vm_infrastructure` carries the per_core VM line (0 on
 * per_user).
 */
export interface LineItems {
  base_charge: number;
  ai_allocation: number;
  data_storage: number;
  vm_infrastructure: number;
  deployment_setup_premium: number;
}

/**
 * ClientTier (model.go §215-226) — the masked, client-facing tier. There is no
 * `internal` field: margin is physically absent.
 */
export interface ClientTier {
  tier: PricingTier;
  line_items: LineItems;
  sub_total: number;
  volume_discount: number;
  term_discount: number;
  sales_discount: number;
  net_sub_total: number;
  vat: number;
  total_monthly: number;
  contract_value: number;
  /** Optional feature list (server may attach; not present in base model). */
  features?: string[];
}

/** Guardrail verdict (model.go §57-60). */
export type Guardrail = 'OK' | 'BELOW FLOOR';

/**
 * InternalBlock (model.go §230-235) — INTERNAL-ONLY margin figures. Present only
 * on rows the server chose to serialize as InternalTier (pricing:admin).
 */
export interface InternalBlock {
  internal_cost: number;
  gross_profit: number;
  realized_margin: number;
  guardrail: Guardrail;
}

/**
 * InternalTier (model.go §239-242) = ClientTier + the `internal` block. The
 * `internal` key is OPTIONAL on the wire because a non-admin response returns
 * bare ClientTier rows; presence of `internal` is the signal that margin is
 * available to render.
 */
export interface PricingTierRow extends ClientTier {
  internal?: InternalBlock;
}

/** POST /api/v1/pricing/compute request body (handler.go computeRequest). */
export interface ComputeRequest {
  model: PricingModel;
  deployment: Deployment;
  term_months: number;
  users?: number;
  cores?: number;
  vms?: number;
  hot_storage_gb: number;
  cold_storage_gb: number;
  sales_discount?: number;
}

/** Response payload (handler.go compute — inside the `{data}` envelope). */
export interface ComputeResponse {
  pricing_version: number;
  currency: string; // "SAR"
  model: PricingModel;
  tiers: PricingTierRow[];
}
