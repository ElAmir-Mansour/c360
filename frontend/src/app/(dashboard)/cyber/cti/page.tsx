'use client';

import { useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Activity,
  Fingerprint,
  Radar,
  RefreshCw,
  ShieldAlert,
  Target,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { PageHeader } from '@/components/common/page-header';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { ErrorState } from '@/components/common/error-state';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { useCTIDashboard } from '@/hooks/use-cti-dashboard';
import { useCTIWebSocket } from '@/hooks/use-cti-websocket';
import { useCTIStore } from '@/stores/cti-store';
import { GlobalThreatMap } from '@/components/cyber/cti/global-threat-map';
import { ThreatMapPopover } from '@/components/cyber/cti/threat-map-popover';
import { LiveEventFeed } from '@/components/cyber/cti/live-event-feed';
import { CTIKPIStatCard } from '@/components/cyber/cti/kpi-stat-card';
import { RiskScoreGauge } from '@/components/cyber/cti/risk-score-gauge';
import { StatusBadge, severityMap } from '@/components/shared/status-badge';
import { CTIStatusBadge } from '@/components/cyber/cti/status-badge';
import { useCtiLabels } from './_lib/cti-i18n';

function websocketTone(status: string): string {
  switch (status) {
    case 'connected':
      return 'bg-primary/15 text-primary border-primary/30';
    case 'connecting':
      return 'bg-status-warning/15 text-warning-700 dark:text-warning-300 border-status-warning/30';
    case 'error':
      return 'bg-status-error/15 text-status-error border-status-error/30';
    default:
      return 'bg-foreground/15 text-foreground/30 border-primary/30';
  }
}

export default function CTIDashboardPage() {
  const router = useRouter();
  const { dashboard: t } = useCtiLabels();
  const {
    period,
    setPeriod: rawSetPeriod,
    snapshot,
    hotspots,
    sectors,
    topCampaigns,
    criticalBrands,
    recentEvents,
    isLoading,
  } = useCTIDashboard();
  const setPeriod = rawSetPeriod as (period: string) => void;
  const { selectedHotspot, setSelectedHotspot, liveEvents, loadDashboard } = useCTIStore();
  const { status: wsStatus } = useCTIWebSocket();

  const mttd = snapshot?.mean_time_to_detect_hours ?? 0;
  const mttr = snapshot?.mean_time_to_respond_hours ?? 0;
  const topSector = snapshot?.top_targeted_sector_label ?? t.unavailable;
  const recentCampaigns = useMemo(() => topCampaigns.slice(0, 5), [topCampaigns]);
  const urgentBrands = useMemo(() => criticalBrands.slice(0, 5), [criticalBrands]);

  const handleRefresh = useCallback(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const handleViewEvents = useCallback(
    (countryCode: string, city: string) => {
      const params = new URLSearchParams();
      if (countryCode) {
        params.set('origin_country', countryCode.toLowerCase());
      }
      if (city) {
        params.set('search', city);
      }
      router.push(`/cyber/cti/events?${params.toString()}`);
    },
    [router],
  );

  if (isLoading) {
    return (
      <PermissionRedirect permission="cyber:read">
        <div className="space-y-6">
          <PageHeader
            title={t.title}
            description={t.description}
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <LoadingSkeleton key={index} variant="card" />
            ))}
          </div>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <LoadingSkeleton variant="chart" className="xl:col-span-2" />
            <LoadingSkeleton variant="card" />
          </div>
        </div>
      </PermissionRedirect>
    );
  }

  if (!snapshot) {
    return (
      <PermissionRedirect permission="cyber:read">
        <ErrorState message={t.loadFailed} onRetry={handleRefresh} />
      </PermissionRedirect>
    );
  }

  return (
    <PermissionRedirect permission="cyber:read">
      <div className="space-y-6">
        <PageHeader
          title={t.title}
          description={t.description}
          actions={(
            <div className="flex items-center gap-2">
              <span className={`rounded-full border px-3 py-1 text-[11px] font-medium uppercase tracking-caps-xwide ${websocketTone(wsStatus)}`}>
                {t.ws(t.wsStatuses[wsStatus as keyof typeof t.wsStatuses] ?? wsStatus)}
              </span>
              <Button variant="outline" size="sm" onClick={handleRefresh}>
                <RefreshCw className="me-1.5 h-3.5 w-3.5" />
                {t.refresh}
              </Button>
            </div>
          )}
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <CTIKPIStatCard
            label={t.kpiEvents24h}
            value={snapshot.total_events_24h}
            subtitle={t.kpiEvents7d(snapshot.total_events_7d.toLocaleString())}
            trend={{ direction: snapshot.trend_direction, percentage: snapshot.trend_percentage }}
            icon={<Activity className="h-4 w-4" />}
            tone="rose"
          />
          <CTIKPIStatCard
            label={t.kpiActiveCampaigns}
            value={snapshot.active_campaigns_count}
            subtitle={t.kpiCriticalCount(snapshot.critical_campaigns_count)}
            icon={<Target className="h-4 w-4" />}
            tone="rose"
            onClick={() => router.push('/cyber/cti/campaigns')}
          />
          <CTIKPIStatCard
            label={t.kpiTotalIocs}
            value={snapshot.total_iocs}
            subtitle={t.kpiTopSector(topSector)}
            icon={<Fingerprint className="h-4 w-4" />}
            tone="sky"
          />
          <CTIKPIStatCard
            label={t.kpiBrandAbuse}
            value={snapshot.brand_abuse_total_count}
            subtitle={t.kpiCriticalCount(snapshot.brand_abuse_critical_count)}
            icon={<ShieldAlert className="h-4 w-4" />}
            tone="rose"
            onClick={() => router.push('/cyber/cti/brand-abuse')}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <div className="relative xl:col-span-2">
            <GlobalThreatMap
              hotspots={hotspots}
              period={period}
              onPeriodChange={setPeriod}
              onHotspotClick={setSelectedHotspot}
              selectedHotspot={selectedHotspot}
              liveEvents={liveEvents}
            />
            {selectedHotspot && (
              <div className="absolute end-4 top-16 z-10">
                <ThreatMapPopover
                  hotspot={selectedHotspot}
                  onClose={() => setSelectedHotspot(null)}
                  onViewEvents={handleViewEvents}
                />
              </div>
            )}
          </div>

          <Card>
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-sm">{t.liveEventFeed}</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <LiveEventFeed events={liveEvents.length > 0 ? liveEvents : recentEvents} />
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <CardHeader className="flex flex-row items-center justify-between p-4 pb-2">
              <CardTitle className="text-sm">{t.activeCampaigns}</CardTitle>
              <Link href="/cyber/cti/campaigns" className="text-xs text-primary hover:underline">
                {t.viewAll}
              </Link>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t.colCampaign}</TableHead>
                    <TableHead>{t.colStatus}</TableHead>
                    <TableHead>{t.colActor}</TableHead>
                    <TableHead className="text-end">{t.colIocs}</TableHead>
                    <TableHead className="text-end">{t.colEvents}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentCampaigns.length > 0 ? recentCampaigns.map((campaign) => (
                    <TableRow
                      key={campaign.id}
                      className="cursor-pointer"
                      onClick={() => router.push(`/cyber/cti/campaigns/${campaign.id}`)}
                    >
                      <TableCell>
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <p className="font-medium">{campaign.name}</p>
                            <StatusBadge map={severityMap} status={campaign.severity_code} size="sm" />
                          </div>
                          <p className="text-xs text-muted-foreground">{campaign.campaign_code}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <CTIStatusBadge status={campaign.status} type="campaign" />
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {campaign.actor_name || t.unknownActor}
                      </TableCell>
                      <TableCell className="text-end font-medium tabular-nums">
                        {campaign.ioc_count.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-end font-medium tabular-nums">
                        {campaign.event_count.toLocaleString()}
                      </TableCell>
                    </TableRow>
                  )) : (
                    <TableRow>
                      <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                        {t.noCampaigns}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between p-4 pb-2">
              <CardTitle className="text-sm">{t.criticalBrandAbuse}</CardTitle>
              <Link href="/cyber/cti/brand-abuse" className="text-xs text-primary hover:underline">
                {t.viewAll}
              </Link>
            </CardHeader>
            <CardContent className="space-y-3 p-4 pt-0">
              {urgentBrands.length > 0 ? urgentBrands.map((incident) => (
                <button
                  key={incident.id}
                  type="button"
                  onClick={() => router.push(`/cyber/cti/brand-abuse/${incident.id}`)}
                  className="w-full rounded-xl border border-white/10 bg-auth-dark/40 p-3 text-start transition hover:bg-auth-dark/60"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{incident.malicious_domain}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {incident.brand_name} · {incident.region_label || t.unknownRegion}
                      </p>
                    </div>
                    <StatusBadge map={severityMap} status={incident.risk_level} size="sm" />
                  </div>
                  <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                    <CTIStatusBadge status={incident.takedown_status} type="takedown" className="px-1.5 py-0 text-xs" />
                    <span>{t.detections(incident.detection_count)}</span>
                  </div>
                </button>
              )) : (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  {t.noBrandAbuse}
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-sm">{t.topTargetedSectors}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 p-4 pt-0">
              {sectors.slice(0, 6).map((sector) => (
                <div key={sector.id} className="rounded-xl border border-white/10 bg-auth-dark/35 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-medium">{sector.sector_label}</p>
                      <p className="text-xs text-muted-foreground">
                        {t.eventsIn(sector.total_count.toLocaleString(), period)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {sector.severity_critical_count > 0 && <StatusBadge map={severityMap} status="critical" size="sm" />}
                      {sector.severity_high_count > 0 && <StatusBadge map={severityMap} status="high" size="sm" />}
                    </div>
                  </div>
                </div>
              ))}
              {sectors.length === 0 && (
                <p className="py-8 text-center text-sm text-muted-foreground">{t.noSectorAnalytics}</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-sm">{t.executiveRiskPosture}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 p-4 pt-0">
              <div className="flex items-center justify-center">
                <RiskScoreGauge
                  score={snapshot.risk_score_overall}
                  trend={snapshot.trend_direction}
                  size={150}
                />
              </div>
              <div className="grid grid-cols-2 gap-2 text-center">
                <div className="rounded-xl border border-white/10 bg-auth-dark/40 p-3">
                  <p className="text-lg font-semibold tabular-nums">{mttd.toFixed(1)}h</p>
                  <p className="text-[11px] uppercase tracking-caps-xwide text-muted-foreground">MTTD</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-auth-dark/40 p-3">
                  <p className="text-lg font-semibold tabular-nums">{mttr.toFixed(1)}h</p>
                  <p className="text-[11px] uppercase tracking-caps-xwide text-muted-foreground">MTTR</p>
                </div>
              </div>
              <div className="rounded-xl border border-white/10 bg-auth-dark/40 p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">{t.topOrigin}</span>
                  <span className="font-medium uppercase">
                    {snapshot.top_threat_origin_country || '—'}
                  </span>
                </div>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">{t.topSector}</span>
                  <span className="font-medium">{topSector}</span>
                </div>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">{t.refreshWindow}</span>
                  <span className="font-medium">
                    <Radar className="me-1 inline h-3.5 w-3.5" />
                    {period}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </PermissionRedirect>
  );
}
