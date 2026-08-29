/**
 * Page-local bilingual (AR — MSA / EN) labels for the integration Sync + activity
 * logs page (`[id]/logs`).
 *
 * Deliberately kept module-local (NOT in the shared `_labels.ts` nor in
 * `@/lib/i18n/messages`): the integrator owns the shared catalog and sibling
 * console pages also import the shared `integrationLabels`, so adding page-only
 * copy here avoids editing a file other agents touch. Strings that already live
 * in the shared `integrationLabels` (ledger columns, sync statuses, modes, the
 * back-to-list / refresh actions, empty/error states) are re-used from there;
 * this module only adds copy that is unique to the logs page (the test-results
 * timeline section + a couple of run-detail affordances).
 *
 * Arabic-first: `ar` is the platform default; resolve at the call site:
 *   const t = locale === 'ar' ? logsLabels.ar : logsLabels.en;
 */

export interface IntegrationLogsLabels {
  /* ── Page header ── */
  pageEyebrow: string;
  pageTitle: string; // "Sync & activity"
  pageSubtitle: string;

  /* ── Ledger KPI strip ── */
  kpiRuns: string;
  kpiRunsHint: string;
  kpiSucceeded: string;
  kpiPartial: string;
  kpiFailed: string;
  kpiLastRun: string;
  kpiLastRunHint: string;
  kpiNever: string;

  /* ── Ledger table extras ── */
  ledgerColDuration: string;
  ledgerColWarnings: string;
  ledgerWarnNone: string;
  ledgerWarnFailed: string; // "{n} failed"
  ledgerRowError: string; // expand label for an error detail
  ledgerWatermark: string;

  /* ── Preview run flag (ledger) ── */
  previewBadge: string; // "Preview" pill on a dry-run ledger row
  previewBadgeHint: string; // tooltip/aria on the preview pill

  /* ── Sync-preview dialog ── */
  previewTitle: string;
  previewSubtitle: string;
  previewOpen: string; // trigger label "Preview sync"
  previewLoading: string;
  previewErrorTitle: string;
  previewErrorBody: string;
  previewDryRunBadge: string; // "Dry run"
  previewDryRunNote: string; // "Commits nothing — this is a simulation"
  previewWouldCreate: string;
  previewWouldUpdate: string;
  previewWouldDeactivate: string;
  previewWouldSkip: string;
  previewProcessed: string;
  previewWouldFail: string;
  previewNoChangesTitle: string;
  previewNoChangesBody: string;
  previewConfirmRun: string; // "Confirm & run sync"
  previewConfirmRunning: string;
  previewRerun: string; // re-run the preview
  previewClose: string;
  previewModeLabel: string; // which real mode the confirm will run
  previewSummaryHeading: string; // "What this sync would do"
  toastPreviewDone: string;
  toastSyncDone: string;

  /* ── Reconciliation panel ── */
  reconTitle: string;
  reconSubtitle: string;
  reconRun: string; // "Run reconciliation"
  reconRunning: string;
  reconRefresh: string;
  reconLoading: string;
  reconErrorTitle: string;
  reconErrorBody: string;
  reconCleanTitle: string;
  reconCleanBody: string;
  reconGapsHeading: string; // "Gaps — present externally, missing in Lex"
  reconConflictsHeading: string; // "Conflicts — diverging values"
  reconGapsCount: string; // "{n} gaps"
  reconConflictsCount: string; // "{n} conflicts"
  reconColExternalId: string;
  reconColLexKind: string;
  reconColIssue: string;
  reconColDetail: string;
  reconColSuggested: string;
  reconNoSuggestion: string;
  reconGroupCount: string; // "{n}"
  reconSummaryHeading: string;
  reconIdleTitle: string;
  reconIdleBody: string;

  /* ── Test-results timeline ── */
  testsTitle: string;
  testsSubtitle: string;
  testsRunNow: string;
  testsRunning: string;
  testsEmptyTitle: string;
  testsEmptyBody: string;
  testReachable: string;
  testUnreachable: string;
  testLatency: string; // "{ms} ms"
  testSamples: string; // "{n} records"
  testJustNow: string;
  testLocalNote: string; // results are session-local

  /* ── Generic ── */
  unknownDuration: string;
}

export const logsLabels: { en: IntegrationLogsLabels; ar: IntegrationLogsLabels } = {
  en: {
    pageEyebrow: 'Integration',
    pageTitle: 'Sync & activity',
    pageSubtitle:
      'Recorded sync runs and recent connection tests for this endpoint, newest first.',

    kpiRuns: 'Total runs',
    kpiRunsHint: 'Recorded sync runs in the ledger',
    kpiSucceeded: 'Succeeded',
    kpiPartial: 'Partial',
    kpiFailed: 'Failed',
    kpiLastRun: 'Last run',
    kpiLastRunHint: 'Most recent recorded sync',
    kpiNever: 'Never',

    ledgerColDuration: 'Duration',
    ledgerColWarnings: 'Warnings',
    ledgerWarnNone: 'None',
    ledgerWarnFailed: '{n} failed',
    ledgerRowError: 'Error',
    ledgerWatermark: 'Cursor',

    previewBadge: 'Preview',
    previewBadgeHint: 'Dry run — committed nothing',

    previewTitle: 'Preview sync',
    previewSubtitle:
      'Simulate the sync and see what it would change before committing anything.',
    previewOpen: 'Preview sync',
    previewLoading: 'Calculating what would change…',
    previewErrorTitle: 'Could not run preview',
    previewErrorBody:
      'The dry-run request failed. Retry, or check that the connector is reachable.',
    previewDryRunBadge: 'Dry run',
    previewDryRunNote: 'This is a simulation — nothing has been written.',
    previewWouldCreate: 'Would create',
    previewWouldUpdate: 'Would update',
    previewWouldDeactivate: 'Would deactivate',
    previewWouldSkip: 'Would skip',
    previewProcessed: 'Records examined',
    previewWouldFail: 'Would fail',
    previewNoChangesTitle: 'No changes',
    previewNoChangesBody:
      'A real sync would not create, update, or deactivate anything right now.',
    previewConfirmRun: 'Confirm & run sync',
    previewConfirmRunning: 'Running sync…',
    previewRerun: 'Re-run preview',
    previewClose: 'Close',
    previewModeLabel: 'Confirming runs a {mode} sync',
    previewSummaryHeading: 'What this sync would do',
    toastPreviewDone: 'Preview complete — nothing was changed.',
    toastSyncDone: 'Sync complete.',

    reconTitle: 'Reconciliation',
    reconSubtitle:
      'Compare the external system against Lex and surface gaps and conflicts.',
    reconRun: 'Run reconciliation',
    reconRunning: 'Reconciling…',
    reconRefresh: 'Re-run',
    reconLoading: 'Comparing records…',
    reconErrorTitle: 'Could not load reconciliation',
    reconErrorBody:
      'The reconciliation request failed. Retry, or check that the connector is reachable.',
    reconCleanTitle: 'Everything is in sync',
    reconCleanBody: 'No gaps or conflicts were found between the external system and Lex.',
    reconGapsHeading: 'Gaps',
    reconConflictsHeading: 'Conflicts',
    reconGapsCount: '{n} gaps',
    reconConflictsCount: '{n} conflicts',
    reconColExternalId: 'External ID',
    reconColLexKind: 'Lex entity',
    reconColIssue: 'Issue',
    reconColDetail: 'Detail',
    reconColSuggested: 'Suggested action',
    reconNoSuggestion: 'No suggestion',
    reconGroupCount: '{n}',
    reconSummaryHeading: 'Summary',
    reconIdleTitle: 'Reconciliation not run yet',
    reconIdleBody:
      'Run a reconciliation to compare external records against Lex and review gaps and conflicts.',

    testsTitle: 'Connection tests',
    testsSubtitle: 'On-demand reachability probes you have run this session.',
    testsRunNow: 'Run test',
    testsRunning: 'Testing…',
    testsEmptyTitle: 'No tests run yet',
    testsEmptyBody:
      'Run a connection test to probe reachability, latency, and a sample record count. Results appear here for this session.',
    testReachable: 'Reachable',
    testUnreachable: 'Unreachable',
    testLatency: '{ms} ms',
    testSamples: '{n} records',
    testJustNow: 'Just now',
    testLocalNote: 'Test results are kept for this session only.',

    unknownDuration: '—',
  },
  ar: {
    pageEyebrow: 'تكامل',
    pageTitle: 'المزامنة والنشاط',
    pageSubtitle:
      'عمليات المزامنة المسجّلة واختبارات الاتصال الأخيرة لهذه النقطة، الأحدث أولًا.',

    kpiRuns: 'إجمالي العمليات',
    kpiRunsHint: 'عمليات المزامنة المسجّلة في السجل',
    kpiSucceeded: 'ناجحة',
    kpiPartial: 'جزئية',
    kpiFailed: 'فاشلة',
    kpiLastRun: 'آخر تشغيل',
    kpiLastRunHint: 'أحدث مزامنة مسجّلة',
    kpiNever: 'لا يوجد',

    ledgerColDuration: 'المدة',
    ledgerColWarnings: 'التحذيرات',
    ledgerWarnNone: 'لا يوجد',
    ledgerWarnFailed: '{n} فاشلة',
    ledgerRowError: 'خطأ',
    ledgerWatermark: 'المؤشّر',

    previewBadge: 'معاينة',
    previewBadgeHint: 'تشغيل تجريبي — لم يُكتب شيء',

    previewTitle: 'معاينة المزامنة',
    previewSubtitle: 'حاكِ المزامنة واطّلع على ما ستغيّره قبل الالتزام بأي شيء.',
    previewOpen: 'معاينة المزامنة',
    previewLoading: 'جارٍ حساب ما سيتغيّر…',
    previewErrorTitle: 'تعذّر تشغيل المعاينة',
    previewErrorBody: 'فشل طلب التشغيل التجريبي. أعد المحاولة أو تأكّد من إمكانية الوصول إلى الموصّل.',
    previewDryRunBadge: 'تشغيل تجريبي',
    previewDryRunNote: 'هذه محاكاة — لم تُكتب أي بيانات.',
    previewWouldCreate: 'سيُنشئ',
    previewWouldUpdate: 'سيُحدّث',
    previewWouldDeactivate: 'سيُعطّل',
    previewWouldSkip: 'سيتجاوز',
    previewProcessed: 'السجلات المفحوصة',
    previewWouldFail: 'سيفشل',
    previewNoChangesTitle: 'لا تغييرات',
    previewNoChangesBody: 'لن تُنشئ المزامنة الفعلية أو تُحدّث أو تُعطّل أي شيء حاليًا.',
    previewConfirmRun: 'تأكيد وتشغيل المزامنة',
    previewConfirmRunning: 'جارٍ تشغيل المزامنة…',
    previewRerun: 'إعادة المعاينة',
    previewClose: 'إغلاق',
    previewModeLabel: 'سيؤدي التأكيد إلى تشغيل مزامنة {mode}',
    previewSummaryHeading: 'ما ستفعله هذه المزامنة',
    toastPreviewDone: 'اكتملت المعاينة — لم يتغيّر شيء.',
    toastSyncDone: 'اكتملت المزامنة.',

    reconTitle: 'المطابقة',
    reconSubtitle: 'قارن النظام الخارجي بنظام Lex واكشف الفجوات والتعارضات.',
    reconRun: 'تشغيل المطابقة',
    reconRunning: 'جارٍ المطابقة…',
    reconRefresh: 'إعادة التشغيل',
    reconLoading: 'جارٍ مقارنة السجلات…',
    reconErrorTitle: 'تعذّر تحميل المطابقة',
    reconErrorBody: 'فشل طلب المطابقة. أعد المحاولة أو تأكّد من إمكانية الوصول إلى الموصّل.',
    reconCleanTitle: 'كل شيء متزامن',
    reconCleanBody: 'لم يُعثر على أي فجوات أو تعارضات بين النظام الخارجي وLEX.',
    reconGapsHeading: 'الفجوات',
    reconConflictsHeading: 'التعارضات',
    reconGapsCount: '{n} فجوات',
    reconConflictsCount: '{n} تعارضات',
    reconColExternalId: 'المعرّف الخارجي',
    reconColLexKind: 'كيان Lex',
    reconColIssue: 'المشكلة',
    reconColDetail: 'التفاصيل',
    reconColSuggested: 'الإجراء المقترح',
    reconNoSuggestion: 'لا يوجد اقتراح',
    reconGroupCount: '{n}',
    reconSummaryHeading: 'الملخّص',
    reconIdleTitle: 'لم تُشغَّل المطابقة بعد',
    reconIdleBody: 'شغّل المطابقة لمقارنة السجلات الخارجية بنظام Lex ومراجعة الفجوات والتعارضات.',

    testsTitle: 'اختبارات الاتصال',
    testsSubtitle: 'فحوصات الوصول حسب الطلب التي شغّلتها في هذه الجلسة.',
    testsRunNow: 'تشغيل اختبار',
    testsRunning: 'جارٍ الاختبار…',
    testsEmptyTitle: 'لم تُشغَّل أي اختبارات بعد',
    testsEmptyBody:
      'شغّل اختبار اتصال لفحص قابلية الوصول وزمن الاستجابة وعدد السجلات النموذجية. تظهر النتائج هنا لهذه الجلسة.',
    testReachable: 'قابل للوصول',
    testUnreachable: 'غير قابل للوصول',
    testLatency: '{ms} مللي ثانية',
    testSamples: '{n} سجلات',
    testJustNow: 'الآن',
    testLocalNote: 'تُحفَظ نتائج الاختبار لهذه الجلسة فقط.',

    unknownDuration: '—',
  },
};

export type LogsLang = 'ar' | 'en';

/** Resolve the page-local labels for the active locale. */
export function useLogsLabels(lang: LogsLang): IntegrationLogsLabels {
  return lang === 'ar' ? logsLabels.ar : logsLabels.en;
}

/** Simple `{token}` interpolation helper (mirrors the shared label call style). */
export function interpolate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    key in vars ? String(vars[key]) : `{${key}}`,
  );
}
