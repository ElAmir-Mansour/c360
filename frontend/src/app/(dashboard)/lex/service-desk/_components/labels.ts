"use client";

/**
 * Bilingual (English + Modern Standard Arabic) labels for the Legal Service Desk
 * (`/lex/service-desk`, CAP-001..031). Follows the canonical lex i18n contract:
 * a `LexBilingual<T> = { en, ar }` bundle with two full same-shaped copies,
 * resolved per locale by the `useServiceDeskLabels()` hook. JSX only ever touches
 * the resolved `T`. Status/priority enum maps are keyed by the RAW backend token
 * with identical key sets on both locales.
 */

import { useMemo } from "react";
import { useLocaleOrDefault } from "@/components/providers/locale-provider";
import type { AppLocale } from "@/lib/i18n";
import type { ReturnIncompleteReasonCode } from "@/lib/lex/requests";
import { type LexBilingual, resolveLexBilingual } from "../../_lib/lex-i18n";

export const REQUEST_PRIORITY_OPTIONS = [
  "emergency",
  "urgent",
  "normal",
] as const;

export const REQUEST_STATUS_OPTIONS = [
  "draft",
  "submitted",
  "pending_requester_approval",
  "pending_provider_approval",
  "approved",
  "routed",
  "in_execution",
  "delivered",
  "closed",
  "returned",
  "cancelled",
] as const;

export interface ServiceDeskLabels {
  // --- New request wizard ---
  wizard: {
    pageTitle: string;
    pageDescription: string;
    stepService: string;
    stepDetails: string;
    stepReview: string;
    stepOf: (current: number, total: number) => string;
    next: string;
    back: string;
    cancel: string;
    submit: string;
    submitting: string;
    selectServiceTitle: string;
    selectServiceDescription: string;
    eligibilityChecking: string;
    eligible: string;
    notEligible: string;
    eligibilityReasons: string;
    eligibilityRecheck: string;
    detailsTitle: string;
    detailsDescription: string;
    titleEn: string;
    titleAr: string;
    titlePlaceholderEn: string;
    titlePlaceholderAr: string;
    description: string;
    descriptionPlaceholder: string;
    requesterName: string;
    requesterNamePlaceholder: string;
    department: string;
    departmentPlaceholder: string;
    priority: string;
    urgencyJustification: string;
    urgencyJustificationHint: string;
    urgencyJustificationPlaceholder: string;
    reviewTitle: string;
    reviewDescription: string;
    reviewService: string;
    reviewPriority: string;
    reviewApprovals: string;
    requesterApproval: string;
    providerApproval: string;
    approvalRequired: string;
    approvalNotRequired: string;
    noService: string;
    errors: {
      serviceRequired: string;
      titleRequired: string;
      descriptionRequired: string;
      requesterRequired: string;
      urgencyRequired: string;
    };
    toast: { created: string; createError: string };
  };

  // --- My requests list ---
  list: {
    pageTitle: string;
    pageDescription: string;
    newRequest: string;
    searchPlaceholder: string;
    emptyTitle: string;
    emptyDescription: string;
    stats: {
      total: string;
      inExecution: string;
      urgent: string;
      awaitingApproval: string;
    };
    columns: {
      number: string;
      title: string;
      service: string;
      priority: string;
      status: string;
      updated: string;
    };
    filters: { status: string; priority: string };
    untitled: string;
  };

  // --- Request detail ---
  detail: {
    loadingTitle: string;
    fallbackDescription: string;
    errorMessage: string;
    notFoundTitle: string;
    notFoundMessage: string;
    backToList: string;
    edit: string;
    submitRequest: string;
    reclassify: string;
    delete: string;
    metricStatus: string;
    metricPriority: string;
    metricService: string;
    metricNumber: string;
    overviewTitle: string;
    overviewDescription: string;
    metaRequester: string;
    metaDepartment: string;
    metaType: string;
    metaRequesterApproval: string;
    metaProviderApproval: string;
    metaCreated: string;
    metaUpdated: string;
    notSet: string;
    yes: string;
    no: string;
    descriptionTitle: string;
    descriptionEmpty: string;
    urgencyTitle: string;
    urgencyEmpty: string;
    priorityHistoryTitle: string;
    priorityHistoryDescription: string;
    priorityHistoryEmpty: string;
    priorityChange: (from: string, to: string) => string;
  };

  // --- SLA panel ---
  sla: {
    title: string;
    description: string;
    none: string;
    ackLabel: string;
    ackDue: string;
    ackDone: string;
    ackPending: string;
    acknowledge: string;
    turnaroundLabel: string;
    turnaroundDue: string;
    escalationLabel: string;
    escalationLevel: (level: number) => string;
    noEscalation: string;
    outcomeLabel: string;
    breached: string;
    onTrack: string;
    elapsed: string;
    overdue: string;
    outcomeOptions: Record<string, string>;
    toast: { acknowledged: string };
  };

  // --- Approval panel ---
  approval: {
    title: string;
    description: string;
    notStarted: string;
    start: string;
    starting: string;
    tasksTitle: string;
    noTasks: string;
    approve: string;
    reject: string;
    deciding: string;
    decisionNotesLabel: string;
    decisionNotesPlaceholder: string;
    stageRequester: string;
    stageProvider: string;
    taskStatusLabel: string;
    slaDeadline: string;
    slaBreached: string;
    toast: { started: string; decided: string };
    confirmReject: { title: string; description: string; confirm: string };
    rejectReasonLabel: string;
    rejectReasonPlaceholder: string;
    rejectReasonRequired: string;
  };

  // --- Execution panel ---
  execution: {
    title: string;
    description: string;
    none: string;
    statusLabel: string;
    statusOptions: Record<string, string>;
    requirementsTitle: string;
    requirementsDescription: string;
    requirementsEmpty: string;
    addRequirement: string;
    markSatisfied: string;
    markUnsatisfied: string;
    removeRequirement: string;
    requirementSatisfied: string;
    requirementPending: string;
    requirementRequired: string;
    requirementOptional: string;
    kindAttachment: string;
    kindData: string;
    completenessLabel: string;
    completenessConfirmed: string;
    completenessPending: string;
    confirmCompleteness: string;
    confirmCompletenessHint: string;
    returnIncomplete: string;
    returnIncompleteHint: string;
    reviewRoundsTitle: string;
    reviewRoundsDescription: string;
    reviewRoundsEmpty: string;
    roundNo: (n: number) => string;
    roundOpen: string;
    roundOutcome: Record<string, string>;
    reviewRoundLeft: (n: number) => string;
    deliveryTitle: string;
    deliveryDescription: string;
    contractDeliveryDescription: string;
    deliveryEmpty: string;
    requestDelivery: string;
    requestContractHandover: string;
    deliveryRespond: string;
    addFinalNotes: string;
    deliveryNote: string;
    deliveryConfirm: string;
    deliveryDeny: string;
    deliveryAutoClose: string;
    awaitingAssociateAchievement: string;
    associateAchievedAwaitingRequester: string;
    achieveContract: string;
    deliveryStatus: Record<string, string>;
    toast: {
      requirementAdded: string;
      requirementUpdated: string;
      requirementRemoved: string;
      completenessConfirmed: string;
      returnedIncomplete: string;
      deliveryRequested: string;
      contractHandoverRecorded: string;
      deliveryResponded: string;
      contractAchieved: string;
    };
    confirmRemove: { title: string; description: string; confirm: string };
  };

  // --- Dialogs ---
  addRequirementDialog: {
    title: string;
    description: string;
    code: string;
    codePlaceholder: string;
    labelEn: string;
    labelAr: string;
    kind: string;
    required: string;
    cancel: string;
    save: string;
    errors: { codeRequired: string; labelRequired: string };
  };
  completenessDialog: {
    title: string;
    description: string;
    notes: string;
    notesPlaceholder: string;
    cancel: string;
    confirm: string;
  };
  returnDialog: {
    title: string;
    description: string;
    reason: string;
    reasons: Record<ReturnIncompleteReasonCode, string>;
    details: string;
    reasonPlaceholder: string;
    cancel: string;
    confirm: string;
    errors: { reasonRequired: string };
  };
  deliveryRequestDialog: {
    title: string;
    contractTitle: string;
    description: string;
    contractDescription: string;
    recipientName: string;
    recipientNamePlaceholder: string;
    recipientContact: string;
    recipientContactPlaceholder: string;
    notes: string;
    cancel: string;
    confirm: string;
    contractConfirm: string;
    errors: { recipientRequired: string };
  };
  deliveryRespondDialog: {
    title: string;
    description: string;
    contractTitle: string;
    contractDescription: string;
    note: string;
    notePlaceholder: string;
    finalNote: string;
    finalNotePlaceholder: string;
    cancel: string;
    confirm: string;
    submitFinalNotes: string;
    deny: string;
    errors: { finalNoteRequired: string };
  };
  reclassifyDialog: {
    title: string;
    description: string;
    priority: string;
    reason: string;
    reasonPlaceholder: string;
    urgencyJustification: string;
    urgencyJustificationPlaceholder: string;
    cancel: string;
    save: string;
    errors: { reasonRequired: string; urgencyRequired: string };
  };
  editDialog: {
    title: string;
    description: string;
    titleEn: string;
    titleAr: string;
    requestDescription: string;
    requesterName: string;
    department: string;
    cancel: string;
    save: string;
    errors: { titleRequired: string };
    toast: { updated: string };
  };
  submitDialog: {
    title: string;
    description: string;
    notes: string;
    notesPlaceholder: string;
    cancel: string;
    confirm: string;
  };

  confirm: {
    deleteTitle: string;
    deleteDescription: (title: string) => string;
    deleteConfirm: string;
  };

  priorityOptions: Record<string, string>;
  statusOptions: Record<string, string>;
}

const bundle: LexBilingual<ServiceDeskLabels> = {
  en: {
    wizard: {
      pageTitle: "New Legal Request",
      pageDescription:
        "Submit a request to the legal department through the service catalog.",
      stepService: "Service",
      stepDetails: "Details",
      stepReview: "Review",
      stepOf: (current, total) => `Step ${current} of ${total}`,
      next: "Next",
      back: "Back",
      cancel: "Cancel",
      submit: "Submit request",
      submitting: "Submitting...",
      selectServiceTitle: "Choose a service",
      selectServiceDescription:
        "Select the legal service you need. Eligibility is checked automatically.",
      eligibilityChecking: "Checking eligibility...",
      eligible: "You are eligible for this service.",
      notEligible: "You are not eligible for this service.",
      eligibilityReasons: "Reasons",
      eligibilityRecheck: "Re-check",
      detailsTitle: "Request details",
      detailsDescription:
        "Describe what you need. Bilingual titles keep the request searchable in both languages.",
      titleEn: "Title (English)",
      titleAr: "Title (Arabic)",
      titlePlaceholderEn: "Contract review for vendor X",
      titlePlaceholderAr: "مراجعة عقد المورّد س",
      description: "Description",
      descriptionPlaceholder:
        "Provide the relevant context and what you expect from the legal team.",
      requesterName: "Requester name",
      requesterNamePlaceholder: "Full name",
      department: "Department",
      departmentPlaceholder: "e.g. Procurement",
      priority: "Priority",
      urgencyJustification: "Urgency justification",
      urgencyJustificationHint:
        "Required for urgent requests. Explain the business impact (not requester delay).",
      urgencyJustificationPlaceholder:
        "Regulatory deadline on ... requires urgent handling.",
      reviewTitle: "Review and submit",
      reviewDescription:
        "Confirm the details before submitting to the legal department.",
      reviewService: "Service",
      reviewPriority: "Priority",
      reviewApprovals: "Required approvals",
      requesterApproval: "Requester approval",
      providerApproval: "Provider approval",
      approvalRequired: "Required",
      approvalNotRequired: "Not required",
      noService: "No service selected",
      errors: {
        serviceRequired: "Please select a service.",
        titleRequired: "A request title is required.",
        descriptionRequired: "A request description is required.",
        requesterRequired: "Requester name is required.",
        urgencyRequired: "Urgent requests require a justification.",
      },
      toast: {
        created: "Request submitted.",
        createError: "Could not submit the request.",
      },
    },
    list: {
      pageTitle: "My Requests",
      pageDescription:
        "Track your legal requests, their status and SLA position.",
      newRequest: "New request",
      searchPlaceholder: "Search requests...",
      emptyTitle: "No requests yet",
      emptyDescription: "No legal requests matched the current filters.",
      stats: {
        total: "Total",
        inExecution: "In execution",
        urgent: "Urgent",
        awaitingApproval: "Awaiting approval",
      },
      columns: {
        number: "Number",
        title: "Request",
        service: "Service",
        priority: "Priority",
        status: "Status",
        updated: "Updated",
      },
      filters: { status: "Status", priority: "Priority" },
      untitled: "Untitled request",
    },
    detail: {
      loadingTitle: "Request",
      fallbackDescription: "Legal service request.",
      errorMessage: "Failed to load the request.",
      notFoundTitle: "Request not found",
      notFoundMessage:
        "This request doesn’t exist or was removed. It may have been deleted, or the link is out of date.",
      backToList: "Back to Service Desk",
      edit: "Edit",
      submitRequest: "Submit",
      reclassify: "Reclassify priority",
      delete: "Delete",
      metricStatus: "Status",
      metricPriority: "Priority",
      metricService: "Service",
      metricNumber: "Number",
      overviewTitle: "Request overview",
      overviewDescription: "Core request state and intake context.",
      metaRequester: "Requester",
      metaDepartment: "Department",
      metaType: "Request type",
      metaRequesterApproval: "Requester approval",
      metaProviderApproval: "Provider approval",
      metaCreated: "Created",
      metaUpdated: "Updated",
      notSet: "Not set",
      yes: "Required",
      no: "Not required",
      descriptionTitle: "Description",
      descriptionEmpty: "No description provided.",
      urgencyTitle: "Urgency justification",
      urgencyEmpty: "No urgency justification recorded.",
      priorityHistoryTitle: "Priority history",
      priorityHistoryDescription:
        "Audited reclassifications between urgent and normal.",
      priorityHistoryEmpty: "No priority changes recorded.",
      priorityChange: (from, to) => `${from} → ${to}`,
    },
    sla: {
      title: "SLA clock",
      description: "Acknowledgement, turnaround and escalation deadlines.",
      none: "The SLA clock has not started yet.",
      ackLabel: "Acknowledgement",
      ackDue: "Acknowledge by",
      ackDone: "Acknowledged",
      ackPending: "Pending acknowledgement",
      acknowledge: "Acknowledge",
      turnaroundLabel: "Turnaround",
      turnaroundDue: "Deliver by",
      escalationLabel: "Escalation",
      escalationLevel: (level) => `Level ${level}`,
      noEscalation: "No escalation",
      outcomeLabel: "Outcome",
      breached: "Breached",
      onTrack: "On track",
      elapsed: "Started",
      overdue: "Overdue",
      outcomeOptions: {
        pending: "Pending",
        on_time: "On time",
        breached: "Breached",
      },
      toast: { acknowledged: "Request acknowledged." },
    },
    approval: {
      title: "Approval chain",
      description: "Two-stage requester then provider approval.",
      notStarted: "No approval workflow has been started for this request.",
      start: "Start approval",
      starting: "Starting...",
      tasksTitle: "Open approval tasks",
      noTasks: "There are no open approval tasks.",
      approve: "Approve",
      reject: "Reject",
      deciding: "Submitting...",
      decisionNotesLabel: "Decision notes",
      decisionNotesPlaceholder: "Optional notes for the decision.",
      stageRequester: "Requester stage",
      stageProvider: "Provider stage",
      taskStatusLabel: "Status",
      slaDeadline: "SLA deadline",
      slaBreached: "SLA breached",
      toast: { started: "Approval started.", decided: "Decision recorded." },
      confirmReject: {
        title: "Reject approval task",
        description:
          "This records a rejection on the current approval task. Continue?",
        confirm: "Reject",
      },
      rejectReasonLabel: "Return reason",
      rejectReasonPlaceholder: "Select a return reason",
      rejectReasonRequired: "Select a return reason.",
    },
    execution: {
      title: "Execution",
      description:
        "Requirements completeness, review rounds and delivery confirmation.",
      none: "This request has not entered execution yet.",
      statusLabel: "Execution status",
      statusOptions: {
        awaiting_completeness: "Awaiting completeness",
        in_progress: "In progress",
        delivered: "Delivered",
        returned: "Returned",
        auto_closed: "Auto-closed",
        closed: "Closed",
      },
      requirementsTitle: "Requirements checklist",
      requirementsDescription:
        "Every required item must be satisfied before the execution clock starts.",
      requirementsEmpty: "No requirement items.",
      addRequirement: "Add requirement",
      markSatisfied: "Mark satisfied",
      markUnsatisfied: "Mark pending",
      removeRequirement: "Remove",
      requirementSatisfied: "Satisfied",
      requirementPending: "Pending",
      requirementRequired: "Required",
      requirementOptional: "Optional",
      kindAttachment: "Attachment",
      kindData: "Data",
      completenessLabel: "Completeness",
      completenessConfirmed: "Confirmed complete",
      completenessPending: "Not yet confirmed",
      confirmCompleteness: "Confirm completeness",
      confirmCompletenessHint:
        "Starts the execution clock once all required items are satisfied.",
      returnIncomplete: "Return incomplete",
      returnIncompleteHint:
        "Add a requirement describing what's missing before returning — a return must cite an unmet requirement the requester can act on.",
      reviewRoundsTitle: "Review rounds",
      reviewRoundsDescription:
        "Return-incomplete cycles. After the second return the request auto-closes.",
      reviewRoundsEmpty: "No review rounds.",
      roundNo: (n) => `Round ${n}`,
      roundOpen: "Open",
      roundOutcome: {
        accepted: "Accepted",
        returned: "Returned",
        auto_closed: "Auto-closed",
      },
      reviewRoundLeft: (n) => `${n} review round(s) remaining`,
      deliveryTitle: "Delivery confirmation",
      deliveryDescription:
        "Requester confirms or denies delivery; auto-closes after the deadline.",
      contractDeliveryDescription:
        "The contracts associate marks the legal work achieved, but the request stays open until its requester adds final delivery notes and closes it.",
      deliveryEmpty: "No delivery confirmation has been requested.",
      requestDelivery: "Record delivery",
      requestContractHandover: "Record legal handover",
      deliveryRespond: "Respond",
      addFinalNotes: "Add final notes & close",
      deliveryNote: "Delivery note",
      deliveryConfirm: "Confirm delivery",
      deliveryDeny: "Deny",
      deliveryAutoClose: "Auto-closes",
      awaitingAssociateAchievement:
        "Waiting for a contracts associate to mark the legal work achieved. The request will not auto-close.",
      associateAchievedAwaitingRequester:
        "Legal work achieved. Waiting for the requester’s final delivery note and closing action.",
      achieveContract: "Mark legal work achieved",
      deliveryStatus: {
        requested: "Requested",
        confirmed: "Confirmed",
        achieved: "Legal work achieved",
        denied: "Denied",
        expired: "Expired",
      },
      toast: {
        requirementAdded: "Requirement added.",
        requirementUpdated: "Requirement updated.",
        requirementRemoved: "Requirement removed.",
        completenessConfirmed: "Completeness confirmed.",
        returnedIncomplete: "Request returned as incomplete.",
        deliveryRequested: "Delivery recorded and confirmation requested.",
        contractHandoverRecorded:
          "Legal handover recorded. Mark the legal work achieved when ready.",
        deliveryResponded: "Response recorded.",
        contractAchieved:
          "Legal work marked achieved. The request remains open for the requester.",
      },
      confirmRemove: {
        title: "Remove requirement",
        description: "Remove this requirement item from the checklist?",
        confirm: "Remove",
      },
    },
    addRequirementDialog: {
      title: "Add requirement",
      description: "Add a required attachment or data item to the checklist.",
      code: "Code",
      codePlaceholder: "e.g. signed_nda",
      labelEn: "Label (English)",
      labelAr: "Label (Arabic)",
      kind: "Kind",
      required: "Required",
      cancel: "Cancel",
      save: "Add",
      errors: {
        codeRequired: "A code is required.",
        labelRequired: "A label is required.",
      },
    },
    completenessDialog: {
      title: "Confirm completeness",
      description:
        "Confirm that all required items are satisfied. This starts the execution clock.",
      notes: "Notes",
      notesPlaceholder: "Optional notes.",
      cancel: "Cancel",
      confirm: "Confirm completeness",
    },
    returnDialog: {
      title: "Return incomplete",
      description:
        "Select the documented deficiency, then add any useful detail.",
      reason: "Deficiency reason",
      reasons: {
        missing_information: "Complete missing information",
        doa_non_compliance:
          "Non-compliance with the Delegation of Authority (DOA) matrix",
        incomplete_referral_procedures:
          "Failure to complete the referral procedures",
        invalid_attachments: "Invalidity of attached documents",
      },
      details: "Additional details",
      reasonPlaceholder: "Optional context for the requester.",
      cancel: "Cancel",
      confirm: "Return incomplete",
      errors: { reasonRequired: "Select a deficiency reason." },
    },
    deliveryRequestDialog: {
      title: "Record delivery",
      contractTitle: "Record legal handover",
      description:
        "Record the completed work as delivered and ask the requester to confirm receipt. A working-hour deadline is applied automatically.",
      contractDescription:
        "Record the contract team’s completed legal work for handover. This does not close or deliver the contract; a contract editor must mark the legal work achieved before the requester can add final notes and close it.",
      recipientName: "Recipient name",
      recipientNamePlaceholder: "Full name",
      recipientContact: "Recipient contact",
      recipientContactPlaceholder: "Email or phone",
      notes: "Notes",
      cancel: "Cancel",
      confirm: "Record delivery",
      contractConfirm: "Record legal handover",
      errors: { recipientRequired: "A recipient name is required." },
    },
    deliveryRespondDialog: {
      title: "Respond to delivery confirmation",
      description: "Confirm or deny that the request was delivered.",
      contractTitle: "Add final delivery notes",
      contractDescription:
        "The contracts team has marked its legal work achieved. Add your final delivery notes after signature to close this request.",
      note: "Note",
      notePlaceholder: "Optional note.",
      finalNote: "Final delivery notes",
      finalNotePlaceholder:
        "Record your final comments about the delivered contract work.",
      cancel: "Cancel",
      confirm: "Confirm delivery",
      submitFinalNotes: "Submit notes & close",
      deny: "Deny",
      errors: { finalNoteRequired: "Final delivery notes are required." },
    },
    reclassifyDialog: {
      title: "Reclassify priority",
      description:
        "Change the request priority. Moving to urgent requires a justification.",
      priority: "New priority",
      reason: "Reason",
      reasonPlaceholder: "Why is the priority changing?",
      urgencyJustification: "Urgency justification",
      urgencyJustificationPlaceholder:
        "Business impact requiring urgent handling.",
      cancel: "Cancel",
      save: "Reclassify",
      errors: {
        reasonRequired: "A reason is required.",
        urgencyRequired: "Urgent priority requires a justification.",
      },
    },
    editDialog: {
      title: "Edit request",
      description:
        "Update request metadata. Status and priority changes use dedicated actions.",
      titleEn: "Title (English)",
      titleAr: "Title (Arabic)",
      requestDescription: "Description",
      requesterName: "Requester name",
      department: "Department",
      cancel: "Cancel",
      save: "Save changes",
      errors: { titleRequired: "A request title is required." },
      toast: { updated: "Request updated." },
    },
    submitDialog: {
      title: "Submit request",
      description: "Submit the draft request to the legal department.",
      notes: "Notes",
      notesPlaceholder: "Optional notes recorded on submission.",
      cancel: "Cancel",
      confirm: "Submit",
    },
    confirm: {
      deleteTitle: "Delete request",
      deleteDescription: (title) =>
        `Delete "${title}"? This removes it from the active register.`,
      deleteConfirm: "Delete",
    },
    priorityOptions: {
      normal: "Normal",
      urgent: "Urgent",
      emergency: "Emergency",
    },
    statusOptions: {
      draft: "Draft",
      submitted: "Submitted",
      pending_requester_approval: "Pending requester approval",
      pending_provider_approval: "Pending provider approval",
      approved: "Approved",
      routed: "Routed",
      in_execution: "In execution",
      delivered: "Delivered",
      closed: "Closed",
      returned: "Returned",
      cancelled: "Cancelled",
    },
  },
  ar: {
    wizard: {
      pageTitle: "طلب قانوني جديد",
      pageDescription:
        "قدّم طلبًا إلى الإدارة القانونية من خلال كتالوج الخدمات.",
      stepService: "الخدمة",
      stepDetails: "التفاصيل",
      stepReview: "المراجعة",
      stepOf: (current, total) => `الخطوة ${current} من ${total}`,
      next: "التالي",
      back: "السابق",
      cancel: "إلغاء",
      submit: "تقديم الطلب",
      submitting: "جارٍ التقديم...",
      selectServiceTitle: "اختر خدمة",
      selectServiceDescription:
        "اختر الخدمة القانونية التي تحتاجها. يتم التحقق من الأهلية تلقائيًا.",
      eligibilityChecking: "جارٍ التحقق من الأهلية...",
      eligible: "أنت مؤهّل لهذه الخدمة.",
      notEligible: "أنت غير مؤهّل لهذه الخدمة.",
      eligibilityReasons: "الأسباب",
      eligibilityRecheck: "إعادة التحقق",
      detailsTitle: "تفاصيل الطلب",
      detailsDescription:
        "صِف ما تحتاجه. العناوين ثنائية اللغة تُبقي الطلب قابلًا للبحث باللغتين.",
      titleEn: "العنوان (إنجليزي)",
      titleAr: "العنوان (عربي)",
      titlePlaceholderEn: "Contract review for vendor X",
      titlePlaceholderAr: "مراجعة عقد المورّد س",
      description: "الوصف",
      descriptionPlaceholder:
        "قدّم السياق ذا الصلة وما تتوقعه من الفريق القانوني.",
      requesterName: "اسم مقدّم الطلب",
      requesterNamePlaceholder: "الاسم الكامل",
      department: "الإدارة",
      departmentPlaceholder: "مثال: المشتريات",
      priority: "الأولوية",
      urgencyJustification: "مبرّر الاستعجال",
      urgencyJustificationHint:
        "مطلوب للطلبات العاجلة. وضّح الأثر على العمل (وليس تأخّر مقدّم الطلب).",
      urgencyJustificationPlaceholder:
        "موعد تنظيمي نهائي في ... يستلزم معالجة عاجلة.",
      reviewTitle: "المراجعة والتقديم",
      reviewDescription: "تأكّد من التفاصيل قبل التقديم إلى الإدارة القانونية.",
      reviewService: "الخدمة",
      reviewPriority: "الأولوية",
      reviewApprovals: "الموافقات المطلوبة",
      requesterApproval: "موافقة مقدّم الطلب",
      providerApproval: "موافقة مقدّم الخدمة",
      approvalRequired: "مطلوبة",
      approvalNotRequired: "غير مطلوبة",
      noService: "لم يتم اختيار خدمة",
      errors: {
        serviceRequired: "يرجى اختيار خدمة.",
        titleRequired: "عنوان الطلب مطلوب.",
        descriptionRequired: "وصف الطلب مطلوب.",
        requesterRequired: "اسم مقدّم الطلب مطلوب.",
        urgencyRequired: "الطلبات العاجلة تتطلّب مبرّرًا.",
      },
      toast: { created: "تم تقديم الطلب.", createError: "تعذّر تقديم الطلب." },
    },
    list: {
      pageTitle: "طلباتي",
      pageDescription:
        "تابع طلباتك القانونية وحالتها وموقعها ضمن اتفاقية مستوى الخدمة.",
      newRequest: "طلب جديد",
      searchPlaceholder: "البحث في الطلبات...",
      emptyTitle: "لا توجد طلبات بعد",
      emptyDescription: "لا توجد طلبات قانونية مطابقة للمرشّحات الحالية.",
      stats: {
        total: "الإجمالي",
        inExecution: "قيد التنفيذ",
        urgent: "عاجلة",
        awaitingApproval: "بانتظار الموافقة",
      },
      columns: {
        number: "الرقم",
        title: "الطلب",
        service: "الخدمة",
        priority: "الأولوية",
        status: "الحالة",
        updated: "آخر تحديث",
      },
      filters: { status: "الحالة", priority: "الأولوية" },
      untitled: "طلب بدون عنوان",
    },
    detail: {
      loadingTitle: "الطلب",
      fallbackDescription: "طلب خدمة قانونية.",
      errorMessage: "تعذّر تحميل الطلب.",
      notFoundTitle: "الطلب غير موجود",
      notFoundMessage:
        "هذا الطلب غير موجود أو تمت إزالته. ربما تم حذفه أو أن الرابط لم يعد صالحًا.",
      backToList: "العودة إلى مكتب الخدمة",
      edit: "تعديل",
      submitRequest: "تقديم",
      reclassify: "إعادة تصنيف الأولوية",
      delete: "حذف",
      metricStatus: "الحالة",
      metricPriority: "الأولوية",
      metricService: "الخدمة",
      metricNumber: "الرقم",
      overviewTitle: "نظرة عامة على الطلب",
      overviewDescription: "الحالة الأساسية للطلب وسياق الاستقبال.",
      metaRequester: "مقدّم الطلب",
      metaDepartment: "الإدارة",
      metaType: "نوع الطلب",
      metaRequesterApproval: "موافقة مقدّم الطلب",
      metaProviderApproval: "موافقة مقدّم الخدمة",
      metaCreated: "تاريخ الإنشاء",
      metaUpdated: "آخر تحديث",
      notSet: "غير محدّد",
      yes: "مطلوبة",
      no: "غير مطلوبة",
      descriptionTitle: "الوصف",
      descriptionEmpty: "لا يوجد وصف.",
      urgencyTitle: "مبرّر الاستعجال",
      urgencyEmpty: "لم يُسجّل مبرّر استعجال.",
      priorityHistoryTitle: "سجلّ الأولوية",
      priorityHistoryDescription:
        "عمليات إعادة التصنيف المدقّقة بين العاجل والعادي.",
      priorityHistoryEmpty: "لا توجد تغييرات في الأولوية.",
      priorityChange: (from, to) => `${from} ← ${to}`,
    },
    sla: {
      title: "مؤقّت اتفاقية مستوى الخدمة",
      description: "مواعيد الإقرار والإنجاز والتصعيد.",
      none: "لم يبدأ مؤقّت اتفاقية مستوى الخدمة بعد.",
      ackLabel: "الإقرار",
      ackDue: "الإقرار قبل",
      ackDone: "تم الإقرار",
      ackPending: "بانتظار الإقرار",
      acknowledge: "إقرار",
      turnaroundLabel: "الإنجاز",
      turnaroundDue: "التسليم قبل",
      escalationLabel: "التصعيد",
      escalationLevel: (level) => `المستوى ${level}`,
      noEscalation: "لا يوجد تصعيد",
      outcomeLabel: "النتيجة",
      breached: "تم الإخلال",
      onTrack: "ضمن المسار",
      elapsed: "بدأ",
      overdue: "متأخّر",
      outcomeOptions: {
        pending: "قيد الانتظار",
        on_time: "في الوقت المحدّد",
        breached: "مُخلّ به",
      },
      toast: { acknowledged: "تم إقرار الطلب." },
    },
    approval: {
      title: "سلسلة الموافقات",
      description: "موافقة من مرحلتين: مقدّم الطلب ثم مقدّم الخدمة.",
      notStarted: "لم تبدأ أي دورة موافقة لهذا الطلب.",
      start: "بدء الموافقة",
      starting: "جارٍ البدء...",
      tasksTitle: "مهام الموافقة المفتوحة",
      noTasks: "لا توجد مهام موافقة مفتوحة.",
      approve: "اعتماد",
      reject: "رفض",
      deciding: "جارٍ الإرسال...",
      decisionNotesLabel: "ملاحظات القرار",
      decisionNotesPlaceholder: "ملاحظات اختيارية للقرار.",
      stageRequester: "مرحلة مقدّم الطلب",
      stageProvider: "مرحلة مقدّم الخدمة",
      taskStatusLabel: "الحالة",
      slaDeadline: "موعد اتفاقية مستوى الخدمة",
      slaBreached: "تم الإخلال باتفاقية مستوى الخدمة",
      toast: { started: "بدأت الموافقة.", decided: "تم تسجيل القرار." },
      confirmReject: {
        title: "رفض مهمة الموافقة",
        description:
          "سيؤدي ذلك إلى تسجيل رفض على مهمة الموافقة الحالية. هل تريد المتابعة؟",
        confirm: "رفض",
      },
      rejectReasonLabel: "سبب الإعادة",
      rejectReasonPlaceholder: "اختر سبب الإعادة",
      rejectReasonRequired: "اختر سبب الإعادة.",
    },
    execution: {
      title: "التنفيذ",
      description: "اكتمال المتطلّبات ودورات المراجعة وتأكيد التسليم.",
      none: "لم يدخل هذا الطلب مرحلة التنفيذ بعد.",
      statusLabel: "حالة التنفيذ",
      statusOptions: {
        awaiting_completeness: "بانتظار الاكتمال",
        in_progress: "قيد التنفيذ",
        delivered: "تم التسليم",
        returned: "مُعاد",
        auto_closed: "مغلق تلقائيًا",
        closed: "مغلق",
      },
      requirementsTitle: "قائمة المتطلّبات",
      requirementsDescription:
        "يجب استيفاء كل عنصر مطلوب قبل بدء مؤقّت التنفيذ.",
      requirementsEmpty: "لا توجد عناصر متطلّبات.",
      addRequirement: "إضافة متطلّب",
      markSatisfied: "وضع علامة مُستوفى",
      markUnsatisfied: "وضع علامة معلّق",
      removeRequirement: "إزالة",
      requirementSatisfied: "مُستوفى",
      requirementPending: "معلّق",
      requirementRequired: "مطلوب",
      requirementOptional: "اختياري",
      kindAttachment: "مرفق",
      kindData: "بيانات",
      completenessLabel: "الاكتمال",
      completenessConfirmed: "تم تأكيد الاكتمال",
      completenessPending: "لم يتم التأكيد بعد",
      confirmCompleteness: "تأكيد الاكتمال",
      confirmCompletenessHint:
        "يبدأ مؤقّت التنفيذ بمجرد استيفاء كل العناصر المطلوبة.",
      returnIncomplete: "إعادة كغير مكتمل",
      returnIncompleteHint:
        "أضف متطلبًا يوضّح ما هو ناقص قبل الإعادة — يجب أن تستند الإعادة إلى متطلب غير مُستوفى يمكن لمقدّم الطلب معالجته.",
      reviewRoundsTitle: "دورات المراجعة",
      reviewRoundsDescription:
        "دورات الإعادة كغير مكتمل. بعد الإعادة الثانية يُغلق الطلب تلقائيًا.",
      reviewRoundsEmpty: "لا توجد دورات مراجعة.",
      roundNo: (n) => `الدورة ${n}`,
      roundOpen: "مفتوحة",
      roundOutcome: {
        accepted: "مقبولة",
        returned: "مُعادة",
        auto_closed: "مغلقة تلقائيًا",
      },
      reviewRoundLeft: (n) => `يتبقّى ${n} من دورات المراجعة`,
      deliveryTitle: "تأكيد التسليم",
      deliveryDescription:
        "يؤكّد مقدّم الطلب التسليم أو ينفيه؛ ويُغلق تلقائيًا بعد الموعد النهائي.",
      contractDeliveryDescription:
        "يضع موظف العقود علامة إنجاز العمل القانوني، لكن يبقى الطلب مفتوحًا حتى يضيف مقدّم الطلب ملاحظات التسليم النهائية ويغلقه.",
      deliveryEmpty: "لم يُطلب أي تأكيد تسليم.",
      requestDelivery: "تسجيل التسليم",
      requestContractHandover: "تسجيل تسليم العمل القانوني",
      deliveryRespond: "الردّ",
      addFinalNotes: "إضافة الملاحظات النهائية والإغلاق",
      deliveryNote: "ملاحظة التسليم",
      deliveryConfirm: "تأكيد التسليم",
      deliveryDeny: "نفي",
      deliveryAutoClose: "الإغلاق التلقائي",
      awaitingAssociateAchievement:
        "بانتظار موظف العقود لوضع علامة إنجاز العمل القانوني. لن يُغلق الطلب تلقائيًا.",
      associateAchievedAwaitingRequester:
        "تم إنجاز العمل القانوني. بانتظار ملاحظات التسليم النهائية وإجراء الإغلاق من مقدّم الطلب.",
      achieveContract: "وضع علامة إنجاز العمل القانوني",
      deliveryStatus: {
        requested: "مطلوب",
        confirmed: "مؤكّد",
        achieved: "تم إنجاز العمل القانوني",
        denied: "منفي",
        expired: "منتهٍ",
      },
      toast: {
        requirementAdded: "تمت إضافة المتطلّب.",
        requirementUpdated: "تم تحديث المتطلّب.",
        requirementRemoved: "تمت إزالة المتطلّب.",
        completenessConfirmed: "تم تأكيد الاكتمال.",
        returnedIncomplete: "تمت إعادة الطلب كغير مكتمل.",
        deliveryRequested: "تم تسجيل التسليم وطلب التأكيد.",
        contractHandoverRecorded:
          "تم تسجيل تسليم العمل القانوني. ضع علامة الإنجاز عندما يصبح العمل جاهزًا.",
        deliveryResponded: "تم تسجيل الردّ.",
        contractAchieved:
          "تم وضع علامة إنجاز العمل القانوني. يبقى الطلب مفتوحًا لمقدّم الطلب.",
      },
      confirmRemove: {
        title: "إزالة المتطلّب",
        description: "إزالة عنصر المتطلّب هذا من القائمة؟",
        confirm: "إزالة",
      },
    },
    addRequirementDialog: {
      title: "إضافة متطلّب",
      description: "أضف مرفقًا مطلوبًا أو عنصر بيانات إلى القائمة.",
      code: "الرمز",
      codePlaceholder: "مثال: signed_nda",
      labelEn: "التسمية (إنجليزي)",
      labelAr: "التسمية (عربي)",
      kind: "النوع",
      required: "مطلوب",
      cancel: "إلغاء",
      save: "إضافة",
      errors: {
        codeRequired: "الرمز مطلوب.",
        labelRequired: "التسمية مطلوبة.",
      },
    },
    completenessDialog: {
      title: "تأكيد الاكتمال",
      description:
        "أكّد أن كل العناصر المطلوبة مُستوفاة. سيبدأ هذا مؤقّت التنفيذ.",
      notes: "ملاحظات",
      notesPlaceholder: "ملاحظات اختيارية.",
      cancel: "إلغاء",
      confirm: "تأكيد الاكتمال",
    },
    returnDialog: {
      title: "إعادة كغير مكتمل",
      description: "اختر سبب النقص المعتمد، ثم أضف أي تفاصيل مفيدة.",
      reason: "سبب النقص",
      reasons: {
        missing_information: "معلومات ناقصة",
        doa_non_compliance: "عدم الامتثال لمصفوفة الصلاحيات",
        incomplete_referral_procedures: "إجراءات الإحالة غير مكتملة",
        invalid_attachments: "مرفقات غير صالحة",
      },
      details: "تفاصيل إضافية",
      reasonPlaceholder: "سياق اختياري لمقدّم الطلب.",
      cancel: "إلغاء",
      confirm: "إعادة كغير مكتمل",
      errors: { reasonRequired: "اختر سبب النقص." },
    },
    deliveryRequestDialog: {
      title: "تسجيل التسليم",
      contractTitle: "تسجيل تسليم العمل القانوني",
      description:
        "سجّل العمل المكتمل كمُسلَّم واطلب من مقدّم الطلب تأكيد الاستلام. يُطبَّق موعد نهائي بساعات العمل تلقائيًا.",
      contractDescription:
        "سجّل اكتمال العمل القانوني لفريق العقود بغرض التسليم. هذا لا يغلق الطلب ولا يعني تسليم العقد؛ يجب أن يضع محرر العقود علامة إنجاز العمل قبل أن يضيف مقدّم الطلب ملاحظاته النهائية ويغلقه.",
      recipientName: "اسم المستلم",
      recipientNamePlaceholder: "الاسم الكامل",
      recipientContact: "وسيلة التواصل مع المستلم",
      recipientContactPlaceholder: "بريد إلكتروني أو هاتف",
      notes: "ملاحظات",
      cancel: "إلغاء",
      confirm: "تسجيل التسليم",
      contractConfirm: "تسجيل تسليم العمل القانوني",
      errors: { recipientRequired: "اسم المستلم مطلوب." },
    },
    deliveryRespondDialog: {
      title: "الردّ على تأكيد التسليم",
      description: "أكّد أو انفِ أن الطلب قد تم تسليمه.",
      contractTitle: "إضافة ملاحظات التسليم النهائية",
      contractDescription:
        "وضع فريق العقود علامة إنجاز العمل القانوني. أضف ملاحظات التسليم النهائية بعد التوقيع لإغلاق هذا الطلب.",
      note: "ملاحظة",
      notePlaceholder: "ملاحظة اختيارية.",
      finalNote: "ملاحظات التسليم النهائية",
      finalNotePlaceholder:
        "دوّن ملاحظاتك النهائية حول أعمال العقد المُسلَّمة.",
      cancel: "إلغاء",
      confirm: "تأكيد التسليم",
      submitFinalNotes: "إرسال الملاحظات والإغلاق",
      deny: "نفي",
      errors: { finalNoteRequired: "ملاحظات التسليم النهائية مطلوبة." },
    },
    reclassifyDialog: {
      title: "إعادة تصنيف الأولوية",
      description: "غيّر أولوية الطلب. الانتقال إلى عاجل يتطلّب مبرّرًا.",
      priority: "الأولوية الجديدة",
      reason: "السبب",
      reasonPlaceholder: "لماذا تتغيّر الأولوية؟",
      urgencyJustification: "مبرّر الاستعجال",
      urgencyJustificationPlaceholder:
        "الأثر على العمل الذي يستلزم معالجة عاجلة.",
      cancel: "إلغاء",
      save: "إعادة التصنيف",
      errors: {
        reasonRequired: "السبب مطلوب.",
        urgencyRequired: "الأولوية العاجلة تتطلّب مبرّرًا.",
      },
    },
    editDialog: {
      title: "تعديل الطلب",
      description:
        "حدّث بيانات الطلب. تغييرات الحالة والأولوية تستخدم إجراءات مخصّصة.",
      titleEn: "العنوان (إنجليزي)",
      titleAr: "العنوان (عربي)",
      requestDescription: "الوصف",
      requesterName: "اسم مقدّم الطلب",
      department: "الإدارة",
      cancel: "إلغاء",
      save: "حفظ التغييرات",
      errors: { titleRequired: "عنوان الطلب مطلوب." },
      toast: { updated: "تم تحديث الطلب." },
    },
    submitDialog: {
      title: "تقديم الطلب",
      description: "قدّم مسوّدة الطلب إلى الإدارة القانونية.",
      notes: "ملاحظات",
      notesPlaceholder: "ملاحظات اختيارية تُسجّل عند التقديم.",
      cancel: "إلغاء",
      confirm: "تقديم",
    },
    confirm: {
      deleteTitle: "حذف الطلب",
      deleteDescription: (title) =>
        `حذف "${title}"؟ سيؤدي ذلك إلى إزالته من السجل النشط.`,
      deleteConfirm: "حذف",
    },
    priorityOptions: { normal: "عادي", urgent: "عاجل", emergency: "طارئ" },
    statusOptions: {
      draft: "مسوّدة",
      submitted: "مُقدّم",
      pending_requester_approval: "بانتظار موافقة مقدّم الطلب",
      pending_provider_approval: "بانتظار موافقة مقدّم الخدمة",
      approved: "معتمد",
      routed: "مُوجَّه",
      in_execution: "قيد التنفيذ",
      delivered: "تم التسليم",
      closed: "مغلق",
      returned: "مُعاد",
      cancelled: "مُلغى",
    },
  },
};

export function resolveServiceDeskLabels(
  locale: AppLocale = "en",
): ServiceDeskLabels {
  return resolveLexBilingual(bundle, locale);
}

export function useServiceDeskLabels(): ServiceDeskLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveServiceDeskLabels(locale), [locale]);
}

/** Resolve a status/priority token using the shared label maps. */
export function formatRequestToken(token: string): string {
  return token.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
