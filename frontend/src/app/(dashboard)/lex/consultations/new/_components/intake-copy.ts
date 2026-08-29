'use client';

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';

export interface ConsultationIntakeCopy {
  breadcrumb: {
    consultations: string;
    current: string;
  };
  title: string;
  description: string;
  steps: {
    request: string;
    details: string;
    attachments: string;
    review: string;
  };
  form: {
    title: string;
    type: string;
    department: string;
    departmentPlaceholder: string;
    subject: string;
    subjectPlaceholder: string;
    details: string;
    detailsPlaceholder: string;
    reference: string;
    optional: string;
    referencePlaceholder: string;
    urgency: string;
    urgent: string;
    normal: string;
    urgentJustification: string;
    urgentJustificationPlaceholder: string;
    requester: string;
    submit: string;
    cancel: string;
    required: string;
  };
  files: {
    title: string;
    hint: string;
    remove: (name: string) => string;
    tooLarge: (name: string) => string;
    unsupported: (name: string) => string;
    tooMany: string;
    uploading: (current: number, total: number) => string;
    attachmentFailureTitle: string;
    attachmentFailureDescription: (count: number) => string;
  };
  sla: {
    title: string;
    description: string;
    urgentDays: string;
    urgentTitle: string;
    urgentDescription: string;
    normalDays: string;
    normalTitle: string;
  };
  tip: {
    title: string;
    description: string;
  };
  errors: {
    subject: string;
    details: string;
    justification: string;
  };
  requesterFallback: string;
  success: string;
}

const EN: ConsultationIntakeCopy = {
  breadcrumb: {
    consultations: 'Consultations',
    current: 'New request',
  },
  title: 'Request New Legal Consultation',
  description:
    'Provide the legal team with the context and supporting records needed to respond.',
  steps: {
    request: 'Request Info',
    details: 'Consultation Details',
    attachments: 'Attachments',
    review: 'Review & Confirm',
  },
  form: {
    title: 'Consultation Details',
    type: 'Consultation Type',
    department: 'Relevant Department',
    departmentPlaceholder: 'Select or enter a department…',
    subject: 'Consultation Subject',
    subjectPlaceholder: 'Enter a concise title for your legal inquiry',
    details: 'Detailed Description & Questions',
    detailsPlaceholder:
      'Provide the background, relevant facts, deadlines, and the specific legal questions to be answered…',
    reference: 'Reference Contract or Case No.',
    optional: '(Optional)',
    referencePlaceholder: 'e.g. REQ-2026-001 or CTR-2026-014',
    urgency: 'Urgency Level',
    urgent: 'Urgent (3 working days — requires justification)',
    normal: 'Normal (5 working days)',
    urgentJustification: 'Urgency justification',
    urgentJustificationPlaceholder:
      'Explain the business impact and why the normal response window is not sufficient…',
    requester: 'Requester',
    submit: 'Submit consultation',
    cancel: 'Cancel',
    required: 'Fields marked * are required.',
  },
  files: {
    title: 'Drag & drop files here to upload',
    hint: 'Supported formats: PDF, DOCX, PNG up to 20MB',
    remove: (name) => `Remove ${name}`,
    tooLarge: (name) => `${name} exceeds the 20MB file limit.`,
    unsupported: (name) => `${name} is not a supported PDF, DOCX, or PNG file.`,
    tooMany: 'A maximum of 10 supporting files can be attached.',
    uploading: (current, total) =>
      `Uploading supporting file ${current} of ${total}`,
    attachmentFailureTitle: 'Consultation created with attachment warnings',
    attachmentFailureDescription: (count) =>
      `${count} supporting ${count === 1 ? 'file was' : 'files were'} not attached. You can retry from the consultation detail page.`,
  },
  sla: {
    title: 'Service Level Agreement (SLA)',
    description:
      'The legal team targets a comprehensive review and formal response within these working-day windows.',
    urgentDays: '3 Working Days',
    urgentTitle: 'Urgent Requests',
    urgentDescription:
      'Requires a documented justification and may require department-head approval.',
    normalDays: '5 Working Days',
    normalTitle: 'Normal Requests',
  },
  tip: {
    title: 'Legal Advisor Tip',
    description:
      'Attach draft contracts and policies in editable formats such as DOCX when you need direct comments or annotations.',
  },
  errors: {
    subject: 'Enter a consultation subject of at least 3 characters.',
    details: 'Provide at least 10 characters of legal context and questions.',
    justification: 'Urgent requests require a justification.',
  },
  requesterFallback: 'Authenticated requester',
  success: 'Consultation submitted.',
};

const AR: ConsultationIntakeCopy = {
  breadcrumb: {
    consultations: 'الاستشارات',
    current: 'طلب جديد',
  },
  title: 'طلب استشارة قانونية جديدة',
  description:
    'زوّد الفريق القانوني بالسياق والمستندات الداعمة اللازمة لإعداد الرد.',
  steps: {
    request: 'معلومات الطلب',
    details: 'تفاصيل الاستشارة',
    attachments: 'المرفقات',
    review: 'المراجعة والتأكيد',
  },
  form: {
    title: 'تفاصيل الاستشارة',
    type: 'نوع الاستشارة',
    department: 'الإدارة المعنية',
    departmentPlaceholder: 'اختر الإدارة أو أدخل اسمها…',
    subject: 'موضوع الاستشارة',
    subjectPlaceholder: 'أدخل عنوانًا موجزًا للاستفسار القانوني',
    details: 'الوصف التفصيلي والأسئلة',
    detailsPlaceholder:
      'أدخل الخلفية والوقائع والمواعيد والأسئلة القانونية المحددة المطلوب الإجابة عنها…',
    reference: 'رقم العقد أو القضية المرجعية',
    optional: '(اختياري)',
    referencePlaceholder: 'مثال: REQ-2026-001 أو CTR-2026-014',
    urgency: 'مستوى الاستعجال',
    urgent: 'عاجل (3 أيام عمل — يتطلب مبررًا)',
    normal: 'عادي (5 أيام عمل)',
    urgentJustification: 'مبرر الاستعجال',
    urgentJustificationPlaceholder:
      'وضّح الأثر على الأعمال وسبب عدم كفاية مدة الاستجابة العادية…',
    requester: 'مُقدِّم الطلب',
    submit: 'تقديم الاستشارة',
    cancel: 'إلغاء',
    required: 'الحقول المعلّمة بـ * مطلوبة.',
  },
  files: {
    title: 'اسحب الملفات وأفلتها هنا للرفع',
    hint: 'الصيغ المدعومة: PDF وDOCX وPNG حتى 20 ميجابايت',
    remove: (name) => `إزالة ${name}`,
    tooLarge: (name) => `يتجاوز الملف ${name} الحد الأقصى البالغ 20 ميجابايت.`,
    unsupported: (name) => `الملف ${name} ليس بصيغة PDF أو DOCX أو PNG مدعومة.`,
    tooMany: 'يمكن إرفاق 10 ملفات داعمة كحد أقصى.',
    uploading: (current, total) =>
      `جارٍ رفع الملف الداعم ${current} من ${total}`,
    attachmentFailureTitle: 'تم إنشاء الاستشارة مع تنبيهات للمرفقات',
    attachmentFailureDescription: (count) =>
      `تعذّر إرفاق ${count} من الملفات الداعمة. يمكنك إعادة المحاولة من صفحة تفاصيل الاستشارة.`,
  },
  sla: {
    title: 'اتفاقية مستوى الخدمة',
    description:
      'يستهدف الفريق القانوني إنجاز المراجعة الشاملة والرد الرسمي ضمن مدد أيام العمل التالية.',
    urgentDays: '3 أيام عمل',
    urgentTitle: 'الطلبات العاجلة',
    urgentDescription:
      'تتطلب مبررًا موثقًا وقد تستلزم اعتماد رئيس الإدارة.',
    normalDays: '5 أيام عمل',
    normalTitle: 'الطلبات العادية',
  },
  tip: {
    title: 'نصيحة المستشار القانوني',
    description:
      'أرفق مسودات العقود والسياسات بصيغ قابلة للتحرير مثل DOCX عند الحاجة إلى التعليقات المباشرة.',
  },
  errors: {
    subject: 'أدخل موضوعًا للاستشارة لا يقل عن 3 أحرف.',
    details: 'أدخل سياقًا وأسئلة قانونية لا تقل عن 10 أحرف.',
    justification: 'تتطلب الطلبات العاجلة إدخال مبرر.',
  },
  requesterFallback: 'مُقدِّم طلب مسجّل',
  success: 'تم تقديم الاستشارة.',
};

export function useConsultationIntakeCopy(): ConsultationIntakeCopy {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => (locale === 'ar' ? AR : EN), [locale]);
}
