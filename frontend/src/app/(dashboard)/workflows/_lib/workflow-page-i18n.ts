'use client';

import { differenceInHours, parseISO } from 'date-fns';
import { useBilingual } from '@/components/providers/locale-provider';
import type { HumanTask } from '@/types/models';

type LabelMap = Record<string, string>;

export interface WorkflowPageLabels {
  locale: 'en' | 'ar';
  common: {
    eyebrow: string;
    cancel: string;
    workflow: string;
    workflows: string;
    startWorkflow: string;
    searchWorkflows: string;
    failedToLoadWorkflows: string;
    retryInitiated: string;
  };
  workflows: {
    title: string;
    description: string;
    /**
     * Shown instead of `description` to a non-operator, whose list the API
     * scopes to their own involvement — claiming to show "your organization"
     * would misread a partial list as the whole picture.
     */
    scopedDescription: string;
    columns: {
      workflow: string;
      currentStep: string;
      status: string;
      started: string;
      duration: string;
      startedBy: string;
    };
    actions: {
      viewDetails: string;
      cancel: string;
      retry: string;
    };
    completedSteps: (count: number) => string;
    failedAt: (step: string) => string;
    stepOf: (step: number, total: number) => string;
    system: string;
    unknownStep: string;
    statusFilter: string;
    startedFilter: string;
    activeTag: (count: string) => string;
    failedTag: (count: string) => string;
    activeWorkflows: string;
    successRate24h: string;
    settledLast24h: (count: string) => string;
    openTasks: string;
    failedWorkflows: string;
  };
  instance: {
    backToWorkflows: string;
    fallbackTitle: string;
    failedToLoad: string;
    startedAt: (date: string) => string;
    startedBy: (name: string) => string;
    suspend: string;
    cancelWorkflow: string;
    retry: string;
    resume: string;
    suspended: string;
    resumed: string;
    failedToRetry: string;
    failedToSuspend: string;
    failedToResume: string;
    cancelled: string;
    failedToCancel: string;
    cancelDescription: (name: string) => string;
    cancelConfirmToken: string;
    systemTrigger: string;
    workflowSteps: string;
    variables: string;
    stepOutputs: string;
    stepExecutionHistory: string;
    step: string;
    type: string;
    status: string;
    started: string;
    duration: string;
    attempt: string;
    input: string;
    output: string;
    error: string;
  };
  definitions: {
    title: string;
    loadingDescription: string;
    description: string;
    failedToLoad: string;
    availableTag: (count: string) => string;
    categoriesTag: (count: string) => string;
    availableWorkflows: string;
    categories: string;
    totalRuns: string;
    allCategories: string;
    resultCount: (count: number) => string;
    noMatches: string;
    noDescription: string;
    steps: (count: number) => string;
    version: (version: number | string) => string;
    runs: (count: number) => string;
    viewDetails: string;
    start: string;
  };
  tasks: {
    list: {
      title: string;
      description: string;
      failedToLoad: string;
      pendingTag: (count: string) => string;
      overdueTag: (count: string) => string;
      pending: string;
      claimedByMe: string;
      overdue: string;
      escalated: string;
      all: string;
      claimed: string;
      completed: string;
      priorityFilter: string;
      roleFilter: string;
      slaFilter: string;
      onTime: string;
      columns: {
        taskName: string;
        workflow: string;
        status: string;
        dueDate: string;
        assigned: string;
        created: string;
      };
      actions: {
        openTask: string;
        claim: string;
        delegate: string;
        viewWorkflow: string;
      };
      unassigned: string;
      you: string;
      deadline: string;
      none: string;
      searchPlaceholder: string;
      claimedSuccess: string;
      claimedBySomeoneElse: string;
      missingClaimRole: string;
      failedToClaim: string;
    };
    detail: {
      backToMyTasks: string;
      notFound: string;
      draftRestored: (date: string) => string;
      discardDraft: string;
      claimedByOther: (name: string) => string;
      completedNotice: (status: string) => string;
      restrictedRole: string;
      taskForm: string;
      noFormFields: string;
      reject: string;
      delegate: string;
      saveDraft: string;
      complete: string;
      comments: (count: number) => string;
      noComments: string;
      addComment: string;
      claimPanelTitle: string;
      claimPanelRole: (role: string) => string;
      claiming: string;
      claimThisTask: string;
      completeTitle: string;
      completeDescription: string;
      completeAnswers: string;
      required: string;
      optional: string;
      yes: string;
      no: string;
      completeWarning: string;
      completing: string;
      completedSuccess: string;
      failedToComplete: string;
      rejectTitle: string;
      rejectDescription: string;
      reason: string;
      rejectPlaceholder: string;
      reasonMinLength: string;
      rejectWarning: string;
      rejecting: string;
      rejectedSuccess: string;
      failedToReject: string;
      delegateTitle: string;
      delegateDescription: string;
      delegateTo: string;
      searchUsers: string;
      reasonOptional: string;
      delegatePlaceholder: string;
      delegating: string;
      delegatedSuccess: (name: string) => string;
      failedToDelegate: string;
      userFallback: string;
      workflowProgress: string;
      failedToLoadWorkflowProgress: string;
      relatedEntity: string;
      noRelatedEntity: string;
      detailUnavailable: string;
      taskMetadata: string;
      created: string;
      assignedBy: string;
      system: string;
      slaDeadline: string;
      overdueSuffix: string;
      requiredRole: string;
      anyRole: string;
      timesClaimed: string;
      timesDelegated: string;
      contextVariables: string;
      entitySeverity: string;
      entityCounterparty: string;
      entityExpiry: string;
      entityScheduled: string;
      entityAttendees: string;
      entityAlert: string;
      entityContract: string;
      entityMeeting: string;
      viewEntity: (type: string) => string;
    };
  };
  statuses: LabelMap;
  stepStatuses: LabelMap;
  stepTypes: LabelMap;
  priorities: Record<number, string>;
  categories: LabelMap;
  sla: {
    noDeadline: string;
    overdueLessThanHour: string;
    overdueHours: (hours: number) => string;
    lessThanHourLeft: string;
    hoursLeft: (hours: number) => string;
    daysLeft: (days: number) => string;
  };
}

const workflowPageLabels: { en: WorkflowPageLabels; ar: WorkflowPageLabels } = {
  en: {
    locale: 'en',
    common: {
      eyebrow: 'Process Orchestration',
      cancel: 'Cancel',
      workflow: 'Workflow',
      workflows: 'Workflows',
      startWorkflow: 'Start Workflow',
      searchWorkflows: 'Search workflows...',
      failedToLoadWorkflows: 'Failed to load workflows',
      retryInitiated: 'Workflow retry initiated.',
    },
    workflows: {
      title: 'Workflows',
      description: 'Monitor workflow instances across your organization.',
      scopedDescription: 'Workflows you started or took part in.',
      columns: {
        workflow: 'Workflow',
        currentStep: 'Current Step',
        status: 'Status',
        started: 'Started',
        duration: 'Duration',
        startedBy: 'Started By',
      },
      actions: {
        viewDetails: 'View Details',
        cancel: 'Cancel',
        retry: 'Retry',
      },
      completedSteps: (count: number) => `Completed (${count} steps)`,
      failedAt: (step: string) => `Failed at: ${step}`,
      stepOf: (step: number, total: number) => `Step ${step} of ${total}`,
      system: 'System',
      unknownStep: 'Unknown step',
      statusFilter: 'Status',
      startedFilter: 'Started',
      activeTag: (count: string) => `${count} active`,
      failedTag: (count: string) => `${count} failed`,
      activeWorkflows: 'Active Workflows',
      successRate24h: '24h Success Rate',
      settledLast24h: (count: string) => `${count} settled in last 24h`,
      openTasks: 'Open Tasks',
      failedWorkflows: 'Failed Workflows',
    },
    instance: {
      backToWorkflows: 'Back to Workflows',
      fallbackTitle: 'Workflow Instance',
      failedToLoad: 'Failed to load workflow instance',
      startedAt: (date: string) => `Started ${date}`,
      startedBy: (name: string) => ` by ${name}`,
      suspend: 'Suspend',
      cancelWorkflow: 'Cancel Workflow',
      retry: 'Retry',
      resume: 'Resume',
      suspended: 'Workflow suspended.',
      resumed: 'Workflow resumed.',
      failedToRetry: 'Failed to retry workflow.',
      failedToSuspend: 'Failed to suspend workflow.',
      failedToResume: 'Failed to resume workflow.',
      cancelled: 'Workflow cancelled.',
      failedToCancel: 'Failed to cancel workflow. Please try again.',
      cancelDescription: (name: string) =>
        `This will cancel the workflow "${name}" and all pending tasks. Active tasks will be marked as cancelled. This cannot be undone.`,
      cancelConfirmToken: 'CANCEL',
      systemTrigger: 'System trigger',
      workflowSteps: 'Workflow Steps',
      variables: 'Variables',
      stepOutputs: 'Step Outputs',
      stepExecutionHistory: 'Step Execution History',
      step: 'Step',
      type: 'Type',
      status: 'Status',
      started: 'Started',
      duration: 'Duration',
      attempt: 'Attempt',
      input: 'Input',
      output: 'Output',
      error: 'Error',
    },
    definitions: {
      title: 'Browse Workflows',
      loadingDescription: 'Explore and start available workflow processes.',
      description: 'Explore available workflow processes and start new instances.',
      failedToLoad: 'Failed to load workflow definitions',
      availableTag: (count: string) => `${count} available`,
      categoriesTag: (count: string) => `${count} categories`,
      availableWorkflows: 'Available Workflows',
      categories: 'Categories',
      totalRuns: 'Total Runs',
      allCategories: 'All Categories',
      resultCount: (count: number) => `${count} workflow${count === 1 ? '' : 's'} available`,
      noMatches: 'No workflows match your search.',
      noDescription: 'No description.',
      steps: (count: number) => `${count} step${count === 1 ? '' : 's'}`,
      version: (version: number | string) => `v${version}`,
      runs: (count: number) => `${count} run${count === 1 ? '' : 's'}`,
      viewDetails: 'View Details',
      start: 'Start',
    },
    tasks: {
      list: {
        title: 'My Tasks',
        description: 'Tasks assigned to you across all workflows.',
        failedToLoad: 'Failed to load tasks',
        pendingTag: (count: string) => `${count} pending`,
        overdueTag: (count: string) => `${count} overdue`,
        pending: 'Pending',
        claimedByMe: 'Claimed by Me',
        overdue: 'Overdue',
        escalated: 'Escalated',
        all: 'All',
        claimed: 'Claimed',
        completed: 'Completed',
        priorityFilter: 'Priority',
        roleFilter: 'Role',
        slaFilter: 'SLA',
        onTime: 'On Time',
        columns: {
          taskName: 'Task Name',
          workflow: 'Workflow',
          status: 'Status',
          dueDate: 'Due Date',
          assigned: 'Assigned',
          created: 'Created',
        },
        actions: {
          openTask: 'Open Task',
          claim: 'Claim',
          delegate: 'Delegate',
          viewWorkflow: 'View Workflow',
        },
        unassigned: 'Unassigned',
        you: 'You',
        deadline: 'Deadline',
        none: 'None',
        searchPlaceholder: 'Search tasks...',
        claimedSuccess: 'Task claimed.',
        claimedBySomeoneElse: 'This task was claimed by someone else.',
        missingClaimRole: "You don't have the required role to claim this task.",
        failedToClaim: 'Failed to claim task.',
      },
      detail: {
        backToMyTasks: 'Back to My Tasks',
        notFound: 'Task not found or failed to load.',
        draftRestored: (date: string) => `Draft restored from ${date}.`,
        discardDraft: 'Discard draft',
        claimedByOther: (name: string) =>
          `This task is claimed by ${name}. You are viewing in read-only mode.`,
        completedNotice: (status: string) =>
          `This task has been ${status}. Showing submitted data.`,
        restrictedRole: 'This task is currently unclaimed and restricted to the required role.',
        taskForm: 'Task Form',
        noFormFields: 'No form fields required for this task.',
        reject: 'Reject',
        delegate: 'Delegate',
        saveDraft: 'Save Draft',
        complete: 'Complete',
        comments: (count: number) => (count > 0 ? `Comments (${count})` : 'Comments'),
        noComments: 'No comments yet.',
        addComment: 'Add a comment...',
        claimPanelTitle: 'This task is not yet claimed.',
        claimPanelRole: (role: string) => `Available for anyone with the ${role} role.`,
        claiming: 'Claiming...',
        claimThisTask: 'Claim This Task',
        completeTitle: 'Complete Task',
        completeDescription: 'Review your answers before completing.',
        completeAnswers: 'Your answers:',
        required: 'Required',
        optional: 'Optional',
        yes: 'Yes',
        no: 'No',
        completeWarning: 'This action will advance the workflow to the next step and cannot be undone.',
        completing: 'Completing...',
        completedSuccess: 'Task completed successfully.',
        failedToComplete: 'Failed to complete task.',
        rejectTitle: 'Reject Task',
        rejectDescription: 'Provide a reason for rejecting this task.',
        reason: 'Reason',
        rejectPlaceholder: "Explain why you're rejecting this task...",
        reasonMinLength: 'Please provide at least 10 characters.',
        rejectWarning: 'Rejecting this task will return it to the unassigned pool or escalate it.',
        rejecting: 'Rejecting...',
        rejectedSuccess: 'Task rejected.',
        failedToReject: 'Failed to reject task.',
        delegateTitle: 'Delegate Task',
        delegateDescription: 'Transfer this task to another user with the required role.',
        delegateTo: 'Delegate To',
        searchUsers: 'Search users...',
        reasonOptional: 'Reason (optional)',
        delegatePlaceholder: 'Why are you delegating this task?',
        delegating: 'Delegating...',
        delegatedSuccess: (name: string) => `Task delegated to ${name}.`,
        failedToDelegate: 'Failed to delegate task.',
        userFallback: 'user',
        workflowProgress: 'Workflow Progress',
        failedToLoadWorkflowProgress: 'Failed to load workflow progress',
        relatedEntity: 'Related Entity',
        noRelatedEntity: 'No related entity.',
        detailUnavailable: 'Detail API is unavailable. You can still use the entity reference.',
        taskMetadata: 'Task Metadata',
        created: 'Created',
        assignedBy: 'Assigned by',
        system: 'System',
        slaDeadline: 'SLA Deadline',
        overdueSuffix: 'overdue',
        requiredRole: 'Required Role',
        anyRole: 'Any',
        timesClaimed: 'Times Claimed',
        timesDelegated: 'Times Delegated',
        contextVariables: 'Context Variables',
        entitySeverity: 'Severity',
        entityCounterparty: 'Counterparty',
        entityExpiry: 'Expiry',
        entityScheduled: 'Scheduled',
        entityAttendees: 'Attendees',
        entityAlert: 'Alert',
        entityContract: 'Contract',
        entityMeeting: 'Meeting',
        viewEntity: (type: string) => `View ${type}`,
      },
    },
    statuses: {
      active: 'Active',
      archived: 'Archived',
      cancelled: 'Cancelled',
      claimed: 'In Progress',
      completed: 'Completed',
      draft: 'Draft',
      escalated: 'Escalated',
      failed: 'Failed',
      pending: 'Pending',
      rejected: 'Rejected',
      running: 'Running',
      suspended: 'Suspended',
    },
    stepStatuses: {
      completed: 'Completed',
      running: 'In progress',
      failed: 'Failed',
      pending: 'Pending',
      skipped: 'Skipped',
      cancelled: 'Cancelled',
      claimedBy: 'Claimed by',
      waitingForAssignment: 'Waiting for assignment',
      noStepsAvailable: 'No steps available.',
    },
    stepTypes: {
      human_task: 'Human Task',
      service_task: 'Automated',
      event_task: 'Event',
      condition: 'Condition',
      parallel_gateway: 'Parallel',
      timer: 'Timer',
      end: 'End',
    },
    priorities: {
      2: 'Critical',
      1: 'High',
      0: 'Normal',
    },
    categories: {
      all: 'All Categories',
      approval: 'Approval',
      onboarding: 'Onboarding',
      review: 'Review',
      escalation: 'Escalation',
      notification: 'Notification',
      data_pipeline: 'Data Pipeline',
      compliance: 'Compliance',
      custom: 'Custom',
    },
    sla: {
      noDeadline: 'No deadline',
      overdueLessThanHour: 'Overdue by <1h',
      overdueHours: (hours: number) => `Overdue by ${hours}h`,
      lessThanHourLeft: '<1h left',
      hoursLeft: (hours: number) => `${hours}h left`,
      daysLeft: (days: number) => `${days}d left`,
    },
  },
  ar: {
    locale: 'ar',
    common: {
      eyebrow: 'تنسيق العمليات',
      cancel: 'إلغاء',
      workflow: 'سير العمل',
      workflows: 'سير العمل',
      startWorkflow: 'بدء سير عمل',
      searchWorkflows: 'ابحث في سير العمل...',
      failedToLoadWorkflows: 'تعذر تحميل سير العمل',
      retryInitiated: 'بدأت إعادة محاولة سير العمل.',
    },
    workflows: {
      title: 'سير العمل',
      description: 'راقب مثيلات سير العمل عبر منظمتك.',
      scopedDescription: 'مسارات العمل التي بدأتها أو شاركت فيها.',
      columns: {
        workflow: 'سير العمل',
        currentStep: 'الخطوة الحالية',
        status: 'الحالة',
        started: 'بدأت',
        duration: 'المدة',
        startedBy: 'بدأها',
      },
      actions: {
        viewDetails: 'عرض التفاصيل',
        cancel: 'إلغاء',
        retry: 'إعادة المحاولة',
      },
      completedSteps: (count: number) => `مكتمل (${count} خطوة)`,
      failedAt: (step: string) => `فشل عند: ${step}`,
      stepOf: (step: number, total: number) => `الخطوة ${step} من ${total}`,
      system: 'النظام',
      unknownStep: 'خطوة غير معروفة',
      statusFilter: 'الحالة',
      startedFilter: 'تاريخ البدء',
      activeTag: (count: string) => `${count} نشط`,
      failedTag: (count: string) => `${count} فاشل`,
      activeWorkflows: 'سير العمل النشطة',
      successRate24h: 'معدل النجاح خلال 24 ساعة',
      settledLast24h: (count: string) => `${count} اكتملت أو فشلت خلال آخر 24 ساعة`,
      openTasks: 'المهام المفتوحة',
      failedWorkflows: 'سير العمل الفاشلة',
    },
    instance: {
      backToWorkflows: 'العودة إلى سير العمل',
      fallbackTitle: 'مثيل سير العمل',
      failedToLoad: 'تعذر تحميل مثيل سير العمل',
      startedAt: (date: string) => `بدأ في ${date}`,
      startedBy: (name: string) => ` بواسطة ${name}`,
      suspend: 'تعليق',
      cancelWorkflow: 'إلغاء سير العمل',
      retry: 'إعادة المحاولة',
      resume: 'استئناف',
      suspended: 'تم تعليق سير العمل.',
      resumed: 'تم استئناف سير العمل.',
      failedToRetry: 'تعذرت إعادة محاولة سير العمل.',
      failedToSuspend: 'تعذر تعليق سير العمل.',
      failedToResume: 'تعذر استئناف سير العمل.',
      cancelled: 'تم إلغاء سير العمل.',
      failedToCancel: 'تعذر إلغاء سير العمل. يُرجى المحاولة مرة أخرى.',
      cancelDescription: (name: string) =>
        `سيؤدي ذلك إلى إلغاء سير العمل "${name}" وكل المهام قيد الانتظار. ستُوسم المهام النشطة بأنها ملغاة. لا يمكن التراجع عن ذلك.`,
      cancelConfirmToken: 'إلغاء',
      systemTrigger: 'تشغيل النظام',
      workflowSteps: 'خطوات سير العمل',
      variables: 'المتغيرات',
      stepOutputs: 'مخرجات الخطوات',
      stepExecutionHistory: 'سجل تنفيذ الخطوات',
      step: 'الخطوة',
      type: 'النوع',
      status: 'الحالة',
      started: 'بدأت',
      duration: 'المدة',
      attempt: 'المحاولة',
      input: 'المدخلات',
      output: 'المخرجات',
      error: 'الخطأ',
    },
    definitions: {
      title: 'استعراض سير العمل',
      loadingDescription: 'استكشف عمليات سير العمل المتاحة وابدأها.',
      description: 'استكشف عمليات سير العمل المتاحة وابدأ مثيلات جديدة.',
      failedToLoad: 'تعذر تحميل تعريفات سير العمل',
      availableTag: (count: string) => `${count} متاح`,
      categoriesTag: (count: string) => `${count} فئات`,
      availableWorkflows: 'سير العمل المتاحة',
      categories: 'الفئات',
      totalRuns: 'إجمالي التشغيلات',
      allCategories: 'كل الفئات',
      resultCount: (count: number) => `${count} سير عمل متاح`,
      noMatches: 'لا توجد سير عمل تطابق بحثك.',
      noDescription: 'لا يوجد وصف.',
      steps: (count: number) => `${count} خطوة`,
      version: (version: number | string) => `الإصدار ${version}`,
      runs: (count: number) => `${count} تشغيل`,
      viewDetails: 'عرض التفاصيل',
      start: 'بدء',
    },
    tasks: {
      list: {
        title: 'مهامي',
        description: 'المهام المسندة إليك عبر كل سير العمل.',
        failedToLoad: 'تعذر تحميل المهام',
        pendingTag: (count: string) => `${count} معلقة`,
        overdueTag: (count: string) => `${count} متأخرة`,
        pending: 'معلقة',
        claimedByMe: 'استلمتها',
        overdue: 'متأخرة',
        escalated: 'مصعدة',
        all: 'الكل',
        claimed: 'مستلمة',
        completed: 'مكتملة',
        priorityFilter: 'الأولوية',
        roleFilter: 'الدور',
        slaFilter: 'اتفاقية مستوى الخدمة',
        onTime: 'ضمن الموعد',
        columns: {
          taskName: 'اسم المهمة',
          workflow: 'سير العمل',
          status: 'الحالة',
          dueDate: 'تاريخ الاستحقاق',
          assigned: 'المسندة إلى',
          created: 'تاريخ الإنشاء',
        },
        actions: {
          openTask: 'فتح المهمة',
          claim: 'استلام',
          delegate: 'تفويض',
          viewWorkflow: 'عرض سير العمل',
        },
        unassigned: 'غير مسندة',
        you: 'أنت',
        deadline: 'الموعد النهائي',
        none: 'لا يوجد',
        searchPlaceholder: 'ابحث في المهام...',
        claimedSuccess: 'تم استلام المهمة.',
        claimedBySomeoneElse: 'استلم شخص آخر هذه المهمة.',
        missingClaimRole: 'ليست لديك الصلاحية المطلوبة لاستلام هذه المهمة.',
        failedToClaim: 'تعذر استلام المهمة.',
      },
      detail: {
        backToMyTasks: 'العودة إلى مهامي',
        notFound: 'المهمة غير موجودة أو تعذر تحميلها.',
        draftRestored: (date: string) => `تمت استعادة المسودة من ${date}.`,
        discardDraft: 'تجاهل المسودة',
        claimedByOther: (name: string) =>
          `هذه المهمة مستلمة بواسطة ${name}. أنت تعرضها بوضع القراءة فقط.`,
        completedNotice: (status: string) => `تمت معالجة هذه المهمة بحالة ${status}. يتم عرض البيانات المقدمة.`,
        restrictedRole: 'هذه المهمة غير مستلمة حالياً ومقيدة بالدور المطلوب.',
        taskForm: 'نموذج المهمة',
        noFormFields: 'لا توجد حقول نموذج مطلوبة لهذه المهمة.',
        reject: 'رفض',
        delegate: 'تفويض',
        saveDraft: 'حفظ المسودة',
        complete: 'إكمال',
        comments: (count: number) => (count > 0 ? `التعليقات (${count})` : 'التعليقات'),
        noComments: 'لا توجد تعليقات بعد.',
        addComment: 'أضف تعليقاً...',
        claimPanelTitle: 'هذه المهمة لم تُستلم بعد.',
        claimPanelRole: (role: string) => `متاحة لأي شخص لديه دور ${role}.`,
        claiming: 'جارٍ الاستلام...',
        claimThisTask: 'استلام هذه المهمة',
        completeTitle: 'إكمال المهمة',
        completeDescription: 'راجع إجاباتك قبل الإكمال.',
        completeAnswers: 'إجاباتك:',
        required: 'مطلوب',
        optional: 'اختياري',
        yes: 'نعم',
        no: 'لا',
        completeWarning: 'سيؤدي هذا الإجراء إلى نقل سير العمل إلى الخطوة التالية ولا يمكن التراجع عنه.',
        completing: 'جارٍ الإكمال...',
        completedSuccess: 'تم إكمال المهمة بنجاح.',
        failedToComplete: 'تعذر إكمال المهمة.',
        rejectTitle: 'رفض المهمة',
        rejectDescription: 'قدّم سبب رفض هذه المهمة.',
        reason: 'السبب',
        rejectPlaceholder: 'اشرح سبب رفض هذه المهمة...',
        reasonMinLength: 'يرجى إدخال 10 أحرف على الأقل.',
        rejectWarning: 'سيعيد رفض هذه المهمة إلى قائمة المهام غير المسندة أو يصعّدها.',
        rejecting: 'جارٍ الرفض...',
        rejectedSuccess: 'تم رفض المهمة.',
        failedToReject: 'تعذر رفض المهمة.',
        delegateTitle: 'تفويض المهمة',
        delegateDescription: 'انقل هذه المهمة إلى مستخدم آخر لديه الدور المطلوب.',
        delegateTo: 'تفويض إلى',
        searchUsers: 'ابحث عن مستخدمين...',
        reasonOptional: 'السبب (اختياري)',
        delegatePlaceholder: 'لماذا تفوض هذه المهمة؟',
        delegating: 'جارٍ التفويض...',
        delegatedSuccess: (name: string) => `تم تفويض المهمة إلى ${name}.`,
        failedToDelegate: 'تعذر تفويض المهمة.',
        userFallback: 'مستخدم',
        workflowProgress: 'تقدم سير العمل',
        failedToLoadWorkflowProgress: 'تعذر تحميل تقدم سير العمل',
        relatedEntity: 'الكيان المرتبط',
        noRelatedEntity: 'لا يوجد كيان مرتبط.',
        detailUnavailable: 'واجهة تفاصيل الكيان غير متاحة. يمكنك استخدام مرجع الكيان.',
        taskMetadata: 'بيانات المهمة',
        created: 'تاريخ الإنشاء',
        assignedBy: 'أسندها',
        system: 'النظام',
        slaDeadline: 'موعد اتفاقية الخدمة',
        overdueSuffix: 'متأخرة',
        requiredRole: 'الدور المطلوب',
        anyRole: 'أي دور',
        timesClaimed: 'عدد مرات الاستلام',
        timesDelegated: 'عدد مرات التفويض',
        contextVariables: 'متغيرات السياق',
        entitySeverity: 'الشدة',
        entityCounterparty: 'الطرف المقابل',
        entityExpiry: 'الانتهاء',
        entityScheduled: 'الموعد',
        entityAttendees: 'الحضور',
        entityAlert: 'تنبيه',
        entityContract: 'عقد',
        entityMeeting: 'اجتماع',
        viewEntity: (type: string) => `عرض ${type}`,
      },
    },
    statuses: {
      active: 'نشط',
      archived: 'مؤرشف',
      cancelled: 'ملغى',
      claimed: 'قيد التنفيذ',
      completed: 'مكتمل',
      draft: 'مسودة',
      escalated: 'مصعد',
      failed: 'فاشل',
      pending: 'معلق',
      rejected: 'مرفوض',
      running: 'قيد التشغيل',
      suspended: 'معلق مؤقتاً',
    },
    stepStatuses: {
      completed: 'مكتملة',
      running: 'قيد التنفيذ',
      failed: 'فشلت',
      pending: 'معلقة',
      skipped: 'متخطاة',
      cancelled: 'ملغاة',
      claimedBy: 'استلمها',
      waitingForAssignment: 'بانتظار الإسناد',
      noStepsAvailable: 'لا توجد خطوات متاحة.',
    },
    stepTypes: {
      human_task: 'مهمة بشرية',
      service_task: 'مؤتمتة',
      event_task: 'حدث',
      condition: 'شرط',
      parallel_gateway: 'توازٍ',
      timer: 'مؤقت',
      end: 'نهاية',
    },
    priorities: {
      2: 'حرجة',
      1: 'عالية',
      0: 'عادية',
    },
    categories: {
      all: 'كل الفئات',
      approval: 'الموافقات',
      onboarding: 'الإلحاق',
      review: 'المراجعة',
      escalation: 'التصعيد',
      notification: 'الإشعارات',
      data_pipeline: 'خط بيانات',
      compliance: 'الامتثال',
      custom: 'مخصص',
    },
    sla: {
      noDeadline: 'لا يوجد موعد نهائي',
      overdueLessThanHour: 'متأخرة بأقل من ساعة',
      overdueHours: (hours: number) => `متأخرة بـ ${hours} ساعة`,
      lessThanHourLeft: 'متبقٍ أقل من ساعة',
      hoursLeft: (hours: number) => `متبقٍ ${hours} ساعة`,
      daysLeft: (days: number) => `متبقٍ ${days} يوم`,
    },
  },
};

export function useWorkflowPageLabels(): WorkflowPageLabels {
  return useBilingual(workflowPageLabels);
}

export function workflowLabel(labels: WorkflowPageLabels, value: string, fallback: string): string {
  return labels.statuses[value] ?? labels.categories[value] ?? fallback;
}

export function workflowStepStatusLabel(
  labels: WorkflowPageLabels,
  value: string,
  fallback: string,
): string {
  return labels.stepStatuses[value] ?? fallback;
}

export function workflowStepTypeLabel(
  labels: WorkflowPageLabels,
  value: string,
  fallback: string,
): string {
  return labels.stepTypes[value] ?? fallback;
}

export function formatWorkflowDuration(seconds: number, labels: WorkflowPageLabels): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const number = (value: number) =>
    new Intl.NumberFormat(labels.locale === 'ar' ? 'ar' : 'en-US').format(value);
  const second = labels.locale === 'ar' ? 'ث' : 's';
  const minute = labels.locale === 'ar' ? 'د' : 'm';
  const hour = labels.locale === 'ar' ? 'س' : 'h';

  if (safeSeconds < 60) {
    return `${number(safeSeconds)}${second}`;
  }

  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainingSeconds = safeSeconds % 60;

  if (hours > 0) {
    return minutes > 0 ? `${number(hours)}${hour} ${number(minutes)}${minute}` : `${number(hours)}${hour}`;
  }

  return remainingSeconds > 0
    ? `${number(minutes)}${minute} ${number(remainingSeconds)}${second}`
    : `${number(minutes)}${minute}`;
}

export function formatWorkflowDateTime(value: string | Date, labels: WorkflowPageLabels): string {
  try {
    const date = typeof value === 'string' ? new Date(value) : value;
    return new Intl.DateTimeFormat(labels.locale === 'ar' ? 'ar' : 'en-US', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  } catch {
    return '—';
  }
}

export function formatTaskSlaStatus(
  task: HumanTask,
  labels: WorkflowPageLabels,
): {
  text: string;
  color: string;
  urgent: boolean;
} {
  if (!task.sla_deadline) {
    return { text: labels.sla.noDeadline, color: 'text-muted-foreground', urgent: false };
  }

  if (task.sla_breached) {
    const deadline = parseISO(task.sla_deadline);
    const hoursOverdue = Math.abs(differenceInHours(new Date(), deadline));
    return {
      text: hoursOverdue < 1 ? labels.sla.overdueLessThanHour : labels.sla.overdueHours(hoursOverdue),
      color: 'text-red-600',
      urgent: true,
    };
  }

  const deadline = parseISO(task.sla_deadline);
  const hoursLeft = differenceInHours(deadline, new Date());

  if (hoursLeft <= 4) {
    return {
      text: hoursLeft < 1 ? labels.sla.lessThanHourLeft : labels.sla.hoursLeft(hoursLeft),
      color: 'text-orange-600',
      urgent: true,
    };
  }

  const daysLeft = Math.floor(hoursLeft / 24);
  if (daysLeft === 0) {
    return { text: labels.sla.hoursLeft(hoursLeft), color: 'text-foreground', urgent: false };
  }
  return { text: labels.sla.daysLeft(daysLeft), color: 'text-foreground', urgent: false };
}
