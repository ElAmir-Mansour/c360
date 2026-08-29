'use client';

/**
 * Bilingual (English + Modern Standard Arabic) labels for the Legal Service Desk
 * Notifications inbox + channel preferences (`/lex/service-desk/notifications`,
 * CAP-156..164). Follows the canonical lex i18n contract: a
 * `LexBilingual<T> = { en, ar }` bundle with two FULL, same-shaped copies,
 * resolved per locale by the {@link useNotificationsLabels} hook. JSX only ever
 * touches the resolved `T`.
 *
 * Category maps (`categoryLabels` / `categoryDescriptions`) are keyed by the RAW
 * backend `NotificationCategory` token with identical key sets on both locales,
 * so a component resolves with `categoryLabels[token] ?? token`.
 */

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { NotificationCategory, NotificationChannel } from '@/lib/lex/requests';
import { type LexBilingual, resolveLexBilingual } from '../../_lib/lex-i18n';

/** The six inbox categories (mirrors the Phase-4 trigger surface). */
export const NOTIFICATION_CATEGORY_OPTIONS = [
  'request',
  'case',
  'hearing',
  'judgment',
  'contract',
  'general',
] as const satisfies readonly NotificationCategory[];

/** The two delivery channels (the backend enum is in_app | email ONLY). */
export const NOTIFICATION_CHANNEL_OPTIONS = [
  'in_app',
  'email',
] as const satisfies readonly NotificationChannel[];

export interface NotificationsLabels {
  /** Page hero. */
  pageEyebrow: string;
  pageTitle: string;
  pageDescription: string;

  /** Tab triggers. */
  tabs: {
    inbox: string;
    preferences: string;
  };

  /** Inbox tab copy + actions. */
  inbox: {
    sectionTitle: string;
    sectionDescription: string;
    unread: (count: number) => string;
    total: (count: number) => string;
    markRead: string;
    markAllRead: string;
    open: string;
    untitled: string;
    emptyTitle: string;
    emptyDescription: string;
    markReadSuccess: string;
    markAllReadSuccess: string;
    markReadError: string;
  };

  /** Preferences tab copy. */
  preferences: {
    sectionTitle: string;
    sectionDescription: string;
    categoryColumn: string;
    optOutNote: string;
    saved: string;
    saveError: string;
  };

  /** Per-channel column headers + short helper text. */
  channelLabels: Record<NotificationChannel, string>;
  channelDescriptions: Record<NotificationChannel, string>;

  /** Category display labels, keyed by raw backend token. */
  categoryLabels: Record<(typeof NOTIFICATION_CATEGORY_OPTIONS)[number], string>;

  /** One-line explanation of each category. */
  categoryDescriptions: Record<(typeof NOTIFICATION_CATEGORY_OPTIONS)[number], string>;
}

export const notificationsLabels: LexBilingual<NotificationsLabels> = {
  en: {
    pageEyebrow: 'Legal Service Desk',
    pageTitle: 'Notifications',
    pageDescription:
      'Your in-app inbox for requests, cases, hearings and judgments, plus the channels each category is delivered on.',
    tabs: {
      inbox: 'Inbox',
      preferences: 'Channel preferences',
    },
    inbox: {
      sectionTitle: 'Inbox',
      sectionDescription: 'Notifications addressed to you across the legal service desk.',
      unread: (count) => `${count} unread`,
      total: (count) => `${count} total`,
      markRead: 'Mark read',
      markAllRead: 'Mark all read',
      open: 'Open',
      untitled: 'Untitled notification',
      emptyTitle: 'You are all caught up',
      emptyDescription: 'New notifications will appear here as they arrive.',
      markReadSuccess: 'Notification marked as read.',
      markAllReadSuccess: 'All notifications marked as read.',
      markReadError: 'Could not update the notification. Please try again.',
    },
    preferences: {
      sectionTitle: 'Channel preferences',
      sectionDescription:
        'Choose which channels deliver each category of notification. Toggles are on by default; turn one off to mute that category on that channel.',
      categoryColumn: 'Category',
      optOutNote:
        'You always receive notifications in your inbox; these toggles control extra delivery channels.',
      saved: 'Preference saved.',
      saveError: 'Could not save the preference. Please try again.',
    },
    channelLabels: {
      in_app: 'In-app',
      email: 'Email',
    },
    channelDescriptions: {
      in_app: 'Shown in this inbox and the bell menu.',
      email: 'Sent to your registered email address.',
    },
    categoryLabels: {
      request: 'Requests',
      case: 'Cases',
      hearing: 'Hearings',
      judgment: 'Judgments',
      contract: 'Contracts',
      general: 'General',
    },
    categoryDescriptions: {
      request: 'Updates on service-desk requests you raised, own or are assigned to.',
      case: 'Activity on litigation and matter files you are working on.',
      hearing: 'Reminders and changes for scheduled court hearings.',
      judgment: 'Issued judgments, rulings and their deadlines.',
      contract: 'Contract lifecycle events such as reviews, renewals and expiries.',
      general: 'Announcements and other notices that do not fit a category.',
    },
  },
  ar: {
    pageEyebrow: 'مكتب الخدمات القانونية',
    pageTitle: 'الإشعارات',
    pageDescription:
      'صندوق الإشعارات داخل التطبيق للطلبات والقضايا والجلسات والأحكام، إضافة إلى قنوات تسليم كل فئة.',
    tabs: {
      inbox: 'الصندوق',
      preferences: 'تفضيلات القنوات',
    },
    inbox: {
      sectionTitle: 'صندوق الوارد',
      sectionDescription: 'الإشعارات الموجهة إليك عبر مكتب الخدمات القانونية.',
      unread: (count) => `${count} غير مقروء`,
      total: (count) => `${count} إجمالاً`,
      markRead: 'تعليم كمقروء',
      markAllRead: 'تعليم الكل كمقروء',
      open: 'فتح',
      untitled: 'إشعار بدون عنوان',
      emptyTitle: 'لا توجد إشعارات جديدة',
      emptyDescription: 'ستظهر الإشعارات الجديدة هنا فور وصولها.',
      markReadSuccess: 'تم تعليم الإشعار كمقروء.',
      markAllReadSuccess: 'تم تعليم جميع الإشعارات كمقروءة.',
      markReadError: 'تعذّر تحديث الإشعار. يرجى المحاولة مرة أخرى.',
    },
    preferences: {
      sectionTitle: 'تفضيلات القنوات',
      sectionDescription:
        'اختر القنوات التي تُسلَّم عبرها كل فئة من الإشعارات. الخيارات مُفعّلة افتراضيًا؛ أوقف أحدها لكتم تلك الفئة على تلك القناة.',
      categoryColumn: 'الفئة',
      optOutNote:
        'تصلك الإشعارات دائمًا في صندوقك؛ تتحكم هذه المفاتيح في قنوات التسليم الإضافية.',
      saved: 'تم حفظ التفضيل.',
      saveError: 'تعذّر حفظ التفضيل. يرجى المحاولة مرة أخرى.',
    },
    channelLabels: {
      in_app: 'داخل التطبيق',
      email: 'البريد الإلكتروني',
    },
    channelDescriptions: {
      in_app: 'يظهر في هذا الصندوق وقائمة الجرس.',
      email: 'يُرسل إلى بريدك الإلكتروني المسجَّل.',
    },
    categoryLabels: {
      request: 'الطلبات',
      case: 'القضايا',
      hearing: 'الجلسات',
      judgment: 'الأحكام',
      contract: 'العقود',
      general: 'عام',
    },
    categoryDescriptions: {
      request: 'تحديثات طلبات مكتب الخدمات التي أنشأتها أو تملكها أو أُسندت إليك.',
      case: 'النشاط على ملفات التقاضي والقضايا التي تعمل عليها.',
      hearing: 'تذكيرات وتغييرات الجلسات القضائية المجدولة.',
      judgment: 'الأحكام والقرارات الصادرة ومواعيدها النهائية.',
      contract: 'أحداث دورة حياة العقد مثل المراجعات والتجديدات وحالات الانتهاء.',
      general: 'الإعلانات والإشعارات الأخرى التي لا تندرج ضمن فئة محددة.',
    },
  },
};

/** React hook returning the locale-resolved notifications labels. */
export function useNotificationsLabels(): NotificationsLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveLexBilingual(notificationsLabels, locale), [locale]);
}
