'use client';

import type { ComponentType } from 'react';
import {
  Activity,
  BarChart3,
  CheckSquare,
  Gauge,
  LayoutGrid,
  Rocket,
  Shield,
  Siren,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import { ActivityTimeline } from '@/components/dashboard/activity-timeline';
import { CriticalAlertsBanner } from '@/components/dashboard/critical-alerts-banner';
import { KpiGrid } from '@/components/dashboard/kpi-grid';
import { MyTasksList } from '@/components/dashboard/my-tasks-list';
import { OnboardingChecklist } from '@/components/dashboard/onboarding-checklist';
import { RecentAlertsTable } from '@/components/dashboard/recent-alerts-table';
import { SecondaryMetricsStrip } from '@/components/dashboard/secondary-metrics-strip';
import { DashboardHero } from '@/app/(dashboard)/dashboard/_components/dashboard-hero';
import { SuitesLauncher } from '@/app/(dashboard)/dashboard/_components/suites-launcher';
import type { BilingualText } from './board-i18n';

/**
 * Widget registry for the customizable dashboard board.
 *
 * Every entry WRAPS an existing dashboard widget component unchanged — the
 * board never re-implements a widget, it only decides where (and whether) each
 * one renders. Permission gates mirror what `dashboard/page.tsx` enforced
 * before the board existed, and self-gating widgets (e.g. KpiGrid) keep their
 * internal checks as a second line of defense.
 */
export interface WidgetDefinition {
  /** Stable id — persisted in localStorage layouts; never rename casually. */
  id: string;
  title: BilingualText;
  description: BilingualText;
  icon: LucideIcon;
  /** The existing dashboard widget, rendered as-is. */
  Component: ComponentType;
  /** Hidden from board + picker when the user lacks this permission. */
  permission?: string;
  /** Suite-specific widgets disappear when the board is scoped elsewhere. */
  suite: 'all' | 'watheeq' | 'cyber' | 'data';
  /**
   * Pixel-height estimate used before the first ResizeObserver measurement
   * lands, so the initial grid pass is close to the real composition.
   */
  estimatedHeightPx: number;
  /** Lower bound (px) when the user manually resizes the widget's height. */
  minHeightPx: number;
  /** Minimum width in grid columns (out of 12 on desktop). */
  minW: number;
}

export const WIDGET_REGISTRY: readonly WidgetDefinition[] = [
  {
    id: 'critical-alerts',
    title: { en: 'Critical alerts banner', ar: 'شريط التنبيهات الحرجة' },
    description: {
      en: 'Appears when critical or high-severity alerts need attention.',
      ar: 'يظهر عند وجود تنبيهات حرجة أو عالية الخطورة تتطلب الانتباه.',
    },
    icon: Siren,
    Component: CriticalAlertsBanner,
    permission: 'cyber:read',
    suite: 'cyber',
    estimatedHeightPx: 56,
    minHeightPx: 48,
    minW: 6,
  },
  {
    id: 'welcome-hero',
    title: { en: 'Welcome header', ar: 'ترويسة الترحيب' },
    description: {
      en: 'Greeting, date and an overview of your suite access.',
      ar: 'التحية والتاريخ ونظرة عامة على الأجنحة المتاحة لك.',
    },
    icon: Sparkles,
    Component: DashboardHero,
    suite: 'all',
    estimatedHeightPx: 176,
    minHeightPx: 120,
    minW: 6,
  },
  {
    id: 'suites-launcher',
    title: { en: 'Suites launcher', ar: 'مشغّل الأجنحة' },
    description: {
      en: 'Suite cards with entitlement status and quick links into each suite.',
      ar: 'بطاقات الأجنحة مع حالة الاشتراك وروابط سريعة داخل كل جناح.',
    },
    icon: LayoutGrid,
    Component: SuitesLauncher,
    suite: 'all',
    estimatedHeightPx: 360,
    minHeightPx: 160,
    minW: 4,
  },
  {
    id: 'onboarding-checklist',
    title: { en: 'Getting started checklist', ar: 'قائمة خطوات البدء' },
    description: {
      en: 'First-run setup steps for your workspace. Hides itself once dismissed.',
      ar: 'خطوات الإعداد الأولى لمساحة العمل. تختفي تلقائيًا بعد تجاهلها.',
    },
    icon: Rocket,
    Component: OnboardingChecklist,
    suite: 'all',
    estimatedHeightPx: 320,
    minHeightPx: 140,
    minW: 4,
  },
  {
    id: 'kpi-strip',
    title: { en: 'KPI cards', ar: 'بطاقات المؤشرات الرئيسية' },
    description: {
      en: 'Open alerts, failed pipelines, pending tasks and data quality with live sparklines.',
      ar: 'التنبيهات المفتوحة وخطوط الأنابيب المتعثرة والمهام المعلقة وجودة البيانات مع مخططات مباشرة.',
    },
    icon: Gauge,
    Component: KpiGrid,
    suite: 'all',
    estimatedHeightPx: 194,
    minHeightPx: 170,
    minW: 4,
  },
  {
    id: 'metrics-strip',
    title: { en: 'Secondary metrics', ar: 'المؤشرات الثانوية' },
    description: {
      en: 'A compact strip of cross-suite health indicators.',
      ar: 'شريط مضغوط لمؤشرات الحالة عبر الأجنحة.',
    },
    icon: BarChart3,
    Component: SecondaryMetricsStrip,
    suite: 'all',
    estimatedHeightPx: 78,
    minHeightPx: 64,
    minW: 4,
  },
  {
    id: 'recent-alerts',
    title: { en: 'Recent alerts', ar: 'أحدث التنبيهات' },
    description: {
      en: 'The latest security alerts from the Cyber suite.',
      ar: 'أحدث التنبيهات الأمنية من جناح السايبر.',
    },
    icon: Shield,
    Component: RecentAlertsTable,
    permission: 'cyber:read',
    suite: 'cyber',
    estimatedHeightPx: 420,
    minHeightPx: 180,
    minW: 4,
  },
  {
    id: 'my-tasks',
    title: { en: 'My tasks', ar: 'مهامي' },
    description: {
      en: 'Workflow tasks assigned to you.',
      ar: 'مهام سير العمل المسندة إليك.',
    },
    icon: CheckSquare,
    Component: MyTasksList,
    suite: 'all',
    estimatedHeightPx: 420,
    minHeightPx: 180,
    minW: 4,
  },
  {
    id: 'activity-timeline',
    title: { en: 'Activity timeline', ar: 'الخط الزمني للنشاط' },
    description: {
      en: 'A live feed of recent activity across your workspace.',
      ar: 'تدفق مباشر لآخر الأنشطة في مساحة العمل.',
    },
    icon: Activity,
    Component: ActivityTimeline,
    suite: 'all',
    estimatedHeightPx: 420,
    minHeightPx: 180,
    minW: 4,
  },
];

/**
 * The default composition, row by row — signal first: alerts, greeting and
 * setup, then the KPI/metric strips, work queues, and only then the suites
 * launcher and activity feed. Widgets sharing a row split the width evenly
 * (alerts + tasks side by side on wide screens); when permission gating leaves
 * a single widget in a shared row it takes the full width, matching the old
 * page's `hasCyber ? <SectionGrid cols={2}> : full-width` behavior.
 */
export const DEFAULT_ROWS: readonly (readonly string[])[] = [
  ['critical-alerts'],
  ['welcome-hero'],
  ['kpi-strip'],
  ['onboarding-checklist'],
  ['metrics-strip'],
  ['recent-alerts', 'my-tasks'],
  ['suites-launcher'],
  ['activity-timeline'],
];

export function getWidgetDefinition(id: string): WidgetDefinition | undefined {
  return WIDGET_REGISTRY.find((def) => def.id === id);
}
