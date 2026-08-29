'use client';

/**
 * Scoped bilingual (AR — MSA / EN) labels for the integration GOVERNANCE surface
 * (#13 maker-checker change queue, #14 external secret references, #15 egress
 * policy).
 *
 * Kept in its own module (NOT folded into `_labels.ts` nor the shared
 * `@/lib/i18n/messages` catalog) on purpose: `_labels.ts` is concurrently
 * owned/extended by sibling list/catalog/wizard units, and the shared catalog is
 * the integrator's to own — proposed shared keys are listed in the manifest.
 * Same pattern as the coexisting `reliability-labels.ts` / `detail-ops-labels.ts`.
 * All copy is plain strings (no JSX), RTL-safe; `{token}` placeholders are
 * interpolated with {@link fillGovernanceToken}.
 */
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type {
  PendingChangeStatus,
  SecretRefProvider,
} from '@/lib/lex/integrations';

export interface GovernanceLabels {
  /* ── Pending-changes queue (#13) ── */
  queueTab: string;
  queueTitle: string;
  queueSubtitle: string;
  queueEmpty: string;
  queueEmptyHint: string;
  queueErrorTitle: string;
  queueErrorBody: string;
  queueFilterAll: string;
  queueFilterPending: string;
  queueFilterApproved: string;
  queueFilterRejected: string;
  queuePendingCount: string; // "{n} awaiting review"

  /* ── Change-request card ── */
  changeEndpoint: string;
  changeRequestedBy: string;
  changeRequestedAt: string;
  changeReviewer: string;
  changeReviewedAt: string;
  changeDiffTitle: string;
  changeField: string;
  changeOld: string;
  changeNew: string;
  changeNoValue: string; // "—" / unset old value
  changeSecretMasked: string; // shown in place of any secret value
  changeSecretRef: string; // "external reference" tag on a secret-ref diff
  changeNote: string;
  changeNotePlaceholder: string;
  changeNoteOptional: string;
  changeNoteRequired: string;
  changeNoteRequiredHint: string;

  /* ── Status badges (PendingChangeStatus) ── */
  statusPending: string;
  statusApproved: string;
  statusRejected: string;

  /* ── Approve / reject actions ── */
  approve: string;
  approving: string;
  reject: string;
  rejecting: string;
  approveConfirmTitle: string;
  approveConfirmBody: string;
  rejectConfirmTitle: string;
  rejectConfirmBody: string;

  /* ── Separation-of-duties (SoD) ── */
  sodHintTitle: string;
  sodHintBody: string; // approver must differ from requester
  sodSelfBlocked: string; // you proposed this change; another reviewer must approve

  /* ── Protected-endpoint notice (on the detail form) ── */
  protectedNoticeTitle: string;
  protectedNoticeBody: string; // Save will create a pending change
  protectedQueuedTitle: string;
  protectedQueuedBody: string; // your change was queued for approval
  protectedViewQueue: string;

  /* ── Toasts ── */
  toastApproved: string;
  toastRejected: string;
  toastQueued: string;
  toastApplied: string;
  toastError: string;

  /* ── External secret references (#14) ── */
  refToggleLabel: string; // "Use external reference"
  refToggleHint: string; // stored as reference, resolved at call time
  refKmsPlaceholder: string;
  refVaultPlaceholder: string;
  refProvider: string;
  refProviderNone: string;
  refProviderKms: string;
  refProviderVault: string;
  refStoredNote: string; // "Stored as a reference; resolved at call time."
  refUseLiteral: string; // switch back to a literal secret
  refInvalid: string; // must start with kms:// or vault://
  rotateEveryDays: string;
  rotateEveryDaysHint: string; // 0 = off; drives reminder/auto-rotate + expiry alert
  rotateOff: string;
  rotateActive: string; // "Rotates every {n} days"

  /* ── Egress policy editor (#15) ── */
  egressTitle: string;
  egressSubtitle: string;
  egressRegions: string;
  egressRegionsHint: string;
  egressRegionsPlaceholder: string;
  egressFields: string;
  egressFieldsHint: string;
  egressFieldsPlaceholder: string;
  egressFieldsAdd: string;
  egressFieldInvalid: string; // malformed allow-list field key (no host/URL/spaces/wildcards)
  egressInKingdomTitle: string;
  egressInKingdomBody: string; // default keeps data in-Kingdom
  egressBlockedCount: string; // "{n} egress attempts blocked"
  egressUpdatedAt: string;
  egressUnconfigured: string;
  egressSave: string;
  egressSaving: string;
  egressReset: string;
  egressToastSaved: string;
  egressEmptyRegionsWarn: string; // empty regions = nothing may leave
}

export const governanceLabels: { en: GovernanceLabels; ar: GovernanceLabels } = {
  en: {
    queueTab: 'Pending changes',
    queueTitle: 'Change review queue',
    queueSubtitle:
      'Configuration changes to protected connectors wait here for a second operator to approve before they apply.',
    queueEmpty: 'No changes awaiting review',
    queueEmptyHint:
      'Edits to protected connectors (active production or government-gated) appear here for approval.',
    queueErrorTitle: 'Could not load the review queue',
    queueErrorBody: 'The request failed. Retry, or check that the service is running.',
    queueFilterAll: 'All',
    queueFilterPending: 'Pending',
    queueFilterApproved: 'Approved',
    queueFilterRejected: 'Rejected',
    queuePendingCount: '{n} awaiting review',

    changeEndpoint: 'Integration',
    changeRequestedBy: 'Requested by',
    changeRequestedAt: 'Requested',
    changeReviewer: 'Reviewer',
    changeReviewedAt: 'Reviewed',
    changeDiffTitle: 'Proposed changes',
    changeField: 'Field',
    changeOld: 'Current',
    changeNew: 'Proposed',
    changeNoValue: 'Not set',
    changeSecretMasked: '•••••• (secret)',
    changeSecretRef: 'external reference',
    changeNote: 'Review note',
    changeNotePlaceholder: 'Add a note for the audit trail…',
    changeNoteOptional: 'Optional on approval.',
    changeNoteRequired: 'A note is required to reject.',
    changeNoteRequiredHint: 'Explain why this change is being rejected.',

    statusPending: 'Pending',
    statusApproved: 'Approved',
    statusRejected: 'Rejected',

    approve: 'Approve',
    approving: 'Approving…',
    reject: 'Reject',
    rejecting: 'Rejecting…',
    approveConfirmTitle: 'Approve this change?',
    approveConfirmBody:
      'The proposed configuration will be applied to the connector immediately. This is recorded in the audit trail.',
    rejectConfirmTitle: 'Reject this change?',
    rejectConfirmBody:
      'The proposed configuration will be discarded and the connector left unchanged. A note is required.',

    sodHintTitle: 'Separation of duties',
    sodHintBody: 'The reviewer must be a different operator from the requester.',
    sodSelfBlocked:
      'You proposed this change, so you cannot approve it. Another operator must review it.',

    protectedNoticeTitle: 'Protected connector',
    protectedNoticeBody:
      'This connector is protected (active production or government-gated). Saving will create a change request for a second operator to approve rather than applying directly.',
    protectedQueuedTitle: 'Change queued for approval',
    protectedQueuedBody:
      'Your edit was recorded as a pending change. It applies once another operator approves it.',
    protectedViewQueue: 'Open the review queue',

    toastApproved: 'Change approved and applied.',
    toastRejected: 'Change rejected.',
    toastQueued: 'Change queued for approval.',
    toastApplied: 'Changes saved.',
    toastError: 'Something went wrong. Please try again.',

    refToggleLabel: 'Use external reference',
    refToggleHint: 'Point at a key in KMS or Vault instead of storing the secret here.',
    refKmsPlaceholder: 'kms://alias/your-key-id',
    refVaultPlaceholder: 'vault://secret/path#field',
    refProvider: 'Reference provider',
    refProviderNone: 'None (literal secret)',
    refProviderKms: 'KMS',
    refProviderVault: 'Vault',
    refStoredNote: 'Stored as a reference; the value is resolved at call time by the key provider.',
    refUseLiteral: 'Enter a literal secret instead',
    refInvalid: 'A reference must start with kms:// or vault://',
    rotateEveryDays: 'Rotate every (days)',
    rotateEveryDaysHint:
      '0 turns rotation off. A non-zero value drives a rotation reminder / auto-rotate and an expiry alert.',
    rotateOff: 'Rotation off',
    rotateActive: 'Rotates every {n} days',

    egressTitle: 'Egress policy',
    egressSubtitle:
      'Control where data may leave to and which fields may be sent outbound. Data stays in-Kingdom by default.',
    egressRegions: 'Allowed regions',
    egressRegionsHint: 'Destination regions data may be sent to. Leave empty to block all egress.',
    egressRegionsPlaceholder: 'Select regions…',
    egressFields: 'Allowed egress fields',
    egressFieldsHint: 'Only these lex fields may be sent outbound; everything else is stripped.',
    egressFieldsPlaceholder: 'e.g. case_number',
    egressFieldsAdd: 'Add field',
    egressFieldInvalid: 'Invalid field key — use letters, digits, _ . - only, with no spaces.',
    egressInKingdomTitle: 'In-Kingdom by default',
    egressInKingdomBody:
      'With no external region allowed, data is confined to Saudi regions to meet PDPL data-residency requirements.',
    egressBlockedCount: '{n} egress attempts blocked',
    egressUpdatedAt: 'Updated',
    egressUnconfigured: 'No egress policy set yet — the default in-Kingdom guardrail applies.',
    egressSave: 'Save policy',
    egressSaving: 'Saving…',
    egressReset: 'Reset',
    egressToastSaved: 'Egress policy saved.',
    egressEmptyRegionsWarn: 'No regions allowed — all egress is currently blocked.',
  },
  ar: {
    queueTab: 'التغييرات المعلّقة',
    queueTitle: 'طابور مراجعة التغييرات',
    queueSubtitle:
      'تنتظر تغييرات إعداد الموصّلات المحمية هنا ليوافق عليها مشغّل ثانٍ قبل تطبيقها.',
    queueEmpty: 'لا توجد تغييرات بانتظار المراجعة',
    queueEmptyHint:
      'تظهر هنا تعديلات الموصّلات المحمية (إنتاج فعّال أو مقيّدة حكوميًا) للموافقة عليها.',
    queueErrorTitle: 'تعذّر تحميل طابور المراجعة',
    queueErrorBody: 'فشل الطلب. أعد المحاولة أو تأكّد من تشغيل الخدمة.',
    queueFilterAll: 'الكل',
    queueFilterPending: 'معلّق',
    queueFilterApproved: 'موافَق عليه',
    queueFilterRejected: 'مرفوض',
    queuePendingCount: '{n} بانتظار المراجعة',

    changeEndpoint: 'التكامل',
    changeRequestedBy: 'طلبه',
    changeRequestedAt: 'تاريخ الطلب',
    changeReviewer: 'المراجِع',
    changeReviewedAt: 'تاريخ المراجعة',
    changeDiffTitle: 'التغييرات المقترحة',
    changeField: 'الحقل',
    changeOld: 'الحالي',
    changeNew: 'المقترح',
    changeNoValue: 'غير مُعيَّن',
    changeSecretMasked: '•••••• (سرّي)',
    changeSecretRef: 'مرجع خارجي',
    changeNote: 'ملاحظة المراجعة',
    changeNotePlaceholder: 'أضف ملاحظة لسجل التدقيق…',
    changeNoteOptional: 'اختيارية عند الموافقة.',
    changeNoteRequired: 'الملاحظة مطلوبة للرفض.',
    changeNoteRequiredHint: 'وضّح سبب رفض هذا التغيير.',

    statusPending: 'معلّق',
    statusApproved: 'موافَق عليه',
    statusRejected: 'مرفوض',

    approve: 'موافقة',
    approving: 'جارٍ الموافقة…',
    reject: 'رفض',
    rejecting: 'جارٍ الرفض…',
    approveConfirmTitle: 'الموافقة على هذا التغيير؟',
    approveConfirmBody:
      'سيُطبَّق الإعداد المقترح على الموصّل فورًا. يُسجَّل ذلك في سجل التدقيق.',
    rejectConfirmTitle: 'رفض هذا التغيير؟',
    rejectConfirmBody:
      'سيُتجاهَل الإعداد المقترح ويُترَك الموصّل دون تغيير. الملاحظة مطلوبة.',

    sodHintTitle: 'الفصل بين المهام',
    sodHintBody: 'يجب أن يكون المراجِع مشغّلًا مختلفًا عن مقدّم الطلب.',
    sodSelfBlocked:
      'أنت من اقترح هذا التغيير، لذا لا يمكنك الموافقة عليه. يجب أن يراجعه مشغّل آخر.',

    protectedNoticeTitle: 'موصّل محمي',
    protectedNoticeBody:
      'هذا الموصّل محمي (إنتاج فعّال أو مقيّد حكوميًا). سيؤدي الحفظ إلى إنشاء طلب تغيير يوافق عليه مشغّل ثانٍ بدلًا من التطبيق المباشر.',
    protectedQueuedTitle: 'تمت إضافة التغيير للموافقة',
    protectedQueuedBody:
      'سُجِّل تعديلك كتغيير معلّق. يُطبَّق بمجرد موافقة مشغّل آخر عليه.',
    protectedViewQueue: 'فتح طابور المراجعة',

    toastApproved: 'تمت الموافقة على التغيير وتطبيقه.',
    toastRejected: 'تم رفض التغيير.',
    toastQueued: 'تمت إضافة التغيير للموافقة.',
    toastApplied: 'تم حفظ التغييرات.',
    toastError: 'حدث خطأ ما. يُرجى المحاولة مرة أخرى.',

    refToggleLabel: 'استخدام مرجع خارجي',
    refToggleHint: 'أشِر إلى مفتاح في KMS أو Vault بدلًا من تخزين السر هنا.',
    refKmsPlaceholder: 'kms://alias/your-key-id',
    refVaultPlaceholder: 'vault://secret/path#field',
    refProvider: 'مزوّد المرجع',
    refProviderNone: 'لا شيء (سرّ مباشر)',
    refProviderKms: 'KMS',
    refProviderVault: 'Vault',
    refStoredNote: 'يُخزَّن كمرجع؛ ويُحَلّ إلى القيمة عند الاستدعاء بواسطة مزوّد المفاتيح.',
    refUseLiteral: 'إدخال سرّ مباشر بدلًا من ذلك',
    refInvalid: 'يجب أن يبدأ المرجع بـ kms:// أو vault://',
    rotateEveryDays: 'التدوير كل (أيام)',
    rotateEveryDaysHint:
      'القيمة 0 توقف التدوير. تؤدّي قيمة غير صفرية إلى تذكير/تدوير تلقائي وتنبيه انتهاء صلاحية.',
    rotateOff: 'التدوير متوقّف',
    rotateActive: 'يُدوَّر كل {n} يومًا',

    egressTitle: 'سياسة الإخراج',
    egressSubtitle:
      'تحكّم في الوجهات التي قد تُرسَل إليها البيانات والحقول التي يُسمح بإرسالها للخارج. تبقى البيانات داخل المملكة افتراضيًا.',
    egressRegions: 'المناطق المسموح بها',
    egressRegionsHint: 'مناطق الوجهة التي قد تُرسَل إليها البيانات. اتركها فارغة لمنع كل إخراج.',
    egressRegionsPlaceholder: 'اختر المناطق…',
    egressFields: 'الحقول المسموح بإخراجها',
    egressFieldsHint: 'تُرسَل هذه الحقول فقط من lex للخارج؛ ويُزال ما عداها.',
    egressFieldsPlaceholder: 'مثال: case_number',
    egressFieldsAdd: 'إضافة حقل',
    egressFieldInvalid: 'مفتاح حقل غير صالح — استخدم أحرفًا وأرقامًا و _ . - فقط بدون مسافات.',
    egressInKingdomTitle: 'داخل المملكة افتراضيًا',
    egressInKingdomBody:
      'دون السماح بأي منطقة خارجية، تبقى البيانات محصورة في مناطق المملكة استيفاءً لمتطلّبات إقامة البيانات في نظام حماية البيانات (PDPL).',
    egressBlockedCount: 'تم حظر {n} محاولة إخراج',
    egressUpdatedAt: 'آخر تحديث',
    egressUnconfigured: 'لم تُحدَّد سياسة إخراج بعد — تُطبَّق ضوابط البقاء داخل المملكة الافتراضية.',
    egressSave: 'حفظ السياسة',
    egressSaving: 'جارٍ الحفظ…',
    egressReset: 'إعادة تعيين',
    egressToastSaved: 'تم حفظ سياسة الإخراج.',
    egressEmptyRegionsWarn: 'لا توجد مناطق مسموح بها — كل إخراج محظور حاليًا.',
  },
};

/** Locale-bound accessor for the governance copy (Arabic-first default). */
export function useGovernanceLabels(): GovernanceLabels {
  const { locale } = useLocaleOrDefault();
  return locale === 'ar' ? governanceLabels.ar : governanceLabels.en;
}

/** Interpolate a single `{token}` placeholder in a governance label string. */
export function fillGovernanceToken(
  template: string,
  token: string,
  value: string | number,
): string {
  return template.replace(`{${token}}`, String(value));
}

/* --------------------------------------------------------------------------- *
 * Status-badge config for the maker-checker queue. Mirrors the reliability
 * `buildDlqStatusConfig` pattern: status value → {label, color, icon}.
 * --------------------------------------------------------------------------- */
import type { LucideIcon } from 'lucide-react';
import { Clock3, CheckCircle2, XCircle } from 'lucide-react';
import type { StatusConfig } from '@/lib/status-configs';

const PENDING_STATUS_COLOR: Record<PendingChangeStatus, string> = {
  pending: 'yellow',
  approved: 'green',
  rejected: 'red',
};

const PENDING_STATUS_ICON: Record<PendingChangeStatus, LucideIcon> = {
  pending: Clock3,
  approved: CheckCircle2,
  rejected: XCircle,
};

/** Build the PendingChangeStatus → {label,color,icon} config for the locale. */
export function buildPendingStatusConfig(t: GovernanceLabels): StatusConfig {
  return {
    pending: {
      label: t.statusPending,
      color: PENDING_STATUS_COLOR.pending,
      icon: PENDING_STATUS_ICON.pending,
    },
    approved: {
      label: t.statusApproved,
      color: PENDING_STATUS_COLOR.approved,
      icon: PENDING_STATUS_ICON.approved,
    },
    rejected: {
      label: t.statusRejected,
      color: PENDING_STATUS_COLOR.rejected,
      icon: PENDING_STATUS_ICON.rejected,
    },
  };
}

/** Localized provider label for a {@link SecretRefProvider}. */
export function refProviderLabel(t: GovernanceLabels, provider: SecretRefProvider): string {
  switch (provider) {
    case 'kms':
      return t.refProviderKms;
    case 'vault':
      return t.refProviderVault;
    case 'none':
    default:
      return t.refProviderNone;
  }
}
