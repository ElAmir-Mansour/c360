'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { QueryKey } from '@tanstack/react-query';
import { ArrowLeft, ChevronDown, Link2, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/common/page-header';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { PermissionGate } from '@/components/auth/permission-gate';
import { CampaignFormDialog } from '@/components/cyber/cti/campaign-form-dialog';
import { CTIKPIStatCard } from '@/components/cyber/cti/kpi-stat-card';
import { StatusBadge, severityMap } from '@/components/shared/status-badge';
import { CTIStatusBadge } from '@/components/cyber/cti/status-badge';
import { EntityLinkDialog } from '@/components/cyber/cti/entity-link-dialog';
import { IOCValueDisplay } from '@/components/cyber/cti/ioc-value-display';
import { MitreTechniqueBadges } from '@/components/cyber/cti/mitre-technique-badges';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  createCampaignIOC,
  deleteCampaign,
  deleteCampaignIOC,
  fetchCampaign,
  fetchCampaignEvents,
  fetchCampaignIOCs,
  fetchRegions,
  fetchSectors,
  fetchThreatEvents,
  flattenThreatEventFetchParams,
  linkEventToCampaign,
  unlinkEventFromCampaign,
  updateCampaignStatus,
} from '@/lib/cti-api';
import { ROUTES } from '@/lib/constants';
import { CTI_CAMPAIGN_STATUS_OPTIONS, formatConfidenceScore, formatRelativeTime } from '@/lib/cti-utils';
import { formatDateTime, timeAgo } from '@/lib/utils';
import { CTI_EVENT_TYPE_LABELS, type CTICampaign, type CTICampaignIOC, type CTIThreatEvent } from '@/types/cti';
import type { FetchParams } from '@/types/table';
import type { PaginatedResponse } from '@/types/api';
import { useCtiLabels } from '../../_lib/cti-i18n';

type CampaignDetailLabels = ReturnType<typeof useCtiLabels>['campaignDetail'];

function paginateLabel(page: number, perPage: number, total: number, t: CampaignDetailLabels): string {
  if (total === 0) {
    return t.results0;
  }
  const start = (page - 1) * perPage + 1;
  const end = Math.min(start + perPage - 1, total);
  return t.rangeOf(start, end, total.toLocaleString());
}

function buildTimeline(
  campaign: CTICampaign,
  linkedEvents: CTIThreatEvent[],
  campaignIOCs: CTICampaignIOC[],
  t: CampaignDetailLabels,
): Array<{ id: string; timestamp: string; label: string; description: string }> {
  const items = [
    {
      id: 'created',
      timestamp: campaign.created_at,
      label: t.timelineCampaignCreated,
      description: t.timelineCampaignCreatedDesc(campaign.name),
    },
    {
      id: 'first-seen',
      timestamp: campaign.first_seen_at,
      label: t.timelineFirstSeen,
      description: t.timelineFirstSeenDesc,
    },
    ...(campaign.last_seen_at
      ? [{
          id: 'last-seen',
          timestamp: campaign.last_seen_at,
          label: t.timelineLastActivity,
          description: t.timelineLastActivityDesc,
        }]
      : []),
    ...campaignIOCs
      .filter((ioc) => Boolean(ioc.created_at))
      .map((ioc) => ({
        id: `ioc-${ioc.id}`,
        timestamp: ioc.created_at ?? ioc.first_seen_at,
        label: t.timelineIocAdded,
        description: `${ioc.ioc_type.toUpperCase()} ${ioc.ioc_value}`,
      })),
    ...linkedEvents.map((event) => ({
      id: `event-${event.id}`,
      timestamp: event.created_at ?? event.first_seen_at,
      label: t.timelineEventLinked,
      description: event.title,
    })),
    ...(campaign.resolved_at
      ? [{
          id: 'resolved',
          timestamp: campaign.resolved_at,
          label: t.timelineResolved,
          description: t.timelineResolvedDesc,
        }]
      : []),
  ];

  return items.sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp));
}

export default function CTICampaignDetailPage() {
  const params = useParams<{ id: string }>();
  const campaignId = params?.id ?? '';
  const router = useRouter();
  const queryClient = useQueryClient();
  const { campaignDetail: t } = useCtiLabels();
  const [activeTab, setActiveTab] = useState('overview');
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [iocDialogOpen, setIocDialogOpen] = useState(false);
  const [eventsPage, setEventsPage] = useState(1);
  const [iocsPage, setIocsPage] = useState(1);
  const eventsPerPage = 10;
  const iocsPerPage = 10;

  const campaignQuery = useQuery({
    queryKey: ['cti-campaign', campaignId],
    queryFn: () => fetchCampaign(campaignId),
    enabled: Boolean(campaignId),
  });
  const eventsQuery = useQuery({
    queryKey: ['cti-campaign-events', campaignId, eventsPage],
    queryFn: () => fetchCampaignEvents(campaignId, eventsPage, eventsPerPage),
    enabled: Boolean(campaignId),
  });
  const iocsQuery = useQuery({
    queryKey: ['cti-campaign-iocs', campaignId, iocsPage],
    queryFn: () => fetchCampaignIOCs(campaignId, iocsPage, iocsPerPage),
    enabled: Boolean(campaignId),
  });
  const sectorsQuery = useQuery({
    queryKey: ['cti-campaign-detail-sectors'],
    queryFn: fetchSectors,
  });
  const regionsQuery = useQuery({
    queryKey: ['cti-campaign-detail-regions'],
    queryFn: () => fetchRegions(),
  });

  const campaign = campaignQuery.data;
  const linkedEvents = useMemo(() => eventsQuery.data?.data ?? [], [eventsQuery.data]);
  const campaignIOCs = useMemo(() => iocsQuery.data?.data ?? [], [iocsQuery.data]);

  const sectorLabels = useMemo(() => {
    const labels = new Map((sectorsQuery.data ?? []).map((sector) => [sector.id, sector.label]));
    return (campaign?.target_sectors ?? []).map((sectorId) => labels.get(sectorId) ?? sectorId);
  }, [campaign?.target_sectors, sectorsQuery.data]);

  const regionLabels = useMemo(() => {
    const labels = new Map((regionsQuery.data ?? []).map((region) => [region.id, region.label]));
    return (campaign?.target_regions ?? []).map((regionId) => labels.get(regionId) ?? regionId);
  }, [campaign?.target_regions, regionsQuery.data]);

  const timelineItems = useMemo(
    () => (campaign ? buildTimeline(campaign, linkedEvents, campaignIOCs, t) : []),
    [campaign, linkedEvents, campaignIOCs, t],
  );

  const syncCampaignInCaches = (campaignUpdater: (current: CTICampaign) => CTICampaign) => {
    const detailKey: QueryKey = ['cti-campaign', campaignId];
    const detailSnapshot = queryClient.getQueryData(detailKey);
    const listSnapshots = queryClient.getQueriesData({ queryKey: ['cti-campaigns'] });

    queryClient.setQueryData<CTICampaign | undefined>(detailKey, (current) => (
      current ? campaignUpdater(current) : current
    ));
    queryClient.setQueriesData<PaginatedResponse<CTICampaign>>(
      { queryKey: ['cti-campaigns'] },
      (current) => {
        if (!current) {
          return current;
        }
        return {
          ...current,
          data: (current.data ?? []).map((entry) => (
            entry.id === campaignId ? campaignUpdater(entry) : entry
          )),
        };
      },
    );

    return { detailKey, detailSnapshot, listSnapshots };
  };

  const restoreCampaignCaches = (context?: {
    detailKey: QueryKey;
    detailSnapshot: unknown;
    listSnapshots: Array<[readonly unknown[], unknown]>;
  }) => {
    if (!context) {
      return;
    }

    queryClient.setQueryData(context.detailKey, context.detailSnapshot);
    context.listSnapshots.forEach(([key, value]) => queryClient.setQueryData(key, value));
  };

  const statusMutation = useMutation({
    mutationFn: async (status: CTICampaign['status']) => updateCampaignStatus(campaignId, status),
    onMutate: async (status) => {
      if (!campaign) {
        return undefined;
      }

      return syncCampaignInCaches((current) => ({
        ...current,
        status,
        resolved_at: status === 'resolved' ? current.resolved_at ?? new Date().toISOString() : current.resolved_at,
      }));
    },
    onError: (_error, _status, context) => {
      restoreCampaignCaches(context);
      toast.error(t.statusUpdateFailed);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['cti-campaign', campaignId] }),
        queryClient.invalidateQueries({ queryKey: ['cti-campaigns'] }),
      ]);
      toast.success(t.statusUpdated);
    },
  });

  const unlinkMutation = useMutation({
    mutationFn: async (eventId: string) => unlinkEventFromCampaign(campaignId, eventId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['cti-campaign-events', campaignId] }),
        queryClient.invalidateQueries({ queryKey: ['cti-campaign', campaignId] }),
      ]);
      toast.success(t.eventUnlinked);
    },
    onError: () => toast.error(t.eventUnlinkFailed),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => deleteCampaign(campaignId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['cti-campaigns'] });
      toast.success(t.campaignDeleted);
      router.push(ROUTES.CYBER_CTI_CAMPAIGNS);
    },
    onError: () => toast.error(t.campaignDeleteFailed),
  });

  const deleteIocMutation = useMutation({
    mutationFn: async (iocId: string) => deleteCampaignIOC(campaignId, iocId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['cti-campaign-iocs', campaignId] }),
        queryClient.invalidateQueries({ queryKey: ['cti-campaign', campaignId] }),
      ]);
      toast.success(t.iocRemoved);
    },
    onError: () => toast.error(t.iocRemoveFailed),
  });

  if (campaignQuery.isLoading) {
    return (
      <PermissionRedirect permission="cyber:read">
        <LoadingSkeleton variant="card" count={2} />
      </PermissionRedirect>
    );
  }

  if (!campaign || campaignQuery.error) {
    return (
      <PermissionRedirect permission="cyber:read">
        <ErrorState message={t.loadFailed} onRetry={() => void campaignQuery.refetch()} />
      </PermissionRedirect>
    );
  }

  return (
    <PermissionRedirect permission="cyber:read">
      <div className="space-y-6">
        <PageHeader
          title={(
            <div className="flex items-center gap-3">
              <button
                onClick={() => router.push(ROUTES.CYBER_CTI_CAMPAIGNS)}
                className="flex h-8 w-8 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm transition-colors hover:bg-accent"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
              <span className="truncate">{campaign.name}</span>
            </div>
          )}
          description={(
            <div className="flex flex-wrap items-center gap-3 ps-11">
              <CTIStatusBadge status={campaign.status} type="campaign" />
              <StatusBadge map={severityMap} status={campaign.severity_code} />
              <span className="rounded-full border px-3 py-1 text-xs font-medium text-muted-foreground">
                {campaign.campaign_code}
              </span>
              {campaign.primary_actor_id && campaign.actor_name && (
                <Link className="text-sm font-medium text-primary hover:underline" href={`${ROUTES.CYBER_CTI_ACTORS}/${campaign.primary_actor_id}`}>
                  {campaign.actor_name}
                </Link>
              )}
            </div>
          )}
          actions={(
            <div className="flex flex-wrap items-center gap-2">
              <PermissionGate permission="cyber:write">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm">
                      {t.updateStatus}
                      <ChevronDown className="ms-1.5 h-3.5 w-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {CTI_CAMPAIGN_STATUS_OPTIONS.filter((option) => option.value !== campaign.status).map((option) => (
                      <DropdownMenuItem key={option.value} onClick={() => statusMutation.mutate(option.value)}>
                        {t.moveTo(option.label)}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button variant="outline" size="sm" onClick={() => setLinkOpen(true)}>
                  <Link2 className="me-1.5 h-3.5 w-3.5" />
                  {t.linkEvent}
                </Button>
                <Button variant="outline" size="sm" onClick={() => setIocDialogOpen(true)}>
                  <Plus className="me-1.5 h-3.5 w-3.5" />
                  {t.addIoc}
                </Button>
                <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
                  <Pencil className="me-1.5 h-3.5 w-3.5" />
                  {t.edit}
                </Button>
                <Button variant="outline" size="sm" className="text-destructive" onClick={() => setDeleteOpen(true)}>
                  <Trash2 className="me-1.5 h-3.5 w-3.5" />
                  {t.delete}
                </Button>
              </PermissionGate>
            </div>
          )}
        />

        <div className="grid gap-4 md:grid-cols-3">
          <CTIKPIStatCard label={t.kpiIocCount} value={campaign.ioc_count} subtitle={t.kpiIocCountSub} tone="sky" />
          <CTIKPIStatCard label={t.kpiEventCount} value={campaign.event_count} subtitle={t.kpiEventCountSub} tone="sky" />
          <CTIKPIStatCard
            label={t.kpiDuration}
            value={campaign.last_seen_at ? Math.max(Math.round((Date.parse(campaign.last_seen_at) - Date.parse(campaign.first_seen_at)) / 86_400_000), 1) : 1}
            subtitle={t.kpiDurationSub}
            tone="gold"
          />
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="w-full justify-start overflow-x-auto">
            <TabsTrigger value="overview">{t.tabOverview}</TabsTrigger>
            <TabsTrigger value="iocs">{t.tabIocs(campaign.ioc_count)}</TabsTrigger>
            <TabsTrigger value="events">{t.tabEvents(campaign.event_count)}</TabsTrigger>
            <TabsTrigger value="timeline">{t.tabTimeline}</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-[1.4fr,0.9fr]">
              <Card>
                <CardHeader>
                  <CardTitle>{t.campaignOverview}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 text-sm">
                  <DetailRow label={t.firstSeen} value={formatDateTime(campaign.first_seen_at)} />
                  <DetailRow label={t.lastSeen} value={formatDateTime(campaign.last_seen_at)} />
                  <DetailRow label={t.status} value={campaign.status} />
                  <DetailRow label={t.severity} value={campaign.severity_label} />
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-caps-xwide text-muted-foreground">
                      {t.description}
                    </p>
                    <p className="rounded-2xl border bg-muted/20 p-4 text-muted-foreground">
                      {campaign.description || t.noDescription}
                    </p>
                  </div>
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-caps-xwide text-muted-foreground">
                      {t.targetingNotes}
                    </p>
                    <p className="rounded-2xl border bg-muted/20 p-4 text-muted-foreground">
                      {campaign.target_description || t.noTargeting}
                    </p>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>{t.threatActor}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 text-sm">
                  {campaign.primary_actor_id && campaign.actor_name ? (
                    <div className="rounded-2xl border bg-muted/10 p-4">
                      <p className="text-lg font-semibold text-foreground">{campaign.actor_name}</p>
                      <p className="text-sm text-muted-foreground">{t.primaryActorNarrative}</p>
                      <Button variant="link" className="mt-2 h-auto p-0" asChild>
                        <Link href={`${ROUTES.CYBER_CTI_ACTORS}/${campaign.primary_actor_id}`}>{t.viewActorProfile}</Link>
                      </Button>
                    </div>
                  ) : (
                    <EmptyMessage message={t.noPrimaryActor} compact />
                  )}

                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-caps-xwide text-muted-foreground">
                      {t.targetSectors}
                    </p>
                    {sectorLabels.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {sectorLabels.map((label) => (
                          <span key={label} className="rounded-full border px-3 py-1 text-sm text-muted-foreground">{label}</span>
                        ))}
                      </div>
                    ) : (
                      <EmptyMessage message={t.noTargetSectors} compact />
                    )}
                  </div>

                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-caps-xwide text-muted-foreground">
                      {t.targetRegions}
                    </p>
                    {regionLabels.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {regionLabels.map((label) => (
                          <span key={label} className="rounded-full border px-3 py-1 text-sm text-muted-foreground">{label}</span>
                        ))}
                      </div>
                    ) : (
                      <EmptyMessage message={t.noTargetRegions} compact />
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>{t.ttpCoverage}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <MitreTechniqueBadges techniqueIds={campaign.mitre_technique_ids} maxVisible={10} />
                <p className="rounded-2xl border bg-muted/20 p-4 text-muted-foreground">
                  {campaign.ttps_summary || t.noTtpSummary}
                </p>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="iocs" className="space-y-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>{t.campaignIndicators}</CardTitle>
                <PermissionGate permission="cyber:write">
                  <Button size="sm" variant="outline" onClick={() => setIocDialogOpen(true)}>
                    <Plus className="me-1.5 h-3.5 w-3.5" />
                    {t.addIoc}
                  </Button>
                </PermissionGate>
              </CardHeader>
              <CardContent className="space-y-3">
                {campaignIOCs.length ? (
                  campaignIOCs.map((ioc) => (
                    <CampaignIOCRow
                      key={ioc.id}
                      ioc={ioc}
                      onDelete={() => deleteIocMutation.mutate(ioc.id)}
                      labels={t}
                    />
                  ))
                ) : (
                  <EmptyMessage message={t.noCampaignIocs} />
                )}
                <PaginationBar
                  page={iocsPage}
                  perPage={iocsPerPage}
                  total={iocsQuery.data?.meta.total ?? 0}
                  onPrevious={() => setIocsPage((current) => Math.max(current - 1, 1))}
                  onNext={() => setIocsPage((current) => current + 1)}
                  labels={t}
                />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="events" className="space-y-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>{t.linkedThreatEvents}</CardTitle>
                <PermissionGate permission="cyber:write">
                  <Button size="sm" variant="outline" onClick={() => setLinkOpen(true)}>
                    <Link2 className="me-1.5 h-3.5 w-3.5" />
                    {t.linkEvent}
                  </Button>
                </PermissionGate>
              </CardHeader>
              <CardContent className="space-y-3">
                {linkedEvents.length ? (
                  linkedEvents.map((event) => (
                    <div key={event.id} className="grid gap-3 rounded-2xl border bg-background p-4 lg:grid-cols-[1.3fr,0.8fr,0.8fr,auto] lg:items-center">
                      <div className="space-y-1">
                        <Link href={`${ROUTES.CYBER_CTI_EVENTS}/${event.id}`} className="font-medium text-foreground hover:underline">
                          {event.title}
                        </Link>
                        <p className="text-sm text-muted-foreground">{event.ioc_value || event.target_org_name || t.noEventMetadata}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <StatusBadge map={severityMap} status={event.severity_code} size="sm" />
                        <span className="text-sm text-muted-foreground">{CTI_EVENT_TYPE_LABELS[event.event_type] ?? event.event_type}</span>
                      </div>
                      <span className="text-sm text-muted-foreground">{formatRelativeTime(event.first_seen_at)}</span>
                      <PermissionGate permission="cyber:write">
                        <Button variant="outline" size="sm" onClick={() => unlinkMutation.mutate(event.id)}>
                          {t.unlink}
                        </Button>
                      </PermissionGate>
                    </div>
                  ))
                ) : (
                  <EmptyMessage message={t.noEventsLinked} />
                )}
                <PaginationBar
                  page={eventsPage}
                  perPage={eventsPerPage}
                  total={eventsQuery.data?.meta.total ?? 0}
                  onPrevious={() => setEventsPage((current) => Math.max(current - 1, 1))}
                  onNext={() => setEventsPage((current) => current + 1)}
                  labels={t}
                />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="timeline" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>{t.campaignTimeline}</CardTitle>
              </CardHeader>
              <CardContent>
                {timelineItems.length > 0 ? (
                  <div className="space-y-4">
                    {timelineItems.map((item) => (
                      <div key={item.id} className="flex gap-4">
                        <div className="mt-1 h-2.5 w-2.5 rounded-full bg-primary" />
                        <div className="space-y-1">
                          <p className="font-medium text-foreground">{item.label}</p>
                          <p className="text-xs text-muted-foreground">{item.description}</p>
                          <p className="text-xs text-muted-foreground">{formatDateTime(item.timestamp)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyMessage message={t.noTimeline} />
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      <CampaignFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        campaign={campaign}
        onSuccess={() => void campaignQuery.refetch()}
      />

      <EntityLinkDialog
        title={t.linkDialogTitle}
        description={t.linkDialogDescription}
        searchPlaceholder={t.linkSearchPlaceholder}
        searchFn={async (search) => {
          const params: FetchParams = {
            page: 1,
            per_page: 25,
            sort: 'first_seen_at',
            order: 'desc',
            search: search || undefined,
          };
          const response = await fetchThreatEvents(flattenThreatEventFetchParams(params));
          return (response.data ?? []).filter((event) => !linkedEvents.some((linked) => linked.id === event.id));
        }}
        renderItem={(event) => (
          <div className="grid gap-3 lg:grid-cols-[1.3fr,0.8fr,0.7fr] lg:items-center">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <StatusBadge map={severityMap} status={event.severity_code} size="sm" />
                <p className="truncate text-sm font-medium text-foreground">{event.title}</p>
              </div>
              <p className="truncate text-xs text-muted-foreground">
                {event.ioc_value || event.target_org_name || event.origin_country_code || t.noEventMetadata}
              </p>
            </div>
            <span className="text-sm text-muted-foreground">
              {CTI_EVENT_TYPE_LABELS[event.event_type] ?? event.event_type}
            </span>
            <span className="text-sm text-muted-foreground">{timeAgo(event.first_seen_at)}</span>
          </div>
        )}
        onSelect={async (event) => {
          await linkEventToCampaign(campaignId, event.id);
          await queryClient.invalidateQueries({ queryKey: ['cti-campaign-events', campaignId] });
          await queryClient.invalidateQueries({ queryKey: ['cti-campaign', campaignId] });
          toast.success(t.eventLinked);
          setLinkOpen(false);
          await eventsQuery.refetch();
        }}
        getKey={(event) => event.id}
        isOpen={linkOpen}
        onClose={() => setLinkOpen(false)}
      />

      <AddCampaignIOCDialog
        open={iocDialogOpen}
        onOpenChange={setIocDialogOpen}
        campaignId={campaignId}
        onSuccess={() => void iocsQuery.refetch()}
        labels={t}
      />

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t.deleteTitle}
        description={t.deleteDescription}
        confirmLabel={t.deleteConfirm}
        variant="destructive"
        typeToConfirm={campaign.name}
        loading={deleteMutation.isPending}
        onConfirm={async () => {
          await deleteMutation.mutateAsync();
        }}
      />
    </PermissionRedirect>
  );
}

function CampaignIOCRow({
  ioc,
  onDelete,
  labels,
}: {
  ioc: CTICampaignIOC;
  onDelete: () => void;
  labels: CampaignDetailLabels;
}) {
  return (
    <div className="grid gap-3 rounded-2xl border bg-background p-4 lg:grid-cols-[1.4fr,0.8fr,0.8fr,auto] lg:items-center">
      <IOCValueDisplay type={ioc.ioc_type} value={ioc.ioc_value} className="border-0 bg-transparent p-0" />
      <span className="text-sm text-muted-foreground">{labels.confidence(formatConfidenceScore(ioc.confidence_score))}</span>
      <span className="text-sm text-muted-foreground">{labels.lastSeenRelative(timeAgo(ioc.last_seen_at))}</span>
      <PermissionGate permission="cyber:write">
        <Button variant="outline" size="sm" onClick={onDelete}>{labels.remove}</Button>
      </PermissionGate>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-end font-medium text-foreground">{value || '—'}</span>
    </div>
  );
}

function EmptyMessage({ message, compact = false }: { message: string; compact?: boolean }) {
  return (
    <div className={compact ? 'text-sm text-muted-foreground' : 'rounded-2xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground'}>
      {message}
    </div>
  );
}

function PaginationBar({
  page,
  perPage,
  total,
  onPrevious,
  onNext,
  labels,
}: {
  page: number;
  perPage: number;
  total: number;
  onPrevious: () => void;
  onNext: () => void;
  labels: CampaignDetailLabels;
}) {
  const totalPages = Math.max(Math.ceil(total / perPage), 1);

  return (
    <div className="flex items-center justify-between gap-3 border-t pt-3 text-sm text-muted-foreground">
      <span>{paginateLabel(page, perPage, total, labels)}</span>
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onPrevious} disabled={page <= 1}>
          {labels.previous}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onNext} disabled={page >= totalPages}>
          {labels.next}
        </Button>
      </div>
    </div>
  );
}

function AddCampaignIOCDialog({
  open,
  onOpenChange,
  campaignId,
  onSuccess,
  labels,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaignId: string;
  onSuccess?: () => void;
  labels: CampaignDetailLabels;
}) {
  const queryClient = useQueryClient();
  const [iocType, setIocType] = useState('domain');
  const [iocValue, setIocValue] = useState('');
  const [confidence, setConfidence] = useState('80');
  const [sourceName, setSourceName] = useState('');

  const mutation = useMutation({
    mutationFn: async () => createCampaignIOC(campaignId, {
      ioc_type: iocType,
      ioc_value: iocValue.trim(),
      confidence_score: Number(confidence) / 100,
      source_name: sourceName.trim() || undefined,
    }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['cti-campaign-iocs', campaignId] }),
        queryClient.invalidateQueries({ queryKey: ['cti-campaign', campaignId] }),
      ]);
      toast.success(labels.iocAdded);
      setIocType('domain');
      setIocValue('');
      setConfidence('80');
      setSourceName('');
      onOpenChange(false);
      onSuccess?.();
    },
    onError: () => toast.error(labels.iocAddFailed),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{labels.addCampaignIocTitle}</DialogTitle>
          <DialogDescription>
            {labels.addCampaignIocDescription}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="ioc_type" className="text-sm font-medium">{labels.iocType}</label>
              <Input id="ioc_type" value={iocType} onChange={(event) => setIocType(event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="confidence" className="text-sm font-medium">{labels.confidencePct}</label>
              <Input id="confidence" type="number" min={0} max={100} value={confidence} onChange={(event) => setConfidence(event.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="ioc_value" className="text-sm font-medium">{labels.iocValue}</label>
            <Input id="ioc_value" value={iocValue} onChange={(event) => setIocValue(event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="source_name" className="text-sm font-medium">{labels.sourceName}</label>
            <Input id="source_name" value={sourceName} onChange={(event) => setSourceName(event.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {labels.cancel}
          </Button>
          <Button type="button" disabled={mutation.isPending || !iocValue.trim()} onClick={() => mutation.mutate()}>
            {mutation.isPending ? labels.savingDots : labels.addIocBtn}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
