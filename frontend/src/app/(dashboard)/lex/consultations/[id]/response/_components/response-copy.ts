'use client';

import { useLocaleOrDefault } from '@/components/providers/locale-provider';

const RESPONSE_COPY = {
  en: {
    back: 'Back to consultation',
    breadcrumb: 'Response',
    submitted: 'Submitted',
    resolved: 'Resolved',
    originalRequest: 'Original request',
    requester: 'Requester',
    subjectTopic: 'Subject topic',
    inquiryDetails: 'Inquiry details',
    attachedDrafts: 'Attached documents',
    noDocuments: 'No documents are attached to this consultation.',
    response: 'Consultation response',
    responseDraft: 'Draft legal response',
    responseDraftDescription:
      'Prepare the official legal opinion, risks, references, and recommended action.',
    responseAuthorFallback: 'Assigned legal advisor',
    advisorRoleFallback: 'Legal advisor',
    legalOpinion: 'Legal opinion and risk analysis',
    responseNotRecorded: 'No response has been recorded yet.',
    responseNotRecordedDescription:
      'The consultation must be routed to an advisor before a response can be submitted.',
    references: 'Legal references and authorities',
    noReferences: 'No structured legal references were recorded.',
    proposedRemedy: 'Proposed remedy and action item',
    noRemedy: 'No separate action item was recorded.',
    responseLabel: 'Official response',
    responsePlaceholder:
      'Set out the legal opinion, risk analysis, relevant authorities, and recommended next steps…',
    draftWithAi: 'Draft with AI',
    drafting: 'Drafting…',
    aiGenerated: 'AI-generated draft — review before submission',
    submitResponse: 'Record response',
    submitting: 'Recording…',
    responseRequired: 'Enter a response before submitting.',
    approvalNotes: 'Decision notes',
    approvalNotesPlaceholder: 'Add context for the advisor or governance record…',
    approve: 'Approve response',
    approving: 'Applying decision…',
    requestRevision: 'Request revision',
    requestRevisionTitle: 'Return this response for revision?',
    requestRevisionDescription:
      'The response will return to the assigned advisor so they can revise and resubmit it.',
    requestRevisionConfirm: 'Return for revision',
    forwardApproval: 'Forward for approval',
    approvalLoading: 'Checking the approval workflow…',
    awaitingApproval: 'This response is waiting for an approval decision.',
    approvalRequired:
      'The response is ready to be forwarded into the legal approval workflow.',
    approved: 'The response has been approved and is ready to archive.',
    archive: 'Archive consultation',
    archived: 'This consultation is archived. The response is read-only.',
    readOnly: 'You have read-only access to this response.',
    earlierStage:
      'Complete classification and advisor routing from the consultation detail before preparing a response.',
    openDetail: 'Open consultation detail',
    holdBlocked: 'A legal hold prevents this consultation from being archived.',
    riskAssessment: 'Risk assessment',
    toasts: {
      responseRecorded: 'Consultation response recorded.',
      approvalStarted: 'Response forwarded for approval.',
      responseApproved: 'Response approval applied.',
      revisionRequested: 'Response returned for revision.',
      archived: 'Consultation archived.',
    },
    loading: {
      title: 'Consultation response',
      description: 'Loading the request and response workspace.',
      error: 'The consultation response could not be loaded.',
    },
  },
  ar: {
    back: 'العودة إلى الاستشارة',
    breadcrumb: 'الرد',
    submitted: 'تاريخ التقديم',
    resolved: 'تاريخ الإنجاز',
    originalRequest: 'الطلب الأصلي',
    requester: 'مقدّم الطلب',
    subjectTopic: 'موضوع الطلب',
    inquiryDetails: 'تفاصيل الاستفسار',
    attachedDrafts: 'المستندات المرفقة',
    noDocuments: 'لا توجد مستندات مرفقة بهذه الاستشارة.',
    response: 'رد الاستشارة',
    responseDraft: 'مسودة الرد القانوني',
    responseDraftDescription:
      'أعدّ الرأي القانوني الرسمي والمخاطر والمراجع والإجراء المقترح.',
    responseAuthorFallback: 'المستشار القانوني المكلّف',
    advisorRoleFallback: 'مستشار قانوني',
    legalOpinion: 'الرأي القانوني وتحليل المخاطر',
    responseNotRecorded: 'لم يُسجَّل رد بعد.',
    responseNotRecordedDescription:
      'يجب توجيه الاستشارة إلى مستشار قبل تقديم الرد.',
    references: 'المراجع والمرجعيات القانونية',
    noReferences: 'لم تُسجَّل مراجع قانونية منظّمة.',
    proposedRemedy: 'الحل والإجراء المقترح',
    noRemedy: 'لم يُسجَّل إجراء مستقل مقترح.',
    responseLabel: 'الرد الرسمي',
    responsePlaceholder:
      'دوّن الرأي القانوني وتحليل المخاطر والمرجعيات والخطوات التالية المقترحة…',
    draftWithAi: 'إعداد مسودة بالذكاء الاصطناعي',
    drafting: 'جارٍ إعداد المسودة…',
    aiGenerated: 'مسودة مولّدة آلياً — راجعها قبل التقديم',
    submitResponse: 'تسجيل الرد',
    submitting: 'جارٍ التسجيل…',
    responseRequired: 'أدخل الرد قبل التقديم.',
    approvalNotes: 'ملاحظات القرار',
    approvalNotesPlaceholder: 'أضف سياقاً للمستشار أو لسجل الحوكمة…',
    approve: 'اعتماد الرد',
    approving: 'جارٍ تطبيق القرار…',
    requestRevision: 'طلب المراجعة',
    requestRevisionTitle: 'هل تريد إعادة هذا الرد للمراجعة؟',
    requestRevisionDescription:
      'سيعود الرد إلى المستشار المكلّف لتعديله وإعادة تقديمه.',
    requestRevisionConfirm: 'إعادة للمراجعة',
    forwardApproval: 'إحالته للاعتماد',
    approvalLoading: 'جارٍ التحقق من مسار الاعتماد…',
    awaitingApproval: 'هذا الرد بانتظار قرار الاعتماد.',
    approvalRequired: 'الرد جاهز للإحالة إلى مسار الاعتماد القانوني.',
    approved: 'تم اعتماد الرد وهو جاهز للأرشفة.',
    archive: 'أرشفة الاستشارة',
    archived: 'هذه الاستشارة مؤرشفة والرد للقراءة فقط.',
    readOnly: 'لديك صلاحية قراءة هذا الرد فقط.',
    earlierStage:
      'أكمل التصنيف والتوجيه إلى المستشار من صفحة تفاصيل الاستشارة قبل إعداد الرد.',
    openDetail: 'فتح تفاصيل الاستشارة',
    holdBlocked: 'يمنع أمر الحفظ القانوني أرشفة هذه الاستشارة.',
    riskAssessment: 'تقييم المخاطر',
    toasts: {
      responseRecorded: 'تم تسجيل رد الاستشارة.',
      approvalStarted: 'تمت إحالة الرد للاعتماد.',
      responseApproved: 'تم تطبيق قرار اعتماد الرد.',
      revisionRequested: 'أُعيد الرد للمراجعة.',
      archived: 'تمت أرشفة الاستشارة.',
    },
    loading: {
      title: 'رد الاستشارة',
      description: 'جارٍ تحميل الطلب ومساحة إعداد الرد.',
      error: 'تعذّر تحميل رد الاستشارة.',
    },
  },
} as const;

export function useConsultationResponseCopy() {
  const { locale } = useLocaleOrDefault();
  return locale === 'ar' ? RESPONSE_COPY.ar : RESPONSE_COPY.en;
}

export type ConsultationResponseCopy = ReturnType<
  typeof useConsultationResponseCopy
>;
