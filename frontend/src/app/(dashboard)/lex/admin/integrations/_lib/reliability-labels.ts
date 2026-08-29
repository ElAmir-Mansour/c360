'use client';

/**
 * Scoped bilingual (AR — MSA / EN) labels for the integration RELIABILITY surface
 * (#11 dead-letter queue + #12 circuit breaker).
 *
 * Kept in its own module (NOT folded into `_labels.ts` nor the shared
 * `@/lib/i18n/messages` catalog) on purpose: `_labels.ts` is concurrently
 * owned/extended by sibling list/catalog/wizard units, and the shared catalog is
 * the integrator's to own — proposed shared keys are listed in the manifest.
 * Same pattern as the coexisting `detail-ops-labels.ts` / `logs-labels.ts`. All
 * copy is plain strings (no JSX), RTL-safe; `{token}` placeholders are
 * interpolated with {@link fillReliabilityToken}.
 */
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type {
  BreakerStateValue,
  DeadLetterSource,
  DeadLetterStatus,
} from '@/lib/lex/integrations';

export interface ReliabilityLabels {
  /* ── DLQ console ── */
  dlqTitle: string;
  dlqSubtitle: string;
  dlqGlobalTitle: string;
  dlqGlobalSubtitle: string;
  dlqTab: string;
  dlqEmpty: string;
  dlqEmptyHint: string;
  dlqColSource: string;
  dlqColSummary: string;
  dlqColError: string;
  dlqColAttempts: string;
  dlqColStatus: string;
  dlqColEndpoint: string;
  dlqColWhen: string;
  dlqColActions: string;
  dlqReplay: string;
  dlqReplaying: string;
  dlqReplayAll: string;
  dlqReplayAllRunning: string;
  dlqReplayAllConfirmTitle: string;
  dlqReplayAllConfirmBody: string; // "{n} failed entries"
  dlqShowPayload: string;
  dlqHidePayload: string;
  dlqPayloadTitle: string;
  dlqLastAttempt: string;
  dlqFailedCount: string; // "{n} failed"

  /* ── DLQ sources (DeadLetterSource) ── */
  sourceSync: string;
  sourceWebhook: string;
  sourceOutbox: string;
  sourceInvoke: string;

  /* ── DLQ statuses (DeadLetterStatus) ── */
  dlqStatusFailed: string;
  dlqStatusReplayed: string;
  dlqStatusResolved: string;

  /* ── Breaker panel ── */
  breakerTitle: string;
  breakerSubtitle: string;
  breakerUnknown: string;
  breakerStateLabel: string;
  breakerFailures: string; // "{n} / {threshold}"
  breakerFailuresLabel: string;
  breakerThresholdLabel: string;
  breakerOpenedAt: string;
  breakerCooldown: string; // "{n}s cooldown"
  breakerCooldownLabel: string;
  breakerQuarantined: string;
  breakerNotQuarantined: string;
  breakerReset: string;
  breakerResetting: string;
  breakerResetConfirmTitle: string;
  breakerResetConfirmBody: string;
  breakerHintClosed: string;
  breakerHintOpen: string;
  breakerHintHalfOpen: string;

  /* ── Breaker states (BreakerStateValue) ── */
  stateClosed: string;
  stateOpen: string;
  stateHalfOpen: string;

  /* ── Config schema gains (per-connector reliability tunables) ── */
  cfgFailureThreshold: string;
  cfgFailureThresholdHelp: string;
  cfgBreakerCooldown: string;
  cfgBreakerCooldownHelp: string;
  cfgDlqMaxAttempts: string;
  cfgDlqMaxAttemptsHelp: string;
  cfgDlqBackoff: string;
  cfgDlqBackoffHelp: string;

  /* ── Shared ── */
  toastReplayed: string;
  toastReplayedAll: string; // "Replayed {replayed}, {failed} still failing"
  toastBreakerReset: string;
  reliabilityError: string;
  manageOnlyNote: string;
  refresh: string;
}

export const reliabilityLabels: { en: ReliabilityLabels; ar: ReliabilityLabels } = {
  en: {
    dlqTitle: 'Dead-letter queue',
    dlqSubtitle: 'Operations that failed every retry. Replay an entry to re-run it.',
    dlqGlobalTitle: 'Dead-letter queue (all integrations)',
    dlqGlobalSubtitle:
      'Every failed operation across this tenant’s integrations, newest first.',
    dlqTab: 'Reliability',
    dlqEmpty: 'No dead-letter entries',
    dlqEmptyHint: 'Operations that exhaust their retries will appear here for replay.',
    dlqColSource: 'Source',
    dlqColSummary: 'Operation',
    dlqColError: 'Error',
    dlqColAttempts: 'Attempts',
    dlqColStatus: 'Status',
    dlqColEndpoint: 'Integration',
    dlqColWhen: 'Failed',
    dlqColActions: 'Actions',
    dlqReplay: 'Replay',
    dlqReplaying: 'Replaying…',
    dlqReplayAll: 'Replay all failed',
    dlqReplayAllRunning: 'Replaying all…',
    dlqReplayAllConfirmTitle: 'Replay all failed entries?',
    dlqReplayAllConfirmBody:
      'This re-runs all {n} failed operations for this integration. Already-resolved entries are skipped.',
    dlqShowPayload: 'Show payload',
    dlqHidePayload: 'Hide payload',
    dlqPayloadTitle: 'Redacted payload',
    dlqLastAttempt: 'Last attempt',
    dlqFailedCount: '{n} failed',

    sourceSync: 'Sync',
    sourceWebhook: 'Webhook',
    sourceOutbox: 'Outbox',
    sourceInvoke: 'Invoke',

    dlqStatusFailed: 'Failed',
    dlqStatusReplayed: 'Replayed',
    dlqStatusResolved: 'Resolved',

    breakerTitle: 'Circuit breaker',
    breakerSubtitle: 'Trips open after repeated failures to protect the connector.',
    breakerUnknown: 'Breaker state unavailable',
    breakerStateLabel: 'State',
    breakerFailures: '{n} / {threshold}',
    breakerFailuresLabel: 'Failures',
    breakerThresholdLabel: 'Threshold',
    breakerOpenedAt: 'Opened',
    breakerCooldown: '{n}s cooldown',
    breakerCooldownLabel: 'Cooldown',
    breakerQuarantined: 'Quarantined',
    breakerNotQuarantined: 'Not quarantined',
    breakerReset: 'Reset breaker',
    breakerResetting: 'Resetting…',
    breakerResetConfirmTitle: 'Reset the circuit breaker?',
    breakerResetConfirmBody:
      'This closes the breaker and clears quarantine. Requests will flow to the connector again immediately.',
    breakerHintClosed: 'Healthy — requests are flowing normally.',
    breakerHintOpen: 'Tripped — requests are short-circuited until the cooldown elapses.',
    breakerHintHalfOpen: 'Probing — a trial request will decide whether to close or re-open.',

    stateClosed: 'Closed',
    stateOpen: 'Open',
    stateHalfOpen: 'Half-open',

    cfgFailureThreshold: 'Failure threshold',
    cfgFailureThresholdHelp: 'Consecutive failures that trip the breaker open (default 5).',
    cfgBreakerCooldown: 'Breaker cooldown (seconds)',
    cfgBreakerCooldownHelp: 'How long the breaker stays open before probing (default 60).',
    cfgDlqMaxAttempts: 'DLQ max attempts',
    cfgDlqMaxAttemptsHelp:
      'Retries before an operation is dead-lettered (default 3).',
    cfgDlqBackoff: 'DLQ backoff (seconds)',
    cfgDlqBackoffHelp: 'Delay between retry attempts (default 30).',

    toastReplayed: 'Entry replayed.',
    toastReplayedAll: 'Replayed {replayed}, {failed} still failing.',
    toastBreakerReset: 'Breaker reset.',
    reliabilityError: 'Something went wrong. Please try again.',
    manageOnlyNote: 'You have read-only access; replay and reset are disabled.',
    refresh: 'Refresh',
  },
  ar: {
    dlqTitle: 'قائمة الرسائل الميتة',
    dlqSubtitle: 'العمليات التي فشلت في كل المحاولات. أعِد تشغيل الإدخال لتنفيذه مجددًا.',
    dlqGlobalTitle: 'قائمة الرسائل الميتة (جميع التكاملات)',
    dlqGlobalSubtitle: 'كل عملية فاشلة عبر تكاملات هذا المستأجر، الأحدث أولًا.',
    dlqTab: 'الموثوقية',
    dlqEmpty: 'لا توجد إدخالات ميتة',
    dlqEmptyHint: 'ستظهر هنا العمليات التي تستنفد محاولاتها لإعادة تشغيلها.',
    dlqColSource: 'المصدر',
    dlqColSummary: 'العملية',
    dlqColError: 'الخطأ',
    dlqColAttempts: 'المحاولات',
    dlqColStatus: 'الحالة',
    dlqColEndpoint: 'التكامل',
    dlqColWhen: 'وقت الفشل',
    dlqColActions: 'الإجراءات',
    dlqReplay: 'إعادة التشغيل',
    dlqReplaying: 'جارٍ إعادة التشغيل…',
    dlqReplayAll: 'إعادة تشغيل كل الفاشلة',
    dlqReplayAllRunning: 'جارٍ إعادة تشغيل الكل…',
    dlqReplayAllConfirmTitle: 'إعادة تشغيل كل الإدخالات الفاشلة؟',
    dlqReplayAllConfirmBody:
      'سيعيد هذا تشغيل كل العمليات الفاشلة البالغة {n} لهذا التكامل. تُتخطّى الإدخالات المُعالَجة سابقًا.',
    dlqShowPayload: 'عرض الحمولة',
    dlqHidePayload: 'إخفاء الحمولة',
    dlqPayloadTitle: 'الحمولة المنقّحة',
    dlqLastAttempt: 'آخر محاولة',
    dlqFailedCount: '{n} فاشلة',

    sourceSync: 'مزامنة',
    sourceWebhook: 'ويب هوك',
    sourceOutbox: 'صندوق الصادر',
    sourceInvoke: 'استدعاء',

    dlqStatusFailed: 'فاشل',
    dlqStatusReplayed: 'أُعيد تشغيله',
    dlqStatusResolved: 'تمت المعالجة',

    breakerTitle: 'قاطع الدارة',
    breakerSubtitle: 'يفتح بعد فشل متكرر لحماية الموصّل.',
    breakerUnknown: 'حالة القاطع غير متاحة',
    breakerStateLabel: 'الحالة',
    breakerFailures: '{n} / {threshold}',
    breakerFailuresLabel: 'حالات الفشل',
    breakerThresholdLabel: 'العتبة',
    breakerOpenedAt: 'وقت الفتح',
    breakerCooldown: 'تهدئة {n} ثانية',
    breakerCooldownLabel: 'فترة التهدئة',
    breakerQuarantined: 'محجوز',
    breakerNotQuarantined: 'غير محجوز',
    breakerReset: 'إعادة ضبط القاطع',
    breakerResetting: 'جارٍ إعادة الضبط…',
    breakerResetConfirmTitle: 'إعادة ضبط قاطع الدارة؟',
    breakerResetConfirmBody:
      'سيغلق هذا القاطع ويلغي الحجز. ستتدفّق الطلبات إلى الموصّل فورًا مجددًا.',
    breakerHintClosed: 'سليم — الطلبات تتدفّق بشكل طبيعي.',
    breakerHintOpen: 'مفتوح — تُقصَّر دائرة الطلبات حتى تنقضي فترة التهدئة.',
    breakerHintHalfOpen: 'يفحص — طلب تجريبي سيقرّر الإغلاق أو إعادة الفتح.',

    stateClosed: 'مغلق',
    stateOpen: 'مفتوح',
    stateHalfOpen: 'نصف مفتوح',

    cfgFailureThreshold: 'عتبة الفشل',
    cfgFailureThresholdHelp: 'عدد حالات الفشل المتتالية التي تفتح القاطع (الافتراضي 5).',
    cfgBreakerCooldown: 'تهدئة القاطع (ثوانٍ)',
    cfgBreakerCooldownHelp: 'مدة بقاء القاطع مفتوحًا قبل الفحص (الافتراضي 60).',
    cfgDlqMaxAttempts: 'أقصى محاولات القائمة الميتة',
    cfgDlqMaxAttemptsHelp: 'عدد المحاولات قبل إدراج العملية في القائمة الميتة (الافتراضي 3).',
    cfgDlqBackoff: 'تراجع القائمة الميتة (ثوانٍ)',
    cfgDlqBackoffHelp: 'التأخير بين محاولات إعادة التشغيل (الافتراضي 30).',

    toastReplayed: 'تمت إعادة تشغيل الإدخال.',
    toastReplayedAll: 'أُعيد تشغيل {replayed}، ولا يزال {failed} فاشلًا.',
    toastBreakerReset: 'تمت إعادة ضبط القاطع.',
    reliabilityError: 'حدث خطأ ما. يُرجى المحاولة مرة أخرى.',
    manageOnlyNote: 'صلاحيتك للقراءة فقط؛ إعادة التشغيل وإعادة الضبط معطّلتان.',
    refresh: 'تحديث',
  },
};

/** Locale-bound accessor for the reliability copy (Arabic-first). */
export function useReliabilityLabels(): ReliabilityLabels {
  const { locale } = useLocaleOrDefault();
  return locale === 'ar' ? reliabilityLabels.ar : reliabilityLabels.en;
}

/** Interpolate `{token}` placeholders (handles one or more distinct tokens). */
export function fillReliabilityToken(
  template: string,
  tokens: Record<string, string | number>,
): string {
  return Object.entries(tokens).reduce(
    (acc, [token, value]) => acc.replace(`{${token}}`, String(value)),
    template,
  );
}

/* --------------------------------------------------------------------------- *
 * StatusBadge config builders for the reliability enums.
 * --------------------------------------------------------------------------- */

import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  CircleSlash,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  Webhook,
  Inbox,
  Send,
  type LucideIcon,
} from 'lucide-react';
import type { StatusConfig } from '@/lib/status-configs';

type BadgeColor = 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'gray' | 'teal';

const DLQ_STATUS_COLOR: Record<DeadLetterStatus, BadgeColor> = {
  failed: 'red',
  replayed: 'blue',
  resolved: 'green',
};

const DLQ_STATUS_ICON: Record<DeadLetterStatus, LucideIcon> = {
  failed: Ban,
  replayed: RefreshCw,
  resolved: CheckCircle2,
};

/** Build the DeadLetterStatus → {label,color,icon} config for the active locale. */
export function buildDlqStatusConfig(t: ReliabilityLabels): StatusConfig {
  return {
    failed: { label: t.dlqStatusFailed, color: DLQ_STATUS_COLOR.failed, icon: DLQ_STATUS_ICON.failed },
    replayed: {
      label: t.dlqStatusReplayed,
      color: DLQ_STATUS_COLOR.replayed,
      icon: DLQ_STATUS_ICON.replayed,
    },
    resolved: {
      label: t.dlqStatusResolved,
      color: DLQ_STATUS_COLOR.resolved,
      icon: DLQ_STATUS_ICON.resolved,
    },
  };
}

const SOURCE_ICON: Record<DeadLetterSource, LucideIcon> = {
  sync: RefreshCw,
  webhook: Webhook,
  outbox: Send,
  invoke: Inbox,
};

/** Lucide icon for a dead-letter source. */
export function sourceIcon(source: DeadLetterSource): LucideIcon {
  return SOURCE_ICON[source] ?? Inbox;
}

/** Localized label for a dead-letter source. */
export function sourceLabel(t: ReliabilityLabels, source: DeadLetterSource): string {
  switch (source) {
    case 'sync':
      return t.sourceSync;
    case 'webhook':
      return t.sourceWebhook;
    case 'outbox':
      return t.sourceOutbox;
    case 'invoke':
      return t.sourceInvoke;
    default:
      return source;
  }
}

const BREAKER_STATE_COLOR: Record<BreakerStateValue, BadgeColor> = {
  closed: 'green',
  open: 'red',
  half_open: 'orange',
};

const BREAKER_STATE_ICON: Record<BreakerStateValue, LucideIcon> = {
  closed: ShieldCheck,
  open: ShieldAlert,
  half_open: ShieldQuestion,
};

/** Build the BreakerStateValue → {label,color,icon} config for the active locale. */
export function buildBreakerStateConfig(t: ReliabilityLabels): StatusConfig {
  return {
    closed: {
      label: t.stateClosed,
      color: BREAKER_STATE_COLOR.closed,
      icon: BREAKER_STATE_ICON.closed,
    },
    open: { label: t.stateOpen, color: BREAKER_STATE_COLOR.open, icon: BREAKER_STATE_ICON.open },
    half_open: {
      label: t.stateHalfOpen,
      color: BREAKER_STATE_COLOR.half_open,
      icon: BREAKER_STATE_ICON.half_open,
    },
  };
}

/** Localized one-line hint describing the current breaker state. */
export function breakerHint(t: ReliabilityLabels, state: BreakerStateValue): string {
  switch (state) {
    case 'open':
      return t.breakerHintOpen;
    case 'half_open':
      return t.breakerHintHalfOpen;
    case 'closed':
    default:
      return t.breakerHintClosed;
  }
}

/** The quarantine chip icon (a distinct affordance from the state badge). */
export const QuarantineIcon: LucideIcon = AlertTriangle;
/** The not-quarantined affordance icon. */
export const ClearIcon: LucideIcon = CircleSlash;
