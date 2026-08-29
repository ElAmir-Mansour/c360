"use client";

/**
 * Legal-Ops Analytics (features #21 workload heatmap + #22 velocity / cycle-time).
 *
 * A premium, bilingual, RTL-safe analytics surface that mirrors the quality bar
 * of the Settlements / Compliance domains:
 *
 *   - A `LexKpiStrip` header of legal-ops headline metrics (active matters,
 *     recently closed, avg days-to-close, settlement cycle, weekly throughput,
 *     busiest officer) — all KSA-formatted.
 *   - A CSS-grid WORKLOAD HEATMAP of OPEN matters by handling officer × practice
 *     area (feature #21), hand-rolled like the cyber MITRE heatmap (no recharts).
 *   - VELOCITY charts (feature #22): opened-vs-closed per week, average
 *     days-in-phase, and settlement cycle time, on the shared chart primitives.
 *
 * All analytics are computed CLIENT-SIDE from already-existing list endpoints
 * (legal-cases + settlements + the org registry for officer names) via
 * `useLegalOpsAnalytics` — no endpoints are invented. The page is permission-
 * gated on `lex:read`, sets `dir` from the active locale, and degrades to the
 * shared skeleton / empty states.
 */

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Briefcase,
  CheckCircle2,
  Clock,
  Gauge,
  Handshake,
  LayoutGrid,
  TrendingUp,
  UserCheck,
} from "lucide-react";

import { LexRouteGuard } from "../_guards/lex-route-guard";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/components/providers/locale-provider";
import { useLexFormat } from "@/lib/lex/ksa";
import { LexKpiStrip, type LexKpiItem } from "@/components/lex/kpi-strip";
import { LexEmptyState } from "@/components/lex/empty-state";
import { resolveLocalized } from "@/lib/i18n/localized";
import { downloadBlob } from "@/lib/format";
import { showApiError } from "@/lib/toast";
import {
  buildTabularReportCsv,
  buildTabularReportXlsx,
  type TabularReport,
} from "@/lib/lex/tabular-report-export";
import {
  PrintableReport,
  ReportExportMenu,
  ReportPeriodControl,
} from "@/components/lex/reports";

import { useAnalyticsLabels } from "./_components/analytics-labels";
import { useLegalOpsAnalytics } from "./_components/use-legal-ops-analytics";
import { WorkloadHeatmap } from "./_components/workload-heatmap";
import { VelocityCharts } from "./_components/velocity-charts";
import {
  SourceRecordsDrilldown,
  type AnalyticsSourceRecord,
  type AnalyticsSourceSelection,
} from "./_components/source-records-drilldown";

function percent(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((part / whole) * 100)));
}

export default function LexAnalyticsPage() {
  const { locale, direction } = useLocale();
  const f = useLexFormat();
  const labels = useAnalyticsLabels();

  const { analytics, sources, isLoading, isError, refetch } =
    useLegalOpsAnalytics(
      locale,
      labels.heatmap.unassigned,
      labels.practiceAreas,
    );
  const [sourceSelection, setSourceSelection] =
    useState<AnalyticsSourceSelection | null>(null);
  const [exporting, setExporting] = useState<"csv" | "xlsx" | null>(null);
  const reportPeriod =
    locale === "ar"
      ? "لقطة حالية · مؤشرات حديثة لمدة 90 يومًا"
      : "Current snapshot · recent 90-day indicators";

  const exportCurrentView = async (kind: "csv" | "xlsx") => {
    if (!analytics) return;
    const section = locale === "ar" ? "القسم" : "Section";
    const metric = locale === "ar" ? "المؤشر" : "Metric";
    const value = locale === "ar" ? "القيمة" : "Value";
    const k = analytics.kpis;
    const report: TabularReport = {
      name: labels.page.title,
      rtl: direction === "rtl",
      headers: [section, metric, value],
      rows: [
        [labels.page.title, labels.kpi.activeMatters, k.activeMatters],
        [labels.page.title, labels.kpi.closedThisQuarter, k.closedRecent],
        [labels.page.title, labels.kpi.avgCycleDays, k.avgCloseDays],
        [labels.page.title, labels.kpi.settlementCycleDays, k.settlementCycleDays],
        [labels.page.title, labels.kpi.weeklyThroughput, k.weeklyThroughput],
        [labels.page.title, labels.kpi.busiestOfficer, k.busiestOfficerLabel],
        ...analytics.weekly.flatMap((point) => [
          [labels.velocity.closedPerWeek, `${point.week} · ${labels.velocity.opened}`, point.opened],
          [labels.velocity.closedPerWeek, `${point.week} · ${labels.velocity.closed}`, point.closed],
        ]),
        ...analytics.phaseDwell.map((point) => [
          labels.velocity.avgDaysInPhase,
          labels.status[point.status],
          point.avgDays,
        ]),
        ...analytics.settlementCycle.map((point) => [
          labels.velocity.settlementCycle,
          point.reference,
          point.cycleDays,
        ]),
      ],
    };
    try {
      setExporting(kind);
      const blob =
        kind === "csv"
          ? buildTabularReportCsv(report)
          : await buildTabularReportXlsx(report);
      downloadBlob(blob, `lex-legal-ops-${new Date().toISOString().slice(0, 10)}.${kind}`);
    } catch (error) {
      showApiError(error);
    } finally {
      setExporting(null);
    }
  };

  const kpiItems = useMemo<LexKpiItem[]>(() => {
    const k = analytics?.kpis;
    const KL = labels.kpi;
    const KD = labels.kpiDetails;

    // Weekly spark from the recent opened/closed throughput.
    const spark = analytics?.weekly.slice(-8).map((w) => w.closed) ?? [];
    const activeTotal = k?.activeMatters ?? 0;
    const closedShare = percent(
      k?.closedRecent ?? 0,
      activeTotal + (k?.closedRecent ?? 0),
    );
    const busiestShare = percent(k?.busiestOfficerCount ?? 0, activeTotal);
    const casesById = new Map(
      sources.cases.map((legalCase) => [legalCase.id, legalCase]),
    );
    const settlementsById = new Map(
      sources.settlements.map((settlement) => [settlement.id, settlement]),
    );
    const caseRecords = (ids: string[]): AnalyticsSourceRecord[] =>
      ids.flatMap((id) => {
        const legalCase = casesById.get(id);
        if (!legalCase) return [];
        return [
          {
            id,
            href: `/lex/cases/${id}`,
            eyebrow: legalCase.case_number,
            title:
              resolveLocalized(legalCase.title, locale) ||
              legalCase.case_number,
            status: legalCase.status,
            details: [
              {
                label: labels.heatmap.officer,
                value:
                  legalCase.responsible_lawyer || labels.heatmap.unassigned,
              },
              { label: labels.heatmap.total, value: legalCase.case_type },
            ],
          },
        ];
      });
    const settlementRecords = (ids: string[]): AnalyticsSourceRecord[] =>
      ids.flatMap((id) => {
        const settlement = settlementsById.get(id);
        if (!settlement) return [];
        return [
          {
            id,
            href: `/lex/settlements/${id}`,
            eyebrow: settlement.reference,
            title: settlement.title,
            status: settlement.status,
          },
        ];
      });
    const openCases = (title: string, description: string, ids: string[]) =>
      setSourceSelection({ title, description, records: caseRecords(ids) });
    const openSettlements = (
      title: string,
      description: string,
      ids: string[],
    ) =>
      setSourceSelection({
        title,
        description,
        records: settlementRecords(ids),
      });

    return [
      {
        id: "active",
        label: KL.activeMatters,
        value: k?.activeMatters,
        theme: "primary",
        icon: Briefcase,
        description: KD.activeMatters,
        progress: activeTotal > 0 ? 100 : 0,
        progressLabel: KD.workloadShare,
        detail: labels.heatmap.total,
        detailValue: f.formatNumber(activeTotal),
        loading: isLoading,
        onAction: () =>
          openCases(
            KL.activeMatters,
            KD.activeMatters,
            k?.activeMatterIds ?? [],
          ),
      },
      {
        id: "closed",
        label: KL.closedThisQuarter,
        value: k?.closedRecent,
        theme: "emerald",
        icon: CheckCircle2,
        description: KD.closedThisQuarter,
        progress: closedShare,
        progressLabel: KD.recentWindow,
        detail: KL.closedThisQuarter,
        detailValue: `${f.formatNumber(closedShare)}%`,
        loading: isLoading,
        spark: spark.length > 1 ? spark : undefined,
        onAction: () =>
          openCases(
            KL.closedThisQuarter,
            KD.closedThisQuarter,
            k?.closedRecentIds ?? [],
          ),
      },
      {
        id: "cycle",
        label: KL.avgCycleDays,
        value: k?.avgCloseDays != null ? f.formatNumber(k.avgCloseDays) : "—",
        unit: k?.avgCloseDays != null ? KL.days : undefined,
        theme: "amber",
        icon: Clock,
        description: KD.avgCycleDays,
        detail: labels.velocity.avgDaysInPhase,
        detailValue:
          k?.avgCloseDays != null ? f.formatNumber(k.avgCloseDays) : "—",
        loading: isLoading,
        onAction: () =>
          openCases(KL.avgCycleDays, KD.avgCycleDays, k?.closedCaseIds ?? []),
      },
      {
        id: "settlement",
        label: KL.settlementCycleDays,
        value:
          k?.settlementCycleDays != null
            ? f.formatNumber(k.settlementCycleDays)
            : "—",
        unit: k?.settlementCycleDays != null ? KL.days : undefined,
        theme: "teal",
        icon: Handshake,
        description: KD.settlementCycleDays,
        detail: labels.velocity.settlementCycle,
        detailValue:
          k?.settlementCycleDays != null
            ? f.formatNumber(k.settlementCycleDays)
            : "—",
        loading: isLoading,
        onAction: () =>
          openSettlements(
            KL.settlementCycleDays,
            KD.settlementCycleDays,
            k?.settlementIds ?? [],
          ),
      },
      {
        id: "throughput",
        label: KL.weeklyThroughput,
        value:
          k?.weeklyThroughput != null
            ? f.formatNumber(k.weeklyThroughput)
            : "—",
        unit: KL.perWeek,
        theme: "primary",
        icon: TrendingUp,
        description: KD.weeklyThroughput,
        detail: labels.velocity.closedPerWeek,
        detailValue:
          k?.weeklyThroughput != null
            ? f.formatNumber(k.weeklyThroughput)
            : "—",
        loading: isLoading,
        onAction: () =>
          openCases(
            KL.weeklyThroughput,
            KD.weeklyThroughput,
            k?.throughputCaseIds ?? [],
          ),
      },
      {
        id: "busiest",
        label: KL.busiestOfficer,
        value: k?.busiestOfficerLabel ?? KL.noOfficer,
        theme: "primary",
        icon: UserCheck,
        description: KD.busiestOfficer,
        progress: busiestShare,
        progressLabel: KD.workloadShare,
        detail: KL.activeMatters,
        detailValue: `${f.formatNumber(busiestShare)}%`,
        loading: isLoading,
        onAction: () =>
          openCases(
            KL.busiestOfficer,
            KD.busiestOfficer,
            analytics?.workload.officers.find(
              (officer) => officer.id === k?.busiestOfficerId,
            )?.caseIds ?? [],
          ),
      },
    ];
  }, [
    analytics,
    sources.cases,
    sources.settlements,
    labels,
    isLoading,
    f,
    locale,
  ]);

  return (
    <LexRouteGuard requirement="lex:report:read">
      <div dir={direction} lang={locale} className="space-y-6">
        <PageHeader
          eyebrow={labels.page.eyebrow}
          title={labels.page.title}
          description={labels.page.description}
          actions={
            <div className="flex flex-wrap items-end gap-2">
              <ReportPeriodControl
                value={{ from: undefined, to: undefined }}
                onChange={() => undefined}
                fixedLabel={reportPeriod}
              />
              <ReportExportMenu
                onCsv={() => exportCurrentView("csv")}
                onXlsx={() => exportCurrentView("xlsx")}
                exporting={exporting}
                disabled={!analytics}
              />
              <Button
                variant="outline"
                onClick={() => refetch()}
                className="gap-2"
                data-report-no-print="true"
              >
                <Gauge className="h-4 w-4" aria-hidden />
                {labels.page.refresh}
              </Button>
            </div>
          }
        />

        <PrintableReport
          title={labels.page.title}
          period={{ label: reportPeriod }}
          contentClassName="space-y-6"
        >
        {/* KPI strip */}
        <LexKpiStrip items={kpiItems} columns={6} />

        {isError ? (
          <div className="card p-2">
            <LexEmptyState
              icon={AlertTriangle}
              title={labels.velocity.empty}
              description={labels.heatmap.emptyHint}
              action={{ label: labels.page.refresh, onClick: () => refetch() }}
            />
          </div>
        ) : (
          <>
            {/* Feature #21 — workload heatmap */}
            <section
              className="card p-5 motion-safe:animate-fade-up"
              data-report-section="true"
            >
              <header className="mb-4 flex items-start gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[image:var(--ds-gradient-primary)] text-primary-foreground shadow-elevation-1 ring-1 ring-inset ring-white/15">
                  <LayoutGrid className="h-[1.1rem] w-[1.1rem]" aria-hidden />
                </span>
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold tracking-tight text-foreground">
                    {labels.heatmap.title}
                  </h2>
                  <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                    {labels.heatmap.description}
                  </p>
                </div>
              </header>

              {isLoading ? (
                <HeatmapSkeleton />
              ) : analytics ? (
                <WorkloadHeatmap
                  matrix={analytics.workload}
                  labels={labels.heatmap}
                />
              ) : null}
            </section>

            {/* Feature #22 — velocity & cycle-time */}
            {analytics ? (
              <section data-report-section="true">
              <VelocityCharts
                analytics={analytics}
                labels={labels}
                onOpenCases={(title, description, ids) => {
                  const byId = new Map(
                    sources.cases.map((legalCase) => [legalCase.id, legalCase]),
                  );
                  setSourceSelection({
                    title,
                    description,
                    records: ids.flatMap((id) => {
                      const legalCase = byId.get(id);
                      if (!legalCase) return [];
                      return [{
                        id,
                        href: `/lex/cases/${id}`,
                        eyebrow: legalCase.case_number,
                        title: resolveLocalized(legalCase.title, locale) || legalCase.case_number,
                        status: legalCase.status,
                      }];
                    }),
                  });
                }}
                onOpenSettlements={(title, description, ids) => {
                  const byId = new Map(
                    sources.settlements.map((settlement) => [settlement.id, settlement]),
                  );
                  setSourceSelection({
                    title,
                    description,
                    records: ids.flatMap((id) => {
                      const settlement = byId.get(id);
                      if (!settlement) return [];
                      return [{
                        id,
                        href: `/lex/settlements/${id}`,
                        eyebrow: settlement.reference,
                        title: settlement.title,
                        status: settlement.status,
                      }];
                    }),
                  });
                }}
              />
              </section>
            ) : isLoading ? (
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                <ChartSkeletonCard className="xl:col-span-2" />
                <ChartSkeletonCard />
                <ChartSkeletonCard />
              </div>
            ) : null}
          </>
        )}
        </PrintableReport>

        <SourceRecordsDrilldown
          selection={sourceSelection}
          onOpenChange={(open) => {
            if (!open) setSourceSelection(null);
          }}
        />
      </div>
    </LexRouteGuard>
  );
}

/* ------------------------------------------------------------------------- *
 * Local skeletons (shimmer, motion-safe) for the loading window.
 * ------------------------------------------------------------------------- */

function HeatmapSkeleton() {
  return (
    <div className="space-y-2" aria-hidden>
      {Array.from({ length: 6 }).map((_, r) => (
        <div key={r} className="flex items-center gap-1">
          <div className="h-11 w-36 shrink-0 rounded-md skeleton-shimmer" />
          {Array.from({ length: 7 }).map((__, c) => (
            <div key={c} className="h-11 flex-1 rounded-md skeleton-shimmer" />
          ))}
        </div>
      ))}
    </div>
  );
}

function ChartSkeletonCard({ className }: { className?: string }) {
  return (
    <div className={`card p-5 ${className ?? ""}`} aria-hidden>
      <div className="mb-4 h-9 w-44 rounded-lg skeleton-shimmer" />
      <div className="h-[240px] w-full rounded-card skeleton-shimmer" />
    </div>
  );
}
