'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Fingerprint, ShieldAlert, Users, AlertTriangle, BellRing, Gauge } from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { StatCard } from '@/components/shared/stat-card';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { apiGet } from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';

import { useUebaLabels } from './_lib/ueba-i18n';
import { RiskRankingChart } from './_components/risk-ranking-chart';
import { AlertTypeDistribution } from './_components/alert-type-distribution';
import { AlertTrendChart } from './_components/alert-trend-chart';
import { ProfileTable } from './_components/profile-table';
import type { UebaDashboard } from './_components/types';

export default function UebaDashboardPage() {
  const t = useUebaLabels();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['cyber-ueba-dashboard'],
    queryFn: () => apiGet<{ data: UebaDashboard }>(API_ENDPOINTS.CYBER_UEBA_DASHBOARD),
  });

  const dashboard = data?.data;

  if (isLoading) {
    return (
      <PermissionRedirect permission="cyber:read">
        <div className="space-y-6">
          <PageHeader title={t.title} description={t.descriptionLoading} />
          <LoadingSkeleton variant="kpi" count={4} />
          <LoadingSkeleton variant="card" />
          <LoadingSkeleton variant="card" />
        </div>
      </PermissionRedirect>
    );
  }

  if (!dashboard || error) {
    return (
      <PermissionRedirect permission="cyber:read">
        <ErrorState
          message={t.loadError}
          onRetry={() => void refetch()}
        />
      </PermissionRedirect>
    );
  }

  return (
    <PermissionRedirect permission="cyber:read">
      <div className="space-y-6">
        <PageHeader
          title={t.title}
          description={t.description}
          actions={
            <div className="flex gap-2">
              <Button asChild variant="outline" size="sm">
                <Link href="/cyber/ueba/alerts">{t.alertsButton}</Link>
              </Button>
            </div>
          }
        />

        <Card className="overflow-hidden border-border/70">
          <CardContent className="flex items-center gap-4 p-4 sm:p-6">
            <div className="rounded-full bg-primary/10 p-3 text-primary">
              <Fingerprint className="h-6 w-6" />
            </div>
            <div className="space-y-1">
              <div className="font-semibold">{t.heroTitle}</div>
              <div className="max-w-3xl text-sm text-muted-foreground">
                {t.heroBody}
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label={t.kpiActiveProfiles}
            value={dashboard.kpis.active_profiles.toLocaleString()}
            icon={Users}
            tone="sky"
            className=""
          />
          <StatCard
            label={t.kpiHighRiskEntities}
            value={dashboard.kpis.high_risk_entities.toLocaleString()}
            icon={AlertTriangle}
            tone="rose"
            className=""
          />
          <StatCard
            label={t.kpiAlerts7d}
            value={dashboard.kpis.alerts_7d.toLocaleString()}
            icon={BellRing}
            tone="sky"
            className=""
          />
          <StatCard
            label={t.kpiAvgRiskScore}
            value={dashboard.kpis.average_risk_score.toFixed(1)}
            icon={Gauge}
            tone="gold"
            className=""
          />
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.35fr_0.9fr]">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t.cardRiskRanking}</CardTitle>
            </CardHeader>
            <CardContent>
              <RiskRankingChart items={dashboard.risk_ranking} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t.cardAlertTypeDistribution}</CardTitle>
            </CardHeader>
            <CardContent>
              <AlertTypeDistribution items={dashboard.alert_type_distribution} />
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t.cardAlertTrend}</CardTitle>
          </CardHeader>
          <CardContent>
            <AlertTrendChart items={dashboard.alert_trend} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldAlert className="h-4 w-4" />
              {t.cardProfileRanking}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ProfileTable items={dashboard.profiles} />
          </CardContent>
        </Card>
      </div>
    </PermissionRedirect>
  );
}
