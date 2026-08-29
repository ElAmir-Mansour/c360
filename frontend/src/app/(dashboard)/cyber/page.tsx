'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw, Settings, ShieldCheck, Activity, Radar, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/common/page-header';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { SectionCard } from '@/components/suites/section-card';
import { SectionGrid } from '@/components/layout/section-grid';
import { useRealtimeData } from '@/hooks/use-realtime-data';
import { API_ENDPOINTS } from '@/lib/constants';
import type { SOCDashboard } from '@/types/cyber';
import type { VulnerabilityAgingReport } from './_components/vuln-aging-chart';
import { useCyberCommonLabels, useCyberDashboardLabels } from './_lib/cyber-i18n';

import { SocKpiCards } from './_components/soc-kpi-cards';
import { AlertTimelineChart } from './_components/alert-timeline-chart';
import { SeverityDistributionChart } from './_components/severity-distribution-chart';
import { MitreHeatmapWidget } from './_components/mitre-heatmap-widget';
import { VulnAgingChart } from './_components/vuln-aging-chart';
import { RecentAlertsTable } from './_components/recent-alerts-table';
import { TopAttackedAssetsTable } from './_components/top-attacked-assets-table';
import { AnalystWorkloadChart } from './_components/analyst-workload-chart';

export default function SocDashboardPage() {
  const router = useRouter();
  const common = useCyberCommonLabels();
  const t = useCyberDashboardLabels();

  const {
    data: dashboardEnvelope,
    isLoading,
    error,
    mutate,
  } = useRealtimeData<{ data: SOCDashboard }>(API_ENDPOINTS.CYBER_DASHBOARD, {
    wsTopics: [
      'cyber.alert.created',
      'cyber.alert.status_changed',
      'cyber.threat.detected',
      'cyber.vulnerability.created',
    ],
    pollInterval: 60000,
  });

  const {
    data: agingEnvelope,
    isLoading: agingLoading,
    error: agingError,
    mutate: retryAging,
  } = useRealtimeData<{ data: VulnerabilityAgingReport }>(API_ENDPOINTS.CYBER_VULNERABILITIES_AGING, {
    pollInterval: 120000,
  });

  const handleRefresh = useCallback(() => {
    void mutate();
    void retryAging();
  }, [mutate, retryAging]);

  const dashboard = dashboardEnvelope?.data;
  const agingData = agingEnvelope?.data;

  if (isLoading) {
    return (
      <PermissionRedirect permission="cyber:read">
        <div className="space-y-6">
          <PageHeader
            eyebrow={common.eyebrow}
            title={t.title}
            description={t.description}
          />
          <LoadingSkeleton variant="kpi" count={4} />
          <SectionGrid cols={2}>
            <LoadingSkeleton variant="chart" />
            <LoadingSkeleton variant="chart" />
          </SectionGrid>
          <SectionGrid cols={2}>
            <LoadingSkeleton variant="chart" />
            <LoadingSkeleton variant="chart" />
          </SectionGrid>
          <SectionGrid cols={2}>
            <LoadingSkeleton variant="table" count={6} />
            <LoadingSkeleton variant="table" count={6} />
          </SectionGrid>
          <LoadingSkeleton variant="chart" />
        </div>
      </PermissionRedirect>
    );
  }

  if (error) {
    return (
      <PermissionRedirect permission="cyber:read">
        <ErrorState
          message={t.loadError}
          onRetry={() => void mutate()}
        />
      </PermissionRedirect>
    );
  }

  if (!dashboard) {
    return (
      <PermissionRedirect permission="cyber:read">
        <EmptyState
          icon={Radar}
          title={t.emptyTitle}
          description={t.emptyDescription}
          action={{ label: common.refresh, icon: RefreshCw, onClick: handleRefresh }}
        />
      </PermissionRedirect>
    );
  }

  return (
    <PermissionRedirect permission="cyber:read">
      <div className="space-y-6">
        <PageHeader
          eyebrow={common.eyebrow}
          title={t.title}
          description={t.description}
          tags={[
            {
              label: t.tagLiveMonitoring,
              tone: 'success',
              icon: <Radar className="h-3.5 w-3.5" aria-hidden />,
            },
            {
              label: t.tagCritical(dashboard.kpis.critical_alerts),
              tone: dashboard.kpis.critical_alerts > 0 ? 'danger' : 'neutral',
              icon: <ShieldCheck className="h-3.5 w-3.5" aria-hidden />,
            },
            {
              label: t.tagRisk(Math.round(dashboard.kpis.risk_score), dashboard.kpis.risk_grade),
              tone: 'info',
              icon: <Activity className="h-3.5 w-3.5" aria-hidden />,
            },
          ]}
          stats={[
            { label: t.statOpenAlerts, value: dashboard.kpis.open_alerts.toLocaleString() },
            {
              label: t.statCritical,
              value: dashboard.kpis.critical_alerts.toLocaleString(),
              accent: dashboard.kpis.critical_alerts > 0 ? 'hsl(var(--severity-critical))' : undefined,
            },
          ]}
          actions={
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={handleRefresh}>
                <RefreshCw className="me-1.5 h-3.5 w-3.5" />
                {common.refresh}
              </Button>
              <Button variant="ghost" size="sm" aria-label={common.settings} onClick={() => router.push('/settings')}>
                <Settings className="h-4 w-4" />
              </Button>
            </div>
          }
        />

        {/* ROW 1 — KPI Cards */}
        <SocKpiCards kpis={dashboard.kpis} />

        {/* ROW 2 — Timeline + Distribution */}
        <SectionGrid cols={2}>
          <SectionCard title={t.cardAlertVolume} contentClassName="pt-2">
            <AlertTimelineChart data={dashboard.alert_timeline} />
          </SectionCard>
          <SectionCard title={t.cardSeverityDistribution} contentClassName="pt-2">
            <SeverityDistributionChart data={dashboard.severity_distribution} />
          </SectionCard>
        </SectionGrid>

        {/* ROW 3 — MITRE Heatmap + Vuln Aging */}
        <SectionGrid cols={2}>
          <SectionCard title={t.cardMitreHeatmap} contentClassName="pt-2">
            <MitreHeatmapWidget data={dashboard.mitre_heatmap} />
          </SectionCard>
          <SectionCard title={t.cardVulnAging} contentClassName="pt-2">
            <VulnAgingChart
              data={agingData}
              loading={agingLoading}
              error={agingError?.message}
              onRetry={() => void retryAging()}
            />
          </SectionCard>
        </SectionGrid>

        {/* ROW 4 — Recent Alerts + Top Attacked Assets */}
        <SectionGrid cols={2}>
          <SectionCard
            title={t.cardRecentAlerts}
            actions={
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 text-primary"
                onClick={() => router.push('/cyber/alerts?severity=critical')}
              >
                {common.viewAll}
                <ArrowRight className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden />
              </Button>
            }
          >
            <RecentAlertsTable alerts={dashboard.recent_alerts} />
          </SectionCard>
          <SectionCard
            title={t.cardTopAttackedAssets}
            actions={
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 text-primary"
                onClick={() => router.push('/cyber/assets')}
              >
                {common.viewAll}
                <ArrowRight className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden />
              </Button>
            }
          >
            <TopAttackedAssetsTable assets={dashboard.top_attacked_assets} />
          </SectionCard>
        </SectionGrid>

        {/* ROW 5 — Analyst Workload */}
        <SectionCard title={t.cardAnalystWorkload} contentClassName="pt-2">
          <AnalystWorkloadChart data={dashboard.analyst_workload} />
        </SectionCard>

        {dashboard.partial_failures && dashboard.partial_failures.length > 0 && (
          <p className="text-caption text-muted-foreground">
            {t.partialFailures(dashboard.partial_failures.join(', '))}
          </p>
        )}
      </div>
    </PermissionRedirect>
  );
}
