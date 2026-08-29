'use client';

/**
 * Scoped bilingual (AR — MSA / EN) labels for the integration EXTENSIBILITY
 * surface (#18 no-code custom REST connector builder, #19 transform/filter rules
 * editor, #20 conflicts queue + mass-change guard).
 *
 * Kept in its own module (NOT folded into `_labels.ts` nor the shared
 * `@/lib/i18n/messages` catalog) on purpose: `_labels.ts` is concurrently
 * owned/extended by sibling list/catalog/wizard units, and the shared catalog is
 * the integrator's to own — proposed shared keys are listed in the manifest.
 * Same pattern as the coexisting `reliability-labels.ts` / `logs-labels.ts`. All
 * copy is plain strings (no JSX), RTL-safe; `{token}` placeholders are
 * interpolated with {@link fillExtToken}.
 */
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type {
  ConflictResolution,
  ConflictStatus,
  CustomAuthType,
  CustomPaginationType,
  FilterOp,
  RuleType,
  TransformOp,
} from '@/lib/lex/integrations';

export interface ExtensibilityLabels {
  /* ── Custom connector builder (#18) ── */
  builderTitle: string;
  builderSubtitle: string;
  builderCardTitle: string; // catalog "Build a custom connector" card
  builderCardBody: string;
  builderCardCta: string;
  builderSectionRequest: string;
  builderSectionAuth: string;
  builderSectionResponse: string;
  builderSectionPagination: string;
  builderSectionTest: string;
  builderBaseUrl: string;
  builderBaseUrlHint: string;
  builderBaseUrlPlaceholder: string;
  builderBaseUrlInvalid: string; // malformed URL / unsupported scheme / embedded credentials
  builderBaseUrlInsecure: string; // plain HTTP (must be HTTPS)
  builderBaseUrlPrivate: string; // loopback / link-local / metadata / RFC1918 (SSRF guard)
  builderMethod: string;
  builderPath: string;
  builderPathHint: string;
  builderHeaders: string;
  builderHeadersHint: string;
  builderHeaderName: string;
  builderHeaderValue: string;
  builderAddHeader: string;
  builderRemoveHeader: string;
  builderBody: string;
  builderBodyHint: string;
  builderAuthType: string;
  builderAuthUsername: string;
  builderAuthPassword: string;
  builderAuthToken: string;
  builderAuthTokenUrl: string;
  builderAuthClientId: string;
  builderAuthClientSecret: string;
  builderAuthScope: string;
  builderAuthHmacHeader: string;
  builderAuthHmacSecret: string;
  builderSecretSet: string; // "•••••• (set)"
  builderSecretReplace: string;
  builderSecretKeepHint: string;
  builderRecordsPath: string;
  builderRecordsPathHint: string;
  builderFieldMap: string;
  builderFieldMapHint: string;
  builderPaginationType: string;
  builderPaginationParam: string;
  builderPaginationParamHint: string;
  builderTestIntro: string;
  builderTestRun: string;
  builderTestRunning: string;
  builderTestCreateFirst: string;
  builderTestReachable: string;
  builderTestUnreachable: string;
  builderBaseUrlRequired: string;

  /* ── Field mapper (#18 response mapping — raw JSON escape hatch) ── */
  mapperInvalidJson: string; // raw-mapping text is not valid JSON / not an object

  /* ── Auth types (CustomAuthType) ── */
  authNone: string;
  authBasic: string;
  authBearer: string;
  authOauth2Cc: string;
  authHmac: string;

  /* ── Pagination types (CustomPaginationType) ── */
  pageNone: string;
  pagePage: string;
  pageCursor: string;

  /* ── Rules editor (#19) ── */
  rulesTitle: string;
  rulesSubtitle: string;
  rulesEmpty: string;
  rulesEmptyHint: string;
  rulesAddTransform: string;
  rulesAddFilter: string;
  rulesType: string;
  rulesOp: string;
  rulesField: string;
  rulesFieldPlaceholder: string;
  rulesArgs: string;
  rulesArgsHint: string;
  rulesArgPlaceholder: string;
  rulesMoveUp: string;
  rulesMoveDown: string;
  rulesRemove: string;
  rulesStepLabel: string; // "Step {n}"
  rulesPreview: string;
  rulesPreviewRunning: string;
  rulesPreviewHint: string;
  rulesPreviewEffect: string; // "{n} records would pass the pipeline"

  /* ── Rule types (RuleType) ── */
  ruleTypeTransform: string;
  ruleTypeFilter: string;

  /* ── Transform ops (TransformOp) ── */
  opConcat: string;
  opLookup: string;
  opDefault: string;
  opRegex: string;
  opDateFormat: string;

  /* ── Filter ops (FilterOp) ── */
  opEq: string;
  opNe: string;
  opIn: string;
  opExists: string;
  opGt: string;
  opLt: string;

  /* ── Conflicts queue (#20) ── */
  conflictsTab: string;
  conflictsTitle: string;
  conflictsSubtitle: string;
  conflictsEmptyTitle: string;
  conflictsEmptyBody: string;
  conflictsErrorTitle: string;
  conflictsErrorBody: string;
  conflictsColExternalId: string;
  conflictsColField: string;
  conflictsColSource: string;
  conflictsColLex: string;
  conflictsColSuggested: string;
  conflictsColStatus: string;
  conflictsColDetected: string;
  conflictsColActions: string;
  conflictsOpen: string;
  conflictsResolved: string;
  conflictsFilterAll: string;
  conflictsFilterOpen: string;
  conflictsFilterResolved: string;
  conflictsSelectAll: string;
  conflictsSelected: string; // "{n} selected"
  conflictsBulkResolve: string;
  conflictsBulkApply: string;
  conflictsResolving: string;
  conflictsNoSuggestion: string;
  conflictsManageOnly: string;
  conflictsKpiOpen: string;
  conflictsKpiResolved: string;
  conflictsKpiTotal: string;

  /* ── Resolutions (ConflictResolution) ── */
  resolutionMerge: string;
  resolutionMergeHint: string;
  resolutionOverride: string;
  resolutionOverrideHint: string;
  resolutionIgnore: string;
  resolutionIgnoreHint: string;

  /* ── Mass-change guard (#20) — surfaced in the sync-preview dialog ── */
  guardTitle: string;
  guardBody: string; // "Would deactivate {n} of {total} ({pct}%) — above the {threshold}% ceiling."
  guardThreshold: string; // "Ceiling: {threshold}%"
  guardWouldDeactivate: string; // "{n} would be deactivated"
  guardForceConfirm: string; // "Force sync anyway"
  guardForcing: string;
  guardCancel: string;
  guardConfigLabel: string; // config field label
  guardConfigHint: string;

  /* ── Toasts ── */
  toastConflictResolved: string;
  toastConflictsResolved: string; // "{n} conflicts resolved"
  toastForced: string;
  toastError: string;
}

export const extensibilityLabels: {
  en: ExtensibilityLabels;
  ar: ExtensibilityLabels;
} = {
  en: {
    builderTitle: 'Custom REST connector',
    builderSubtitle:
      'Build a connector with no code: point it at a REST endpoint, pick an auth method, map the response, and test it.',
    builderCardTitle: 'Build a custom connector',
    builderCardBody:
      'No connector for your system? Describe a REST endpoint and we will run it for you.',
    builderCardCta: 'Start building',
    builderSectionRequest: 'Request',
    builderSectionAuth: 'Authentication',
    builderSectionResponse: 'Response mapping',
    builderSectionPagination: 'Pagination',
    builderSectionTest: 'Test',
    builderBaseUrl: 'Base URL',
    builderBaseUrlHint: 'The root URL of the API (e.g. https://api.example.com).',
    builderBaseUrlPlaceholder: 'https://api.example.com',
    builderBaseUrlInvalid: 'Enter a valid URL with no embedded credentials.',
    builderBaseUrlInsecure: 'Use https:// — plain HTTP is not allowed.',
    builderBaseUrlPrivate: 'This host is internal or private and cannot be reached.',
    builderMethod: 'Method',
    builderPath: 'Path',
    builderPathHint: 'Appended to the base URL. May use {cursor} or {page} tokens.',
    builderHeaders: 'Headers',
    builderHeadersHint: 'Static headers sent with every request.',
    builderHeaderName: 'Header',
    builderHeaderValue: 'Value',
    builderAddHeader: 'Add header',
    builderRemoveHeader: 'Remove header',
    builderBody: 'Body template',
    builderBodyHint: 'Request body for non-GET methods (usually JSON).',
    builderAuthType: 'Auth method',
    builderAuthUsername: 'Username',
    builderAuthPassword: 'Password',
    builderAuthToken: 'Bearer token',
    builderAuthTokenUrl: 'Token URL',
    builderAuthClientId: 'Client ID',
    builderAuthClientSecret: 'Client secret',
    builderAuthScope: 'Scope',
    builderAuthHmacHeader: 'Signature header',
    builderAuthHmacSecret: 'Signing secret',
    builderSecretSet: '•••••• (set)',
    builderSecretReplace: 'Replace',
    builderSecretKeepHint: 'Leave unchanged to keep the stored secret.',
    builderRecordsPath: 'Records path',
    builderRecordsPathHint: 'Dot-path to the array of records (e.g. data.items). Leave empty for a root array.',
    builderFieldMap: 'Field map',
    builderFieldMapHint: 'Map each lex attribute to a field path within one record.',
    builderPaginationType: 'Pagination',
    builderPaginationParam: 'Parameter',
    builderPaginationParamHint: 'The query parameter carrying the page number or cursor token.',
    builderTestIntro: 'Save the connector, then run a live test against the spec above.',
    builderTestRun: 'Test connector',
    builderTestRunning: 'Testing…',
    builderTestCreateFirst: 'Save the connector to enable testing.',
    builderTestReachable: 'Reachable',
    builderTestUnreachable: 'Unreachable',
    builderBaseUrlRequired: 'A base URL is required.',

    mapperInvalidJson: 'Not valid JSON — enter an object of "lex field": "source field" pairs.',

    authNone: 'None',
    authBasic: 'Basic',
    authBearer: 'Bearer token',
    authOauth2Cc: 'OAuth2 (client credentials)',
    authHmac: 'HMAC signature',

    pageNone: 'None',
    pagePage: 'Page number',
    pageCursor: 'Cursor',

    rulesTitle: 'Sync rules',
    rulesSubtitle:
      'A transform/filter pipeline applied to each record during sync. Rules run top to bottom.',
    rulesEmpty: 'No rules yet',
    rulesEmptyHint: 'Add a transform to reshape fields or a filter to drop records.',
    rulesAddTransform: 'Add transform',
    rulesAddFilter: 'Add filter',
    rulesType: 'Type',
    rulesOp: 'Operation',
    rulesField: 'Field',
    rulesFieldPlaceholder: 'e.g. status',
    rulesArgs: 'Arguments',
    rulesArgsHint: 'Operation-specific values (one per box).',
    rulesArgPlaceholder: 'Value',
    rulesMoveUp: 'Move up',
    rulesMoveDown: 'Move down',
    rulesRemove: 'Remove rule',
    rulesStepLabel: 'Step {n}',
    rulesPreview: 'Preview effect',
    rulesPreviewRunning: 'Previewing…',
    rulesPreviewHint: 'Run a dry-run to see how many records the current pipeline would keep.',
    rulesPreviewEffect: '{n} records would pass the pipeline',

    ruleTypeTransform: 'Transform',
    ruleTypeFilter: 'Filter',

    opConcat: 'Concatenate',
    opLookup: 'Lookup',
    opDefault: 'Default value',
    opRegex: 'Regex replace',
    opDateFormat: 'Reformat date',

    opEq: 'Equals',
    opNe: 'Not equal',
    opIn: 'In list',
    opExists: 'Exists',
    opGt: 'Greater than',
    opLt: 'Less than',

    conflictsTab: 'Conflicts',
    conflictsTitle: 'Conflicts',
    conflictsSubtitle:
      'Field-level divergences found by reconciliation. Resolve each by merging, overriding, or ignoring.',
    conflictsEmptyTitle: 'No conflicts',
    conflictsEmptyBody:
      'Reconciliation found no diverging fields between the external system and lex.',
    conflictsErrorTitle: 'Could not load conflicts',
    conflictsErrorBody: 'The request failed. Retry, or check that the service is running.',
    conflictsColExternalId: 'External ID',
    conflictsColField: 'Field',
    conflictsColSource: 'Source value',
    conflictsColLex: 'lex value',
    conflictsColSuggested: 'Suggested',
    conflictsColStatus: 'Status',
    conflictsColDetected: 'Detected',
    conflictsColActions: 'Resolve',
    conflictsOpen: 'Open',
    conflictsResolved: 'Resolved',
    conflictsFilterAll: 'All',
    conflictsFilterOpen: 'Open',
    conflictsFilterResolved: 'Resolved',
    conflictsSelectAll: 'Select all',
    conflictsSelected: '{n} selected',
    conflictsBulkResolve: 'Resolve selected',
    conflictsBulkApply: 'Apply',
    conflictsResolving: 'Resolving…',
    conflictsNoSuggestion: 'None',
    conflictsManageOnly: 'You have read-only access; resolving conflicts is disabled.',
    conflictsKpiOpen: 'Open',
    conflictsKpiResolved: 'Resolved',
    conflictsKpiTotal: 'Total',

    resolutionMerge: 'Merge',
    resolutionMergeHint: 'Combine both values where possible.',
    resolutionOverride: 'Override',
    resolutionOverrideHint: 'Take the external source value.',
    resolutionIgnore: 'Ignore',
    resolutionIgnoreHint: 'Keep the lex value and dismiss the conflict.',

    guardTitle: 'Mass-change guard',
    guardBody:
      'This sync would deactivate {n} of {total} mapped entities ({pct}%) — above the {threshold}% safety ceiling.',
    guardThreshold: 'Ceiling: {threshold}%',
    guardWouldDeactivate: '{n} would be deactivated',
    guardForceConfirm: 'Force sync anyway',
    guardForcing: 'Forcing sync…',
    guardCancel: 'Cancel',
    guardConfigLabel: 'Mass-change ceiling (%)',
    guardConfigHint:
      'Block a sync that would deactivate more than this share of mapped entities (default 20).',

    toastConflictResolved: 'Conflict resolved.',
    toastConflictsResolved: '{n} conflicts resolved.',
    toastForced: 'Sync forced past the guard.',
    toastError: 'Something went wrong. Please try again.',
  },
  ar: {
    builderTitle: 'موصّل REST مخصّص',
    builderSubtitle:
      'أنشئ موصّلًا بدون برمجة: وجّهه إلى نقطة REST، واختر طريقة مصادقة، واربط الاستجابة، ثم اختبره.',
    builderCardTitle: 'إنشاء موصّل مخصّص',
    builderCardBody: 'لا يوجد موصّل لنظامك؟ صِف نقطة REST وسنقوم بتشغيلها نيابةً عنك.',
    builderCardCta: 'ابدأ الإنشاء',
    builderSectionRequest: 'الطلب',
    builderSectionAuth: 'المصادقة',
    builderSectionResponse: 'ربط الاستجابة',
    builderSectionPagination: 'الترقيم',
    builderSectionTest: 'الاختبار',
    builderBaseUrl: 'العنوان الأساسي',
    builderBaseUrlHint: 'العنوان الجذر لواجهة البرمجة (مثال: https://api.example.com).',
    builderBaseUrlPlaceholder: 'https://api.example.com',
    builderBaseUrlInvalid: 'أدخل عنوانًا صالحًا دون بيانات اعتماد مضمّنة.',
    builderBaseUrlInsecure: 'استخدم https:// — لا يُسمح بـ HTTP العادي.',
    builderBaseUrlPrivate: 'هذا المضيف داخلي أو خاص ولا يمكن الوصول إليه.',
    builderMethod: 'الطريقة',
    builderPath: 'المسار',
    builderPathHint: 'يُلحق بالعنوان الأساسي. يمكن استخدام الرموز {cursor} أو {page}.',
    builderHeaders: 'الترويسات',
    builderHeadersHint: 'ترويسات ثابتة تُرسل مع كل طلب.',
    builderHeaderName: 'الترويسة',
    builderHeaderValue: 'القيمة',
    builderAddHeader: 'إضافة ترويسة',
    builderRemoveHeader: 'إزالة الترويسة',
    builderBody: 'قالب المحتوى',
    builderBodyHint: 'محتوى الطلب للطرق غير GET (عادةً JSON).',
    builderAuthType: 'طريقة المصادقة',
    builderAuthUsername: 'اسم المستخدم',
    builderAuthPassword: 'كلمة المرور',
    builderAuthToken: 'رمز Bearer',
    builderAuthTokenUrl: 'عنوان الرمز',
    builderAuthClientId: 'معرّف العميل',
    builderAuthClientSecret: 'سرّ العميل',
    builderAuthScope: 'النطاق',
    builderAuthHmacHeader: 'ترويسة التوقيع',
    builderAuthHmacSecret: 'سرّ التوقيع',
    builderSecretSet: '•••••• (مُعيَّن)',
    builderSecretReplace: 'استبدال',
    builderSecretKeepHint: 'اتركه دون تغيير للإبقاء على السر المخزّن.',
    builderRecordsPath: 'مسار السجلات',
    builderRecordsPathHint:
      'مسار النقاط إلى مصفوفة السجلات (مثال: data.items). اتركه فارغًا لمصفوفة جذرية.',
    builderFieldMap: 'ربط الحقول',
    builderFieldMapHint: 'اربط كل سمة في lex بمسار حقل داخل السجل الواحد.',
    builderPaginationType: 'الترقيم',
    builderPaginationParam: 'المعامل',
    builderPaginationParamHint: 'معامل الاستعلام الذي يحمل رقم الصفحة أو رمز المؤشّر.',
    builderTestIntro: 'احفظ الموصّل، ثم شغّل اختبارًا حيًّا مقابل المواصفات أعلاه.',
    builderTestRun: 'اختبار الموصّل',
    builderTestRunning: 'جارٍ الاختبار…',
    builderTestCreateFirst: 'احفظ الموصّل لتفعيل الاختبار.',
    builderTestReachable: 'قابل للوصول',
    builderTestUnreachable: 'غير قابل للوصول',
    builderBaseUrlRequired: 'العنوان الأساسي إلزامي.',

    mapperInvalidJson: 'ليست JSON صالحة — أدخل كائنًا من أزواج «حقل lex»: «الحقل المصدر».',

    authNone: 'بدون',
    authBasic: 'أساسية',
    authBearer: 'رمز Bearer',
    authOauth2Cc: 'OAuth2 (بيانات اعتماد العميل)',
    authHmac: 'توقيع HMAC',

    pageNone: 'بدون',
    pagePage: 'رقم الصفحة',
    pageCursor: 'مؤشّر',

    rulesTitle: 'قواعد المزامنة',
    rulesSubtitle:
      'سلسلة تحويل/تصفية تُطبَّق على كل سجل أثناء المزامنة. تُنفَّذ القواعد من الأعلى إلى الأسفل.',
    rulesEmpty: 'لا توجد قواعد بعد',
    rulesEmptyHint: 'أضف تحويلًا لإعادة تشكيل الحقول أو مرشّحًا لإسقاط السجلات.',
    rulesAddTransform: 'إضافة تحويل',
    rulesAddFilter: 'إضافة مرشّح',
    rulesType: 'النوع',
    rulesOp: 'العملية',
    rulesField: 'الحقل',
    rulesFieldPlaceholder: 'مثال: status',
    rulesArgs: 'الوسائط',
    rulesArgsHint: 'قيم خاصة بالعملية (قيمة لكل حقل).',
    rulesArgPlaceholder: 'قيمة',
    rulesMoveUp: 'تحريك لأعلى',
    rulesMoveDown: 'تحريك لأسفل',
    rulesRemove: 'إزالة القاعدة',
    rulesStepLabel: 'الخطوة {n}',
    rulesPreview: 'معاينة الأثر',
    rulesPreviewRunning: 'جارٍ المعاينة…',
    rulesPreviewHint: 'شغّل تشغيلًا تجريبيًا لمعرفة عدد السجلات التي ستبقيها السلسلة الحالية.',
    rulesPreviewEffect: 'ستجتاز {n} سجلات السلسلة',

    ruleTypeTransform: 'تحويل',
    ruleTypeFilter: 'مرشّح',

    opConcat: 'دمج النصوص',
    opLookup: 'بحث',
    opDefault: 'قيمة افتراضية',
    opRegex: 'استبدال بتعبير نمطي',
    opDateFormat: 'إعادة تنسيق التاريخ',

    opEq: 'يساوي',
    opNe: 'لا يساوي',
    opIn: 'ضمن قائمة',
    opExists: 'موجود',
    opGt: 'أكبر من',
    opLt: 'أصغر من',

    conflictsTab: 'التعارضات',
    conflictsTitle: 'التعارضات',
    conflictsSubtitle:
      'اختلافات على مستوى الحقول اكتشفتها المطابقة. عالِج كلًّا منها بالدمج أو التجاوز أو التجاهل.',
    conflictsEmptyTitle: 'لا توجد تعارضات',
    conflictsEmptyBody: 'لم تجد المطابقة أي حقول متباينة بين النظام الخارجي وlex.',
    conflictsErrorTitle: 'تعذّر تحميل التعارضات',
    conflictsErrorBody: 'فشل الطلب. أعد المحاولة أو تأكّد من تشغيل الخدمة.',
    conflictsColExternalId: 'المعرّف الخارجي',
    conflictsColField: 'الحقل',
    conflictsColSource: 'قيمة المصدر',
    conflictsColLex: 'قيمة lex',
    conflictsColSuggested: 'المقترح',
    conflictsColStatus: 'الحالة',
    conflictsColDetected: 'اكتُشف',
    conflictsColActions: 'المعالجة',
    conflictsOpen: 'مفتوح',
    conflictsResolved: 'مُعالَج',
    conflictsFilterAll: 'الكل',
    conflictsFilterOpen: 'مفتوح',
    conflictsFilterResolved: 'مُعالَج',
    conflictsSelectAll: 'تحديد الكل',
    conflictsSelected: 'تم تحديد {n}',
    conflictsBulkResolve: 'معالجة المحدَّد',
    conflictsBulkApply: 'تطبيق',
    conflictsResolving: 'جارٍ المعالجة…',
    conflictsNoSuggestion: 'لا يوجد',
    conflictsManageOnly: 'صلاحيتك للقراءة فقط؛ معالجة التعارضات معطّلة.',
    conflictsKpiOpen: 'مفتوحة',
    conflictsKpiResolved: 'مُعالَجة',
    conflictsKpiTotal: 'الإجمالي',

    resolutionMerge: 'دمج',
    resolutionMergeHint: 'ادمج القيمتين حيثما أمكن.',
    resolutionOverride: 'تجاوز',
    resolutionOverrideHint: 'اعتمد قيمة المصدر الخارجي.',
    resolutionIgnore: 'تجاهل',
    resolutionIgnoreHint: 'أبقِ قيمة lex وأغلِق التعارض.',

    guardTitle: 'حارس التغيير الجماعي',
    guardBody:
      'ستؤدي هذه المزامنة إلى تعطيل {n} من أصل {total} كيانًا مربوطًا ({pct}٪) — أعلى من سقف الأمان {threshold}٪.',
    guardThreshold: 'السقف: {threshold}٪',
    guardWouldDeactivate: 'سيُعطَّل {n}',
    guardForceConfirm: 'فرض المزامنة على أي حال',
    guardForcing: 'جارٍ فرض المزامنة…',
    guardCancel: 'إلغاء',
    guardConfigLabel: 'سقف التغيير الجماعي (٪)',
    guardConfigHint:
      'احجب أي مزامنة ستعطّل أكثر من هذه النسبة من الكيانات المربوطة (الافتراضي 20).',

    toastConflictResolved: 'تمت معالجة التعارض.',
    toastConflictsResolved: 'تمت معالجة {n} تعارضات.',
    toastForced: 'تم فرض المزامنة متجاوزًا الحارس.',
    toastError: 'حدث خطأ ما. يُرجى المحاولة مرة أخرى.',
  },
};

/** Locale-bound accessor for the extensibility copy (Arabic-first). */
export function useExtensibilityLabels(): ExtensibilityLabels {
  const { locale } = useLocaleOrDefault();
  return locale === 'ar' ? extensibilityLabels.ar : extensibilityLabels.en;
}

/** Interpolate `{token}` placeholders (handles one or more distinct tokens). */
export function fillExtToken(
  template: string,
  tokens: Record<string, string | number>,
): string {
  return Object.entries(tokens).reduce(
    (acc, [token, value]) => acc.replace(`{${token}}`, String(value)),
    template,
  );
}

/* --------------------------------------------------------------------------- *
 * Enum → label resolvers.
 * --------------------------------------------------------------------------- */

export function authTypeLabel(t: ExtensibilityLabels, type: CustomAuthType): string {
  switch (type) {
    case 'none':
      return t.authNone;
    case 'basic':
      return t.authBasic;
    case 'bearer':
      return t.authBearer;
    case 'oauth2_cc':
      return t.authOauth2Cc;
    case 'hmac':
      return t.authHmac;
  }
}

export function paginationTypeLabel(
  t: ExtensibilityLabels,
  type: CustomPaginationType,
): string {
  switch (type) {
    case 'none':
      return t.pageNone;
    case 'page':
      return t.pagePage;
    case 'cursor':
      return t.pageCursor;
  }
}

export function ruleTypeLabel(t: ExtensibilityLabels, type: RuleType): string {
  return type === 'filter' ? t.ruleTypeFilter : t.ruleTypeTransform;
}

export function transformOpLabel(t: ExtensibilityLabels, op: TransformOp): string {
  switch (op) {
    case 'concat':
      return t.opConcat;
    case 'lookup':
      return t.opLookup;
    case 'default':
      return t.opDefault;
    case 'regex':
      return t.opRegex;
    case 'date_format':
      return t.opDateFormat;
  }
}

export function filterOpLabel(t: ExtensibilityLabels, op: FilterOp): string {
  switch (op) {
    case 'eq':
      return t.opEq;
    case 'ne':
      return t.opNe;
    case 'in':
      return t.opIn;
    case 'exists':
      return t.opExists;
    case 'gt':
      return t.opGt;
    case 'lt':
      return t.opLt;
  }
}

export function resolutionLabel(t: ExtensibilityLabels, r: ConflictResolution): string {
  switch (r) {
    case 'merge':
      return t.resolutionMerge;
    case 'override':
      return t.resolutionOverride;
    case 'ignore':
      return t.resolutionIgnore;
  }
}

export function resolutionHint(t: ExtensibilityLabels, r: ConflictResolution): string {
  switch (r) {
    case 'merge':
      return t.resolutionMergeHint;
    case 'override':
      return t.resolutionOverrideHint;
    case 'ignore':
      return t.resolutionIgnoreHint;
  }
}

export function conflictStatusLabel(t: ExtensibilityLabels, s: ConflictStatus): string {
  return s === 'resolved' ? t.conflictsResolved : t.conflictsOpen;
}
