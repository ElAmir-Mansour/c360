// Pricing QUOTES DTOs (Phase-3b) — mirror license-service internal/pricing quote
// handlers/models so the axios JSON binds without a transform.
//
// STRUCTURAL MASKING (same discipline as the calculator): a quote's tiers are
// the masked ClientTier rows; the internal margin block is present ONLY when the
// caller holds pricing:admin (the server serializes the InternalTier form then).
// The detail page renders the margin surface solely off the presence of the
// `internal` block AND the pricing:admin gate — never off a client-visible field.

import type { PricingModel, PricingTier, PricingTierRow, Deployment } from './types';

/** Quote lifecycle status (handler.go / model.go quote status enum). */
export type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired';

export const QUOTE_STATUSES: QuoteStatus[] = [
  'draft',
  'sent',
  'accepted',
  'rejected',
  'expired',
];

/**
 * A quote's masked, client-facing view (GET /quotes/{id} for pricing:read/write,
 * and every row of the list). `tiers` are ClientTier rows; a `PricingTierRow`
 * carries an OPTIONAL `internal` block that is only populated for pricing:admin.
 */
export interface Quote {
  id: string;
  quote_number: string; // Q-YYYY-NNNNNN
  model: PricingModel;
  pricing_version: number;
  status: QuoteStatus;
  below_floor: boolean;
  selected_tier: PricingTier;
  account_name: string;
  tenant_id?: string | null;
  lead_id?: string | null;
  currency: string; // "SAR"
  /** ISO timestamp the quote is valid until. */
  valid_until?: string | null;
  /** Whether a floor override has been recorded (unblocks send/accept). */
  floor_override?: boolean;
  floor_override_reason?: string | null;
  /** The recomputed 4-tier breakdown (masked; margin only for pricing:admin). */
  tiers: PricingTierRow[];
  created_at: string;
  updated_at?: string | null;
}

/**
 * POST /api/v1/pricing/quotes request body. NOTE: no tier numbers are sent — the
 * server RECOMPUTES from the active pricing_config given these drivers +
 * selected_tier. Volume drivers are model-conditional (users XOR cores/vms).
 */
export interface CreateQuoteRequest {
  model: PricingModel;
  deployment: Deployment;
  term_months: number;
  users?: number;
  cores?: number;
  vms?: number;
  hot_storage_gb: number;
  cold_storage_gb: number;
  sales_discount?: number; // 0-1 fraction on the wire
  selected_tier: PricingTier;
  tenant_id?: string;
  lead_id?: string;
  account_name: string;
}

/** GET /api/v1/pricing/quotes query params. */
export interface QuoteListParams {
  status?: QuoteStatus;
  tenant_id?: string;
  model?: PricingModel;
  page?: number;
  page_size?: number;
}

/** Paginated list envelope (inside the `{data}` wrapper). */
export interface QuoteListResponse {
  quotes: Quote[];
  page: number;
  page_size: number;
  total: number;
}

/** POST /quotes/{id}/override-floor body (pricing:admin only). */
export interface OverrideFloorRequest {
  reason: string;
}

/** The transition verbs exposed as POST /quotes/{id}/{action}. */
export type QuoteTransition = 'send' | 'accept' | 'reject';

/** Export formats for GET /quotes/{id}/export?format=. */
export type QuoteExportFormat = 'xlsx' | 'pdf';

/** Look up a tier row on a quote (defensive against ordering). */
export function findTier(quote: Quote, tier: PricingTier): PricingTierRow | undefined {
  return quote.tiers.find((row) => row.tier === tier);
}
