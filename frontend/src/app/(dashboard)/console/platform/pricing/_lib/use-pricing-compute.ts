'use client';

// usePricingCompute — the Phase-2 calculator hook.
//
// Calls POST /api/v1/pricing/compute via the shared axios instance (Bearer +
// CSRF + entitlement handling intact). The 4-tier result recomputes whenever the
// (debounced) inputs change; the page owns the debounce so keystrokes don't spam
// the backend.
//
// include_internal is requested ONLY when the caller holds pricing:admin. The
// backend structurally masks regardless (a non-admin asking for internal is
// silently downgraded to ClientTier), but we never even ask unless the UI would
// be allowed to render margin — defence in depth for the internal-only rule.
//
// Envelope note: license-service writes via suiteapi.WriteData → `{ "data": … }`.
// The axios success interceptor does NOT unwrap, so we read `res.data.data`,
// tolerating a bare payload too if the gateway ever unwraps.

import { useQuery, keepPreviousData } from '@tanstack/react-query';
import type { AxiosError } from 'axios';
import api from '@/lib/api';
import type { ApiError } from '@/types/api';
import type { ComputeRequest, ComputeResponse } from './types';

const COMPUTE_URL = '/api/v1/pricing/compute';

export const pricingKeys = {
  all: ['platform', 'pricing'] as const,
  compute: (body: ComputeRequest, includeInternal: boolean) =>
    [...pricingKeys.all, 'compute', includeInternal, body] as const,
};

/** Unwrap the `{data}` envelope, tolerating an already-unwrapped body. */
function unwrap<T>(body: unknown): T {
  if (body && typeof body === 'object' && 'data' in (body as Record<string, unknown>)) {
    return (body as { data: T }).data;
  }
  return body as T;
}

export interface UsePricingComputeArgs {
  /** The (already-debounced) calculator inputs. */
  body: ComputeRequest;
  /**
   * Whether to request the internal margin block. The CALLER must pass this
   * gated on pricing:admin — the hook forwards it verbatim as the
   * ?include_internal query flag. Defaults to false.
   */
  includeInternal?: boolean;
  /** Disable the query (e.g. while inputs are invalid). Defaults to true. */
  enabled?: boolean;
}

/**
 * Compute the 4-tier pricing comparison for a set of inputs. Returns the full
 * TanStack Query result so the page can surface loading / error / fetching
 * states and read `data.tiers`.
 */
export function usePricingCompute({
  body,
  includeInternal = false,
  enabled = true,
}: UsePricingComputeArgs) {
  return useQuery<ComputeResponse, AxiosError<ApiError>>({
    queryKey: pricingKeys.compute(body, includeInternal),
    enabled,
    // Keep the previous tiers visible while a new debounced recompute is in
    // flight so the table doesn't blank out on every keystroke.
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const res = await api.post(COMPUTE_URL, body, {
        params: includeInternal ? { include_internal: 'true' } : undefined,
      });
      return unwrap<ComputeResponse>(res.data);
    },
  });
}
