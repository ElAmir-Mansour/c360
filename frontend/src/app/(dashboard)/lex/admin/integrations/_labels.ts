/**
 * Bilingual (AR — MSA / EN) labels for the admin/integrations console.
 *
 * Arabic-first: `ar` is the platform default locale; `en` is the fallback.
 * Resolved at the call site via the active locale:
 *
 *   const t = locale === 'ar' ? integrationLabels.ar : integrationLabels.en;
 *
 * Kept module-local on purpose — this is a suite-specific admin feature and must
 * NOT touch the shared `@/lib/i18n/messages` catalog (the integrator owns that;
 * proposed shared keys are listed in the manifest). All copy here is plain
 * strings (no JSX) so it stays portable and RTL-safe. Per-kind display names and
 * blurbs live in `_lib/integration-kinds.ts`, not here.
 */

export interface IntegrationConsoleLabels {
  /* ── Page header / nav ── */
  title: string;
  subtitle: string;
  breadcrumb: string;
  refresh: string;
  newIntegration: string;
  backToList: string;

  /* ── KPI strip (per health grade) ── */
  kpiTotal: string;
  kpiHealthy: string;
  kpiDegraded: string;
  kpiDown: string;
  kpiUnconfigured: string;
  kpiDisabled: string;
  kpiTotalHint: string;
  kpiHealthyHint: string;
  kpiDegradedHint: string;
  kpiDownHint: string;
  kpiUnconfiguredHint: string;
  kpiDisabledHint: string;

  /* ── Grouped-by-kind card list ── */
  groupAll: string;
  cardLastChecked: string;
  cardNeverChecked: string;
  cardConfigure: string;
  cardCount: string; // "{n} endpoints"
  govGatedBadge: string;
  govGatedHint: string;

  /* ── Status badges (IntegrationStatus) ── */
  statusPlanned: string;
  statusActive: string;
  statusDisabled: string;
  statusError: string;

  /* ── Health grades (IntegrationHealthGrade) ── */
  gradeHealthy: string;
  gradeDegraded: string;
  gradeDown: string;
  gradeUnconfigured: string;
  gradeDisabled: string;

  /* ── Detail / form ── */
  detailTitle: string;
  formName: string;
  formCode: string;
  formCodeHint: string;
  formKind: string;
  formDescription: string;
  formStatus: string;
  formConfigSection: string;
  formMetadataSection: string;
  formRequired: string;
  formOptional: string;
  formSelectPlaceholder: string;
  save: string;
  saving: string;
  cancel: string;
  create: string;
  creating: string;
  deleteAction: string;
  deleting: string;
  deleteConfirmTitle: string;
  deleteConfirmBody: string;

  /* ── Secret / write-only fields ── */
  secretSet: string; // "•••••• (set)"
  secretReplace: string;
  secretKeepHint: string; // leaving sentinel keeps stored secret
  secretEnterNew: string;
  secretUndoReplace: string;

  /* ── Right-rail Connection panel ── */
  connectionPanelTitle: string;
  envBadgeProd: string;
  envBadgeSandbox: string;
  testConnection: string;
  testing: string;
  testReachable: string;
  testUnreachable: string;
  testUnsupported: string;
  testLatency: string; // "{ms} ms"
  testSamples: string; // "{n} records observed"
  testLastChecked: string;
  healthLabel: string;
  enable: string;
  disable: string;
  enabling: string;
  disabling: string;
  syncNow: string;
  syncFull: string;
  syncDelta: string;
  syncing: string;

  /* ── Sync-run ledger ── */
  ledgerTitle: string;
  ledgerSubtitle: string;
  ledgerColWhen: string;
  ledgerColMode: string;
  ledgerColStatus: string;
  ledgerColProcessed: string;
  ledgerColCreated: string;
  ledgerColUpdated: string;
  ledgerColSkipped: string;
  ledgerColFailed: string;
  ledgerColDetail: string;
  syncStatusSucceeded: string;
  syncStatusPartial: string;
  syncStatusFailed: string;
  modeFull: string;
  modeDelta: string;

  /* ── Empty / error / degraded states ── */
  emptyTitle: string;
  emptyBody: string;
  emptyCta: string;
  schemaMissingTitle: string;
  schemaMissingBody: string;
  loadErrorTitle: string;
  loadErrorBody: string;
  notFoundTitle: string;
  notFoundBody: string;
  ledgerEmpty: string;
  healthUnknown: string;

  /* ── Toasts ── */
  toastCreated: string;
  toastUpdated: string;
  toastDeleted: string;
  toastEnabled: string;
  toastDisabled: string;
  toastTestDone: string;
  toastSyncStarted: string;
  toastSyncDone: string;
  toastError: string;

  /* ── Access ── */
  readOnlyNote: string;

  /* ── Catalog gallery (Feature 8) ── */
  catalogTitle: string;
  catalogSubtitle: string;
  catalogSearchPlaceholder: string;
  catalogFilterAll: string;
  catalogFilterSelfServe: string;
  catalogFilterGovGated: string;
  catalogSelfServeBadge: string;
  catalogSelfServeHint: string;
  catalogMaturityProduction: string;
  catalogMaturityGovGated: string;
  catalogPrereqCount: string; // "{n} prerequisites"
  catalogConfigure: string;
  catalogEmptyTitle: string;
  catalogEmptyBody: string;
  catalogErrorTitle: string;
  catalogErrorBody: string;

  /* ── Setup wizard (Feature 1) ── */
  wizardStepPrereq: string;
  wizardStepCredentials: string;
  wizardStepTest: string;
  wizardStepEnable: string;
  wizardStepSync: string;
  wizardStepPrereqDesc: string;
  wizardStepCredentialsDesc: string;
  wizardStepTestDesc: string;
  wizardStepEnableDesc: string;
  wizardStepSyncDesc: string;
  wizardStepLabel: string; // "Step {n} of {total}"
  wizardNext: string;
  wizardBack: string;
  wizardSkip: string;
  wizardFinish: string;
  wizardPrereqIntro: string;
  wizardPrereqAck: string; // "I have completed all prerequisites"
  wizardPrereqNone: string;
  wizardCallbacksTitle: string;
  wizardCallbacksHint: string;
  wizardCopy: string;
  wizardCopied: string;
  wizardCreateFirst: string; // hint: save the connector before testing
  wizardCreatedNotice: string;
  wizardTestIntro: string;
  wizardTestSkipNote: string;
  wizardEnableIntro: string;
  wizardEnableAction: string;
  wizardEnabledNotice: string;
  wizardStillPlannedNotice: string;
  wizardSyncIntro: string;
  wizardSyncSkipNote: string;
  wizardSyncRunFull: string;
  wizardSyncRunDelta: string;
  wizardDoneTitle: string;
  wizardDoneBody: string;
  wizardGoToDetail: string;
  wizardChangeKind: string;

  /* ── Diagnostic checklist (inline test result) ── */
  diagTitle: string;
  diagRun: string;
  diagRunning: string;
  diagRerun: string;
  diagStatusOk: string;
  diagStatusWarn: string;
  diagStatusFail: string;
  diagStatusSkip: string;
  diagReachable: string;
  diagUnreachable: string;
  diagNoSteps: string;
  diagHint: string;

  /* ── Field mapper (Feature 4) ── */
  mapperTitle: string;
  mapperIntro: string;
  mapperSourceField: string;
  mapperLexField: string;
  mapperSourcePlaceholder: string;
  mapperAddRow: string;
  mapperRemoveRow: string;
  mapperUnmapped: string;
  mapperLexExternalId: string;
  mapperLexManager: string;
  mapperLexDepartment: string;
  mapperLexOrgUnit: string;
  mapperLexEmail: string;
  mapperLexDisplayName: string;
  mapperEmpty: string;
  mapperDuplicateSource: string;
  mapperRawToggle: string;
  mapperGuidedToggle: string;
  mapperRequiredLex: string; // marks externalId required

  /* ── Mass-change guard (#20) — surfaced on a blocked sync ── */
  guardBlockedTitle: string;
  guardBlockedBody: string; // "Would deactivate {pct}% of mapped entities"
}

export const integrationLabels: {
  en: IntegrationConsoleLabels;
  ar: IntegrationConsoleLabels;
} = {
  en: {
    title: 'Integrations',
    subtitle:
      'Configure, test, and sync the external systems the legal suite federates with.',
    breadcrumb: 'Integrations',
    refresh: 'Refresh',
    newIntegration: 'New integration',
    backToList: 'Back to integrations',

    kpiTotal: 'Total',
    kpiHealthy: 'Healthy',
    kpiDegraded: 'Degraded',
    kpiDown: 'Down',
    kpiUnconfigured: 'Unconfigured',
    kpiDisabled: 'Disabled',
    kpiTotalHint: 'All registered endpoints',
    kpiHealthyHint: 'Active and last probe reachable',
    kpiDegradedHint: 'Active with a recent error or partial result',
    kpiDownHint: 'Endpoints in an error state',
    kpiUnconfiguredHint: 'Planned connectors not yet configured',
    kpiDisabledHint: 'Turned off by an operator',

    groupAll: 'All kinds',
    cardLastChecked: 'Last checked',
    cardNeverChecked: 'Never checked',
    cardConfigure: 'Configure',
    cardCount: '{n} endpoints',
    govGatedBadge: 'Gov-gated',
    govGatedHint:
      'Requires Saudi government / TSP onboarding (MoJ Takamul, Nafath, emdha) before going live.',

    statusPlanned: 'Planned',
    statusActive: 'Active',
    statusDisabled: 'Disabled',
    statusError: 'Error',

    gradeHealthy: 'Healthy',
    gradeDegraded: 'Degraded',
    gradeDown: 'Down',
    gradeUnconfigured: 'Unconfigured',
    gradeDisabled: 'Disabled',

    detailTitle: 'Integration',
    formName: 'Display name',
    formCode: 'Code',
    formCodeHint: 'Stable per-tenant identifier (lowercase, unique).',
    formKind: 'Kind',
    formDescription: 'Description',
    formStatus: 'Status',
    formConfigSection: 'Connection configuration',
    formMetadataSection: 'Metadata',
    formRequired: 'Required',
    formOptional: 'Optional',
    formSelectPlaceholder: 'Select…',
    save: 'Save changes',
    saving: 'Saving…',
    cancel: 'Cancel',
    create: 'Create integration',
    creating: 'Creating…',
    deleteAction: 'Delete',
    deleting: 'Deleting…',
    deleteConfirmTitle: 'Delete this integration?',
    deleteConfirmBody:
      'This removes the endpoint and its stored configuration. Sync history is retained. This cannot be undone.',

    secretSet: '•••••• (set)',
    secretReplace: 'Replace',
    secretKeepHint: 'Leave unchanged to keep the stored secret.',
    secretEnterNew: 'Enter new value',
    secretUndoReplace: 'Keep current',

    connectionPanelTitle: 'Connection',
    envBadgeProd: 'Production',
    envBadgeSandbox: 'Sandbox',
    testConnection: 'Test connection',
    testing: 'Testing…',
    testReachable: 'Reachable',
    testUnreachable: 'Unreachable',
    testUnsupported: 'Testing not supported for this connector',
    testLatency: '{ms} ms',
    testSamples: '{n} records observed',
    testLastChecked: 'Last checked',
    healthLabel: 'Health',
    enable: 'Enable',
    disable: 'Disable',
    enabling: 'Enabling…',
    disabling: 'Disabling…',
    syncNow: 'Sync now',
    syncFull: 'Full sync',
    syncDelta: 'Delta sync',
    syncing: 'Syncing…',

    ledgerTitle: 'Sync history',
    ledgerSubtitle: 'Recorded sync runs for this endpoint, newest first.',
    ledgerColWhen: 'When',
    ledgerColMode: 'Mode',
    ledgerColStatus: 'Status',
    ledgerColProcessed: 'Processed',
    ledgerColCreated: 'Created',
    ledgerColUpdated: 'Updated',
    ledgerColSkipped: 'Skipped',
    ledgerColFailed: 'Failed',
    ledgerColDetail: 'Detail',
    syncStatusSucceeded: 'Succeeded',
    syncStatusPartial: 'Partial',
    syncStatusFailed: 'Failed',
    modeFull: 'Full',
    modeDelta: 'Delta',

    emptyTitle: 'No integrations yet',
    emptyBody: 'Register your first external system to start syncing and signing.',
    emptyCta: 'New integration',
    schemaMissingTitle: 'Configuration schema unavailable',
    schemaMissingBody:
      'The field schema for this kind could not be loaded, so the dynamic form cannot render. Retry, or check that the service is running.',
    loadErrorTitle: 'Could not load integrations',
    loadErrorBody: 'The request failed. Retry, or check that the service is running.',
    notFoundTitle: 'Integration not found',
    notFoundBody: 'This endpoint may have been deleted or you may not have access to it.',
    ledgerEmpty: 'No sync runs recorded yet.',
    healthUnknown: 'Unknown',

    toastCreated: 'Integration created.',
    toastUpdated: 'Integration updated.',
    toastDeleted: 'Integration deleted.',
    toastEnabled: 'Integration enabled.',
    toastDisabled: 'Integration disabled.',
    toastTestDone: 'Connection test complete.',
    toastSyncStarted: 'Sync started.',
    toastSyncDone: 'Sync complete.',
    toastError: 'Something went wrong. Please try again.',

    readOnlyNote: 'You have read-only access; configuration changes are disabled.',

    catalogTitle: 'Add an integration',
    catalogSubtitle:
      'Browse the connector catalog and pick a system to federate with. Government-gated connectors need onboarding before they go live.',
    catalogSearchPlaceholder: 'Search connectors…',
    catalogFilterAll: 'All',
    catalogFilterSelfServe: 'Self-serve',
    catalogFilterGovGated: 'Gov-gated',
    catalogSelfServeBadge: 'Self-serve',
    catalogSelfServeHint: 'Can be configured without a manual onboarding gate.',
    catalogMaturityProduction: 'Production',
    catalogMaturityGovGated: 'Gov-gated',
    catalogPrereqCount: '{n} prerequisites',
    catalogConfigure: 'Set up',
    catalogEmptyTitle: 'No connectors match',
    catalogEmptyBody: 'Adjust the search or filters to see available connectors.',
    catalogErrorTitle: 'Could not load the catalog',
    catalogErrorBody:
      'The connector catalog failed to load. You can still pick a kind from the basic list.',

    wizardStepPrereq: 'Prerequisites',
    wizardStepCredentials: 'Credentials',
    wizardStepTest: 'Test',
    wizardStepEnable: 'Enable',
    wizardStepSync: 'First sync',
    wizardStepPrereqDesc: 'What to arrange in the external system first.',
    wizardStepCredentialsDesc: 'Enter the connection details and secrets.',
    wizardStepTestDesc: 'Run a layered connection diagnostic.',
    wizardStepEnableDesc: 'Activate the endpoint so it can sync and sign.',
    wizardStepSyncDesc: 'Optionally run an initial sync.',
    wizardStepLabel: 'Step {n} of {total}',
    wizardNext: 'Continue',
    wizardBack: 'Back',
    wizardSkip: 'Skip',
    wizardFinish: 'Finish',
    wizardPrereqIntro:
      'Complete these steps in the external system before configuring the connector.',
    wizardPrereqAck: 'I have completed the prerequisites above.',
    wizardPrereqNone: 'No special prerequisites for this connector.',
    wizardCallbacksTitle: 'Callback URLs',
    wizardCallbacksHint:
      'Register these URLs in the external system so it can call back into the platform.',
    wizardCopy: 'Copy',
    wizardCopied: 'Copied',
    wizardCreateFirst: 'Save the connector to continue to testing.',
    wizardCreatedNotice: 'Connector saved. You can now test the connection.',
    wizardTestIntro:
      'Run a connection diagnostic to confirm credentials and reachability before enabling.',
    wizardTestSkipNote: 'You can enable without testing, but testing first is recommended.',
    wizardEnableIntro: 'Activate the endpoint so it can begin syncing and signing.',
    wizardEnableAction: 'Enable integration',
    wizardEnabledNotice: 'Integration is active.',
    wizardStillPlannedNotice: 'The integration is saved but not yet active.',
    wizardSyncIntro: 'Run an initial sync now, or do it later from the detail page.',
    wizardSyncSkipNote: 'You can skip this and sync later.',
    wizardSyncRunFull: 'Run full sync',
    wizardSyncRunDelta: 'Run delta sync',
    wizardDoneTitle: 'Integration ready',
    wizardDoneBody: 'Setup is complete. Manage this connector from its detail page.',
    wizardGoToDetail: 'Open integration',
    wizardChangeKind: 'Choose a different connector',

    diagTitle: 'Connection diagnostic',
    diagRun: 'Run test',
    diagRunning: 'Running…',
    diagRerun: 'Run again',
    diagStatusOk: 'OK',
    diagStatusWarn: 'Warning',
    diagStatusFail: 'Failed',
    diagStatusSkip: 'Skipped',
    diagReachable: 'Reachable',
    diagUnreachable: 'Unreachable',
    diagNoSteps: 'No detailed steps were reported; see the summary above.',
    diagHint: 'Hint',

    mapperTitle: 'Field mapping',
    mapperIntro:
      'Map fields from the HR source system to the lex identity model. External ID is required for matching.',
    mapperSourceField: 'Source field',
    mapperLexField: 'lex field',
    mapperSourcePlaceholder: 'e.g. employeeNumber',
    mapperAddRow: 'Add mapping',
    mapperRemoveRow: 'Remove',
    mapperUnmapped: 'Not mapped',
    mapperLexExternalId: 'External ID',
    mapperLexManager: 'Manager',
    mapperLexDepartment: 'Department',
    mapperLexOrgUnit: 'Org unit',
    mapperLexEmail: 'Email',
    mapperLexDisplayName: 'Display name',
    mapperEmpty: 'No mappings yet. Add a row to map a source field.',
    mapperDuplicateSource: 'Each lex field can be mapped only once.',
    mapperRawToggle: 'Edit as JSON',
    mapperGuidedToggle: 'Guided mapper',
    mapperRequiredLex: 'required',

    guardBlockedTitle: 'Sync blocked by the mass-change guard',
    guardBlockedBody:
      'This run would deactivate {pct}% of mapped entities. Open the sync preview to review and confirm.',
  },
  ar: {
    title: 'التكاملات',
    subtitle: 'تهيئة الأنظمة الخارجية التي تتكامل معها المنظومة القانونية واختبارها ومزامنتها.',
    breadcrumb: 'التكاملات',
    refresh: 'تحديث',
    newIntegration: 'تكامل جديد',
    backToList: 'العودة إلى التكاملات',

    kpiTotal: 'الإجمالي',
    kpiHealthy: 'سليم',
    kpiDegraded: 'متدهور',
    kpiDown: 'متوقّف',
    kpiUnconfigured: 'غير مُهيّأ',
    kpiDisabled: 'مُعطّل',
    kpiTotalHint: 'جميع النقاط المسجّلة',
    kpiHealthyHint: 'فعّال وآخر فحص قابل للوصول',
    kpiDegradedHint: 'فعّال مع خطأ حديث أو نتيجة جزئية',
    kpiDownHint: 'نقاط في حالة خطأ',
    kpiUnconfiguredHint: 'نقاط مخطّطة لم تُهيّأ بعد',
    kpiDisabledHint: 'أوقفها المشغّل',

    groupAll: 'كل الأنواع',
    cardLastChecked: 'آخر فحص',
    cardNeverChecked: 'لم يُفحص',
    cardConfigure: 'تهيئة',
    cardCount: '{n} نقاط',
    govGatedBadge: 'مقيّد حكوميًا',
    govGatedHint:
      'يتطلّب التأهيل الحكومي / مزوّد خدمة موثوق (تكامل وزارة العدل، نفاذ، إمضاء) قبل التفعيل.',

    statusPlanned: 'مخطّط',
    statusActive: 'فعّال',
    statusDisabled: 'مُعطّل',
    statusError: 'خطأ',

    gradeHealthy: 'سليم',
    gradeDegraded: 'متدهور',
    gradeDown: 'متوقّف',
    gradeUnconfigured: 'غير مُهيّأ',
    gradeDisabled: 'مُعطّل',

    detailTitle: 'تكامل',
    formName: 'الاسم الظاهر',
    formCode: 'الرمز',
    formCodeHint: 'معرّف ثابت لكل مستأجر (حروف صغيرة، فريد).',
    formKind: 'النوع',
    formDescription: 'الوصف',
    formStatus: 'الحالة',
    formConfigSection: 'إعدادات الاتصال',
    formMetadataSection: 'بيانات وصفية',
    formRequired: 'إلزامي',
    formOptional: 'اختياري',
    formSelectPlaceholder: 'اختر…',
    save: 'حفظ التغييرات',
    saving: 'جارٍ الحفظ…',
    cancel: 'إلغاء',
    create: 'إنشاء التكامل',
    creating: 'جارٍ الإنشاء…',
    deleteAction: 'حذف',
    deleting: 'جارٍ الحذف…',
    deleteConfirmTitle: 'حذف هذا التكامل؟',
    deleteConfirmBody:
      'سيؤدي ذلك إلى إزالة النقطة وإعداداتها المخزّنة. يُحتفَظ بسجل المزامنة. لا يمكن التراجع.',

    secretSet: '•••••• (مُعيَّن)',
    secretReplace: 'استبدال',
    secretKeepHint: 'اتركه دون تغيير للإبقاء على السر المخزّن.',
    secretEnterNew: 'أدخل قيمة جديدة',
    secretUndoReplace: 'الإبقاء على الحالي',

    connectionPanelTitle: 'الاتصال',
    envBadgeProd: 'إنتاج',
    envBadgeSandbox: 'تجريبي',
    testConnection: 'اختبار الاتصال',
    testing: 'جارٍ الاختبار…',
    testReachable: 'قابل للوصول',
    testUnreachable: 'غير قابل للوصول',
    testUnsupported: 'اختبار الاتصال غير مدعوم لهذا الموصّل',
    testLatency: '{ms} مللي ثانية',
    testSamples: 'تمت ملاحظة {n} سجلات',
    testLastChecked: 'آخر فحص',
    healthLabel: 'الصحة',
    enable: 'تفعيل',
    disable: 'تعطيل',
    enabling: 'جارٍ التفعيل…',
    disabling: 'جارٍ التعطيل…',
    syncNow: 'مزامنة الآن',
    syncFull: 'مزامنة كاملة',
    syncDelta: 'مزامنة تفاضلية',
    syncing: 'جارٍ المزامنة…',

    ledgerTitle: 'سجل المزامنة',
    ledgerSubtitle: 'عمليات المزامنة المسجّلة لهذه النقطة، الأحدث أولًا.',
    ledgerColWhen: 'الوقت',
    ledgerColMode: 'النمط',
    ledgerColStatus: 'الحالة',
    ledgerColProcessed: 'مُعالَج',
    ledgerColCreated: 'مُنشأ',
    ledgerColUpdated: 'مُحدَّث',
    ledgerColSkipped: 'مُتجاوَز',
    ledgerColFailed: 'فاشل',
    ledgerColDetail: 'التفاصيل',
    syncStatusSucceeded: 'نجح',
    syncStatusPartial: 'جزئي',
    syncStatusFailed: 'فشل',
    modeFull: 'كامل',
    modeDelta: 'تفاضلي',

    emptyTitle: 'لا توجد تكاملات بعد',
    emptyBody: 'سجّل أول نظام خارجي لبدء المزامنة والتوقيع.',
    emptyCta: 'تكامل جديد',
    schemaMissingTitle: 'مخطّط الإعدادات غير متاح',
    schemaMissingBody:
      'تعذّر تحميل مخطّط الحقول لهذا النوع، لذا لا يمكن عرض النموذج الديناميكي. أعد المحاولة أو تأكّد من تشغيل الخدمة.',
    loadErrorTitle: 'تعذّر تحميل التكاملات',
    loadErrorBody: 'فشل الطلب. أعد المحاولة أو تأكّد من تشغيل الخدمة.',
    notFoundTitle: 'التكامل غير موجود',
    notFoundBody: 'قد تكون هذه النقطة قد حُذفت أو قد لا تملك صلاحية الوصول إليها.',
    ledgerEmpty: 'لم تُسجَّل أي عمليات مزامنة بعد.',
    healthUnknown: 'غير معروف',

    toastCreated: 'تم إنشاء التكامل.',
    toastUpdated: 'تم تحديث التكامل.',
    toastDeleted: 'تم حذف التكامل.',
    toastEnabled: 'تم تفعيل التكامل.',
    toastDisabled: 'تم تعطيل التكامل.',
    toastTestDone: 'اكتمل اختبار الاتصال.',
    toastSyncStarted: 'بدأت المزامنة.',
    toastSyncDone: 'اكتملت المزامنة.',
    toastError: 'حدث خطأ ما. يُرجى المحاولة مرة أخرى.',

    readOnlyNote: 'صلاحيتك للقراءة فقط؛ تغييرات الإعداد معطّلة.',

    catalogTitle: 'إضافة تكامل',
    catalogSubtitle:
      'تصفّح دليل الموصّلات واختر نظامًا للتكامل معه. الموصّلات المقيّدة حكوميًا تتطلّب التأهيل قبل التفعيل.',
    catalogSearchPlaceholder: 'ابحث في الموصّلات…',
    catalogFilterAll: 'الكل',
    catalogFilterSelfServe: 'تهيئة ذاتية',
    catalogFilterGovGated: 'مقيّد حكوميًا',
    catalogSelfServeBadge: 'تهيئة ذاتية',
    catalogSelfServeHint: 'يمكن تهيئته دون بوابة تأهيل يدوية.',
    catalogMaturityProduction: 'إنتاج',
    catalogMaturityGovGated: 'مقيّد حكوميًا',
    catalogPrereqCount: '{n} متطلّبات مسبقة',
    catalogConfigure: 'تهيئة',
    catalogEmptyTitle: 'لا توجد موصّلات مطابقة',
    catalogEmptyBody: 'عدّل البحث أو عوامل التصفية لعرض الموصّلات المتاحة.',
    catalogErrorTitle: 'تعذّر تحميل الدليل',
    catalogErrorBody: 'فشل تحميل دليل الموصّلات. لا يزال بإمكانك اختيار نوع من القائمة الأساسية.',

    wizardStepPrereq: 'المتطلّبات المسبقة',
    wizardStepCredentials: 'بيانات الاعتماد',
    wizardStepTest: 'الاختبار',
    wizardStepEnable: 'التفعيل',
    wizardStepSync: 'المزامنة الأولى',
    wizardStepPrereqDesc: 'ما يجب تجهيزه في النظام الخارجي أولًا.',
    wizardStepCredentialsDesc: 'أدخل تفاصيل الاتصال والأسرار.',
    wizardStepTestDesc: 'شغّل تشخيصًا متعدّد المراحل للاتصال.',
    wizardStepEnableDesc: 'فعّل النقطة لتتمكّن من المزامنة والتوقيع.',
    wizardStepSyncDesc: 'شغّل مزامنة أولية اختياريًا.',
    wizardStepLabel: 'الخطوة {n} من {total}',
    wizardNext: 'متابعة',
    wizardBack: 'رجوع',
    wizardSkip: 'تخطّي',
    wizardFinish: 'إنهاء',
    wizardPrereqIntro: 'أكمل هذه الخطوات في النظام الخارجي قبل تهيئة الموصّل.',
    wizardPrereqAck: 'لقد أكملت المتطلّبات المسبقة أعلاه.',
    wizardPrereqNone: 'لا توجد متطلّبات مسبقة خاصة لهذا الموصّل.',
    wizardCallbacksTitle: 'روابط الاستدعاء',
    wizardCallbacksHint: 'سجّل هذه الروابط في النظام الخارجي ليتمكّن من الاستدعاء إلى المنصّة.',
    wizardCopy: 'نسخ',
    wizardCopied: 'تم النسخ',
    wizardCreateFirst: 'احفظ الموصّل للمتابعة إلى الاختبار.',
    wizardCreatedNotice: 'تم حفظ الموصّل. يمكنك الآن اختبار الاتصال.',
    wizardTestIntro: 'شغّل تشخيص الاتصال للتأكّد من بيانات الاعتماد وإمكانية الوصول قبل التفعيل.',
    wizardTestSkipNote: 'يمكنك التفعيل دون اختبار، لكن يُنصح بالاختبار أولًا.',
    wizardEnableIntro: 'فعّل النقطة لتبدأ المزامنة والتوقيع.',
    wizardEnableAction: 'تفعيل التكامل',
    wizardEnabledNotice: 'التكامل فعّال.',
    wizardStillPlannedNotice: 'تم حفظ التكامل لكنّه غير مُفعّل بعد.',
    wizardSyncIntro: 'شغّل مزامنة أولية الآن، أو لاحقًا من صفحة التفاصيل.',
    wizardSyncSkipNote: 'يمكنك تخطّي هذا والمزامنة لاحقًا.',
    wizardSyncRunFull: 'تشغيل مزامنة كاملة',
    wizardSyncRunDelta: 'تشغيل مزامنة تفاضلية',
    wizardDoneTitle: 'التكامل جاهز',
    wizardDoneBody: 'اكتمل الإعداد. أدِر هذا الموصّل من صفحة تفاصيله.',
    wizardGoToDetail: 'فتح التكامل',
    wizardChangeKind: 'اختيار موصّل آخر',

    diagTitle: 'تشخيص الاتصال',
    diagRun: 'تشغيل الاختبار',
    diagRunning: 'جارٍ التشغيل…',
    diagRerun: 'إعادة التشغيل',
    diagStatusOk: 'سليم',
    diagStatusWarn: 'تحذير',
    diagStatusFail: 'فشل',
    diagStatusSkip: 'متجاوَز',
    diagReachable: 'قابل للوصول',
    diagUnreachable: 'غير قابل للوصول',
    diagNoSteps: 'لم تُبلَّغ خطوات تفصيلية؛ راجع الملخّص أعلاه.',
    diagHint: 'إرشاد',

    mapperTitle: 'ربط الحقول',
    mapperIntro:
      'اربط حقول نظام الموارد البشرية المصدر بنموذج الهوية في lex. المعرّف الخارجي إلزامي للمطابقة.',
    mapperSourceField: 'حقل المصدر',
    mapperLexField: 'حقل lex',
    mapperSourcePlaceholder: 'مثال: employeeNumber',
    mapperAddRow: 'إضافة ربط',
    mapperRemoveRow: 'إزالة',
    mapperUnmapped: 'غير مربوط',
    mapperLexExternalId: 'المعرّف الخارجي',
    mapperLexManager: 'المدير',
    mapperLexDepartment: 'القسم',
    mapperLexOrgUnit: 'الوحدة التنظيمية',
    mapperLexEmail: 'البريد الإلكتروني',
    mapperLexDisplayName: 'الاسم الظاهر',
    mapperEmpty: 'لا توجد روابط بعد. أضف صفًا لربط حقل مصدر.',
    mapperDuplicateSource: 'يمكن ربط كل حقل lex مرة واحدة فقط.',
    mapperRawToggle: 'تحرير كـ JSON',
    mapperGuidedToggle: 'المُربّط الموجّه',
    mapperRequiredLex: 'إلزامي',

    guardBlockedTitle: 'حُجبت المزامنة بواسطة حارس التغيير الجماعي',
    guardBlockedBody:
      'سيؤدي هذا التشغيل إلى تعطيل {pct}٪ من الكيانات المربوطة. افتح معاينة المزامنة للمراجعة والتأكيد.',
  },
};
