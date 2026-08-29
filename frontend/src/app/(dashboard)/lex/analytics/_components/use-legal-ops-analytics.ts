"use client";

/**
 * Data layer for the Legal-Ops Analytics page.
 *
 * Fetches the already-existing list endpoints (legal cases + settlements + the
 * org-entity registry for officer name resolution) through the shared lex API
 * client and derives ALL analytics CLIENT-SIDE — no new endpoints are invented.
 *
 *   - `useLegalOpsAnalytics()` pulls a large page of legal cases, the org
 *     registry (to map handling_officer_id → display name) and a page of
 *     settlements (for the settlement cycle-time chart), all via react-query.
 *   - `buildAnalytics()` is a PURE reducer over those lists that produces the
 *     workload matrix (officer × practice-area), velocity series (opened/closed
 *     per ISO week), average days-in-phase, settlement cycle-time and the
 *     headline KPIs. Kept pure + exported so the maths is unit-testable and the
 *     page component stays declarative.
 *
 * Dates are NOT formatted here (that is the view's job, via `useLexFormat`); the
 * reducer only emits raw ISO week keys / numbers so the same data renders
 * correctly in both en (Gregorian) and ar (Hijri / Arabic-Indic) modes.
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchSuitePaginated } from "@/lib/suite-api";
import { lexAdminApi, type OrgEntity } from "@/lib/lex/admin";
import { settlementsApi, type Settlement } from "@/lib/lex/settlements";
import type { LegalCase, CaseStatus } from "@/lib/lex/cases";
import type { AppLocale } from "@/lib/i18n";
import { resolveLocalized } from "@/lib/i18n/localized";

const CASES_ENDPOINT = "/api/v1/lex/legal-cases";
/** Pull a generous page so client-side aggregation is representative. */
const ANALYTICS_PAGE_SIZE = 200;
/** Recent-throughput / closed-KPI window. */
const RECENT_WINDOW_DAYS = 90;
const WEEKS_BACK = 12;
const MS_PER_DAY = 86_400_000;

/** Case statuses that count as "still open / in-flight" for the workload grid. */
const ACTIVE_STATUSES: ReadonlySet<CaseStatus> = new Set<CaseStatus>([
  "intake",
  "phase1",
  "phase2",
  "open",
  "under_procedure",
  "on_hold",
]);

const CLOSED_STATUSES: ReadonlySet<CaseStatus> = new Set<CaseStatus>([
  "closed",
  "cancelled",
]);

/* ------------------------------------------------------------------------- *
 * Derived shapes
 * ------------------------------------------------------------------------- */

export interface WorkloadCell {
  count: number;
  active: number;
  caseIds: string[];
}

export interface WorkloadMatrix {
  /** Row axis: handling officers (display label resolved), busiest first. */
  officers: Array<{
    id: string;
    label: string;
    total: number;
    active: number;
    caseIds: string[];
  }>;
  /** Column axis: practice areas (humanized case_type), busiest first. */
  areas: Array<{
    key: string;
    label: string;
    total: number;
    caseIds: string[];
  }>;
  /** cells[officerId][areaKey] -> { count, active }. */
  cells: Map<string, Map<string, WorkloadCell>>;
  max: number;
  maxActive: number;
}

export interface WeekPoint {
  /** ISO week start (Monday) as YYYY-MM-DD, used as the chart x key. */
  week: string;
  /** A Date for the week start so the view can format it per-locale. */
  weekDate: Date;
  opened: number;
  closed: number;
  openedCaseIds: string[];
  closedCaseIds: string[];
}

export interface PhaseDwellPoint {
  status: CaseStatus;
  avgDays: number;
  count: number;
  caseIds: string[];
}

export interface SettlementCyclePoint {
  id: string;
  /** Settlement reference (short). */
  reference: string;
  cycleDays: number;
  value: number;
}

export interface LegalOpsKpis {
  activeMatters: number;
  closedRecent: number;
  avgCloseDays: number | null;
  settlementCycleDays: number | null;
  weeklyThroughput: number;
  busiestOfficerLabel: string | null;
  busiestOfficerId: string | null;
  busiestOfficerCount: number;
  activeMatterIds: string[];
  closedRecentIds: string[];
  closedCaseIds: string[];
  settlementIds: string[];
  throughputCaseIds: string[];
}

export interface LegalOpsAnalytics {
  total: number;
  workload: WorkloadMatrix;
  weekly: WeekPoint[];
  phaseDwell: PhaseDwellPoint[];
  settlementCycle: SettlementCyclePoint[];
  kpis: LegalOpsKpis;
}

/* ------------------------------------------------------------------------- *
 * Pure helpers
 * ------------------------------------------------------------------------- */

/** Humanize a free-text case_type ("real_estate" → "Real estate"). */
export function humanizePracticeArea(
  raw: string | null | undefined,
): string | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  const spaced = v.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Monday-anchored ISO week start for a date. */
function weekStart(date: Date): Date {
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const diff = (day + 6) % 7; // days since Monday
  d.setUTCDate(d.getUTCDate() - diff);
  return d;
}

function isoKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function diffDays(from: Date, to: Date): number {
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / MS_PER_DAY));
}

function safeDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/* ------------------------------------------------------------------------- *
 * The reducer — pure, deterministic given a `now` (injected for testability).
 * ------------------------------------------------------------------------- */

export interface BuildInputs {
  cases: LegalCase[];
  officers: Map<string, string>;
  settlements: Settlement[];
  locale: AppLocale;
  /** Resolved "Unassigned" label for the officer fallback. */
  unassignedLabel: string;
  /**
   * Localized practice-area labels keyed by normalized case_type. Unknown keys
   * fall back to a humanized form, so this is optional/best-effort.
   */
  practiceAreas?: Record<string, string>;
  now?: Date;
}

export function buildAnalytics({
  cases,
  officers,
  settlements,
  unassignedLabel,
  practiceAreas = {},
  now = new Date(),
}: BuildInputs): LegalOpsAnalytics {
  const recentCutoff = new Date(
    now.getTime() - RECENT_WINDOW_DAYS * MS_PER_DAY,
  );

  // --- Workload matrix (officer × practice-area) over OPEN matters ---------
  const officerAgg = new Map<
    string,
    { label: string; total: number; active: number; caseIds: string[] }
  >();
  const areaAgg = new Map<
    string,
    { label: string; total: number; caseIds: string[] }
  >();
  const cells = new Map<string, Map<string, WorkloadCell>>();
  let max = 0;
  let maxActive = 0;

  // --- Velocity scaffolding -------------------------------------------------
  const weekMap = new Map<string, WeekPoint>();
  const earliestWeek = weekStart(
    new Date(now.getTime() - WEEKS_BACK * 7 * MS_PER_DAY),
  );
  for (let i = 0; i <= WEEKS_BACK; i += 1) {
    const wd = new Date(earliestWeek.getTime() + i * 7 * MS_PER_DAY);
    const key = isoKey(wd);
    weekMap.set(key, {
      week: key,
      weekDate: wd,
      opened: 0,
      closed: 0,
      openedCaseIds: [],
      closedCaseIds: [],
    });
  }

  // --- Phase dwell accumulators --------------------------------------------
  const dwell = new Map<
    CaseStatus,
    {
      totalDays: number;
      count: number;
      caseIds: string[];
    }
  >();

  let activeMatters = 0;
  let closedRecent = 0;
  let closeDaysTotal = 0;
  let closeDaysCount = 0;
  const activeMatterIds: string[] = [];
  const closedRecentIds: string[] = [];
  const closedCaseIds: string[] = [];

  for (const c of cases) {
    const created = safeDate(c.created_at);
    const updated = safeDate(c.updated_at) ?? created;
    const isActive = ACTIVE_STATUSES.has(c.status);
    const isClosed = CLOSED_STATUSES.has(c.status);

    if (isActive) {
      activeMatters += 1;
      activeMatterIds.push(c.id);
    }

    // Workload grid uses OPEN matters only (current load).
    if (isActive) {
      const officerId = c.handling_officer_id ?? "__unassigned__";
      const officerLabel = c.handling_officer_id
        ? (officers.get(c.handling_officer_id) ??
          shortId(c.handling_officer_id))
        : unassignedLabel;
      const areaKey =
        (c.case_type ?? "__unassigned__").trim().toLowerCase() ||
        "__unassigned__";
      const areaLabel =
        practiceAreas[areaKey] ??
        humanizePracticeArea(c.case_type) ??
        unassignedLabel;

      const oa = officerAgg.get(officerId) ?? {
        label: officerLabel,
        total: 0,
        active: 0,
        caseIds: [],
      };
      oa.total += 1;
      oa.active += 1;
      oa.caseIds.push(c.id);
      officerAgg.set(officerId, oa);

      const aa = areaAgg.get(areaKey) ?? {
        label: areaLabel,
        total: 0,
        caseIds: [],
      };
      aa.total += 1;
      aa.caseIds.push(c.id);
      areaAgg.set(areaKey, aa);

      let row = cells.get(officerId);
      if (!row) {
        row = new Map<string, WorkloadCell>();
        cells.set(officerId, row);
      }
      const cell = row.get(areaKey) ?? { count: 0, active: 0, caseIds: [] };
      cell.count += 1;
      cell.active += 1;
      cell.caseIds.push(c.id);
      row.set(areaKey, cell);
      if (cell.count > max) max = cell.count;
      if (cell.active > maxActive) maxActive = cell.active;
    }

    // Velocity: opened-per-week (by created_at).
    if (created) {
      const wk = isoKey(weekStart(created));
      const wp = weekMap.get(wk);
      if (wp) {
        wp.opened += 1;
        wp.openedCaseIds.push(c.id);
      }
    }

    // Velocity + KPI: closed-per-week + avg time-to-close (by updated_at on a
    // closed status — the closest available proxy for the close timestamp).
    if (isClosed && updated) {
      closedCaseIds.push(c.id);
      const wk = isoKey(weekStart(updated));
      const wp = weekMap.get(wk);
      if (wp) {
        wp.closed += 1;
        wp.closedCaseIds.push(c.id);
      }
      if (updated >= recentCutoff) {
        closedRecent += 1;
        closedRecentIds.push(c.id);
      }
      if (created) {
        closeDaysTotal += diffDays(created, updated);
        closeDaysCount += 1;
      }
    }

    // Phase dwell: how long open cases have sat in their current status.
    if (isActive && updated) {
      const e = dwell.get(c.status) ?? { totalDays: 0, count: 0, caseIds: [] };
      e.totalDays += diffDays(updated, now);
      e.count += 1;
      e.caseIds.push(c.id);
      dwell.set(c.status, e);
    }
  }

  // Officer rows sorted by total load (busiest first).
  const officersSorted = Array.from(officerAgg.entries())
    .map(([id, v]) => ({
      id,
      label: v.label,
      total: v.total,
      active: v.active,
      caseIds: v.caseIds,
    }))
    .sort((a, b) => b.total - a.total);

  // Area columns sorted by total load (busiest first).
  const areasSorted = Array.from(areaAgg.entries())
    .map(([key, v]) => ({
      key,
      label: v.label,
      total: v.total,
      caseIds: v.caseIds,
    }))
    .sort((a, b) => b.total - a.total);

  const workload: WorkloadMatrix = {
    officers: officersSorted,
    areas: areasSorted,
    cells,
    max,
    maxActive,
  };

  const weekly = Array.from(weekMap.values()).sort((a, b) =>
    a.week.localeCompare(b.week),
  );

  const phaseDwell: PhaseDwellPoint[] = Array.from(dwell.entries())
    .map(([status, v]) => ({
      status,
      avgDays: v.count > 0 ? Math.round(v.totalDays / v.count) : 0,
      count: v.count,
      caseIds: v.caseIds,
    }))
    .sort((a, b) => b.avgDays - a.avgDays);

  // Settlement cycle-time: created → executed for EXECUTED settlements.
  const settlementCycle: SettlementCyclePoint[] = settlements
    .map((s) => {
      const created = safeDate(s.created_at);
      const executed = safeDate(s.executed_at ?? null);
      if (!created || !executed) return null;
      return {
        id: s.id,
        reference: s.reference,
        cycleDays: diffDays(created, executed),
        value: typeof s.value === "number" ? s.value : 0,
      } satisfies SettlementCyclePoint;
    })
    .filter((p): p is SettlementCyclePoint => p !== null)
    .sort((a, b) => b.value - a.value)
    .slice(0, 12);

  const settlementCycleDays =
    settlementCycle.length > 0
      ? Math.round(
          settlementCycle.reduce((sum, p) => sum + p.cycleDays, 0) /
            settlementCycle.length,
        )
      : null;

  // Weekly throughput = avg closed per week over the recent populated weeks.
  const recentWeeks = weekly.slice(-Math.min(weekly.length, 8));
  const throughputCaseIds = Array.from(
    new Set(recentWeeks.flatMap((week) => week.closedCaseIds)),
  );
  const weeklyThroughput =
    recentWeeks.length > 0
      ? Math.round(
          (recentWeeks.reduce((sum, w) => sum + w.closed, 0) /
            recentWeeks.length) *
            10,
        ) / 10
      : 0;

  const busiest =
    officersSorted.find((o) => o.id !== "__unassigned__") ?? officersSorted[0];

  const kpis: LegalOpsKpis = {
    activeMatters,
    closedRecent,
    avgCloseDays:
      closeDaysCount > 0 ? Math.round(closeDaysTotal / closeDaysCount) : null,
    settlementCycleDays,
    weeklyThroughput,
    busiestOfficerLabel: busiest ? busiest.label : null,
    busiestOfficerId: busiest ? busiest.id : null,
    busiestOfficerCount: busiest ? busiest.total : 0,
    activeMatterIds,
    closedRecentIds,
    closedCaseIds,
    settlementIds: settlementCycle.map((point) => point.id),
    throughputCaseIds,
  };

  return {
    total: cases.length,
    workload,
    weekly,
    phaseDwell,
    settlementCycle,
    kpis,
  };
}

function shortId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

/* ------------------------------------------------------------------------- *
 * Build the officer-id → display-name map from the org-entity registry.
 * ------------------------------------------------------------------------- */

function buildOfficerMap(
  entities: OrgEntity[],
  locale: AppLocale,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const e of entities) {
    const label = resolveLocalized(e.name, locale);
    if (!label) continue;
    // Index by the entity id AND by any role-bound user ids so a case's
    // handling_officer_id (a user id) still resolves to a human name.
    map.set(e.id, label);
    if (e.platform_org_unit_id) map.set(e.platform_org_unit_id, label);
    for (const role of e.roles ?? []) {
      if (role.user_id) {
        const roleLabel = resolveLocalized(role.label, locale) || label;
        map.set(role.user_id, roleLabel);
      }
    }
  }
  return map;
}

/* ------------------------------------------------------------------------- *
 * The page-facing hook.
 * ------------------------------------------------------------------------- */

export interface UseLegalOpsAnalyticsResult {
  analytics: LegalOpsAnalytics | undefined;
  sources: { cases: LegalCase[]; settlements: Settlement[] };
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
}

export function useLegalOpsAnalytics(
  locale: AppLocale,
  unassignedLabel: string,
  practiceAreas: Record<string, string> = {},
): UseLegalOpsAnalyticsResult {
  const casesQuery = useQuery({
    queryKey: ["lex-analytics", "cases"],
    queryFn: () =>
      fetchSuitePaginated<LegalCase>(CASES_ENDPOINT, {
        page: 1,
        per_page: ANALYTICS_PAGE_SIZE,
        sort: "updated_at",
        order: "desc",
      }),
  });

  const officersQuery = useQuery({
    queryKey: ["lex-analytics", "org-entities"],
    queryFn: () =>
      lexAdminApi.listOrgEntities({ page: 1, per_page: ANALYTICS_PAGE_SIZE }),
    // The registry is supplementary: missing/forbidden it just means we fall
    // back to short ids, so a failure must not blank the whole page.
    retry: false,
  });

  const settlementsQuery = useQuery({
    queryKey: ["lex-analytics", "settlements"],
    queryFn: () =>
      settlementsApi.list({
        page: 1,
        per_page: ANALYTICS_PAGE_SIZE,
        sort: "created_at",
        order: "desc",
      }),
    retry: false,
  });

  const analytics = useMemo(() => {
    if (!casesQuery.data) return undefined;
    const officers = buildOfficerMap(officersQuery.data?.data ?? [], locale);
    return buildAnalytics({
      cases: casesQuery.data.data,
      officers,
      settlements: settlementsQuery.data?.data ?? [],
      locale,
      unassignedLabel,
      practiceAreas,
    });
  }, [
    casesQuery.data,
    officersQuery.data,
    settlementsQuery.data,
    locale,
    unassignedLabel,
    practiceAreas,
  ]);

  return {
    analytics,
    sources: {
      cases: casesQuery.data?.data ?? [],
      settlements: settlementsQuery.data?.data ?? [],
    },
    // Only the cases query is load-bearing; the others are best-effort.
    isLoading: casesQuery.isLoading,
    isError: casesQuery.isError,
    error: casesQuery.error,
    refetch: () => {
      void casesQuery.refetch();
      void officersQuery.refetch();
      void settlementsQuery.refetch();
    },
  };
}
