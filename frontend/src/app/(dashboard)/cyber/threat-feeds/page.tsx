'use client';

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle2, Clock, Plus, Rss, RotateCw } from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { StatCard } from '@/components/shared/stat-card';
import { useDataTable } from '@/hooks/use-data-table';
import { apiDelete, apiGet, apiPost } from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { formatRelativeTime, parseApiError } from '@/lib/format';
import type { PaginatedResponse } from '@/types/api';
import type { FetchParams } from '@/types/table';
import type { ThreatFeedConfig, ThreatFeedSyncSummary } from '@/types/cyber';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';

import { AddFeedDialog } from './_components/add-feed-dialog';
import { FeedDetail } from './_components/feed-detail';
import { FeedList } from './_components/feed-list';
import { useThreatFeedLabels } from './_lib/threat-feeds-i18n';

async function fetchThreatFeeds(params: FetchParams): Promise<PaginatedResponse<ThreatFeedConfig>> {
  return apiGet<PaginatedResponse<ThreatFeedConfig>>(API_ENDPOINTS.CYBER_THREAT_FEEDS, {
    page: params.page,
    per_page: params.per_page,
    search: params.search || undefined,
    sort: params.sort || undefined,
    order: params.order || undefined,
  });
}

export default function CyberThreatFeedsPage() {
  const t = useThreatFeedLabels();
  const [selectedFeed, setSelectedFeed] = useState<ThreatFeedConfig | null>(null);
  const [editorFeed, setEditorFeed] = useState<ThreatFeedConfig | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [syncingFeedId, setSyncingFeedId] = useState<string | null>(null);
  const [deletingFeed, setDeletingFeed] = useState<ThreatFeedConfig | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const queryClient = useQueryClient();

  const { tableProps, refetch } = useDataTable<ThreatFeedConfig>({
    fetchFn: fetchThreatFeeds,
    queryKey: 'cyber-threat-feeds',
    defaultPageSize: 20,
    defaultSort: { column: 'updated_at', direction: 'desc' },
  });

  const feeds = tableProps.data;
  const activeFeeds = feeds.filter((f) => f.status === 'active').length;
  const lastSyncAt = feeds
    .map((f) => f.last_sync_at)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);

  // Keep selectedFeed in sync with fresh list data after refetch
  useEffect(() => {
    if (!selectedFeed) return;
    const fresh = tableProps.data.find((f) => f.id === selectedFeed.id);
    if (fresh && fresh.updated_at !== selectedFeed.updated_at) {
      setSelectedFeed(fresh);
    }
  }, [tableProps.data, selectedFeed]);

  async function handleSync(feed: ThreatFeedConfig) {
    try {
      setSyncingFeedId(feed.id);
      const response = await apiPost<{ data: ThreatFeedSyncSummary }>(API_ENDPOINTS.CYBER_THREAT_FEED_SYNC(feed.id));
      if (response.data.status === 'failed') {
        toast.error(response.data.error ? `${t.page.unableToSync}: ${response.data.error}` : t.page.unableToSync);
      } else {
        toast.success(t.page.indicatorsImported(response.data.indicators_imported, feed.name));
      }
      // Invalidate history queries so the "Imported" column and detail panel refresh
      void queryClient.invalidateQueries({ queryKey: ['cyber-threat-feed-last-history'] });
      void queryClient.invalidateQueries({ queryKey: ['cyber-threat-feed-history'] });
      await refetch();
    } catch (error) {
      toast.error(parseApiError(error));
    } finally {
      setSyncingFeedId(null);
    }
  }

  async function handleDelete() {
    if (!deletingFeed) return;
    try {
      setDeleteLoading(true);
      await apiDelete(`${API_ENDPOINTS.CYBER_THREAT_FEEDS}/${deletingFeed.id}`);
      toast.success(t.page.feedDeleted(deletingFeed.name));
      if (selectedFeed?.id === deletingFeed.id) {
        setSelectedFeed(null);
      }
      setDeletingFeed(null);
      await refetch();
    } catch (error) {
      toast.error(parseApiError(error));
    } finally {
      setDeleteLoading(false);
    }
  }

  return (
    <PermissionRedirect permission="cyber:manage">
      <div className="space-y-6">
        <PageHeader
          title={t.page.title}
          description={t.page.description}
          actions={(
            <div className="flex flex-wrap items-center gap-2">
              {syncingFeedId && (
                <Button variant="outline" disabled>
                  <RotateCw className="me-2 h-4 w-4 animate-spin" />
                  {t.page.syncing}
                </Button>
              )}
              <Button
                onClick={() => {
                  setEditorFeed(null);
                  setEditorOpen(true);
                }}
              >
                <Plus className="me-2 h-4 w-4" />
                {t.page.addFeed}
              </Button>
            </div>
          )}
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard label={t.page.statActiveFeeds} value={activeFeeds} tone="sky" icon={CheckCircle2} />
          <StatCard label={t.page.statConfiguredFeeds} value={feeds.length} tone="sky" icon={Rss} />
          <StatCard
            label={t.page.statLastSync}
            value={lastSyncAt ? formatRelativeTime(lastSyncAt) : t.page.never}
            tone="gold"
            icon={Clock}
          />
        </div>

        <div className="rounded-soft-lg surface-card p-2">
          <FeedList
            tableProps={tableProps}
            onSelect={setSelectedFeed}
            onEdit={(feed) => {
              setEditorFeed(feed);
              setEditorOpen(true);
            }}
            onSync={(feed) => void handleSync(feed)}
            onDelete={setDeletingFeed}
          />
        </div>
      </div>

      <AddFeedDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        feed={editorFeed}
        onSuccess={(feed) => {
          setSelectedFeed(feed);
          void refetch();
        }}
      />

      <FeedDetail
        open={Boolean(selectedFeed)}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedFeed(null);
          }
        }}
        feed={selectedFeed}
        onEdit={(feed) => {
          setEditorFeed(feed);
          setEditorOpen(true);
        }}
        onSynced={() => {
          void queryClient.invalidateQueries({ queryKey: ['cyber-threat-feed-last-history'] });
          void queryClient.invalidateQueries({ queryKey: ['cyber-threat-feed-history'] });
          void refetch();
        }}
      />

      <ConfirmDialog
        open={Boolean(deletingFeed)}
        onOpenChange={(open) => { if (!open) setDeletingFeed(null); }}
        title={t.page.deleteTitle}
        description={t.page.deleteDescription(deletingFeed?.name ?? '')}
        confirmLabel={deleteLoading ? t.page.deleting : t.page.delete}
        variant="destructive"
        loading={deleteLoading}
        onConfirm={() => void handleDelete()}
      />
    </PermissionRedirect>
  );
}
