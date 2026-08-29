'use client';

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Clock3, Play, RefreshCcw, TriangleAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DetailPanel } from '@/components/shared/detail-panel';
import { RelativeTime } from '@/components/shared/relative-time';
import { apiGet, apiPost } from '@/lib/api';
import {
  getThreatFeedIntervalLabel,
  getThreatFeedTypeLabel,
} from '@/lib/cyber-indicators';
import { API_ENDPOINTS } from '@/lib/constants';
import { parseApiError } from '@/lib/format';
import { formatDateTime } from '@/lib/utils';
import type {
  ThreatFeedConfig,
  ThreatFeedSyncHistory,
  ThreatFeedSyncSummary,
} from '@/types/cyber';
import { useThreatFeedLabels } from '../_lib/threat-feeds-i18n';

interface FeedDetailProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  feed: ThreatFeedConfig | null;
  onEdit?: (feed: ThreatFeedConfig) => void;
  onSynced?: () => void;
}

export function FeedDetail({
  open,
  onOpenChange,
  feed,
  onEdit,
  onSynced,
}: FeedDetailProps) {
  const t = useThreatFeedLabels();
  const d = t.detail;
  const [syncing, setSyncing] = useState(false);
  const queryClient = useQueryClient();

  // Fetch fresh feed data directly from the backend so the detail panel is self-sufficient
  const feedQuery = useQuery({
    queryKey: ['cyber-threat-feed-detail', feed?.id],
    queryFn: () => apiGet<{ data: ThreatFeedConfig }>(API_ENDPOINTS.CYBER_THREAT_FEED_DETAIL(feed!.id)),
    enabled: open && Boolean(feed?.id),
    // Use the parent-supplied feed as initial data to avoid a loading flash
    initialData: feed ? { data: feed } : undefined,
  });

  // Use the freshly fetched feed when available, fall back to the prop
  const liveFeed = feedQuery.data?.data ?? feed;

  const historyQuery = useQuery({
    queryKey: ['cyber-threat-feed-history', feed?.id],
    queryFn: () => apiGet<{ data: ThreatFeedSyncHistory[] }>(API_ENDPOINTS.CYBER_THREAT_FEED_HISTORY(feed!.id)),
    enabled: open && Boolean(feed?.id),
  });

  const latestHistory = historyQuery.data?.data?.[0];
  const previewIndicators = useMemo(() => {
    const metadata = latestHistory?.metadata as Record<string, unknown> | undefined;
    return Array.isArray(metadata?.preview_indicators)
      ? (metadata?.preview_indicators as Array<Record<string, unknown>>)
      : [];
  }, [latestHistory?.metadata]);

  async function handleSync() {
    if (!feed) {
      return;
    }
    try {
      setSyncing(true);
      const response = await apiPost<{ data: ThreatFeedSyncSummary }>(API_ENDPOINTS.CYBER_THREAT_FEED_SYNC(feed.id));
      if (response.data.status === 'failed') {
        toast.error(response.data.error ? `${t.page.unableToSync}: ${response.data.error}` : t.page.unableToSync);
      } else {
        toast.success(d.indicatorsImported(response.data.indicators_imported));
      }
      // Refetch both the feed detail and history immediately so the panel updates
      void queryClient.invalidateQueries({ queryKey: ['cyber-threat-feed-detail', feed.id] });
      void queryClient.invalidateQueries({ queryKey: ['cyber-threat-feed-history', feed.id] });
      void queryClient.invalidateQueries({ queryKey: ['cyber-threat-feed-last-history'] });
      onSynced?.();
    } catch (error) {
      toast.error(parseApiError(error));
    } finally {
      setSyncing(false);
    }
  }

  return (
    <DetailPanel
      open={open}
      onOpenChange={onOpenChange}
      title={liveFeed?.name ?? d.fallbackTitle}
      description={liveFeed ? d.configDescription(getThreatFeedTypeLabel(liveFeed.type)) : d.detailDescription}
      width="xl"
    >
      {!liveFeed ? (
        <p className="text-sm text-muted-foreground">{d.selectFeed}</p>
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-border/70 bg-secondary/70 p-4">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{getThreatFeedTypeLabel(liveFeed.type)}</Badge>
                <Badge variant={liveFeed.enabled ? 'default' : 'secondary'}>
                  {liveFeed.enabled ? d.enabled : d.paused}
                </Badge>
                <Badge variant="outline">{liveFeed.status}</Badge>
              </div>
              <p className="max-w-2xl break-all text-sm text-foreground">{liveFeed.url ?? d.manualFeedNoUrl}</p>
            </div>

            <div className="flex flex-wrap gap-2">
              {onEdit && (
                <Button variant="outline" size="sm" onClick={() => onEdit(liveFeed)}>
                  {d.editFeed}
                </Button>
              )}
              <Button size="sm" onClick={() => void handleSync()} disabled={syncing}>
                <Play className="me-2 h-4 w-4" />
                {syncing ? d.syncing : d.syncNow}
              </Button>
            </div>
          </div>

          <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <InfoCard title={d.configuration}>
              <InfoRow label={d.syncInterval}>{getThreatFeedIntervalLabel(liveFeed.sync_interval)}</InfoRow>
              <InfoRow label={d.defaultSeverity}>{liveFeed.default_severity}</InfoRow>
              <InfoRow label={d.defaultConfidence}>{Math.round(liveFeed.default_confidence * 100)}%</InfoRow>
              <InfoRow label={d.indicatorFilter}>
                {liveFeed.indicator_types.length > 0 ? liveFeed.indicator_types.join(', ') : d.allTypes}
              </InfoRow>
              <InfoRow label={d.tags}>
                {liveFeed.default_tags.length > 0 ? liveFeed.default_tags.join(', ') : d.noDefaults}
              </InfoRow>
            </InfoCard>

            <InfoCard title={d.syncState}>
              <InfoRow label={d.lastSync}>
                {liveFeed.last_sync_at ? <RelativeTime date={liveFeed.last_sync_at} /> : d.never}
              </InfoRow>
              <InfoRow label={d.lastStatus}>{liveFeed.last_sync_status ?? d.notSyncedYet}</InfoRow>
              <InfoRow label={d.nextSync}>
                {liveFeed.next_sync_at ? formatDateTime(liveFeed.next_sync_at) : d.manualOnly}
              </InfoRow>
              <InfoRow label={d.authType}>{liveFeed.auth_type}</InfoRow>
            </InfoCard>
          </section>

          {liveFeed.last_error && (
            <div className="rounded-2xl border border-error-100 bg-error-50 p-4 text-sm text-error-700">
              <div className="mb-2 flex items-center gap-2 font-medium">
                <TriangleAlert className="h-4 w-4" />
                {d.lastSyncError}
              </div>
              <p>{liveFeed.last_error}</p>
            </div>
          )}

          <section className="space-y-3 rounded-2xl border border-border/70 bg-background p-4">
            <div className="flex items-center gap-2">
              <RefreshCcw className="h-4 w-4 text-foreground" />
              <h3 className="text-sm font-semibold text-foreground">{d.importHistory}</h3>
            </div>
            {historyQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">{d.loadingHistory}</p>
            ) : historyQuery.data?.data?.length ? (
              <div className="overflow-x-auto rounded-2xl border border-border/70">
                <table className="min-w-full text-sm">
                  <thead className="bg-secondary">
                    <tr className="border-b border-border/70">
                      <th className="px-4 py-2 text-start font-medium">{d.colStarted}</th>
                      <th className="px-4 py-2 text-start font-medium">{d.colStatus}</th>
                      <th className="px-4 py-2 text-start font-medium">{d.colImported}</th>
                      <th className="px-4 py-2 text-start font-medium">{d.colDuration}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historyQuery.data.data.map((entry) => (
                      <tr key={entry.id} className="border-b border-border/60">
                        <td className="px-4 py-2">{formatDateTime(entry.started_at)}</td>
                        <td className="px-4 py-2">
                          <Badge variant="outline">{entry.status}</Badge>
                        </td>
                        <td className="px-4 py-2">{entry.indicators_imported}</td>
                        <td className="px-4 py-2">{formatDuration(entry.duration_ms)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{d.noExecutions}</p>
            )}
          </section>

          <section className="space-y-3 rounded-2xl border border-border/70 bg-background p-4">
            <div className="flex items-center gap-2">
              <Clock3 className="h-4 w-4 text-foreground" />
              <h3 className="text-sm font-semibold text-foreground">{d.lastImportPreview}</h3>
            </div>
            {previewIndicators.length > 0 ? (
              <div className="overflow-x-auto rounded-2xl border border-border/70">
                <table className="min-w-full text-sm">
                  <thead className="bg-secondary">
                    <tr className="border-b border-border/70">
                      <th className="px-4 py-2 text-start font-medium">{d.colType}</th>
                      <th className="px-4 py-2 text-start font-medium">{d.colValue}</th>
                      <th className="px-4 py-2 text-start font-medium">{d.colSeverity}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewIndicators.map((indicator, index) => (
                      <tr key={`${indicator.id ?? index}`} className="border-b border-border/60">
                        <td className="px-4 py-2">{String(indicator.type ?? '—')}</td>
                        <td className="px-4 py-2 font-mono text-xs">{String(indicator.value ?? '—')}</td>
                        <td className="px-4 py-2">{String(indicator.severity ?? '—')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{d.noPreview}</p>
            )}
          </section>
        </div>
      )}
    </DetailPanel>
  );
}

function InfoCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3 rounded-2xl border border-border/70 bg-background p-4">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <div className="space-y-2 text-sm">{children}</div>
    </div>
  );
}

function InfoRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-end font-medium text-foreground">{children}</span>
    </div>
  );
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) {
    return `${durationMs} ms`;
  }
  return `${(durationMs / 1000).toFixed(1)} s`;
}
