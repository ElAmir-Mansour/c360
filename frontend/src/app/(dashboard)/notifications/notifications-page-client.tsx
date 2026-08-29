'use client';

import { useState, useCallback, useEffect } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Settings, CheckSquare, Square, Trash2, X, Bell, MailOpen, Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/common/page-header';
import { StatCard } from '@/components/shared/stat-card';
import { NotificationList } from '@/components/notifications/notification-list';
import { NotificationCategoryTabs } from '@/components/notifications/notification-category-tabs';
import { useInfiniteScroll } from '@/hooks/use-infinite-scroll';
import { useNotificationActions } from '@/hooks/use-notification-actions';
import { useNotificationStore } from '@/stores/notification-store';
import { useRealtimeStore } from '@/stores/realtime-store';
import { apiGet } from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import type { Notification, NotificationCounts } from '@/types/models';
import type { PaginatedResponse } from '@/types/api';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { showNewDataToast } from '@/components/realtime/new-data-toast';
import { isNotificationRead } from '@/lib/notification-utils';
import { useNotificationsLabels } from '@/components/notifications/notifications-i18n';

const MAX_PAGES = 5;
const PAGE_SIZE = 20;
const MAX_ITEMS = MAX_PAGES * PAGE_SIZE;

export function NotificationsPageClient() {
  const router = useRouter();
  const pathname = usePathname();
  const currentPath = pathname ?? '/notifications';
  const searchParams = useSearchParams();
  const activeTab = searchParams?.get('tab') ?? 'all';
  const queryClient = useQueryClient();
  const labels = useNotificationsLabels();
  const unreadCount = useNotificationStore((state) => state.unreadCount);
  const { markAsRead, markAllAsRead, deleteNotification, bulkDeleteNotifications } =
    useNotificationActions();
  const [markAllLoading, setMarkAllLoading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [newIds, setNewIds] = useState<string[]>([]);
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const notificationEvent = useRealtimeStore((state) => state.topicEvents['notification.new']);
  const notificationReadEvent = useRealtimeStore((state) => state.topicEvents['notification.read']);

  const fetchFn = useCallback(
    (page: number) => {
      const params: Record<string, unknown> = {
        page,
        per_page: PAGE_SIZE,
        sort: 'created_at',
        order: 'desc',
      };

      if (activeTab === 'unread') {
        params.read = 'false';
      } else if (activeTab !== 'all') {
        params.category = activeTab;
      }

      return apiGet<PaginatedResponse<Notification>>(API_ENDPOINTS.NOTIFICATIONS, params);
    },
    [activeTab],
  );

  const {
    items: notifications,
    isLoading,
    isLoadingMore,
    hasMore,
    limitReached,
    error,
    loadMore,
    sentinelRef,
    updateItems,
  } = useInfiniteScroll<Notification>(fetchFn, { maxPages: MAX_PAGES });

  const { data: fetchedCounts } = useQuery<NotificationCounts>({
    queryKey: ['notification-counts'],
    queryFn: () => apiGet<NotificationCounts>(API_ENDPOINTS.NOTIFICATIONS_COUNTS),
    staleTime: 30_000,
  });

  const counts = {
    all: fetchedCounts?.all ?? 0,
    unread: unreadCount,
    security: fetchedCounts?.security ?? 0,
    workflow: fetchedCounts?.workflow ?? 0,
    data: fetchedCounts?.data ?? 0,
    governance: fetchedCounts?.governance ?? 0,
    legal: fetchedCounts?.legal ?? 0,
    system: fetchedCounts?.system ?? 0,
  };

  const handleTabChange = (tab: string) => {
    const nextParams = new URLSearchParams(searchParams?.toString() ?? '');
    if (tab === 'all') {
      nextParams.delete('tab');
    } else {
      nextParams.set('tab', tab);
    }
    router.push(nextParams.toString() ? `${currentPath}?${nextParams.toString()}` : currentPath);
    // Exit selection mode when switching tabs
    setIsSelecting(false);
    setSelectedIds(new Set());
  };

  const handleMarkAllRead = async () => {
    setMarkAllLoading(true);
    try {
      await markAllAsRead();
      updateItems((items) =>
        items.map((notification) => ({
          ...notification,
          read: true,
          read_at: notification.read_at ?? new Date().toISOString(),
        })),
      );
    } finally {
      setMarkAllLoading(false);
      setConfirmOpen(false);
    }
  };

  const handleMarkRead = async (id: string) => {
    await markAsRead(id);
    updateItems((items) =>
      items.map((notification) =>
        notification.id === id
          ? {
              ...notification,
              read: true,
              read_at: notification.read_at ?? new Date().toISOString(),
            }
          : notification,
      ),
    );
  };

  const handleDelete = async (id: string) => {
    await deleteNotification(id);
    updateItems((items) => items.filter((notification) => notification.id !== id));
    void queryClient.invalidateQueries({ queryKey: ['notification-counts'] });
  };

  const handleToggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    if (selectedIds.size === notifications.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(notifications.map((n) => n.id)));
    }
  }, [notifications, selectedIds.size]);

  const handleExitSelecting = useCallback(() => {
    setIsSelecting(false);
    setSelectedIds(new Set());
  }, []);

  const handleBulkDelete = async () => {
    const ids = Array.from(selectedIds);
    setBulkConfirmOpen(false);
    await bulkDeleteNotifications(ids);
    updateItems((items) => items.filter((n) => !selectedIds.has(n.id)));
    setSelectedIds(new Set());
    setIsSelecting(false);
    void queryClient.invalidateQueries({ queryKey: ['notification-counts'] });
  };

  useEffect(() => {
    if (!notificationEvent?.count) {
      return;
    }

    const notification = normalizeNotification(notificationEvent.payload);
    if (!matchesTab(notification, activeTab)) {
      return;
    }

    updateItems((items) =>
      [notification, ...items.filter((item) => item.id !== notification.id)].slice(0, MAX_ITEMS),
    );
    setNewIds((ids) => [notification.id, ...ids.filter((id) => id !== notification.id)]);
    showNewDataToast({
      title: notification.title,
      description: notification.body,
    });

    const timeout = window.setTimeout(() => {
      setNewIds((ids) => ids.filter((id) => id !== notification.id));
    }, 3000);

    return () => window.clearTimeout(timeout);
  }, [activeTab, notificationEvent, updateItems]);

  useEffect(() => {
    if (!notificationReadEvent?.count) {
      return;
    }

    const payload = notificationReadEvent.payload as { id?: string };
    if (!payload.id) {
      return;
    }

    updateItems((items) =>
      items.map((notification) =>
        notification.id === payload.id
          ? {
              ...notification,
              read: true,
              read_at: notification.read_at ?? new Date().toISOString(),
            }
          : notification,
      ),
    );
  }, [notificationReadEvent, updateItems]);

  const allSelected = notifications.length > 0 && selectedIds.size === notifications.length;

  // Largest non-empty channel feeding the inbox — surfaced as a "top channel"
  // tile so the summary strip reads as real signal rather than a static label.
  const CHANNELS: ReadonlyArray<{ label: string; count: number }> = [
    { label: labels.tabs.security, count: counts.security },
    { label: labels.tabs.workflow, count: counts.workflow },
    { label: labels.tabs.data, count: counts.data },
    { label: labels.tabs.governance, count: counts.governance },
    { label: labels.tabs.legal, count: counts.legal },
    { label: labels.tabs.system, count: counts.system },
  ];
  const topCategory = CHANNELS.filter((entry) => entry.count > 0).sort(
    (a, b) => b.count - a.count,
  )[0];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={labels.page.eyebrow}
        title={labels.page.title}
        description={labels.page.description}
        actions={
          <div className="flex items-center gap-2">
            {!isSelecting ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirmOpen(true)}
                  disabled={markAllLoading || unreadCount === 0}
                >
                  {markAllLoading ? labels.page.marking : labels.page.markAllRead}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsSelecting(true)}
                  disabled={notifications.length === 0}
                >
                  <CheckSquare className="me-1.5 h-3.5 w-3.5" />
                  {labels.page.select}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => router.push('/settings/notifications')}
                  aria-label={labels.page.settings}
                >
                  <Settings className="h-4 w-4" />
                </Button>
              </>
            ) : (
              <>
                <Button variant="ghost" size="sm" onClick={handleSelectAll}>
                  {allSelected ? (
                    <CheckSquare className="me-1.5 h-3.5 w-3.5" />
                  ) : (
                    <Square className="me-1.5 h-3.5 w-3.5" />
                  )}
                  {allSelected ? labels.page.deselectAll : labels.page.selectAll}
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setBulkConfirmOpen(true)}
                  disabled={selectedIds.size === 0}
                >
                  <Trash2 className="me-1.5 h-3.5 w-3.5" />
                  {labels.page.deleteCount(selectedIds.size)}
                </Button>
                <Button variant="ghost" size="sm" onClick={handleExitSelecting}>
                  <X className="h-4 w-4" />
                </Button>
              </>
            )}
          </div>
        }
      />

      {/* Tonal summary strip — counts ride `sky`; the top channel reads as a
          `slate` type/category accent. Value text stays neutral. */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatCard label={labels.page.statUnread} value={unreadCount} tone="sky" icon={MailOpen} />
        <StatCard label={labels.page.statTotal} value={counts.all} tone="sky" icon={Bell} />
        {topCategory && (
          <StatCard
            label={labels.page.topChannel(topCategory.label)}
            value={topCategory.count}
            tone="slate"
            icon={Layers}
            className="col-span-2 lg:col-span-1"
          />
        )}
      </div>

      <NotificationCategoryTabs
        activeTab={activeTab}
        onTabChange={handleTabChange}
        counts={counts}
      />

      <div className="rounded-lg border bg-card">
        <NotificationList
          notifications={notifications}
          isLoading={isLoading}
          isLoadingMore={isLoadingMore}
          hasMore={hasMore}
          limitReached={limitReached}
          error={error?.message ?? null}
          onLoadMore={loadMore}
          onMarkRead={handleMarkRead}
          onDelete={handleDelete}
          onNavigate={(url) => router.push(url)}
          sentinelRef={sentinelRef}
          newIds={newIds}
          category={activeTab}
          isSelecting={isSelecting}
          selectedIds={selectedIds}
          onSelect={handleToggleSelect}
        />
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={labels.page.confirmMarkAllTitle}
        description={labels.page.confirmMarkAllDescription(unreadCount)}
        confirmLabel={labels.page.confirmMarkAllLabel}
        onConfirm={handleMarkAllRead}
        loading={markAllLoading}
      />

      <ConfirmDialog
        open={bulkConfirmOpen}
        onOpenChange={setBulkConfirmOpen}
        title={labels.page.confirmDeleteTitle}
        description={labels.page.confirmDeleteDescription(selectedIds.size)}
        confirmLabel={labels.page.confirmDeleteLabel}
        onConfirm={handleBulkDelete}
      />
    </div>
  );
}

function normalizeNotification(payload: unknown): Notification {
  if (!payload || typeof payload !== 'object') {
    return {
      id: crypto.randomUUID(),
      title: 'New notification',
      body: '',
      category: 'system',
      priority: 'low',
      read: false,
      created_at: new Date().toISOString(),
    };
  }

  const notification = payload as Partial<Notification>;
  return {
    id: notification.id ?? crypto.randomUUID(),
    type: notification.type,
    title: notification.title ?? 'New notification',
    body: notification.body ?? '',
    category: notification.category ?? 'system',
    priority: notification.priority ?? 'low',
    data: notification.data ?? null,
    action_url: notification.action_url ?? null,
    read: notification.read ?? Boolean(notification.read_at),
    read_at: notification.read_at ?? null,
    created_at: notification.created_at ?? new Date().toISOString(),
  };
}

function matchesTab(notification: Notification, tab: string): boolean {
  if (tab === 'all') {
    return true;
  }
  if (tab === 'unread') {
    return !isNotificationRead(notification);
  }
  return notification.category === tab;
}
