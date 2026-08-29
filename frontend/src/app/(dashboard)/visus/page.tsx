'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Eye, FileBarChart, Grid3X3, LayoutDashboard, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { KpiCard } from '@/components/shared/kpi-card';
import { StatCard } from '@/components/shared/stat-card';
import { BarChart } from '@/components/shared/charts';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { PageHeader } from '@/components/common/page-header';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { RelativeTime } from '@/components/shared/relative-time';
import { SectionCard } from '@/components/suites/section-card';
import { CTIExecutiveSection } from '@/components/visus/cti/cti-executive-section';
import { enterpriseApi } from '@/lib/enterprise';
import type { VisusDashboard, VisusReport } from '@/types/suites';
import { Badge } from '@/components/ui/badge';
import { pickEnumLabel, useVisusCommonLabels, useVisusEnumLabels, useVisusOverviewLabels } from './_lib/visus-i18n';

export default function VisusPage() {
  const common = useVisusCommonLabels();
  const t = useVisusOverviewLabels();
  const enums = useVisusEnumLabels();

  const dashboardsQuery = useQuery({
    queryKey: ['visus-overview', 'dashboards'],
    queryFn: () => enterpriseApi.visus.listDashboards({ page: 1, per_page: 10, order: 'desc' }),
  });
  const reportsQuery = useQuery({
    queryKey: ['visus-overview', 'reports'],
    queryFn: () => enterpriseApi.visus.listReports({ page: 1, per_page: 10, order: 'desc' }),
  });
  const widgetStatsQuery = useQuery({
    queryKey: ['visus-overview', 'widget-stats'],
    queryFn: () => enterpriseApi.visus.getWidgetStats(),
  });
  const executiveViewQuery = useQuery({
    queryKey: ['visus-overview', 'executive-view'],
    queryFn: () => enterpriseApi.visus.getExecutiveView(),
  });

  if (dashboardsQuery.isLoading && reportsQuery.isLoading && widgetStatsQuery.isLoading && executiveViewQuery.isLoading) {
    return (
      <PermissionRedirect permission="visus:read">
        <div className="space-y-6">
          <PageHeader title={t.loadingTitle} description={t.loadingDescription} />
          <LoadingSkeleton variant="card" count={4} />
        </div>
      </PermissionRedirect>
    );
  }

  if (dashboardsQuery.error && reportsQuery.error && widgetStatsQuery.error && executiveViewQuery.error) {
    return (
      <PermissionRedirect permission="visus:read">
        <ErrorState
          message={t.loadError}
          onRetry={() => {
            void dashboardsQuery.refetch();
            void reportsQuery.refetch();
            void widgetStatsQuery.refetch();
          }}
        />
      </PermissionRedirect>
    );
  }

  const dashboards = dashboardsQuery.data?.data ?? [];
  const reports = reportsQuery.data?.data ?? [];
  const widgetTypeCounts = widgetStatsQuery.data ?? {};
  const totalWidgets = Object.values(widgetTypeCounts).reduce((a, b) => a + b, 0);
  const executiveView = executiveViewQuery.data;

  const widgetMixData = Object.entries(widgetTypeCounts)
    .sort((left, right) => right[1] - left[1])
    .map(([type, count]) => ({ type: pickEnumLabel(enums.widgetType, type), count }));

  return (
    <PermissionRedirect permission="visus:read">
      <div className="space-y-6">
        <PageHeader
          eyebrow={common.eyebrow}
          title={t.title}
          description={t.description}
          tags={[
            { label: t.tagDashboards(dashboardsQuery.data?.meta.total ?? 0), icon: <LayoutDashboard className="h-3.5 w-3.5" aria-hidden />, tone: 'info' },
            { label: t.tagReports(reportsQuery.data?.meta.total ?? 0), icon: <FileBarChart className="h-3.5 w-3.5" aria-hidden />, tone: 'primary' },
            { label: t.tagWidgets(totalWidgets), icon: <Grid3X3 className="h-3.5 w-3.5" aria-hidden />, tone: 'neutral' },
          ]}
          stats={[
            { label: common.dashboards, value: dashboardsQuery.data?.meta.total ?? 0 },
            { label: common.reports, value: reportsQuery.data?.meta.total ?? 0 },
          ]}
          actions={
            <>
              <Button variant="outline" size="sm" asChild>
                <Link href="/visus/dashboards">{t.manageDashboards}</Link>
              </Button>
              <Button size="sm" asChild>
                <Link href="/visus/reports">{t.openReports}</Link>
              </Button>
            </>
          }
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard title={t.kpiDashboards} value={dashboardsQuery.data?.meta.total ?? 0} icon={LayoutDashboard} tone="sky" />
          <KpiCard title={t.kpiReports} value={reportsQuery.data?.meta.total ?? 0} icon={FileBarChart} tone="sky" />
          <KpiCard title={t.kpiWidgets} value={totalWidgets} icon={Grid3X3} tone="sky" />
          <KpiCard title={t.kpiDefaultDashboards} value={dashboards.filter((dashboard) => dashboard.is_default).length} icon={Eye} tone="slate" />
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_1fr]">
          <SectionCard
            title={t.dashboardsTitle}
            description={t.dashboardsDescription}
            actions={
              <Button variant="ghost" size="sm" asChild>
                <Link href="/visus/reports">
                  {common.reports}
                  <ArrowRight className="ms-1 h-3.5 w-3.5 rtl:-scale-x-100" />
                </Link>
              </Button>
            }
          >
            <div className="space-y-3">
              {dashboards.length === 0 ? (
                <EmptyState
                  illustration="chart"
                  size="compact"
                  title={t.dashboardsEmptyTitle}
                  description={t.dashboardsEmptyDescription}
                />
              ) : (
                dashboards.map((dashboard: VisusDashboard) => (
                  <div
                    key={dashboard.id}
                    className="rounded-lg border px-4 py-3 transition-[box-shadow,border-color] duration-200 hover:border-primary/30 hover:shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium">{dashboard.name}</p>
                        <p className="text-xs text-muted-foreground">{dashboard.description || common.noDescription}</p>
                      </div>
                      {dashboard.is_default ? <Badge variant="success">{t.defaultBadge}</Badge> : null}
                    </div>
                    <div className="mt-2 text-xs text-muted-foreground">
                      {t.widgetCount(dashboard.widget_count ?? 0)}
                    </div>
                  </div>
                ))
              )}
            </div>
          </SectionCard>

          <SectionCard title={t.widgetMixTitle} description={t.widgetMixDescription}>
            {widgetMixData.length === 0 ? (
              <EmptyState
                illustration="chart"
                size="compact"
                title={t.widgetMixEmptyTitle}
                description={t.widgetMixEmptyDescription}
              />
            ) : (
              <BarChart
                data={widgetMixData}
                xKey="type"
                yKeys={[{ key: 'count', label: t.widgetMixChartLabel }]}
                layout="horizontal"
                showLegend={false}
                height={Math.max(160, widgetMixData.length * 40)}
                className="capitalize"
              />
            )}
          </SectionCard>
        </div>

        <SectionCard
          title={t.executiveHealthTitle}
          description={t.executiveHealthDescription}
          actions={
            <Button variant="ghost" size="sm" asChild>
              <Link href="/visus/dashboards">
                {t.dashboardStudio}
                <ArrowRight className="ms-1 h-3.5 w-3.5 rtl:-scale-x-100" />
              </Link>
            </Button>
          }
        >
          {executiveView ? (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.1fr_0.9fr]">
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  {t.generatedAt} <RelativeTime date={executiveView.generated_at} />
                </p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {Object.entries(executiveView.suite_health).map(([suite, status]) => (
                    <div
                      key={suite}
                      className="rounded-lg border px-4 py-3 transition-[box-shadow,border-color] duration-200 hover:border-primary/30 hover:shadow-sm"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-medium capitalize">{pickEnumLabel(enums.suite, suite)}</p>
                        <Badge variant={status.available ? 'success' : 'destructive'}>
                          {status.available ? t.available : t.unavailable}
                        </Badge>
                      </div>
                      <div className="mt-2 text-xs text-muted-foreground">
                        <p>{t.latencyMs(status.latency_ms)}</p>
                        <p>{status.last_success ? t.lastSuccess(status.last_success) : t.noSuccessfulSync}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                <StatCard
                  label={t.cachedExecutiveAlerts}
                  value={executiveView.alerts.length}
                  icon={ShieldCheck}
                  tone="rose"
                />
                <StatCard
                  label={t.cachedKpiSnapshots}
                  value={executiveView.kpis.length}
                  icon={FileBarChart}
                  tone="sky"
                />
              </div>
            </div>
          ) : (
            <EmptyState
              illustration="chart"
              size="compact"
              title={t.executiveHealthEmptyTitle}
              description={t.executiveHealthEmptyDescription}
            />
          )}
        </SectionCard>

        <CTIExecutiveSection />

        <SectionCard title={t.recentReportsTitle} description={t.recentReportsDescription}>
          <div className="space-y-3">
            {reports.length === 0 ? (
              <EmptyState
                illustration="inbox"
                size="compact"
                title={t.recentReportsEmptyTitle}
                description={t.recentReportsEmptyDescription}
              />
            ) : (
              reports.map((report: VisusReport) => (
                <div
                  key={report.id}
                  className="rounded-lg border px-4 py-3 transition-[box-shadow,border-color] duration-200 hover:border-primary/30 hover:shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium">{report.name}</p>
                      <p className="text-xs text-muted-foreground">{pickEnumLabel(enums.reportType, report.report_type ?? 'custom')}</p>
                    </div>
                    {report.schedule ? <Badge variant="outline">{report.schedule}</Badge> : null}
                  </div>
                  <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                    <span>{report.last_generated_at ? t.lastOutputAvailable : t.noOutputYet}</span>
                    {report.last_generated_at ? <RelativeTime date={report.last_generated_at} /> : <span>{t.neverGenerated}</span>}
                  </div>
                </div>
              ))
            )}
          </div>
        </SectionCard>
      </div>
    </PermissionRedirect>
  );
}
