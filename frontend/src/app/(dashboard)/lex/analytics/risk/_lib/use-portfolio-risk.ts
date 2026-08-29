"use client";

/**
 * Data layer for the Portfolio Risk & Value dashboard (features #18 + #19).
 *
 * Fetches the already-existing Lex list endpoints — contracts, matters and
 * obligations — through the shared suite API client and derives EVERY analytic
 * CLIENT-SIDE. No endpoints are invented.
 *
 *   - `usePortfolioRisk()` pulls a generous page of each list via react-query.
 *   - `buildPortfolioRisk()` is a PURE reducer over those lists that produces:
 *       • the contract risk-score distribution (weighted index, high/med/low
 *         band split, and a 0–100 score-band histogram) — feature #18;
 *       • matter urgency (open matters by priority, overdue flagged) — #18;
 *       • obligation maturity (open obligations bucketed by due horizon) — #18;
 *       • portfolio value, value-at-risk and the 12-month renewal cliff (active
 *         contract value expiring per month) — feature #19.
 *
 * The reducer emits RAW numbers / ISO month keys / Date objects only — never
 * formatted strings — so the same data renders correctly in en (Gregorian /
 * Latin digits) and ar (Hijri-aware / Arabic-Indic, SAR) via `useLexFormat`.
 * It is exported + deterministic given an injected `now` so the maths is
 * unit-testable and the view stays declarative.
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchSuitePaginated } from "@/lib/suite-api";
import { API_ENDPOINTS } from "@/lib/constants";
import type {
  LexContract,
  LexMatter,
  LexObligation,
  LexLegalPriority,
} from "@/types/suites";
import { riskBandForScore, type RiskBand } from "./risk-labels";

/** Pull a generous page so client-side aggregation is representative. */
const PORTFOLIO_PAGE_SIZE = 200;
const MS_PER_DAY = 86_400_000;
/** Horizon for the renewal-cliff timeline (#19). */
const CLIFF_MONTHS = 12;
/** Number of 0–100 score buckets in the risk-band histogram. */
const SCORE_BUCKETS = 10;

/** Contract statuses that count as "live" portfolio value. */
const ACTIVE_CONTRACT_STATUSES: ReadonlySet<string> = new Set([
  "active",
  "renewed",
  "pending_signature",
]);

/** Matter statuses that count as "open / in-flight" for the urgency view. */
const OPEN_MATTER_STATUSES: ReadonlySet<string> = new Set([
  "intake",
  "open",
  "in_review",
  "waiting_on_business",
  "on_hold",
]);

/** Obligation statuses that are still outstanding. */
const OPEN_OBLIGATION_STATUSES: ReadonlySet<string> = new Set([
  "open",
  "in_progress",
  "blocked",
]);

const PRIORITY_ORDER: readonly LexLegalPriority[] = [
  "critical",
  "high",
  "medium",
  "low",
];

/* ------------------------------------------------------------------------- *
 * Derived shapes
 * ------------------------------------------------------------------------- */

export interface RiskBandSlice {
  band: RiskBand;
  count: number;
}

export interface ScoreBucketPoint {
  /** Inclusive lower bound of the 0–100 bucket. */
  from: number;
  /** Exclusive upper bound (100 for the last bucket is inclusive). */
  to: number;
  band: RiskBand;
  count: number;
  contractIds: string[];
}

export interface RiskDistribution {
  /** Value-weighted portfolio risk index, 0–100 (higher = riskier). */
  weightedIndex: number;
  /** Simple mean risk score across scored contracts, 0–100. */
  avgScore: number;
  /** Contracts with a usable risk band. */
  scored: number;
  /** Contracts still awaiting analysis (no score / level). */
  unscored: number;
  bands: RiskBandSlice[];
  buckets: ScoreBucketPoint[];
  /** Fraction (0–1) of scored contracts that are high-risk. */
  highShare: number;
  scoredContractIds: string[];
  unscoredContractIds: string[];
  bandContractIds: Record<RiskBand, string[]>;
}

export interface MatterUrgencyPoint {
  priority: LexLegalPriority;
  open: number;
  overdue: number;
  matterIds: string[];
  onTrackMatterIds: string[];
  overdueMatterIds: string[];
}

export interface ObligationMaturityPoint {
  /** Stable bucket key for label lookup. */
  key: "overdue" | "next30" | "next90" | "later";
  count: number;
  obligationIds: string[];
}

export interface RenewalCliffPoint {
  /** YYYY-MM month key (chart x). */
  month: string;
  /** First day of the month, for per-locale formatting. */
  monthDate: Date;
  /** Active contract value expiring in this month (SAR). */
  value: number;
  count: number;
  contractIds: string[];
}

export interface PortfolioKpis {
  /** Total value of all contracts (any status), SAR. */
  portfolioValue: number;
  /** Total value of ACTIVE contracts, SAR. */
  activeValue: number;
  /** Active value carried by high-risk contracts, SAR. */
  valueAtRisk: number;
  /** Number of active contracts expiring within 90 days. */
  expiring90: number;
  /** Value-weighted average risk score, 0–100. */
  avgRiskScore: number;
  /** Fraction (0–1) of active value that is high-risk. */
  valueAtRiskShare: number;
  portfolioContractIds: string[];
  activeContractIds: string[];
  valueAtRiskContractIds: string[];
  expiring90ContractIds: string[];
}

export interface PortfolioRisk {
  distribution: RiskDistribution;
  urgency: MatterUrgencyPoint[];
  maturity: ObligationMaturityPoint[];
  cliff: RenewalCliffPoint[];
  /** Index into `cliff` of the peak-value month, or -1 when empty. */
  peakCliffIndex: number;
  kpis: PortfolioKpis;
  contractCount: number;
}

/* ------------------------------------------------------------------------- *
 * Pure helpers
 * ------------------------------------------------------------------------- */

function safeDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function diffDays(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / MS_PER_DAY);
}

/** A scored contract's numeric score, normalized to 0–100 from its level when absent. */
function effectiveScore(c: LexContract): number | null {
  if (typeof c.risk_score === "number" && Number.isFinite(c.risk_score)) {
    return Math.min(100, Math.max(0, c.risk_score));
  }
  // Fall back to a representative score for the coarse level so the gauge / mean
  // still reflect contracts the AI tagged but did not numerically score.
  switch (c.risk_level) {
    case "critical":
      return 90;
    case "high":
      return 75;
    case "medium":
      return 50;
    case "low":
      return 20;
    default:
      return null;
  }
}

/* ------------------------------------------------------------------------- *
 * The reducer — pure, deterministic given a `now` (injected for testability).
 * ------------------------------------------------------------------------- */

export interface BuildInputs {
  contracts: LexContract[];
  matters: LexMatter[];
  obligations: LexObligation[];
  now?: Date;
}

export function buildPortfolioRisk({
  contracts,
  matters,
  obligations,
  now = new Date(),
}: BuildInputs): PortfolioRisk {
  /* --- #18: contract risk distribution ----------------------------------- */
  const bandCounts: Record<RiskBand, number> = { high: 0, medium: 0, low: 0 };
  const bandContractIds: Record<RiskBand, string[]> = {
    high: [],
    medium: [],
    low: [],
  };
  const bucketCounts = new Array<number>(SCORE_BUCKETS).fill(0);
  const bucketContractIds = Array.from({ length: SCORE_BUCKETS }, () => [] as string[]);
  const scoredContractIds: string[] = [];
  const unscoredContractIds: string[] = [];
  let scored = 0;
  let unscored = 0;
  let scoreSum = 0;
  let weightedScoreSum = 0;
  let weightSum = 0;

  /* --- #19: value + renewal cliff ---------------------------------------- */
  let portfolioValue = 0;
  let activeValue = 0;
  let valueAtRisk = 0;
  let expiring90 = 0;
  const activeContractIds: string[] = [];
  const valueAtRiskContractIds: string[] = [];
  const expiring90ContractIds: string[] = [];
  const cliffMap = new Map<string, RenewalCliffPoint>();
  const cliffStart = monthStart(now);
  for (let i = 0; i < CLIFF_MONTHS; i += 1) {
    const md = new Date(
      Date.UTC(cliffStart.getUTCFullYear(), cliffStart.getUTCMonth() + i, 1),
    );
    cliffMap.set(monthKey(md), {
      month: monthKey(md),
      monthDate: md,
      value: 0,
      count: 0,
      contractIds: [],
    });
  }

  for (const c of contracts) {
    const value =
      typeof c.total_value === "number" && Number.isFinite(c.total_value)
        ? c.total_value
        : 0;
    portfolioValue += value;

    const score = effectiveScore(c);
    const band = riskBandForScore(c.risk_score, c.risk_level);

    if (band && score != null) {
      scored += 1;
      scoredContractIds.push(c.id);
      bandCounts[band] += 1;
      bandContractIds[band].push(c.id);
      scoreSum += score;
      // Value-weight the index so a high-risk megadeal moves the needle more
      // than a high-risk rounding-error contract. Floor weight at 1 so unvalued
      // contracts still register.
      const weight = Math.max(1, value);
      weightedScoreSum += score * weight;
      weightSum += weight;
      const bucketIdx = Math.min(
        SCORE_BUCKETS - 1,
        Math.floor(score / (100 / SCORE_BUCKETS)),
      );
      bucketCounts[bucketIdx] += 1;
      bucketContractIds[bucketIdx].push(c.id);
    } else {
      unscored += 1;
      unscoredContractIds.push(c.id);
    }

    const isActive = ACTIVE_CONTRACT_STATUSES.has(c.status);
    if (isActive) {
      activeContractIds.push(c.id);
      activeValue += value;
      if (band === "high") {
        valueAtRisk += value;
        valueAtRiskContractIds.push(c.id);
      }

      const expiry = safeDate(c.expiry_date);
      if (expiry) {
        const days = diffDays(now, expiry);
        if (days >= 0 && days <= 90) {
          expiring90 += 1;
          expiring90ContractIds.push(c.id);
        }
        // Renewal cliff: expiries that fall within the 12-month horizon.
        if (expiry >= cliffStart) {
          const key = monthKey(monthStart(expiry));
          const point = cliffMap.get(key);
          if (point) {
            point.value += value;
            point.count += 1;
            point.contractIds.push(c.id);
          }
        }
      }
    }
  }

  const bandOrder: RiskBand[] = ["high", "medium", "low"];
  const bands: RiskBandSlice[] = bandOrder.map((b) => ({
    band: b,
    count: bandCounts[b],
  }));

  const bucketSize = 100 / SCORE_BUCKETS;
  const buckets: ScoreBucketPoint[] = bucketCounts.map((count, i) => {
    const from = Math.round(i * bucketSize);
    const to = Math.round((i + 1) * bucketSize);
    const midpoint = (from + to) / 2;
    const band = midpoint >= 70 ? "high" : midpoint >= 40 ? "medium" : "low";
    return { from, to, band, count, contractIds: bucketContractIds[i] };
  });

  const weightedIndex =
    weightSum > 0 ? Math.round(weightedScoreSum / weightSum) : 0;
  const avgScore = scored > 0 ? Math.round(scoreSum / scored) : 0;
  const highShare = scored > 0 ? bandCounts.high / scored : 0;

  const distribution: RiskDistribution = {
    weightedIndex,
    avgScore,
    scored,
    unscored,
    bands,
    buckets,
    highShare,
    scoredContractIds,
    unscoredContractIds,
    bandContractIds,
  };

  /* --- #18: matter urgency ----------------------------------------------- */
  const urgencyAgg = new Map<
    LexLegalPriority,
    {
      open: number;
      overdue: number;
      matterIds: string[];
      onTrackMatterIds: string[];
      overdueMatterIds: string[];
    }
  >();
  for (const p of PRIORITY_ORDER) {
    urgencyAgg.set(p, {
      open: 0,
      overdue: 0,
      matterIds: [],
      onTrackMatterIds: [],
      overdueMatterIds: [],
    });
  }

  for (const m of matters) {
    if (!OPEN_MATTER_STATUSES.has(m.status)) continue;
    const priority = PRIORITY_ORDER.includes(m.priority as LexLegalPriority)
      ? (m.priority as LexLegalPriority)
      : "medium";
    const entry = urgencyAgg.get(priority);
    if (!entry) continue;
    entry.open += 1;
    entry.matterIds.push(m.id);
    const due = safeDate(m.due_date);
    if (due && due < now) {
      entry.overdue += 1;
      entry.overdueMatterIds.push(m.id);
    } else {
      entry.onTrackMatterIds.push(m.id);
    }
  }

  const urgency: MatterUrgencyPoint[] = PRIORITY_ORDER.map((priority) => {
    const e = urgencyAgg.get(priority);
    return {
      priority,
      open: e?.open ?? 0,
      overdue: e?.overdue ?? 0,
      matterIds: e?.matterIds ?? [],
      onTrackMatterIds: e?.onTrackMatterIds ?? [],
      overdueMatterIds: e?.overdueMatterIds ?? [],
    };
  });

  /* --- #18: obligation maturity ------------------------------------------ */
  const maturityCounts: Record<ObligationMaturityPoint["key"], number> = {
    overdue: 0,
    next30: 0,
    next90: 0,
    later: 0,
  };
  const maturityIds: Record<ObligationMaturityPoint["key"], string[]> = {
    overdue: [],
    next30: [],
    next90: [],
    later: [],
  };
  for (const o of obligations) {
    if (!OPEN_OBLIGATION_STATUSES.has(o.status)) continue;
    const due = safeDate(o.due_date);
    if (!due) {
      maturityCounts.later += 1;
      maturityIds.later.push(o.id);
      continue;
    }
    const days = diffDays(now, due);
    if (days < 0) {
      maturityCounts.overdue += 1;
      maturityIds.overdue.push(o.id);
    } else if (days <= 30) {
      maturityCounts.next30 += 1;
      maturityIds.next30.push(o.id);
    } else if (days <= 90) {
      maturityCounts.next90 += 1;
      maturityIds.next90.push(o.id);
    } else {
      maturityCounts.later += 1;
      maturityIds.later.push(o.id);
    }
  }
  const maturity: ObligationMaturityPoint[] = (
    ["overdue", "next30", "next90", "later"] as const
  ).map((key) => ({
    key,
    count: maturityCounts[key],
    obligationIds: maturityIds[key],
  }));

  /* --- #19: renewal cliff series + peak ----------------------------------- */
  const cliff = Array.from(cliffMap.values()).sort((a, b) =>
    a.month.localeCompare(b.month),
  );
  let peakCliffIndex = -1;
  let peakValue = -1;
  cliff.forEach((point, i) => {
    if (point.value > peakValue) {
      peakValue = point.value;
      peakCliffIndex = point.value > 0 ? i : peakCliffIndex;
    }
  });

  const kpis: PortfolioKpis = {
    portfolioValue,
    activeValue,
    valueAtRisk,
    expiring90,
    avgRiskScore: weightedIndex,
    valueAtRiskShare: activeValue > 0 ? valueAtRisk / activeValue : 0,
    portfolioContractIds: contracts.map((contract) => contract.id),
    activeContractIds,
    valueAtRiskContractIds,
    expiring90ContractIds,
  };

  return {
    distribution,
    urgency,
    maturity,
    cliff,
    peakCliffIndex,
    kpis,
    contractCount: contracts.length,
  };
}

/* ------------------------------------------------------------------------- *
 * The page-facing hook.
 * ------------------------------------------------------------------------- */

export interface UsePortfolioRiskResult {
  data: PortfolioRisk | undefined;
  sources: {
    contracts: LexContract[];
    matters: LexMatter[];
    obligations: LexObligation[];
  };
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
}

export function usePortfolioRisk(): UsePortfolioRiskResult {
  const contractsQuery = useQuery({
    queryKey: ["lex-portfolio-risk", "contracts"],
    queryFn: () =>
      fetchSuitePaginated<LexContract>(API_ENDPOINTS.LEX_CONTRACTS, {
        page: 1,
        per_page: PORTFOLIO_PAGE_SIZE,
        sort: "updated_at",
        order: "desc",
      }),
  });

  const mattersQuery = useQuery({
    queryKey: ["lex-portfolio-risk", "matters"],
    queryFn: () =>
      fetchSuitePaginated<LexMatter>(API_ENDPOINTS.LEX_MATTERS, {
        page: 1,
        per_page: PORTFOLIO_PAGE_SIZE,
        sort: "updated_at",
        order: "desc",
      }),
    // Matters are supplementary to the value/risk story; a failure must not blank
    // the whole dashboard.
    retry: false,
  });

  const obligationsQuery = useQuery({
    queryKey: ["lex-portfolio-risk", "obligations"],
    queryFn: () =>
      fetchSuitePaginated<LexObligation>(API_ENDPOINTS.LEX_OBLIGATIONS, {
        page: 1,
        per_page: PORTFOLIO_PAGE_SIZE,
        sort: "due_date",
        order: "asc",
      }),
    retry: false,
  });

  const data = useMemo(() => {
    if (!contractsQuery.data) return undefined;
    return buildPortfolioRisk({
      contracts: contractsQuery.data.data,
      matters: mattersQuery.data?.data ?? [],
      obligations: obligationsQuery.data?.data ?? [],
    });
  }, [contractsQuery.data, mattersQuery.data, obligationsQuery.data]);

  return {
    data,
    sources: {
      contracts: contractsQuery.data?.data ?? [],
      matters: mattersQuery.data?.data ?? [],
      obligations: obligationsQuery.data?.data ?? [],
    },
    // Only the contracts query is load-bearing; the others are best-effort.
    isLoading: contractsQuery.isLoading,
    isError: contractsQuery.isError,
    error: contractsQuery.error,
    refetch: () => {
      void contractsQuery.refetch();
      void mattersQuery.refetch();
      void obligationsQuery.refetch();
    },
  };
}
