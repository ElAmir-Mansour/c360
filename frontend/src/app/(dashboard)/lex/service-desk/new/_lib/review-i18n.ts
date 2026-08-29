/**
 * Self-contained EN/AR strings for the interactive Review step (improvement #9)
 * of the "New Legal Request" wizard. Kept local to the wizard's `_lib` so the
 * presentational ReviewStep component owns its own copy and does not depend on
 * the global message catalog.
 *
 * Resolution is a plain locale ternary: Arabic for `locale === 'ar'`, English
 * (MSA-neutral) for everything else — so EN is the effective default. Arabic is
 * Modern Standard Arabic.
 */
import type { AppLocale } from '@/lib/i18n';

/** A single bilingual string. */
export interface ReviewStrings {
  /* Review group labels */
  reviewHeading: string;
  reviewSubheading: string;
  groupService: string;
  groupTitles: string;
  groupDescription: string;
  groupRequester: string;
  groupBeneficiary: string;
  groupPriority: string;
  groupAttachments: string;
  groupExtras: string;

  /* Field labels */
  fieldService: string;
  fieldChannel: string;
  fieldTitleEn: string;
  fieldTitleAr: string;
  fieldDescription: string;
  fieldRequester: string;
  fieldBeneficiary: string;
  fieldBeneficiaryEntity: string;
  fieldPriority: string;
  fieldUrgency: string;
  fieldAttachmentsCount: string;
  fieldNotes: string;
  fieldDueDate: string;

  /* Values & states */
  notSet: string;
  edit: string;
  editAria: string;
  priorityUrgent: string;
  priorityNormal: string;
  priorityEmergency: string;
  attachmentsNone: string;
  attachmentsOne: string;
  attachmentsMany: string;
  attachedFilesHeading: (count: string) => string;
  confirmLabel: string;
  confirmRequired: string;

  /* What-happens-next panel */
  whnHeading: string;
  whnSubheading: string;
  stepSubmitted: string;
  stepSubmittedDetail: string;
  stepApprovalsTitle: string;
  requesterApproval: string;
  providerApproval: string;
  noApprovals: string;
  approvalPolicyNote: string;
  stepAssigned: string;
  stepAssignedDetail: string;
  stepSlaTitle: string;
  stepSlaDetail: string;

  /* Escalation */
  escalationHeading: string;
  escalationHint: string;
  escalationNoEntity: string;
  escalationEmpty: string;
  escalationUnavailable: string;
  escalationLevel: string;
}

const EN: ReviewStrings = {
  reviewHeading: 'Review your request',
  reviewSubheading: 'Check the details below. Use Edit to revisit any section before submitting.',
  groupService: 'Service',
  groupTitles: 'Title',
  groupDescription: 'Description',
  groupRequester: 'Requester',
  groupBeneficiary: 'Beneficiary',
  groupPriority: 'Priority',
  groupAttachments: 'Attachments',
  groupExtras: 'Additional details',

  fieldService: 'Selected service',
  fieldChannel: 'Channel',
  fieldTitleEn: 'Title (English)',
  fieldTitleAr: 'Title (Arabic)',
  fieldDescription: 'Description',
  fieldRequester: 'Requester name',
  fieldBeneficiary: 'Beneficiary',
  fieldBeneficiaryEntity: 'Beneficiary entity',
  fieldPriority: 'Priority',
  fieldUrgency: 'Urgency justification',
  fieldAttachmentsCount: 'Files attached',
  fieldNotes: 'Additional notes',
  fieldDueDate: 'Requested due date & time',

  notSet: 'Not set',
  edit: 'Edit',
  editAria: 'Edit this section',
  priorityUrgent: 'Urgent',
  priorityNormal: 'Normal',
  priorityEmergency: 'Emergency',
  attachmentsNone: 'No files attached',
  attachmentsOne: '1 file',
  attachmentsMany: 'files',
  attachedFilesHeading: (count) => `Attached supporting documents (${count})`,
  confirmLabel:
    'I confirm that all provided details and attachments are accurate and comply with the legal service guidelines.',
  confirmRequired: 'Please confirm the request details before submitting.',

  whnHeading: 'What happens after you submit',
  whnSubheading: 'A quick preview of the journey your request will take.',
  stepSubmitted: 'Submitted',
  stepSubmittedDetail: 'Your request is logged and given a tracking number.',
  stepApprovalsTitle: 'Approvals',
  requesterApproval: 'Requester approval required',
  providerApproval: 'Provider approval required',
  noApprovals: 'No approvals — routed directly',
  approvalPolicyNote: 'An approval policy applies to this service.',
  stepAssigned: 'Assigned',
  stepAssignedDetail: 'The request is routed to the responsible legal team.',
  stepSlaTitle: 'SLA clock starts',
  stepSlaDetail: 'Acknowledgement and turnaround timers begin once assigned.',

  escalationHeading: 'If the SLA is missed, it escalates to',
  escalationHint: 'Escalation contacts are resolved from the beneficiary entity.',
  escalationNoEntity: 'Select a beneficiary entity to preview the escalation path.',
  escalationEmpty: 'No escalation contacts are configured for this entity.',
  escalationUnavailable: 'Escalation contacts are not available right now.',
  escalationLevel: 'L',
};

const AR: ReviewStrings = {
  reviewHeading: 'مراجعة طلبك',
  reviewSubheading: 'راجع التفاصيل أدناه. استخدم زر التعديل للرجوع إلى أي قسم قبل الإرسال.',
  groupService: 'الخدمة',
  groupTitles: 'العنوان',
  groupDescription: 'الوصف',
  groupRequester: 'مقدّم الطلب',
  groupBeneficiary: 'المستفيد',
  groupPriority: 'الأولوية',
  groupAttachments: 'المرفقات',
  groupExtras: 'تفاصيل إضافية',

  fieldService: 'الخدمة المختارة',
  fieldChannel: 'القناة',
  fieldTitleEn: 'العنوان (بالإنجليزية)',
  fieldTitleAr: 'العنوان (بالعربية)',
  fieldDescription: 'الوصف',
  fieldRequester: 'اسم مقدّم الطلب',
  fieldBeneficiary: 'المستفيد',
  fieldBeneficiaryEntity: 'جهة المستفيد',
  fieldPriority: 'الأولوية',
  fieldUrgency: 'مبرّر الاستعجال',
  fieldAttachmentsCount: 'الملفات المرفقة',
  fieldNotes: 'ملاحظات إضافية',
  fieldDueDate: 'تاريخ ووقت الاستحقاق المطلوب',

  notSet: 'غير محدّد',
  edit: 'تعديل',
  editAria: 'تعديل هذا القسم',
  priorityUrgent: 'عاجل',
  priorityNormal: 'عادي',
  priorityEmergency: 'طارئ',
  attachmentsNone: 'لا توجد ملفات مرفقة',
  attachmentsOne: 'ملف واحد',
  attachmentsMany: 'ملفات',
  attachedFilesHeading: (count) => `المستندات الداعمة المرفقة (${count})`,
  confirmLabel: 'أقر بأن جميع البيانات والمرفقات المقدمة صحيحة ومتوافقة مع إرشادات الخدمة القانونية.',
  confirmRequired: 'يرجى الإقرار بصحة بيانات الطلب قبل الإرسال.',

  whnHeading: 'ما الذي يحدث بعد الإرسال',
  whnSubheading: 'لمحة سريعة عن مسار طلبك.',
  stepSubmitted: 'تم الإرسال',
  stepSubmittedDetail: 'يُسجَّل طلبك ويُمنح رقم تتبّع.',
  stepApprovalsTitle: 'الموافقات',
  requesterApproval: 'تُطلب موافقة مقدّم الطلب',
  providerApproval: 'تُطلب موافقة مزوّد الخدمة',
  noApprovals: 'لا توجد موافقات — يُوجَّه مباشرةً',
  approvalPolicyNote: 'تنطبق سياسة موافقة على هذه الخدمة.',
  stepAssigned: 'تم الإسناد',
  stepAssignedDetail: 'يُوجَّه الطلب إلى الفريق القانوني المسؤول.',
  stepSlaTitle: 'يبدأ مؤقّت مستوى الخدمة',
  stepSlaDetail: 'تبدأ مؤقتات الإقرار والإنجاز فور الإسناد.',

  escalationHeading: 'في حال تجاوز مستوى الخدمة، تتم التصعيد إلى',
  escalationHint: 'تُحدَّد جهات التصعيد من جهة المستفيد.',
  escalationNoEntity: 'اختر جهة المستفيد لمعاينة مسار التصعيد.',
  escalationEmpty: 'لا توجد جهات تصعيد مُهيّأة لهذه الجهة.',
  escalationUnavailable: 'جهات التصعيد غير متاحة حالياً.',
  escalationLevel: 'م',
};

/**
 * reviewStrings returns the localized string bundle for the active locale.
 * EN is the effective default for any non-Arabic locale.
 */
export function reviewStrings(locale: AppLocale): ReviewStrings {
  return locale === 'ar' ? AR : EN;
}
