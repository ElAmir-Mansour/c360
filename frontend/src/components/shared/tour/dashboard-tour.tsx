'use client';

import { Tour, type TourStep } from './tour';
import { useFirstRunTour } from './use-first-run-tour';

/**
 * First-run shell tour, hosted on the dashboard / suites hub (`/dashboard`).
 *
 * Auto-offered once per browser profile (persisted under
 * `tour:dashboard:done`) and re-launchable from the user menu's "Show tour"
 * via `launchTour(DASHBOARD_TOUR_ID)`.
 *
 * Target selectors try a `[data-tour="…"]` anchor first (so layout components
 * can adopt explicit anchors later without touching this file) and then fall
 * back to stable, locale-independent hooks that exist in the shell today
 * (`data-testid`, non-localized aria-label prefixes, aria-haspopup structure).
 * A step whose target is missing (e.g. on mobile, where the sidebar is hidden)
 * degrades to a centered callout instead of breaking.
 */
export const DASHBOARD_TOUR_ID = 'dashboard';

const DASHBOARD_TOUR_STEPS: TourStep[] = [
  {
    id: 'suites',
    target: ['[data-tour="suite-switcher"]', 'aside[aria-label] button[aria-haspopup="menu"]'],
    placement: 'end',
    title: {
      en: 'Your suites',
      ar: 'أجنحة المنصة',
    },
    body: {
      en: 'Clario360 is organized into suites — Cyber, Data, Legal, Recover and more. Switch between them here; the sidebar always shows the sections of the active suite.',
      ar: 'تنظَّم منصة كلاريو 360 في أجنحة — الأمن السيبراني، البيانات، الشؤون القانونية، التعافي وغيرها. بدّل بينها من هنا؛ ويعرض الشريط الجانبي دائمًا أقسام الجناح النشط.',
    },
  },
  {
    id: 'command-palette',
    target: [
      '[data-tour="command-palette"]',
      'header button[aria-label*="⌘K"]',
      'header button[aria-label*="Ctrl+K"]',
    ],
    placement: 'bottom',
    title: {
      en: 'Search everything',
      ar: 'ابحث في كل شيء',
    },
    body: {
      en: 'Press ⌘K (or Ctrl+K) to open the command palette — jump to any page, record, or action without leaving the keyboard.',
      ar: 'اضغط ⌘K (أو Ctrl+K) لفتح لوحة الأوامر — وانتقل إلى أي صفحة أو سجل أو إجراء دون مغادرة لوحة المفاتيح.',
    },
  },
  {
    id: 'notifications',
    target: ['[data-tour="notifications"]', 'header button[aria-label^="Notifications"]'],
    placement: 'bottom',
    title: {
      en: 'Stay on top of alerts',
      ar: 'تابع التنبيهات أولًا بأول',
    },
    body: {
      en: 'Real-time notifications land here — approvals, security alerts, and task assignments. The badge shows your unread count.',
      ar: 'تصل الإشعارات الفورية إلى هنا — الموافقات والتنبيهات الأمنية وإسناد المهام. وتعرض الشارة عدد الإشعارات غير المقروءة.',
    },
  },
  {
    id: 'appearance',
    target: ['[data-tour="theme-locale"]', '[data-testid="theme-locale-trigger"]'],
    placement: 'bottom',
    title: {
      en: 'Make it yours',
      ar: 'خصّصها كما تريد',
    },
    body: {
      en: 'Switch between light and dark themes, and between English and Arabic. Your preference is remembered on this device.',
      ar: 'بدّل بين المظهر الفاتح والداكن، وبين اللغتين العربية والإنجليزية. يُحفَظ اختيارك على هذا الجهاز.',
    },
  },
];

/** Mount once on the dashboard / suites hub page. Renders nothing until the
 * tour is offered or explicitly launched. */
export function DashboardTour() {
  const { open, setOpen } = useFirstRunTour(DASHBOARD_TOUR_ID);
  return (
    <Tour id={DASHBOARD_TOUR_ID} steps={DASHBOARD_TOUR_STEPS} open={open} onOpenChange={setOpen} />
  );
}
