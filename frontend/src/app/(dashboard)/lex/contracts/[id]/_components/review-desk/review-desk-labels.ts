'use client';

/**
 * Feature-local bilingual (English + Modern Standard Arabic) labels for the
 * contract review-desk tab (CAP-094..125). Kept local to the review-desk cap —
 * following the sibling recommendation-dialog / final-version-modal pattern — so
 * the desk composes without editing the shared contracts-labels file.
 *
 * The slot / intake-status / correspondence-kind maps are keyed by the RAW
 * backend token with the SAME key set on both locales; resolve with
 * `map[token] ?? token`.
 */

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type {
  ContractAttachmentSlot,
  ContractCorrespondenceKind,
  ContractIntakeStatus,
} from './review-desk-api';

export interface ReviewDeskLabels {
  tab: string;
  title: string;
  description: string;
  referenceNumber: string;
  noIntakeTitle: string;
  noIntakeDescription: string;
  openIntake: string;
  opening: string;
  // Intake lifecycle panel.
  intakeTitle: string;
  intakeDescription: string;
  status: string;
  receivedAt: string;
  assignedReviewer: string;
  unassigned: string;
  acknowledge: string;
  acknowledged: string;
  acknowledgedAt: string;
  routeToLegal: string;
  routedAt: string;
  distribute: string;
  distributeHint: string;
  reviewerLabel: string;
  reviewerPlaceholder: string;
  notesLabel: string;
  notesPlaceholder: string;
  returnToRequester: string;
  returnTitle: string;
  returnDescription: string;
  returnReason: string;
  returnReasonPlaceholder: string;
  deficiencyNotice: string;
  deficiencyPlaceholder: string;
  confirmReturn: string;
  returnedAt: string;
  returnReasonShown: string;
  // Attachments.
  attachmentsTitle: string;
  attachmentsDescription: string;
  requiredBadge: string;
  optionalBadge: string;
  satisfied: string;
  missing: string;
  uploadFile: string;
  uploading: string;
  replaceFile: string;
  removeFile: string;
  removeConfirmTitle: string;
  removeConfirmDescription: (name: string) => string;
  remove: string;
  noFileYet: string;
  uploadedVersion: (version: number) => string;
  // Completeness.
  completenessTitle: string;
  completenessDescription: string;
  runCompleteness: string;
  checking: string;
  completeYes: string;
  completeNo: (count: number) => string;
  lastChecked: (when: string) => string;
  neverChecked: string;
  // Correspondence.
  correspondenceTitle: string;
  correspondenceDescription: string;
  addEntry: string;
  addEntryTitle: string;
  kindLabel: string;
  directionLabel: string;
  subjectLabel: string;
  subjectPlaceholder: string;
  bodyLabel: string;
  bodyPlaceholder: string;
  postEntry: string;
  posting: string;
  emptyThreadTitle: string;
  emptyThreadDescription: string;
  systemAuthor: string;
  // Recommendation / final version hand-off.
  decisionTitle: string;
  decisionDescription: string;
  recordRecommendation: string;
  uploadFinalVersion: string;
  recommendationOutcome: string;
  noRecommendation: string;
  // Shared.
  cancel: string;
  save: string;
  loadError: string;
  retry: string;
  slotLabels: Record<ContractAttachmentSlot, string>;
  statusLabels: Record<ContractIntakeStatus, string>;
  kindLabels: Record<ContractCorrespondenceKind, string>;
  outcomeLabels: Record<'approved' | 'needs_amendment' | 'rejected', string>;
  toast: {
    intakeOpened: (reference: string) => string;
    intakeOpenedTitle: string;
    acknowledgedTitle: string;
    acknowledgedBody: string;
    routedTitle: string;
    routedBody: string;
    distributedTitle: string;
    distributedBody: string;
    returnedTitle: string;
    returnedBody: string;
    completenessTitle: string;
    completenessComplete: string;
    completenessIncomplete: (count: number) => string;
    uploadedTitle: string;
    uploadedBody: string;
    removedTitle: string;
    correspondenceTitle: string;
    correspondenceBody: string;
  };
}

const EN: ReviewDeskLabels = {
  tab: 'Review Desk',
  title: 'Contract Review Request',
  description:
    'Intake, completeness, distribution and correspondence for the contract review request cycle.',
  referenceNumber: 'Reference number',
  noIntakeTitle: 'No review request opened',
  noIntakeDescription:
    'Open a review-desk intake to assign a reference number, seed the required document slots, and start the review request cycle.',
  openIntake: 'Open review request',
  opening: 'Opening…',
  intakeTitle: 'Intake',
  intakeDescription: 'Receipt acknowledgement, routing to Legal, and return-to-requester.',
  status: 'Status',
  receivedAt: 'Received',
  assignedReviewer: 'Assigned reviewer',
  unassigned: 'Unassigned',
  acknowledge: 'Acknowledge receipt',
  acknowledged: 'Receipt acknowledged',
  acknowledgedAt: 'Acknowledged',
  routeToLegal: 'Route to Legal',
  routedAt: 'Routed to Legal',
  distribute: 'Distribute',
  distributeHint:
    'Assign the file to the referral authority (Legal Dept Manager / Contracts Manager / Supervisors).',
  reviewerLabel: 'Reviewer / referral authority',
  reviewerPlaceholder: 'Full name of the assignee',
  notesLabel: 'Notes',
  notesPlaceholder: 'Optional note recorded with this action',
  returnToRequester: 'Return to requester',
  returnTitle: 'Return file to requester',
  returnDescription:
    'Returns the file to the requester with a mandatory reason and an optional deficiency notice.',
  returnReason: 'Return reason',
  returnReasonPlaceholder: 'Why the file is being returned…',
  deficiencyNotice: 'Deficiency notice',
  deficiencyPlaceholder: 'Optional — what is missing or incorrect',
  confirmReturn: 'Return file',
  returnedAt: 'Returned',
  returnReasonShown: 'Reason',
  attachmentsTitle: 'Required documents',
  attachmentsDescription:
    'Upload each required document. The completeness check passes when every required slot has a live file.',
  requiredBadge: 'Required',
  optionalBadge: 'Optional',
  satisfied: 'Provided',
  missing: 'Missing',
  uploadFile: 'Upload',
  uploading: 'Uploading…',
  replaceFile: 'Replace',
  removeFile: 'Remove',
  removeConfirmTitle: 'Remove document',
  removeConfirmDescription: (name) => `Remove "${name}" from this slot? This cannot be undone.`,
  remove: 'Remove',
  noFileYet: 'No file uploaded',
  uploadedVersion: (version) => `Version ${version}`,
  completenessTitle: 'Completeness check',
  completenessDescription: 'Verify every required document slot is satisfied before routing.',
  runCompleteness: 'Run completeness check',
  checking: 'Checking…',
  completeYes: 'All required documents provided',
  completeNo: (count) => `${count} required document${count === 1 ? '' : 's'} missing`,
  lastChecked: (when) => `Last checked ${when}`,
  neverChecked: 'Not checked yet',
  correspondenceTitle: 'Correspondence',
  correspondenceDescription:
    'Append-only thread of internal notes, clarification requests, and auto-return notices.',
  addEntry: 'Add entry',
  addEntryTitle: 'Add correspondence',
  kindLabel: 'Kind',
  directionLabel: 'Direction',
  subjectLabel: 'Subject',
  subjectPlaceholder: 'Short subject line',
  bodyLabel: 'Message',
  bodyPlaceholder: 'Write the note or clarification request…',
  postEntry: 'Post',
  posting: 'Posting…',
  emptyThreadTitle: 'No correspondence yet',
  emptyThreadDescription: 'Internal notes and clarification requests will appear here.',
  systemAuthor: 'System',
  decisionTitle: 'Recommendation & final version',
  decisionDescription:
    'Record the review-desk recommendation, then upload the approved final version.',
  recordRecommendation: 'Record recommendation',
  uploadFinalVersion: 'Upload final version',
  recommendationOutcome: 'Current recommendation',
  noRecommendation: 'No recommendation recorded yet.',
  cancel: 'Cancel',
  save: 'Save',
  loadError: 'Failed to load the review desk.',
  retry: 'Retry',
  slotLabels: {
    foundation_document: 'Foundation document',
    purpose_of_contract: 'Purpose of contract',
    authorized_person_id: 'Authorized person ID',
    power_of_attorney: 'Power of attorney',
    addendum_prior_docs: 'Addendum / prior documents',
    draft: 'Draft contract',
    quotation: 'Quotation',
    commercial_registration: 'Commercial registration',
    committee_decision: 'Committee decision',
  },
  statusLabels: {
    received: 'Received',
    acknowledged: 'Acknowledged',
    routed_to_legal: 'Routed to Legal',
    under_review: 'Under review',
    returned: 'Returned',
    completed: 'Completed',
  },
  kindLabels: {
    internal: 'Internal note',
    clarification: 'Clarification request',
    auto_return: 'Auto-return notice',
  },
  outcomeLabels: {
    approved: 'Approved',
    needs_amendment: 'Needs amendment',
    rejected: 'Rejected',
  },
  toast: {
    intakeOpenedTitle: 'Review request opened',
    intakeOpened: (reference) => `Reference number ${reference} assigned.`,
    acknowledgedTitle: 'Receipt acknowledged',
    acknowledgedBody: 'The intake receipt was acknowledged.',
    routedTitle: 'Routed to Legal',
    routedBody: 'The file was routed to the legal desk.',
    distributedTitle: 'File distributed',
    distributedBody: 'The file was distributed to the referral authority.',
    returnedTitle: 'File returned',
    returnedBody: 'The file was returned to the requester.',
    completenessTitle: 'Completeness check',
    completenessComplete: 'All required documents are provided.',
    completenessIncomplete: (count) =>
      `${count} required document${count === 1 ? '' : 's'} still missing.`,
    uploadedTitle: 'Document uploaded',
    uploadedBody: 'The document was attached to its slot.',
    removedTitle: 'Document removed',
    correspondenceTitle: 'Correspondence added',
    correspondenceBody: 'The entry was appended to the thread.',
  },
};

const AR: ReviewDeskLabels = {
  tab: 'مكتب المراجعة',
  title: 'طلب مراجعة العقد',
  description: 'الاستلام والاكتمال والتوزيع والمراسلات لدورة طلب مراجعة العقد.',
  referenceNumber: 'الرقم المرجعي',
  noIntakeTitle: 'لم يُفتح طلب مراجعة',
  noIntakeDescription:
    'افتح استلام مكتب المراجعة لتعيين رقم مرجعي وتهيئة خانات المستندات المطلوبة وبدء دورة طلب المراجعة.',
  openIntake: 'فتح طلب مراجعة',
  opening: 'جارٍ الفتح…',
  intakeTitle: 'الاستلام',
  intakeDescription: 'الإقرار بالاستلام والإحالة إلى الإدارة القانونية والإعادة إلى مقدّم الطلب.',
  status: 'الحالة',
  receivedAt: 'تاريخ الاستلام',
  assignedReviewer: 'المراجع المُسنَد',
  unassigned: 'غير مُسنَد',
  acknowledge: 'الإقرار بالاستلام',
  acknowledged: 'تم الإقرار بالاستلام',
  acknowledgedAt: 'تاريخ الإقرار',
  routeToLegal: 'الإحالة إلى القانونية',
  routedAt: 'تمت الإحالة إلى القانونية',
  distribute: 'توزيع',
  distributeHint:
    'إسناد الملف إلى جهة الإحالة (مدير الإدارة القانونية / مدير العقود / المشرفون).',
  reviewerLabel: 'المراجع / جهة الإحالة',
  reviewerPlaceholder: 'الاسم الكامل للمُسنَد إليه',
  notesLabel: 'ملاحظات',
  notesPlaceholder: 'ملاحظة اختيارية تُسجَّل مع هذا الإجراء',
  returnToRequester: 'الإعادة إلى مقدّم الطلب',
  returnTitle: 'إعادة الملف إلى مقدّم الطلب',
  returnDescription: 'يُعيد الملف إلى مقدّم الطلب مع سبب إلزامي وإشعار نقص اختياري.',
  returnReason: 'سبب الإعادة',
  returnReasonPlaceholder: 'سبب إعادة الملف…',
  deficiencyNotice: 'إشعار النقص',
  deficiencyPlaceholder: 'اختياري — ما هو الناقص أو غير الصحيح',
  confirmReturn: 'إعادة الملف',
  returnedAt: 'تاريخ الإعادة',
  returnReasonShown: 'السبب',
  attachmentsTitle: 'المستندات المطلوبة',
  attachmentsDescription:
    'ارفع كل مستند مطلوب. يجتاز فحص الاكتمال عندما تحتوي كل خانة مطلوبة على ملف فعّال.',
  requiredBadge: 'مطلوب',
  optionalBadge: 'اختياري',
  satisfied: 'مُقدَّم',
  missing: 'ناقص',
  uploadFile: 'رفع',
  uploading: 'جارٍ الرفع…',
  replaceFile: 'استبدال',
  removeFile: 'إزالة',
  removeConfirmTitle: 'إزالة المستند',
  removeConfirmDescription: (name) => `إزالة "${name}" من هذه الخانة؟ لا يمكن التراجع عن ذلك.`,
  remove: 'إزالة',
  noFileYet: 'لم يُرفع أي ملف',
  uploadedVersion: (version) => `الإصدار ${version}`,
  completenessTitle: 'فحص الاكتمال',
  completenessDescription: 'تحقّق من استيفاء كل خانة مستند مطلوبة قبل الإحالة.',
  runCompleteness: 'تشغيل فحص الاكتمال',
  checking: 'جارٍ الفحص…',
  completeYes: 'تم تقديم جميع المستندات المطلوبة',
  completeNo: (count) => `${count} مستند مطلوب ناقص`,
  lastChecked: (when) => `آخر فحص ${when}`,
  neverChecked: 'لم يُفحص بعد',
  correspondenceTitle: 'المراسلات',
  correspondenceDescription:
    'سلسلة إضافة فقط للملاحظات الداخلية وطلبات الإيضاح وإشعارات الإعادة التلقائية.',
  addEntry: 'إضافة إدخال',
  addEntryTitle: 'إضافة مراسلة',
  kindLabel: 'النوع',
  directionLabel: 'الاتجاه',
  subjectLabel: 'الموضوع',
  subjectPlaceholder: 'سطر موضوع مختصر',
  bodyLabel: 'الرسالة',
  bodyPlaceholder: 'اكتب الملاحظة أو طلب الإيضاح…',
  postEntry: 'نشر',
  posting: 'جارٍ النشر…',
  emptyThreadTitle: 'لا توجد مراسلات بعد',
  emptyThreadDescription: 'ستظهر الملاحظات الداخلية وطلبات الإيضاح هنا.',
  systemAuthor: 'النظام',
  decisionTitle: 'التوصية والنسخة النهائية',
  decisionDescription: 'سجّل توصية مكتب المراجعة ثم ارفع النسخة النهائية المعتمدة.',
  recordRecommendation: 'تسجيل توصية',
  uploadFinalVersion: 'رفع النسخة النهائية',
  recommendationOutcome: 'التوصية الحالية',
  noRecommendation: 'لم تُسجَّل أي توصية بعد.',
  cancel: 'إلغاء',
  save: 'حفظ',
  loadError: 'تعذّر تحميل مكتب المراجعة.',
  retry: 'إعادة المحاولة',
  slotLabels: {
    foundation_document: 'وثيقة التأسيس',
    purpose_of_contract: 'الغرض من العقد',
    authorized_person_id: 'هوية الشخص المفوّض',
    power_of_attorney: 'التفويض / الوكالة',
    addendum_prior_docs: 'الملاحق / المستندات السابقة',
    draft: 'مسودة العقد',
    quotation: 'عرض السعر',
    commercial_registration: 'السجل التجاري',
    committee_decision: 'قرار اللجنة',
  },
  statusLabels: {
    received: 'مستلَم',
    acknowledged: 'تم الإقرار',
    routed_to_legal: 'مُحال إلى القانونية',
    under_review: 'قيد المراجعة',
    returned: 'مُعاد',
    completed: 'مكتمل',
  },
  kindLabels: {
    internal: 'ملاحظة داخلية',
    clarification: 'طلب إيضاح',
    auto_return: 'إشعار إعادة تلقائي',
  },
  outcomeLabels: {
    approved: 'معتمد',
    needs_amendment: 'يحتاج تعديلاً',
    rejected: 'مرفوض',
  },
  toast: {
    intakeOpenedTitle: 'تم فتح طلب المراجعة',
    intakeOpened: (reference) => `تم تعيين الرقم المرجعي ${reference}.`,
    acknowledgedTitle: 'تم الإقرار بالاستلام',
    acknowledgedBody: 'تم الإقرار باستلام الطلب.',
    routedTitle: 'تمت الإحالة إلى القانونية',
    routedBody: 'تمت إحالة الملف إلى المكتب القانوني.',
    distributedTitle: 'تم توزيع الملف',
    distributedBody: 'تم توزيع الملف على جهة الإحالة.',
    returnedTitle: 'تمت إعادة الملف',
    returnedBody: 'تمت إعادة الملف إلى مقدّم الطلب.',
    completenessTitle: 'فحص الاكتمال',
    completenessComplete: 'تم تقديم جميع المستندات المطلوبة.',
    completenessIncomplete: (count) => `لا يزال ${count} مستند مطلوب ناقصًا.`,
    uploadedTitle: 'تم رفع المستند',
    uploadedBody: 'تم إرفاق المستند بخانته.',
    removedTitle: 'تمت إزالة المستند',
    correspondenceTitle: 'تمت إضافة المراسلة',
    correspondenceBody: 'تمت إضافة الإدخال إلى السلسلة.',
  },
};

export function useReviewDeskLabels(): ReviewDeskLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => (locale === 'ar' ? AR : EN), [locale]);
}
