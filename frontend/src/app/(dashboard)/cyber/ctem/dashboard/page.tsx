'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { apiGet } from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { PageHeader } from '@/components/common/page-header';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { KpiCard } from '@/components/shared/kpi-card';
import { AreaChart } from '@/components/shared/charts/area-chart';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { ExposureScore, ExposureScorePoint } from '@/types/cyber';

import { ExposureScoreGauge } from '../_components/exposure-score-gauge';
import { useCtemLabels } from '../_lib/ctem-i18n';

export default function CTEMDashboardPage() {
  const t = useCtemLabels();
  const scoreQuery = useQuery({
    queryKey: ['ctem-exposure-score'],
    queryFn: () => apiGet<{ data: ExposureScore }>(API_ENDPOINTS.CYBER_CTEM_EXPOSURE_SCORE),
    refetchInterval: 60000,
  });

  const historyQuery = useQuery({
    queryKey: ['ctem-exposure-history'],
    queryFn: () =>
      apiGet<{ data: ExposureScorePoint[] }>(API_ENDPOINTS.CYBER_CTEM_EXPOSURE_HISTORY, {
        days: 90,
      }),
    refetchInterval: 300000,
  });

  const score = scoreQuery.data?.data;
  const history = historyQuery.data?.data ?? [];

  const historyChart = history.map((p) => ({
    date: new Date(p.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    score: p.score,
  }));

  return (
    <PermissionRedirect permission="cyber:read">
      <div className="space-y-6">
        <PageHeader
          title={t.dashboard.title}
          description={t.dashboard.description}
          actions={
            <Button variant="outline" size="sm" asChild>
              <Link href="/cyber/ctem">
                <ArrowRight className="me-1.5 h-3.5 w-3.5" />
                {t.dashboard.viewAssessments}
              </Link>
            </Button>
          }
        />

        {/* Row 1: Exposure Score + KPIs */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
          <Card className="lg:col-span-1">
            <CardContent className="flex items-center justify-center py-6">
              {scoreQuery.isLoading ? (
                <LoadingSkeleton variant="chart" />
              ) : (
                <ExposureScoreGauge />
              )}
            </CardContent>
          </Card>

          <div className="lg:col-span-3 grid grid-cols-1 gap-4 md:grid-cols-3">
            <KpiCard
              title={t.dashboard.kpiExposureScore}
              value={score?.score?.toFixed(1) ?? '—'}
              description={score?.grade ? t.dashboard.kpiGrade(score.grade) : undefined}
              loading={scoreQuery.isLoading}
            />
            <KpiCard
              title={t.dashboard.kpiTrend}
              value={score?.trend?.replace(/_/g, ' ') ?? '—'}
              description={
                score?.trend_delta !== undefined
                  ? t.dashboard.kpiTrendPts(`${score.trend_delta > 0 ? '+' : ''}${score.trend_delta.toFixed(1)}`)
                  : undefined
              }
              iconColor={
                score?.trend === 'improving'
                  ? 'text-primary'
                  : score?.trend === 'worsening'
                    ? 'text-status-error'
                    : undefined
              }
              loading={scoreQuery.isLoading}
            />
            <KpiCard
              title={t.dashboard.kpiLastCalculated}
              value={
                score?.calculated_at
                  ? new Date(score.calculated_at).toLocaleDateString()
                  : '—'
              }
              loading={scoreQuery.isLoading}
            />
          </div>
        </div>

        {/* Row 2: Exposure Score Trend */}
        <AreaChart
          title={t.dashboard.trendChartTitle}
          data={historyChart}
          xKey="date"
          yKeys={[{ key: 'score', label: t.dashboard.trendSeriesLabel, color: 'hsl(var(--severity-critical))' }]}
          height={320}
        />

        {/* Row 3: Quick Links */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">{t.dashboard.runNewTitle}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-3">
                {t.dashboard.runNewBody}
              </p>
              <Button size="sm" asChild>
                <Link href="/cyber/ctem">{t.dashboard.goToAssessments}</Link>
              </Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">{t.dashboard.methodologyTitle}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                {t.dashboard.methodologyBody}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </PermissionRedirect>
  );
}
