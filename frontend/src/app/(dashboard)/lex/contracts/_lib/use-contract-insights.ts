/**
 * Feature 13 — portfolio insight feed data layer for the contracts list page.
 *
 * Consumes `GET /api/v1/lex/contracts/insights` (compute-on-read, gated on
 * `lex:contract:view`): a ranked list of bilingual insight cards — missing
 * mandatory clauses, closing auto-renew opt-out windows, value outliers,
 * counterparty concentration, and stale drafts. Severity reuses the lex risk
 * scale so the existing severity primitives apply unchanged.
 *
 * This module owns three concerns, each independently testable:
 *
 *   1. {@link getContractInsights} — the fetch. Implemented on the shared
 *      `fetchSuiteData` envelope helper. Interim client until the canonical
 *      `enterpriseApi.lex.getContractInsights()` lands in
 *      `lib/enterprise/api.ts` (see the wiring spec); swap the import then.
 *   2. {@link useContractInsights} — TanStack query + a dismiss-for-session
 *      store (sessionStorage, SSR-safe hydration in a mount effect, mirroring
 *      the guarded-storage idiom of `use-contracts-view-prefs.ts`).
 *   3. Pure helpers — {@link resolveInsightCopy} (locale-resolved title/detail
 *      straight from the bilingual payload) and {@link insightFilterMapping}
 *      (kind → server-recognized list-filter params for the "view matching"
 *      affordance; the list endpoint has NO `ids` filter, so each kind maps to
 *      the closest faithful filter and unmappable kinds return `null`).
 */
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchSuiteData } from '@/lib/suite-api';
import type { LexRiskLevel } from '@/types/suites';

/* ------------------------------------------------------------------------- *
 * Payload types (mirror backend/internal/lex/service/contract_insights_service.go).
 * ------------------------------------------------------------------------- */

/** Known insight kinds. The feed tolerates unknown kinds (forward-compatible). */
export const CONTRACT_INSIGHT_KINDS = [
  'missing_mandatory_clause',
  'renewal_opt_out_closing',
  'value_outlier',
  'counterparty_concentration',
  'stale_draft',
] as const;

export type LexContractInsightKind = (typeof CONTRACT_INSIGHT_KINDS)[number];

/** One ranked, bilingual insight card. */
export interface LexContractInsight {
  /** Stable per-kind (or kind:cohort) identifier — the dismiss key. */
  id: string;
  kind: LexContractInsightKind | (string & {});
  severity: LexRiskLevel;
  title_en: string;
  title_ar: string;
  detail_en: string;
  detail_ar: string;
  /** Matching contract ids (server-capped at 25 per card). */
  contract_ids: string[];
  /** Raw numbers behind the card, for locale-aware re-formatting. */
  metric: Record<string, unknown>;
}

/** `GET /contracts/insights` response body (inside the `{data}` envelope). */
export interface LexContractInsightsReport {
  insights: LexContractInsight[];
  generated_at: string;
  window_days: number;
  stale_draft_days: number;
  scanned_active_contracts: number;
  /** True when a bounded scan covered fewer rows than the tenant holds. */
  truncated: boolean;
}

/* ------------------------------------------------------------------------- *
 * Fetch.
 * ------------------------------------------------------------------------- */

export const LEX_CONTRACT_INSIGHTS_ENDPOINT = '/api/v1/lex/contracts/insights';

export interface ContractInsightsQueryParams {
  /** Auto-renew opt-out horizon in days (server default 30, clamped 1..365). */
  window_days?: number;
  /** Draft-inactivity threshold in days (server default 30, clamped 1..365). */
  stale_days?: number;
}

/**
 * Fetch the portfolio insight feed. Interim client-local fn until the
 * canonical `enterpriseApi.lex.getContractInsights()` is added to
 * `lib/enterprise/api.ts` (this fn is signature-compatible by design).
 */
export function getContractInsights(
  params?: ContractInsightsQueryParams,
): Promise<LexContractInsightsReport> {
  const query: Record<string, unknown> = {};
  if (params?.window_days != null) query.window_days = params.window_days;
  if (params?.stale_days != null) query.stale_days = params.stale_days;
  return fetchSuiteData<LexContractInsightsReport>(LEX_CONTRACT_INSIGHTS_ENDPOINT, query);
}

/* ------------------------------------------------------------------------- *
 * Pure helpers.
 * ------------------------------------------------------------------------- */

/**
 * Resolve the bilingual card copy for the active locale, straight from the
 * payload. Falls back to the English string when the counterpart is empty so a
 * partially-localized card never renders blank.
 */
export function resolveInsightCopy(
  insight: Pick<LexContractInsight, 'title_en' | 'title_ar' | 'detail_en' | 'detail_ar'>,
  locale: string,
): { title: string; detail: string } {
  const arabic = locale === 'ar';
  return {
    title: (arabic ? insight.title_ar : insight.title_en) || insight.title_en,
    detail: (arabic ? insight.detail_ar : insight.detail_en) || insight.detail_en,
  };
}

/**
 * The "view matching" contract handed back to the page. The contracts list
 * endpoint has NO `ids` filter, so `filters`/`search` carry the closest
 * faithful server-side narrowing for the insight's kind; `null` when no
 * faithful mapping exists (the integrator falls back to `contractIds`, e.g.
 * opening the first matching contract).
 */
export interface ContractInsightFilterMapping {
  /** Params for the list table's `setFilter` (server-recognized keys only). */
  filters: Record<string, string>;
  /** Free-text search (matches contract title + party B name server-side). */
  search?: string;
}

function metricString(insight: LexContractInsight, key: string): string | null {
  const value = insight.metric?.[key];
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function metricNumber(insight: LexContractInsight, key: string): number | null {
  const value = insight.metric?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Map an insight kind onto server-recognized contracts-list filter params
 * (see backend `parseContractListFilters`: status / type / risk_level /
 * expiring_in_days / search / department / tag).
 *
 *   - renewal_opt_out_closing   → expiring_in_days over the report window
 *   - stale_draft               → status=draft
 *   - value_outlier             → type=<cohort contract type>
 *   - counterparty_concentration→ search=<dominant party B name>
 *   - missing_mandatory_clause  → null (playbook compliance has no list filter)
 */
export function insightFilterMapping(
  insight: LexContractInsight,
): ContractInsightFilterMapping | null {
  switch (insight.kind) {
    case 'renewal_opt_out_closing': {
      const windowDays = metricNumber(insight, 'window_days') ?? 30;
      return { filters: { expiring_in_days: String(windowDays) } };
    }
    case 'stale_draft':
      return { filters: { status: 'draft' } };
    case 'value_outlier': {
      const contractType = metricString(insight, 'contract_type');
      return contractType ? { filters: { type: contractType } } : null;
    }
    case 'counterparty_concentration': {
      const partyB = metricString(insight, 'party_b');
      return partyB ? { filters: {}, search: partyB } : null;
    }
    default:
      return null;
  }
}

/**
 * Split a ranked insight list against the session's dismissed-id set,
 * preserving the server rank order of the visible cards.
 */
export function partitionDismissed(
  insights: LexContractInsight[],
  dismissedIds: readonly string[],
): { visible: LexContractInsight[]; dismissedCount: number } {
  const dismissed = new Set(dismissedIds);
  const visible = insights.filter((insight) => !dismissed.has(insight.id));
  return { visible, dismissedCount: insights.length - visible.length };
}

/* ------------------------------------------------------------------------- *
 * Dismiss-for-session store (guarded sessionStorage).
 * ------------------------------------------------------------------------- */

const DISMISSED_STORAGE_KEY = 'lex-contracts:insights-dismissed';

function readDismissed(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.sessionStorage.getItem(DISMISSED_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === 'string')
      : [];
  } catch {
    return [];
  }
}

function writeDismissed(ids: string[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(DISMISSED_STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // Storage may be unavailable (private mode / quota); dismissal then only
    // lasts for the mounted component's lifetime, which is an acceptable floor.
  }
}

/* ------------------------------------------------------------------------- *
 * Hook.
 * ------------------------------------------------------------------------- */

export interface UseContractInsightsOptions {
  /** Auto-renew opt-out horizon in days (omitted → server default 30). */
  windowDays?: number;
  /** Draft-inactivity threshold in days (omitted → server default 30). */
  staleDays?: number;
  /** Gate the fetch (e.g. on a permission check). Defaults to true. */
  enabled?: boolean;
}

export interface UseContractInsightsResult {
  /** Full server report (undefined until loaded). */
  report: LexContractInsightsReport | undefined;
  /** Visible cards: server rank order minus session-dismissed ids. */
  insights: LexContractInsight[];
  /** Total cards the server returned (before dismissal). */
  totalCount: number;
  /** How many of the returned cards are hidden by session dismissal. */
  dismissedCount: number;
  /** Hide one card for the rest of the browser session. */
  dismiss: (id: string) => void;
  /** Un-hide every session-dismissed card. */
  restoreDismissed: () => void;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
}

/**
 * Query + session-dismissal state for the contract portfolio insight feed.
 *
 * SSR-safe: the dismissed set initializes empty (server and first client
 * render match) and hydrates from sessionStorage in a mount effect.
 */
export function useContractInsights(
  options: UseContractInsightsOptions = {},
): UseContractInsightsResult {
  const { windowDays, staleDays, enabled = true } = options;
  const [dismissedIds, setDismissedIds] = useState<string[]>([]);

  useEffect(() => {
    setDismissedIds(readDismissed());
  }, []);

  const query = useQuery({
    queryKey: ['lex-contracts', 'insights', windowDays ?? null, staleDays ?? null],
    queryFn: () =>
      getContractInsights({
        ...(windowDays != null ? { window_days: windowDays } : {}),
        ...(staleDays != null ? { stale_days: staleDays } : {}),
      }),
    staleTime: 60_000,
    enabled,
  });

  const report = query.data;

  const dismiss = useCallback((id: string) => {
    setDismissedIds((current) => {
      if (current.includes(id)) return current;
      const next = [...current, id];
      writeDismissed(next);
      return next;
    });
  }, []);

  const restoreDismissed = useCallback(() => {
    setDismissedIds([]);
    writeDismissed([]);
  }, []);

  const { visible, dismissedCount } = useMemo(
    () => partitionDismissed(report?.insights ?? [], dismissedIds),
    [report, dismissedIds],
  );

  return {
    report,
    insights: visible,
    totalCount: report?.insights.length ?? 0,
    dismissedCount,
    dismiss,
    restoreDismissed,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}
