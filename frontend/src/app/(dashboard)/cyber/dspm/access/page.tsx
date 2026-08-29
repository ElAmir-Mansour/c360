'use client';

import { useRouter } from 'next/navigation';
import { Users, Shield, ShieldAlert, AlertTriangle, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/common/page-header';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { ErrorState } from '@/components/common/error-state';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { BarChart } from '@/components/shared/charts/bar-chart';
import { severityVar } from '@/lib/design-tokens';
import { SectionCard } from '@/components/suites/section-card';
import { useRealtimeData } from '@/hooks/use-realtime-data';
import { API_ENDPOINTS } from '@/lib/constants';
import { Badge } from '@/components/ui/badge';
import { AccessKpiCards } from './_components/access-kpi-cards';
import type { AccessDashboard, IdentityProfile } from '@/types/cyber';
import { useDspmLabels } from '../_lib/dspm-i18n';

interface RiskRankingEntry {
  identity_id: string;
  identity_name: string;
  access_risk_score: number;
  blast_radius_score: number;
  overprivileged_count: number;
}

export default function AccessIntelligencePage() {
  const router = useRouter();
  const t = useDspmLabels().access;

  const {
    data: dashEnvelope,
    isLoading: dashLoading,
    error: dashError,
    mutate: refetchDash,
  } = useRealtimeData<{ data: AccessDashboard }>(API_ENDPOINTS.CYBER_DSPM_ACCESS_DASHBOARD, {
    pollInterval: 120000,
  });

  const {
    data: riskRankingEnvelope,
    isLoading: riskLoading,
  } = useRealtimeData<{ data: RiskRankingEntry[] }>(API_ENDPOINTS.CYBER_DSPM_ACCESS_RISK_RANKING, {
    pollInterval: 120000,
  });

  const {
    data: overprivEnvelope,
    isLoading: overprivLoading,
  } = useRealtimeData<{ data: Array<Record<string, unknown>> }>(API_ENDPOINTS.CYBER_DSPM_ACCESS_OVERPRIVILEGED, {
    pollInterval: 120000,
  });

  const dashboard = dashEnvelope?.data;
  const riskRanking = riskRankingEnvelope?.data ?? [];
  const overprivData = overprivEnvelope?.data ?? [];

  const riskChartData = riskRanking.slice(0, 10).map((entry) => ({
    name: entry.identity_name.length > 20
      ? `${entry.identity_name.slice(0, 18)}...`
      : entry.identity_name,
    risk_score: entry.access_risk_score,
  }));

  function getRiskBadgeVariant(score: number): 'destructive' | 'secondary' | 'outline' {
    if (score >= 75) return 'destructive';
    if (score >= 50) return 'secondary';
    return 'outline';
  }

  return (
    <PermissionRedirect permission="cyber:read">
      <div className="space-y-6">
        <PageHeader
          title={t.title}
          description={t.description}
          actions={
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => router.push('/cyber/dspm/access/identities')}
              >
                <Users className="me-1.5 h-3.5 w-3.5" />
                {t.identities}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => router.push('/cyber/dspm/access/policies')}
              >
                <Shield className="me-1.5 h-3.5 w-3.5" />
                {t.policies}
              </Button>
            </div>
          }
        />

        {dashLoading ? (
          <LoadingSkeleton variant="card" />
        ) : dashError || !dashboard ? (
          <ErrorState
            message={t.loadError}
            onRetry={() => void refetchDash()}
          />
        ) : (
          <>
            <AccessKpiCards dashboard={dashboard} />

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              {/* Risk ranking bar chart */}
              <SectionCard
                title={t.topRiskyChart}
                className="lg:col-span-2"
              >
                {riskLoading ? (
                  <LoadingSkeleton variant="chart" />
                ) : riskChartData.length === 0 ? (
                  <div className="rounded-lg border bg-muted/20 p-4 text-sm text-muted-foreground">
                    {t.noRankingData}
                  </div>
                ) : (
                  <BarChart
                    data={riskChartData}
                    xKey="name"
                    yKeys={[{ key: 'risk_score', label: t.riskScore, color: severityVar('critical') }]}
                    layout="horizontal"
                    height={320}
                    showLegend={false}
                    yFormatter={(v) => `${v}`}
                  />
                )}
              </SectionCard>

              {/* Summary cards */}
              <div className="space-y-4">
                <SectionCard
                  title={
                    <span className="flex items-center gap-2 text-sm">
                      <AlertTriangle className="h-4 w-4 text-severity-high" />
                      {t.overprivFindings}
                    </span>
                  }
                >
                  <p className="text-3xl font-bold tabular-nums">
                    {overprivLoading ? '...' : (overprivData.length || dashboard.overprivileged_mappings)}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t.overprivSubtitle}
                  </p>
                </SectionCard>

                <SectionCard
                  title={
                    <span className="flex items-center gap-2 text-sm">
                      <Clock className="h-4 w-4 text-warning-700 dark:text-warning-300" />
                      {t.staleAccess}
                    </span>
                  }
                >
                  <p className="text-3xl font-bold tabular-nums">
                    {dashboard.stale_permissions}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t.staleSubtitle}
                  </p>
                </SectionCard>

                <SectionCard
                  title={
                    <span className="flex items-center gap-2 text-sm">
                      <ShieldAlert className="h-4 w-4 text-severity-critical" />
                      {t.riskDistribution}
                    </span>
                  }
                >
                  <div className="space-y-2">
                    {Object.entries(dashboard.risk_distribution).map(([level, count]) => (
                      <div key={level} className="flex items-center justify-between text-sm">
                        <span className="capitalize text-muted-foreground">{level}</span>
                        <Badge variant={level === 'critical' || level === 'high' ? 'destructive' : 'secondary'}>
                          {count}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </SectionCard>
              </div>
            </div>

            {/* Top risky identities table */}
            <SectionCard
              title={t.topRiskyTitle}
              description={t.topRiskySubtitle}
            >
              {dashboard.top_risky_identities.length === 0 ? (
                  <div className="rounded-lg border bg-muted/20 p-4 text-sm text-muted-foreground">
                    {t.noRiskyIdentities}
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-start text-xs text-muted-foreground">
                          <th className="pb-3 pe-4 font-medium">{t.colName}</th>
                          <th className="pb-3 pe-4 font-medium">{t.colType}</th>
                          <th className="pb-3 pe-4 font-medium text-end">{t.colRiskScore}</th>
                          <th className="pb-3 pe-4 font-medium text-end">{t.colBlastRadius}</th>
                          <th className="pb-3 font-medium text-end">{t.colOverprivileged}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dashboard.top_risky_identities.map((identity: IdentityProfile) => (
                          <tr
                            key={identity.id}
                            className="cursor-pointer border-b last:border-0 hover:bg-muted/50 transition-colors"
                            onClick={() => router.push(`/cyber/dspm/access/identities/${identity.id}`)}
                          >
                            <td className="py-3 pe-4">
                              <div>
                                <p className="font-medium">{identity.identity_name}</p>
                                <p className="text-xs text-muted-foreground">{identity.identity_email}</p>
                              </div>
                            </td>
                            <td className="py-3 pe-4">
                              <Badge variant="outline" className="capitalize">
                                {identity.identity_type.replace(/_/g, ' ')}
                              </Badge>
                            </td>
                            <td className="py-3 pe-4 text-end">
                              <Badge variant={getRiskBadgeVariant(identity.access_risk_score)}>
                                {Math.round(identity.access_risk_score)}
                              </Badge>
                            </td>
                            <td className="py-3 pe-4 text-end tabular-nums">
                              {Math.round(identity.blast_radius_score)}
                            </td>
                            <td className="py-3 text-end tabular-nums">
                              {identity.overprivileged_count}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
            </SectionCard>
          </>
        )}
      </div>
    </PermissionRedirect>
  );
}
