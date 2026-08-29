'use client';

/**
 * Data layer for the consolidated Risk Register — the relationship core of the
 * Risk Portfolio page.
 *
 * "Risk" is not a first-class entity in Lex; it is a per-record attribute carried
 * by every legal domain on its own scale. This hook fans out to the existing list
 * endpoints of all risk-bearing domains (contracts, cases, requests,
 * investigations, consultations, settlements) plus obligations + compliance
 * (rules/alerts), and `buildRiskRegister()` normalizes them into ONE roster of
 * {@link RiskRecord}s with a shared severity band and — for the domains where the
 * join keys actually exist — the explicit relationship legs the user asked for:
 *
 *     Risk record  ──▶  its Obligations        (obligation.contract_id === contract.id)
 *                  ──▶  its Controls + failing  (compliance rules ∩ contract.type; active alerts by contract_id)
 *
 * The chain "risk → obligations → controls → failing" is a FAN-OUT (two parallel
 * legs), not a linear chain — there is no obligation→control link in the data.
 * Only CONTRACTS carry both legs on real foreign keys; cases carry graded risk but
 * no downstream link; requests/investigations/consultations are priority-only;
 * settlements carry value only. Records without real legs set
 * `relationsAvailable=false` and render an honest "no linked …" state rather than
 * fabricating relationships. Everything is assembled CLIENT-SIDE — no endpoints
 * are invented.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchSuitePaginated } from '@/lib/suite-api';
import type { FetchParams } from '@/types/table';
import type {
  LexContract,
  LexObligation,
  LexComplianceAlert,
  LexComplianceRule,
} from '@/types/suites';
import { riskBandForScore } from './risk-labels';

/** Pull a generous page so client-side aggregation is representative. */
const REGISTER_PAGE_SIZE = 200;

/** Compliance-alert statuses that count as an active ("failing") finding. */
const ACTIVE_ALERT_STATUSES: ReadonlySet<string> = new Set([
  'open',
  'acknowledged',
  'investigating',
]);

/** Obligation statuses that are still outstanding. */
const OPEN_OBLIGATION_STATUSES: ReadonlySet<string> = new Set([
  'open',
  'in_progress',
  'blocked',
]);

export type RiskSeverity = 'critical' | 'high' | 'medium' | 'low' | 'none';
export type RiskDomain =
  | 'contract'
  | 'case'
  | 'request'
  | 'investigation'
  | 'consultation'
  | 'settlement';

/** Where a record's severity band was derived from (for honest labelling). */
export type SeveritySource = 'score' | 'rating' | 'priority' | 'sla' | 'value' | 'none';

export type ComplianceStatus = 'healthy' | 'watch' | 'at_risk' | 'none';

/** One row in an expanded relationship leg (obligation or control/alert). */
export interface RiskRelationLink {
  id: string;
  label: string;
  status?: string;
  /** Secondary line (owner, due-in, rule name, severity). */
  sub?: string;
  /** Deep link to the related object, when one exists. */
  href?: string;
  overdue?: boolean;
}

export interface RiskRecord {
  /** Stable cross-domain key: `${domain}:${id}`. */
  key: string;
  id: string;
  domain: RiskDomain;
  title: string;
  reference?: string;
  status?: string;
  severity: RiskSeverity;
  severitySource: SeveritySource;
  /** Numeric 0–100 score when the domain has one (contracts). */
  score?: number | null;
  /** Monetary value / exposure in SAR, when the domain carries one. */
  value?: number | null;
  href?: string;

  /** Obligations leg. */
  obligations: RiskRelationLink[];
  obligationOpen: number;
  obligationOverdue: number;

  /** Controls / compliance leg. */
  controlCount: number;
  failingCount: number;
  controls: RiskRelationLink[];
  compliance: ComplianceStatus;

  /** True only when this domain's relationship legs rest on real join keys. */
  relationsAvailable: boolean;
}

export interface RiskRegisterSummary {
  total: number;
  byDomain: Record<RiskDomain, number>;
  criticalHigh: number;
  totalOpenObligations: number;
  totalOverdueObligations: number;
  totalControls: number;
  totalFailing: number;
  valueAtRisk: number;
}

/* ------------------------------------------------------------------------- *
 * Minimal, defensive shape for the priority-only / value-only domains. We only
 * read a handful of fields, tolerant of each domain's naming, so the register
 * never depends on six exact domain schemas.
 * ------------------------------------------------------------------------- */
export interface RawDomainRecord {
  id: string;
  title?: string | null;
  title_en?: string | null;
  name?: string | null;
  subject?: string | null;
  reference?: string | null;
  reference_number?: string | null;
  case_number?: string | null;
  request_number?: string | null;
  status?: string | null;
  priority?: string | null;
  risk_rating?: string | null;
  severity?: string | null;
  sla_status?: string | null;
  sla_outcome?: string | null;
  total_value?: number | null;
  value?: number | null;
  amount?: number | null;
  risk_exposure_value?: number | null;
}

/* ------------------------------------------------------------------------- *
 * Pure normalizers
 * ------------------------------------------------------------------------- */

function severityFromContract(c: LexContract): { severity: RiskSeverity; source: SeveritySource } {
  const band = riskBandForScore(c.risk_score ?? null, c.risk_level ?? null);
  if (band == null) return { severity: 'none', source: 'none' };
  if (c.risk_level === 'critical' || (typeof c.risk_score === 'number' && c.risk_score >= 85)) {
    return { severity: 'critical', source: 'score' };
  }
  return { severity: band, source: 'score' };
}

function severityFromRating(rating: string | null | undefined): RiskSeverity {
  switch ((rating ?? '').toLowerCase()) {
    case 'critical':
      return 'critical';
    case 'high':
      return 'high';
    case 'medium':
      return 'medium';
    case 'low':
      return 'low';
    default:
      return 'none';
  }
}

function severityFromPriority(priority: string | null | undefined): RiskSeverity {
  switch ((priority ?? '').toLowerCase()) {
    case 'urgent':
    case 'critical':
      return 'critical';
    case 'high':
      return 'high';
    case 'medium':
    case 'normal':
      return 'medium';
    case 'low':
      return 'low';
    default:
      return 'none';
  }
}

function firstString(...vals: Array<string | null | undefined>): string | undefined {
  for (const v of vals) {
    if (typeof v === 'string' && v.trim().length > 0) return v.trim();
  }
  return undefined;
}

function firstNumber(...vals: Array<number | null | undefined>): number | null {
  for (const v of vals) {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return null;
}

function complianceStatusFor(controlCount: number, failing: number): ComplianceStatus {
  if (controlCount === 0 && failing === 0) return 'none';
  if (failing >= 2) return 'at_risk';
  if (failing === 1) return 'watch';
  return 'healthy';
}

/* ------------------------------------------------------------------------- *
 * The builder — pure and deterministic given a `now` (injected for testability).
 * ------------------------------------------------------------------------- */

export interface BuildRegisterInputs {
  contracts: LexContract[];
  obligations: LexObligation[];
  rules: LexComplianceRule[];
  alerts: LexComplianceAlert[];
  cases: RawDomainRecord[];
  requests: RawDomainRecord[];
  investigations: RawDomainRecord[];
  consultations: RawDomainRecord[];
  settlements: RawDomainRecord[];
  now?: Date;
}

export function buildRiskRegister(inputs: BuildRegisterInputs): {
  records: RiskRecord[];
  summary: RiskRegisterSummary;
} {
  const {
    contracts,
    obligations,
    rules,
    alerts,
    cases,
    requests,
    investigations,
    consultations,
    settlements,
    now = new Date(),
  } = inputs;

  /* --- index obligations by contract ------------------------------------- */
  const obligationsByContract = new Map<string, LexObligation[]>();
  for (const o of obligations) {
    if (!o.contract_id) continue;
    const list = obligationsByContract.get(o.contract_id) ?? [];
    list.push(o);
    obligationsByContract.set(o.contract_id, list);
  }

  /* --- index active alerts by contract ----------------------------------- */
  const alertsByContract = new Map<string, LexComplianceAlert[]>();
  for (const a of alerts) {
    if (!a.contract_id || !ACTIVE_ALERT_STATUSES.has(a.status)) continue;
    const list = alertsByContract.get(a.contract_id) ?? [];
    list.push(a);
    alertsByContract.set(a.contract_id, list);
  }

  /** Applicable controls (rules) for a contract type: empty scope = all types. */
  const enabledRules = rules.filter((r) => r.enabled);
  const controlCountForType = (type: string | null | undefined): number =>
    enabledRules.filter(
      (r) => r.contract_types.length === 0 || (type != null && r.contract_types.includes(type)),
    ).length;

  const records: RiskRecord[] = [];

  /* --- contracts: the ONLY domain with both real legs -------------------- */
  for (const c of contracts) {
    const { severity, source } = severityFromContract(c);
    const linkedObligations = obligationsByContract.get(c.id) ?? [];
    const openObl = linkedObligations.filter((o) => OPEN_OBLIGATION_STATUSES.has(String(o.status)));
    const overdueObl = openObl.filter((o) => o.days_until_due < 0);
    const activeAlerts = alertsByContract.get(c.id) ?? [];
    const controlCount = controlCountForType(c.type);
    const failing = activeAlerts.length;

    records.push({
      key: `contract:${c.id}`,
      id: c.id,
      domain: 'contract',
      title: firstString(c.title) ?? c.id,
      reference: firstString(c.contract_number) ?? undefined,
      status: c.status,
      severity,
      severitySource: source,
      score: typeof c.risk_score === 'number' ? c.risk_score : null,
      value: firstNumber(c.total_value),
      href: `/lex/contracts/${c.id}`,
      obligations: openObl.map((o) => ({
        id: o.id,
        label: firstString(o.title) ?? o.id,
        status: String(o.status),
        sub: o.owner_name || undefined,
        href: `/lex/obligations?highlight=${o.id}`,
        overdue: o.days_until_due < 0,
      })),
      obligationOpen: openObl.length,
      obligationOverdue: overdueObl.length,
      controlCount,
      failingCount: failing,
      controls: activeAlerts.map((a) => ({
        id: a.id,
        label: firstString(a.title) ?? a.id,
        status: a.status,
        sub: a.severity,
        href: `/lex/compliance?alert=${a.id}`,
      })),
      compliance: complianceStatusFor(controlCount, failing),
      relationsAvailable: true,
    });
  }

  /* --- cases: graded risk, no downstream legs ---------------------------- */
  for (const r of cases) {
    records.push(rosterRecord('case', r, severityFromRating(r.risk_rating), 'rating', `/lex/cases/${r.id}`, r.risk_exposure_value));
  }
  for (const r of requests) {
    records.push(rosterRecord('request', r, severityFromPriority(r.priority), 'priority', `/lex/service-desk/${r.id}`));
  }
  for (const r of investigations) {
    const sev = severityFromRating(r.severity) !== 'none'
      ? severityFromRating(r.severity)
      : severityFromPriority(r.priority);
    records.push(rosterRecord('investigation', r, sev, r.severity ? 'rating' : 'priority', `/lex/investigations/${r.id}`));
  }
  for (const r of consultations) {
    const slaBreached = (r.sla_status ?? r.sla_outcome ?? '').toLowerCase().includes('breach');
    const sev = slaBreached ? 'high' : severityFromPriority(r.priority);
    records.push(rosterRecord('consultation', r, sev, slaBreached ? 'sla' : 'priority', `/lex/consultations/${r.id}`));
  }
  for (const r of settlements) {
    records.push(rosterRecord('settlement', r, 'none', 'none', `/lex/settlements/${r.id}`, r.value ?? r.total_value ?? r.amount));
  }

  /* --- summary ----------------------------------------------------------- */
  const byDomain: Record<RiskDomain, number> = {
    contract: 0, case: 0, request: 0, investigation: 0, consultation: 0, settlement: 0,
  };
  let criticalHigh = 0;
  let totalOpenObligations = 0;
  let totalOverdueObligations = 0;
  let totalControls = 0;
  let totalFailing = 0;
  let valueAtRisk = 0;
  for (const rec of records) {
    byDomain[rec.domain] += 1;
    if (rec.severity === 'critical' || rec.severity === 'high') {
      criticalHigh += 1;
      if (rec.value) valueAtRisk += rec.value;
    }
    totalOpenObligations += rec.obligationOpen;
    totalOverdueObligations += rec.obligationOverdue;
    totalControls += rec.controlCount;
    totalFailing += rec.failingCount;
  }

  // Rank: severity desc, then failing controls, then overdue obligations.
  const SEV_RANK: Record<RiskSeverity, number> = { critical: 4, high: 3, medium: 2, low: 1, none: 0 };
  records.sort((a, b) => {
    if (SEV_RANK[b.severity] !== SEV_RANK[a.severity]) return SEV_RANK[b.severity] - SEV_RANK[a.severity];
    if (b.failingCount !== a.failingCount) return b.failingCount - a.failingCount;
    return b.obligationOverdue - a.obligationOverdue;
  });

  return {
    records,
    summary: {
      total: records.length,
      byDomain,
      criticalHigh,
      totalOpenObligations,
      totalOverdueObligations,
      totalControls,
      totalFailing,
      valueAtRisk,
    },
  };
}

function rosterRecord(
  domain: RiskDomain,
  r: RawDomainRecord,
  severity: RiskSeverity,
  source: SeveritySource,
  href: string,
  value?: number | null,
): RiskRecord {
  return {
    key: `${domain}:${r.id}`,
    id: r.id,
    domain,
    title: firstString(r.title, r.title_en, r.name, r.subject) ?? r.id,
    reference: firstString(r.reference, r.reference_number, r.case_number, r.request_number),
    status: firstString(r.status),
    severity,
    severitySource: source,
    value: firstNumber(value, r.value, r.total_value, r.amount),
    href,
    obligations: [],
    obligationOpen: 0,
    obligationOverdue: 0,
    controlCount: 0,
    failingCount: 0,
    controls: [],
    compliance: 'none',
    relationsAvailable: false,
  };
}

/* ------------------------------------------------------------------------- *
 * The page-facing hook.
 * ------------------------------------------------------------------------- */

function bestEffortList<T>(key: string, path: string, params: FetchParams) {
  return {
    queryKey: ['lex-risk-register', key],
    queryFn: () => fetchSuitePaginated<T>(path, params),
    retry: false,
  } as const;
}

const LIST_PARAMS: FetchParams = { page: 1, per_page: REGISTER_PAGE_SIZE, sort: 'updated_at', order: 'desc' };

export interface UseRiskRegisterResult {
  records: RiskRecord[];
  summary: RiskRegisterSummary | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
}

export function useRiskRegister(): UseRiskRegisterResult {
  const contractsQuery = useQuery(
    bestEffortList<LexContract>('contracts', '/api/v1/lex/contracts', LIST_PARAMS),
  );
  const obligationsQuery = useQuery(
    bestEffortList<LexObligation>('obligations', '/api/v1/lex/obligations', {
      page: 1, per_page: REGISTER_PAGE_SIZE, sort: 'due_date', order: 'asc',
    }),
  );
  const rulesQuery = useQuery(
    bestEffortList<LexComplianceRule>('rules', '/api/v1/lex/compliance/rules', { page: 1, per_page: REGISTER_PAGE_SIZE }),
  );
  const alertsQuery = useQuery(
    bestEffortList<LexComplianceAlert>('alerts', '/api/v1/lex/compliance/alerts', { page: 1, per_page: REGISTER_PAGE_SIZE }),
  );
  const casesQuery = useQuery(
    bestEffortList<RawDomainRecord>('cases', '/api/v1/lex/legal-cases', LIST_PARAMS),
  );
  const requestsQuery = useQuery(
    bestEffortList<RawDomainRecord>('requests', '/api/v1/lex/legal-requests', LIST_PARAMS),
  );
  const investigationsQuery = useQuery(
    bestEffortList<RawDomainRecord>('investigations', '/api/v1/lex/investigations', LIST_PARAMS),
  );
  const consultationsQuery = useQuery(
    bestEffortList<RawDomainRecord>('consultations', '/api/v1/lex/consultations', LIST_PARAMS),
  );
  const settlementsQuery = useQuery(
    bestEffortList<RawDomainRecord>('settlements', '/api/v1/lex/settlements', LIST_PARAMS),
  );

  const built = useMemo(() => {
    return buildRiskRegister({
      contracts: contractsQuery.data?.data ?? [],
      obligations: obligationsQuery.data?.data ?? [],
      rules: rulesQuery.data?.data ?? [],
      alerts: alertsQuery.data?.data ?? [],
      cases: casesQuery.data?.data ?? [],
      requests: requestsQuery.data?.data ?? [],
      investigations: investigationsQuery.data?.data ?? [],
      consultations: consultationsQuery.data?.data ?? [],
      settlements: settlementsQuery.data?.data ?? [],
    });
  }, [
    contractsQuery.data, obligationsQuery.data, rulesQuery.data, alertsQuery.data,
    casesQuery.data, requestsQuery.data, investigationsQuery.data,
    consultationsQuery.data, settlementsQuery.data,
  ]);

  // Load-bearing set: the page is "loading" only while the core risk-bearing
  // domains (contracts + cases) are in flight; the rest are best-effort.
  const isLoading = contractsQuery.isLoading || casesQuery.isLoading;
  const isError = contractsQuery.isError && casesQuery.isError;

  return {
    records: built.records,
    summary: built.summary,
    isLoading,
    isError,
    refetch: () => {
      void contractsQuery.refetch();
      void obligationsQuery.refetch();
      void rulesQuery.refetch();
      void alertsQuery.refetch();
      void casesQuery.refetch();
      void requestsQuery.refetch();
      void investigationsQuery.refetch();
      void consultationsQuery.refetch();
      void settlementsQuery.refetch();
    },
  };
}
