'use client';

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type {
  LexSupportPriority,
  LexSupportStatus,
  LexSupportSubjectType,
} from '@/lib/lex/support';
import type { LexBilingual } from '../../_lib/lex-i18n';
import { resolveLexBilingual } from '../../_lib/lex-i18n';

/** Every inline decision the support panel can raise a confirmation dialog for. */
export type SupportDialogAction =
  | 'accept'
  | 'decline'
  | 'resolve'
  | 'cancel'
  | 'approve'
  | 'reject';

export interface SupportLabels {
  ask: string;
  tabs: { decisions: string; incoming: string; sent: string; history: string };
  tabsAria: string;
  incomingDescription: string;
  sentDescription: string;
  historyDescription: string;
  refresh: string;
  loadMore: string;
  loadingMore: string;
  paginationError: string;
  loading: string;
  retry: string;
  errorTitle: string;
  errorDescription: string;
  unavailable: string;
  empty: Record<'incoming' | 'sent' | 'history', { title: string; description: string }>;
  priority: Record<LexSupportPriority, string>;
  status: Record<LexSupportStatus, string>;
  subjectType: Record<LexSupportSubjectType, string>;
  requestedBy: string;
  assignedTo: string;
  unknownColleague: string;
  targetEntity: string;
  createdAt: string;
  closedAt: string;
  noDeadline: string;
  validityLabel: string;
  validityRemaining: (relative: string) => string;
  validityEnded: string;
  resolutionNote: string;
  viewDetails: string;
  details: {
    title: string;
    description: string;
    body: string;
    requester: string;
    assignee: string;
    targetEntity: string;
    priority: string;
    status: string;
    createdAt: string;
    expiresAt: string;
    acceptedAt: string;
    closedAt: string;
    resolutionNote: string;
    linkedRecord: string;
    openLinkedRecord: (type: string) => string;
    noBody: string;
    loading: string;
    error: string;
  };
  actions: {
    accept: string;
    decline: string;
    resolve: string;
    cancel: string;
  };
  /**
   * Manager-approval gate. `auto` must never read as though a person approved
   * the request — the two automatic routes cleared the gate with nobody in it.
   */
  approval: {
    groupTitle: string;
    groupDescription: string;
    error: string;
    retry: string;
    loadMore: string;
    loadingMore: string;
    approve: string;
    reject: string;
    unknownApprover: string;
    awaitingBy: (name: string) => string;
    approvedBy: (name: string) => string;
    rejectedBy: (name: string) => string;
    decidedOn: (date: string) => string;
    rejectionNote: string;
    auto: Record<'auto_no_manager' | 'auto_self', string>;
  };
  actionDialog: {
    title: Record<SupportDialogAction, string>;
    description: Record<SupportDialogAction, string>;
    note: string;
    notePlaceholder: string;
    close: string;
    confirm: string;
    saving: string;
    success: string;
    failure: string;
    noteTooLong: string;
  };
  composer: {
    title: string;
    description: string;
    entity: string;
    entityPlaceholder: string;
    entitySearch: string;
    noEntities: string;
    member: string;
    memberPlaceholder: string;
    memberSearch: string;
    memberDisabled: string;
    noMembers: string;
    subject: string;
    subjectPlaceholder: string;
    body: string;
    bodyPlaceholder: string;
    priority: string;
    businessDays: string;
    businessDaysHint: string;
    previewLoading: string;
    previewError: string;
    previewExpires: (date: string) => string;
    noExpiry: string;
    context: (type: string) => string;
    contextRecord: (type: string) => string;
    linkedRecord: string;
    linkedRecordHint: string;
    linkedRecordType: string;
    linkedRecordNone: string;
    linkedRecordPicker: string;
    linkedRecordSelect: string;
    linkedRecordSearch: string;
    linkedRecordEmpty: string;
    linkedRecordLoading: string;
    linkedRecordError: string;
    linkedRecordClear: string;
    linkedRecordRequired: string;
    cancel: string;
    submit: string;
    submitting: string;
    success: string;
    expires: (date: string) => string;
    failure: string;
    required: string;
    subjectTooLong: string;
    bodyTooLong: string;
    businessDaysInvalid: string;
    directoryError: string;
  };
}

export const supportLabels: LexBilingual<SupportLabels> = {
  en: {
    ask: 'Ask for support',
    tabs: { decisions: 'Decisions', incoming: 'Incoming support', sent: 'Sent', history: 'History' },
    tabsAria: 'Inbox views',
    incomingDescription: 'Time-boxed requests from legal colleagues assigned to you.',
    sentDescription: 'Support requests you have sent to a named colleague.',
    historyDescription: 'Resolved, declined, expired, and cancelled support requests retained for audit.',
    refresh: 'Refresh support requests',
    loadMore: 'Load more',
    loadingMore: 'Loading more…',
    paginationError: 'More requests could not be loaded. Try again.',
    loading: 'Loading support requests',
    retry: 'Retry',
    errorTitle: 'Support requests are unavailable',
    errorDescription: 'Your decision queue is still available. Retry this support view when ready.',
    unavailable: 'Support is not available for this legal role.',
    empty: {
      incoming: { title: 'No incoming support requests', description: 'New requests assigned to you will appear here.' },
      sent: { title: 'No active sent requests', description: 'Ask a colleague for support to start a time-boxed request.' },
      history: { title: 'No support history', description: 'Completed and expired support requests will be retained here.' },
    },
    priority: { low: 'Low priority', normal: 'Normal priority', high: 'High priority' },
    status: {
      pending_manager_approval: 'Awaiting manager approval',
      open: 'Open', accepted: 'Accepted', resolved: 'Resolved', declined: 'Declined',
      expired: 'Expired', cancelled: 'Cancelled', rejected: 'Rejected',
    },
    subjectType: {
      case: 'Case', contract: 'Contract', consultation: 'Consultation', matter: 'Matter',
      investigation: 'Investigation', request: 'Request',
    },
    requestedBy: 'Requested by',
    assignedTo: 'Assigned to',
    unknownColleague: 'Legal colleague',
    targetEntity: 'Team',
    createdAt: 'Created',
    closedAt: 'Closed',
    noDeadline: 'No expiry window',
    validityLabel: 'Support validity',
    validityRemaining: (relative) => `Valid ${relative}`,
    validityEnded: 'Validity ended',
    resolutionNote: 'Resolution note',
    viewDetails: 'View full details',
    details: {
      title: 'Support request details',
      description: 'Complete request, ownership, validity, and linked-record information.',
      body: 'Request details',
      requester: 'Requested by',
      assignee: 'Assigned to',
      targetEntity: 'Team or department',
      priority: 'Priority',
      status: 'Status',
      createdAt: 'Created',
      expiresAt: 'Validity ends',
      acceptedAt: 'Accepted',
      closedAt: 'Closed',
      resolutionNote: 'Resolution note',
      linkedRecord: 'Linked record',
      openLinkedRecord: (type) => `Open linked ${type}`,
      noBody: 'No additional details were provided.',
      loading: 'Loading complete request details',
      error: 'Complete details could not be loaded.',
    },
    actions: { accept: 'Accept', decline: 'Decline', resolve: 'Resolve', cancel: 'Cancel request' },
    approval: {
      groupTitle: 'Pending my approval',
      groupDescription: 'Support requests that need your approval before they are routed to the colleague.',
      error: 'Requests awaiting your approval could not be loaded.',
      retry: 'Retry pending approvals',
      loadMore: 'Load more approvals',
      loadingMore: 'Loading more approvals…',
      approve: 'Approve',
      reject: 'Reject',
      unknownApprover: 'the assigned approver',
      awaitingBy: (name) => `Awaiting approval by ${name}`,
      approvedBy: (name) => `Approved by ${name}`,
      rejectedBy: (name) => `Rejected by ${name}`,
      decidedOn: (date) => `on ${date}`,
      rejectionNote: 'Rejection reason',
      auto: {
        auto_no_manager:
          'Routed without manager approval — the requester has no manager in the org chart, so no person approved this request.',
        auto_self:
          'Routed without a separate approval — the requester is their own approver, so no person approved this request.',
      },
    },
    actionDialog: {
      title: {
        accept: 'Accept support request', decline: 'Decline support request',
        resolve: 'Resolve support request', cancel: 'Cancel support request',
        approve: 'Approve support request', reject: 'Reject support request',
      },
      description: {
        accept: 'Confirm that you will help with this request.',
        decline: 'Decline this request. An optional note can give the requester useful context.',
        resolve: 'Mark the support as complete and optionally record what was resolved.',
        cancel: 'Cancel this active request. This action cannot be undone.',
        approve: 'Route this request to the colleague. Its validity window starts when you approve.',
        reject: 'Refuse to route this request. It never reaches the colleague, and your note is shown to the requester.',
      },
      note: 'Note',
      notePlaceholder: 'Add an optional note…',
      close: 'Keep open',
      confirm: 'Confirm',
      saving: 'Saving…',
      success: 'Support request updated.',
      failure: 'The support request could not be updated.',
      noteTooLong: 'Use 10,000 characters or fewer.',
    },
    composer: {
      title: 'Ask for support',
      description: 'Choose an org unit, then a currently active colleague in that unit.',
      entity: 'Team or department',
      entityPlaceholder: 'Choose a team',
      entitySearch: 'Search teams and departments…',
      noEntities: 'No matching teams or departments.',
      member: 'Colleague',
      memberPlaceholder: 'Choose a colleague',
      memberSearch: 'Search by name, title, or employee code…',
      memberDisabled: 'Choose a team first',
      noMembers: 'No active members are available in this team.',
      subject: 'Subject',
      subjectPlaceholder: 'What do you need help with?',
      body: 'Details',
      bodyPlaceholder: 'Add the context your colleague needs…',
      priority: 'Priority',
      businessDays: 'Validity window (business days)',
      businessDaysHint: 'The server applies your tenant working calendar. Leave empty for no expiry.',
      previewLoading: 'Checking the tenant calendar…',
      previewError: 'The expiry preview is unavailable. Retry before sending a timed request.',
      previewExpires: (date) => `Server-calculated expiry: ${date}`,
      noExpiry: 'No expiry',
      context: (type) => `Linked to this ${type}`,
      contextRecord: (type) => `Linked record: ${type}`,
      linkedRecord: 'Linked record',
      linkedRecordHint: 'Optional. Attach the case, contract, or other record this request is about.',
      linkedRecordType: 'Record type',
      linkedRecordNone: 'No linked record',
      linkedRecordPicker: 'Record',
      linkedRecordSelect: 'Search by number',
      linkedRecordSearch: 'Search by number or title…',
      linkedRecordEmpty: 'No matching records.',
      linkedRecordLoading: 'Loading records…',
      linkedRecordError: 'Records could not be loaded.',
      linkedRecordClear: 'Remove the linked record',
      linkedRecordRequired: 'Choose a record, or set the record type back to “No linked record”.',
      cancel: 'Cancel',
      submit: 'Send request',
      submitting: 'Sending…',
      success: 'Support request sent.',
      expires: (date) => `It will leave active inboxes on ${date}.`,
      failure: 'The support request could not be sent.',
      required: 'This field is required.',
      subjectTooLong: 'Use 200 characters or fewer.',
      bodyTooLong: 'Use 10,000 characters or fewer.',
      businessDaysInvalid: 'Enter a whole number from 1 to 366.',
      directoryError: 'The legal directory could not be loaded. Retry before sending.',
    },
  },
  ar: {
    ask: 'طلب دعم',
    tabs: { decisions: 'القرارات', incoming: 'الدعم الوارد', sent: 'المرسلة', history: 'السجل' },
    tabsAria: 'عروض صندوق الوارد',
    incomingDescription: 'طلبات دعم محددة المدة من زملاء الإدارة القانونية ومُسندة إليك.',
    sentDescription: 'طلبات الدعم التي أرسلتها إلى زميل محدد.',
    historyDescription: 'طلبات الدعم المنجزة أو المرفوضة أو المنتهية أو الملغاة والمحفوظة للتدقيق.',
    refresh: 'تحديث طلبات الدعم',
    loadMore: 'تحميل المزيد',
    loadingMore: 'جارٍ تحميل المزيد…',
    paginationError: 'تعذّر تحميل المزيد من الطلبات. أعد المحاولة.',
    loading: 'جارٍ تحميل طلبات الدعم',
    retry: 'إعادة المحاولة',
    errorTitle: 'طلبات الدعم غير متاحة',
    errorDescription: 'لا تزال قائمة القرارات متاحة. أعد محاولة تحميل عرض الدعم عندما تكون جاهزًا.',
    unavailable: 'ميزة الدعم غير متاحة لهذا الدور القانوني.',
    empty: {
      incoming: { title: 'لا توجد طلبات دعم واردة', description: 'ستظهر هنا الطلبات الجديدة المُسندة إليك.' },
      sent: { title: 'لا توجد طلبات مرسلة نشطة', description: 'اطلب الدعم من زميل لبدء طلب محدد المدة.' },
      history: { title: 'لا يوجد سجل دعم', description: 'ستُحفظ هنا طلبات الدعم المكتملة والمنتهية.' },
    },
    priority: { low: 'أولوية منخفضة', normal: 'أولوية عادية', high: 'أولوية مرتفعة' },
    status: {
      pending_manager_approval: 'بانتظار موافقة المدير',
      open: 'مفتوح', accepted: 'مقبول', resolved: 'مُنجز', declined: 'مرفوض',
      expired: 'منتهي', cancelled: 'ملغى', rejected: 'مرفوض من المعتمد',
    },
    subjectType: {
      case: 'قضية', contract: 'عقد', consultation: 'استشارة', matter: 'مسألة',
      investigation: 'تحقيق', request: 'طلب',
    },
    requestedBy: 'مقدّم من',
    assignedTo: 'مُسند إلى',
    unknownColleague: 'زميل قانوني',
    targetEntity: 'الفريق',
    createdAt: 'تاريخ الإنشاء',
    closedAt: 'تاريخ الإغلاق',
    noDeadline: 'دون مدة صلاحية',
    validityLabel: 'صلاحية الدعم',
    validityRemaining: (relative) => `صالح ${relative}`,
    validityEnded: 'انتهت الصلاحية',
    resolutionNote: 'ملاحظة الإنجاز',
    viewDetails: 'عرض التفاصيل الكاملة',
    details: {
      title: 'تفاصيل طلب الدعم',
      description: 'بيانات الطلب الكاملة والمسؤوليات والصلاحية والسجل المرتبط.',
      body: 'تفاصيل الطلب',
      requester: 'مقدّم الطلب',
      assignee: 'مُسند إلى',
      targetEntity: 'الفريق أو الإدارة',
      priority: 'الأولوية',
      status: 'الحالة',
      createdAt: 'تاريخ الإنشاء',
      expiresAt: 'انتهاء الصلاحية',
      acceptedAt: 'تاريخ القبول',
      closedAt: 'تاريخ الإغلاق',
      resolutionNote: 'ملاحظة الإنجاز',
      linkedRecord: 'السجل المرتبط',
      openLinkedRecord: (type) => `فتح ${type} المرتبط`,
      noBody: 'لم تُضف تفاصيل إضافية.',
      loading: 'جارٍ تحميل تفاصيل الطلب الكاملة',
      error: 'تعذّر تحميل التفاصيل الكاملة.',
    },
    actions: { accept: 'قبول', decline: 'رفض', resolve: 'إنجاز', cancel: 'إلغاء الطلب' },
    approval: {
      groupTitle: 'بانتظار موافقتي',
      groupDescription: 'طلبات دعم تحتاج موافقتك قبل توجيهها إلى الزميل.',
      error: 'تعذّر تحميل الطلبات التي تنتظر موافقتك.',
      retry: 'إعادة تحميل الطلبات بانتظار الموافقة',
      loadMore: 'تحميل مزيد من الطلبات بانتظار الموافقة',
      loadingMore: 'جارٍ تحميل مزيد من الطلبات…',
      approve: 'اعتماد',
      reject: 'عدم الاعتماد',
      unknownApprover: 'المعتمد المُحدَّد',
      awaitingBy: (name) => `بانتظار موافقة ${name}`,
      approvedBy: (name) => `اعتُمد الطلب من ${name}`,
      rejectedBy: (name) => `رُفض الطلب من ${name}`,
      decidedOn: (date) => `بتاريخ ${date}`,
      rejectionNote: 'سبب الرفض',
      auto: {
        auto_no_manager:
          'وُجّه الطلب دون موافقة مدير؛ لا يوجد مدير لمقدّم الطلب في الهيكل التنظيمي، ولم يعتمد الطلب أي شخص.',
        auto_self:
          'وُجّه الطلب دون موافقة منفصلة؛ مقدّم الطلب هو المعتمد نفسه، ولم يعتمد الطلب أي شخص آخر.',
      },
    },
    actionDialog: {
      title: {
        accept: 'قبول طلب الدعم', decline: 'رفض طلب الدعم',
        resolve: 'إنجاز طلب الدعم', cancel: 'إلغاء طلب الدعم',
        approve: 'اعتماد طلب الدعم', reject: 'عدم اعتماد طلب الدعم',
      },
      description: {
        accept: 'أكّد أنك ستساعد في هذا الطلب.',
        decline: 'ارفض الطلب، ويمكنك إضافة ملاحظة اختيارية لتوضيح السبب لمقدّم الطلب.',
        resolve: 'ضع علامة الإنجاز على الدعم، ويمكنك تسجيل ما تم إنجازه.',
        cancel: 'ألغِ هذا الطلب النشط. لا يمكن التراجع عن هذا الإجراء.',
        approve: 'وجّه هذا الطلب إلى الزميل. تبدأ مدة صلاحيته عند الاعتماد.',
        reject: 'ارفض اعتماد هذا الطلب. لن يصل إلى الزميل، وستظهر ملاحظتك لمقدّم الطلب.',
      },
      note: 'ملاحظة',
      notePlaceholder: 'أضف ملاحظة اختيارية…',
      close: 'إبقاء الطلب',
      confirm: 'تأكيد',
      saving: 'جارٍ الحفظ…',
      success: 'تم تحديث طلب الدعم.',
      failure: 'تعذّر تحديث طلب الدعم.',
      noteTooLong: 'استخدم ١٠٬٠٠٠ حرف أو أقل.',
    },
    composer: {
      title: 'طلب دعم',
      description: 'اختر الوحدة التنظيمية أولًا، ثم زميلًا نشطًا ضمنها.',
      entity: 'الفريق أو الإدارة',
      entityPlaceholder: 'اختر فريقًا',
      entitySearch: 'ابحث في الفرق والإدارات…',
      noEntities: 'لا توجد فرق أو إدارات مطابقة.',
      member: 'الزميل',
      memberPlaceholder: 'اختر زميلًا',
      memberSearch: 'ابحث بالاسم أو المسمى الوظيفي أو الرقم الوظيفي…',
      memberDisabled: 'اختر فريقًا أولًا',
      noMembers: 'لا يوجد أعضاء نشطون متاحون في هذا الفريق.',
      subject: 'الموضوع',
      subjectPlaceholder: 'ما المساعدة التي تحتاجها؟',
      body: 'التفاصيل',
      bodyPlaceholder: 'أضف السياق الذي يحتاجه زميلك…',
      priority: 'الأولوية',
      businessDays: 'مدة الصلاحية (أيام عمل)',
      businessDaysHint: 'يطبّق الخادم تقويم عمل المنشأة. اترك الحقل فارغًا دون انتهاء.',
      previewLoading: 'جارٍ التحقق من تقويم المنشأة…',
      previewError: 'معاينة انتهاء الصلاحية غير متاحة. أعد المحاولة قبل إرسال طلب محدد المدة.',
      previewExpires: (date) => `الانتهاء المحسوب من الخادم: ${date}`,
      noExpiry: 'دون انتهاء',
      context: (type) => `مرتبط بهذا ${type}`,
      contextRecord: (type) => `السجل المرتبط: ${type}`,
      linkedRecord: 'السجل المرتبط',
      linkedRecordHint: 'اختياري. اربط الطلب بالقضية أو العقد أو السجل المعني.',
      linkedRecordType: 'نوع السجل',
      linkedRecordNone: 'دون سجل مرتبط',
      linkedRecordPicker: 'السجل',
      linkedRecordSelect: 'ابحث بالرقم',
      linkedRecordSearch: 'ابحث بالرقم أو العنوان…',
      linkedRecordEmpty: 'لا توجد سجلات مطابقة.',
      linkedRecordLoading: 'جارٍ تحميل السجلات…',
      linkedRecordError: 'تعذّر تحميل السجلات.',
      linkedRecordClear: 'إزالة السجل المرتبط',
      linkedRecordRequired: 'اختر سجلاً أو أعد نوع السجل إلى «دون سجل مرتبط».',
      cancel: 'إلغاء',
      submit: 'إرسال الطلب',
      submitting: 'جارٍ الإرسال…',
      success: 'تم إرسال طلب الدعم.',
      expires: (date) => `سيغادر صناديق الوارد النشطة في ${date}.`,
      failure: 'تعذّر إرسال طلب الدعم.',
      required: 'هذا الحقل مطلوب.',
      subjectTooLong: 'استخدم ٢٠٠ حرف أو أقل.',
      bodyTooLong: 'استخدم ١٠٬٠٠٠ حرف أو أقل.',
      businessDaysInvalid: 'أدخل عددًا صحيحًا من ١ إلى ٣٦٦.',
      directoryError: 'تعذّر تحميل دليل الإدارة القانونية. أعد المحاولة قبل الإرسال.',
    },
  },
};

export function useSupportLabels(): SupportLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveLexBilingual(supportLabels, locale), [locale]);
}
