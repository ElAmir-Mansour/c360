/**
 * Normalized DATA MODEL for the per-role Lex landing dashboards.
 *
 * This composes the existing fail-soft command-center hooks (`useLexCommandKpis`,
 * `useLexDomainCounts`, `useLexNeedsAttention`, `useLexOverviewDashboard`,
 * `useLexMyWork`) plus two small targeted fetches (recent requests, total SLA
 * clocks for the compliance %) into ONE `RoleDashboardModel` that the role
 * dashboard widgets read from. No widget issues its own fetch; every slice is
 * independently gated + `retry:false`, so a forbidden/failing domain contributes
 * an empty/zero value and never blocks the rest.
 *
 * Every value here is REAL backend data (or a transparent derivation of it — the
 * cross-domain distribution and the SLA-compliance % are derived from live
 * counts, annotated where they are).
 *
 * Each slice carries THREE independent signals, not one: `isLoading`, `isError`
 * and (for KPIs) `isAvailable`. They are deliberately orthogonal so a panel can
 * gate on error BEFORE loading — a slice that failed reports
 * `{ isLoading: false, isError: true }`, never a skeleton that resolves to
 * nothing. A slice the caller is not permissioned for reports
 * `{ isLoading: false, isError: false }` (and `isAvailable: false` for a KPI):
 * fail-soft is not an error, so it must never surface a retry affordance.
 */

'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { useAuth } from '@/hooks/use-auth';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { resolveLocalized } from '@/lib/i18n/localized';
import { enterpriseApi } from '@/lib/enterprise/api';
import { lexRequestsApi, type RequestStatus } from '@/lib/lex/requests';
import { isApiError } from '@/types/api';
import type { FetchParams } from '@/types/table';

import { resolveRequestStatusLabel } from '../../service-desk/_components/lex-enums-i18n';
import { useInbox, type InboxData } from '../../inbox/_lib/use-inbox';
import {
  getWorkforceReport,
  type WorkforceReport,
} from '../../_components/role-dashboard/widgets/workforce-contract';

import {
  useLexCommandKpis,
  useLexDomainCounts,
  useLexNeedsAttention,
  useLexOverviewDashboard,
  useLexMyWork,
  type AttentionSeverity,
  type DomainCount,
  type WorkItem,
} from '../use-lex-command-center';

const SOFT = { staleTime: 60_000, retry: false as const };
const COUNT_PARAMS: FetchParams = { page: 1, per_page: 1 };
const RECENT_PARAMS: FetchParams = { page: 1, per_page: 6 };

/** The full catalog of KPI keys any role dashboard may surface. */
export type KpiKey =
  | 'totalRequests'
  | 'pendingRequests'
  | 'slaCompliance'
  | 'activeLitigations'
  | 'contractsUnderReview'
  | 'activeContracts'
  | 'openMatters'
  | 'overdueObligations'
  | 'pendingApprovals'
  | 'slaBreaches'
  | 'openAlerts'
  | 'complianceScore'
  | 'consultations'
  | 'investigations'
  | 'settlements'
  | 'expiringContracts'
  | 'highRiskContracts'
  | 'myOpenItems';

/**
 * Failure + retry controls carried by every slice of {@link RoleDashboardModel}
 * alongside its `isLoading` flag.
 *
 * The pair exists so a panel can evaluate `error → loading → empty → ready` in
 * that order. Gating on `isLoading` first is the known stuck-skeleton bug class:
 * a failed react-query slice settles with `isLoading:false` and no data, which a
 * loading-first panel renders as an empty list forever.
 */
export interface SliceStatus {
  /**
   * True ONLY when a source query for this slice FAILED. An ungated slice — the
   * caller lacks the permission, so the query never runs — stays `false`.
   */
  isError: boolean;
  /**
   * Re-runs the slice's source queries. Always callable (a no-op-ish retry on a
   * disabled query is harmless), so panels never need a null check.
   */
  refetch: () => void;
}

export interface KpiDatum {
  /** Live value; `null` while loading or when the source is ungated/failed. */
  value: number | null;
  isLoading: boolean;
  isAvailable: boolean;
  /**
   * True ONLY when the KPI's source failed. `isAvailable:false` covers BOTH the
   * ungated case and the failed one; this flag separates them so a permission-
   * masked KPI degrades to a dash while a failed one can offer a retry.
   */
  isError: boolean;
}

/**
 * A contextual caption for a KPI, computed from REAL data (e.g. "3 hearings
 * scheduled"). When present it overrides the card's tone-derived caption. Only
 * set for KPIs where genuine context exists — KPIs needing history we don't
 * track keep the honest tone caption instead of a fabricated stat.
 */
export interface KpiCaptionSpec {
  key: string;
  vars?: Record<string, string>;
  tone: 'neutral' | 'success' | 'warning' | 'error';
}

export interface DonutSlice {
  key: string;
  value: number;
}

export interface BarDatum {
  key: string;
  value: number;
  /** 'count' | 'percent' — how the bar's value should be formatted. */
  unit: 'count' | 'percent';
}

export interface RequestListItem {
  id: string;
  title: string;
  reference: string;
  subtitle: string;
  status: string;
  /** Localized status label (resolved once, in the active locale). */
  statusLabel: string;
  href: string;
}

export interface EscalationItem {
  id: string;
  title: string;
  severity: AttentionSeverity;
  dueAt?: string;
  href: string;
}

/** One bar of the Escalation & Risk Warnings chart: a severity tier + its count. */
export interface SeverityDatum {
  severity: AttentionSeverity;
  count: number;
}

/** Severity tiers ordered most→least severe (bar order in the risk chart). */
const SEVERITY_ORDER: AttentionSeverity[] = ['critical', 'high', 'medium', 'low', 'info'];

export interface RoleDashboardModel {
  kpis: Record<KpiKey, KpiDatum>;
  /** Contextual captions (from real data) that override a KPI's tone caption. */
  kpiCaptions: Partial<Record<KpiKey, KpiCaptionSpec>>;
  recentRequests: { items: RequestListItem[]; isLoading: boolean } & SliceStatus;
  distribution: {
    slices: DonutSlice[];
    total: number;
    isLoading: boolean;
  } & SliceStatus;
  workloadByArea: { bars: BarDatum[]; isLoading: boolean } & SliceStatus;
  contractStatusMix: { bars: BarDatum[]; isLoading: boolean } & SliceStatus;
  resolutionRates: { bars: BarDatum[]; isLoading: boolean } & SliceStatus;
  escalations: {
    items: EscalationItem[];
    /** Severity breakdown over ALL needs-attention items (the risk chart). */
    bySeverity: SeverityDatum[];
    /** Total needs-attention/risk items charted. */
    total: number;
    isLoading: boolean;
  } & SliceStatus;
  myWork: { items: WorkItem[]; isLoading: boolean } & SliceStatus;
  /** Actor-scoped decisions, enabled only for the Cases Manager dashboard. */
  decisions: InboxData;
  teamPerformance: {
    report: WorkforceReport | null;
    isLoading: boolean;
    /** Hidden sources are permission/role masked or unsupported, not errors. */
    isHidden: boolean;
  } & SliceStatus;
  /** Per-domain live counts, keyed by domain id (for the folded-in domain nav). */
  domainCounts: Record<string, DomainCount>;
}

/**
 * Domain counts the cross-domain distribution donut actually reads. Its error +
 * retry signal is scoped to exactly these, so an unrelated failing count (say
 * `playbooks`) never turns a healthy donut into an error panel. `isLoading`
 * predates this and deliberately keeps its broader watch over every count.
 */
const DISTRIBUTION_COUNT_DOMAINS = [
  'contracts',
  'consultations',
  'litigation_cases',
  'investigations',
  'settlements',
  'matters',
] as const;

const EMPTY_KPI: KpiDatum = {
  value: null,
  isLoading: false,
  isAvailable: false,
  isError: false,
};

function kpiFrom(source: {
  value: number;
  isLoading: boolean;
  isAvailable: boolean;
  isError: boolean;
}): KpiDatum {
  return {
    value: source.isAvailable ? source.value : null,
    isLoading: source.isLoading,
    isAvailable: source.isAvailable,
    isError: source.isError,
  };
}

function countKpi(c: DomainCount | undefined): KpiDatum {
  if (!c) return EMPTY_KPI;
  return {
    value: c.count,
    isLoading: c.isLoading,
    isAvailable: c.count !== null,
    // A domain with no count query behind it can never be in error.
    isError: c.isError ?? false,
  };
}

const INVISIBLE_WORKFORCE_STATUSES = new Set([0, 403, 404, 501]);

/**
 * Workforce is an optional SaaS capability. Missing entitlement, unsupported
 * deployments and network reachability must not displace the rest of the
 * legal-director dashboard with an error panel.
 */
export function isInvisibleWorkforceError(error: unknown): boolean {
  return isApiError(error) && INVISIBLE_WORKFORCE_STATUSES.has(error.status);
}

/**
 * useRoleDashboardData composes every live source into the normalized model the
 * role dashboards render from. Safe to call on the `/lex` landing for any role;
 * ungated slices simply resolve unavailable.
 */
export function useRoleDashboardData(roleSlug?: string | null): RoleDashboardModel {
  const { user, hasPermission } = useAuth();
  const { locale } = useLocaleOrDefault();
  const normalizedRole = roleSlug?.replace(/_/g, '-');

  const kpis = useLexCommandKpis();
  const counts = useLexDomainCounts();
  const attention = useLexNeedsAttention();
  const dashboard = useLexOverviewDashboard();
  const myWork = useLexMyWork(user?.id);
  const decisions = useInbox(normalizedRole === 'legal-cases-manager');

  const canViewRequests = hasPermission('lex:request:view');

  // Recent service requests (list panel).
  const recent = useQuery({
    queryKey: ['role-dash', 'recent-requests'],
    queryFn: () => lexRequestsApi.listRequests(RECENT_PARAMS),
    enabled: canViewRequests,
    ...SOFT,
  });

  // Total SLA clocks — paired with the breached count (already in kpis) to
  // derive an SLA-compliance %. Real data, transparently derived.
  const slaTotal = useQuery({
    queryKey: ['role-dash', 'sla-total'],
    queryFn: () => lexRequestsApi.listSlaClocks(COUNT_PARAMS).then((r) => r.meta.total),
    enabled: canViewRequests,
    ...SOFT,
  });

  // Cross-domain resolution rates (percent bars) — gated on report/read access.
  const canViewReports = hasPermission('lex:report:read') || hasPermission('lex:read');
  const resolution = useQuery({
    queryKey: ['role-dash', 'resolution-rates'],
    queryFn: () => enterpriseApi.lex.getResolutionRates(),
    enabled: canViewReports,
    ...SOFT,
  });

  // Legal-director-only optional capability. The role and permission checks
  // happen here at the dashboard header level; the panel remains presentation
  // only and never owns a request.
  const canViewWorkforce = normalizedRole === 'legal-director'
    && hasPermission('lex:workforce:read');
  const workforce = useQuery({
    queryKey: ['role-dash', 'workforce', 'org'],
    queryFn: () => getWorkforceReport({ scope: 'org' }),
    enabled: canViewWorkforce,
    ...SOFT,
  });

  // react-query binds `refetch` once per query observer, so these references are
  // stable across renders and safe to detach and close over from the memo.
  const refetchDashboard = dashboard.refetch;
  const refetchRecent = recent.refetch;
  const refetchResolution = resolution.refetch;
  const refetchWorkforce = workforce.refetch;

  return useMemo<RoleDashboardModel>(() => {
    // ── SLA compliance % (derived) ──────────────────────────────────────────
    const total = slaTotal.data ?? 0;
    const breached = kpis.slaBreaches.isAvailable ? kpis.slaBreaches.value : 0;
    const slaComplianceAvailable = kpis.slaBreaches.isAvailable && slaTotal.data !== undefined;
    const slaCompliance: KpiDatum = {
      value: slaComplianceAvailable
        ? total > 0
          ? Math.round(((total - breached) / total) * 100)
          : 100
        : null,
      isLoading: kpis.slaBreaches.isLoading || slaTotal.isLoading,
      isAvailable: slaComplianceAvailable,
      // Either leg failing makes the derived percentage unreportable.
      isError: kpis.slaBreaches.isError || slaTotal.isError,
    };

    const dash = dashboard.data;
    const dashLoading = dashboard.isLoading;
    const dashError = dashboard.isError;
    const dashKpi = (v: number | undefined): KpiDatum =>
      dash
        ? { value: v ?? 0, isLoading: false, isAvailable: true, isError: false }
        : { value: null, isLoading: dashLoading, isAvailable: false, isError: dashError };

    const kpiMap: Record<KpiKey, KpiDatum> = {
      totalRequests: countKpi(counts.service_desk),
      pendingRequests: kpiFrom(kpis.pendingApprovals),
      slaCompliance,
      activeLitigations: countKpi(counts.litigation_cases),
      contractsUnderReview: dashKpi(dash?.kpis.pending_review),
      activeContracts: kpiFrom(kpis.activeContracts),
      openMatters: kpiFrom(kpis.openMatters),
      overdueObligations: kpiFrom(kpis.overdueObligations),
      pendingApprovals: kpiFrom(kpis.pendingApprovals),
      slaBreaches: kpiFrom(kpis.slaBreaches),
      openAlerts: kpiFrom(kpis.openAlerts),
      complianceScore: kpiFrom(kpis.complianceScore),
      consultations: countKpi(counts.consultations),
      investigations: countKpi(counts.investigations),
      settlements: countKpi(counts.settlements),
      expiringContracts: dashKpi(dash?.kpis.expiring_in_30_days),
      highRiskContracts: dashKpi(dash?.kpis.high_risk_contracts),
      myOpenItems: {
        value: myWork.items.length,
        isLoading: myWork.isLoading,
        isAvailable: Boolean(user?.id),
        isError: myWork.isError,
      },
    };

    // ── Recent requests → list rows ─────────────────────────────────────────
    const recentItems: RequestListItem[] = (recent.data?.data ?? []).slice(0, 6).map((req) => ({
      id: req.id,
      title: resolveLocalized(req.title, locale) || req.request_number,
      reference: req.request_number,
      subtitle: req.department?.trim() || req.request_type,
      status: req.status,
      statusLabel: resolveRequestStatusLabel(req.status as RequestStatus, locale),
      href: `/lex/service-desk/${req.id}`,
    }));

    // ── Cross-domain distribution (derived from live counts) ────────────────
    const slice = (key: string, ...cs: Array<{ count: number | null } | undefined>) => {
      const sum = cs.reduce((acc, c) => acc + (c?.count ?? 0), 0);
      return { key, value: sum };
    };
    const distributionSlices: DonutSlice[] = [
      { key: 'contracts', value: (dash?.kpis.active_contracts ?? counts.contracts?.count) ?? 0 },
      slice('consultations', counts.consultations),
      slice('litigations', counts.litigation_cases),
      slice('others', counts.investigations, counts.settlements, counts.matters),
    ].filter((s) => s.value > 0);
    const distributionTotal = distributionSlices.reduce((a, s) => a + s.value, 0);

    // ── Workload by area (real: needs-attention byType counts) ──────────────
    const workloadBars: BarDatum[] = (
      [
        ['sla', attention.byType.sla?.length ?? 0],
        ['obligations', attention.byType.obligation?.length ?? 0],
        ['approvals', attention.byType.approval?.length ?? 0],
        ['renewals', attention.byType.renewal?.length ?? 0],
        ['hearings', attention.byType.hearing?.length ?? 0],
        ['alerts', attention.byType.alert?.length ?? 0],
      ] as const
    ).map(([key, value]) => ({ key, value, unit: 'count' as const }));

    // ── Contract status mix (real: dashboard.contracts_by_status) ───────────
    const statusMix: BarDatum[] = Object.entries(dash?.contracts_by_status ?? {})
      .map(([key, value]) => ({ key, value, unit: 'count' as const }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);

    // ── Resolution rates (real: /reports/resolution-rates, fixed order) ─────
    const resolutionBars: BarDatum[] = (resolution.data?.categories ?? []).map((c) => ({
      key: c.key,
      value: c.rate,
      unit: 'percent' as const,
    }));

    // ── Escalations (real: needs-attention, highest severity first) ─────────
    const escalationItems: EscalationItem[] = attention.items
      .filter((i) => i.severity === 'critical' || i.severity === 'high')
      .slice(0, 6)
      .map((i) => ({
        id: i.id,
        title: i.title,
        severity: i.severity,
        dueAt: i.dueAt,
        href: i.href,
      }));

    // Severity breakdown over ALL needs-attention items — the "Escalation & Risk
    // Warnings" chart. Ordered most→least severe; tiers with no items are dropped
    // so the chart never shows an empty bar.
    const severityCounts = attention.items.reduce<Record<string, number>>((acc, i) => {
      acc[i.severity] = (acc[i.severity] ?? 0) + 1;
      return acc;
    }, {});
    const escalationSeverity: SeverityDatum[] = SEVERITY_ORDER.map((severity) => ({
      severity,
      count: severityCounts[severity] ?? 0,
    })).filter((d) => d.count > 0);

    // ── Contextual KPI captions (REAL data only) ────────────────────────────
    // Active Litigations → "{n} hearings scheduled" from the live upcoming-
    // hearings feed. Other KPIs whose mockup captions need history we do not
    // track (MoM growth, vs-last-quarter, avg turnaround) keep the honest
    // tone-derived caption rather than a fabricated stat.
    const hearingsScheduled = attention.byType.hearing?.length ?? 0;
    const kpiCaptions: Partial<Record<KpiKey, KpiCaptionSpec>> = {};
    if (hearingsScheduled > 0) {
      kpiCaptions.activeLitigations = {
        key: 'cap.hearingsScheduled',
        vars: { n: String(hearingsScheduled) },
        tone: 'neutral',
      };
    }

    // ── Per-slice failure + retry wiring ────────────────────────────────────
    // Every slice points at the query (or set of queries) it actually reads, so
    // `isError` is never borrowed from an unrelated source and `refetch` re-runs
    // exactly what failed. A disabled (ungated) query reports `isError:false`,
    // which is what keeps permission masking fail-soft rather than an error.
    const distributionCounts = DISTRIBUTION_COUNT_DOMAINS.map((id) => counts[id]);
    const refetchDistribution = () => {
      void refetchDashboard();
      for (const c of distributionCounts) c?.refetch?.();
    };
    const workforceHiddenError = isInvisibleWorkforceError(workforce.error);

    return {
      kpis: kpiMap,
      kpiCaptions,
      recentRequests: {
        items: recentItems,
        isLoading: recent.isLoading,
        isError: recent.isError,
        refetch: refetchRecent,
      },
      distribution: {
        slices: distributionSlices,
        total: distributionTotal,
        isLoading: dashboard.isLoading || Object.values(counts).some((c) => c.isLoading),
        isError: dashboard.isError || distributionCounts.some((c) => c?.isError === true),
        refetch: refetchDistribution,
      },
      workloadByArea: {
        bars: workloadBars,
        isLoading: attention.isLoading,
        isError: attention.isError,
        refetch: attention.refetch,
      },
      contractStatusMix: {
        bars: statusMix,
        isLoading: dashboard.isLoading,
        isError: dashboard.isError,
        refetch: refetchDashboard,
      },
      resolutionRates: {
        bars: resolutionBars,
        isLoading: resolution.isLoading,
        isError: resolution.isError,
        refetch: refetchResolution,
      },
      escalations: {
        items: escalationItems,
        bySeverity: escalationSeverity,
        total: attention.items.length,
        isLoading: attention.isLoading,
        isError: attention.isError,
        refetch: attention.refetch,
      },
      myWork: {
        items: myWork.items,
        isLoading: myWork.isLoading,
        isError: myWork.isError,
        refetch: myWork.refetch,
      },
      decisions,
      teamPerformance: {
        report: workforce.data ?? null,
        isLoading: canViewWorkforce && workforce.isLoading,
        isError: workforce.isError && !workforceHiddenError,
        isHidden: !canViewWorkforce || workforceHiddenError,
        refetch: refetchWorkforce,
      },
      domainCounts: counts,
    };
  }, [
    kpis,
    counts,
    attention,
    dashboard.data,
    dashboard.isLoading,
    dashboard.isError,
    refetchDashboard,
    myWork,
    decisions,
    recent.data,
    recent.isLoading,
    recent.isError,
    refetchRecent,
    slaTotal.data,
    slaTotal.isLoading,
    slaTotal.isError,
    resolution.data,
    resolution.isLoading,
    resolution.isError,
    refetchResolution,
    canViewWorkforce,
    workforce.data,
    workforce.error,
    workforce.isLoading,
    workforce.isError,
    refetchWorkforce,
    user?.id,
    locale,
  ]);
}
