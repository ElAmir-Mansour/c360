/**
 * Bilingual (English + Modern Standard Arabic) label bundle for the notification
 * center surfaces — الإشعارات: the notifications page list, the inbox dropdown,
 * category tabs, empty states, per-card controls, and the toast strings emitted
 * by {@link useNotificationActions}.
 *
 * Follows the established files/notebooks/data i18n contract: every group is a
 * bilingual bundle `{ en, ar }` (two FULL, same-shaped copies). Components call
 * {@link useNotificationsLabels}; resolution defaults to the app's default
 * locale when no LocaleProvider is mounted (matching `useBilingual`). String
 * leaves are also registered under the `notifications` namespace so they resolve
 * through `useT('notifications')` / `createNamespacedTranslator('notifications')`.
 */

'use client';

import { useBilingual } from '@/components/providers/locale-provider';
import { registerMessages, resolveBilingualBundle } from '@/lib/i18n/registry';
import type { AppLocale } from '@/lib/i18n';

export type NotificationsBilingual<T> = { readonly en: T; readonly ar: T };

export function resolveNotificationsBilingual<T>(
  bundle: NotificationsBilingual<T>,
  locale: AppLocale,
): T {
  return resolveBilingualBundle(bundle, locale);
}

export interface NotificationsLabels {
  actions: {
    markAsRead: string;
    deleteNotification: string;
  };
  toasts: {
    markReadFailed: string;
    markAllReadFailed: string;
    deleteFailed: string;
    bulkDeleteFailed: string;
    bulkDeleted: (count: number) => string;
  };
  tabs: {
    all: string;
    unread: string;
    security: string;
    workflow: string;
    data: string;
    governance: string;
    legal: string;
    system: string;
  };
  empty: {
    all: string;
    unread: string;
    security: string;
    workflow: string;
    data: string;
    system: string;
    governance: string;
    legal: string;
  };
  list: {
    showingRecent: (count: number) => string;
    noMore: string;
    loadMore: string;
  };
  card: {
    unread: string;
    select: (title: string) => string;
  };
  page: {
    eyebrow: string;
    title: string;
    description: string;
    markAllRead: string;
    marking: string;
    select: string;
    settings: string;
    selectAll: string;
    deselectAll: string;
    deleteCount: (count: number) => string;
    statUnread: string;
    statTotal: string;
    topChannel: (label: string) => string;
    confirmMarkAllTitle: string;
    confirmMarkAllDescription: (count: number) => string;
    confirmMarkAllLabel: string;
    confirmDeleteTitle: string;
    confirmDeleteDescription: (count: number) => string;
    confirmDeleteLabel: string;
  };
}

const notificationsLabels: NotificationsBilingual<NotificationsLabels> = {
  en: {
    actions: {
      markAsRead: 'Mark as read',
      deleteNotification: 'Delete notification',
    },
    toasts: {
      markReadFailed: 'Failed to mark notification as read',
      markAllReadFailed: 'Failed to mark all notifications as read',
      deleteFailed: 'Failed to delete notification',
      bulkDeleteFailed: 'Failed to delete notifications',
      bulkDeleted: (count) => `Deleted ${count} notification${count === 1 ? '' : 's'}`,
    },
    tabs: {
      all: 'All',
      unread: 'Unread',
      security: 'Security',
      workflow: 'Workflow',
      data: 'Data',
      governance: 'Governance',
      legal: 'Legal',
      system: 'System',
    },
    empty: {
      all: "You're all caught up!",
      unread: 'No unread notifications.',
      security: 'No security notifications.',
      workflow: 'No workflow notifications.',
      data: 'No data notifications.',
      system: 'No system notifications.',
      governance: 'No governance notifications.',
      legal: 'No legal notifications.',
    },
    list: {
      showingRecent: (count) => `Showing most recent ${count} notifications.`,
      noMore: 'No more notifications.',
      loadMore: 'Load more notifications',
    },
    card: {
      unread: 'unread',
      select: (title) => `Select notification: ${title}`,
    },
    page: {
      eyebrow: 'Activity Center',
      title: 'Notifications',
      description: 'Stay up to date with activity across the platform.',
      markAllRead: 'Mark All Read',
      marking: 'Marking...',
      select: 'Select',
      settings: 'Notification settings',
      selectAll: 'Select all',
      deselectAll: 'Deselect all',
      deleteCount: (count) => `Delete (${count})`,
      statUnread: 'Unread',
      statTotal: 'Total',
      topChannel: (label) => `Top channel · ${label}`,
      confirmMarkAllTitle: 'Mark All Read',
      confirmMarkAllDescription: (count) => `Mark all ${count} unread notifications as read?`,
      confirmMarkAllLabel: 'Mark all read',
      confirmDeleteTitle: 'Delete Notifications',
      confirmDeleteDescription: (count) =>
        `Permanently delete ${count} selected notification${count === 1 ? '' : 's'}?`,
      confirmDeleteLabel: 'Delete',
    },
  },
  ar: {
    actions: {
      markAsRead: 'تعليم كمقروء',
      deleteNotification: 'حذف الإشعار',
    },
    toasts: {
      markReadFailed: 'تعذّر تعليم الإشعار كمقروء',
      markAllReadFailed: 'تعذّر تعليم جميع الإشعارات كمقروءة',
      deleteFailed: 'تعذّر حذف الإشعار',
      bulkDeleteFailed: 'تعذّر حذف الإشعارات',
      bulkDeleted: (count) => `تم حذف ${count} من الإشعارات`,
    },
    tabs: {
      all: 'الكل',
      unread: 'غير المقروءة',
      security: 'الأمن',
      workflow: 'سير العمل',
      data: 'البيانات',
      governance: 'الحوكمة',
      legal: 'القانونية',
      system: 'النظام',
    },
    empty: {
      all: 'أنت على اطّلاع كامل!',
      unread: 'لا توجد إشعارات غير مقروءة.',
      security: 'لا توجد إشعارات أمنية.',
      workflow: 'لا توجد إشعارات لسير العمل.',
      data: 'لا توجد إشعارات بيانات.',
      system: 'لا توجد إشعارات نظام.',
      governance: 'لا توجد إشعارات حوكمة.',
      legal: 'لا توجد إشعارات قانونية.',
    },
    list: {
      showingRecent: (count) => `عرض أحدث ${count} إشعارًا.`,
      noMore: 'لا مزيد من الإشعارات.',
      loadMore: 'تحميل المزيد من الإشعارات',
    },
    card: {
      unread: 'غير مقروء',
      select: (title) => `تحديد الإشعار: ${title}`,
    },
    page: {
      eyebrow: 'مركز النشاط',
      title: 'الإشعارات',
      description: 'ابقَ على اطّلاع بالنشاط عبر المنصة.',
      markAllRead: 'تعليم الكل كمقروء',
      marking: 'جارٍ التعليم...',
      select: 'تحديد',
      settings: 'إعدادات الإشعارات',
      selectAll: 'تحديد الكل',
      deselectAll: 'إلغاء تحديد الكل',
      deleteCount: (count) => `حذف (${count})`,
      statUnread: 'غير المقروءة',
      statTotal: 'الإجمالي',
      topChannel: (label) => `أعلى قناة · ${label}`,
      confirmMarkAllTitle: 'تعليم الكل كمقروء',
      confirmMarkAllDescription: (count) =>
        `تعليم جميع الإشعارات غير المقروءة البالغة ${count} كمقروءة؟`,
      confirmMarkAllLabel: 'تعليم الكل كمقروء',
      confirmDeleteTitle: 'حذف الإشعارات',
      confirmDeleteDescription: (count) => `حذف ${count} من الإشعارات المحددة نهائيًا؟`,
      confirmDeleteLabel: 'حذف',
    },
  },
};

export function useNotificationsLabels(): NotificationsLabels {
  return useBilingual(notificationsLabels);
}

registerMessages('notifications', notificationsLabels);
