import { differenceInHours, parseISO } from 'date-fns';
import { taskStatusConfig, workflowStatusConfig, type StatusConfig } from '@/lib/status-configs';
import { PRIORITY_COLORS } from '@/lib/workflow-utils';
import type { AppLocale } from '@/lib/i18n';
import type { FilterConfig } from '@/types/table';
import type {
  HumanTask,
  HumanTaskStatus,
  StepStatus,
  WorkflowInstanceStatus,
} from '@/types/models';

import '../../../_lib/admin-i18n';

type LocaleLabels = {
  common: {
    back: string;
    cancel: string;
    processing: string;
    unknownStatus: string;
    unknownType: string;
    noResults: string;
    selectPlaceholder: string;
    searchPlaceholder: string;
  };
  taskStatuses: Record<HumanTaskStatus, string>;
  workflowStatuses: Record<WorkflowInstanceStatus, string>;
  stepStatuses: Record<StepStatus, string>;
  stepTypes: Record<string, string>;
  priorities: Record<number, string>;
  taskTabs: {
    all: string;
    pending: string;
    claimed: string;
    completed: string;
    overdue: string;
  };
  taskFilters: {
    priority: string;
    role: string;
    sla: string;
    overdue: string;
    onTime: string;
  };
  taskColumns: {
    taskName: string;
    workflow: string;
    status: string;
    dueDate: string;
    assigned: string;
    created: string;
    openTask: string;
    claim: string;
    delegate: string;
    viewWorkflow: string;
    unassigned: string;
    you: string;
    deadline: string;
  };
  taskEmpty: {
    title: string;
    description: string;
  };
  sla: {
    noDeadline: string;
    overdue: string;
    overdueByLessThanHour: string;
    overdueByHours: string;
    lessThanHourLeft: string;
    hoursLeft: string;
    daysLeft: string;
  };
  delegate: {
    title: string;
    description: string;
    delegateTo: string;
    searchUsers: string;
    reason: string;
    reasonPlaceholder: string;
    submitting: string;
    confirm: string;
    success: string;
    failed: string;
    userFallback: string;
  };
  instanceFilters: {
    status: string;
    started: string;
  };
  instanceColumns: {
    duration: string;
  };
  instanceEmpty: {
    title: string;
    description: string;
  };
  cancelInstance: {
    title: string;
    description: string;
    confirm: string;
    success: string;
    failed: string;
    typeToConfirm: string;
    token: string;
  };
  progress: {
    stepOf: string;
    current: string;
    allStepsCompleted: string;
    duration: string;
  };
};

const ADMIN_WORKFLOW_LABELS: Record<'en' | 'ar', LocaleLabels> = {
  en: {
    common: {
      back: 'Back',
      cancel: 'Cancel',
      processing: 'Processing...',
      unknownStatus: 'Unknown status',
      unknownType: 'Unknown type',
      noResults: 'No results found.',
      selectPlaceholder: 'Select...',
      searchPlaceholder: 'Search...',
    },
    taskStatuses: {
      pending: 'Pending',
      claimed: 'In Progress',
      completed: 'Completed',
      rejected: 'Rejected',
      escalated: 'Escalated',
      cancelled: 'Cancelled',
    },
    workflowStatuses: {
      running: 'Running',
      completed: 'Completed',
      failed: 'Failed',
      cancelled: 'Cancelled',
      suspended: 'Suspended',
    },
    stepStatuses: {
      completed: 'Completed',
      running: 'Running',
      failed: 'Failed',
      pending: 'Pending',
      skipped: 'Skipped',
      cancelled: 'Cancelled',
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
    taskTabs: {
      all: 'All',
      pending: 'Pending',
      claimed: 'Claimed',
      completed: 'Completed',
      overdue: 'Overdue',
    },
    taskFilters: {
      priority: 'Priority',
      role: 'Role',
      sla: 'SLA',
      overdue: 'Overdue',
      onTime: 'On Time',
    },
    taskColumns: {
      taskName: 'Task Name',
      workflow: 'Workflow',
      status: 'Status',
      dueDate: 'Due Date',
      assigned: 'Assigned',
      created: 'Created',
      openTask: 'Open Task',
      claim: 'Claim',
      delegate: 'Delegate',
      viewWorkflow: 'View Workflow',
      unassigned: 'Unassigned',
      you: 'You',
      deadline: 'Deadline',
    },
    taskEmpty: {
      title: 'No tasks found',
      description: 'No workflow tasks match the current queue and filters.',
    },
    sla: {
      noDeadline: 'No deadline',
      overdue: 'Overdue',
      overdueByLessThanHour: 'Overdue by <1h',
      overdueByHours: 'Overdue by {n}h',
      lessThanHourLeft: '<1h left',
      hoursLeft: '{n}h left',
      daysLeft: '{n}d left',
    },
    delegate: {
      title: 'Delegate Task',
      description: 'Transfer this task to another user with the required role.',
      delegateTo: 'Delegate To',
      searchUsers: 'Search users...',
      reason: 'Reason (optional)',
      reasonPlaceholder: 'Why are you delegating this task?',
      submitting: 'Delegating...',
      confirm: 'Delegate Task',
      success: 'Task delegated to {name}.',
      failed: 'Failed to delegate task.',
      userFallback: 'user',
    },
    instanceFilters: {
      status: 'Status',
      started: 'Started',
    },
    instanceColumns: {
      duration: 'Duration',
    },
    instanceEmpty: {
      title: 'No instances found',
      description: 'No workflow instances match the current filters.',
    },
    cancelInstance: {
      title: 'Cancel Workflow',
      description:
        'This will cancel the workflow "{name}" and all pending tasks. Active tasks will be marked as cancelled. This cannot be undone.',
      confirm: 'Cancel Workflow',
      success: 'Workflow cancelled.',
      failed: 'Failed to cancel workflow. Please try again.',
      typeToConfirm: 'Type {token} to confirm',
      token: 'CANCEL',
    },
    progress: {
      stepOf: 'Step {completed} of {total}',
      current: 'Current: {step}',
      allStepsCompleted: 'All steps completed',
      duration: 'Duration: {duration}',
    },
  },
  ar: {
    common: {
      back: 'رجوع',
      cancel: 'إلغاء',
      processing: 'جارٍ المعالجة...',
      unknownStatus: 'حالة غير معروفة',
      unknownType: 'نوع غير معروف',
      noResults: 'لا توجد نتائج.',
      selectPlaceholder: 'اختر...',
      searchPlaceholder: 'ابحث...',
    },
    taskStatuses: {
      pending: 'قيد الانتظار',
      claimed: 'قيد التنفيذ',
      completed: 'مكتملة',
      rejected: 'مرفوضة',
      escalated: 'مُصعّدة',
      cancelled: 'مُلغاة',
    },
    workflowStatuses: {
      running: 'قيد التشغيل',
      completed: 'مكتملة',
      failed: 'فاشلة',
      cancelled: 'مُلغاة',
      suspended: 'مُعلّقة',
    },
    stepStatuses: {
      completed: 'مكتملة',
      running: 'قيد التشغيل',
      failed: 'فاشلة',
      pending: 'قيد الانتظار',
      skipped: 'مُتخطّاة',
      cancelled: 'مُلغاة',
    },
    stepTypes: {
      human_task: 'مهمة بشرية',
      service_task: 'مؤتمتة',
      event_task: 'حدث',
      condition: 'شرط',
      parallel_gateway: 'توازٍ',
      timer: 'مؤقّت',
      end: 'نهاية',
    },
    priorities: {
      2: 'حرجة',
      1: 'عالية',
      0: 'عادية',
    },
    taskTabs: {
      all: 'الكل',
      pending: 'قيد الانتظار',
      claimed: 'مستلمة',
      completed: 'مكتملة',
      overdue: 'متأخرة',
    },
    taskFilters: {
      priority: 'الأولوية',
      role: 'الدور',
      sla: 'اتفاقية الخدمة',
      overdue: 'متأخرة',
      onTime: 'ضمن الوقت',
    },
    taskColumns: {
      taskName: 'اسم المهمة',
      workflow: 'سير العمل',
      status: 'الحالة',
      dueDate: 'تاريخ الاستحقاق',
      assigned: 'الإسناد',
      created: 'تاريخ الإنشاء',
      openTask: 'فتح المهمة',
      claim: 'استلام',
      delegate: 'تفويض',
      viewWorkflow: 'عرض سير العمل',
      unassigned: 'غير مُسنَدة',
      you: 'أنت',
      deadline: 'الموعد النهائي',
    },
    taskEmpty: {
      title: 'لا توجد مهام',
      description: 'لا توجد مهام سير عمل تطابق القائمة وعوامل التصفية الحالية.',
    },
    sla: {
      noDeadline: 'لا يوجد موعد نهائي',
      overdue: 'متأخرة',
      overdueByLessThanHour: 'متأخرة بأقل من ساعة',
      overdueByHours: 'متأخرة بـ {n} س',
      lessThanHourLeft: 'أقل من ساعة متبقية',
      hoursLeft: '{n} س متبقية',
      daysLeft: '{n} ي متبقية',
    },
    delegate: {
      title: 'تفويض المهمة',
      description: 'انقل هذه المهمة إلى مستخدم آخر لديه الدور المطلوب.',
      delegateTo: 'تفويض إلى',
      searchUsers: 'ابحث عن مستخدمين...',
      reason: 'السبب (اختياري)',
      reasonPlaceholder: 'لماذا تفوّض هذه المهمة؟',
      submitting: 'جارٍ التفويض...',
      confirm: 'تفويض المهمة',
      success: 'تم تفويض المهمة إلى {name}.',
      failed: 'تعذّر تفويض المهمة.',
      userFallback: 'مستخدم',
    },
    instanceFilters: {
      status: 'الحالة',
      started: 'بدأ في',
    },
    instanceColumns: {
      duration: 'المدة',
    },
    instanceEmpty: {
      title: 'لا توجد مثيلات',
      description: 'لا توجد مثيلات سير عمل تطابق عوامل التصفية الحالية.',
    },
    cancelInstance: {
      title: 'إلغاء سير العمل',
      description:
        'سيؤدي ذلك إلى إلغاء سير العمل «{name}» وجميع المهام قيد الانتظار. ستُوسَم المهام النشطة بأنها مُلغاة. لا يمكن التراجع عن ذلك.',
      confirm: 'إلغاء سير العمل',
      success: 'تم إلغاء سير العمل.',
      failed: 'تعذّر إلغاء سير العمل. يُرجى المحاولة مرة أخرى.',
      typeToConfirm: 'اكتب {token} للتأكيد',
      token: 'CANCEL',
    },
    progress: {
      stepOf: 'الخطوة {completed} من {total}',
      current: 'الحالية: {step}',
      allStepsCompleted: 'اكتملت جميع الخطوات',
      duration: 'المدة: {duration}',
    },
  },
} as const;

function labelsFor(locale: AppLocale | string): LocaleLabels {
  return locale === 'ar' ? ADMIN_WORKFLOW_LABELS.ar : ADMIN_WORKFLOW_LABELS.en;
}

function formatLabel(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (token, name) => {
    const value = params[name];
    return value === undefined ? token : String(value);
  });
}

function formatNumber(value: number, locale: AppLocale | string): string {
  return new Intl.NumberFormat(locale === 'ar' ? 'ar' : 'en-US').format(value);
}

export function getAdminWorkflowLabels(locale: AppLocale | string): LocaleLabels {
  return labelsFor(locale);
}

export function fillAdminWorkflowLabel(
  template: string,
  params: Record<string, string | number>,
): string {
  return formatLabel(template, params);
}

export function getTaskStatusLabel(
  status: string,
  locale: AppLocale | string,
): string {
  const labels = labelsFor(locale);
  return labels.taskStatuses[status as HumanTaskStatus] ?? labels.common.unknownStatus;
}

export function getWorkflowStatusLabel(
  status: string,
  locale: AppLocale | string,
): string {
  const labels = labelsFor(locale);
  return labels.workflowStatuses[status as WorkflowInstanceStatus] ?? labels.common.unknownStatus;
}

export function getStepStatusLabel(status: string, locale: AppLocale | string): string {
  const labels = labelsFor(locale);
  return labels.stepStatuses[status as StepStatus] ?? labels.common.unknownStatus;
}

export function getStepTypeLabel(type: string, locale: AppLocale | string): string {
  const labels = labelsFor(locale);
  return labels.stepTypes[type as keyof typeof labels.stepTypes] ?? labels.common.unknownType;
}

export function getTaskPriorityLabel(priority: number, locale: AppLocale | string): string {
  const labels = labelsFor(locale);
  return labels.priorities[priority as keyof typeof labels.priorities] ?? labels.priorities[0];
}

export function getTaskPriorityColor(priority: number): string {
  return PRIORITY_COLORS[priority] ?? 'bg-blue-400';
}

export function getLocalizedTaskStatusConfig(locale: AppLocale | string): StatusConfig {
  return Object.fromEntries(
    Object.entries(taskStatusConfig).map(([status, config]) => [
      status,
      { ...config, label: getTaskStatusLabel(status, locale) },
    ]),
  ) as StatusConfig;
}

export function getLocalizedWorkflowStatusConfig(locale: AppLocale | string): StatusConfig {
  return Object.fromEntries(
    Object.entries(workflowStatusConfig).map(([status, config]) => [
      status,
      { ...config, label: getWorkflowStatusLabel(status, locale) },
    ]),
  ) as StatusConfig;
}

export function createAdminTaskFilters(
  locale: AppLocale | string,
  roleOptions: Array<{ label: string; value: string }>,
): FilterConfig[] {
  const labels = labelsFor(locale);
  return [
    {
      key: 'priority',
      label: labels.taskFilters.priority,
      type: 'multi-select',
      options: [
        { label: labels.priorities[2], value: '2' },
        { label: labels.priorities[1], value: '1' },
        { label: labels.priorities[0], value: '0' },
      ],
    },
    {
      key: 'assignee_role',
      label: labels.taskFilters.role,
      type: 'select',
      options: roleOptions,
    },
    {
      key: 'sla_breached',
      label: labels.taskFilters.sla,
      type: 'select',
      options: [
        { label: labels.taskFilters.overdue, value: 'true' },
        { label: labels.taskFilters.onTime, value: 'false' },
      ],
    },
  ];
}

export function createAdminWorkflowInstanceFilters(locale: AppLocale | string): FilterConfig[] {
  const labels = labelsFor(locale);
  return [
    {
      key: 'status',
      label: labels.instanceFilters.status,
      type: 'multi-select',
      options: [
        { label: labels.workflowStatuses.running, value: 'running' },
        { label: labels.workflowStatuses.completed, value: 'completed' },
        { label: labels.workflowStatuses.failed, value: 'failed' },
        { label: labels.workflowStatuses.cancelled, value: 'cancelled' },
        { label: labels.workflowStatuses.suspended, value: 'suspended' },
      ],
    },
    {
      key: 'started_at',
      label: labels.instanceFilters.started,
      type: 'date-range',
    },
  ];
}

export function formatAdminSLAStatus(
  task: HumanTask,
  locale: AppLocale | string,
): {
  text: string;
  color: string;
  urgent: boolean;
} {
  const labels = labelsFor(locale);
  if (!task.sla_deadline) {
    return { text: labels.sla.noDeadline, color: 'text-muted-foreground', urgent: false };
  }

  const deadline = parseISO(task.sla_deadline);
  if (task.sla_breached) {
    const hoursOverdue = Math.abs(differenceInHours(new Date(), deadline));
    const text =
      hoursOverdue < 1
        ? labels.sla.overdueByLessThanHour
        : formatLabel(labels.sla.overdueByHours, {
            n: formatNumber(hoursOverdue, locale),
          });
    return { text, color: 'text-red-600', urgent: true };
  }

  const hoursLeft = differenceInHours(deadline, new Date());
  if (hoursLeft <= 4) {
    return {
      text:
        hoursLeft < 1
          ? labels.sla.lessThanHourLeft
          : formatLabel(labels.sla.hoursLeft, { n: formatNumber(hoursLeft, locale) }),
      color: 'text-orange-600',
      urgent: true,
    };
  }

  const daysLeft = Math.floor(hoursLeft / 24);
  if (daysLeft === 0) {
    return {
      text: formatLabel(labels.sla.hoursLeft, { n: formatNumber(hoursLeft, locale) }),
      color: 'text-foreground',
      urgent: false,
    };
  }
  return {
    text: formatLabel(labels.sla.daysLeft, { n: formatNumber(daysLeft, locale) }),
    color: 'text-foreground',
    urgent: false,
  };
}

export function formatAdminDateTime(
  value: string | Date,
  locale: AppLocale | string,
): string {
  try {
    const date = typeof value === 'string' ? parseISO(value) : value;
    return new Intl.DateTimeFormat(locale === 'ar' ? 'ar' : 'en-US', {
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

export function formatAdminDuration(seconds: number, locale: AppLocale | string): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const n = (value: number) => formatNumber(value, locale);
  const second = locale === 'ar' ? 'ث' : 's';
  const minute = locale === 'ar' ? 'د' : 'm';
  const hour = locale === 'ar' ? 'س' : 'h';

  if (safeSeconds < 60) {
    return `${n(safeSeconds)}${second}`;
  }

  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainingSeconds = safeSeconds % 60;

  if (hours > 0) {
    if (minutes > 0) {
      return `${n(hours)}${hour} ${n(minutes)}${minute}`;
    }
    return `${n(hours)}${hour}`;
  }
  if (remainingSeconds > 0) {
    return `${n(minutes)}${minute} ${n(remainingSeconds)}${second}`;
  }
  return `${n(minutes)}${minute}`;
}
