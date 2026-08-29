/**
 * Lex (Watheeq) legal-affairs reporting + KPI API client (Phase 4, CAP-133..151).
 *
 * This is the typed HTTP client for the NEW analytics/KPI endpoints the backend
 * exposes under `/api/v1/lex/...`:
 *   - GET /reports/cases                  (litigation-case analytics rollup)
 *   - GET /reports/contracts-analytics    (contract analytics rollup)
 *   - GET /reports/consultations          (consultation analytics rollup)
 *   - GET /reports/performance            (operational performance scorecard)
 *   - GET /reports/detailed-analytics     (Director Legal request analytics)
 *   - GET /kpis/sla-compliance            (FLAGSHIP quarterly SLA-compliance)
 *   - GET /dashboard/legal-affairs         (consolidated analytics hub)
 *
 * All endpoints accept an optional report window (`from`/`to` ISO dates,
 * `department`, `status`, `type`); detailed analytics additionally accepts
 * `priority` and `compare`, and the SLA endpoint accepts
 * `quarters` (how many trailing quarters to return). Every endpoint also accepts
 * `format=csv|xlsx` to stream an export where supported.
 *
 * Response bodies are wrapped in the standard suite `{ data: T }` envelope; we
 * unwrap via `fetchSuiteData`. The types below mirror the Go model shapes
 * (internal/lex/model/reporting.go + sla.go) field-for-field.
 *
 * NOTE: this module is owned by the Reporting/Notifications area. It deliberately
 * does NOT extend `enterpriseApi.lex.*` (the existing contract/matter/obligation
 * CSV reports live there); the analytics surface is self-contained here.
 */
import api from '@/lib/api';
import { fetchSuiteData, fetchSuitePaginated } from '@/lib/suite-api';
import type { PaginatedResponse } from '@/types/api';
import type {
  LocalizedText,
  RequestPriority,
  RequestStatus,
} from '@/lib/lex/requests';

/** SLA-compliance policy goal the flagship KPI is measured against (CAP-151). */
export const LEX_SLA_COMPLIANCE_TARGET = 90;

/** Base path for the lex legal-affairs reporting surface. */
const LEX_REPORTS_BASE = '/api/v1/lex';

/**
 * LexReportFilters is the common filter envelope echoed back in every report so
 * the caller can see exactly which window/scope produced the numbers.
 */
export interface LexReportFilters {
  from?: string;
  to?: string;
  department?: string;
  status?: string;
  type?: string;
}

/** A single {key,count} aggregate row used for by-X breakdowns. */
export interface LexCountBucket {
  key: string;
  count: number;
}

/** Query params accepted by the analytics/KPI endpoints. */
export interface LexReportQuery {
  from?: string;
  to?: string;
  department?: string;
  status?: string;
  type?: string;
  priority?: string;
  compare?: boolean;
  /** Trailing quarters for the SLA-compliance report (default 4). */
  quarters?: number;
}

export interface LexAnalyticsMetric {
  value: number;
  /** Omitted by legacy/cached gateway responses; explicit false means unavailable. */
  available?: boolean;
  sample_size: number;
  previous_value?: number;
  previous_available?: boolean;
  previous_sample_size?: number;
}

export interface LexDetailedAnalyticsSummary {
  total_requests: LexAnalyticsMetric;
  completion_rate: LexAnalyticsMetric;
  avg_processing_hours: LexAnalyticsMetric;
  satisfaction_score: LexAnalyticsMetric;
  sla_compliance: LexAnalyticsMetric;
  pending_requests: LexAnalyticsMetric;
}

export interface LexAnalyticsPeriod {
  from: string;
  to: string;
}

export interface LexAnalyticsTrendPoint {
  period_start: string;
  count: number;
  previous_count?: number;
}

export interface LexLegalAdvisorPerformance {
  advisor_id?: string;
  advisor_name: string;
  total_requests: number;
  completed_requests: number;
  active_requests: number;
  average_rating?: number;
  rating_count: number;
  sla_compliance_pct?: number;
  resolved_slas: number;
}

export interface LexDetailedAnalyticsDashboard {
  generated_at: string;
  filters: {
    from: string;
    to: string;
    department?: string;
    priority?: string;
    type?: string;
  };
  period: LexAnalyticsPeriod;
  previous_period?: LexAnalyticsPeriod;
  summary: LexDetailedAnalyticsSummary;
  monthly_trend: LexAnalyticsTrendPoint[];
  by_department: LexCountBucket[];
  by_service_type: LexCountBucket[];
  advisor_performance: LexLegalAdvisorPerformance[];
  filter_options: {
    departments: string[];
    service_types: string[];
    priorities: string[];
  };
}

export type LexDetailedAnalyticsDrilldownDimension =
  | 'metric'
  | 'month'
  | 'department'
  | 'service_type'
  | 'advisor';

export interface LexDetailedAnalyticsDrilldownQuery extends LexReportQuery {
  dimension: LexDetailedAnalyticsDrilldownDimension;
  key?: string;
  keys?: string[];
  page?: number;
  per_page?: number;
}

export interface LexDetailedAnalyticsContributor {
  request_id: string;
  request_number: string;
  title: LocalizedText;
  department?: string | null;
  request_type: string;
  priority: RequestPriority;
  status: RequestStatus;
  requester_name: string;
  created_at: string;
  processing_hours?: number;
  satisfaction_rating?: number;
  sla_outcome?: string;
  advisor_id?: string;
  advisor_name?: string;
}

/** CASE analytics rollup over legal_cases (CAP-133..138). */
export interface LexCaseReport {
  generated_at: string;
  filters: LexReportFilters;
  total: number;
  by_type: LexCountBucket[];
  by_department: LexCountBucket[];
  by_status: LexCountBucket[];
  by_company_status: LexCountBucket[];
  closed: number;
  under_procedure: number;
}

/** Privacy-safe row included in the investigations reporting rollup. */
export interface LexInvestigationReportItem {
  id: string;
  investigation_number: string;
  status: string;
  category: string;
  priority: string;
  department?: string | null;
  created_at: string;
  resolved_at?: string | null;
  age_days: number;
  sla_outcome?: string | null;
}

/** Investigation lifecycle, ageing, and SLA rollup. */
export interface LexInvestigationReport {
  generated_at: string;
  filters: LexReportFilters;
  total: number;
  by_status: LexCountBucket[];
  by_category: LexCountBucket[];
  open: number;
  closed: number;
  avg_open_age_days: number;
  avg_register_to_approved_hours: number;
  approval_sample_size: number;
  sla: {
    on_time: number;
    breached: number;
    pending: number;
    compliance_rate_pct: number;
  };
  items: LexInvestigationReportItem[];
  items_truncated: boolean;
}

/**
 * A single {key, count, total_value, by_currency} aggregate row for the contract
 * spend rollups (by type / by department). `total_value` is the raw
 * SUM(total_value) across ALL currencies for the key — the backend never applies
 * FX conversion — and `by_currency` splits the same sum per currency code so the
 * client can render each currency separately (SAR-first in the Watheeq UI).
 * Mirrors Go `model.ValueBucket` (reporting_contract.go).
 */
export interface LexValueBucket {
  key: string;
  count: number;
  total_value: number;
  by_currency: Record<string, number> | null;
}

/**
 * One month of the forward-looking contract expiry cliff: how many live
 * contracts expire in that month and their summed value. `month` is "YYYY-MM";
 * the series is dense (zero-filled) over a 24-month horizon. Mirrors Go
 * `model.ExpiryCliffPoint`.
 */
export interface LexExpiryCliffPoint {
  month: string;
  count: number;
  value: number;
}

/**
 * Draft→active contract cycle time in DAYS: average, median (p50) and p90 with
 * the sample size and timeline source ('duration_facts' | 'status_timeline').
 * Mirrors Go `model.ContractCycleTimeStats`.
 */
export interface LexContractCycleTimeStats {
  avg_days: number;
  p50_days: number;
  p90_days: number;
  sample_size: number;
  source: string;
}

/** CONTRACT analytics rollup over contracts (CAP-139..142 + v2 upgrade). */
export interface LexContractAnalyticsReport {
  generated_at: string;
  filters: LexReportFilters;
  total: number;
  avg_review_duration_hours: number;
  review_sample_size: number;
  by_department: LexCountBucket[];
  by_type: LexCountBucket[];
  by_status: LexCountBucket[];
  // --- v2 additive fields (reports upgrade; Go model.ContractAnalyticsReport).
  // Optional so older backend payloads (pre-upgrade) still type-check; nullable
  // because Go marshals nil slices/maps as `null`.
  /** SUM(total_value) over the filtered scope (raw sum across currencies). */
  total_value?: number;
  /** The same sum split per ISO currency code. */
  total_value_by_currency?: Record<string, number> | null;
  /** Per-type value rollup (spend by type). */
  spend_by_type?: LexValueBucket[] | null;
  /** Per-department value rollup (spend by department). */
  spend_by_department?: LexValueBucket[] | null;
  /** Dense 24-month {month, count, value} expiry series. */
  expiry_cliff?: LexExpiryCliffPoint[] | null;
  /** Draft→active avg/p50/p90 days; null/absent when it could not be computed. */
  cycle_time?: LexContractCycleTimeStats | null;
}

/** CONSULTATION analytics rollup over legal_consultations (CAP-143..145). */
export interface LexConsultationReport {
  generated_at: string;
  filters: LexReportFilters;
  total: number;
  by_department: LexCountBucket[];
  by_type: LexCountBucket[];
  by_status: LexCountBucket[];
  avg_completion_time_hours: number;
  completion_sample_size: number;
}

/** Operational performance scorecard (CAP-146..150). */
export interface LexPerformanceKPIs {
  generated_at: string;
  filters: LexReportFilters;
  avg_request_processing_hours: number;
  request_processing_sample: number;
  closed_case_ratio: number;
  total_cases: number;
  closed_cases: number;
  approved_contract_ratio: number;
  total_contracts: number;
  approved_contracts: number;
  overdue_requests: number;
  estimated_duration_adherence: number;
  resolved_clocks: number;
  on_time_clocks: number;
}

/** SLA-compliance rate for one calendar quarter (CAP-151). */
export interface LexQuarterSLACompliance {
  quarter: string;
  quarter_start: string;
  quarter_end: string;
  received: number;
  on_time: number;
  breached: number;
  pending: number;
  rate_pct: number;
  target_pct: number;
  meets_target: boolean;
}

/** FLAGSHIP quarterly SLA-compliance report (CAP-151). */
export interface LexSLAComplianceReport {
  generated_at: string;
  filters: LexReportFilters;
  target_pct: number;
  quarters: LexQuarterSLACompliance[];
  overall_rate_pct: number;
  overall_meets_target: boolean;
}

/** Consolidated legal-affairs analytics hub fan-out payload. */
export interface LegalAffairsDashboard {
  generated_at: string;
  cases: LexCaseReport | null;
  contracts: LexContractAnalyticsReport | null;
  consultations: LexConsultationReport | null;
  performance: LexPerformanceKPIs | null;
  sla_compliance: LexSLAComplianceReport | null;
  current_quarter_rate_pct: number;
}

/**
 * buildReportParams maps the optional report window into a flat query object,
 * dropping empty values so the backend applies "no constraint" defaults.
 */
function buildReportParams(query: LexReportQuery = {}): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  if (query.from) params.from = query.from;
  if (query.to) params.to = query.to;
  if (query.department) params.department = query.department;
  if (query.status) params.status = query.status;
  if (query.type) params.type = query.type;
  if (query.priority) params.priority = query.priority;
  if (typeof query.compare === 'boolean') params.compare = query.compare;
  if (typeof query.quarters === 'number') params.quarters = query.quarters;
  return params;
}

/** Stream a `format=csv` export for one of the analytics endpoints as a Blob. */
async function fetchReportCsv(path: string, query: LexReportQuery = {}): Promise<Blob> {
  const response = await api.get<Blob>(`${LEX_REPORTS_BASE}${path}`, {
    params: { ...buildReportParams(query), format: 'csv' },
    responseType: 'blob',
  });
  return response.data;
}

/** Stream a `format=xlsx` export for one of the analytics endpoints as a Blob. */
async function fetchReportXlsx(path: string, query: LexReportQuery = {}): Promise<Blob> {
  const response = await api.get<Blob>(`${LEX_REPORTS_BASE}${path}`, {
    params: { ...buildReportParams(query), format: 'xlsx' },
    responseType: 'blob',
  });
  return response.data;
}

/**
 * lexReportsApi is the typed client for the legal-affairs analytics/KPI surface.
 * Reads unwrap the `{ data }` envelope; CSV variants return a Blob.
 */
export const lexReportsApi = {
  getCaseReport: (query: LexReportQuery = {}): Promise<LexCaseReport> =>
    fetchSuiteData(`${LEX_REPORTS_BASE}/reports/cases`, buildReportParams(query)),
  getInvestigationReport: (query: LexReportQuery = {}): Promise<LexInvestigationReport> =>
    fetchSuiteData(`${LEX_REPORTS_BASE}/reports/investigations`, buildReportParams(query)),
  getContractAnalytics: (query: LexReportQuery = {}): Promise<LexContractAnalyticsReport> =>
    fetchSuiteData(`${LEX_REPORTS_BASE}/reports/contracts-analytics`, buildReportParams(query)),
  getConsultationReport: (query: LexReportQuery = {}): Promise<LexConsultationReport> =>
    fetchSuiteData(`${LEX_REPORTS_BASE}/reports/consultations`, buildReportParams(query)),
  getPerformanceKpis: (query: LexReportQuery = {}): Promise<LexPerformanceKPIs> =>
    fetchSuiteData(`${LEX_REPORTS_BASE}/reports/performance`, buildReportParams(query)),
  getSlaCompliance: (query: LexReportQuery = {}): Promise<LexSLAComplianceReport> =>
    fetchSuiteData(`${LEX_REPORTS_BASE}/kpis/sla-compliance`, buildReportParams(query)),
  getLegalAffairsDashboard: (query: LexReportQuery = {}): Promise<LegalAffairsDashboard> =>
    fetchSuiteData(`${LEX_REPORTS_BASE}/dashboard/legal-affairs`, buildReportParams(query)),
  getDetailedAnalytics: (query: LexReportQuery = {}): Promise<LexDetailedAnalyticsDashboard> =>
    fetchSuiteData(`${LEX_REPORTS_BASE}/reports/detailed-analytics`, buildReportParams(query)),
  getDetailedAnalyticsContributors: (
    query: LexDetailedAnalyticsDrilldownQuery,
  ): Promise<PaginatedResponse<LexDetailedAnalyticsContributor>> =>
    fetchSuitePaginated(
      `${LEX_REPORTS_BASE}/reports/detailed-analytics/contributors`,
      {
        page: query.page ?? 1,
        per_page: query.per_page ?? 25,
      },
      {
        ...buildReportParams(query),
        dimension: query.dimension,
        key: query.key,
        keys: query.keys?.join(','),
      },
    ),

  exportCaseReportCsv: (query: LexReportQuery = {}): Promise<Blob> =>
    fetchReportCsv('/reports/cases', query),
  exportCaseReportXlsx: (query: LexReportQuery = {}): Promise<Blob> =>
    fetchReportXlsx('/reports/cases', query),
  exportInvestigationReportCsv: (query: LexReportQuery = {}): Promise<Blob> =>
    fetchReportCsv('/reports/investigations', query),
  exportInvestigationReportXlsx: (query: LexReportQuery = {}): Promise<Blob> =>
    fetchReportXlsx('/reports/investigations', query),
  exportContractAnalyticsCsv: (query: LexReportQuery = {}): Promise<Blob> =>
    fetchReportCsv('/reports/contracts-analytics', query),
  exportContractAnalyticsXlsx: (query: LexReportQuery = {}): Promise<Blob> =>
    fetchReportXlsx('/reports/contracts-analytics', query),
  exportConsultationReportCsv: (query: LexReportQuery = {}): Promise<Blob> =>
    fetchReportCsv('/reports/consultations', query),
  exportConsultationReportXlsx: (query: LexReportQuery = {}): Promise<Blob> =>
    fetchReportXlsx('/reports/consultations', query),
  exportPerformanceKpisCsv: (query: LexReportQuery = {}): Promise<Blob> =>
    fetchReportCsv('/reports/performance', query),
  exportPerformanceKpisXlsx: (query: LexReportQuery = {}): Promise<Blob> =>
    fetchReportXlsx('/reports/performance', query),
  exportSlaComplianceCsv: (query: LexReportQuery = {}): Promise<Blob> =>
    fetchReportCsv('/kpis/sla-compliance', query),
  exportSlaComplianceXlsx: (query: LexReportQuery = {}): Promise<Blob> =>
    fetchReportXlsx('/kpis/sla-compliance', query),
  exportLegalAffairsDashboardXlsx: (query: LexReportQuery = {}): Promise<Blob> =>
    fetchReportXlsx('/dashboard/legal-affairs', query),
  exportDetailedAnalyticsCsv: (query: LexReportQuery = {}): Promise<Blob> =>
    fetchReportCsv('/reports/detailed-analytics', query),
  exportDetailedAnalyticsXlsx: (query: LexReportQuery = {}): Promise<Blob> =>
    fetchReportXlsx('/reports/detailed-analytics', query),
};
