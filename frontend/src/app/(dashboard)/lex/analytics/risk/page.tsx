"use client";

/**
 * Portfolio Risk & Value dashboard (features #18 + #19).
 *
 * A premium, bilingual, RTL-safe intelligence surface that mirrors the quality
 * bar of the Settlements / Compliance domains:
 *
 *   - A `LexKpiStrip` header of portfolio headline metrics (portfolio value,
 *     active value, value-at-risk, high-risk share, expiring-soon, avg risk
 *     score) — all KSA-formatted (SAR + Arabic-Indic in ar).
 *   - RISK DISTRIBUTION (#18): a value-weighted risk gauge + analysis-coverage
 *     gauge, a high/med/low donut, and a 0–100 score-band histogram.
 *   - MATTER URGENCY + OBLIGATION MATURITY (#18): open matters by priority
 *     (overdue flagged) and open obligations bucketed by due horizon.
 *   - VALUE & RENEWAL CLIFF (#19): value-at-risk split and the 12-month value
 *     expiring timeline, with the peak-exposure month called out.
 *
 * Every analytic is computed CLIENT-SIDE from the existing contracts / matters /
 * obligations list endpoints via `usePortfolioRisk` — no endpoints are invented.
 * Permission-gated on `lex:read`; `dir` is set from the active locale.
 */

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Banknote,
  CalendarX2,
  Gauge,
  PieChart as PieIcon,
  ShieldAlert,
  TrendingDown,
  Wallet,
} from "lucide-react";

import { LexRouteGuard } from "../../_guards/lex-route-guard";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/components/providers/locale-provider";
import { useLexFormat } from "@/lib/lex/ksa";
import { LexKpiStrip, type LexKpiItem } from "@/components/lex/kpi-strip";
import { LexEmptyState } from "@/components/lex/empty-state";
import { downloadBlob } from "@/lib/format";
import { showApiError } from "@/lib/toast";
import {
  buildTabularReportCsv,
  buildTabularReportXlsx,
  type TabularReport,
} from "@/lib/lex/tabular-report-export";

import { useRiskLabels } from "./_lib/risk-labels";
import { usePortfolioRisk } from "./_lib/use-portfolio-risk";
import { RiskDistributionSection } from "./_components/risk-distribution";
import { UrgencyMaturitySection } from "./_components/urgency-maturity";
import { ValueVisualsSection } from "./_components/value-visuals";
import { RiskRegisterSection } from "./_components/risk-register";
import { ObligationsPanel } from "./_components/obligations-panel";
import {
  SourceRecordsDrilldown,
  type AnalyticsSourceRecord,
  type AnalyticsSourceSelection,
} from "../_components/source-records-drilldown";
import {
  PrintableReport,
  ReportExportMenu,
  ReportPeriodControl,
} from "@/components/lex/reports";

function percent(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((part / whole) * 100)));
}

export default function PortfolioRiskPage() {
  const { locale, direction } = useLocale();
  const f = useLexFormat();
  const labels = useRiskLabels();

  const { data, sources, isLoading, isError, refetch } = usePortfolioRisk();
  const [sourceSelection, setSourceSelection] =
    useState<AnalyticsSourceSelection | null>(null);
  const [exporting, setExporting] = useState<"csv" | "xlsx" | null>(null);
  const reportPeriod =
    locale === "ar"
      ? "لقطة المحفظة الحالية · استحقاقات الـ 12 شهرًا القادمة"
      : "Current portfolio snapshot · next 12 months";

  const exportCurrentView = async (kind: "csv" | "xlsx") => {
    if (!data) return;
    const report: TabularReport = {
      name: labels.page.title,
      rtl: direction === "rtl",
      headers:
        locale === "ar"
          ? ["القسم", "المؤشر", "القيمة"]
          : ["Section", "Metric", "Value"],
      rows: [
        [labels.page.title, labels.kpi.portfolioValue, data.kpis.portfolioValue],
        [labels.page.title, labels.kpi.activeValue, data.kpis.activeValue],
        [labels.page.title, labels.kpi.valueAtRisk, data.kpis.valueAtRisk],
        [labels.page.title, labels.kpi.expiring90, data.kpis.expiring90],
        [labels.page.title, labels.kpi.avgRiskScore, data.kpis.avgRiskScore],
        [labels.risk.title, labels.risk.scored, data.distribution.scored],
        [labels.risk.title, labels.risk.unscored, data.distribution.unscored],
        ...data.distribution.bands.map((point) => [
          labels.risk.donutTitle,
          labels.bands[point.band],
          point.count,
        ]),
        ...data.urgency.flatMap((point) => [
          [labels.urgency.title, `${labels.priority[point.priority]} · ${labels.urgency.open}`, point.open],
          [labels.urgency.title, `${labels.priority[point.priority]} · ${labels.urgency.overdue}`, point.overdue],
        ]),
        ...data.maturity.map((point) => [
          labels.maturity.title,
          labels.maturity[point.key],
          point.count,
        ]),
        ...data.cliff.flatMap((point) => [
          [labels.cliff.title, `${point.month} · ${labels.cliff.valueAxis}`, point.value],
          [labels.cliff.title, `${point.month} · ${labels.cliff.count}`, point.count],
        ]),
      ],
    };
    try {
      setExporting(kind);
      const blob =
        kind === "csv"
          ? buildTabularReportCsv(report)
          : await buildTabularReportXlsx(report);
      downloadBlob(blob, `lex-risk-portfolio-${new Date().toISOString().slice(0, 10)}.${kind}`);
    } catch (error) {
      showApiError(error);
    } finally {
      setExporting(null);
    }
  };

  const kpiItems = useMemo<LexKpiItem[]>(() => {
    const k = data?.kpis;
    const d = data?.distribution;
    const KL = labels.kpi;
    const KD = labels.kpiDetails;

    // Cliff spark: value expiring per month, so the KPI hints at the curve.
    const spark = data?.cliff.map((p) => Math.round(p.value / 1000)) ?? [];
    const activeValueShare = k ? percent(k.activeValue, k.portfolioValue) : 0;
    const valueAtRiskShare = k ? Math.round(k.valueAtRiskShare * 100) : 0;
    const highRiskShare = d ? Math.round(d.highShare * 100) : 0;
    const contractsById = new Map(
      sources.contracts.map((contract) => [contract.id, contract]),
    );
    const contractRecords = (ids: string[]): AnalyticsSourceRecord[] =>
      ids.flatMap((id) => {
        const contract = contractsById.get(id);
        if (!contract) return [];
        return [
          {
            id,
            href: `/lex/contracts/${id}`,
            eyebrow: contract.contract_number || id.slice(0, 8),
            title: contract.title,
            status: contract.status,
            details: [
              {
                label: KL.ofPortfolio,
                value:
                  contract.total_value != null
                    ? f.formatCurrency(contract.total_value, {
                        currency: contract.currency || "SAR",
                      })
                    : "—",
              },
              {
                label: labels.risk.gaugeLabel,
                value:
                  contract.risk_score != null
                    ? f.formatNumber(contract.risk_score)
                    : contract.risk_level,
              },
            ],
          },
        ];
      });
    const openContracts = (title: string, description: string, ids: string[]) =>
      setSourceSelection({
        title,
        description,
        records: contractRecords(ids),
      });

    return [
      {
        id: "portfolio",
        label: KL.portfolioValue,
        value: k ? f.formatCurrencyCompact(k.portfolioValue) : "—",
        theme: "primary",
        icon: Wallet,
        description: KD.portfolioValue,
        progress: k && k.portfolioValue > 0 ? 100 : 0,
        progressLabel: KD.portfolioShare,
        detail: KL.contracts,
        detailValue: f.formatNumber(data?.contractCount ?? 0),
        loading: isLoading,
        onAction: () =>
          openContracts(
            KL.portfolioValue,
            KD.portfolioValue,
            k?.portfolioContractIds ?? [],
          ),
      },
      {
        id: "active",
        label: KL.activeValue,
        value: k ? f.formatCurrencyCompact(k.activeValue) : "—",
        theme: "emerald",
        icon: Banknote,
        description: KD.activeValue,
        progress: activeValueShare,
        progressLabel: KD.activeExposure,
        detail: KL.ofPortfolio,
        detailValue: `${f.formatNumber(activeValueShare)}%`,
        loading: isLoading,
        onAction: () =>
          openContracts(
            KL.activeValue,
            KD.activeValue,
            k?.activeContractIds ?? [],
          ),
      },
      {
        id: "var",
        label: KL.valueAtRisk,
        value: k ? f.formatCurrencyCompact(k.valueAtRisk) : "—",
        theme: "red",
        icon: ShieldAlert,
        description: KD.valueAtRisk,
        progress: valueAtRiskShare,
        progressLabel: KL.ofPortfolio,
        detail: KD.activeExposure,
        detailValue: `${f.formatNumber(valueAtRiskShare)}%`,
        loading: isLoading,
        spark: spark.length > 1 ? spark : undefined,
        onAction: () =>
          openContracts(
            KL.valueAtRisk,
            KD.valueAtRisk,
            k?.valueAtRiskContractIds ?? [],
          ),
      },
      {
        id: "high-share",
        label: KL.highRiskShare,
        value: d
          ? f.formatPercent(d.highShare, { maximumFractionDigits: 0 })
          : "—",
        theme: "orange",
        icon: PieIcon,
        description: KD.highRiskShare,
        progress: highRiskShare,
        progressLabel: KD.scoredContracts,
        detail: labels.risk.scored,
        detailValue: f.formatNumber(d?.scored ?? 0),
        loading: isLoading,
        onAction: () =>
          openContracts(
            KL.highRiskShare,
            KD.highRiskShare,
            d?.bandContractIds.high ?? [],
          ),
      },
      {
        id: "expiring",
        label: KL.expiring90,
        value: k?.expiring90,
        unit: KL.contracts,
        theme: "amber",
        icon: CalendarX2,
        description: KD.expiring90,
        progress: percent(k?.expiring90 ?? 0, data?.contractCount ?? 0),
        progressLabel: KL.contracts,
        detail: labels.cliff.peakMonth,
        detailValue:
          data && data.peakCliffIndex >= 0
            ? f.formatDate(data.cliff[data.peakCliffIndex]?.monthDate)
            : "—",
        loading: isLoading,
        onAction: () =>
          openContracts(
            KL.expiring90,
            KD.expiring90,
            k?.expiring90ContractIds ?? [],
          ),
      },
      {
        id: "risk-score",
        label: KL.avgRiskScore,
        value: k?.avgRiskScore != null ? f.formatNumber(k.avgRiskScore) : "—",
        unit: KL.perScore,
        theme: "primary",
        icon: Gauge,
        description: KD.avgRiskScore,
        progress: k?.avgRiskScore ?? 0,
        progressLabel: labels.risk.gaugeLabel,
        detail: KL.perScore,
        detailValue:
          k?.avgRiskScore != null ? f.formatNumber(k.avgRiskScore) : "—",
        loading: isLoading,
        onAction: () =>
          openContracts(
            KL.avgRiskScore,
            KD.avgRiskScore,
            d?.scoredContractIds ?? [],
          ),
      },
    ];
  }, [data, sources.contracts, labels, isLoading, f]);

  const openContractRecords = (
    title: string,
    description: string,
    ids: string[],
  ) => {
    const byId = new Map(sources.contracts.map((contract) => [contract.id, contract]));
    setSourceSelection({
      title,
      description,
      records: ids.flatMap((id) => {
        const contract = byId.get(id);
        if (!contract) return [];
        return [{
          id,
          href: `/lex/contracts/${id}`,
          eyebrow: contract.contract_number || id.slice(0, 8),
          title: contract.title,
          status: contract.status,
        }];
      }),
    });
  };

  const openMatterRecords = (
    title: string,
    description: string,
    ids: string[],
  ) => {
    const byId = new Map(sources.matters.map((matter) => [matter.id, matter]));
    setSourceSelection({
      title,
      description,
      records: ids.flatMap((id) => {
        const matter = byId.get(id);
        if (!matter) return [];
        return [{
          id,
          href: `/lex/matters/${id}`,
          eyebrow: matter.matter_number || id.slice(0, 8),
          title: matter.title,
          status: matter.status,
        }];
      }),
    });
  };

  const openObligationRecords = (
    title: string,
    description: string,
    ids: string[],
  ) => {
    const byId = new Map(
      sources.obligations.map((obligation) => [obligation.id, obligation]),
    );
    setSourceSelection({
      title,
      description,
      records: ids.flatMap((id) => {
        const obligation = byId.get(id);
        if (!obligation) return [];
        return [{
          id,
          href: `/lex/obligations/${id}`,
          eyebrow: obligation.owner_name || id.slice(0, 8),
          title: obligation.title,
          status: obligation.status,
        }];
      }),
    });
  };

  // The dashboard is empty when there are zero contracts to score / value.
  const isEmpty =
    !isLoading && !isError && data != null && data.contractCount === 0;

  return (
    <LexRouteGuard route="/lex/analytics/risk">
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
                disabled={!data}
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

        {/* Consolidated Risk Register — the relationship core spanning every
            legal domain; each record fans out to its obligations + controls.
            Self-contained (own data + states) so it stands independent of the
            contract-value charts below. */}
        <section data-report-section="true">
          <RiskRegisterSection />
        </section>

        {/* Obligations, folded into the Risk Portfolio (moved out of nav). */}
        <section data-report-section="true">
          <ObligationsPanel />
        </section>

        {isError ? (
          <div className="card p-2">
            <LexEmptyState
              icon={AlertTriangle}
              title={labels.risk.empty}
              description={labels.risk.emptyHint}
              action={{ label: labels.page.refresh, onClick: () => refetch() }}
            />
          </div>
        ) : isEmpty ? (
          <div className="card p-2">
            <LexEmptyState
              icon={TrendingDown}
              title={labels.risk.empty}
              description={labels.risk.emptyHint}
              action={{ label: labels.page.refresh, onClick: () => refetch() }}
            />
          </div>
        ) : isLoading ? (
          <LoadingBody />
        ) : data ? (
          <div className="space-y-6" data-report-section="true">
            {/* Feature #18 — risk distribution (gauge + donut + histogram). */}
            <RiskDistributionSection
              distribution={data.distribution}
              labels={labels}
              onOpenContracts={openContractRecords}
            />

            {/* Feature #18 — matter urgency + obligation maturity. */}
            <UrgencyMaturitySection
              urgency={data.urgency}
              maturity={data.maturity}
              labels={labels}
              onOpenMatters={openMatterRecords}
              onOpenObligations={openObligationRecords}
            />

            {/* Feature #19 — value visualizations + renewal cliff. */}
            <ValueVisualsSection
              data={data}
              labels={labels}
              onOpenContracts={openContractRecords}
            />
          </div>
        ) : null}
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
 * Loading body — shimmer cards matching the resolved layout (no layout shift).
 * ------------------------------------------------------------------------- */

function LoadingBody() {
  return (
    <div className="space-y-6" aria-hidden>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <ChartSkeletonCard />
        <ChartSkeletonCard />
        <ChartSkeletonCard />
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ChartSkeletonCard />
        <ChartSkeletonCard />
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <ChartSkeletonCard />
        <ChartSkeletonCard className="xl:col-span-2" />
      </div>
    </div>
  );
}

function ChartSkeletonCard({ className }: { className?: string }) {
  return (
    <div className={`card p-5 ${className ?? ""}`}>
      <div className="mb-4 flex items-center gap-3">
        <div className="h-9 w-9 rounded-xl skeleton-shimmer" />
        <div className="h-5 w-40 rounded-lg skeleton-shimmer" />
      </div>
      <div className="h-[240px] w-full rounded-card skeleton-shimmer" />
    </div>
  );
}
