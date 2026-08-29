'use client';

/**
 * Scoped bilingual (AR — MSA / EN) labels for the integration OBSERVABILITY
 * surface (#16 SLO/metrics dashboard + #17 event inspector).
 *
 * Kept in its own module (NOT folded into `_labels.ts` nor the shared
 * `@/lib/i18n/messages` catalog) on purpose: `_labels.ts` is concurrently
 * owned/extended by sibling list/catalog/wizard units, and the shared catalog is
 * the integrator's to own — proposed shared keys are listed in the manifest.
 * Same pattern as the coexisting `reliability-labels.ts` / `governance-labels.ts`.
 * All copy is plain strings (no JSX), RTL-safe; `{token}` placeholders are
 * interpolated with {@link fillObservabilityToken}.
 */
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { EventDirection, EventStatus, MetricsWindow } from '@/lib/lex/integrations';

export interface ObservabilityLabels {
  /* ── Page header / nav ── */
  obsTab: string;
  obsTitle: string;
  obsSubtitle: string;
  refresh: string;
  backToList: string;

  /* ── Window selector ── */
  windowLabel: string;
  window1h: string;
  window24h: string;
  window7d: string;

  /* ── KPI strip (tenant rollup) ── */
  kpiConnectors: string;
  kpiConnectorsHint: string;
  kpiCalls: string;
  kpiCallsHint: string;
  kpiErrorRate: string;
  kpiErrorRateHint: string;
  kpiBreaches: string;
  kpiBreachesHint: string;

  /* ── Connector metrics grid / cards ── */
  gridTitle: string;
  gridSubtitle: string;
  colConnector: string;
  colKind: string;
  colCalls: string;
  colErrors: string;
  colErrorRate: string;
  colLatencyP50: string;
  colLatencyP95: string;
  colThroughput: string;
  colSlo: string;
  colTrend: string;
  metricCalls: string;
  metricErrorRate: string;
  metricLatencyP50: string;
  metricLatencyP95: string;
  metricThroughput: string;
  msUnit: string; // "{n} ms"
  recordsUnit: string; // "{n} records"
  sloTarget: string; // "Target {n}%"
  sloMet: string;
  sloBreached: string;
  byOpTitle: string;
  byOpColOp: string;
  byOpColCalls: string;
  byOpColErrorRate: string;
  byOpColP95: string;
  byOpEmpty: string;

  /* ── Per-endpoint metrics section ── */
  endpointMetricsTitle: string;
  endpointMetricsSubtitle: string;
  metricsUnavailable: string;
  metricsUnavailableHint: string;

  /* ── Event inspector ── */
  eventsTab: string;
  eventsTitle: string;
  eventsSubtitle: string;
  eventsGlobalTitle: string;
  eventsGlobalSubtitle: string;
  eventsEmpty: string;
  eventsEmptyHint: string;
  eventsSearchPlaceholder: string;
  filterDirection: string;
  filterKind: string;
  filterStatus: string;
  filterAll: string;
  colDirection: string;
  colEventKind: string;
  colSignature: string;
  colStatus: string;
  colResultAction: string;
  colEndpoint: string;
  colWhen: string;
  colActions: string;
  signatureValid: string;
  signatureInvalid: string;
  signatureNA: string;
  showPayload: string;
  hidePayload: string;
  payloadTitle: string;
  errorTitle: string;
  replay: string;
  replaying: string;
  replayInboundOnly: string;
  replayConfirmTitle: string;
  replayConfirmBody: string;

  /* ── Directions (EventDirection) ── */
  directionInbound: string;
  directionOutbound: string;

  /* ── Event statuses (EventStatus) ── */
  statusReceived: string;
  statusProcessed: string;
  statusFailed: string;

  /* ── Config schema gain (per-connector SLO tunable) ── */
  cfgSloTarget: string;
  cfgSloTargetHelp: string;

  /* ── Shared ── */
  toastReplayed: string;
  observabilityError: string;
  manageOnlyNote: string;
}

export const observabilityLabels: { en: ObservabilityLabels; ar: ObservabilityLabels } = {
  en: {
    obsTab: 'Observability',
    obsTitle: 'Integration observability',
    obsSubtitle:
      'Per-connector SLO, traffic, error and latency metrics across this tenant’s integrations.',
    refresh: 'Refresh',
    backToList: 'Back to integrations',

    windowLabel: 'Window',
    window1h: 'Last hour',
    window24h: 'Last 24 hours',
    window7d: 'Last 7 days',

    kpiConnectors: 'Connectors',
    kpiConnectorsHint: 'Endpoints reporting metrics',
    kpiCalls: 'Total calls',
    kpiCallsHint: 'Calls across all connectors',
    kpiErrorRate: 'Error rate',
    kpiErrorRateHint: 'Errored calls as a share of total',
    kpiBreaches: 'SLO breaches',
    kpiBreachesHint: 'Connectors below their SLO target',

    gridTitle: 'Connector metrics',
    gridSubtitle: 'Traffic, error rate, latency and SLO state per connector.',
    colConnector: 'Connector',
    colKind: 'Kind',
    colCalls: 'Calls',
    colErrors: 'Errors',
    colErrorRate: 'Error rate',
    colLatencyP50: 'p50',
    colLatencyP95: 'p95',
    colThroughput: 'Throughput',
    colSlo: 'SLO',
    colTrend: 'Trend',
    metricCalls: 'Calls',
    metricErrorRate: 'Error rate',
    metricLatencyP50: 'Latency p50',
    metricLatencyP95: 'Latency p95',
    metricThroughput: 'Sync throughput',
    msUnit: '{n} ms',
    recordsUnit: '{n} records',
    sloTarget: 'Target {n}%',
    sloMet: 'SLO met',
    sloBreached: 'SLO breached',
    byOpTitle: 'By operation',
    byOpColOp: 'Operation',
    byOpColCalls: 'Calls',
    byOpColErrorRate: 'Error rate',
    byOpColP95: 'p95',
    byOpEmpty: 'No per-operation breakdown for this window.',

    endpointMetricsTitle: 'Metrics & SLO',
    endpointMetricsSubtitle: 'Traffic, error rate, latency and SLO state for this connector.',
    metricsUnavailable: 'Metrics unavailable',
    metricsUnavailableHint:
      'No metrics were reported for this connector and window yet. Try a wider window or check back after traffic flows.',

    eventsTab: 'Events',
    eventsTitle: 'Event inspector',
    eventsSubtitle:
      'Recent inbound and outbound events for this connector. Replay an inbound event to re-process it.',
    eventsGlobalTitle: 'Event inspector (all integrations)',
    eventsGlobalSubtitle:
      'Recent inbound and outbound events across this tenant’s integrations, newest first.',
    eventsEmpty: 'No events',
    eventsEmptyHint: 'Inbound and outbound events will appear here as they flow.',
    eventsSearchPlaceholder: 'Search kind, action or error…',
    filterDirection: 'Direction',
    filterKind: 'Kind',
    filterStatus: 'Status',
    filterAll: 'All',
    colDirection: 'Direction',
    colEventKind: 'Event',
    colSignature: 'Signature',
    colStatus: 'Status',
    colResultAction: 'Result',
    colEndpoint: 'Integration',
    colWhen: 'When',
    colActions: 'Actions',
    signatureValid: 'Valid',
    signatureInvalid: 'Invalid',
    signatureNA: '—',
    showPayload: 'Show payload',
    hidePayload: 'Hide payload',
    payloadTitle: 'Redacted payload',
    errorTitle: 'Error',
    replay: 'Replay',
    replaying: 'Replaying…',
    replayInboundOnly: 'Only inbound events can be replayed.',
    replayConfirmTitle: 'Replay this event?',
    replayConfirmBody:
      'This re-processes the inbound event through the connector. Side effects of processing may run again.',

    directionInbound: 'Inbound',
    directionOutbound: 'Outbound',

    statusReceived: 'Received',
    statusProcessed: 'Processed',
    statusFailed: 'Failed',

    cfgSloTarget: 'SLO target (%)',
    cfgSloTargetHelp: 'Success-rate objective for this connector; a breach is flagged below it (default 99).',

    toastReplayed: 'Event replayed.',
    observabilityError: 'Something went wrong. Please try again.',
    manageOnlyNote: 'You have read-only access; replay is disabled.',
  },
  ar: {
    obsTab: 'إمكانية الرصد',
    obsTitle: 'رصد التكاملات',
    obsSubtitle:
      'مقاييس مستوى الخدمة وحركة المرور والأخطاء وزمن الاستجابة لكل موصّل عبر تكاملات هذا المستأجر.',
    refresh: 'تحديث',
    backToList: 'العودة إلى التكاملات',

    windowLabel: 'النطاق الزمني',
    window1h: 'آخر ساعة',
    window24h: 'آخر ٢٤ ساعة',
    window7d: 'آخر ٧ أيام',

    kpiConnectors: 'الموصّلات',
    kpiConnectorsHint: 'النقاط التي تُبلِّغ مقاييس',
    kpiCalls: 'إجمالي الطلبات',
    kpiCallsHint: 'الطلبات عبر كل الموصّلات',
    kpiErrorRate: 'معدّل الأخطاء',
    kpiErrorRateHint: 'الطلبات الفاشلة كنسبة من الإجمالي',
    kpiBreaches: 'مخالفات مستوى الخدمة',
    kpiBreachesHint: 'الموصّلات دون هدف مستوى الخدمة',

    gridTitle: 'مقاييس الموصّلات',
    gridSubtitle: 'حركة المرور ومعدّل الأخطاء وزمن الاستجابة وحالة مستوى الخدمة لكل موصّل.',
    colConnector: 'الموصّل',
    colKind: 'النوع',
    colCalls: 'الطلبات',
    colErrors: 'الأخطاء',
    colErrorRate: 'معدّل الأخطاء',
    colLatencyP50: 'الوسيط (p50)',
    colLatencyP95: 'p95',
    colThroughput: 'الإنتاجية',
    colSlo: 'مستوى الخدمة',
    colTrend: 'الاتجاه',
    metricCalls: 'الطلبات',
    metricErrorRate: 'معدّل الأخطاء',
    metricLatencyP50: 'زمن الاستجابة p50',
    metricLatencyP95: 'زمن الاستجابة p95',
    metricThroughput: 'إنتاجية المزامنة',
    msUnit: '{n} مللي ثانية',
    recordsUnit: '{n} سجل',
    sloTarget: 'الهدف {n}٪',
    sloMet: 'محقَّق',
    sloBreached: 'مخالَف',
    byOpTitle: 'حسب العملية',
    byOpColOp: 'العملية',
    byOpColCalls: 'الطلبات',
    byOpColErrorRate: 'معدّل الأخطاء',
    byOpColP95: 'p95',
    byOpEmpty: 'لا يوجد تفصيل حسب العملية لهذا النطاق.',

    endpointMetricsTitle: 'المقاييس ومستوى الخدمة',
    endpointMetricsSubtitle: 'حركة المرور ومعدّل الأخطاء وزمن الاستجابة وحالة مستوى الخدمة لهذا الموصّل.',
    metricsUnavailable: 'المقاييس غير متاحة',
    metricsUnavailableHint:
      'لم تُبلَّغ مقاييس لهذا الموصّل والنطاق بعد. جرّب نطاقًا أوسع أو عُد بعد تدفّق حركة المرور.',

    eventsTab: 'الأحداث',
    eventsTitle: 'فاحص الأحداث',
    eventsSubtitle:
      'الأحداث الواردة والصادرة الأخيرة لهذا الموصّل. أعِد تشغيل حدث وارد لإعادة معالجته.',
    eventsGlobalTitle: 'فاحص الأحداث (جميع التكاملات)',
    eventsGlobalSubtitle:
      'الأحداث الواردة والصادرة الأخيرة عبر تكاملات هذا المستأجر، الأحدث أولًا.',
    eventsEmpty: 'لا توجد أحداث',
    eventsEmptyHint: 'ستظهر هنا الأحداث الواردة والصادرة عند تدفّقها.',
    eventsSearchPlaceholder: 'ابحث في النوع أو الإجراء أو الخطأ…',
    filterDirection: 'الاتجاه',
    filterKind: 'النوع',
    filterStatus: 'الحالة',
    filterAll: 'الكل',
    colDirection: 'الاتجاه',
    colEventKind: 'الحدث',
    colSignature: 'التوقيع',
    colStatus: 'الحالة',
    colResultAction: 'النتيجة',
    colEndpoint: 'التكامل',
    colWhen: 'الوقت',
    colActions: 'الإجراءات',
    signatureValid: 'صالح',
    signatureInvalid: 'غير صالح',
    signatureNA: '—',
    showPayload: 'عرض الحمولة',
    hidePayload: 'إخفاء الحمولة',
    payloadTitle: 'الحمولة المنقّحة',
    errorTitle: 'الخطأ',
    replay: 'إعادة التشغيل',
    replaying: 'جارٍ إعادة التشغيل…',
    replayInboundOnly: 'يمكن إعادة تشغيل الأحداث الواردة فقط.',
    replayConfirmTitle: 'إعادة تشغيل هذا الحدث؟',
    replayConfirmBody:
      'سيعيد هذا معالجة الحدث الوارد عبر الموصّل. قد تُنفَّذ آثار المعالجة الجانبية مجددًا.',

    directionInbound: 'وارد',
    directionOutbound: 'صادر',

    statusReceived: 'مُستلَم',
    statusProcessed: 'مُعالَج',
    statusFailed: 'فاشل',

    cfgSloTarget: 'هدف مستوى الخدمة (٪)',
    cfgSloTargetHelp: 'هدف معدّل النجاح لهذا الموصّل؛ تُحتسب المخالفة دونه (الافتراضي ٩٩).',

    toastReplayed: 'تمت إعادة تشغيل الحدث.',
    observabilityError: 'حدث خطأ ما. يُرجى المحاولة مرة أخرى.',
    manageOnlyNote: 'صلاحيتك للقراءة فقط؛ إعادة التشغيل معطّلة.',
  },
};

/** Locale-bound accessor for the observability copy (Arabic-first). */
export function useObservabilityLabels(): ObservabilityLabels {
  const { locale } = useLocaleOrDefault();
  return locale === 'ar' ? observabilityLabels.ar : observabilityLabels.en;
}

/** Interpolate `{token}` placeholders (handles one or more distinct tokens). */
export function fillObservabilityToken(
  template: string,
  tokens: Record<string, string | number>,
): string {
  return Object.entries(tokens).reduce(
    (acc, [token, value]) => acc.replace(`{${token}}`, String(value)),
    template,
  );
}

/** Localized label for a metrics window. */
export function windowLabel(t: ObservabilityLabels, w: MetricsWindow): string {
  switch (w) {
    case '1h':
      return t.window1h;
    case '24h':
      return t.window24h;
    case '7d':
      return t.window7d;
    default:
      return w;
  }
}

/** Localized label for an event direction. */
export function directionLabel(t: ObservabilityLabels, d: EventDirection): string {
  return d === 'inbound' ? t.directionInbound : t.directionOutbound;
}

/* --------------------------------------------------------------------------- *
 * StatusBadge config builders for the observability enums.
 * --------------------------------------------------------------------------- */

import {
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  Inbox,
  Loader2,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import type { StatusConfig } from '@/lib/status-configs';
import type { EventDirection as Dir, EventStatus as Status } from '@/lib/lex/integrations';

type BadgeColor = 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'gray' | 'teal';

const EVENT_STATUS_COLOR: Record<Status, BadgeColor> = {
  received: 'blue',
  processed: 'green',
  failed: 'red',
};

const EVENT_STATUS_ICON: Record<Status, LucideIcon> = {
  received: Inbox,
  processed: CheckCircle2,
  failed: XCircle,
};

/** Build the EventStatus → {label,color,icon} config for the active locale. */
export function buildEventStatusConfig(t: ObservabilityLabels): StatusConfig {
  return {
    received: {
      label: t.statusReceived,
      color: EVENT_STATUS_COLOR.received,
      icon: EVENT_STATUS_ICON.received,
    },
    processed: {
      label: t.statusProcessed,
      color: EVENT_STATUS_COLOR.processed,
      icon: EVENT_STATUS_ICON.processed,
    },
    failed: {
      label: t.statusFailed,
      color: EVENT_STATUS_COLOR.failed,
      icon: EVENT_STATUS_ICON.failed,
    },
  };
}

const DIRECTION_COLOR: Record<Dir, BadgeColor> = {
  inbound: 'teal',
  outbound: 'purple',
};

const DIRECTION_ICON: Record<Dir, LucideIcon> = {
  inbound: ArrowDownLeft,
  outbound: ArrowUpRight,
};

/** Build the EventDirection → {label,color,icon} config for the active locale. */
export function buildDirectionConfig(t: ObservabilityLabels): StatusConfig {
  return {
    inbound: {
      label: t.directionInbound,
      color: DIRECTION_COLOR.inbound,
      icon: DIRECTION_ICON.inbound,
    },
    outbound: {
      label: t.directionOutbound,
      color: DIRECTION_COLOR.outbound,
      icon: DIRECTION_ICON.outbound,
    },
  };
}

/** The mid-replay spinner icon (kept here so call sites stay icon-free). */
export const ReplaySpinnerIcon: LucideIcon = Loader2;
