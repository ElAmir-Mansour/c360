/**
 * React-query DATA FOUNDATION for the Watheeq Legal-Affairs command center
 * (`/lex` landing page).
 *
 * Design (per approved direction):
 *   - NO single cross-domain dashboard endpoint. Counts are a PER-DOMAIN
 *     fan-out: each tile count is its own `useQuery`, gated by
 *     `hasPermission(permission)`, `staleTime` 60s, `per_page: 1` (we only need
 *     `meta.total`). A 403/404 from any one domain must NOT cascade — every
 *     slice runs independently with `retry: false` and fails soft to `0`/empty.
 *   - The contract `getDashboard()` result is fetched ONCE under the shared key
 *     `['lex-overview','dashboard']` so the hero band, KPI strip, the contracts
 *     tile, and the relocated contract analytics all reuse the same cache entry.
 *   - "My Work" queries are enabled ONLY when a `userId` is present.
 *
 * Consumers (the page builder) import the hooks below and render; they do not
 * issue their own fetches for these numbers.
 */

'use client';

import { useMemo } from 'react';
import {
  useQueries,
  useQuery,
  type UseQueryResult,
} from '@tanstack/react-query';

import { enterpriseApi } from '@/lib/enterprise/api';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n';
import { resolveLocalized } from '@/lib/i18n/localized';
import { casesApi, type LegalCase } from '@/lib/lex/cases';
import {
  lexRequestsApi,
  type LegalRequest,
  type SLAClockView,
} from '@/lib/lex/requests';
import { consultationsApi } from '@/lib/lex/consultations';
import { settlementsApi } from '@/lib/lex/settlements';
import { investigationsApi } from '@/lib/lex/investigations';
import { useAuth } from '@/hooks/use-auth';
import type { FetchParams } from '@/types/table';
import type { PaginatedResponse } from '@/types/api';
import type {
  LexComplianceAlert,
  LexContractRecord,
  LexContractRenewalWarning,
  LexDashboard,
} from '@/types/suites';

import {
  resolvePriorityLabel,
  resolveServiceTypeLabel,
} from '../service-desk/_components/lex-enums-i18n';
import { LEX_DOMAINS } from './lex-domains';

/* ------------------------------------------------------------------------- *
 * Shared constants + helpers
 * ------------------------------------------------------------------------- */

const STALE_TIME = 60_000;

/** Minimal page params: we only want `meta.total`. */
const COUNT_PARAMS: FetchParams = { page: 1, per_page: 1 };

/** Shared key for the single contract dashboard fetch (reused by the page). */
export const LEX_OVERVIEW_DASHBOARD_KEY = [
  'lex-overview',
  'dashboard',
] as const;

/** Fail-soft react-query defaults for command-center slices. */
const SOFT_QUERY = { staleTime: STALE_TIME, retry: false as const };

function totalOf<T>(res: PaginatedResponse<T>): number {
  return res.meta.total;
}

/* ------------------------------------------------------------------------- *
 * Shared contract-dashboard query (single fetch, reused across surfaces)
 * ------------------------------------------------------------------------- */

/**
 * Fetches the contract `getDashboard()` payload ONCE under the shared overview
 * key. Hero, KPIs, the contracts tile and the relocated analytics all read this
 * same cache entry. Enabled only when the caller can read lex.
 */
export function useLexOverviewDashboard(): UseQueryResult<LexDashboard> {
  const { hasPermission } = useAuth();
  return useQuery<LexDashboard>({
    queryKey: LEX_OVERVIEW_DASHBOARD_KEY,
    queryFn: () => enterpriseApi.lex.getDashboard(),
    enabled: hasPermission('lex:contract:view'),
    ...SOFT_QUERY,
  });
}

/* ------------------------------------------------------------------------- *
 * Domain counts fan-out
 * ------------------------------------------------------------------------- */

/**
 * One tile's count slice: `null` while loading / unavailable / ungated.
 *
 * `isError`/`refetch` are ADDITIVE (optional) so the existing `{count, isLoading}`
 * placeholders callers hand to `DomainTile` stay valid. They are always populated
 * for a domain that has a count query behind it, and absent for the ones that do
 * not (drafting/reports/admin) — nothing to fail, nothing to retry.
 */
export type DomainCount = {
  count: number | null;
  isLoading: boolean;
  /**
   * True when this domain's count query FAILED. Distinct from ungated, where the
   * query never runs and `count` is simply `null` (fail-soft, not an error).
   */
  isError?: boolean;
  /** Re-runs this domain's count query. */
  refetch?: () => void;
};

/**
 * Per-domain count source. Each returns a number; the wrapping query is gated by
 * the domain's permission and fails soft. Domains without a count
 * (drafting/reports/admin) are omitted here and always resolve to `{count:null}`.
 */
type CountFetcher = () => Promise<number>;

const COUNT_FETCHERS: Record<string, CountFetcher> = {
  litigation_cases: () => casesApi.listCases(COUNT_PARAMS).then(totalOf),
  service_desk: () => lexRequestsApi.listRequests(COUNT_PARAMS).then(totalOf),
  matters: () =>
    enterpriseApi.lex.getMatterReport(COUNT_PARAMS).then((r) => r.total),
  consultations: () => consultationsApi.list(COUNT_PARAMS).then(totalOf),
  investigations: () => investigationsApi.list(COUNT_PARAMS).then(totalOf),
  settlements: () => settlementsApi.list(COUNT_PARAMS).then(totalOf),
  contracts: () =>
    enterpriseApi.lex.getDashboard().then((d) => d.kpis.active_contracts),
  obligations: () =>
    enterpriseApi.lex.getObligationReport(COUNT_PARAMS).then((r) => r.total),
  documents: () =>
    enterpriseApi.lex
      .getDocumentRepositorySummary()
      .then((s) => s.total_documents),
  clause_library: () =>
    enterpriseApi.lex.listClauseLibrary(COUNT_PARAMS).then(totalOf),
  playbooks: () => enterpriseApi.lex.listPlaybooks(COUNT_PARAMS).then(totalOf),
  regulations: () =>
    enterpriseApi.lex.listRegulations(COUNT_PARAMS).then(totalOf),
  signatures: () =>
    enterpriseApi.lex.listSignatures(COUNT_PARAMS).then(totalOf),
  workflow_policies: () =>
    enterpriseApi.lex
      .getApprovalPolicyAnalytics()
      .then((a) => a.active_policies),
  compliance: () =>
    enterpriseApi.lex.getComplianceDashboard().then((d) => d.open_alerts),
};

/**
 * Per-domain count fan-out. Returns a record keyed by domain id (matching
 * {@link LEX_DOMAINS}); each value is a {@link DomainCount}. Counts are gated by
 * `hasPermission(domain.permission)`; ungated / no-count domains resolve to
 * `{ count: null, isLoading: false }`. Each slice is independent + fail-soft.
 *
 * For the `contracts` domain the underlying `getDashboard()` is the SAME query
 * function the shared overview uses; react-query dedupes via the shared key so
 * there is no second network round-trip.
 */
export function useLexDomainCounts(): Record<string, DomainCount> {
  const { hasPermission } = useAuth();

  const countable = useMemo(
    () => LEX_DOMAINS.filter((d) => d.hasCount && COUNT_FETCHERS[d.id]),
    [],
  );

  const results = useQueries({
    queries: countable.map((domain) => {
      const isContracts = domain.id === 'contracts';
      return {
        // Contracts shares the overview dashboard cache entry to avoid a
        // duplicate fetch; everything else gets its own command-center key.
        queryKey: isContracts
          ? LEX_OVERVIEW_DASHBOARD_KEY
          : (['lex-command', domain.id] as const),
        queryFn: isContracts
          ? () => enterpriseApi.lex.getDashboard()
          : COUNT_FETCHERS[domain.id],
        enabled: hasPermission(domain.permission),
        ...SOFT_QUERY,
        select: isContracts
          ? (d: LexDashboard | number) =>
              typeof d === 'number' ? d : d.kpis.active_contracts
          : undefined,
      };
    }),
  });

  // `results` gets a fresh identity every render under react-query; this is the
  // serialized count/loading/error signal the memo depends on instead, so
  // consumers re-render only when a slice actually changes.
  const signal = results
    .map((r) => `${r.data}:${r.isLoading}:${r.fetchStatus}:${r.isError}`)
    .join('|');

  return useMemo(() => {
    const map: Record<string, DomainCount> = {};
    for (const domain of LEX_DOMAINS) {
      map[domain.id] = { count: null, isLoading: false };
    }
    countable.forEach((domain, i) => {
      const r = results[i] as UseQueryResult<number>;
      map[domain.id] = {
        count: typeof r.data === 'number' ? r.data : null,
        isLoading: r.isLoading && r.fetchStatus !== 'idle',
        isError: r.isError,
        // Bound once per observer, so a captured reference stays valid.
        refetch: r.refetch,
      };
    });
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countable, signal]);
}

/* ------------------------------------------------------------------------- *
 * Command KPI strip
 * ------------------------------------------------------------------------- */

/** A single hero/KPI metric: numeric `value` + its own loading flag. */
export type CommandKpi = {
  value: number;
  isLoading: boolean;
  /** False when the source is forbidden, disabled, or failed before returning data. */
  isAvailable: boolean;
  /**
   * True ONLY when the source query failed. `isAvailable:false` covers both the
   * ungated case (fail-soft — the query never ran) and the failed one; this flag
   * separates them so callers can offer a retry instead of a permanent dash.
   */
  isError: boolean;
};

export interface LexCommandKpis {
  complianceScore: CommandKpi;
  activeContracts: CommandKpi;
  openMatters: CommandKpi;
  overdueObligations: CommandKpi;
  pendingApprovals: CommandKpi;
  slaBreaches: CommandKpi;
  openAlerts: CommandKpi;
}

/**
 * Cross-domain KPI strip for the hero band. Each KPI is its own fail-soft query
 * (compliance score, active contracts, open matters, overdue obligations,
 * pending approvals, SLA breaches, open alerts). Compliance score + active
 * contracts derive from the shared dashboard fetch (no extra round-trip).
 */
export function useLexCommandKpis(): LexCommandKpis {
  const { hasPermission } = useAuth();
  const canViewMatters =
    hasPermission('lex:case:view') || hasPermission('lex:contract:view');
  const canViewContracts = hasPermission('lex:contract:view');
  // Approval-policy analytics count contract workflow tasks tenant-wide, so
  // expose that metric only to actors admitted by the contract decision tier.
  const canReviewApprovals =
    hasPermission('lex:contract:approve') || hasPermission('lex:contract:edit');
  const canViewRequests = hasPermission('lex:request:view');
  const canViewCompliance = hasPermission('lex:audit:read');

  const dashboard = useLexOverviewDashboard();

  const matters = useQuery({
    queryKey: ['lex-command', 'kpi', 'open-matters'],
    queryFn: () =>
      enterpriseApi.lex
        .getMatterReport(COUNT_PARAMS)
        .then((r) => openSum(r.by_status, MATTER_OPEN_STATUSES, r.total)),
    enabled: canViewMatters,
    ...SOFT_QUERY,
  });

  const obligations = useQuery({
    queryKey: ['lex-command', 'kpi', 'overdue-obligations'],
    queryFn: () =>
      enterpriseApi.lex
        .getObligationReport(COUNT_PARAMS)
        .then((r) => r.overdue),
    enabled: canViewContracts,
    ...SOFT_QUERY,
  });

  const approvals = useQuery({
    queryKey: ['lex-command', 'kpi', 'pending-approvals'],
    queryFn: () =>
      enterpriseApi.lex
        .getApprovalPolicyAnalytics()
        .then((a) => a.active_tasks),
    enabled: canReviewApprovals,
    ...SOFT_QUERY,
  });

  const slaBreaches = useQuery({
    queryKey: ['lex-command', 'kpi', 'sla-breaches'],
    queryFn: () =>
      lexRequestsApi
        .listSlaClocks(COUNT_PARAMS, { breached: true })
        .then(totalOf),
    enabled: canViewRequests,
    ...SOFT_QUERY,
  });

  const compliance = useQuery({
    queryKey: ['lex-command', 'kpi', 'compliance'],
    queryFn: () => enterpriseApi.lex.getComplianceDashboard(),
    enabled: canViewCompliance,
    ...SOFT_QUERY,
  });

  return useMemo<LexCommandKpis>(() => {
    const kpi = (
      value: number | undefined,
      isLoading: boolean,
      isError: boolean,
    ): CommandKpi => ({
      value: value ?? 0,
      isLoading,
      isAvailable: value !== undefined,
      isError,
    });
    return {
      complianceScore: kpi(
        canViewCompliance ? compliance.data?.compliance_score : undefined,
        canViewCompliance && compliance.isLoading,
        canViewCompliance && compliance.isError,
      ),
      activeContracts: kpi(
        canViewContracts ? dashboard.data?.kpis.active_contracts : undefined,
        canViewContracts && dashboard.isLoading,
        canViewContracts && dashboard.isError,
      ),
      openMatters: kpi(
        canViewMatters ? matters.data : undefined,
        canViewMatters && matters.isLoading,
        canViewMatters && matters.isError,
      ),
      overdueObligations: kpi(
        canViewContracts ? obligations.data : undefined,
        canViewContracts && obligations.isLoading,
        canViewContracts && obligations.isError,
      ),
      pendingApprovals: kpi(
        canReviewApprovals ? approvals.data : undefined,
        canReviewApprovals && approvals.isLoading,
        canReviewApprovals && approvals.isError,
      ),
      slaBreaches: kpi(
        canViewRequests ? slaBreaches.data : undefined,
        canViewRequests && slaBreaches.isLoading,
        canViewRequests && slaBreaches.isError,
      ),
      openAlerts: kpi(
        canViewCompliance ? compliance.data?.open_alerts : undefined,
        canViewCompliance && compliance.isLoading,
        canViewCompliance && compliance.isError,
      ),
    };
  }, [
    dashboard.data,
    dashboard.isLoading,
    dashboard.isError,
    canViewMatters,
    canViewContracts,
    canReviewApprovals,
    canViewRequests,
    canViewCompliance,
    matters.data,
    matters.isLoading,
    matters.isError,
    obligations.data,
    obligations.isLoading,
    obligations.isError,
    approvals.data,
    approvals.isLoading,
    approvals.isError,
    slaBreaches.data,
    slaBreaches.isLoading,
    slaBreaches.isError,
    compliance.data,
    compliance.isLoading,
    compliance.isError,
  ]);
}

/** Matter statuses counted as "open" for the KPI (non-terminal). */
const MATTER_OPEN_STATUSES = ['open', 'in_progress', 'active', 'triage'];

/** Sum the given keys from a by-status map; fall back to `total` if absent. */
function openSum(
  byStatus: Record<string, number> | undefined,
  keys: string[],
  total: number,
): number {
  if (!byStatus) return total;
  let sum = 0;
  let matched = false;
  for (const k of keys) {
    if (typeof byStatus[k] === 'number') {
      sum += byStatus[k];
      matched = true;
    }
  }
  return matched ? sum : total;
}

/* ------------------------------------------------------------------------- *
 * Needs-Attention aggregation
 * ------------------------------------------------------------------------- */

export type AttentionType =
  'sla' | 'obligation' | 'approval' | 'renewal' | 'hearing' | 'alert';

export type AttentionSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

/** A normalized "needs attention" row aggregated across legal domains. */
export type AttentionItem = {
  id: string;
  type: AttentionType;
  title: string;
  subtitle?: string;
  href: string;
  severity: AttentionSeverity;
  dueAt?: string;
  badge?: string;
};

export interface LexNeedsAttention {
  items: AttentionItem[];
  byType: Record<AttentionType, AttentionItem[]>;
  isLoading: boolean;
  error: unknown;
  /**
   * True when at least one ENABLED source failed (`error` carries the first).
   * An ungated source contributes `[]` without ever setting this — fail-soft is
   * not an error.
   */
  isError: boolean;
  /** Re-runs every enabled source in the feed. */
  refetch: () => void;
}

const SEVERITY_RANK: Record<AttentionSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

const ATTENTION_PAGE: FetchParams = { page: 1, per_page: 25 };

/**
 * Unified, cross-domain "Needs Attention" feed. Composes INDEPENDENT slices —
 * breached SLA clocks, overdue obligations, approvable workflow tasks, contract
 * renewal warnings, upcoming case hearings, and high/critical compliance alerts
 * — normalizes each into {@link AttentionItem}, then sorts by severity then
 * soonest `dueAt`. One slow / failing source never blocks the rest (each query
 * is `retry:false` and contributes `[]` on error).
 */
export function useLexNeedsAttention(): LexNeedsAttention {
  const { hasPermission } = useAuth();
  const { locale } = useLocaleOrDefault();
  const canViewRequests = hasPermission('lex:request:view');
  const canViewContracts = hasPermission('lex:contract:view');
  const canReviewContracts =
    canViewContracts &&
    (hasPermission('lex:contract:approve') ||
      hasPermission('lex:contract:edit'));
  const canViewCases = hasPermission('lex:case:view');
  const canViewCompliance = hasPermission('lex:audit:read');

  const slaQuery = useQuery({
    queryKey: ['lex-command', 'attention', 'sla'],
    queryFn: () =>
      lexRequestsApi.listSlaClocks(ATTENTION_PAGE, { breached: true }),
    enabled: canViewRequests,
    ...SOFT_QUERY,
  });

  const obligationsQuery = useQuery({
    queryKey: ['lex-command', 'attention', 'obligations'],
    queryFn: () =>
      enterpriseApi.lex.getObligationReport({
        ...ATTENTION_PAGE,
        filters: { status: 'overdue' },
      }),
    enabled: canViewContracts,
    ...SOFT_QUERY,
  });

  const approvalsQuery = useQuery({
    queryKey: ['lex-command', 'attention', 'approvals'],
    queryFn: () => enterpriseApi.lex.listWorkflows(ATTENTION_PAGE),
    enabled: canReviewContracts,
    ...SOFT_QUERY,
  });

  const renewalsQuery = useQuery({
    queryKey: ['lex-command', 'attention', 'renewals'],
    queryFn: () =>
      enterpriseApi.lex.getContractRenewalWarnings({
        horizon_days: 90,
        lead_days: 30,
      }),
    enabled: canViewContracts,
    ...SOFT_QUERY,
  });

  const hearingsQuery = useQuery({
    queryKey: ['lex-command', 'attention', 'hearings'],
    queryFn: () =>
      casesApi.listCases({
        ...ATTENTION_PAGE,
        sort: 'hearing_date',
        order: 'asc',
      }),
    enabled: canViewCases,
    ...SOFT_QUERY,
  });

  const alertsQuery = useQuery({
    queryKey: ['lex-command', 'attention', 'alerts'],
    queryFn: () =>
      enterpriseApi.lex.listComplianceAlerts({
        ...ATTENTION_PAGE,
        filters: { status: 'open' },
      }),
    enabled: canViewCompliance,
    ...SOFT_QUERY,
  });

  return useMemo<LexNeedsAttention>(() => {
    const items: AttentionItem[] = [];

    // --- SLA breaches -----------------------------------------------------
    if (canViewRequests) {
      for (const c of slaQuery.data?.data ?? []) {
        items.push(slaToAttention(c, locale));
      }
    }

    // --- Overdue obligations ---------------------------------------------
    if (canViewContracts) {
      for (const o of obligationsQuery.data?.obligations ?? []) {
        if ((o.status ?? '') !== 'overdue' && (o.days_until_due ?? 0) >= 0)
          continue;
        items.push({
          id: `obligation:${o.id}`,
          type: 'obligation',
          title: o.title,
          subtitle: o.contract_title ?? o.matter_title ?? undefined,
          href: `/lex/obligations/${o.id}`,
          severity: priorityToSeverity(o.priority, 'high'),
          dueAt: o.due_date,
          badge: o.owner_name || undefined,
        });
      }
    }

    // --- Approvable workflow tasks ---------------------------------------
    if (canReviewContracts) {
      for (const w of approvalsQuery.data?.data ?? []) {
        if (!w.task_id || (w.task_status && w.task_status !== 'pending'))
          continue;
        items.push({
          id: `approval:${w.task_id}`,
          type: 'approval',
          title:
            w.contract_title ||
            (locale === 'ar' ? 'مهمة اعتماد' : 'Approval task'),
          subtitle: w.assignee_role ?? undefined,
          href: `/lex/contracts/${w.contract_id}`,
          severity: 'high',
          badge: w.workflow_status || undefined,
        });
      }
    }

    // --- Renewal warnings ------------------------------------------------
    if (canViewContracts) {
      for (const r of renewalsQuery.data?.items ?? []) {
        items.push({
          id: `renewal:${r.contract_id}`,
          type: 'renewal',
          title: renewalWarningTitle(r, locale),
          subtitle: renewalWarningSubtitle(r, locale),
          href: `/lex/contracts/${r.contract_id}`,
          severity: r.severity === 'urgent' ? 'critical' : 'medium',
          dueAt: r.expiry_date ?? r.renewal_date ?? undefined,
          badge: r.reason || undefined,
        });
      }
    }

    // --- Upcoming hearings (client-derived: future hearing_date) ---------
    if (canViewCases) {
      for (const item of upcomingHearings(
        hearingsQuery.data?.data ?? [],
        locale,
      )) {
        items.push(item);
      }
    }

    // --- High/critical compliance alerts ---------------------------------
    if (canViewCompliance) {
      for (const a of alertsQuery.data?.data ?? []) {
        if (a.severity !== 'high' && a.severity !== 'critical') continue;
        items.push(alertToAttention(a, locale));
      }
    }

    items.sort(compareAttention);

    const byType: Record<AttentionType, AttentionItem[]> = {
      sla: [],
      obligation: [],
      approval: [],
      renewal: [],
      hearing: [],
      alert: [],
    };
    for (const item of items) byType[item.type].push(item);

    const queries = [
      slaQuery,
      obligationsQuery,
      approvalsQuery,
      renewalsQuery,
      hearingsQuery,
      alertsQuery,
    ];

    return {
      items,
      byType,
      isLoading: queries.some((q) => q.isLoading && q.fetchStatus !== 'idle'),
      error: queries.find((q) => q.error)?.error ?? null,
      isError: queries.some((q) => q.isError),
      refetch: () => {
        for (const q of queries) void q.refetch();
      },
    };
    // Depend on the granular query fields (not the unstable query-object
    // identities react-query returns fresh each render) so this recomputes only
    // when a slice's data/loading/error actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    locale,
    canViewRequests,
    canViewContracts,
    canReviewContracts,
    canViewCases,
    canViewCompliance,
    slaQuery.data,
    slaQuery.isLoading,
    slaQuery.error,
    slaQuery.fetchStatus,
    obligationsQuery.data,
    obligationsQuery.isLoading,
    obligationsQuery.error,
    obligationsQuery.fetchStatus,
    approvalsQuery.data,
    approvalsQuery.isLoading,
    approvalsQuery.error,
    approvalsQuery.fetchStatus,
    renewalsQuery.data,
    renewalsQuery.isLoading,
    renewalsQuery.error,
    renewalsQuery.fetchStatus,
    hearingsQuery.data,
    hearingsQuery.isLoading,
    hearingsQuery.error,
    hearingsQuery.fetchStatus,
    alertsQuery.data,
    alertsQuery.isLoading,
    alertsQuery.error,
    alertsQuery.fetchStatus,
  ]);
}

function slaToAttention(c: SLAClockView, locale: AppLocale): AttentionItem {
  const imminent = c.breach_imminent || c.escalation_imminent;
  return {
    id: `sla:${c.id}`,
    type: 'sla',
    // `service_code` is a raw request-type slug (e.g. "legal_investigation");
    // map it to its localized service label for display.
    title: resolveServiceTypeLabel(c.service_code, locale),
    subtitle:
      c.priority === 'urgent'
        ? resolvePriorityLabel('urgent', locale)
        : undefined,
    href: `/lex/service-desk/${c.legal_request_id}`,
    severity: c.breached ? 'critical' : imminent ? 'high' : 'medium',
    dueAt: c.turnaround_due_at,
    badge: c.escalation_level > 0 ? `L${c.escalation_level}` : undefined,
  };
}

function renewalWarningTitle(
  r: LexContractRenewalWarning,
  locale: AppLocale,
): string {
  if (locale !== 'ar') return r.title;
  if (r.reason === 'renewal_date') {
    return `قرار التجديد مطلوب للعقد «${r.title}»`;
  }
  return `العقد «${r.title}» يقترب من نهاية مدته`;
}

function renewalWarningSubtitle(
  r: LexContractRenewalWarning,
  locale: AppLocale,
): string | undefined {
  const party = r.counterparty?.trim();
  if (!party) return undefined;
  if (locale !== 'ar') return party;
  return `الطرف المقابل: ${party}`;
}

function alertToAttention(
  a: LexComplianceAlert,
  locale: AppLocale,
): AttentionItem {
  const localized = localizeComplianceAlert(a, locale);
  return {
    id: `alert:${a.id}`,
    type: 'alert',
    title: localized.title,
    subtitle: localized.description || undefined,
    href: `/lex/compliance/alerts/${a.id}`,
    severity: a.severity === 'critical' ? 'critical' : 'high',
  };
}

function localizeComplianceAlert(
  alert: LexComplianceAlert,
  locale: AppLocale,
): { title: string; description: string } {
  if (locale !== 'ar') {
    return { title: alert.title, description: alert.description };
  }

  const evidence = alert.evidence ?? {};
  const contractTitle =
    extractQuotedContractTitle(alert.title) ??
    readEvidenceString(evidence, 'contract_title');
  const legacyDays =
    parseEnglishDayCount(alert.title) ??
    parseEnglishDayCount(alert.description);
  const daysUntilExpiry =
    readEvidenceNumber(evidence, 'days_until_expiry') ?? legacyDays;
  const horizonDays =
    readEvidenceNumber(evidence, 'horizon_days') ?? daysUntilExpiry;
  const expiryDate =
    readEvidenceDate(evidence, 'expiry_date') ??
    parseIsoDate(alert.description);
  const renewalDate = readEvidenceDate(evidence, 'renewal_date');
  const ruleType = readEvidenceString(evidence, 'rule_type');

  if (isExpiryAlert(alert, ruleType)) {
    const title = contractTitle
      ? daysUntilExpiry === 0
        ? `العقد «${contractTitle}» تنتهي مدته اليوم`
        : `العقد «${contractTitle}» تنتهي مدته خلال ${formatArabicDays(daysUntilExpiry ?? horizonDays ?? 0)}`
      : alert.title;
    const description = expiryDate
      ? `تنتهي مدة العقد بتاريخ ${expiryDate}، وقد بلغ حد الإشعار المحدد (${formatArabicDays(horizonDays ?? daysUntilExpiry ?? 0)}).`
      : alert.description;
    return { title, description };
  }

  if (isRenewalAlert(alert)) {
    const title = contractTitle
      ? `قرار التجديد مطلوب للعقد «${contractTitle}»`
      : alert.title;
    const description =
      renewalDate && expiryDate
        ? `تاريخ مراجعة التجديد التلقائي هو ${renewalDate} للعقد الذي تنتهي مدته في ${expiryDate}.`
        : alert.description;
    return { title, description };
  }

  if (ruleType === 'missing_clause' && contractTitle) {
    return {
      title: `العقد «${contractTitle}» يفتقد بنودًا قياسية`,
      description: localizeMissingClausesDescription(
        evidence,
        alert.description,
      ),
    };
  }
  if (ruleType === 'risk_threshold' && contractTitle) {
    return {
      title: `العقد عالي المخاطر «${contractTitle}» ليس في حالة المراجعة المطلوبة`,
      description: localizeRiskThresholdDescription(
        evidence,
        alert.description,
      ),
    };
  }
  if (ruleType === 'review_overdue' && contractTitle) {
    return {
      title: `تأخرت مراجعة العقد «${contractTitle}»`,
      description:
        'بقي العقد في المراجعة لمدة تتجاوز اتفاقية مستوى الخدمة المسموح بها.',
    };
  }
  if (ruleType === 'unsigned_contract' && contractTitle) {
    return {
      title: `العقد «${contractTitle}» غير موقّع`,
      description: 'حالة التوقيع لا تستوفي السياسة المعتمدة.',
    };
  }
  if (ruleType === 'value_threshold' && contractTitle) {
    return {
      title: `العقد «${contractTitle}» يتجاوز حد القيمة`,
      description: localizeValueThresholdDescription(
        evidence,
        alert.description,
      ),
    };
  }
  if (ruleType === 'jurisdiction_check' && contractTitle) {
    return {
      title: `العقد «${contractTitle}» يستخدم قانونًا حاكمًا أجنبيًا`,
      description: 'تم تفعيل قاعدة التحقق من الاختصاص.',
    };
  }
  if (ruleType === 'data_protection_required' && contractTitle) {
    return {
      title: `العقد «${contractTitle}» يفتقد بنود حماية البيانات`,
      description:
        'تم العثور على لغة تتعلق بالبيانات الشخصية دون بند لحماية البيانات.',
    };
  }
  if (ruleType === 'custom' && contractTitle) {
    return {
      title: `تم تفعيل قاعدة امتثال مخصصة للعقد «${contractTitle}»`,
      description: 'تطابقت شروط القاعدة المخصصة.',
    };
  }

  const fallbackTitle = humanizeKnownEnglishAlertText(alert.title);
  const fallbackDescription = humanizeKnownEnglishAlertText(alert.description);
  return {
    title: leaksEnglish(fallbackTitle)
      ? 'تنبيه امتثال يحتاج إلى مراجعة'
      : fallbackTitle,
    description: leaksEnglish(fallbackDescription)
      ? 'راجع تفاصيل التنبيه للاطلاع على المعلومات الكاملة.'
      : fallbackDescription,
  };
}

function extractQuotedContractTitle(text: string): string | undefined {
  const quoted = text.match(/[«"]([^»"]+)[»"]/);
  if (quoted?.[1]) return quoted[1].trim();
  const renewal = text.match(/^Renewal decision due for contract\s+(.+)$/i);
  if (renewal?.[1]) return renewal[1].trim();
  return undefined;
}

function readEvidenceString(
  evidence: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = evidence[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readEvidenceNumber(
  evidence: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = evidence[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function readEvidenceDate(
  evidence: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = evidence[key];
  if (typeof value !== 'string') return undefined;
  return parseIsoDate(value);
}

function parseIsoDate(text: string | null | undefined): string | undefined {
  const match = String(text ?? '').match(/\d{4}-\d{2}-\d{2}/);
  return match?.[0];
}

function parseEnglishDayCount(
  text: string | null | undefined,
): number | undefined {
  const match = String(text ?? '').match(
    /\b(?:within|in|horizon)\s+(\d+)(?:-day|\s+days?)\b/i,
  );
  if (!match?.[1]) return undefined;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isExpiryAlert(
  alert: LexComplianceAlert,
  ruleType: string | undefined,
): boolean {
  return (
    ruleType === 'expiry_warning' ||
    Boolean(alert.dedup_key?.startsWith('expiry:')) ||
    /\bContract\s+[«"].+[»"]\s+(?:expires within|expiring in)\s+\d+\s+days?\b/i.test(
      alert.title,
    ) ||
    /\bnotification horizon\b/i.test(alert.description)
  );
}

function isRenewalAlert(alert: LexComplianceAlert): boolean {
  return (
    Boolean(alert.dedup_key?.startsWith('renewal:')) ||
    /^Renewal decision due for contract\b/i.test(alert.title) ||
    /\bAuto-renewal review date\b/i.test(alert.description)
  );
}

function formatArabicDays(n: number): string {
  if (n === 0) return 'اليوم';
  if (n === 1) return 'يوم واحد';
  if (n === 2) return 'يومين';
  if (n >= 3 && n <= 10) return `${n} أيام`;
  return `${n} يومًا`;
}

function localizeMissingClausesDescription(
  evidence: Record<string, unknown>,
  fallback: string,
): string {
  const clauses = evidence.missing_clauses;
  if (Array.isArray(clauses) && clauses.length > 0) {
    return `البنود المفقودة: ${clauses.map(String).join('، ')}`;
  }
  return humanizeKnownEnglishAlertText(fallback);
}

function localizeRiskThresholdDescription(
  evidence: Record<string, unknown>,
  fallback: string,
): string {
  const score = readEvidenceNumber(evidence, 'risk_score');
  const threshold = readEvidenceNumber(evidence, 'risk_threshold');
  const status = readEvidenceString(evidence, 'status');
  if (score !== undefined && threshold !== undefined && status) {
    return `درجة المخاطر ${score.toFixed(2)} تتجاوز ${threshold.toFixed(2)}، بينما الحالة هي ${status}.`;
  }
  return humanizeKnownEnglishAlertText(fallback);
}

function localizeValueThresholdDescription(
  evidence: Record<string, unknown>,
  fallback: string,
): string {
  const value = readEvidenceNumber(evidence, 'contract_value');
  const threshold = readEvidenceNumber(evidence, 'value_threshold');
  if (value !== undefined && threshold !== undefined) {
    return `قيمة العقد ${value.toFixed(2)} تتجاوز ${threshold.toFixed(2)}.`;
  }
  return humanizeKnownEnglishAlertText(fallback);
}

function humanizeKnownEnglishAlertText(text: string): string {
  return text
    .replace(
      /^Expiry warning rule triggered\.$/i,
      'تم تفعيل قاعدة تنبيه انتهاء العقد.',
    )
    .replace(
      /^Contract has remained in review beyond the allowed SLA\.$/i,
      'بقي العقد في المراجعة لمدة تتجاوز اتفاقية مستوى الخدمة المسموح بها.',
    )
    .replace(
      /^Signature status does not satisfy policy\.$/i,
      'حالة التوقيع لا تستوفي السياسة المعتمدة.',
    )
    .replace(
      /^Jurisdiction check rule triggered\.$/i,
      'تم تفعيل قاعدة التحقق من الاختصاص.',
    )
    .replace(
      /^Personal-data language found without a data protection clause\.$/i,
      'تم العثور على لغة تتعلق بالبيانات الشخصية دون بند لحماية البيانات.',
    )
    .replace(
      /^Custom rule conditions matched\.$/i,
      'تطابقت شروط القاعدة المخصصة.',
    );
}

function leaksEnglish(text: string): boolean {
  return /[A-Za-z]{3,}/.test(text);
}

/**
 * Client-derives the soonest future hearings from a page of cases. Each case may
 * carry an embedded `hearings[]`; we pick the nearest upcoming hearing per case.
 */
function upcomingHearings(
  cases: LegalCase[],
  locale: AppLocale,
): AttentionItem[] {
  const now = Date.now();
  const out: AttentionItem[] = [];
  for (const c of cases) {
    const next = (c.hearings ?? [])
      .filter((h) => {
        const t = Date.parse(h.hearing_date);
        return !Number.isNaN(t) && t >= now;
      })
      .sort(
        (a, b) => Date.parse(a.hearing_date) - Date.parse(b.hearing_date),
      )[0];
    if (!next) continue;
    out.push({
      id: `hearing:${next.id}`,
      type: 'hearing',
      title: resolveLocalized(c.title, locale) || c.case_number,
      subtitle: next.location ?? undefined,
      href: `/lex/cases/${c.id}`,
      severity: priorityToSeverity(c.priority, 'medium'),
      dueAt: next.hearing_date,
      badge: c.case_number || undefined,
    });
  }
  return out;
}

function priorityToSeverity(
  priority: string | null | undefined,
  fallback: AttentionSeverity,
): AttentionSeverity {
  switch (priority) {
    case 'critical':
      return 'critical';
    case 'high':
      return 'high';
    case 'medium':
      return 'medium';
    case 'low':
      return 'low';
    default:
      return fallback;
  }
}

function compareAttention(a: AttentionItem, b: AttentionItem): number {
  const s = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
  if (s !== 0) return s;
  const at = a.dueAt ? Date.parse(a.dueAt) : Number.POSITIVE_INFINITY;
  const bt = b.dueAt ? Date.parse(b.dueAt) : Number.POSITIVE_INFINITY;
  return at - bt;
}

/* ------------------------------------------------------------------------- *
 * My Work
 * ------------------------------------------------------------------------- */

/** A single owner-scoped work row, normalized across domains. */
export type WorkItem = {
  id: string;
  domain: string;
  title: string;
  href: string;
  status?: string;
  updatedAt?: string;
};

export interface LexMyWork {
  items: WorkItem[];
  isLoading: boolean;
  /** True when at least one ENABLED owner-scoped source failed. */
  isError: boolean;
  /** Re-runs every enabled owner-scoped source. */
  refetch: () => void;
}

const MY_WORK_PAGE: FetchParams = {
  page: 1,
  per_page: 10,
  sort: 'updated_at',
  order: 'desc',
};

/**
 * The signed-in user's open work across contracts (owner), litigation cases
 * (handling officer) and service-desk requests (requester), merged and sorted by
 * most-recently-updated. Enabled ONLY when `userId` is supplied. Best-effort:
 * each slice is `retry:false` and contributes `[]` on failure.
 */
export function useLexMyWork(userId: string | undefined): LexMyWork {
  const { hasPermission } = useAuth();
  const { locale } = useLocaleOrDefault();
  const enabled = Boolean(userId) && hasPermission('lex:read');

  const contractsQuery = useQuery({
    queryKey: ['lex-command', 'mywork', 'contracts', userId],
    queryFn: () =>
      enterpriseApi.lex.listContracts({
        ...MY_WORK_PAGE,
        filters: { owner_user_id: userId as string },
      }),
    enabled,
    ...SOFT_QUERY,
  });

  const casesQuery = useQuery({
    queryKey: ['lex-command', 'mywork', 'cases', userId],
    queryFn: () =>
      casesApi.listCases({
        ...MY_WORK_PAGE,
        filters: { handling_officer_id: userId as string },
      }),
    enabled,
    ...SOFT_QUERY,
  });

  const requestsQuery = useQuery({
    queryKey: ['lex-command', 'mywork', 'requests', userId],
    queryFn: () =>
      lexRequestsApi.listRequests({
        ...MY_WORK_PAGE,
        filters: { requester_user_id: userId as string },
      }),
    enabled,
    ...SOFT_QUERY,
  });

  return useMemo<LexMyWork>(() => {
    const items: WorkItem[] = [];

    for (const c of contractsQuery.data?.data ?? []) {
      items.push(contractToWork(c));
    }
    for (const c of casesQuery.data?.data ?? []) {
      items.push({
        id: `case:${c.id}`,
        domain: 'litigation_cases',
        title: resolveLocalized(c.title, locale) || c.case_number,
        href: `/lex/cases/${c.id}`,
        status: c.status,
        updatedAt: c.updated_at,
      });
    }
    for (const r of requestsQuery.data?.data ?? []) {
      items.push(requestToWork(r, locale));
    }

    items.sort((a, b) => {
      const at = a.updatedAt ? Date.parse(a.updatedAt) : 0;
      const bt = b.updatedAt ? Date.parse(b.updatedAt) : 0;
      return bt - at;
    });

    const queries = [contractsQuery, casesQuery, requestsQuery];
    return {
      items,
      isLoading: queries.some((q) => q.isLoading && q.fetchStatus !== 'idle'),
      isError: queries.some((q) => q.isError),
      refetch: () => {
        for (const q of queries) void q.refetch();
      },
    };
    // Granular field deps (see needs-attention note) — query objects are
    // re-created each render so depending on them would defeat the memo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    locale,
    contractsQuery.data,
    contractsQuery.isLoading,
    contractsQuery.isError,
    contractsQuery.fetchStatus,
    casesQuery.data,
    casesQuery.isLoading,
    casesQuery.isError,
    casesQuery.fetchStatus,
    requestsQuery.data,
    requestsQuery.isLoading,
    requestsQuery.isError,
    requestsQuery.fetchStatus,
  ]);
}

function contractToWork(c: LexContractRecord): WorkItem {
  return {
    id: `contract:${c.id}`,
    domain: 'contracts',
    title: c.title,
    href: `/lex/contracts/${c.id}`,
    status: c.status,
    updatedAt: c.updated_at,
  };
}

function requestToWork(r: LegalRequest, locale: AppLocale): WorkItem {
  return {
    id: `request:${r.id}`,
    domain: 'service_desk',
    title: resolveLocalized(r.title, locale) || r.request_number,
    href: `/lex/service-desk/${r.id}`,
    status: r.status,
    updatedAt: r.updated_at,
  };
}
