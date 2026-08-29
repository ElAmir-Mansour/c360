'use client';

import { useQueryClient } from '@tanstack/react-query';
import { apiPut, apiPost, apiDelete } from '@/lib/api';
import { useNotificationStore } from '@/stores/notification-store';
import { showApiError, showSuccess } from '@/lib/toast';
import { API_ENDPOINTS } from '@/lib/constants';
import { useNotificationsLabels } from '@/components/notifications/notifications-i18n';
import type { Notification } from '@/types/models';
import type { PaginatedResponse } from '@/types/api';
import { isNotificationRead } from '@/lib/notification-utils';

const NOTIFICATIONS_KEY = '/api/v1/notifications';

export function useNotificationActions() {
  const queryClient = useQueryClient();
  const labels = useNotificationsLabels();
  const {
    markAsRead: storeMarkAsRead,
    markAllAsRead: storeMarkAllAsRead,
    deleteNotification: storeDeleteNotification,
  } = useNotificationStore();

  const markAsRead = async (id: string): Promise<void> => {
    let alreadyRead = false;
    // Optimistic update: update cache immediately
    queryClient.setQueriesData<PaginatedResponse<Notification>>(
      { queryKey: [NOTIFICATIONS_KEY], exact: false },
      (old) => {
        if (!old) return old;
        alreadyRead = old.data.some((notification) => notification.id === id && isNotificationRead(notification));
        return {
          ...old,
          data: old.data.map((n) =>
            n.id === id
              ? { ...n, read: true, read_at: n.read_at ?? new Date().toISOString() }
              : n,
          ),
        };
      },
    );
    if (!alreadyRead) {
      storeMarkAsRead(id);
    }

    try {
      await apiPut(`/api/v1/notifications/${id}/read`);
    } catch {
      // Revert on error
      queryClient.invalidateQueries({ queryKey: [NOTIFICATIONS_KEY] });
      showApiError(new Error(labels.toasts.markReadFailed));
    }
  };

  const markAllAsRead = async (): Promise<void> => {
    try {
      await apiPut(API_ENDPOINTS.NOTIFICATIONS_READ_ALL);
      // Update cache
      queryClient.setQueriesData<PaginatedResponse<Notification>>(
        { queryKey: [NOTIFICATIONS_KEY], exact: false },
        (old) => {
          if (!old) return old;
          return { ...old, data: old.data.map((n) => ({ ...n, read: true })) };
        },
      );
      storeMarkAllAsRead();
    } catch {
      showApiError(new Error(labels.toasts.markAllReadFailed));
      queryClient.invalidateQueries({ queryKey: [NOTIFICATIONS_KEY] });
    }
  };

  const deleteNotification = async (id: string): Promise<void> => {
    // Optimistic remove
    queryClient.setQueriesData<PaginatedResponse<Notification>>(
      { queryKey: [NOTIFICATIONS_KEY], exact: false },
      (old) => {
        if (!old) return old;
        return { ...old, data: old.data.filter((n) => n.id !== id) };
      },
    );
    storeDeleteNotification(id);

    try {
      await apiDelete(`/api/v1/notifications/${id}`);
    } catch {
      // Revert on error
      queryClient.invalidateQueries({ queryKey: [NOTIFICATIONS_KEY] });
      showApiError(new Error(labels.toasts.deleteFailed));
    }
  };

  const bulkDeleteNotifications = async (ids: string[]): Promise<void> => {
    // Optimistic remove
    queryClient.setQueriesData<PaginatedResponse<Notification>>(
      { queryKey: [NOTIFICATIONS_KEY], exact: false },
      (old) => {
        if (!old) return old;
        const idSet = new Set(ids);
        return { ...old, data: old.data.filter((n) => !idSet.has(n.id)) };
      },
    );
    for (const id of ids) {
      storeDeleteNotification(id);
    }

    try {
      await apiPost(API_ENDPOINTS.NOTIFICATIONS_BULK_DELETE, { ids });
      showSuccess(labels.toasts.bulkDeleted(ids.length));
    } catch {
      queryClient.invalidateQueries({ queryKey: [NOTIFICATIONS_KEY] });
      showApiError(new Error(labels.toasts.bulkDeleteFailed));
    }
  };

  return { markAsRead, markAllAsRead, deleteNotification, bulkDeleteNotifications };
}
