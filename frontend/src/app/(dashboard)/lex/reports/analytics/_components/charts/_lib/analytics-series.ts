/**
 * deriveAnalyticsSeries() — the SINGLE source of truth for every analytics chart.
 *
 * The 10-chart Legal-Affairs analytics dashboard must NOT each re-walk the raw
 * `LegalAffairsDashboard`. Instead the page calls `deriveAnalyticsSeries(dash,
 * prev)` ONCE (inside a `useMemo` keyed on the two dashboards) and hands each
 * chart component its precomputed, well-typed slice as a prop. Every chart is
 * then a pure `React.memo` view over its slice.
 *
 * Design rules baked into this module:
 *   - PURE: no `Date.now()`, no `Math.random()`, no I/O, no React. Same input ⇒
 *     same output, so callers can freely `useMemo`/`React.memo` over the result.
 *   - SINGLE PASS per source array: each `by_X` bucket array is read once and
 *     indexed into a `Map` up front; downstream slices reuse those indexes.
 *   - NULL-SAFE: every section of `LegalAffairsDashboard` can be `null`; helpers
 *     degrade to empty arrays / zeros rather than throwing.
 *   - PERCENTAGES are normalized to 0..1 fractions where a chart wants a ratio
 *     (gauges/bullet), and kept as 0..100 where the source already is a `*_pct`.
 *
 * The exported return shape (`AnalyticsSeries`) is the STABLE CONTRACT the chart
 * agents build against — do not reorder/rename slices without updating them.
 */

import type {
  LegalAffairsDashboard,
  LexCountBucket,
} from '@/lib/lex/reports';
import { normalizeStatusKey } from './palette';

/* ================================================================== *
 *  Shared row primitives
 * ================================================================== */

/** A single categorical datum: a normalized key, the raw label, and its count. */
export interface SeriesPoint {
  /** Normalized key (lowercase, `_`-joined) — stable across slices for coloring. */
  key: string;
  /** Raw label as returned by the API (for display / bilingual lookup). */
  label: string;
  /** Count for this bucket. */
  value: number;
  /** Share of the slice total, 0..1 (0 when total is 0). */
  share: number;
}

/** A current-vs-previous comparison datum with a signed pct delta. */
export interface VariancePoint {
  /** Stable metric id (e.g. `cases`, `contracts`, `consultations`, `sla`). */
  key: string;
  current: number;
  /** Previous-period value, or `null` when no comparison window exists. */
  previous: number | null;
  /** Absolute delta (current - previous), or `null`. */
  delta: number | null;
  /** Percentage delta vs previous, 0..100 signed, or `null` (and `null` if prev 0). */
  deltaPct: number | null;
  /** True when this metric is "good when it goes down" (e.g. overdue, hours). */
  lowerIsBetter: boolean;
}

/* ================================================================== *
 *  Per-chart slice shapes
 * ================================================================== */

/** [1] SLA trend — one point per quarter with rate vs target (both 0..100). */
export interface SlaTrendPoint {
  quarter: string;
  ratePct: number;
  targetPct: number;
  received: number;
  meetsTarget: boolean;
}

/** [2] SLA outcome stacked bar — counts per quarter. */
export interface SlaOutcomePoint {
  quarter: string;
  onTime: number;
  breached: number;
  pending: number;
}

/** [3] Case status donut — status buckets + the closed/open headline. */
export interface CaseStatusDonut {
  slices: SeriesPoint[];
  total: number;
  closed: number;
  underProcedure: number;
}

/** [4] Litigation posture — plaintiff vs defendant (by_company_status). */
export interface LitigationPosture {
  plaintiff: number;
  defendant: number;
  other: number;
  total: number;
  /** Full normalized breakdown (for the legend / "other" expansion). */
  buckets: SeriesPoint[];
}

/** [5] Department × domain heatmap. */
export interface DeptDomainHeatmap {
  /** Ordered department row labels (union of all three by_department arrays). */
  departments: string[];
  /** Column ids in render order. */
  columns: Array<'cases' | 'contracts' | 'consultations'>;
  /** rows[r][c] = count for departments[r] in columns[c]. */
  rows: number[][];
  /** Per-row totals (sum across columns), for sorting / row bars. */
  rowTotals: number[];
  /** Max single-cell value across the grid (for the heat scale). */
  max: number;
}

/** [6] Turnaround — average hours across the three throughput stages. */
export interface TurnaroundPoint {
  key: 'contract_review' | 'consultation_completion' | 'request_processing';
  hours: number;
}

/** [7] Efficiency gauges — each metric as a 0..1 ratio with a 0..1 target. */
export interface EfficiencyGauge {
  key:
    | 'closed_case_ratio'
    | 'approved_contract_ratio'
    | 'estimated_duration_adherence'
    | 'sla_on_time';
  /** 0..1 achieved ratio. */
  ratio: number;
  /** 0..1 target band. */
  target: number;
  /** Optional numerator/denominator for "X of Y" helper copy. */
  numerator?: number;
  denominator?: number;
}

/** [8] Contract lifecycle funnel — ordered stages with absolute + drop counts. */
export interface ContractFunnelStage {
  key: string;
  label: string;
  value: number;
  /** Share of the funnel head (first non-zero stage), 0..1. */
  share: number;
}

/** [9] Type treemap — unioned case+consultation types, sized by count. */
export interface TreemapNode {
  key: string;
  label: string;
  value: number;
  /** Share of the treemap total, 0..1. */
  share: number;
}

/** The whole derived bundle handed to the chart layer. */
export interface AnalyticsSeries {
  /** True when there's effectively nothing to chart (all sources null/empty). */
  isEmpty: boolean;
  /** ISO timestamp echoed from the dashboard, for "generated at" copy. */
  generatedAt: string;
  slaTrend: SlaTrendPoint[];
  slaOutcomeByQuarter: SlaOutcomePoint[];
  caseStatusDonut: CaseStatusDonut;
  litigationPosture: LitigationPosture;
  deptDomainHeatmap: DeptDomainHeatmap;
  turnaround: TurnaroundPoint[];
  efficiencyGauges: EfficiencyGauge[];
  contractFunnel: ContractFunnelStage[];
  periodVariance: VariancePoint[];
  typeTreemap: TreemapNode[];
}

/* ================================================================== *
 *  Pure helpers
 * ================================================================== */

const EMPTY_BUCKETS: readonly LexCountBucket[] = [];

/** Safely read a by_X bucket array (never returns null). */
function buckets(arr: LexCountBucket[] | null | undefined): readonly LexCountBucket[] {
  return arr ?? EMPTY_BUCKETS;
}

/** Sum the counts of a bucket array in one pass. */
function sumBuckets(arr: readonly LexCountBucket[]): number {
  let total = 0;
  for (const b of arr) total += b.count || 0;
  return total;
}

/** Build a normalized-key → count map from a bucket array (single pass). */
function indexBuckets(arr: readonly LexCountBucket[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const b of arr) {
    const k = normalizeStatusKey(b.key);
    map.set(k, (map.get(k) ?? 0) + (b.count || 0));
  }
  return map;
}

/** Convert a bucket array into SeriesPoints with per-bucket share. */
function toSeriesPoints(arr: readonly LexCountBucket[]): SeriesPoint[] {
  const total = sumBuckets(arr);
  return arr.map((b) => ({
    key: normalizeStatusKey(b.key),
    label: b.key,
    value: b.count || 0,
    share: total > 0 ? (b.count || 0) / total : 0,
  }));
}

/** Lookup a normalized key's count from a map, defaulting to 0. */
function pick(map: Map<string, number>, ...keys: string[]): number {
  let sum = 0;
  for (const k of keys) sum += map.get(k) ?? 0;
  return sum;
}

/** Build a variance point; `lowerIsBetter` flips the "good direction". */
function variance(
  key: string,
  current: number | null | undefined,
  previous: number | null | undefined,
  lowerIsBetter = false,
): VariancePoint {
  const cur = current ?? 0;
  const prev = previous == null ? null : previous;
  const delta = prev == null ? null : cur - prev;
  const deltaPct =
    prev == null || prev === 0 ? null : ((cur - prev) / Math.abs(prev)) * 100;
  return { key, current: cur, previous: prev, delta, deltaPct, lowerIsBetter };
}

/* ----- Litigation posture key groups (Saudi "company status" roles) ----- */
const PLAINTIFF_KEYS = ['plaintiff', 'claimant', 'مدعي', 'مدعى'];
const DEFENDANT_KEYS = ['defendant', 'respondent', 'مدعى_عليه', 'مدعي_عليه'];

/* ----- Contract lifecycle order (head → tail) ----- */
const CONTRACT_LIFECYCLE: ReadonlyArray<string> = [
  'draft',
  'internal_review',
  'legal_review',
  'negotiation',
  'pending_signature',
  'active',
];

/* ================================================================== *
 *  Main derivation
 * ================================================================== */

export function deriveAnalyticsSeries(
  dashboard: LegalAffairsDashboard | null | undefined,
  previous?: LegalAffairsDashboard | null,
): AnalyticsSeries {
  const cases = dashboard?.cases ?? null;
  const contracts = dashboard?.contracts ?? null;
  const consultations = dashboard?.consultations ?? null;
  const performance = dashboard?.performance ?? null;
  const sla = dashboard?.sla_compliance ?? null;

  /* ---- index every by_X array ONCE ---- */
  const caseStatus = buckets(cases?.by_status);
  const caseType = buckets(cases?.by_type);
  const caseDept = buckets(cases?.by_department);
  const caseCompany = buckets(cases?.by_company_status);

  const contractStatus = buckets(contracts?.by_status);
  const contractDept = buckets(contracts?.by_department);

  const consultStatus = buckets(consultations?.by_status);
  const consultType = buckets(consultations?.by_type);
  const consultDept = buckets(consultations?.by_department);

  /* ---- [1] SLA trend + [2] outcome stacks (one walk of quarters) ---- */
  const quarters = sla?.quarters ?? [];
  const targetPct = sla?.target_pct ?? 90;
  const slaTrend: SlaTrendPoint[] = quarters.map((q) => ({
    quarter: q.quarter,
    ratePct: q.rate_pct ?? 0,
    targetPct: q.target_pct ?? targetPct,
    received: q.received ?? 0,
    meetsTarget: Boolean(q.meets_target),
  }));
  const slaOutcomeByQuarter: SlaOutcomePoint[] = quarters.map((q) => ({
    quarter: q.quarter,
    onTime: q.on_time ?? 0,
    breached: q.breached ?? 0,
    pending: q.pending ?? 0,
  }));

  /* ---- [3] case status donut ---- */
  const caseStatusDonut: CaseStatusDonut = {
    slices: toSeriesPoints(caseStatus),
    total: cases?.total ?? sumBuckets(caseStatus),
    closed: cases?.closed ?? 0,
    underProcedure: cases?.under_procedure ?? 0,
  };

  /* ---- [4] litigation posture (plaintiff vs defendant) ---- */
  const companyIdx = indexBuckets(caseCompany);
  const plaintiff = pick(companyIdx, ...PLAINTIFF_KEYS);
  const defendant = pick(companyIdx, ...DEFENDANT_KEYS);
  const companyTotal = sumBuckets(caseCompany);
  const litigationPosture: LitigationPosture = {
    plaintiff,
    defendant,
    other: Math.max(0, companyTotal - plaintiff - defendant),
    total: companyTotal,
    buckets: toSeriesPoints(caseCompany),
  };

  /* ---- [5] department × domain heatmap (union of 3 by_department arrays) ---- */
  const caseDeptIdx = indexBuckets(caseDept);
  const contractDeptIdx = indexBuckets(contractDept);
  const consultDeptIdx = indexBuckets(consultDept);
  // Union of department keys, preserving first-seen label + first-seen order.
  const deptOrder: string[] = [];
  const deptLabel = new Map<string, string>();
  for (const src of [caseDept, contractDept, consultDept]) {
    for (const b of src) {
      const k = normalizeStatusKey(b.key);
      if (!deptLabel.has(k)) {
        deptLabel.set(k, b.key);
        deptOrder.push(k);
      }
    }
  }
  const heatRows: number[][] = [];
  const heatRowTotals: number[] = [];
  let heatMax = 0;
  for (const k of deptOrder) {
    const c = caseDeptIdx.get(k) ?? 0;
    const ct = contractDeptIdx.get(k) ?? 0;
    const cs = consultDeptIdx.get(k) ?? 0;
    heatRows.push([c, ct, cs]);
    heatRowTotals.push(c + ct + cs);
    heatMax = Math.max(heatMax, c, ct, cs);
  }
  const deptDomainHeatmap: DeptDomainHeatmap = {
    departments: deptOrder.map((k) => deptLabel.get(k) ?? k),
    columns: ['cases', 'contracts', 'consultations'],
    rows: heatRows,
    rowTotals: heatRowTotals,
    max: heatMax,
  };

  /* ---- [6] turnaround (avg hours per stage) ---- */
  const turnaround: TurnaroundPoint[] = [
    { key: 'contract_review', hours: contracts?.avg_review_duration_hours ?? 0 },
    {
      key: 'consultation_completion',
      hours: consultations?.avg_completion_time_hours ?? 0,
    },
    {
      key: 'request_processing',
      hours: performance?.avg_request_processing_hours ?? 0,
    },
  ];

  /* ---- [7] efficiency gauges (0..1 ratios) ---- */
  const slaOnTime =
    sla?.overall_rate_pct != null
      ? sla.overall_rate_pct / 100
      : (dashboard?.current_quarter_rate_pct ?? 0) / 100;
  const efficiencyGauges: EfficiencyGauge[] = [
    {
      key: 'closed_case_ratio',
      ratio: clamp01(performance?.closed_case_ratio ?? 0),
      target: 0.8,
      numerator: performance?.closed_cases,
      denominator: performance?.total_cases,
    },
    {
      key: 'approved_contract_ratio',
      ratio: clamp01(performance?.approved_contract_ratio ?? 0),
      target: 0.8,
      numerator: performance?.approved_contracts,
      denominator: performance?.total_contracts,
    },
    {
      key: 'estimated_duration_adherence',
      ratio: clamp01(performance?.estimated_duration_adherence ?? 0),
      target: 0.9,
      numerator: performance?.on_time_clocks,
      denominator: performance?.resolved_clocks,
    },
    {
      key: 'sla_on_time',
      ratio: clamp01(slaOnTime),
      target: clamp01(targetPct / 100),
    },
  ];

  /* ---- [8] contract lifecycle funnel ---- */
  const contractStatusIdx = indexBuckets(contractStatus);
  // Head = first lifecycle stage that has a value (so share is meaningful even
  // when "draft" is empty). Falls back to the max stage count.
  let funnelHead = 0;
  for (const stage of CONTRACT_LIFECYCLE) {
    const v = contractStatusIdx.get(stage) ?? 0;
    if (v > 0) {
      funnelHead = v;
      break;
    }
    funnelHead = Math.max(funnelHead, v);
  }
  if (funnelHead === 0) {
    for (const stage of CONTRACT_LIFECYCLE) {
      funnelHead = Math.max(funnelHead, contractStatusIdx.get(stage) ?? 0);
    }
  }
  const contractFunnel: ContractFunnelStage[] = CONTRACT_LIFECYCLE.map((stage) => {
    const value = contractStatusIdx.get(stage) ?? 0;
    return {
      key: stage,
      label: stage,
      value,
      share: funnelHead > 0 ? value / funnelHead : 0,
    };
  });

  /* ---- [9] period variance (current vs previous) ---- */
  const periodVariance: VariancePoint[] = [
    variance('cases', cases?.total, previous?.cases?.total ?? null),
    variance('contracts', contracts?.total, previous?.contracts?.total ?? null),
    variance(
      'consultations',
      consultations?.total,
      previous?.consultations?.total ?? null,
    ),
    variance(
      'sla',
      sla?.overall_rate_pct ?? dashboard?.current_quarter_rate_pct,
      previous?.sla_compliance?.overall_rate_pct ??
        previous?.current_quarter_rate_pct ??
        null,
    ),
  ];

  /* ---- [10] type treemap (union of case + consultation by_type) ---- */
  const typeOrder: string[] = [];
  const typeLabel = new Map<string, string>();
  const typeCount = new Map<string, number>();
  for (const src of [caseType, consultType]) {
    for (const b of src) {
      const k = normalizeStatusKey(b.key);
      if (!typeLabel.has(k)) {
        typeLabel.set(k, b.key);
        typeOrder.push(k);
      }
      typeCount.set(k, (typeCount.get(k) ?? 0) + (b.count || 0));
    }
  }
  let typeTotal = 0;
  for (const k of typeOrder) typeTotal += typeCount.get(k) ?? 0;
  const typeTreemap: TreemapNode[] = typeOrder
    .map((k) => ({
      key: k,
      label: typeLabel.get(k) ?? k,
      value: typeCount.get(k) ?? 0,
      share: typeTotal > 0 ? (typeCount.get(k) ?? 0) / typeTotal : 0,
    }))
    .sort((a, b) => b.value - a.value);

  /* ---- empty detection ---- */
  const isEmpty =
    !cases &&
    !contracts &&
    !consultations &&
    !performance &&
    !sla &&
    slaTrend.length === 0;

  return {
    isEmpty,
    generatedAt: dashboard?.generated_at ?? '',
    slaTrend,
    slaOutcomeByQuarter,
    caseStatusDonut,
    litigationPosture,
    deptDomainHeatmap,
    turnaround,
    efficiencyGauges,
    contractFunnel,
    periodVariance,
    typeTreemap,
  };
}

/** Clamp a fraction into 0..1 (defensive against backend >1 or negative). */
function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}
