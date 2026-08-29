'use client';

/**
 * Scoped bilingual (AR — MSA / EN) labels for the detail-page OPERATIONS surface
 * (diagnostics checklist, webhook helper, secret rotation, sandbox simulator,
 * activity timeline, health-history chart) — features 2, 3, 6, 7, 9, 10.
 *
 * Kept in its own module (NOT folded into `_labels.ts`) on purpose: `_labels.ts`
 * is concurrently owned/extended by the sibling list/catalog/wizard/mapper units,
 * so this surface keeps its copy local to avoid merge collisions. Same pattern as
 * the coexisting `integrations-i18n.ts`. The shared `@/lib/i18n/messages` catalog
 * is NOT touched (the integrator owns that; proposed shared keys are in the
 * manifest). All copy is plain strings (no JSX), RTL-safe; one `{token}` is
 * interpolated with {@link fillToken}.
 */
import { useLocaleOrDefault } from '@/components/providers/locale-provider';

export interface DetailOpsLabels {
  /* ── Diagnostic checklist (Feature 2 — TestResult.steps) ── */
  diagnosticsTitle: string;
  diagnosticsSubtitle: string;
  diagnosticsRun: string;
  diagnosticsRerun: string;
  diagnosticsRunning: string;
  diagnosticsEmpty: string; // not run yet
  diagnosticsNoSteps: string; // ran, backend returned no steps
  diagnosticsReachable: string;
  diagnosticsUnreachable: string;
  diagnosticsUnsupported: string;
  diagnosticStepOk: string;
  diagnosticStepWarn: string;
  diagnosticStepFail: string;
  diagnosticStepSkip: string;
  diagnosticHintLabel: string;
  diagnosticLatency: string; // "{ms} ms"
  diagnosticSamples: string; // "{n} records"

  /* ── Webhook helper (Feature 3) ── */
  webhookTitle: string;
  webhookSubtitle: string;
  webhookNoTemplates: string;
  webhookCopy: string;
  webhookCopied: string;
  webhookSendTest: string;
  webhookSending: string;
  webhookLastReceived: string; // "Last event {ago}"
  webhookNeverReceived: string;
  webhookTestOk: string;
  webhookTestFailed: string;
  webhookResultTitle: string;

  /* ── Secret rotation (Feature 7) ── */
  rotateTitle: string;
  rotateSubtitle: string;
  rotateOpen: string;
  rotateDialogTitle: string;
  rotateDialogBody: string;
  rotateField: string;
  rotateFieldPlaceholder: string;
  rotateNewValue: string;
  rotateNewValuePlaceholder: string;
  rotateTestFirst: string;
  rotateConfirm: string;
  rotating: string;
  rotateCancel: string;
  rotateNoSecrets: string;
  rotateLastRotated: string; // "Last rotated {ago}"
  rotateNeverRotated: string;
  rotateExpiryWarning: string; // "Expires {when}"
  rotateExpired: string;
  rotateNeverShowOld: string;
  rotateEmptyValue: string;

  /* ── Sandbox simulator (Feature 9) ── */
  sandboxTitle: string;
  sandboxSubtitle: string;
  sandboxBadge: string;
  sandboxBadgeNote: string;
  sandboxRun: string;
  sandboxRunning: string;
  sandboxOpLabel: string;
  sandboxResultTitle: string;
  sandboxOk: string;
  sandboxFailed: string;
  // Nafath ops
  sandboxNafathRequest: string;
  sandboxNafathStatus: string;
  sandboxNafathTransId: string;
  sandboxNafathRandom: string;
  sandboxNafathHint: string;
  // Najiz ops
  sandboxNajizHearings: string;
  sandboxNajizHint: string;

  /* ── Activity timeline (Feature 10) ── */
  activityTitle: string;
  activitySubtitle: string;
  activityEmpty: string;
  activitySystemActor: string;
  activityShowDetail: string;
  activityHideDetail: string;

  /* ── Health history chart (Feature 6 detail) ── */
  healthHistoryTitle: string;
  healthHistorySubtitle: string;
  healthHistoryEmpty: string;
  healthHistoryUptime: string; // "{pct}% reachable"
  healthHistoryLatest: string;

  /* ── Shared ── */
  toastWebhookSent: string;
  toastSecretRotated: string;
  toastSandboxDone: string;
  opsError: string;
  manageOnlyNote: string;
}

export const detailOpsLabels: { en: DetailOpsLabels; ar: DetailOpsLabels } = {
  en: {
    diagnosticsTitle: 'Connection diagnostics',
    diagnosticsSubtitle:
      'Layered checks — reachable, authenticated, authorized, sample fetch.',
    diagnosticsRun: 'Run diagnostics',
    diagnosticsRerun: 'Re-run diagnostics',
    diagnosticsRunning: 'Running checks…',
    diagnosticsEmpty: 'Run the diagnostics to see a per-step checklist.',
    diagnosticsNoSteps:
      'The connector returned an overall result but no per-step breakdown.',
    diagnosticsReachable: 'Endpoint reachable',
    diagnosticsUnreachable: 'Endpoint unreachable',
    diagnosticsUnsupported: 'Diagnostics not supported for this connector.',
    diagnosticStepOk: 'OK',
    diagnosticStepWarn: 'Warning',
    diagnosticStepFail: 'Failed',
    diagnosticStepSkip: 'Skipped',
    diagnosticHintLabel: 'How to fix',
    diagnosticLatency: '{ms} ms',
    diagnosticSamples: '{n} records',

    webhookTitle: 'Inbound endpoints',
    webhookSubtitle:
      'Callback / redirect / SCIM URLs for this connector. Register these with the provider.',
    webhookNoTemplates: 'This connector does not expose inbound URLs.',
    webhookCopy: 'Copy URL',
    webhookCopied: 'Copied',
    webhookSendTest: 'Send test event',
    webhookSending: 'Sending…',
    webhookLastReceived: 'Last event {ago}',
    webhookNeverReceived: 'No inbound event received yet',
    webhookTestOk: 'Synthetic event delivered.',
    webhookTestFailed: 'Synthetic event was not accepted.',
    webhookResultTitle: 'Test event result',

    rotateTitle: 'Secret rotation',
    rotateSubtitle: 'Replace a stored credential without exposing the current value.',
    rotateOpen: 'Rotate a secret',
    rotateDialogTitle: 'Rotate secret',
    rotateDialogBody:
      'The current value is never shown. Enter the new value, test, then rotate.',
    rotateField: 'Secret field',
    rotateFieldPlaceholder: 'Select a secret…',
    rotateNewValue: 'New value',
    rotateNewValuePlaceholder: 'Enter the new secret value',
    rotateTestFirst: 'Test connection',
    rotateConfirm: 'Rotate',
    rotating: 'Rotating…',
    rotateCancel: 'Cancel',
    rotateNoSecrets: 'This connector has no secret fields to rotate.',
    rotateLastRotated: 'Last rotated {ago}',
    rotateNeverRotated: 'Never rotated',
    rotateExpiryWarning: 'Expires {when}',
    rotateExpired: 'This secret has expired — rotate it now.',
    rotateNeverShowOld: 'For security, the stored secret is never displayed.',
    rotateEmptyValue: 'Enter a new value before rotating.',

    sandboxTitle: 'Sandbox simulator',
    sandboxSubtitle: 'Run mock connector operations without touching production.',
    sandboxBadge: 'SANDBOX',
    sandboxBadgeNote:
      'All calls here are simulated — nothing is sent to the real government service.',
    sandboxRun: 'Run',
    sandboxRunning: 'Running…',
    sandboxOpLabel: 'Operation',
    sandboxResultTitle: 'Result',
    sandboxOk: 'Mock call succeeded',
    sandboxFailed: 'Mock call failed',
    sandboxNafathRequest: 'Request identity confirmation',
    sandboxNafathStatus: 'Poll confirmation status',
    sandboxNafathTransId: 'Transaction ID',
    sandboxNafathRandom: 'Number-match code',
    sandboxNafathHint:
      'Simulates a Nafath confirmation request and the number-match prompt.',
    sandboxNajizHearings: 'Pull hearings',
    sandboxNajizHint: 'Returns a mock list of upcoming hearings from Najiz.',

    activityTitle: 'Activity',
    activitySubtitle: 'Who changed what, and when, for this endpoint.',
    activityEmpty: 'No activity recorded yet.',
    activitySystemActor: 'System',
    activityShowDetail: 'Show detail',
    activityHideDetail: 'Hide detail',

    healthHistoryTitle: 'Health history',
    healthHistorySubtitle: 'Recent reachability probes for this endpoint.',
    healthHistoryEmpty: 'No health probes recorded yet.',
    healthHistoryUptime: '{pct}% reachable',
    healthHistoryLatest: 'Latest',

    toastWebhookSent: 'Test event sent.',
    toastSecretRotated: 'Secret rotated.',
    toastSandboxDone: 'Sandbox call complete.',
    opsError: 'Something went wrong. Please try again.',
    manageOnlyNote: 'You have read-only access; these operations are disabled.',
  },
  ar: {
    diagnosticsTitle: 'تشخيص الاتصال',
    diagnosticsSubtitle:
      'فحوص متدرّجة — قابلية الوصول، المصادقة، التفويض، جلب عيّنة.',
    diagnosticsRun: 'تشغيل التشخيص',
    diagnosticsRerun: 'إعادة التشخيص',
    diagnosticsRunning: 'جارٍ تنفيذ الفحوص…',
    diagnosticsEmpty: 'شغّل التشخيص لعرض قائمة فحص لكل خطوة.',
    diagnosticsNoSteps: 'أعاد الموصّل نتيجة إجمالية دون تفصيل لكل خطوة.',
    diagnosticsReachable: 'النقطة قابلة للوصول',
    diagnosticsUnreachable: 'النقطة غير قابلة للوصول',
    diagnosticsUnsupported: 'التشخيص غير مدعوم لهذا الموصّل.',
    diagnosticStepOk: 'سليم',
    diagnosticStepWarn: 'تحذير',
    diagnosticStepFail: 'فشل',
    diagnosticStepSkip: 'تم التخطّي',
    diagnosticHintLabel: 'كيفية الإصلاح',
    diagnosticLatency: '{ms} مللي ثانية',
    diagnosticSamples: '{n} سجلات',

    webhookTitle: 'النقاط الواردة',
    webhookSubtitle:
      'روابط الاستدعاء / إعادة التوجيه / SCIM لهذا الموصّل. سجّلها لدى المزوّد.',
    webhookNoTemplates: 'لا يوفّر هذا الموصّل روابط واردة.',
    webhookCopy: 'نسخ الرابط',
    webhookCopied: 'تم النسخ',
    webhookSendTest: 'إرسال حدث تجريبي',
    webhookSending: 'جارٍ الإرسال…',
    webhookLastReceived: 'آخر حدث {ago}',
    webhookNeverReceived: 'لم يُستقبَل أي حدث وارد بعد',
    webhookTestOk: 'تم تسليم الحدث التجريبي.',
    webhookTestFailed: 'لم يُقبَل الحدث التجريبي.',
    webhookResultTitle: 'نتيجة الحدث التجريبي',

    rotateTitle: 'تدوير السر',
    rotateSubtitle: 'استبدل بيانات اعتماد مخزّنة دون كشف القيمة الحالية.',
    rotateOpen: 'تدوير سرّ',
    rotateDialogTitle: 'تدوير السر',
    rotateDialogBody:
      'لا تُعرض القيمة الحالية أبدًا. أدخل القيمة الجديدة، اختبر، ثم دوّر.',
    rotateField: 'حقل السر',
    rotateFieldPlaceholder: 'اختر سرًّا…',
    rotateNewValue: 'القيمة الجديدة',
    rotateNewValuePlaceholder: 'أدخل قيمة السر الجديدة',
    rotateTestFirst: 'اختبار الاتصال',
    rotateConfirm: 'تدوير',
    rotating: 'جارٍ التدوير…',
    rotateCancel: 'إلغاء',
    rotateNoSecrets: 'لا توجد حقول سرّية لتدويرها في هذا الموصّل.',
    rotateLastRotated: 'آخر تدوير {ago}',
    rotateNeverRotated: 'لم يُدوَّر بعد',
    rotateExpiryWarning: 'تنتهي الصلاحية {when}',
    rotateExpired: 'انتهت صلاحية هذا السر — دوّره الآن.',
    rotateNeverShowOld: 'لأسباب أمنية، لا يُعرض السر المخزّن أبدًا.',
    rotateEmptyValue: 'أدخل قيمة جديدة قبل التدوير.',

    sandboxTitle: 'محاكي البيئة التجريبية',
    sandboxSubtitle: 'شغّل عمليات الموصّل الوهمية دون المساس بالإنتاج.',
    sandboxBadge: 'تجريبي',
    sandboxBadgeNote:
      'جميع الاستدعاءات هنا محاكاة — لا يُرسَل شيء إلى الخدمة الحكومية الفعلية.',
    sandboxRun: 'تشغيل',
    sandboxRunning: 'جارٍ التشغيل…',
    sandboxOpLabel: 'العملية',
    sandboxResultTitle: 'النتيجة',
    sandboxOk: 'نجح الاستدعاء الوهمي',
    sandboxFailed: 'فشل الاستدعاء الوهمي',
    sandboxNafathRequest: 'طلب تأكيد الهوية',
    sandboxNafathStatus: 'استعلام حالة التأكيد',
    sandboxNafathTransId: 'معرّف العملية',
    sandboxNafathRandom: 'رقم المطابقة',
    sandboxNafathHint: 'يحاكي طلب تأكيد نفاذ ومطالبة مطابقة الرقم.',
    sandboxNajizHearings: 'جلب الجلسات',
    sandboxNajizHint: 'يعيد قائمة وهمية بالجلسات القادمة من ناجز.',

    activityTitle: 'النشاط',
    activitySubtitle: 'من غيّر ماذا، ومتى، لهذه النقطة.',
    activityEmpty: 'لم يُسجَّل أي نشاط بعد.',
    activitySystemActor: 'النظام',
    activityShowDetail: 'عرض التفاصيل',
    activityHideDetail: 'إخفاء التفاصيل',

    healthHistoryTitle: 'سجل الصحة',
    healthHistorySubtitle: 'أحدث فحوص قابلية الوصول لهذه النقطة.',
    healthHistoryEmpty: 'لم تُسجَّل أي فحوص صحة بعد.',
    healthHistoryUptime: '{pct}% قابل للوصول',
    healthHistoryLatest: 'الأحدث',

    toastWebhookSent: 'تم إرسال الحدث التجريبي.',
    toastSecretRotated: 'تم تدوير السر.',
    toastSandboxDone: 'اكتمل استدعاء البيئة التجريبية.',
    opsError: 'حدث خطأ ما. يُرجى المحاولة مرة أخرى.',
    manageOnlyNote: 'صلاحيتك للقراءة فقط؛ هذه العمليات معطّلة.',
  },
};

/** Locale-bound accessor for the detail-ops copy (Arabic-first). */
export function useDetailOpsLabels(): DetailOpsLabels {
  const { locale } = useLocaleOrDefault();
  return locale === 'ar' ? detailOpsLabels.ar : detailOpsLabels.en;
}

/** Interpolate a single `{token}` placeholder. */
export function fillOpsToken(
  template: string,
  token: string,
  value: string | number,
): string {
  return template.replace(`{${token}}`, String(value));
}
