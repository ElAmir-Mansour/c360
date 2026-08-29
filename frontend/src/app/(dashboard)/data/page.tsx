'use client';

import Link from 'next/link';
import { ArrowRight, AlertTriangle, CheckCircle2, Database, FileQuestion, GitBranch } from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { ErrorState } from '@/components/common/error-state';
import { EmptyState } from '@/components/common/empty-state';
import { AreaChart } from '@/components/shared/charts/area-chart';
import { BarChart } from '@/components/shared/charts/bar-chart';
import { GaugeChart } from '@/components/shared/charts/gauge-chart';
import { LineChart } from '@/components/shared/charts/line-chart';
import { RelativeTime } from '@/components/shared/relative-time';
import { SimpleTable, type Column } from '@/components/shared/simple-table';
import { SectionCard } from '@/components/suites/section-card';
import { SectionGrid } from '@/components/layout/section-grid';
import { KpiCard } from '@/components/dashboard/kpi-card';
import { Button } from '@/components/ui/button';
import { useRealtimeData } from '@/hooks/use-realtime-data';
import {
  type DataEnvelope,
  type DataSuiteDashboard,
  type PipelineRunSummary,
  type QualityFailureSummary,
} from '@/lib/data-suite';
import { API_ENDPOINTS } from '@/lib/constants';
import {
  buildPipelineTrendSeries,
  buildSourceStatusChartRows,
  formatMaybeDurationMs,
  qualitySeverityVisuals,
} from '@/lib/data-suite/utils';
import { formatCompactNumber, formatDate, formatPercentage } from '@/lib/format';
import { statusVar } from '@/lib/design-tokens';
import { cn } from '@/lib/utils';
import { useDataLabels } from './_lib/data-i18n';

type RunRow = PipelineRunSummary & Record<string, unknown>;
type QualityFailureRow = QualityFailureSummary & Record<string, unknown>;

const KPI_LINKS = {
  total_sources: '/data/sources',
  active_pipelines: '/data/pipelines',
  quality_score: '/data/quality',
  open_contradictions: '/data/contradictions',
  dark_data_assets: '/data/dark-data',
} as const;

/** Shared plot height so every chart on the page resolves to the same vertical rhythm. */
const CHART_HEIGHT = 320;

export default function DataPage() {
  const t = useDataLabels();
  const { data: envelope, isLoading, error, mutate, isValidating } = useRealtimeData<DataEnvelope<DataSuiteDashboard>>(
    API_ENDPOINTS.DATA_DASHBOARD,
    {
      wsTopics: [
        'pipeline.run.completed',
        'pipeline.run.failed',
        'quality.check_failed',
        'contradiction.detected',
      ],
      pollInterval: 60_000,
    },
  );

  const dashboard = envelope?.data;

  // Error gate MUST precede the loading gate: with React Query v5, a failed
  // query has isLoading=false and data=undefined, so `!dashboard` would keep
  // selecting the skeleton forever and the error state would be unreachable.
  // The `&& !dashboard` guard keeps a transient background-poll failure from
  // replacing an already-rendered dashboard with a full-page error.
  if (error && !dashboard) {
    return (
      <PermissionRedirect permission="data:read">
        <ErrorState message={error.message} onRetry={() => void mutate()} />
      </PermissionRedirect>
    );
  }

  if (isLoading || !dashboard) {
    return (
      <PermissionRedirect permission="data:read">
        <div className="space-y-6">
          <PageHeader
            eyebrow={t.page.eyebrow}
            title={t.page.title}
            description={t.page.loadingDescription}
          />
          <LoadingSkeleton variant="kpi" count={5} className="lg:grid-cols-5" />
          <SectionGrid cols={2} gap={4}>
            <LoadingSkeleton variant="chart" />
            <LoadingSkeleton variant="chart" />
          </SectionGrid>
          <SectionGrid cols={2} gap={4}>
            <LoadingSkeleton variant="chart" />
            <LoadingSkeleton variant="chart" />
          </SectionGrid>
          <LoadingSkeleton variant="chart" />
        </div>
      </PermissionRedirect>
    );
  }

  const pipelineSeries = buildPipelineTrendSeries(dashboard);
  const sourceStatusRows = buildSourceStatusChartRows(dashboard);
  const qualityTrendSeries = (dashboard.quality_trend_30d ?? []).map((point) => ({
    day: point.day,
    value: point.value,
  }));

  const runColumns: Column<RunRow>[] = [
    {
      key: 'pipeline_name',
      header: t.recentRuns.colPipeline,
      render: (run) => (
        <Link
          href={`/data/pipelines/${run.pipeline_id}`}
          className="font-medium text-foreground hover:text-primary"
        >
          {run.pipeline_name}
        </Link>
      ),
    },
    {
      key: 'status',
      header: t.recentRuns.colStatus,
      render: (run) => (
        <span
          className={cn(
            'badge-base',
            run.status === 'completed'
              ? 'badge-success'
              : run.status === 'failed'
                ? 'badge-danger'
                : 'badge-info',
          )}
        >
          {run.status}
        </span>
      ),
    },
    {
      key: 'duration_ms',
      header: t.recentRuns.colDuration,
      render: (run) => formatMaybeDurationMs(run.duration_ms),
    },
    {
      key: 'completed_at',
      header: t.recentRuns.colCompleted,
      render: (run) =>
        run.completed_at ? <RelativeTime date={run.completed_at} /> : <RelativeTime date={run.started_at} />,
    },
  ];

  const qualityColumns: Column<QualityFailureRow>[] = [
    {
      key: 'model_name',
      header: t.qualityIssues.colModel,
      render: (item) => (
        <Link
          href={`/data/quality?model=${item.model_id}`}
          className="font-medium text-foreground hover:text-primary"
        >
          {item.model_name}
        </Link>
      ),
    },
    { key: 'rule_name', header: t.qualityIssues.colRule, render: (item) => item.rule_name },
    {
      key: 'severity',
      header: t.qualityIssues.colSeverity,
      render: (item) => {
        const severity = qualitySeverityVisuals[item.severity] ?? qualitySeverityVisuals.low;
        return (
          <span
            className={cn(
              'inline-flex rounded-full border px-2 py-0.5 text-caption font-medium',
              severity.className,
            )}
          >
            {severity.label}
          </span>
        );
      },
    },
    {
      key: 'records_failed',
      header: t.qualityIssues.colFailures,
      align: 'right',
      render: (item) => formatCompactNumber(item.records_failed),
    },
  ];

  return (
    <PermissionRedirect permission="data:read">
      <div className="space-y-6">
        <PageHeader
          eyebrow={t.page.eyebrow}
          title={t.page.title}
          description={t.page.description}
          tags={[
            {
              label: t.page.sourcesTag(dashboard.kpis.total_sources.toLocaleString()),
              icon: <Database className="h-3.5 w-3.5" aria-hidden />,
              tone: 'primary',
            },
            {
              label: t.page.activePipelinesTag(dashboard.kpis.active_pipelines.toLocaleString()),
              icon: <GitBranch className="h-3.5 w-3.5" aria-hidden />,
              tone: 'info',
            },
            {
              label: t.page.qualityGradeTag(dashboard.kpis.quality_grade),
              icon: <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />,
              tone: dashboard.kpis.quality_score >= 90 ? 'success' : dashboard.kpis.quality_score >= 70 ? 'warning' : 'danger',
            },
            ...(dashboard.kpis.open_contradictions > 0
              ? [
                  {
                    label: t.page.openContradictionsTag(dashboard.kpis.open_contradictions.toLocaleString()),
                    icon: <AlertTriangle className="h-3.5 w-3.5" aria-hidden />,
                    tone: 'danger' as const,
                  },
                ]
              : []),
          ]}
          stats={[
            { label: t.page.statQuality, value: dashboard.kpis.quality_score.toFixed(1) },
            {
              label: t.page.stat30dSuccess,
              value: formatPercentage(dashboard.pipeline_success_rate_30d / 100, 0),
            },
          ]}
          actions={
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" asChild>
                <Link href="/data/sources">{t.page.manageSources}</Link>
              </Button>
              <Button size="sm" asChild>
                <Link href="/data/pipelines">{t.page.openPipelines}</Link>
              </Button>
            </div>
          }
        />

        <SectionGrid cols={4} gap={4} className="xl:grid-cols-5">
          <KpiCard
            index={0}
            href={KPI_LINKS.total_sources}
            tone="sky"
            title={t.kpis.totalSources}
            value={dashboard.kpis.total_sources.toLocaleString()}
            icon={Database}
            trend={{
              value: dashboard.kpis.sources_delta,
              label: t.kpis.sinceLastPeriod,
              direction: dashboard.kpis.sources_delta > 0 ? 'up' : dashboard.kpis.sources_delta < 0 ? 'down' : 'neutral',
              sentiment: dashboard.kpis.sources_delta >= 0 ? 'good' : 'bad',
            }}
          />
          <KpiCard
            index={1}
            href={KPI_LINKS.active_pipelines}
            tone="sky"
            title={t.kpis.activePipelines}
            value={dashboard.kpis.active_pipelines.toLocaleString()}
            icon={GitBranch}
            trend={{
              value: dashboard.kpis.failed_pipelines_24h,
              label: t.kpis.failedIn24h,
              direction: dashboard.kpis.failed_pipelines_24h > 0 ? 'up' : 'neutral',
              sentiment: dashboard.kpis.failed_pipelines_24h > 0 ? 'bad' : 'good',
            }}
          />
          <KpiCard
            index={2}
            href={KPI_LINKS.quality_score}
            tone={dashboard.kpis.quality_score >= 90 ? 'emerald' : dashboard.kpis.quality_score >= 70 ? 'gold' : 'rose'}
            title={t.kpis.qualityScore}
            value={dashboard.kpis.quality_score.toFixed(1)}
            unit={t.kpis.perGrade(dashboard.kpis.quality_grade)}
            icon={CheckCircle2}
          >
            <GaugeChart
              value={dashboard.kpis.quality_score}
              size={56}
              showValue={false}
              thresholds={{ good: 90, warning: 70 }}
            />
          </KpiCard>
          <KpiCard
            index={3}
            href={KPI_LINKS.open_contradictions}
            tone={dashboard.kpis.open_contradictions > 0 ? 'rose' : 'slate'}
            title={t.kpis.openContradictions}
            value={dashboard.kpis.open_contradictions.toLocaleString()}
            icon={AlertTriangle}
            trend={{
              value: dashboard.kpis.contradictions_delta,
              label: t.kpis.trend,
              direction: dashboard.kpis.contradictions_delta > 0 ? 'up' : dashboard.kpis.contradictions_delta < 0 ? 'down' : 'neutral',
              sentiment: dashboard.kpis.contradictions_delta > 0 ? 'bad' : 'good',
            }}
          />
          <KpiCard
            index={4}
            href={KPI_LINKS.dark_data_assets}
            tone="sky"
            title={t.kpis.darkDataAssets}
            value={dashboard.kpis.dark_data_assets.toLocaleString()}
            unit={t.kpis.tracked(Number(dashboard.dark_data_stats.total_assets ?? 0).toLocaleString())}
            icon={FileQuestion}
          />
        </SectionGrid>

        <SectionGrid cols={2} gap={4}>
          <SectionCard
            title={t.charts.pipelineSuccessTitle}
            description={t.charts.pipelineSuccessDescription}
            actions={
              <span className="text-caption text-muted-foreground">
                {t.charts.successRate(formatPercentage(dashboard.pipeline_success_rate_30d / 100, 1))}
              </span>
            }
            isEmpty={pipelineSeries.length === 0}
            emptyState={
              <EmptyState
                icon={GitBranch}
                size="compact"
                title={t.charts.pipelineEmptyTitle}
                description={t.charts.pipelineEmptyDescription}
                action={{ label: t.page.openPipelines, href: '/data/pipelines' }}
              />
            }
          >
            <AreaChart
              data={pipelineSeries}
              xKey="day"
              height={CHART_HEIGHT}
              stacked
              yKeys={[
                { key: 'success', label: t.charts.successSeries, color: statusVar('success') },
                { key: 'failed', label: t.charts.failedSeries, color: statusVar('error') },
                { key: 'cancelled', label: t.charts.cancelledSeries, color: statusVar('neutral') },
              ]}
              xFormatter={(value) => formatDate(`${value}`, 'MMM d')}
            />
          </SectionCard>

          <SectionCard
            title={t.charts.qualityTrendTitle}
            description={t.charts.qualityTrendDescription}
            isEmpty={qualityTrendSeries.length === 0}
            emptyState={
              <EmptyState
                icon={CheckCircle2}
                size="compact"
                title={t.charts.qualityEmptyTitle}
                description={t.charts.qualityEmptyDescription}
                action={{ label: t.qualityIssues.openQuality, href: '/data/quality' }}
              />
            }
          >
            <LineChart
              data={qualityTrendSeries}
              xKey="day"
              height={CHART_HEIGHT}
              yKeys={[{ key: 'value', label: t.charts.qualityScoreSeries, color: 'hsl(var(--chart-2))' }]}
              xFormatter={(value) => formatDate(`${value}`, 'MMM d')}
            />
          </SectionCard>
        </SectionGrid>

        <SectionGrid cols={2} gap={4}>
          <SectionCard
            title={t.recentRuns.title}
            description={t.recentRuns.description}
            actions={
              <Button variant="ghost" size="sm" asChild>
                <Link href="/data/pipelines">
                  {t.recentRuns.viewAll}
                  <ArrowRight className="ms-1 h-3.5 w-3.5 rtl:-scale-x-100" />
                </Link>
              </Button>
            }
            isEmpty={dashboard.recent_runs.length === 0}
            emptyState={
              <EmptyState
                icon={GitBranch}
                size="compact"
                title={t.recentRuns.emptyTitle}
                description={t.recentRuns.emptyDescription}
                action={{ label: t.page.openPipelines, href: '/data/pipelines' }}
              />
            }
          >
            <SimpleTable<RunRow>
              ariaLabel={t.recentRuns.title}
              data={(dashboard.recent_runs ?? []) as RunRow[]}
              getRowKey={(run) => run.id}
              columns={runColumns}
            />
          </SectionCard>

          <SectionCard
            title={t.qualityIssues.title}
            description={t.qualityIssues.description}
            actions={
              <Button variant="ghost" size="sm" asChild>
                <Link href="/data/quality">
                  {t.qualityIssues.openQuality}
                  <ArrowRight className="ms-1 h-3.5 w-3.5 rtl:-scale-x-100" />
                </Link>
              </Button>
            }
            isEmpty={dashboard.top_quality_failures.length === 0}
            emptyState={
              <EmptyState
                icon={CheckCircle2}
                size="compact"
                title={t.qualityIssues.emptyTitle}
                description={t.qualityIssues.emptyDescription}
                action={{ label: t.qualityIssues.openQuality, href: '/data/quality' }}
              />
            }
          >
            <SimpleTable<QualityFailureRow>
              ariaLabel={t.qualityIssues.title}
              data={(dashboard.top_quality_failures ?? []) as QualityFailureRow[]}
              getRowKey={(item) => item.rule_id}
              columns={qualityColumns}
            />
          </SectionCard>
        </SectionGrid>

        <SectionCard
          title={t.charts.sourcesByStatusTitle}
          description={t.charts.sourcesByStatusDescription}
          actions={
            <span className="text-caption text-muted-foreground">
              {isValidating ? t.charts.refreshing : t.charts.liveEvery60s}
            </span>
          }
        >
          <BarChart
            data={sourceStatusRows}
            xKey="type"
            layout="horizontal"
            stacked
            height={360}
            emptyMessage={t.charts.noSourceStatusData}
            yKeys={[
              { key: 'active', label: t.charts.statusActive, color: statusVar('success') },
              { key: 'inactive', label: t.charts.statusInactive, color: statusVar('neutral') },
              { key: 'error', label: t.charts.statusError, color: statusVar('error') },
              { key: 'syncing', label: t.charts.statusSyncing, color: statusVar('info') },
            ]}
          />
        </SectionCard>
      </div>
    </PermissionRedirect>
  );
}
