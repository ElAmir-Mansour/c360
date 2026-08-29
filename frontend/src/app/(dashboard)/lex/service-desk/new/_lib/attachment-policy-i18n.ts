import type { AppLocale } from '@/lib/i18n';

/**
 * Bilingual strings for the requester-facing attachment-requirement surface
 * (PRD 14.1). Kept local to the intake wizard so the requirements banner and the
 * per-file slot picker stay drop-in and do not depend on the global catalogue.
 *
 * The copy mirrors how the provider-side completeness gate
 * (`backend/internal/lex/service/attachment_policy_service.go`) defines
 * "required": a request is complete only when the minimum attachment COUNT is met
 * and every REQUIRED named slot has been provided.
 */
export interface AttachmentPolicyMessages {
  requirementsTitle: string;
  requirementsLoading: string;
  requiresAtLeast: (count: number) => string;
  requiresExactlyOne: string;
  noMinimumButSlots: string;
  upToMax: (max: number) => string;
  slotsHeading: string;
  requiredBadge: string;
  optionalBadge: string;
  providedBadge: string;
  missingBadge: string;
  assignHeading: string;
  assignHint: string;
  assignLabel: (fileName: string) => string;
  unassignedOption: string;
  countProgress: (provided: number, required: number) => string;
  countMet: string;
  countExceeded: (max: number) => string;
  allRequiredMet: string;
  missingRequiredSlots: (count: number) => string;
  blockingWarning: string;
  checklistLabel: (provided: number, required: number) => string;
  checklistLabelComplete: string;
}

const en: AttachmentPolicyMessages = {
  requirementsTitle: 'Required attachments for this request type',
  requirementsLoading: 'Checking attachment requirements…',
  requiresAtLeast: (count) =>
    `This request type requires at least ${count} attachment${count === 1 ? '' : 's'}.`,
  requiresExactlyOne: 'This request type requires at least one attachment.',
  noMinimumButSlots: 'This request type expects the documents listed below.',
  upToMax: (max) => `Up to ${max} file${max === 1 ? '' : 's'} may be attached.`,
  slotsHeading: 'Expected documents',
  requiredBadge: 'Required',
  optionalBadge: 'Optional',
  providedBadge: 'Provided',
  missingBadge: 'Missing',
  assignHeading: 'Label each file',
  assignHint:
    'Assign each uploaded file to the document it represents so required items are recognised.',
  assignLabel: (fileName) => `Document type for ${fileName}`,
  unassignedOption: 'Unassigned',
  countProgress: (provided, required) => `${provided} of ${required} required attachments provided`,
  countMet: 'Minimum attachment count met',
  countExceeded: (max) => `Too many files — attach at most ${max}.`,
  allRequiredMet: 'All required attachments have been provided.',
  missingRequiredSlots: (count) =>
    `${count} required document${count === 1 ? '' : 's'} still missing.`,
  blockingWarning: 'Attach the required documents before you can submit this request.',
  checklistLabel: (provided, required) => `Required attachments (${provided}/${required})`,
  checklistLabelComplete: 'Required attachments provided',
};

const ar: AttachmentPolicyMessages = {
  requirementsTitle: 'المرفقات المطلوبة لهذا النوع من الطلبات',
  requirementsLoading: 'جارٍ التحقق من متطلبات المرفقات…',
  requiresAtLeast: (count) => `يتطلب هذا النوع من الطلبات إرفاق ${count} مرفق على الأقل.`,
  requiresExactlyOne: 'يتطلب هذا النوع من الطلبات إرفاق مرفق واحد على الأقل.',
  noMinimumButSlots: 'يتوقع هذا النوع من الطلبات المستندات المذكورة أدناه.',
  upToMax: (max) => `يمكن إرفاق ما يصل إلى ${max} ملف.`,
  slotsHeading: 'المستندات المتوقعة',
  requiredBadge: 'مطلوب',
  optionalBadge: 'اختياري',
  providedBadge: 'مُرفق',
  missingBadge: 'ناقص',
  assignHeading: 'حدّد نوع كل ملف',
  assignHint: 'اربط كل ملف مرفوع بالمستند الذي يمثله حتى يتم احتساب العناصر المطلوبة.',
  assignLabel: (fileName) => `نوع المستند للملف ${fileName}`,
  unassignedOption: 'غير محدد',
  countProgress: (provided, required) => `تم إرفاق ${provided} من ${required} مرفقات مطلوبة`,
  countMet: 'تم استيفاء الحد الأدنى لعدد المرفقات',
  countExceeded: (max) => `عدد الملفات كبير جدًا — أرفق ${max} كحد أقصى.`,
  allRequiredMet: 'تم إرفاق جميع المرفقات المطلوبة.',
  missingRequiredSlots: (count) => `لا يزال ${count} من المستندات المطلوبة ناقصًا.`,
  blockingWarning: 'أرفق المستندات المطلوبة قبل أن تتمكن من تقديم هذا الطلب.',
  checklistLabel: (provided, required) => `المرفقات المطلوبة (${provided}/${required})`,
  checklistLabelComplete: 'تم إرفاق المرفقات المطلوبة',
};

export function getAttachmentPolicyMessages(locale: AppLocale): AttachmentPolicyMessages {
  return locale === 'ar' ? ar : en;
}
