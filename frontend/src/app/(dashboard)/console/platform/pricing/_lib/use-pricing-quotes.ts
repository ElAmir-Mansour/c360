'use client';

// usePricingQuotes hook family (Phase-3b) — list / get / create / transition /
// override for the pricing quotes surface, via the shared axios instance (Bearer
// + CSRF + entitlement handling intact).
//
// Envelope note: license-service writes via suiteapi.WriteData → `{ "data": … }`.
// The axios success interceptor does NOT unwrap, so we read `res.data.data`,
// tolerating a bare payload too (unwrap()).
//
// Masking: the server decides whether each tier row carries the `internal` margin
// block (pricing:admin only). The frontend never asks for it via a flag on
// quotes; it simply renders margin off the block's presence AND the admin gate.
// GET/POST always go out the same way regardless of role — the backend masks.
//
// Mutations invalidate the quotes cache so the list + detail refetch. A single
// quote read is invalidated on transition/override so the status + below_floor /
// override state re-hydrate.

import {
  useQuery,
  useMutation,
  useQueryClient,
  keepPreviousData,
} from '@tanstack/react-query';
import type { AxiosError } from 'axios';
import api from '@/lib/api';
import type { ApiError } from '@/types/api';
import type {
  Quote,
  QuoteListParams,
  QuoteListResponse,
  CreateQuoteRequest,
  QuoteTransition,
  OverrideFloorRequest,
  QuoteExportFormat,
} from './quote-types';

const QUOTES_URL = '/api/v1/pricing/quotes';

export const quoteKeys = {
  all: ['platform', 'pricing', 'quotes'] as const,
  list: (params: QuoteListParams) => [...quoteKeys.all, 'list', params] as const,
  detail: (id: string) => [...quoteKeys.all, 'detail', id] as const,
};

/** Unwrap the `{data}` envelope, tolerating an already-unwrapped body. */
function unwrap<T>(body: unknown): T {
  if (body && typeof body === 'object' && 'data' in (body as Record<string, unknown>)) {
    return (body as { data: T }).data;
  }
  return body as T;
}

/** Strip undefined/empty values so we don't send blank query params. */
function cleanParams(params: QuoteListParams): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  if (params.status) out.status = params.status;
  if (params.tenant_id) out.tenant_id = params.tenant_id;
  if (params.model) out.model = params.model;
  if (params.page) out.page = params.page;
  if (params.page_size) out.page_size = params.page_size;
  return out;
}

/**
 * GET /api/v1/pricing/quotes — paginated, filterable list of masked quotes.
 * Keeps the previous page visible while a new page/filter loads.
 */
export function usePricingQuotes(params: QuoteListParams) {
  return useQuery<QuoteListResponse, AxiosError<ApiError>>({
    queryKey: quoteKeys.list(params),
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const res = await api.get(QUOTES_URL, { params: cleanParams(params) });
      return unwrap<QuoteListResponse>(res.data);
    },
  });
}

/**
 * GET /api/v1/pricing/quotes/{id} — a single quote. The margin block is present
 * only when the caller holds pricing:admin (server-masked); the caller reads it
 * off `tiers[].internal`.
 */
export function usePricingQuote(id: string, enabled = true) {
  return useQuery<Quote, AxiosError<ApiError>>({
    queryKey: quoteKeys.detail(id),
    enabled: enabled && Boolean(id),
    queryFn: async () => {
      const res = await api.get(`${QUOTES_URL}/${id}`);
      return unwrap<Quote>(res.data);
    },
  });
}

/**
 * POST /api/v1/pricing/quotes — create a quote. The server RECOMPUTES from the
 * active pricing_config; the body carries drivers + selected_tier only (no tier
 * numbers). Invalidates the quote list on success.
 */
export function useCreatePricingQuote() {
  const qc = useQueryClient();
  return useMutation<Quote, AxiosError<ApiError>, CreateQuoteRequest>({
    mutationFn: async (body) => {
      const res = await api.post(QUOTES_URL, body);
      return unwrap<Quote>(res.data);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: quoteKeys.all });
    },
  });
}

export interface TransitionVars {
  id: string;
  action: QuoteTransition;
}

/**
 * POST /quotes/{id}/{send|accept|reject}. send/accept return 409 when the quote
 * is below_floor and no override has been recorded — the caller surfaces that as
 * an "override required" message. Invalidates the specific quote + the list.
 */
export function useTransitionPricingQuote() {
  const qc = useQueryClient();
  return useMutation<Quote, AxiosError<ApiError>, TransitionVars>({
    mutationFn: async ({ id, action }) => {
      const res = await api.post(`${QUOTES_URL}/${id}/${action}`);
      return unwrap<Quote>(res.data);
    },
    onSuccess: (_data, { id }) => {
      void qc.invalidateQueries({ queryKey: quoteKeys.detail(id) });
      void qc.invalidateQueries({ queryKey: quoteKeys.list({}) });
      void qc.invalidateQueries({ queryKey: quoteKeys.all });
    },
  });
}

export interface OverrideFloorVars {
  id: string;
  reason: string;
}

/**
 * POST /quotes/{id}/override-floor (pricing:admin only). Records the override so
 * a below_floor quote can then be sent/accepted. Invalidates the quote.
 */
export function useOverrideFloor() {
  const qc = useQueryClient();
  return useMutation<Quote, AxiosError<ApiError>, OverrideFloorVars>({
    mutationFn: async ({ id, reason }) => {
      const body: OverrideFloorRequest = { reason };
      const res = await api.post(`${QUOTES_URL}/${id}/override-floor`, body);
      return unwrap<Quote>(res.data);
    },
    onSuccess: (_data, { id }) => {
      void qc.invalidateQueries({ queryKey: quoteKeys.detail(id) });
      void qc.invalidateQueries({ queryKey: quoteKeys.all });
    },
  });
}

/**
 * GET /api/v1/pricing/quotes/{id}/export?format=xlsx|pdf — a client-facing file
 * download (margin never present). Fetches as a blob via axios then triggers a
 * browser download. Returns the fetched Blob so callers can surface a toast.
 */
export async function exportPricingQuote(
  id: string,
  format: QuoteExportFormat,
): Promise<Blob> {
  const res = await api.get(`${QUOTES_URL}/${id}/export`, {
    params: { format },
    responseType: 'blob',
  });
  return res.data as Blob;
}
