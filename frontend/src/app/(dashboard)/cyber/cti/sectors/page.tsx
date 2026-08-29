'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '@/components/common/page-header';
import { ErrorState } from '@/components/common/error-state';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { CTIKPIStatCard } from '@/components/cyber/cti/kpi-stat-card';
import { PeriodSelector } from '@/components/cyber/cti/period-selector';
import { StatusBadge, severityMap } from '@/components/shared/status-badge';
import { SectorThreatChart } from '@/components/cyber/cti/sector-threat-chart';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { fetchCampaigns, fetchSectorThreatOverview, fetchSectors, fetchThreatEvents } from '@/lib/cti-api';
import { ROUTES } from '@/lib/constants';
import { formatRelativeTime } from '@/lib/cti-utils';
import { severityVar } from '@/lib/design-tokens';
import { type CTIPeriod, type CTISectorThreatSummary } from '@/types/cti';
import { useCtiLabels } from '../_lib/cti-i18n';

type SectorLens = CTISectorThreatSummary & { snapshot_count: number };

function TrendSparkline({ points }: { points: number[] }) {
  const width = 320;
  const height = 96;
  const max = Math.max(...points, 1);
  const path = points
    .map((point, index) => {
      const x = (index / Math.max(points.length - 1, 1)) * width;
      const y = height - (point / max) * (height - 12) - 6;
      return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
    })
    .join(' ');

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-24 w-full">
      <path d={path} fill="none" stroke="hsl(var(--chart-2))" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function sectorTimestamp(sector: CTISectorThreatSummary): number {
  const parsed = Date.parse(sector.computed_at ?? sector.period_end ?? sector.period_start);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function normalizeSectorSummaries(sectors: CTISectorThreatSummary[]): SectorLens[] {
  const latestBySector = new Map<string, SectorLens>();

  sectors.forEach((sector) => {
    const existing = latestBySector.get(sector.sector_id);
    if (!existing) {
      latestBySector.set(sector.sector_id, { ...sector, snapshot_count: 1 });
      return;
    }

    const nextSnapshotCount = existing.snapshot_count + 1;
    if (sectorTimestamp(sector) >= sectorTimestamp(existing)) {
      latestBySector.set(sector.sector_id, { ...sector, snapshot_count: nextSnapshotCount });
      return;
    }

    latestBySector.set(sector.sector_id, { ...existing, snapshot_count: nextSnapshotCount });
  });

  return Array.from(latestBySector.values()).sort((left, right) => right.total_count - left.total_count);
}

function percentOfTotal(value: number, total: number): number {
  if (total <= 0) {
    return 0;
  }
  return Number(((value / total) * 100).toFixed(1));
}

export default function CTISectorsPage() {
  const { sectors: t } = useCtiLabels();
  const [period, setPeriod] = useState<Extract<CTIPeriod, '24h' | '7d' | '30d'>>('7d');
  const [selectedSectorId, setSelectedSectorId] = useState<string | null>(null);

  const sectorsQuery = useQuery({
    queryKey: ['cti-sector-threat-overview', period],
    queryFn: () => fetchSectorThreatOverview(period),
  });
  const sectorMetaQuery = useQuery({
    queryKey: ['cti-sector-meta'],
    queryFn: fetchSectors,
  });

  const sectors = useMemo(() => sectorsQuery.data?.sectors ?? [], [sectorsQuery.data?.sectors]);
  const sectorMeta = useMemo(() => sectorMetaQuery.data ?? [], [sectorMetaQuery.data]);
  const normalizedSectors = useMemo(
    () => normalizeSectorSummaries(sectors),
    [sectors],
  );
  const activeSector = useMemo(
    () => normalizedSectors.find((sector) => sector.sector_id === selectedSectorId) ?? normalizedSectors[0] ?? null,
    [selectedSectorId, normalizedSectors],
  );
  const activeSectorMeta = useMemo(
    () => sectorMeta.find((sector) => sector.id === activeSector?.sector_id) ?? null,
    [activeSector?.sector_id, sectorMeta],
  );
  const activeSectorCode = activeSector?.sector_code ?? activeSectorMeta?.code ?? undefined;
  const selectorSectors = useMemo(() => {
    if (!activeSector) {
      return normalizedSectors.slice(0, 12);
    }

    const featured = normalizedSectors.slice(0, 12).filter((sector) => sector.sector_id !== activeSector.sector_id);
    return [activeSector, ...featured].slice(0, 12);
  }, [activeSector, normalizedSectors]);

  const deepDiveEventsQuery = useQuery({
    queryKey: ['cti-sector-events', activeSectorCode, period],
    queryFn: () => fetchThreatEvents({
      page: 1,
      per_page: 100,
      target_sector: activeSectorCode,
      sort: 'first_seen_at',
      order: 'desc',
    }),
    enabled: Boolean(activeSectorCode),
  });
  const sectorCampaignsQuery = useQuery({
    queryKey: ['cti-sector-campaigns', activeSector?.sector_id],
    queryFn: async () => {
      const response = await fetchCampaigns({ page: 1, per_page: 100, sort: 'last_seen_at', order: 'desc' });
      return (response.data ?? []).filter((campaign) => campaign.target_sectors.includes(activeSector!.sector_id));
    },
    enabled: Boolean(activeSector?.sector_id),
  });

  const totalEvents = normalizedSectors.reduce((sum, sector) => sum + sector.total_count, 0);
  const criticalEvents = normalizedSectors.reduce((sum, sector) => sum + sector.severity_critical_count, 0);
  const selectedEvents = useMemo(() => deepDiveEventsQuery.data?.data ?? [], [deepDiveEventsQuery.data?.data]);
  const selectedCampaigns = useMemo(() => sectorCampaignsQuery.data ?? [], [sectorCampaignsQuery.data]);
  const normalizedSnapshotCount = sectors.length;
  const selectedShare = percentOfTotal(activeSector?.total_count ?? 0, totalEvents);

  const threatTypeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    selectedEvents.forEach((event) => {
      const key = event.category_label || event.event_type;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [selectedEvents]);

  const topOrigins = useMemo(() => {
    const counts = new Map<string, number>();
    selectedEvents.forEach((event) => {
      const key = event.origin_country_code?.toUpperCase() || 'Unknown';
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [selectedEvents]);

  const trendPoints = useMemo(() => {
    const buckets = new Map<string, number>();
    selectedEvents.forEach((event) => {
      const day = event.first_seen_at.slice(0, 10);
      buckets.set(day, (buckets.get(day) ?? 0) + 1);
    });
    return Array.from(buckets.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-8)
      .map(([, count]) => count);
  }, [selectedEvents]);

  if (sectorsQuery.error) {
    return (
      <PermissionRedirect permission="cyber:read">
        <ErrorState message={t.failedToLoad} onRetry={() => void sectorsQuery.refetch()} />
      </PermissionRedirect>
    );
  }

  return (
    <PermissionRedirect permission="cyber:read">
      <div className="space-y-6">
        <PageHeader
          title={t.title}
          description={t.description}
          actions={<PeriodSelector value={period} onChange={(nextPeriod) => setPeriod(nextPeriod as Extract<CTIPeriod, '24h' | '7d' | '30d'>)} />}
        />

        <div className="grid gap-4 md:grid-cols-3">
          <CTIKPIStatCard
            label={t.kpiImpactedSectors}
            value={normalizedSectors.length}
            subtitle={t.reportingWindow(period)}
            tone="sky"
          />
          <CTIKPIStatCard label={t.kpiTotalSectorEvents} value={totalEvents} subtitle={t.aggregatedAcrossAll} tone="sky" />
          <CTIKPIStatCard
            label={t.kpiCriticalEvents}
            value={criticalEvents}
            subtitle={t.criticalSeverityPressure}
            tone="rose"
          />
        </div>

        <Card className="overflow-hidden border-primary/60 bg-card shadow-sm">
          <CardContent className="grid gap-6 p-6 lg:grid-cols-[1.2fr,0.8fr]">
            <div className="space-y-4">
              <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">
                {t.lensBadge}
              </Badge>
              <div className="space-y-2">
                <h2 className="text-h2 font-semibold text-foreground">
                  {t.lensHeadline}
                </h2>
                <p className="max-w-2xl text-sm text-muted-foreground">
                  {t.lensBody}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary" className="bg-foreground/[0.03] text-foreground">
                  {t.uniqueSectors(normalizedSectors.length)}
                </Badge>
                <Badge variant="secondary" className="bg-foreground/[0.03] text-foreground">
                  {t.summaryPoints(normalizedSnapshotCount.toLocaleString())}
                </Badge>
                {activeSector && (
                  <Badge variant="secondary" className="bg-primary/15 text-primary">
                    {t.sectorHoldsPressure(activeSector.sector_label, selectedShare)}
                  </Badge>
                )}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
              <SignalMetric
                label={t.primaryFocus}
                value={activeSector?.sector_label ?? t.none}
                subtitle={activeSector ? t.eventsCount(activeSector.total_count.toLocaleString()) : t.selectSector}
              />
              <SignalMetric
                label={t.snapshotFreshness}
                value={activeSector?.computed_at ? formatRelativeTime(activeSector.computed_at) : t.live}
                subtitle={t.latestAggregation}
              />
              <SignalMetric
                label={t.criticalMix}
                value={`${percentOfTotal(criticalEvents, totalEvents)}%`}
                subtitle={t.ofDisplayedEvents}
                accent={severityVar('critical')}
              />
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/70 bg-card/85 shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="text-base">{t.navigatorTitle}</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t.navigatorBody}
                </p>
              </div>
              {activeSector && (
                <div className="rounded-2xl border border-primary/30 bg-primary/10 px-3 py-2 text-end">
                  <p className="text-[11px] font-semibold uppercase tracking-caps-xwide text-primary">{t.selected}</p>
                  <p className="text-sm font-medium text-foreground">{activeSector.sector_label}</p>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <ScrollArea className="w-full whitespace-nowrap">
              <div className="flex gap-3 pb-3">
                {selectorSectors.map((sector) => {
                  const isActive = activeSector?.sector_id === sector.sector_id;
                  return (
                    <Button
                      key={sector.sector_id}
                      variant={isActive ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setSelectedSectorId(sector.sector_id)}
                      className={[
                        'h-auto min-w-[13rem] justify-between rounded-2xl px-4 py-3 text-start',
                        isActive
                          ? 'border-primary bg-primary text-primary-foreground shadow-lg'
                          : 'border-border/80 bg-card/90 hover:border-primary/30 hover:bg-primary/60',
                      ].join(' ')}
                    >
                      <span className="flex flex-col items-start gap-1">
                        <span className="truncate text-sm font-semibold normal-case">{sector.sector_label}</span>
                        <span className={`text-[11px] ${isActive ? 'text-primary-foreground/90' : 'text-muted-foreground'}`}>
                          {t.eventsSuffix(sector.total_count.toLocaleString())}
                        </span>
                      </span>
                      <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${isActive ? 'bg-card/15 text-primary-foreground' : 'bg-foreground/[0.04] text-foreground'}`}>
                        {sector.snapshot_count}x
                      </span>
                    </Button>
                  );
                })}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        <SectorThreatChart
          sectors={normalizedSectors}
          loading={sectorsQuery.isLoading}
          error={undefined}
          onRetry={() => void sectorsQuery.refetch()}
          onSectorClick={setSelectedSectorId}
          selectedSectorId={activeSector?.sector_id}
        />

        {activeSector && (
          <div className="grid gap-4 lg:grid-cols-[1.3fr,0.9fr]">
            <Card className="overflow-hidden border-border/70 bg-card/85 shadow-sm">
              <CardHeader className="border-b border-border/60 bg-foreground/[0.02]">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-2">
                    <Badge variant="outline" className="border-primary/15 bg-card text-foreground">
                      {t.deepDive}
                    </Badge>
                    <CardTitle className="text-2xl tracking-tight">{activeSector.sector_label}</CardTitle>
                    <p className="text-sm text-muted-foreground">
                      {t.latestAggregationRelative(formatRelativeTime(activeSector.computed_at ?? activeSector.period_end))}
                    </p>
                  </div>
                  <div className="rounded-3xl border border-border/70 bg-card/80 px-4 py-3 text-end shadow-sm">
                    <p className="text-[11px] font-semibold uppercase tracking-caps-xwide text-muted-foreground">{t.sectorShare}</p>
                    <p className="mt-1 text-2xl font-semibold text-foreground">{selectedShare}%</p>
                    <p className="text-xs text-muted-foreground">{t.ofDisplayedActivity}</p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-6 p-6 text-sm">
                <div className="grid gap-3 md:grid-cols-4">
                  <MetricPill label={t.metricTotal} value={activeSector.total_count.toLocaleString()} subtitle={t.metricTotalSub} />
                  <MetricPill label={t.metricCritical} value={activeSector.severity_critical_count.toLocaleString()} color={severityVar('critical')} subtitle={t.metricCriticalSub} />
                  <MetricPill label={t.metricHigh} value={activeSector.severity_high_count.toLocaleString()} color={severityVar('high')} subtitle={t.metricHighSub} />
                  <MetricPill label={t.metricMediumLow} value={`${activeSector.severity_medium_count}/${activeSector.severity_low_count}`} subtitle={t.metricMediumLowSub} />
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="rounded-softer border border-border/70 bg-card/70 p-4 shadow-sm">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-caps-xwide text-muted-foreground">{t.topThreatTypes}</p>
                    {threatTypeCounts.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {threatTypeCounts.slice(0, 5).map(([label, count]) => (
                          <Badge key={label} variant="outline" className="border-primary/15 bg-card text-foreground normal-case">
                            {label} · {count}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">{t.noThreatTaxonomy}</p>
                    )}
                  </div>
                  <div className="rounded-softer border border-border/70 bg-card/70 p-4 shadow-sm">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-caps-xwide text-muted-foreground">{t.topOrigins}</p>
                    {topOrigins.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {topOrigins.map(([country, count]) => (
                          <Badge key={country} variant="outline" className="border-primary/15 bg-card text-foreground normal-case">
                            {country === 'Unknown' ? t.unknown : country} ({count})
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">{t.noGeoSignal}</p>
                    )}
                  </div>
                </div>

                <div className="rounded-soft-lg border border-border/70 bg-foreground/[0.02] p-4 shadow-sm">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <p className="text-xs font-semibold uppercase tracking-caps-xwide text-muted-foreground">{t.severityTrend}</p>
                    <span className="text-xs text-muted-foreground">{t.recentEventCadence}</span>
                  </div>
                  <TrendSparkline points={trendPoints.length > 0 ? trendPoints : [0, 0, 0]} />
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-semibold uppercase tracking-caps-xwide text-muted-foreground">{t.recentEvents}</p>
                    <span className="text-xs text-muted-foreground">{t.matchedEvents(selectedEvents.length.toLocaleString())}</span>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    {selectedEvents.slice(0, 6).map((event) => (
                      <div key={event.id} className="rounded-3xl border border-border/70 bg-card/80 p-4 shadow-sm">
                        <div className="flex items-center justify-between gap-3">
                          <Link href={`${ROUTES.CYBER_CTI_EVENTS}/${event.id}`} className="font-medium text-foreground hover:underline">
                            {event.title}
                          </Link>
                          <span className="text-xs text-muted-foreground">{formatRelativeTime(event.first_seen_at)}</span>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">{event.origin_city || t.unknownOrigin} · {event.origin_country_code?.toUpperCase() || '—'}</p>
                      </div>
                    ))}
                    {selectedEvents.length === 0 && (
                      <div className="rounded-3xl border border-dashed border-border/70 bg-card/70 p-4 text-sm text-muted-foreground md:col-span-2">
                        {t.noRecentEvents}
                      </div>
                    )}
                  </div>
                </div>

                {activeSectorCode && (
                  <Button variant="outline" className="w-full justify-between rounded-2xl sm:w-auto" asChild>
                    <Link href={`${ROUTES.CYBER_CTI_EVENTS}?target_sector=${encodeURIComponent(activeSectorCode)}`}>
                      {t.viewAllEventsFor(activeSector.sector_label)}
                    </Link>
                  </Button>
                )}
              </CardContent>
            </Card>

            <div className="space-y-4">
              <Card className="border-border/70 bg-card/85 shadow-sm">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between gap-3">
                    <CardTitle className="text-base">{t.campaignPressure}</CardTitle>
                    <Badge variant="outline" className="border-warning-100 bg-warning-50 text-warning-700 dark:border-warning-500/30 dark:bg-warning-800/40 dark:text-warning-300">
                      {t.linked(selectedCampaigns.length)}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {selectedCampaigns.length > 0 ? selectedCampaigns.slice(0, 5).map((campaign) => (
                    <Link key={campaign.id} href={`${ROUTES.CYBER_CTI_CAMPAIGNS}/${campaign.id}`} className="block rounded-3xl border border-border/70 bg-card/80 p-4 shadow-sm transition hover:border-warning-100 hover:bg-warning-50/40 dark:hover:border-warning-500/30 dark:hover:bg-warning-800/40">
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1">
                          <p className="font-medium text-foreground">{campaign.name}</p>
                          <p className="text-xs text-muted-foreground">{campaign.actor_name || t.unknownActor}</p>
                        </div>
                        <StatusBadge map={severityMap} status={campaign.severity_code} size="sm" />
                      </div>
                      <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                        <span>{campaign.ioc_count.toLocaleString()} IOCs</span>
                        <span>{t.eventsSuffix(campaign.event_count.toLocaleString())}</span>
                      </div>
                    </Link>
                  )) : (
                    <p className="rounded-3xl border border-dashed border-border/70 bg-card/70 px-4 py-5 text-sm text-muted-foreground">
                      {t.noCampaignsTargetSector}
                    </p>
                  )}
                </CardContent>
              </Card>

              <Card className="border-border/70 bg-card/85 shadow-sm">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between gap-3">
                    <CardTitle className="text-base">{t.attributionLane}</CardTitle>
                    <Badge variant="outline" className="border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/30 dark:bg-sky-950/40 dark:text-sky-300">
                      {t.actorsCount(Array.from(new Set(selectedCampaigns.map((campaign) => campaign.actor_name).filter(Boolean))).length)}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {Array.from(new Set(selectedCampaigns.map((campaign) => campaign.actor_name).filter(Boolean))).slice(0, 5).map((actorName) => (
                    <p key={actorName} className="rounded-2xl border border-border/70 bg-card/80 px-4 py-3 text-sm font-medium text-foreground shadow-sm">
                      {actorName}
                    </p>
                  ))}
                  {selectedCampaigns.every((campaign) => !campaign.actor_name) && (
                    <p className="rounded-3xl border border-dashed border-border/70 bg-card/70 px-4 py-5 text-sm text-muted-foreground">
                      {t.noAttributedActors}
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      </div>
    </PermissionRedirect>
  );
}

function MetricPill({
  label,
  value,
  color,
  subtitle,
}: {
  label: string;
  value: string;
  color?: string;
  subtitle?: string;
}) {
  return (
    <div className="rounded-3xl border border-border/70 bg-card/80 px-4 py-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-caps-xwide text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight" style={color ? { color } : undefined}>{value}</p>
      {subtitle && <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>}
    </div>
  );
}

function SignalMetric({
  label,
  value,
  subtitle,
  accent,
}: {
  label: string;
  value: string;
  subtitle: string;
  accent?: string;
}) {
  return (
    <div className="rounded-3xl border bg-card px-4 py-4 shadow-sm">
      <p className="text-[11px] font-semibold uppercase tracking-caps-xwide text-muted-foreground">{label}</p>
      <p className="mt-2 text-lg font-semibold tracking-tight" style={accent ? { color: accent } : undefined}>
        {value}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
    </div>
  );
}
