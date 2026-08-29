'use client';

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n';
import { type LexBilingual, resolveLexBilingual } from '../../_lib/lex-i18n';

export const CONSULTATION_STATUS_OPTIONS = [
  'submitted',
  'classified',
  'routed',
  'responded',
  'approved',
  'archived',
] as const;

export const CONSULTATION_TYPE_OPTIONS = [
  'general',
  'contractual',
  'labor',
  'regulatory',
  'corporate',
  'litigation',
  'intellectual_property',
  'tax',
  'other',
] as const;

export const CONSULTATION_PRIORITY_OPTIONS = [
  'critical',
  'high',
  'medium',
  'low',
] as const;

export function formatConsultationToken(token: string): string {
  return token
    .split(/[_-]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export interface ConsultationLabels {
  pageTitle: string;
  pageDescription: string;
  /** Uppercase eyebrow above the list-shell title. */
  eyebrow: string;
  create: string;
  searchPlaceholder: string;
  emptyTitle: string;
  emptyDescription: string;
  loadError: string;
  stats: {
    total: string;
    open: string;
    responded: string;
    approved: string;
    /** KPI tile: consultations whose SLA is about to breach (#3/#4). */
    breachingSoon: string;
    /** KPI tile: consultations already in SLA breach (#3/#4). */
    breached: string;
  };
  statDetails: {
    filteredWorkload: string;
    fullQueue: string;
    workloadShare: string;
    needsAction: string;
    activeQueue: string;
    answeredByLegal: string;
    responseCoverage: string;
    completedWorkflow: string;
    closureRate: string;
    slaWatchlist: string;
    riskShare: string;
    criticalEscalations: string;
    breachShare: string;
    avgResponse: string;
  };
  columns: {
    title: string;
    number: string;
    type: string;
    status: string;
    priority: string;
    advisor: string;
    updated: string;
    /** "Due / SLA" column header (#1/#2). */
    dueSla: string;
  };
  /**
   * SLA group (#1/#2/#3). Mix of static labels and interpolating functions for
   * escalation level / breach time / relative due copy. Consumed by columns, the
   * SLA panel, board cards, and analytics.
   */
  sla: {
    acknowledged: string;
    responseDue: string;
    breached: string;
    dueSoon: string;
    onTrack: string;
    escalationLevel: (n: number) => string;
    breachedAt: (time: string) => string;
    outcome: string;
    met: string;
    pending: string;
    ackDue: string;
    overdueBy: (x: string) => string;
    inDuration: (x: string) => string;
  };
  /** Saved views / queue presets (#5/#17). */
  savedViews: {
    myQueue: string;
    assignedToMe: string;
    awaitingMyResponse: string;
    awaitingMyApproval: string;
    unassigned: string;
    all: string;
    /** Persisted saved-views bar (#17). */
    saveCurrent: string;
    saved: string;
    noneSaved: string;
  };
  /** Created-date range filter (#6). */
  dateRange: {
    createdFrom: string;
    createdTo: string;
    dateRange: string;
    clear: string;
  };
  /** Inline / per-row actions (#7). */
  rowActions: {
    classify: string;
    route: string;
    respond: string;
    archive: string;
    open: string;
    actions: string;
  };
  /** Bulk / multi-select actions (#8). */
  bulk: {
    selected: (n: number) => string;
    bulkClassify: string;
    bulkRoute: string;
    bulkArchive: string;
    bulkTag: string;
    bulkDelete: string;
    apply: string;
    clearSelection: string;
  };
  /** Board / view-mode switcher (#9). */
  board: {
    board: string;
    table: string;
    listView: string;
    boardView: string;
  };
  /** File picker / upload affordances (#10). */
  filePicker: {
    chooseFile: string;
    upload: string;
    browseFiles: string;
    noFileSelected: string;
  };
  /** Advisor picker (#11). */
  advisorPicker: {
    searchPlaceholder: string;
    openCount: (n: number) => string;
    workload: string;
  };
  /** Tagging (#12). */
  tags: {
    addTag: string;
    filterByTag: string;
    suggestions: string;
    noTagsYet: string;
  };
  /** Legal hold (#13). */
  legalHold: {
    onHold: string;
    bannerMessage: string;
    holdReason: string;
  };
  /** AI drafting (#14). */
  aiDraft: {
    draftWithAi: string;
    regenerate: string;
    aiGenerated: string;
    useDraft: string;
    drafting: string;
    editDraft: string;
  };
  /** Audit trail enhancements (#15). */
  audit: {
    title: string;
    filterByActor: string;
    filterByAction: string;
    export: string;
    exportCsv: string;
    /** Timeline phrasing, e.g. "Classified the consultation". */
    timelinePerformed: (action: string) => string;
    byActor: (actor: string) => string;
  };
  /** Export / analytics (bonus). */
  analytics: {
    exportList: string;
    timeToRespond: string;
    timeToApprove: string;
    avg: string;
    median: string;
  };
  filters: {
    status: string;
    type: string;
    priority: string;
    statusOptions: Record<string, string>;
    typeOptions: Record<string, string>;
    priorityOptions: Record<string, string>;
  };
  form: {
    eyebrow: string;
    title: string;
    description: string;
    intakeTitle: string;
    intakeDescription: string;
    questionSectionTitle: string;
    questionSectionDescription: string;
    titleEn: string;
    titleEnPlaceholder: string;
    titleAr: string;
    titleArPlaceholder: string;
    titleHelper: string;
    type: string;
    priority: string;
    priorityHelper: string;
    requesterName: string;
    requesterNamePlaceholder: string;
    department: string;
    departmentPlaceholder: string;
    question: string;
    questionPlaceholder: string;
    questionHelper: string;
    tags: string;
    tagsPlaceholder: string;
    tagsHelper: string;
    summaryTitle: string;
    summaryDescription: string;
    previewTitle: string;
    readinessTitle: string;
    readiness: (complete: number, total: number) => string;
    notProvided: string;
    nextTitle: string;
    nextClassify: string;
    nextAssign: string;
    nextRespond: string;
    attachmentsNote: string;
    requiredNote: string;
    cancel: string;
    submit: string;
    errors: {
      titleRequired: string;
      questionRequired: string;
      requesterRequired: string;
    };
  };
  detail: {
    loadingTitle: string;
    loadingDescription: string;
    errorMessage: string;
    fallbackDescription: string;
    classify: string;
    route: string;
    respond: string;
    approveAction: string;
    archive: string;
    delete: string;
    metricStatus: string;
    metricType: string;
    metricPriority: string;
    metricAdvisor: string;
    overviewTitle: string;
    overviewDescription: string;
    metadata: {
      number: string;
      requester: string;
      department: string;
      advisor: string;
      legalRequest: string;
      respondedAt: string;
      approvedAt: string;
      created: string;
      updated: string;
    };
    notSet: string;
    none: string;
    unassigned: string;
    questionTitle: string;
    questionDescription: string;
    responseTitle: string;
    responseDescription: string;
    responseEmpty: string;
    tagsTitle: string;
    tagsEmpty: string;
    documentsTitle: string;
    documentsDescription: string;
    attachDocument: string;
    documentsEmptyTitle: string;
    documentsEmptyDescription: string;
    approvalTitle: string;
    approvalDescription: string;
    approvalEmptyTitle: string;
    approvalEmptyDescription: string;
    startApproval: string;
    approve: string;
    reject: string;
    auditTitle: string;
    auditDescription: string;
    auditEmptyTitle: string;
    auditEmptyDescription: string;
  };
  dialogs: {
    classifyTitle: string;
    classifyDescription: string;
    type: string;
    priority: string;
    routeTitle: string;
    routeDescription: string;
    advisor: string;
    advisorPlaceholder: string;
    respondTitle: string;
    respondDescription: string;
    response: string;
    responsePlaceholder: string;
    useAi: string;
    archiveTitle: string;
    archiveDescription: string;
    reason: string;
    reasonPlaceholder: string;
    attachTitle: string;
    attachDescription: string;
    fileId: string;
    fileIdPlaceholder: string;
    fileName: string;
    fileNamePlaceholder: string;
    fileSize: string;
    kind: string;
    kindPlaceholder: string;
    approvalTitle: string;
    approvalDescription: string;
    approverRole: string;
    approverRolePlaceholder: string;
    notes: string;
    notesPlaceholder: string;
    submit: string;
    cancel: string;
  };
  toast: {
    submitted: string;
    deleted: string;
    classified: string;
    routed: string;
    responded: string;
    archived: string;
    documentAttached: string;
    documentRemoved: string;
    approvalStarted: string;
    approvalDecided: string;
  };
  confirm: {
    deleteTitle: string;
    deleteDescription: (title: string) => string;
    removeDocumentTitle: string;
    removeDocumentDescription: (name: string) => string;
    confirm: string;
  };
}

const bundle: LexBilingual<ConsultationLabels> = {
  en: {
    pageTitle: 'Consultations',
    pageDescription:
      'Legal advisory: submit, classify, route, respond and approve.',
    eyebrow: 'Legal Suite',
    create: 'New Consultation',
    searchPlaceholder: 'Search consultations...',
    emptyTitle: 'No consultations found',
    emptyDescription: 'No consultations matched the current filters.',
    loadError: 'Failed to load consultations.',
    stats: {
      total: 'Total',
      open: 'Open',
      responded: 'Responded',
      approved: 'Approved',
      breachingSoon: 'Breaching soon',
      breached: 'Breached',
    },
    statDetails: {
      filteredWorkload: 'Filtered workload across the current queue.',
      fullQueue: 'All consultations in view',
      workloadShare: 'Workload share',
      needsAction: 'Needs classification, routing, or legal response.',
      activeQueue: 'Active queue',
      answeredByLegal: 'Answered by a legal advisor.',
      responseCoverage: 'Response coverage',
      completedWorkflow: 'Approved and ready for closure.',
      closureRate: 'Closure rate',
      slaWatchlist: 'Due soon and should be triaged first.',
      riskShare: 'SLA risk share',
      criticalEscalations: 'Already past the agreed SLA.',
      breachShare: 'Breach share',
      avgResponse: 'Avg response',
    },
    columns: {
      title: 'Title',
      number: 'Number',
      type: 'Type',
      status: 'Status',
      priority: 'Priority',
      advisor: 'Advisor',
      updated: 'Updated',
      dueSla: 'Due / SLA',
    },
    sla: {
      acknowledged: 'Acknowledged',
      responseDue: 'Response due',
      breached: 'Breached',
      dueSoon: 'Due soon',
      onTrack: 'On track',
      escalationLevel: (n) => `Escalation level ${n}`,
      breachedAt: (time) => `Breached ${time}`,
      outcome: 'Outcome',
      met: 'Met',
      pending: 'Pending',
      ackDue: 'Ack due',
      overdueBy: (x) => `Overdue by ${x}`,
      inDuration: (x) => `in ${x}`,
    },
    savedViews: {
      myQueue: 'My queue',
      assignedToMe: 'Assigned to me',
      awaitingMyResponse: 'Awaiting my response',
      awaitingMyApproval: 'Awaiting my approval',
      unassigned: 'Unassigned',
      all: 'All',
      saveCurrent: 'Save current view',
      saved: 'Saved views',
      noneSaved: 'No saved views yet',
    },
    dateRange: {
      createdFrom: 'Created from',
      createdTo: 'Created to',
      dateRange: 'Date range',
      clear: 'Clear',
    },
    rowActions: {
      classify: 'Classify',
      route: 'Route',
      respond: 'Respond',
      archive: 'Archive',
      open: 'Open',
      actions: 'Actions',
    },
    bulk: {
      selected: (n) => `Selected (${n})`,
      bulkClassify: 'Bulk classify',
      bulkRoute: 'Bulk route',
      bulkArchive: 'Bulk archive',
      bulkTag: 'Bulk tag',
      bulkDelete: 'Bulk delete',
      apply: 'Apply',
      clearSelection: 'Clear selection',
    },
    board: {
      board: 'Board',
      table: 'Table',
      listView: 'List view',
      boardView: 'Board view',
    },
    filePicker: {
      chooseFile: 'Choose file',
      upload: 'Upload',
      browseFiles: 'Browse files',
      noFileSelected: 'No file selected',
    },
    advisorPicker: {
      searchPlaceholder: 'Search advisors…',
      openCount: (n) => `${n} open`,
      workload: 'Workload',
    },
    tags: {
      addTag: 'Add tag',
      filterByTag: 'Filter by tag',
      suggestions: 'Suggestions',
      noTagsYet: 'No tags yet',
    },
    legalHold: {
      onHold: 'On legal hold',
      bannerMessage:
        'This consultation is under legal hold and cannot be archived or have documents removed.',
      holdReason: 'Hold reason',
    },
    aiDraft: {
      draftWithAi: 'Draft with AI',
      regenerate: 'Regenerate',
      aiGenerated: 'AI-generated',
      useDraft: 'Use draft',
      drafting: 'Drafting…',
      editDraft: 'Edit draft',
    },
    audit: {
      title: 'Audit trail',
      filterByActor: 'Filter by actor',
      filterByAction: 'Filter by action',
      export: 'Export',
      exportCsv: 'Export CSV',
      timelinePerformed: (action) => `${action}`,
      byActor: (actor) => `by ${actor}`,
    },
    analytics: {
      exportList: 'Export list',
      timeToRespond: 'Time to respond',
      timeToApprove: 'Time to approve',
      avg: 'Avg',
      median: 'Median',
    },
    filters: {
      status: 'Status',
      type: 'Type',
      priority: 'Priority',
      statusOptions: {
        submitted: 'Submitted',
        classified: 'Classified',
        routed: 'Routed',
        responded: 'Responded',
        approved: 'Approved',
        archived: 'Archived',
      },
      typeOptions: {
        general: 'General',
        contractual: 'Contractual',
        labor: 'Labor',
        regulatory: 'Regulatory',
        corporate: 'Corporate',
        litigation: 'Litigation',
        intellectual_property: 'Intellectual Property',
        tax: 'Tax',
        other: 'Other',
      },
      priorityOptions: {
        critical: 'Critical',
        high: 'High',
        medium: 'Medium',
        low: 'Low',
      },
    },
    form: {
      eyebrow: 'Legal advisory intake',
      title: 'Submit Consultation',
      description:
        'Open a structured legal advisory request for review and response.',
      intakeTitle: 'Request overview',
      intakeDescription:
        'Give the legal team enough context to triage and route the request correctly.',
      questionSectionTitle: 'Legal question and context',
      questionSectionDescription:
        'Describe the issue, desired outcome, and any timing constraints.',
      titleEn: 'Title (English)',
      titleEnPlaceholder: 'Vendor contract review',
      titleAr: 'Title (Arabic)',
      titleArPlaceholder: 'مراجعة عقد المورّد',
      titleHelper:
        'Provide at least one title. Adding both languages improves bilingual search.',
      type: 'Type',
      priority: 'Priority',
      priorityHelper:
        'Use Critical only for matters requiring immediate legal intervention.',
      requesterName: 'Requester name',
      requesterNamePlaceholder: 'Full name',
      department: 'Department',
      departmentPlaceholder: 'e.g. Procurement',
      question: 'Question',
      questionPlaceholder: 'Describe the legal question or matter...',
      questionHelper:
        'Include the relevant facts, parties, deadlines, and the decision you need.',
      tags: 'Tags',
      tagsPlaceholder: 'comma, separated, tags',
      tagsHelper:
        'Separate tags with commas. Duplicate tags are removed automatically.',
      summaryTitle: 'Submission summary',
      summaryDescription: 'Review the routing information before submission.',
      previewTitle: 'Request title',
      readinessTitle: 'Ready to submit',
      readiness: (complete, total) =>
        `${complete} of ${total} required fields complete`,
      notProvided: 'Not provided',
      nextTitle: 'What happens next',
      nextClassify:
        'Legal operations classifies the subject and confirms priority.',
      nextAssign: 'The request is routed to the right legal advisor.',
      nextRespond:
        'The official opinion and updates appear on the consultation detail page.',
      attachmentsNote:
        'Supporting documents can be attached immediately after the consultation is created.',
      requiredNote: 'Fields marked * are required.',
      cancel: 'Cancel',
      submit: 'Submit consultation',
      errors: {
        titleRequired: 'A title is required in at least one language.',
        questionRequired: 'The question is required.',
        requesterRequired: 'Requester name is required.',
      },
    },
    detail: {
      loadingTitle: 'Consultation',
      loadingDescription: 'Loading consultation details.',
      errorMessage: 'Failed to load consultation details.',
      fallbackDescription: 'Legal consultation detail.',
      classify: 'Classify',
      route: 'Route',
      respond: 'Respond',
      approveAction: 'Start approval',
      archive: 'Archive',
      delete: 'Delete',
      metricStatus: 'Status',
      metricType: 'Type',
      metricPriority: 'Priority',
      metricAdvisor: 'Advisor',
      overviewTitle: 'Consultation Overview',
      overviewDescription: 'Core consultation state and routing context.',
      metadata: {
        number: 'Consultation number',
        requester: 'Requester',
        department: 'Department',
        advisor: 'Advisor',
        legalRequest: 'Legal request',
        respondedAt: 'Responded at',
        approvedAt: 'Approved at',
        created: 'Created',
        updated: 'Updated',
      },
      notSet: 'Not set',
      none: 'None',
      unassigned: 'Unassigned',
      questionTitle: 'Question',
      questionDescription: 'The submitted legal question.',
      responseTitle: 'Response',
      responseDescription: 'The advisor response.',
      responseEmpty: 'No response has been recorded yet.',
      tagsTitle: 'Tags',
      tagsEmpty: 'No tags.',
      documentsTitle: 'Documents',
      documentsDescription: 'Attached supporting documents.',
      attachDocument: 'Attach document',
      documentsEmptyTitle: 'No documents',
      documentsEmptyDescription: 'No documents have been attached yet.',
      approvalTitle: 'Approval',
      approvalDescription: 'Approval-chain tasks for the response.',
      approvalEmptyTitle: 'No approval tasks',
      approvalEmptyDescription:
        'Start the approval chain to route the response for sign-off.',
      startApproval: 'Start approval',
      approve: 'Approve',
      reject: 'Reject',
      auditTitle: 'Audit Trail',
      auditDescription: 'Append-only governance log of every action.',
      auditEmptyTitle: 'No audit entries',
      auditEmptyDescription: 'No actions have been recorded yet.',
    },
    dialogs: {
      classifyTitle: 'Classify consultation',
      classifyDescription: 'Assign the subject-matter type and priority.',
      type: 'Type',
      priority: 'Priority',
      routeTitle: 'Route consultation',
      routeDescription: 'Assign the consultation to an advisor.',
      advisor: 'Advisor',
      advisorPlaceholder: 'Select an advisor',
      respondTitle: 'Record response',
      respondDescription: "Record the advisor's response.",
      response: 'Response',
      responsePlaceholder: 'Advisory response...',
      useAi: 'Draft first response with AI',
      archiveTitle: 'Archive consultation',
      archiveDescription: 'Archive this approved consultation.',
      reason: 'Reason',
      reasonPlaceholder: 'Reason for archiving',
      attachTitle: 'Attach document',
      attachDescription: 'Link a Files-service object to this consultation.',
      fileId: 'File ID',
      fileIdPlaceholder: 'Select a file',
      fileName: 'File name',
      fileNamePlaceholder: 'document.pdf',
      fileSize: 'File size (bytes)',
      kind: 'Kind',
      kindPlaceholder: 'attachment',
      approvalTitle: 'Start approval',
      approvalDescription: 'Route the response for sign-off.',
      approverRole: 'Approver role',
      approverRolePlaceholder: 'legal_director',
      notes: 'Notes',
      notesPlaceholder: 'Optional notes',
      submit: 'Submit',
      cancel: 'Cancel',
    },
    toast: {
      submitted: 'Consultation submitted.',
      deleted: 'Consultation deleted.',
      classified: 'Consultation classified.',
      routed: 'Consultation routed.',
      responded: 'Response recorded.',
      archived: 'Consultation archived.',
      documentAttached: 'Document attached.',
      documentRemoved: 'Document removed.',
      approvalStarted: 'Approval chain started.',
      approvalDecided: 'Decision applied.',
    },
    confirm: {
      deleteTitle: 'Delete consultation',
      deleteDescription: (title) =>
        `Delete "${title}"? This removes it from the active register.`,
      removeDocumentTitle: 'Remove document',
      removeDocumentDescription: (name) =>
        `Remove "${name}" from this consultation?`,
      confirm: 'Confirm',
    },
  },
  ar: {
    pageTitle: 'الاستشارات',
    pageDescription:
      'الاستشارات القانونية: التقديم والتصنيف والتوجيه والرد والاعتماد.',
    eyebrow: 'المجموعة القانونية',
    create: 'استشارة جديدة',
    searchPlaceholder: 'البحث في الاستشارات...',
    emptyTitle: 'لا توجد استشارات',
    emptyDescription: 'لا توجد استشارات مطابقة للمرشّحات الحالية.',
    loadError: 'تعذّر تحميل الاستشارات.',
    stats: {
      total: 'الإجمالي',
      open: 'مفتوحة',
      responded: 'تم الرد',
      approved: 'معتمدة',
      breachingSoon: 'وشيكة الإخلال',
      breached: 'مُخلّة بالمستوى',
    },
    statDetails: {
      filteredWorkload: 'عبء العمل المصفّى في قائمة الانتظار الحالية.',
      fullQueue: 'كل الاستشارات في العرض',
      workloadShare: 'حصة عبء العمل',
      needsAction: 'تحتاج إلى تصنيف أو توجيه أو رد قانوني.',
      activeQueue: 'قائمة نشطة',
      answeredByLegal: 'تمت الإجابة بواسطة مستشار قانوني.',
      responseCoverage: 'تغطية الردود',
      completedWorkflow: 'معتمدة وجاهزة للإغلاق.',
      closureRate: 'معدل الإغلاق',
      slaWatchlist: 'قريبة الاستحقاق ويجب فرزها أولاً.',
      riskShare: 'حصة مخاطر مستوى الخدمة',
      criticalEscalations: 'تجاوزت مستوى الخدمة المتفق عليه.',
      breachShare: 'حصة الإخلال',
      avgResponse: 'متوسط الرد',
    },
    columns: {
      title: 'العنوان',
      number: 'الرقم',
      type: 'النوع',
      status: 'الحالة',
      priority: 'الأولوية',
      advisor: 'المستشار',
      updated: 'آخر تحديث',
      dueSla: 'الاستحقاق / مستوى الخدمة',
    },
    sla: {
      acknowledged: 'تم الإقرار',
      responseDue: 'موعد الرد',
      breached: 'مُخلّة بالمستوى',
      dueSoon: 'قريبة الاستحقاق',
      onTrack: 'ضمن المسار',
      escalationLevel: (n) => `مستوى التصعيد ${n}`,
      breachedAt: (time) => `أُخلّ بها ${time}`,
      outcome: 'النتيجة',
      met: 'مُستوفاة',
      pending: 'قيد الانتظار',
      ackDue: 'موعد الإقرار',
      overdueBy: (x) => `متأخرة بمقدار ${x}`,
      inDuration: (x) => `خلال ${x}`,
    },
    savedViews: {
      myQueue: 'قائمتي',
      assignedToMe: 'المُسندة إليّ',
      awaitingMyResponse: 'بانتظار ردّي',
      awaitingMyApproval: 'بانتظار اعتمادي',
      unassigned: 'غير مُسندة',
      all: 'الكل',
      saveCurrent: 'حفظ العرض الحالي',
      saved: 'العروض المحفوظة',
      noneSaved: 'لا توجد عروض محفوظة بعد',
    },
    dateRange: {
      createdFrom: 'أُنشئت من',
      createdTo: 'أُنشئت إلى',
      dateRange: 'النطاق الزمني',
      clear: 'مسح',
    },
    rowActions: {
      classify: 'تصنيف',
      route: 'توجيه',
      respond: 'الرد',
      archive: 'أرشفة',
      open: 'فتح',
      actions: 'إجراءات',
    },
    bulk: {
      selected: (n) => `محدد (${n})`,
      bulkClassify: 'تصنيف جماعي',
      bulkRoute: 'توجيه جماعي',
      bulkArchive: 'أرشفة جماعية',
      bulkTag: 'وسم جماعي',
      bulkDelete: 'حذف جماعي',
      apply: 'تطبيق',
      clearSelection: 'مسح التحديد',
    },
    board: {
      board: 'اللوحة',
      table: 'الجدول',
      listView: 'عرض القائمة',
      boardView: 'عرض اللوحة',
    },
    filePicker: {
      chooseFile: 'اختر ملفًا',
      upload: 'رفع',
      browseFiles: 'استعراض الملفات',
      noFileSelected: 'لم يُحدَّد ملف',
    },
    advisorPicker: {
      searchPlaceholder: 'البحث عن مستشارين…',
      openCount: (n) => `${n} مفتوحة`,
      workload: 'عبء العمل',
    },
    tags: {
      addTag: 'إضافة وسم',
      filterByTag: 'التصفية حسب الوسم',
      suggestions: 'اقتراحات',
      noTagsYet: 'لا توجد وسوم بعد',
    },
    legalHold: {
      onHold: 'قيد الحجز القانوني',
      bannerMessage:
        'هذه الاستشارة قيد الحجز القانوني ولا يمكن أرشفتها أو إزالة مستنداتها.',
      holdReason: 'سبب الحجز',
    },
    aiDraft: {
      draftWithAi: 'الصياغة بالذكاء الاصطناعي',
      regenerate: 'إعادة التوليد',
      aiGenerated: 'مُولَّد بالذكاء الاصطناعي',
      useDraft: 'استخدام المسودة',
      drafting: 'جارٍ الصياغة…',
      editDraft: 'تعديل المسودة',
    },
    audit: {
      title: 'سجل المراجعة',
      filterByActor: 'التصفية حسب المنفِّذ',
      filterByAction: 'التصفية حسب الإجراء',
      export: 'تصدير',
      exportCsv: 'تصدير CSV',
      timelinePerformed: (action) => `${action}`,
      byActor: (actor) => `بواسطة ${actor}`,
    },
    analytics: {
      exportList: 'تصدير القائمة',
      timeToRespond: 'زمن الرد',
      timeToApprove: 'زمن الاعتماد',
      avg: 'المتوسط',
      median: 'الوسيط',
    },
    filters: {
      status: 'الحالة',
      type: 'النوع',
      priority: 'الأولوية',
      statusOptions: {
        submitted: 'مُقدَّمة',
        classified: 'مُصنَّفة',
        routed: 'مُوجَّهة',
        responded: 'تم الرد',
        approved: 'معتمدة',
        archived: 'مؤرشفة',
      },
      typeOptions: {
        general: 'عامة',
        contractual: 'تعاقدية',
        labor: 'عمالية',
        regulatory: 'تنظيمية',
        corporate: 'الشركات',
        litigation: 'تقاضي',
        intellectual_property: 'الملكية الفكرية',
        tax: 'ضريبية',
        other: 'أخرى',
      },
      priorityOptions: {
        critical: 'حرج',
        high: 'مرتفع',
        medium: 'متوسط',
        low: 'منخفض',
      },
    },
    form: {
      eyebrow: 'استقبال طلب استشارة قانونية',
      title: 'تقديم استشارة',
      description: 'فتح طلب استشارة قانونية منظّم للمراجعة والرد.',
      intakeTitle: 'نظرة عامة على الطلب',
      intakeDescription:
        'زوّد الفريق القانوني بالسياق الكافي لتصنيف الطلب وتوجيهه بصورة صحيحة.',
      questionSectionTitle: 'السؤال القانوني والسياق',
      questionSectionDescription:
        'اشرح المسألة والنتيجة المطلوبة وأي مواعيد أو قيود زمنية.',
      titleEn: 'العنوان (الإنجليزية)',
      titleEnPlaceholder: 'Vendor contract review',
      titleAr: 'العنوان (العربية)',
      titleArPlaceholder: 'مراجعة عقد المورّد',
      titleHelper:
        'أدخل عنوانًا بلغة واحدة على الأقل. تساعد إضافة اللغتين في تحسين البحث.',
      type: 'النوع',
      priority: 'الأولوية',
      priorityHelper:
        'استخدم الأولوية الحرجة فقط للمسائل التي تتطلب تدخلاً قانونيًا فوريًا.',
      requesterName: 'اسم مُقدِّم الطلب',
      requesterNamePlaceholder: 'الاسم الكامل',
      department: 'الإدارة',
      departmentPlaceholder: 'مثال: المشتريات',
      question: 'السؤال',
      questionPlaceholder: 'صف السؤال أو الموضوع القانوني...',
      questionHelper:
        'أدرج الوقائع والأطراف والمواعيد ذات الصلة والقرار المطلوب.',
      tags: 'الوسوم',
      tagsPlaceholder: 'وسوم، مفصولة، بفواصل',
      tagsHelper: 'افصل الوسوم بفواصل. تُزال الوسوم المكررة تلقائيًا.',
      summaryTitle: 'ملخص التقديم',
      summaryDescription: 'راجع معلومات التوجيه قبل تقديم الطلب.',
      previewTitle: 'عنوان الطلب',
      readinessTitle: 'الجاهزية للتقديم',
      readiness: (complete, total) =>
        `اكتمل ${complete} من أصل ${total} حقول مطلوبة`,
      notProvided: 'غير مُدخل',
      nextTitle: 'ماذا يحدث بعد ذلك',
      nextClassify: 'تصنّف العمليات القانونية الموضوع وتؤكد الأولوية.',
      nextAssign: 'يُوجّه الطلب إلى المستشار القانوني المناسب.',
      nextRespond: 'يظهر الرأي الرسمي والتحديثات في صفحة تفاصيل الاستشارة.',
      attachmentsNote: 'يمكن إرفاق المستندات الداعمة فور إنشاء الاستشارة.',
      requiredNote: 'الحقول المعلّمة بـ * مطلوبة.',
      cancel: 'إلغاء',
      submit: 'تقديم الاستشارة',
      errors: {
        titleRequired: 'العنوان مطلوب بلغة واحدة على الأقل.',
        questionRequired: 'السؤال مطلوب.',
        requesterRequired: 'اسم مُقدِّم الطلب مطلوب.',
      },
    },
    detail: {
      loadingTitle: 'الاستشارة',
      loadingDescription: 'جارٍ تحميل تفاصيل الاستشارة.',
      errorMessage: 'تعذّر تحميل تفاصيل الاستشارة.',
      fallbackDescription: 'تفاصيل الاستشارة القانونية.',
      classify: 'تصنيف',
      route: 'توجيه',
      respond: 'الرد',
      approveAction: 'بدء الاعتماد',
      archive: 'أرشفة',
      delete: 'حذف',
      metricStatus: 'الحالة',
      metricType: 'النوع',
      metricPriority: 'الأولوية',
      metricAdvisor: 'المستشار',
      overviewTitle: 'نظرة عامة على الاستشارة',
      overviewDescription: 'الحالة الأساسية للاستشارة وسياق التوجيه.',
      metadata: {
        number: 'رقم الاستشارة',
        requester: 'مُقدِّم الطلب',
        department: 'الإدارة',
        advisor: 'المستشار',
        legalRequest: 'الطلب القانوني',
        respondedAt: 'تاريخ الرد',
        approvedAt: 'تاريخ الاعتماد',
        created: 'تاريخ الإنشاء',
        updated: 'آخر تحديث',
      },
      notSet: 'غير محدد',
      none: 'لا يوجد',
      unassigned: 'غير مُسند',
      questionTitle: 'السؤال',
      questionDescription: 'السؤال القانوني المُقدَّم.',
      responseTitle: 'الرد',
      responseDescription: 'رد المستشار.',
      responseEmpty: 'لم يُسجَّل أي رد بعد.',
      tagsTitle: 'الوسوم',
      tagsEmpty: 'لا توجد وسوم.',
      documentsTitle: 'المستندات',
      documentsDescription: 'المستندات الداعمة المرفقة.',
      attachDocument: 'إرفاق مستند',
      documentsEmptyTitle: 'لا توجد مستندات',
      documentsEmptyDescription: 'لم تُرفق أي مستندات بعد.',
      approvalTitle: 'الاعتماد',
      approvalDescription: 'مهام سلسلة الاعتماد للرد.',
      approvalEmptyTitle: 'لا توجد مهام اعتماد',
      approvalEmptyDescription: 'ابدأ سلسلة الاعتماد لتوجيه الرد للاعتماد.',
      startApproval: 'بدء الاعتماد',
      approve: 'اعتماد',
      reject: 'رفض',
      auditTitle: 'سجل المراجعة',
      auditDescription: 'سجل حوكمة غير قابل للتعديل لكل إجراء.',
      auditEmptyTitle: 'لا توجد قيود مراجعة',
      auditEmptyDescription: 'لم تُسجَّل أي إجراءات بعد.',
    },
    dialogs: {
      classifyTitle: 'تصنيف الاستشارة',
      classifyDescription: 'تحديد نوع الموضوع والأولوية.',
      type: 'النوع',
      priority: 'الأولوية',
      routeTitle: 'توجيه الاستشارة',
      routeDescription: 'إسناد الاستشارة إلى مستشار.',
      advisor: 'المستشار',
      advisorPlaceholder: 'اختر مستشارًا',
      respondTitle: 'تسجيل الرد',
      respondDescription: 'تسجيل رد المستشار.',
      response: 'الرد',
      responsePlaceholder: 'الرد الاستشاري...',
      useAi: 'صياغة الرد الأول بالذكاء الاصطناعي',
      archiveTitle: 'أرشفة الاستشارة',
      archiveDescription: 'أرشفة هذه الاستشارة المعتمدة.',
      reason: 'السبب',
      reasonPlaceholder: 'سبب الأرشفة',
      attachTitle: 'إرفاق مستند',
      attachDescription: 'ربط ملف من خدمة الملفات بهذه الاستشارة.',
      fileId: 'معرّف الملف',
      fileIdPlaceholder: 'اختر ملفًا',
      fileName: 'اسم الملف',
      fileNamePlaceholder: 'document.pdf',
      fileSize: 'حجم الملف (بايت)',
      kind: 'النوع',
      kindPlaceholder: 'مرفق',
      approvalTitle: 'بدء الاعتماد',
      approvalDescription: 'توجيه الرد للاعتماد.',
      approverRole: 'دور المعتمِد',
      approverRolePlaceholder: 'legal_director',
      notes: 'ملاحظات',
      notesPlaceholder: 'ملاحظات اختيارية',
      submit: 'إرسال',
      cancel: 'إلغاء',
    },
    toast: {
      submitted: 'تم تقديم الاستشارة.',
      deleted: 'تم حذف الاستشارة.',
      classified: 'تم تصنيف الاستشارة.',
      routed: 'تم توجيه الاستشارة.',
      responded: 'تم تسجيل الرد.',
      archived: 'تمت أرشفة الاستشارة.',
      documentAttached: 'تم إرفاق المستند.',
      documentRemoved: 'تمت إزالة المستند.',
      approvalStarted: 'بدأت سلسلة الاعتماد.',
      approvalDecided: 'تم تطبيق القرار.',
    },
    confirm: {
      deleteTitle: 'حذف الاستشارة',
      deleteDescription: (title) =>
        `حذف "${title}"؟ سيؤدي ذلك إلى إزالتها من السجل النشط.`,
      removeDocumentTitle: 'إزالة المستند',
      removeDocumentDescription: (name) => `إزالة "${name}" من هذه الاستشارة؟`,
      confirm: 'تأكيد',
    },
  },
};

export function resolveConsultationLabels(
  locale: AppLocale = 'en',
): ConsultationLabels {
  return resolveLexBilingual(bundle, locale);
}

export function useConsultationLabels(): ConsultationLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveConsultationLabels(locale), [locale]);
}
