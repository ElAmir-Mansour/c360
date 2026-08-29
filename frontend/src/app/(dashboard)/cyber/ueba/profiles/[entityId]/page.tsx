'use client';

import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { PageHeader } from '@/components/common/page-header';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { apiGet } from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';

import { useUebaLabels, uebaProfileStatusLabel } from '../../_lib/ueba-i18n';
import { useCyberSeverityLabels } from '../../../_lib/cyber-i18n';
import { ActivityHeatmap } from '../../_components/activity-heatmap';
import { VolumeTimeline } from '../../_components/volume-timeline';
import { TableAccessList } from '../../_components/table-access-list';
import { SourceIPList } from '../../_components/source-ip-list';
import { BaselineComparisonCard } from '../../_components/baseline-comparison-card';
import { SignalEvidenceViewer } from '../../_components/signal-evidence-viewer';
import { RiskScoreHistory } from '../../_components/risk-score-history';
import { ProfileActions } from '../../_components/profile-actions';
import { AlertActions } from '../../_components/alert-actions';
import type {
  UebaAlert,
  UebaHeatmapResponse,
  UebaProfileDetailResponse,
  UebaTimelineResponse,
} from '../../_components/types';

function badgeVariant(level: string) {
  if (level === 'critical') return 'destructive' as const;
  if (level === 'high') return 'warning' as const;
  if (level === 'mature') return 'success' as const;
  return 'outline' as const;
}

export default function UebaProfileDetailPage() {
  const t = useUebaLabels();
  const severityLabels = useCyberSeverityLabels();
  const params = useParams<{ entityId: string }>();
  const entityId = decodeURIComponent(params?.entityId ?? '');

  const profileQuery = useQuery({
    queryKey: ['cyber-ueba-profile', entityId],
    queryFn: () => apiGet<{ data: UebaProfileDetailResponse }>(`${API_ENDPOINTS.CYBER_UEBA_PROFILES}/${encodeURIComponent(entityId)}`),
  });
  const heatmapQuery = useQuery({
    queryKey: ['cyber-ueba-heatmap', entityId],
    queryFn: () => apiGet<{ data: UebaHeatmapResponse }>(`${API_ENDPOINTS.CYBER_UEBA_PROFILES}/${encodeURIComponent(entityId)}/heatmap?days=30`),
  });
  const timelineQuery = useQuery({
    queryKey: ['cyber-ueba-timeline', entityId],
    queryFn: () => apiGet<UebaTimelineResponse>(`${API_ENDPOINTS.CYBER_UEBA_PROFILES}/${encodeURIComponent(entityId)}/timeline?per_page=20`),
  });
  const alertsQuery = useQuery({
    queryKey: ['cyber-ueba-entity-alerts', entityId],
    queryFn: () => apiGet<{ data: UebaAlert[] }>(`${API_ENDPOINTS.CYBER_UEBA_ALERTS}?entity_id=${encodeURIComponent(entityId)}`),
  });

  const detail = profileQuery.data?.data;
  const profile = detail?.profile;

  if (profileQuery.isLoading || heatmapQuery.isLoading || timelineQuery.isLoading) {
    return (
      <PermissionRedirect permission="cyber:read">
        <div className="space-y-6">
          <LoadingSkeleton variant="card" />
          <LoadingSkeleton variant="card" />
          <LoadingSkeleton variant="card" />
        </div>
      </PermissionRedirect>
    );
  }

  if (!profile || profileQuery.error) {
    return (
      <PermissionRedirect permission="cyber:read">
        <ErrorState message={t.profileLoadError} onRetry={() => void profileQuery.refetch()} />
      </PermissionRedirect>
    );
  }

  const comparison = detail?.baseline_comparison ?? {};
  const accessComparison = comparison['access_times'] as Record<string, unknown> | undefined;
  const volumeComparison = comparison['data_volume'] as Record<string, unknown> | undefined;
  const patternComparison = comparison['access_patterns'] as Record<string, unknown> | undefined;
  const failureComparison = comparison['failure_rate'] as Record<string, unknown> | undefined;

  const timelinePoints = (volumeComparison?.['actual_last_7d_volume'] as Array<Record<string, unknown>> | undefined) ?? [];
  const recentTables = (patternComparison?.['actual_recent_tables'] as string[] | undefined) ?? [];
  const recentIPs = (patternComparison?.['actual_recent_source_ips'] as string[] | undefined) ?? [];
  const alerts = alertsQuery.data?.data ?? [];

  return (
    <PermissionRedirect permission="cyber:read">
      <div className="space-y-6">
        <PageHeader
          title={profile.entity_name ?? profile.entity_id}
          description={t.profileBaselineSubtitle(profile.entity_type.replaceAll('_', ' '))}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={badgeVariant(profile.risk_level)}>
                {t.riskBadge(profile.risk_score.toFixed(0), profile.risk_level)}
              </Badge>
              <Badge variant={badgeVariant(profile.profile_maturity)}>{profile.profile_maturity}</Badge>
              <Badge variant="outline">{uebaProfileStatusLabel(profile.status, t)}</Badge>
              <ProfileActions profile={profile} />
            </div>
          }
        />

        <Tabs defaultValue="activity" className="space-y-4">
          <TabsList>
            <TabsTrigger value="activity">{t.tabActivity}</TabsTrigger>
            <TabsTrigger value="alerts">{t.tabAlerts}</TabsTrigger>
            <TabsTrigger value="baseline">{t.tabBaseline}</TabsTrigger>
            <TabsTrigger value="risk">{t.tabRisk}</TabsTrigger>
          </TabsList>

          <TabsContent value="activity" className="space-y-4">
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.2fr_0.8fr]">
              <Card>
                <CardHeader><CardTitle className="text-base">{t.cardAccessHeatmap}</CardTitle></CardHeader>
                <CardContent>
                  <ActivityHeatmap matrix={heatmapQuery.data?.data.matrix ?? []} />
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-base">{t.cardRecentSourceIps}</CardTitle></CardHeader>
                <CardContent>
                  <SourceIPList
                    expectedIPs={profile.baseline.source_ips ?? []}
                    actualIPs={recentIPs}
                  />
                </CardContent>
              </Card>
            </div>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.2fr_0.8fr]">
              <Card>
                <CardHeader><CardTitle className="text-base">{t.cardVolumeTimeline}</CardTitle></CardHeader>
                <CardContent>
                  <VolumeTimeline
                    points={timelinePoints}
                    expectedBytesMean={Number(volumeComparison?.['expected_daily_bytes_mean'] ?? 0)}
                    expectedRowsMean={Number(volumeComparison?.['expected_daily_rows_mean'] ?? 0)}
                  />
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-base">{t.cardRecentTableAccess}</CardTitle></CardHeader>
                <CardContent>
                  <TableAccessList
                    expectedTables={profile.baseline.access_patterns?.tables_accessed ?? []}
                    actualTables={recentTables}
                  />
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="alerts" className="space-y-4">
            {alerts.map((alert) => (
              <Card key={alert.id}>
                <CardHeader>
                  <div className="flex items-center justify-between gap-3">
                    <CardTitle className="text-base">{alert.title}</CardTitle>
                    <div className="flex items-center gap-2">
                      <Badge variant={alert.severity === 'critical' ? 'destructive' : alert.severity === 'high' ? 'warning' : 'outline'}>
                        {severityLabels[alert.severity] ?? alert.severity}
                      </Badge>
                      <AlertActions alert={alert} />
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <SignalEvidenceViewer alert={alert} />
                </CardContent>
              </Card>
            ))}
            {alerts.length === 0 && (
              <Card><CardContent className="p-8 text-center text-muted-foreground">{t.entityAlertsEmpty}</CardContent></Card>
            )}
          </TabsContent>

          <TabsContent value="baseline" className="space-y-4">
            <div className="grid gap-4">
              <BaselineComparisonCard
                title={t.baselineAccessTime}
                expected={{
                  peak_hours: accessComparison?.['expected_peak_hours'],
                  active_hours: accessComparison?.['expected_active_hours'],
                }}
                actual={accessComparison?.['actual_last_7d_heatmap']}
              />
              <BaselineComparisonCard
                title={t.baselineVolume}
                expected={{
                  daily_bytes_mean: volumeComparison?.['expected_daily_bytes_mean'],
                  daily_rows_mean: volumeComparison?.['expected_daily_rows_mean'],
                }}
                actual={volumeComparison?.['actual_last_7d_volume']}
              />
              <BaselineComparisonCard
                title={t.baselineAccessPattern}
                expected={{
                  tables: patternComparison?.['expected_tables'],
                  source_ips: patternComparison?.['expected_source_ips'],
                }}
                actual={{
                  recent_tables: patternComparison?.['actual_recent_tables'],
                  recent_source_ips: patternComparison?.['actual_recent_source_ips'],
                }}
              />
              <BaselineComparisonCard
                title={t.baselineFailureRate}
                expected={{
                  failure_rate_percent: failureComparison?.['expected_failure_rate_percent'],
                  daily_failure_count_mean: profile.baseline.failure_rate?.daily_failure_count_mean,
                }}
                actual={{
                  current_failure_rate_percent: profile.baseline.failure_rate?.failure_rate_percent,
                }}
              />
            </div>
          </TabsContent>

          <TabsContent value="risk" className="space-y-4">
            <Card>
              <CardHeader><CardTitle className="text-base">{t.cardRiskScoreHistory}</CardTitle></CardHeader>
              <CardContent>
                <RiskScoreHistory history={detail?.risk_history ?? []} />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </PermissionRedirect>
  );
}
