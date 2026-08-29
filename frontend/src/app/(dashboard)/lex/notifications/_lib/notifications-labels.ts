/**
 * Bilingual (English + Modern Standard Arabic) labels for the Watheeq
 * legal-affairs in-app NOTIFICATIONS surface (Phase 4, CAP-156..164): the
 * durable inbox (list / filter / mark-read) and the per-user subscription
 * preferences panel.
 *
 * Follows the canonical lex bilingual contract (`../../_lib/lex-i18n.ts`): two
 * FULL, same-shaped copies; `en` is the canonical English surface, `ar` is
 * professional MSA using the suite glossary (إشعار / طلب / قضية / جلسة / حكم /
 * عقد). Function-valued/interpolated fields appear on BOTH sides and keep
 * Western digits.
 *
 * Category and channel enum maps are keyed by the RAW backend token with an
 * identical key set per locale.
 */

'use client';

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n';
import { type LexBilingual, resolveLexBilingual } from '../../_lib/lex-i18n';
import type {
  LexNotificationCategory,
  LexNotificationChannel,
} from '@/lib/lex/notifications';

export interface NotificationsLabels {
  pageTitle: string;
  pageDescription: string;
  tabs: {
    inbox: string;
    preferences: string;
  };
  inbox: {
    all: string;
    unreadOnly: string;
    markAllRead: string;
    markRead: string;
    open: string;
    refresh: string;
    emptyTitle: string;
    emptyDescription: string;
    emptyUnreadTitle: string;
    emptyUnreadDescription: string;
    loadError: string;
    unreadBadge: (n: number) => string;
    totalBadge: (n: number) => string;
    loadMore: string;
    categoryFilter: string;
    allCategories: string;
    newMarker: string;
  };
  /** KPI strip captions (computed client-side from the fetched inbox). */
  kpis: {
    unread: string;
    total: string;
    read: string;
    topCategory: string;
    none: string;
  };
  /** Day-grouped section headings for the timeline-style inbox. */
  groups: {
    today: string;
    yesterday: string;
    earlier: string;
  };
  /** Accessible labels for the read/unread per-row state. */
  state: {
    unread: string;
    read: string;
  };
  preferences: {
    title: string;
    description: string;
    category: string;
    inApp: string;
    email: string;
    enabled: string;
    muted: string;
    loadError: string;
    saved: string;
    saveError: string;
    inAppNote: string;
    note: string;
  };
  categoryLabels: Record<LexNotificationCategory, string>;
  channelLabels: Record<LexNotificationChannel, string>;
  toast: {
    marked: string;
    markedAll: (n: number) => string;
    error: string;
  };
}

const bundle: LexBilingual<NotificationsLabels> = {
  en: {
    pageTitle: 'Notifications',
    pageDescription: 'Your legal-affairs in-app inbox and notification preferences.',
    tabs: {
      inbox: 'Inbox',
      preferences: 'Preferences',
    },
    inbox: {
      all: 'All',
      unreadOnly: 'Unread only',
      markAllRead: 'Mark all read',
      markRead: 'Mark read',
      open: 'Open',
      refresh: 'Refresh',
      emptyTitle: 'No notifications',
      emptyDescription: 'You have no legal-affairs notifications yet.',
      emptyUnreadTitle: 'All caught up',
      emptyUnreadDescription: 'You have read every notification.',
      loadError: 'Failed to load your inbox.',
      unreadBadge: (n) => `${n} unread`,
      totalBadge: (n) => `${n} total`,
      loadMore: 'Load more',
      categoryFilter: 'Category',
      allCategories: 'All categories',
      newMarker: 'New',
    },
    kpis: {
      unread: 'Unread',
      total: 'Total',
      read: 'Read',
      topCategory: 'Top category',
      none: 'None',
    },
    groups: {
      today: 'Today',
      yesterday: 'Yesterday',
      earlier: 'Earlier',
    },
    state: {
      unread: 'Unread',
      read: 'Read',
    },
    preferences: {
      title: 'Notification preferences',
      description: 'Choose which categories reach you on each channel.',
      category: 'Category',
      inApp: 'In-app',
      email: 'Email',
      enabled: 'Enabled',
      muted: 'Muted',
      loadError: 'Failed to load preferences.',
      saved: 'Preference saved.',
      saveError: 'Failed to save preference.',
      inAppNote: 'In-app delivery is always available.',
      note: 'Notifications are on by default; switch one off to mute that channel.',
    },
    categoryLabels: {
      request: 'Requests',
      case: 'Cases',
      hearing: 'Hearings',
      judgment: 'Judgments',
      contract: 'Contracts',
      general: 'General',
    },
    channelLabels: {
      in_app: 'In-app',
      email: 'Email',
    },
    toast: {
      marked: 'Notification marked as read.',
      markedAll: (n) => `${n} notifications marked as read.`,
      error: 'Something went wrong.',
    },
  },
  ar: {
    pageTitle: 'الإشعارات',
    pageDescription: 'صندوق إشعارات الشؤون القانونية داخل التطبيق وتفضيلات الإشعارات.',
    tabs: {
      inbox: 'الوارد',
      preferences: 'التفضيلات',
    },
    inbox: {
      all: 'الكل',
      unreadOnly: 'غير المقروء فقط',
      markAllRead: 'تعليم الكل كمقروء',
      markRead: 'تعليم كمقروء',
      open: 'فتح',
      refresh: 'تحديث',
      emptyTitle: 'لا توجد إشعارات',
      emptyDescription: 'ليست لديك أي إشعارات للشؤون القانونية بعد.',
      emptyUnreadTitle: 'لا جديد',
      emptyUnreadDescription: 'لقد قرأت جميع الإشعارات.',
      loadError: 'تعذّر تحميل صندوق الوارد.',
      unreadBadge: (n) => `${n} غير مقروء`,
      totalBadge: (n) => `${n} إجمالاً`,
      loadMore: 'تحميل المزيد',
      categoryFilter: 'الفئة',
      allCategories: 'كل الفئات',
      newMarker: 'جديد',
    },
    kpis: {
      unread: 'غير مقروء',
      total: 'الإجمالي',
      read: 'مقروء',
      topCategory: 'الفئة الأبرز',
      none: 'لا شيء',
    },
    groups: {
      today: 'اليوم',
      yesterday: 'أمس',
      earlier: 'سابقًا',
    },
    state: {
      unread: 'غير مقروء',
      read: 'مقروء',
    },
    preferences: {
      title: 'تفضيلات الإشعارات',
      description: 'اختر الفئات التي تصلك عبر كل قناة.',
      category: 'الفئة',
      inApp: 'داخل التطبيق',
      email: 'البريد الإلكتروني',
      enabled: 'مُفعّل',
      muted: 'مكتوم',
      loadError: 'تعذّر تحميل التفضيلات.',
      saved: 'تم حفظ التفضيل.',
      saveError: 'تعذّر حفظ التفضيل.',
      inAppNote: 'التسليم داخل التطبيق متاح دائمًا.',
      note: 'الإشعارات مُفعّلة افتراضيًا؛ أوقف إحداها لكتم تلك القناة.',
    },
    categoryLabels: {
      request: 'الطلبات',
      case: 'القضايا',
      hearing: 'الجلسات',
      judgment: 'الأحكام',
      contract: 'العقود',
      general: 'عام',
    },
    channelLabels: {
      in_app: 'داخل التطبيق',
      email: 'البريد الإلكتروني',
    },
    toast: {
      marked: 'تم تعليم الإشعار كمقروء.',
      markedAll: (n) => `تم تعليم ${n} إشعارًا كمقروء.`,
      error: 'حدث خطأ ما.',
    },
  },
};

export function resolveNotificationsLabels(locale: AppLocale = 'en'): NotificationsLabels {
  return resolveLexBilingual(bundle, locale);
}

export function useNotificationsLabels(): NotificationsLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveNotificationsLabels(locale), [locale]);
}
