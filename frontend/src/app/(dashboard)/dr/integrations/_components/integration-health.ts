'use client';

import { useMemo } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  CircleDashed,
  Settings2,
  type LucideIcon,
} from 'lucide-react';
import type { VariantProps } from 'class-variance-authority';
import type { statusChipVariants } from '@/components/shared/status-chip';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { DRIntegration, DRIntegrationStatus } from '@/lib/clario-dr';
import { isApiError } from '@/types/api';
import { type DRBilingual, resolveDRBilingual } from '../../_lib/dr-i18n';

/**
 * Health / observability layer for the DR integrations route.
 *
 * The connection-health roll-up and the per-status presentation map are derived
 * from the REAL `DRIntegration` shape only (status / enabled / last_tested_at /
 * last_test_error). Nothing here reads a clock or invents a field.
 *
 * Feature-local copy lives in `integrationHealthLabelBundle` and is intentionally
 * kept out of the shared `_lib/dr-i18n.ts` per the route contract. Per the
 * console's bilingual contract it is a `DRBilingual<IntegrationHealthCopy>`
 * bundle (full English + professional MSA copies) resolved against the active
 * locale by {@link useIntegrationHealthLabels} (English fallback), so the
 * `renderWithQuery` `en` default keeps existing English assertions green while an
 * Arabic user sees the full MSA surface.
 *
 * The pure roll-up / normalization / presentation helpers stay side-effect-free
 * and locale-agnostic; only the copy bundle + its hook are client-scoped.
 */

/** Tone keys accepted by the design-system `StatusChip`. */
type StatusChipTone = NonNullable<VariantProps<typeof statusChipVariants>['tone']>;

export interface IntegrationStatusPresentation {
  /** Stable key for the underlying status. */
  status: DRIntegrationStatus;
  /** StatusChip tone — color is always paired with the visible label below. */
  tone: StatusChipTone;
  icon: LucideIcon;
}

/**
 * Status → StatusChip presentation. Color is never the sole signal: every chip
 * also carries the resolved label (see `integrationHealthLabels`) and an icon.
 */
export const INTEGRATION_STATUS_PRESENTATION: Record<
  DRIntegrationStatus,
  IntegrationStatusPresentation
> = {
  active: { status: 'active', tone: 'success', icon: CheckCircle2 },
  configured: { status: 'configured', tone: 'info', icon: Settings2 },
  untested: { status: 'untested', tone: 'neutral', icon: CircleDashed },
  error: { status: 'error', tone: 'danger', icon: AlertCircle },
};

const KNOWN_STATUSES: ReadonlySet<string> = new Set<DRIntegrationStatus>([
  'active',
  'configured',
  'untested',
  'error',
]);

/**
 * Normalize a possibly-unknown backend status string to a known
 * `DRIntegrationStatus`. The API types `status` as `DRIntegrationStatus | string`,
 * so anything the UI does not recognize is treated as `untested` (the safest,
 * least-alarming bucket) rather than crashing the presentation map.
 */
export function normalizeIntegrationStatus(status: string): DRIntegrationStatus {
  const trimmed = status.trim().toLowerCase();
  return KNOWN_STATUSES.has(trimmed)
    ? (trimmed as DRIntegrationStatus)
    : 'untested';
}

export function presentationForStatus(
  status: string,
): IntegrationStatusPresentation {
  return INTEGRATION_STATUS_PRESENTATION[normalizeIntegrationStatus(status)];
}

/**
 * Connection-health roll-up across all configured integrations. Counts are
 * derived from the real `status` field; `total` is the row count and `disabled`
 * counts connectors whose `enabled` flag is false (orthogonal to status).
 */
export interface IntegrationHealthSummary {
  total: number;
  active: number;
  configured: number;
  untested: number;
  error: number;
  disabled: number;
}

export function summarizeIntegrationHealth(
  integrations: DRIntegration[],
): IntegrationHealthSummary {
  return integrations.reduce<IntegrationHealthSummary>(
    (acc, integration) => {
      acc.total += 1;
      acc[normalizeIntegrationStatus(integration.status)] += 1;
      if (!integration.enabled) acc.disabled += 1;
      return acc;
    },
    { total: 0, active: 0, configured: 0, untested: 0, error: 0, disabled: 0 },
  );
}

/**
 * isIntegrationsFeatureDisabled distinguishes the "capability not enabled" case
 * from a genuine fetch failure.
 *
 * The backend only mounts the `/api/v1/dr/integrations` router when
 * `DR_INTEGRATIONS_ENC_KEY` is set (see cmd/clario-dr-service: the integrations
 * router is nil and the mount is skipped when the AES envelope key is absent).
 * With the route unmounted, the list request resolves to a chi 404, which the
 * axios layer normalises to an `ApiError` with `status === 404` (see
 * `buildApiError`). A real outage instead surfaces as 0 (network) / 408
 * (timeout) / 5xx, so 404 is the unambiguous feature-disabled signal here.
 *
 * Returning `true` lets the page render an informational "enable this capability"
 * state rather than an alarming error surface.
 */
export function isIntegrationsFeatureDisabled(error: unknown): boolean {
  return isApiError(error) && error.status === 404;
}

// ---------------------------------------------------------------------------
// Feature-local copy (bilingual-structured; English filled).
// ---------------------------------------------------------------------------

export interface IntegrationHealthCopy {
  /** Roll-up header. */
  healthHeading: string;
  healthDescription: string;
  countTotal: string;
  countActive: string;
  countConfigured: string;
  countUntested: string;
  countError: string;
  countDisabled: string;
  testAll: string;
  testAllRunning: string;
  testAllEmpty: string;

  /** Per-status chip labels. */
  statusActive: string;
  statusConfigured: string;
  statusUntested: string;
  statusError: string;

  /** Per-row health cell. */
  enabledLabel: string;
  disabledLabel: string;
  lastTestedNever: string;
  lastTestErrorLabel: string;
  testAction: string;
  testActionRunning: string;

  /** Table chrome. */
  tableEmpty: string;
  colName: string;
  colKind: string;
  colVendor: string;
  colHealth: string;
  colActions: string;
  editAction: string;
  deleteAction: string;

  /** First-class empty / onboarding state (no connectors configured yet). */
  emptyTitle: string;
  emptyDescription: string;
  emptyAction: string;
  emptyReadOnlyDescription: string;
  /**
   * Prominent first-run on-ramp (shown above the empty card when no connectors
   * exist): connecting a source is the explicit first step before any replication
   * can run.
   */
  firstRunEyebrow: string;
  firstRunTitle: string;
  firstRunDescription: string;
  firstRunStepSources: string;
  firstRunStepReplicate: string;
  firstRunStepRecover: string;
  /** Consistent load-error copy for the integrations surface. */
  loadErrorTitle: string;
  loadErrorMessage: string;

  /**
   * Feature-disabled state — shown when the backend integrations API is ABSENT
   * because `DR_INTEGRATIONS_ENC_KEY` is unset (the router is not mounted, so the
   * list request 404s). This is an informational state, NOT an error: the
   * platform is healthy, the capability is simply not enabled.
   */
  featureDisabledTitle: string;
  featureDisabledDescription: string;
  featureDisabledEnvHint: string;

  /** Page framing. */
  pageTitle: string;
  pageDescription: string;
  refreshAction: string;

  /** Toasts (functions interpolate the connector name; signatures match en/ar). */
  toastUpdated: (name: string) => string;
  toastCreated: (name: string) => string;
  toastSaveFailed: string;
  toastTestFailedWithError: (error: string) => string;
  toastTestFailedFor: (name: string) => string;
  toastTestSucceededFor: (name: string) => string;
  toastTestFailedGeneric: string;
  toastTestAllSucceeded: (count: number) => string;
  toastTestAllFailed: (failures: number, total: number) => string;
  toastDeleted: (name: string) => string;
  toastDeleteFailed: string;

  /** Delete-confirm dialog. */
  deleteTitle: string;
  deleteDescription: (name: string) => string;
  deleteConfirm: string;

  /** Create/edit dialog. */
  dialogEditTitle: string;
  dialogCreateTitle: string;
  dialogDescription: string;
  fieldName: string;
  fieldNamePlaceholder: string;
  fieldKind: string;
  fieldKindPlaceholder: string;
  fieldVendor: string;
  fieldVendorPlaceholder: string;
  fieldEndpoint: string;
  fieldEndpointPlaceholder: string;
  fieldEnabled: string;
  fieldEnabledHint: string;
  credentialsHeading: string;
  credentialsHintEditing: string;
  credentialsHintCreating: string;
  fieldUsername: string;
  fieldUsernamePlaceholder: string;
  fieldToken: string;
  fieldTokenPlaceholderEditing: string;
  fieldTokenPlaceholderCreating: string;
  fieldCaCert: string;
  fieldCaCertPlaceholder: string;
  dialogCancel: string;
  dialogSaving: string;
  dialogSaveChanges: string;
  dialogCreate: string;
}

export const integrationHealthLabelBundle: DRBilingual<IntegrationHealthCopy> = {
  en: {
    healthHeading: 'Connection health',
    healthDescription:
      'Live status of every configured recovery connector, derived from the most recent connection test.',
    countTotal: 'Total',
    countActive: 'Active',
    countConfigured: 'Configured',
    countUntested: 'Untested',
    countError: 'Errored',
    countDisabled: 'Disabled',
    testAll: 'Test all connections',
    testAllRunning: 'Testing connections…',
    testAllEmpty: 'No connectors to test',

    statusActive: 'Active',
    statusConfigured: 'Configured',
    statusUntested: 'Untested',
    statusError: 'Error',

    enabledLabel: 'Enabled',
    disabledLabel: 'Disabled',
    lastTestedNever: 'Never tested',
    lastTestErrorLabel: 'Last test error',
    testAction: 'Test',
    testActionRunning: 'Testing…',

    tableEmpty: 'No recovery integrations configured yet.',
    colName: 'Name',
    colKind: 'Kind',
    colVendor: 'Vendor',
    colHealth: 'Connection health',
    colActions: 'Actions',
    editAction: 'Edit',
    deleteAction: 'Delete',

    pageTitle: 'Recovery Integrations',
    pageDescription:
      'Connect ClarioDR to hypervisors, storage arrays, cloud vaults, and Kubernetes clusters that power capture, snapshotting, and recovery orchestration.',
    refreshAction: 'Refresh',

    toastUpdated: (name) => `Integration "${name}" updated`,
    toastCreated: (name) => `Integration "${name}" created`,
    toastSaveFailed: 'Failed to save integration',
    toastTestFailedWithError: (error) => `Connection test failed: ${error}`,
    toastTestFailedFor: (name) => `Connection test failed for "${name}"`,
    toastTestSucceededFor: (name) => `Connection test succeeded for "${name}"`,
    toastTestFailedGeneric: 'Connection test failed',
    toastTestAllSucceeded: (count) =>
      `All ${count} connection${count === 1 ? '' : 's'} tested successfully`,
    toastTestAllFailed: (failures, total) =>
      `${failures} of ${total} connection test${total === 1 ? '' : 's'} failed`,
    toastDeleted: (name) => `Integration "${name}" deleted`,
    toastDeleteFailed: 'Failed to delete integration',

    deleteTitle: 'Delete integration',
    deleteDescription: (name) =>
      `Delete "${name}"? ClarioDR will lose access to this connector and its stored credentials.`,
    deleteConfirm: 'Delete',

    dialogEditTitle: 'Edit integration',
    dialogCreateTitle: 'New recovery integration',
    dialogDescription:
      'Connect ClarioDR to a hypervisor, storage array, cloud vault, or Kubernetes cluster. Credentials are stored write-only and never shown again.',
    fieldName: 'Name',
    fieldNamePlaceholder: 'Primary vSphere cluster',
    fieldKind: 'Kind',
    fieldKindPlaceholder: 'Select kind',
    fieldVendor: 'Vendor',
    fieldVendorPlaceholder: 'Select vendor',
    fieldEndpoint: 'Endpoint',
    fieldEndpointPlaceholder: 'https://vcenter.corp.local',
    fieldEnabled: 'Enabled',
    fieldEnabledHint: 'Disabled integrations are kept but excluded from recovery orchestration.',
    credentialsHeading: 'Credentials',
    credentialsHintEditing: 'Leave blank to keep the existing stored credentials unchanged.',
    credentialsHintCreating: 'Provide the credentials ClarioDR should use to authenticate.',
    fieldUsername: 'Username',
    fieldUsernamePlaceholder: 'svc-clario-dr',
    fieldToken: 'Token / password',
    fieldTokenPlaceholderEditing: '••••••••',
    fieldTokenPlaceholderCreating: 'API token or password',
    fieldCaCert: 'CA certificate (PEM)',
    fieldCaCertPlaceholder: '-----BEGIN CERTIFICATE-----',
    dialogCancel: 'Cancel',
    dialogSaving: 'Saving…',
    dialogSaveChanges: 'Save changes',
    dialogCreate: 'Create integration',

    emptyTitle: 'Connect your first recovery integration',
    emptyDescription:
      'Add a hypervisor, storage array, cloud vault, or Kubernetes cluster so ClarioDR can drive capture, snapshotting, and recovery orchestration against your infrastructure.',
    emptyAction: 'Add integration',
    emptyReadOnlyDescription:
      'No recovery connectors are configured yet. An operator with the dr:write permission can add a hypervisor, storage array, cloud vault, or Kubernetes cluster here.',
    firstRunEyebrow: 'First run',
    firstRunTitle: 'Connect a source to begin replication',
    firstRunDescription:
      'ClarioDR needs at least one connected source — a hypervisor, storage array, cloud vault, or Kubernetes cluster — before it can capture data and drive recovery. Connecting a source is the first step.',
    firstRunStepSources: 'Connect a source',
    firstRunStepReplicate: 'Replicate into a protection group',
    firstRunStepRecover: 'Recover, rehearse and prove',
    loadErrorTitle: 'Unable to load integrations',
    loadErrorMessage: 'The DR integrations service could not be reached.',
    featureDisabledTitle: 'External recovery integrations are not enabled',
    featureDisabledDescription:
      'The integrations catalog is turned off on this deployment, so ClarioDR cannot store connector credentials for hypervisors, storage arrays, cloud vaults, or Kubernetes clusters yet. Capture and recovery continue to run on the connectors already wired into the platform.',
    featureDisabledEnvHint:
      'To enable external recovery integrations, set DR_INTEGRATIONS_ENC_KEY (a base64-encoded 32-byte AES key) on the ClarioDR service and restart it.',
  },
  ar: {
    healthHeading: 'سلامة الاتصال',
    healthDescription:
      'الحالة الحيّة لكل موصِّل استرداد مُهيّأ، مُشتقّة من أحدث اختبار اتصال.',
    countTotal: 'الإجمالي',
    countActive: 'نشط',
    countConfigured: 'مُهيّأ',
    countUntested: 'غير مختبَر',
    countError: 'به خطأ',
    countDisabled: 'مُعطَّل',
    testAll: 'اختبار جميع الاتصالات',
    testAllRunning: 'جارٍ اختبار الاتصالات…',
    testAllEmpty: 'لا توجد موصِّلات لاختبارها',

    statusActive: 'نشط',
    statusConfigured: 'مُهيّأ',
    statusUntested: 'غير مختبَر',
    statusError: 'خطأ',

    enabledLabel: 'مُفعَّل',
    disabledLabel: 'مُعطَّل',
    lastTestedNever: 'لم يُختبَر مطلقًا',
    lastTestErrorLabel: 'خطأ آخر اختبار',
    testAction: 'اختبار',
    testActionRunning: 'جارٍ الاختبار…',

    tableEmpty: 'لم تُهيّأ أي تكاملات استرداد بعد.',
    colName: 'الاسم',
    colKind: 'النوع',
    colVendor: 'المورّد',
    colHealth: 'سلامة الاتصال',
    colActions: 'الإجراءات',
    editAction: 'تعديل',
    deleteAction: 'حذف',

    pageTitle: 'تكاملات التعافي من الكوارث',
    pageDescription:
      'اربط ClarioDR بمُشرفي الأجهزة الافتراضية ومصفوفات التخزين والخزائن السحابية وعناقيد Kubernetes التي تشغّل الالتقاط وأخذ اللقطات وتنسيق الاسترداد.',
    refreshAction: 'تحديث',

    toastUpdated: (name) => `تم تحديث التكامل "${name}"`,
    toastCreated: (name) => `تم إنشاء التكامل "${name}"`,
    toastSaveFailed: 'تعذّر حفظ التكامل',
    toastTestFailedWithError: (error) => `فشل اختبار الاتصال: ${error}`,
    toastTestFailedFor: (name) => `فشل اختبار الاتصال للتكامل "${name}"`,
    toastTestSucceededFor: (name) => `نجح اختبار الاتصال للتكامل "${name}"`,
    toastTestFailedGeneric: 'فشل اختبار الاتصال',
    toastTestAllSucceeded: (count) => `تم اختبار ${count} اتصال بنجاح`,
    toastTestAllFailed: (failures, total) => `فشل ${failures} من ${total} اختبار اتصال`,
    toastDeleted: (name) => `تم حذف التكامل "${name}"`,
    toastDeleteFailed: 'تعذّر حذف التكامل',

    deleteTitle: 'حذف التكامل',
    deleteDescription: (name) =>
      `هل تريد حذف "${name}"؟ سيفقد ClarioDR الوصول إلى هذا الموصِّل وبيانات اعتماده المخزّنة.`,
    deleteConfirm: 'حذف',

    dialogEditTitle: 'تعديل التكامل',
    dialogCreateTitle: 'تكامل استرداد جديد',
    dialogDescription:
      'اربط ClarioDR بمُشرف أجهزة افتراضية أو مصفوفة تخزين أو خزينة سحابية أو عنقود Kubernetes. تُخزَّن بيانات الاعتماد للكتابة فقط ولا تُعرض مرة أخرى.',
    fieldName: 'الاسم',
    fieldNamePlaceholder: 'عنقود vSphere الأساسي',
    fieldKind: 'النوع',
    fieldKindPlaceholder: 'اختر النوع',
    fieldVendor: 'المورّد',
    fieldVendorPlaceholder: 'اختر المورّد',
    fieldEndpoint: 'نقطة النهاية',
    fieldEndpointPlaceholder: 'https://vcenter.corp.local',
    fieldEnabled: 'مُفعَّل',
    fieldEnabledHint: 'تُحتفَظ التكاملات المُعطَّلة لكنها تُستبعَد من تنسيق الاسترداد.',
    credentialsHeading: 'بيانات الاعتماد',
    credentialsHintEditing: 'اتركها فارغة للإبقاء على بيانات الاعتماد المخزّنة دون تغيير.',
    credentialsHintCreating: 'وفّر بيانات الاعتماد التي يجب أن يستخدمها ClarioDR للمصادقة.',
    fieldUsername: 'اسم المستخدم',
    fieldUsernamePlaceholder: 'svc-clario-dr',
    fieldToken: 'الرمز / كلمة المرور',
    fieldTokenPlaceholderEditing: '••••••••',
    fieldTokenPlaceholderCreating: 'رمز واجهة برمجة التطبيقات أو كلمة المرور',
    fieldCaCert: 'شهادة المرجع المُصدِّق (PEM)',
    fieldCaCertPlaceholder: '-----BEGIN CERTIFICATE-----',
    dialogCancel: 'إلغاء',
    dialogSaving: 'جارٍ الحفظ…',
    dialogSaveChanges: 'حفظ التغييرات',
    dialogCreate: 'إنشاء التكامل',

    emptyTitle: 'اربط أول تكامل استرداد لك',
    emptyDescription:
      'أضِف مُشرف أجهزة افتراضية أو مصفوفة تخزين أو خزينة سحابية أو عنقود Kubernetes حتى يتمكّن ClarioDR من تشغيل الالتقاط وأخذ اللقطات وتنسيق الاسترداد على بنيتك التحتية.',
    emptyAction: 'إضافة تكامل',
    emptyReadOnlyDescription:
      'لم تُهيّأ أي موصِّلات استرداد بعد. يمكن لمشغّل يملك صلاحية الكتابة (dr:write) إضافة مُشرف أجهزة افتراضية أو مصفوفة تخزين أو خزينة سحابية أو عنقود Kubernetes هنا.',
    firstRunEyebrow: 'التشغيل الأول',
    firstRunTitle: 'اربط مصدرًا لبدء النسخ المتماثل',
    firstRunDescription:
      'يحتاج ClarioDR إلى مصدر واحد مُتصل على الأقل — مُشرف أجهزة افتراضية أو مصفوفة تخزين أو خزينة سحابية أو عنقود Kubernetes — قبل أن يتمكّن من التقاط البيانات وتشغيل الاسترداد. ربط مصدر هو الخطوة الأولى.',
    firstRunStepSources: 'اربط مصدرًا',
    firstRunStepReplicate: 'انسخ إلى مجموعة حماية',
    firstRunStepRecover: 'استرداد وتمرين وإثبات',
    loadErrorTitle: 'تعذّر تحميل التكاملات',
    loadErrorMessage: 'تعذّر الوصول إلى خدمة تكاملات التعافي من الكوارث.',
    featureDisabledTitle: 'تكاملات التعافي الخارجية غير مُفعَّلة',
    featureDisabledDescription:
      'كتالوج التكاملات مُعطَّل في هذا النشر، لذا لا يستطيع ClarioDR بعدُ تخزين بيانات اعتماد الموصِّلات الخاصة بمُشرفي الأجهزة الافتراضية أو مصفوفات التخزين أو الخزائن السحابية أو عناقيد Kubernetes. ويستمرّ الالتقاط والاسترداد في العمل عبر الموصِّلات المُهيّأة مسبقًا في المنصّة.',
    featureDisabledEnvHint:
      'لتفعيل تكاملات التعافي الخارجية، اضبط المتغيّر DR_INTEGRATIONS_ENC_KEY (مفتاح AES بطول 32 بايت مُرمَّز بنظام base64) على خدمة ClarioDR ثم أعِد تشغيلها.',
  },
};

/**
 * useIntegrationHealthLabels resolves the integrations copy against the active
 * locale (English fallback), mirroring {@link useDRLabels}. Memoised by locale.
 */
export function useIntegrationHealthLabels(): IntegrationHealthCopy {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveDRBilingual(integrationHealthLabelBundle, locale), [locale]);
}

/** Resolve the visible status label for a (possibly unknown) backend status. */
export function statusLabel(copy: IntegrationHealthCopy, status: string): string {
  switch (normalizeIntegrationStatus(status)) {
    case 'active':
      return copy.statusActive;
    case 'configured':
      return copy.statusConfigured;
    case 'error':
      return copy.statusError;
    case 'untested':
    default:
      return copy.statusUntested;
  }
}
