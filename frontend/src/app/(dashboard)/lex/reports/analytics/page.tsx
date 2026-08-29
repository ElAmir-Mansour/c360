"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, RotateCcw } from "lucide-react";
import { ErrorState } from "@/components/common/error-state";
import { LexRouteGuard } from "../../_guards/lex-route-guard";
import { LineChart } from "@/components/shared/charts/line-chart";
import { PieChart } from "@/components/shared/charts/pie-chart";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { useLocale } from "@/components/providers/locale-provider";
import { useLexFormat, type LexFormatter } from "@/lib/lex/ksa";
import { downloadBlob } from "@/lib/format";
import { showApiError } from "@/lib/toast";
import { cn } from "@/lib/utils";
import {
  lexReportsApi,
  type LexDetailedAnalyticsDashboard,
  type LexLegalAdvisorPerformance,
  type LexReportQuery,
} from "@/lib/lex/reports";
import { useServiceTypeLabel } from "../../service-desk/_components/lex-enums-i18n";
import {
  PrintableReport,
  ReportExportMenu,
  ReportPeriodControl,
} from "@/components/lex/reports";
import {
  type DetailedAnalyticsLabels,
  useDetailedAnalyticsLabels,
} from "./_lib/detailed-analytics-labels";
import {
  advisorWorkloadPercent,
  buildDepartmentFilterOptions,
  buildServiceDistribution,
  departmentDisplayLabel,
  formatAnalyticsMonth,
} from "./_lib/detailed-analytics-view-model";
import {
  AnalyticsDrilldownSheet,
  type AnalyticsDrilldownSelection,
} from "./_components/analytics-drilldown-sheet";
import { AnalyticsMetricCard } from "./_components/analytics-metric-card";
import { SHOW_SATISFACTION_METRIC } from "./_lib/report-feature-flags";

const ALL = "__all__";
const flatCardClass = "rounded-2xl border border-border/80 bg-card shadow-none";

function isoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseIsoDate(value: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function currentYearWindow(): { from: string; to: string } {
  const today = new Date();
  return {
    from: `${today.getFullYear()}-01-01`,
    to: isoDate(today),
  };
}

function monthStartAt(start: string, offset: number): string {
  const [year, month] = start.slice(0, 10).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + offset, 1));
  return date.toISOString().slice(0, 10);
}

export default function LexDetailedAnalyticsPage() {
  const router = useRouter();
  const pathname = usePathname() ?? "/lex/reports/analytics";
  const searchParams = useSearchParams();
  const signature = searchParams?.toString() ?? "";
  const { locale, direction } = useLocale();
  const f = useLexFormat();
  const labels = useDetailedAnalyticsLabels();
  const serviceTypeLabel = useServiceTypeLabel();
  const defaults = useMemo(currentYearWindow, []);
  const [drilldown, setDrilldown] =
    useState<AnalyticsDrilldownSelection | null>(null);
  const [exporting, setExporting] = useState<"csv" | "xlsx" | null>(null);

  const from = searchParams?.get("from") || defaults.from;
  const to = searchParams?.get("to") || defaults.to;
  const department = searchParams?.get("department") ?? "";
  const priority = searchParams?.get("priority") ?? "";
  const type = searchParams?.get("type") ?? "";
  const compare = searchParams?.get("compare") !== "false";

  const updateParams = useCallback(
    (updates: Record<string, string | boolean | undefined>) => {
      const next = new URLSearchParams(signature);
      for (const [key, value] of Object.entries(updates)) {
        if (value === undefined || value === "") next.delete(key);
        else next.set(key, String(value));
      }
      router.replace(next.size ? `${pathname}?${next.toString()}` : pathname, {
        scroll: false,
      });
    },
    [pathname, router, signature],
  );

  const query = useMemo<LexReportQuery>(
    () => ({
      from,
      to,
      department: department || undefined,
      priority: priority || undefined,
      type: type || undefined,
      compare,
    }),
    [compare, department, from, priority, to, type],
  );

  const analyticsQuery = useQuery({
    queryKey: ["lex-detailed-analytics", query],
    queryFn: () => lexReportsApi.getDetailedAnalytics(query),
  });

  const dateRange = useMemo(
    () => ({ from: parseIsoDate(from), to: parseIsoDate(to) }),
    [from, to],
  );

  const exportAnalytics = useCallback(
    async (kind: "csv" | "xlsx") => {
      try {
        setExporting(kind);
        const blob =
          kind === "csv"
            ? await lexReportsApi.exportDetailedAnalyticsCsv(query)
            : await lexReportsApi.exportDetailedAnalyticsXlsx(query);
        downloadBlob(
          blob,
          `lex-detailed-analytics-${from}-${to}.${kind}`,
        );
      } catch (error) {
        showApiError(error);
      } finally {
        setExporting(null);
      }
    },
    [from, query, to],
  );

  return (
    <LexRouteGuard route="/lex/reports/analytics">
      <div
        className="space-y-6 motion-safe:animate-fade-up"
        dir={direction}
        lang={locale}
        data-testid="detailed-analytics-page"
      >
        <AnalyticsHeader
          labels={labels}
          compare={compare}
          dateRange={dateRange}
          onCompareChange={(checked) =>
            updateParams({ compare: checked ? undefined : false })
          }
          onDateChange={(range) =>
            updateParams({
              from: range.from ? isoDate(range.from) : undefined,
              to: range.to ? isoDate(range.to) : undefined,
            })
          }
          exporting={exporting}
          onExportCsv={() => exportAnalytics("csv")}
          onExportXlsx={() => exportAnalytics("xlsx")}
        />

        <AnalyticsFilters
          data={analyticsQuery.data}
          labels={labels}
          priority={priority}
          type={type}
          department={department}
          serviceTypeLabel={serviceTypeLabel}
          updateParams={updateParams}
          onReset={() => router.replace(pathname, { scroll: false })}
        />

        {analyticsQuery.isLoading ? (
          <div
            role="status"
            aria-live="polite"
            aria-label={labels.actions.loading}
          >
            <Skeleton.Table rows={8} cols={4} />
            <span className="sr-only">{labels.actions.loading}</span>
          </div>
        ) : analyticsQuery.isError || !analyticsQuery.data ? (
          <ErrorState
            message={labels.actions.loadError}
            error={analyticsQuery.error}
            onRetry={() => void analyticsQuery.refetch()}
          />
        ) : (
          <PrintableReport
            title={labels.title}
            period={{ from, to }}
            className="lex-detailed-printable"
          >
            <DashboardBody
              data={analyticsQuery.data}
              labels={labels}
              f={f}
              locale={locale}
              direction={direction}
              compare={compare}
              serviceTypeLabel={serviceTypeLabel}
              refreshing={analyticsQuery.isFetching}
              onDrilldown={setDrilldown}
            />
          </PrintableReport>
        )}

        <AnalyticsDrilldownSheet
          selection={drilldown}
          query={query}
          open={drilldown !== null}
          onOpenChange={(open) => {
            if (!open) setDrilldown(null);
          }}
        />
      </div>
    </LexRouteGuard>
  );
}

function AnalyticsHeader({
  labels,
  compare,
  dateRange,
  onCompareChange,
  onDateChange,
  exporting,
  onExportCsv,
  onExportXlsx,
}: {
  labels: DetailedAnalyticsLabels;
  compare: boolean;
  dateRange: { from: Date | undefined; to: Date | undefined };
  onCompareChange: (checked: boolean) => void;
  onDateChange: (range: {
    from: Date | undefined;
    to: Date | undefined;
  }) => void;
  exporting: "csv" | "xlsx" | null;
  onExportCsv: () => void | Promise<void>;
  onExportXlsx: () => void | Promise<void>;
}) {
  return (
    <header className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
      <div className="min-w-0">
        <nav
          className="mb-1.5 flex flex-wrap items-center gap-2 text-sm text-muted-foreground"
          aria-label="Breadcrumb"
        >
          <Link href="/lex" className="transition-colors hover:text-foreground">
            {labels.breadcrumb.suite}
          </Link>
          <ChevronRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden />
          <Link
            href="/lex/reports"
            className="transition-colors hover:text-foreground"
          >
            {labels.breadcrumb.reports}
          </Link>
          <ChevronRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden />
          <span className="font-semibold text-foreground">{labels.title}</span>
        </nav>
        <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-[28px] sm:leading-9">
          {labels.title}
        </h1>
      </div>

      <div className="lex-detailed-no-print flex flex-col gap-2 sm:flex-row sm:items-center">
        <ReportPeriodControl
          value={dateRange}
          onChange={onDateChange}
        />
        <ReportExportMenu
          onCsv={onExportCsv}
          onXlsx={onExportXlsx}
          exporting={exporting}
        />
        <div className="flex h-9 items-center gap-2 rounded-lg border border-border/80 bg-card px-3">
          <Switch
            id="analytics-compare"
            checked={compare}
            onCheckedChange={onCompareChange}
            aria-label={labels.filters.compare}
          />
          <Label
            htmlFor="analytics-compare"
            className="cursor-pointer whitespace-nowrap text-xs font-normal"
          >
            {labels.filters.compare}
          </Label>
        </div>
      </div>
    </header>
  );
}

function AnalyticsFilters({
  data,
  labels,
  priority,
  type,
  department,
  serviceTypeLabel,
  updateParams,
  onReset,
}: {
  data?: LexDetailedAnalyticsDashboard;
  labels: DetailedAnalyticsLabels;
  priority: string;
  type: string;
  department: string;
  serviceTypeLabel: (value: string) => string;
  updateParams: (updates: Record<string, string | boolean | undefined>) => void;
  onReset: () => void;
}) {
  const options = data?.filter_options;
  return (
    <section
      className={cn(
        flatCardClass,
        "lex-detailed-no-print flex flex-col justify-between gap-3 p-4 lg:flex-row lg:items-center",
      )}
      aria-label={labels.filters.filterBy}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <span className="text-sm font-semibold text-foreground">
          {labels.filters.filterBy}
        </span>
        <FilterSelect
          id="analytics-department"
          label={labels.filters.department}
          value={department}
          allLabel={labels.filters.all}
          options={buildDepartmentFilterOptions(
            options?.departments ?? [],
            data?.by_department ?? [],
            labels.drilldown.unspecified,
          )}
          onChange={(value) => updateParams({ department: value || undefined })}
        />
        <FilterSelect
          id="analytics-service"
          label={labels.filters.serviceType}
          value={type}
          allLabel={labels.filters.all}
          options={(options?.service_types ?? []).map((value) => ({
            value,
            label: serviceTypeLabel(value),
          }))}
          onChange={(value) => updateParams({ type: value || undefined })}
        />
        <FilterSelect
          id="analytics-priority"
          label={labels.filters.priority}
          value={priority}
          allLabel={labels.filters.all}
          options={(options?.priorities ?? ["urgent", "normal"]).map(
            (value) => ({
              value,
              label: labels.priority[value] ?? value,
            }),
          )}
          onChange={(value) => updateParams({ priority: value || undefined })}
        />
      </div>

      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="self-start text-muted-foreground lg:self-auto"
        onClick={onReset}
      >
        <RotateCcw className="me-1.5 h-3.5 w-3.5" aria-hidden />
        {labels.filters.reset}
      </Button>
    </section>
  );
}

function FilterSelect({
  id,
  label,
  value,
  allLabel,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  allLabel: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <Select
      value={value || ALL}
      onValueChange={(next) => onChange(next === ALL ? "" : next)}
    >
      <SelectTrigger
        id={id}
        aria-label={label}
        className="h-8 w-full gap-1.5 rounded-lg bg-card px-3 text-xs shadow-none sm:w-auto sm:min-w-36"
      >
        <span className="text-muted-foreground">{label}:</span>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{allLabel}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function DashboardBody({
  data,
  labels,
  f,
  locale,
  direction,
  compare,
  serviceTypeLabel,
  refreshing,
  onDrilldown,
}: {
  data: LexDetailedAnalyticsDashboard;
  labels: DetailedAnalyticsLabels;
  f: LexFormatter;
  locale: string;
  direction: "ltr" | "rtl";
  compare: boolean;
  serviceTypeLabel: (value: string) => string;
  refreshing: boolean;
  onDrilldown: (selection: AnalyticsDrilldownSelection) => void;
}) {
  const trendData = data.monthly_trend.map((point, index) => ({
    month: formatAnalyticsMonth(point.period_start, locale, "short"),
    periodStart: point.period_start.slice(0, 10),
    previousPeriodStart: data.previous_period
      ? monthStartAt(data.previous_period.from, index)
      : undefined,
    current: point.count,
    previous: point.previous_count,
  }));
  const sparklineTrend = data.monthly_trend.map((point) => ({
    label: point.period_start,
    value: point.count,
  }));
  const serviceDistribution = buildServiceDistribution(
    data.by_service_type,
    serviceTypeLabel,
    labels.charts.other,
  );

  return (
    <div className="space-y-6">
      <div className="sr-only" aria-live="polite">
        {labels.generated(
          f.formatDate(data.generated_at, {
            dateStyle: "medium",
            timeStyle: "short",
          }),
        )}
        {refreshing ? ` ${labels.actions.loading}` : ""}
      </div>

      <div
        className={cn(
          "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3",
          SHOW_SATISFACTION_METRIC ? "xl:grid-cols-6" : "xl:grid-cols-5",
        )}
        dir="ltr"
      >
        <AnalyticsMetricCard
          direction={direction}
          label={labels.metrics.total}
          metric={data.summary.total_requests}
          format={(value) => f.formatNumber(Math.round(value))}
          deltaKind="percent"
          labels={labels}
          f={f}
          sparkline={sparklineTrend}
          onAction={() =>
            onDrilldown({
              dimension: "metric",
              key: "total_requests",
              title: labels.metrics.total,
              description: labels.metrics.requestsSample(
                f.formatNumber(data.summary.total_requests.sample_size),
              ),
            })
          }
        />
        <AnalyticsMetricCard
          direction={direction}
          label={labels.metrics.completion}
          metric={data.summary.completion_rate}
          format={(value) => `${f.formatNumber(Number(value.toFixed(1)))}%`}
          deltaKind="points"
          labels={labels}
          f={f}
          onAction={() =>
            onDrilldown({
              dimension: "metric",
              key: "completion_rate",
              title: labels.metrics.completion,
              description: labels.metrics.completedSample(
                f.formatNumber(data.summary.completion_rate.sample_size),
              ),
            })
          }
        />
        <AnalyticsMetricCard
          direction={direction}
          label={labels.metrics.processing}
          metric={data.summary.avg_processing_hours}
          format={(value) =>
            `${f.formatNumber(Number(value.toFixed(1)))} ${labels.metrics.hours}`
          }
          deltaKind="hours"
          invert
          labels={labels}
          f={f}
          onAction={() =>
            onDrilldown({
              dimension: "metric",
              key: "avg_processing_hours",
              title: labels.metrics.processing,
              description: labels.metrics.processingSample(
                f.formatNumber(data.summary.avg_processing_hours.sample_size),
              ),
            })
          }
        />
        {SHOW_SATISFACTION_METRIC ? (
          <AnalyticsMetricCard
            direction={direction}
            label={labels.metrics.satisfaction}
            metric={data.summary.satisfaction_score}
            format={(value) => `${f.formatNumber(Number(value.toFixed(1)))}/5`}
            deltaKind="rating"
            labels={labels}
            f={f}
            onAction={() =>
              onDrilldown({
                dimension: "metric",
                key: "satisfaction_score",
                title: labels.metrics.satisfaction,
                description: labels.metrics.feedbackSample(
                  f.formatNumber(data.summary.satisfaction_score.sample_size),
                ),
              })
            }
          />
        ) : null}
        <AnalyticsMetricCard
          direction={direction}
          label={labels.metrics.sla}
          metric={data.summary.sla_compliance}
          format={(value) => `${f.formatNumber(Number(value.toFixed(1)))}%`}
          deltaKind="points"
          labels={labels}
          f={f}
          onAction={() =>
            onDrilldown({
              dimension: "metric",
              key: "sla_compliance",
              title: labels.metrics.sla,
              description: labels.metrics.slaSample(
                f.formatNumber(data.summary.sla_compliance.sample_size),
              ),
            })
          }
        />
        <AnalyticsMetricCard
          direction={direction}
          label={labels.metrics.pending}
          metric={data.summary.pending_requests}
          format={(value) => f.formatNumber(Math.round(value))}
          deltaKind="percent"
          invert
          labels={labels}
          f={f}
          danger
          onAction={() =>
            onDrilldown({
              dimension: "metric",
              key: "pending_requests",
              title: labels.metrics.pending,
              description: labels.metrics.pendingSample,
            })
          }
        />
      </div>

      <div
        className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.65fr)_minmax(340px,1fr)]"
        dir="ltr"
        data-report-section="true"
      >
        <AnalyticsCard title={labels.charts.trend} direction={direction}>
          <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
            <span className="h-2 w-2 rounded-full bg-action" aria-hidden />
            {labels.charts.current}
          </div>
          <LineChart
            data={trendData}
            xKey="month"
            yKeys={[
              {
                key: "current",
                label: labels.charts.current,
                color: "rgb(var(--ds-action-primary))",
              },
              ...(compare
                ? [
                    {
                      key: "previous",
                      label: labels.charts.previous,
                      color: "hsl(var(--muted-foreground))",
                      dashed: true,
                    },
                  ]
                : []),
            ]}
            yFormatter={(value) => f.formatNumber(value)}
            onItemSelect={(datum, seriesKey) => {
              const isPrevious = seriesKey === "previous";
              const periodStart = String(
                datum[isPrevious ? "previousPeriodStart" : "periodStart"] ??
                  "",
              );
              if (!periodStart) return;
              const monthLabel = formatAnalyticsMonth(
                periodStart,
                locale,
                "long",
              );
              onDrilldown({
                dimension: "month",
                key: periodStart,
                title: isPrevious
                  ? `${monthLabel} · ${labels.charts.previous}`
                  : monthLabel,
                description: labels.metrics.requestsSample(
                  f.formatNumber(Number(datum[seriesKey] ?? 0)),
                ),
                queryOverrides:
                  isPrevious && data.previous_period
                    ? {
                        from: data.previous_period.from.slice(0, 10),
                        to: data.previous_period.to.slice(0, 10),
                      }
                    : undefined,
              });
            }}
            height={220}
            showLegend={false}
            empty={data.summary.total_requests.value === 0}
            emptyMessage={labels.charts.noRequests}
          />
          {data.monthly_trend.length > 0 ? (
            <div className="mt-3 grid grid-cols-2 gap-2 border-t pt-3 sm:grid-cols-3 lg:grid-cols-4">
              {data.monthly_trend.map((point) => {
                const monthLabel = formatAnalyticsMonth(
                  point.period_start,
                  locale,
                  "long",
                );
                return (
                  <Button
                    key={point.period_start}
                    data-testid="analytics-month-drilldown"
                    type="button"
                    variant="outline"
                    onClick={() =>
                      onDrilldown({
                        dimension: "month",
                        key: point.period_start.slice(0, 10),
                        title: monthLabel,
                        description: labels.metrics.requestsSample(
                          f.formatNumber(point.count),
                        ),
                      })
                    }
                    aria-label={labels.drilldown.viewContributors(monthLabel)}
                    className="h-auto flex-col items-start justify-start gap-0.5 rounded-lg border-border/70 px-3 py-2 text-start font-normal hover:border-primary/30 hover:bg-primary/5"
                  >
                    <span className="block truncate text-xs text-muted-foreground">
                      {monthLabel}
                    </span>
                    <span className="mt-0.5 block font-semibold tabular-nums text-foreground">
                      {f.formatNumber(point.count)}
                    </span>
                  </Button>
                );
              })}
            </div>
          ) : null}
        </AnalyticsCard>

        <AnalyticsCard title={labels.charts.department} direction={direction}>
          <DepartmentDistribution
            items={data.by_department.slice(0, 6)}
            labels={labels}
            f={f}
            onSelect={(item) =>
              onDrilldown({
                dimension: "department",
                key: item.key,
                title: departmentDisplayLabel(
                  item.key,
                  labels.drilldown.unspecified,
                ),
                description: labels.metrics.requestsSample(
                  f.formatNumber(item.count),
                ),
              })
            }
          />
        </AnalyticsCard>
      </div>

      <div
        className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(360px,1fr)]"
        dir="ltr"
        data-report-section="true"
      >
        <AdvisorPerformance
          advisors={data.advisor_performance}
          labels={labels}
          f={f}
          direction={direction}
          onSelect={(advisor) =>
            onDrilldown({
              dimension: "advisor",
              key: advisor.advisor_id ?? advisor.advisor_name,
              title: advisor.advisor_name,
              description: labels.metrics.requestsSample(
                f.formatNumber(advisor.total_requests),
              ),
            })
          }
        />
        <AnalyticsCard title={labels.charts.services} direction={direction}>
          <PieChart
            data={serviceDistribution.items}
            innerRadius={54}
            outerRadius={76}
            height={225}
            centerValue={f.formatNumber(serviceDistribution.total)}
            centerLabel={labels.charts.requests}
            empty={serviceDistribution.items.length === 0}
            emptyMessage={labels.charts.noServices}
            legend={{ className: "text-xs" }}
            onItemSelect={(name) => {
              const item = serviceDistribution.items.find(
                (candidate) => candidate.name === name,
              );
              if (!item) return;
              onDrilldown({
                dimension: "service_type",
                keys: item.keys,
                title: item.name,
                description: labels.metrics.requestsSample(
                  f.formatNumber(item.value),
                ),
              });
            }}
          />
        </AnalyticsCard>
      </div>
    </div>
  );
}

function AnalyticsCard({
  title,
  direction,
  children,
}: {
  title: string;
  direction: "ltr" | "rtl";
  children: ReactNode;
}) {
  return (
    <section
      className={cn(flatCardClass, "min-w-0 p-5 sm:p-6")}
      dir={direction}
    >
      <h2 className="mb-4 text-base font-semibold text-foreground">{title}</h2>
      {children}
    </section>
  );
}

function DepartmentDistribution({
  items,
  labels,
  f,
  onSelect,
}: {
  items: LexDetailedAnalyticsDashboard["by_department"];
  labels: DetailedAnalyticsLabels;
  f: LexFormatter;
  onSelect: (
    item: LexDetailedAnalyticsDashboard["by_department"][number],
  ) => void;
}) {
  const max = Math.max(1, ...items.map((item) => item.count));

  if (items.length === 0) {
    return (
      <div className="flex min-h-[220px] items-center justify-center text-sm text-muted-foreground">
        {labels.charts.noDepartments}
      </div>
    );
  }

  return (
    <div className="space-y-3.5">
      {items.map((item) => (
        <DepartmentDistributionRow
          key={item.key}
          item={item}
          max={max}
          label={departmentDisplayLabel(
            item.key,
            labels.drilldown.unspecified,
          )}
          labels={labels}
          f={f}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

function DepartmentDistributionRow({
  item,
  max,
  label,
  labels,
  f,
  onSelect,
}: {
  item: LexDetailedAnalyticsDashboard["by_department"][number];
  max: number;
  label: string;
  labels: DetailedAnalyticsLabels;
  f: LexFormatter;
  onSelect: (
    item: LexDetailedAnalyticsDashboard["by_department"][number],
  ) => void;
}) {
  return (
    <Button
      type="button"
      data-testid="analytics-department-drilldown"
      variant="ghost"
      onClick={() => onSelect(item)}
      aria-label={labels.drilldown.viewContributors(label)}
      className="grid h-auto w-full grid-cols-[minmax(90px,.7fr)_minmax(120px,1.8fr)_auto] items-center gap-3 rounded-lg p-1 text-start text-xs font-normal hover:bg-primary/5"
    >
      <span className="truncate font-medium text-foreground" dir="auto">
        {label}
      </span>
      <div className="h-4 overflow-hidden rounded bg-muted">
        <div
          className="h-full rounded bg-action transition-[width] duration-slow motion-reduce:transition-none"
          style={{ width: `${(item.count / max) * 100}%` }}
        />
      </div>
      <span className="w-8 text-end font-bold tabular-nums text-foreground">
        {f.formatNumber(item.count)}
      </span>
    </Button>
  );
}

function AdvisorPerformance({
  advisors,
  labels,
  f,
  direction,
  onSelect,
}: {
  advisors: LexLegalAdvisorPerformance[];
  labels: DetailedAnalyticsLabels;
  f: LexFormatter;
  direction: "ltr" | "rtl";
  onSelect: (advisor: LexLegalAdvisorPerformance) => void;
}) {
  const maxCompleted = Math.max(
    1,
    ...advisors.map((advisor) => advisor.completed_requests),
  );

  return (
    <AnalyticsCard title={labels.charts.advisors} direction={direction}>
      {advisors.length === 0 ? (
        <div className="flex min-h-[220px] items-center justify-center text-sm text-muted-foreground">
          {labels.charts.noAdvisors}
        </div>
      ) : (
        <div className="space-y-4">
          {advisors.slice(0, 5).map((advisor) => {
            const workload = advisorWorkloadPercent(advisor);
            return (
              <Button
                type="button"
                data-testid="analytics-advisor-drilldown"
                variant="ghost"
                key={`${advisor.advisor_id ?? "legacy"}-${advisor.advisor_name}`}
                onClick={() => onSelect(advisor)}
                aria-label={labels.drilldown.viewContributors(
                  advisor.advisor_name,
                )}
                className="grid h-auto w-full grid-cols-[minmax(125px,.8fr)_minmax(140px,1.8fr)_auto_minmax(78px,.65fr)] items-center gap-4 rounded-lg p-1 text-start text-xs font-normal hover:bg-primary/5"
              >
                <p
                  className="truncate font-semibold text-foreground"
                  dir="auto"
                >
                  {advisor.advisor_name}
                </p>
                <div className="h-2.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-action transition-[width] duration-slow motion-reduce:transition-none"
                    style={{
                      width: `${(advisor.completed_requests / maxCompleted) * 100}%`,
                    }}
                  />
                </div>
                <span className="whitespace-nowrap font-bold text-warning-600">
                  ★{" "}
                  {advisor.average_rating != null
                    ? `${f.formatNumber(Number(advisor.average_rating.toFixed(1)))}/5`
                    : labels.charts.noRating}
                </span>
                <span className="text-muted-foreground">
                  {labels.charts.workload}:{" "}
                  {f.formatNumber(Number(workload.toFixed(0)))}%
                </span>
              </Button>
            );
          })}
        </div>
      )}
    </AnalyticsCard>
  );
}
