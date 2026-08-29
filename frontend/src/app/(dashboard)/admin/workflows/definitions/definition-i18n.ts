import {
  workflowDefinitionStatusConfig,
  workflowStatusConfig,
  type StatusConfig,
} from '@/lib/status-configs';
import type { FilterConfig } from '@/types/table';

const DEFINITION_LABELS = {
  en: {
    columns: {
      name: 'Name',
      category: 'Category',
      status: 'Status',
      version: 'Version',
      trigger: 'Trigger',
      steps: 'Steps',
      instances: 'Instances',
      lastUpdated: 'Last Updated',
    },
    actions: {
      edit: 'Edit',
      view: 'View',
      publish: 'Publish',
      archive: 'Archive',
      clone: 'Clone',
      delete: 'Delete',
      viewDetails: 'View Details',
      cancel: 'Cancel',
      retry: 'Retry',
    },
    defaults: {
      workflowName: 'Untitled Workflow',
      startStep: 'Start',
      endStep: 'End',
    },
    filters: {
      status: 'Status',
      category: 'Category',
      started: 'Started',
    },
    definitionStatus: {
      draft: 'Draft',
      active: 'Active',
      archived: 'Archived',
      deprecated: 'Deprecated',
    },
    workflowStatus: {
      running: 'Running',
      completed: 'Completed',
      failed: 'Failed',
      cancelled: 'Cancelled',
      suspended: 'Suspended',
    },
    category: {
      approval: 'Approval',
      onboarding: 'Onboarding',
      review: 'Review',
      escalation: 'Escalation',
      notification: 'Notification',
      data_pipeline: 'Data Pipeline',
      compliance: 'Compliance',
      custom: 'Custom',
    },
    trigger: {
      manual: 'Manual',
      event: 'Event',
      schedule: 'Schedule',
      webhook: 'Webhook',
    },
    variableType: {
      string: 'String',
      number: 'Number',
      boolean: 'Boolean',
      object: 'Object',
      array: 'Array',
    },
    instances: {
      workflow: 'Workflow',
      currentStep: 'Current Step',
      completedSteps: (count: number) => `Completed (${count} steps)`,
      failedAt: 'Failed at:',
      unknownStep: 'Unknown step',
      stepOf: (step: number, total: number) => `Step ${step} of ${total}`,
      started: 'Started',
      duration: 'Duration',
      startedBy: 'Started By',
      system: 'System',
    },
    designer: {
      loadDefinitionFailed: 'Failed to load workflow definition',
      readOnly: 'Read-only',
      editing: 'Editing',
      simulate: 'Simulate',
      versions: 'Versions',
      workflowSettings: 'Workflow Settings',
      undo: 'Undo',
      undoTitle: 'Undo (Ctrl+Z)',
      redo: 'Redo',
      redoTitle: 'Redo (Ctrl+Shift+Z)',
      fitToScreen: 'Fit to screen',
      autoLayout: 'Auto layout',
      saveDraft: 'Save Draft',
      publish: 'Publish',
      noSteps: 'No steps yet',
      noStepsReadonly: 'This workflow has no steps defined.',
      noStepsEditable: 'Drag steps from the palette or click to add.',
      valid: 'Workflow is valid',
      validation: 'Validation',
      closeValidation: 'Close validation panel',
      show: 'Show',
      hide: 'Hide',
      unknownStep: 'Unknown',
      errorsWarnings: (errors: number, warnings: number) =>
        `${errors} error${errors === 1 ? '' : 's'}, ${warnings} warning${warnings === 1 ? '' : 's'}`,
    },
    stepType: {
      approval: 'Approval',
      approval_chain: 'Approval Chain',
      review: 'Review',
      task: 'Task',
      notification: 'Notification',
      condition: 'Condition',
      parallel_gateway: 'Parallel Fork',
      join_gateway: 'Parallel Join',
      delay: 'Delay',
      webhook: 'Webhook',
      script: 'Script',
      sub_workflow: 'Sub-workflow',
      end: 'End',
      human_task: 'Human Task',
      service_task: 'Service Task',
      event_task: 'Event Task',
      timer: 'Timer',
    },
    assigneeStrategy: {
      specific_user: 'User',
      role: 'Role',
      manager_of: 'Manager',
      round_robin: 'Round Robin',
      least_loaded: 'Least Loaded',
    },
    approvalType: {
      single: 'Single',
      unanimous: 'Unanimous',
      majority: 'Majority',
    },
    approvalMode: {
      sequential: 'Sequential',
      parallel: 'Parallel',
    },
    channel: {
      email: 'Email',
      in_app: 'In app',
      webhook: 'Webhook',
    },
    lint: {
      danglingTransition: 'Transition to a step that no longer exists.',
      unreachableCycle: 'Unreachable — only reachable through a cycle with no entry point.',
      orphanStep: 'Orphan step — no transitions in or out.',
      noEndStep: 'Workflow has no end step — it may never complete.',
      nonEndLeaf: 'No outgoing transition and not an end step — execution stops here.',
      approvalNoRole: 'Approval step has no assignee role configured.',
      humanNoRole: 'Human step has no assignee role configured.',
      approvalChainNoApprovers: 'Approval chain has no approvers configured.',
      approvalChainEmptyReference: 'Approval chain has an approver with an empty reference.',
      quorumNoCount: 'Quorum is "n of m" but no quorum count is set.',
      webhookNoUrl: 'Webhook step has no URL configured.',
      subWorkflowNoTarget: 'Sub-workflow step has no target workflow configured.',
      scriptNoScript: 'Script step has no script configured.',
      notificationNoChannels: 'Notification step has no channels selected.',
    },
    aria: {
      removeApprover: (index: number) => `Remove approver ${index}`,
      removeVariable: (index: number) => `Remove variable ${index}`,
      workflowStep: (name: string) => `Workflow step: ${name}`,
      ruleParam: (kind: string) => `Rule ${kind} param`,
      removeRule: (kind: string) => `Remove ${kind} rule`,
      ruleMessageAr: (kind: string) => `Rule ${kind} message Arabic`,
      ruleMessageEn: (kind: string) => `Rule ${kind} message English`,
    },
    simulation: {
      unexpectedError: 'Unexpected error',
    },
    promotion: {
      stage: {
        dev: 'Dev',
        staging: 'Staging',
        prod: 'Prod',
      },
      promotedTo: (stage: string) => `Promoted to ${stage}.`,
    },
  },
  ar: {
    columns: {
      name: 'الاسم',
      category: 'الفئة',
      status: 'الحالة',
      version: 'الإصدار',
      trigger: 'المُشغّل',
      steps: 'الخطوات',
      instances: 'النسخ',
      lastUpdated: 'آخر تحديث',
    },
    actions: {
      edit: 'تعديل',
      view: 'عرض',
      publish: 'نشر',
      archive: 'أرشفة',
      clone: 'استنساخ',
      delete: 'حذف',
      viewDetails: 'عرض التفاصيل',
      cancel: 'إلغاء',
      retry: 'إعادة المحاولة',
    },
    defaults: {
      workflowName: 'سير عمل بدون عنوان',
      startStep: 'البداية',
      endStep: 'النهاية',
    },
    filters: {
      status: 'الحالة',
      category: 'الفئة',
      started: 'بدأ في',
    },
    definitionStatus: {
      draft: 'مسودة',
      active: 'نشط',
      archived: 'مؤرشف',
      deprecated: 'متقادم',
    },
    workflowStatus: {
      running: 'قيد التشغيل',
      completed: 'مكتمل',
      failed: 'فشل',
      cancelled: 'ملغى',
      suspended: 'معلّق',
    },
    category: {
      approval: 'اعتماد',
      onboarding: 'تهيئة الانضمام',
      review: 'مراجعة',
      escalation: 'تصعيد',
      notification: 'إشعار',
      data_pipeline: 'مسار بيانات',
      compliance: 'امتثال',
      custom: 'مخصّص',
    },
    trigger: {
      manual: 'يدوي',
      event: 'حدث',
      schedule: 'مجدول',
      webhook: 'خطاف ويب',
    },
    variableType: {
      string: 'نص',
      number: 'رقم',
      boolean: 'منطقي',
      object: 'كائن',
      array: 'مصفوفة',
    },
    instances: {
      workflow: 'سير العمل',
      currentStep: 'الخطوة الحالية',
      completedSteps: (count: number) => `اكتمل (${count} خطوة)`,
      failedAt: 'فشل عند:',
      unknownStep: 'خطوة غير معروفة',
      stepOf: (step: number, total: number) => `الخطوة ${step} من ${total}`,
      started: 'بدأ في',
      duration: 'المدة',
      startedBy: 'بدأ بواسطة',
      system: 'النظام',
    },
    designer: {
      loadDefinitionFailed: 'تعذّر تحميل تعريف سير العمل',
      readOnly: 'للقراءة فقط',
      editing: 'قيد التعديل',
      simulate: 'محاكاة',
      versions: 'الإصدارات',
      workflowSettings: 'إعدادات سير العمل',
      undo: 'تراجع',
      undoTitle: 'تراجع (Ctrl+Z)',
      redo: 'إعادة',
      redoTitle: 'إعادة (Ctrl+Shift+Z)',
      fitToScreen: 'ملاءمة الشاشة',
      autoLayout: 'ترتيب تلقائي',
      saveDraft: 'حفظ المسودة',
      publish: 'نشر',
      noSteps: 'لا توجد خطوات بعد',
      noStepsReadonly: 'لا توجد خطوات معرّفة لسير العمل هذا.',
      noStepsEditable: 'اسحب الخطوات من اللوحة أو انقر لإضافتها.',
      valid: 'سير العمل صالح',
      validation: 'التحقق',
      closeValidation: 'إغلاق لوحة التحقق',
      show: 'عرض',
      hide: 'إخفاء',
      unknownStep: 'غير معروف',
      errorsWarnings: (errors: number, warnings: number) =>
        `${errors} خطأ، ${warnings} تحذير`,
    },
    stepType: {
      approval: 'اعتماد',
      approval_chain: 'سلسلة الموافقات',
      review: 'مراجعة',
      task: 'مهمة',
      notification: 'إشعار',
      condition: 'شرط',
      parallel_gateway: 'تفرع متوازٍ',
      join_gateway: 'دمج متوازٍ',
      delay: 'تأخير',
      webhook: 'خطاف ويب',
      script: 'برنامج نصي',
      sub_workflow: 'سير عمل فرعي',
      end: 'نهاية',
      human_task: 'مهمة بشرية',
      service_task: 'مهمة خدمة',
      event_task: 'مهمة حدث',
      timer: 'مؤقت',
    },
    assigneeStrategy: {
      specific_user: 'مستخدم',
      role: 'دور',
      manager_of: 'المدير',
      round_robin: 'بالتناوب',
      least_loaded: 'الأقل حملاً',
    },
    approvalType: {
      single: 'مفرد',
      unanimous: 'بالإجماع',
      majority: 'بالأغلبية',
    },
    approvalMode: {
      sequential: 'تسلسلي',
      parallel: 'متوازٍ',
    },
    channel: {
      email: 'بريد إلكتروني',
      in_app: 'داخل التطبيق',
      webhook: 'خطاف ويب',
    },
    lint: {
      danglingTransition: 'ينتقل إلى خطوة لم تعد موجودة.',
      unreachableCycle: 'لا يمكن الوصول إليها — لا يمكن بلوغها إلا عبر دورة بلا نقطة دخول.',
      orphanStep: 'خطوة معزولة — لا توجد انتقالات داخلة أو خارجة.',
      noEndStep: 'لا يحتوي سير العمل على خطوة نهاية — قد لا يكتمل أبدًا.',
      nonEndLeaf: 'لا يوجد انتقال صادر وليست خطوة نهاية — سيتوقف التنفيذ هنا.',
      approvalNoRole: 'خطوة الاعتماد بلا دور مُسنَد مهيّأ.',
      humanNoRole: 'الخطوة البشرية بلا دور مُسنَد مهيّأ.',
      approvalChainNoApprovers: 'سلسلة الموافقات بلا معتمدين مهيّأين.',
      approvalChainEmptyReference: 'تحتوي سلسلة الموافقات على معتمد بمرجع فارغ.',
      quorumNoCount: 'النصاب هو "n of m" لكن لم يُحدَّد عدد النصاب.',
      webhookNoUrl: 'خطوة خطاف الويب بلا URL مهيّأ.',
      subWorkflowNoTarget: 'خطوة سير العمل الفرعي بلا سير عمل هدف مهيّأ.',
      scriptNoScript: 'خطوة البرنامج النصي بلا برنامج نصي مهيّأ.',
      notificationNoChannels: 'خطوة الإشعار بلا قنوات محددة.',
    },
    aria: {
      removeApprover: (index: number) => `إزالة المعتمد ${index}`,
      removeVariable: (index: number) => `إزالة المتغير ${index}`,
      workflowStep: (name: string) => `خطوة سير العمل: ${name}`,
      ruleParam: (kind: string) => `معامل قاعدة ${kind}`,
      removeRule: (kind: string) => `إزالة قاعدة ${kind}`,
      ruleMessageAr: (kind: string) => `رسالة قاعدة ${kind} بالعربية`,
      ruleMessageEn: (kind: string) => `رسالة قاعدة ${kind} بالإنجليزية`,
    },
    simulation: {
      unexpectedError: 'خطأ غير متوقع',
    },
    promotion: {
      stage: {
        dev: 'تطوير',
        staging: 'تجهيز',
        prod: 'إنتاج',
      },
      promotedTo: (stage: string) => `تمت الترقية إلى ${stage}.`,
    },
  },
};

export type DefinitionLabels = typeof DEFINITION_LABELS.en;

export function getDefinitionLabels(locale: string): DefinitionLabels {
  return locale === 'ar' ? DEFINITION_LABELS.ar : DEFINITION_LABELS.en;
}

function localizeStatusConfig(config: StatusConfig, labels: Record<string, string>): StatusConfig {
  return Object.fromEntries(
    Object.entries(config).map(([key, value]) => [
      key,
      { ...value, label: labels[key] ?? value.label },
    ]),
  );
}

export function getDefinitionStatusConfig(locale: string): StatusConfig {
  return localizeStatusConfig(
    workflowDefinitionStatusConfig,
    getDefinitionLabels(locale).definitionStatus,
  );
}

export function getWorkflowInstanceStatusConfig(locale: string): StatusConfig {
  return localizeStatusConfig(workflowStatusConfig, getDefinitionLabels(locale).workflowStatus);
}

export function getDefinitionFilters(locale: string): FilterConfig[] {
  const labels = getDefinitionLabels(locale);
  return [
    {
      key: 'status',
      label: labels.filters.status,
      type: 'multi-select',
      options: [
        { label: labels.definitionStatus.draft, value: 'draft' },
        { label: labels.definitionStatus.active, value: 'active' },
        { label: labels.definitionStatus.archived, value: 'archived' },
        { label: labels.definitionStatus.deprecated, value: 'deprecated' },
      ],
    },
    {
      key: 'category',
      label: labels.filters.category,
      type: 'multi-select',
      options: [
        { label: labels.category.approval, value: 'approval' },
        { label: labels.category.onboarding, value: 'onboarding' },
        { label: labels.category.review, value: 'review' },
        { label: labels.category.escalation, value: 'escalation' },
        { label: labels.category.notification, value: 'notification' },
        { label: labels.category.data_pipeline, value: 'data_pipeline' },
        { label: labels.category.compliance, value: 'compliance' },
        { label: labels.category.custom, value: 'custom' },
      ],
    },
  ];
}

export function getDefinitionInstanceFilters(locale: string): FilterConfig[] {
  const labels = getDefinitionLabels(locale);
  return [
    {
      key: 'status',
      label: labels.filters.status,
      type: 'multi-select',
      options: [
        { label: labels.workflowStatus.running, value: 'running' },
        { label: labels.workflowStatus.completed, value: 'completed' },
        { label: labels.workflowStatus.failed, value: 'failed' },
        { label: labels.workflowStatus.cancelled, value: 'cancelled' },
        { label: labels.workflowStatus.suspended, value: 'suspended' },
      ],
    },
    {
      key: 'started_at',
      label: labels.filters.started,
      type: 'date-range',
    },
  ];
}

export function formatCategoryLabel(value: string | undefined, locale: string): string {
  if (!value) return '';
  return getDefinitionLabels(locale).category[value as keyof DefinitionLabels['category']] ?? value;
}

export function formatDefinitionStatusLabel(value: string, locale: string): string {
  return getDefinitionLabels(locale).definitionStatus[
    value as keyof DefinitionLabels['definitionStatus']
  ] ?? value;
}

export function formatWorkflowStatusLabel(value: string, locale: string): string {
  return getDefinitionLabels(locale).workflowStatus[
    value as keyof DefinitionLabels['workflowStatus']
  ] ?? value;
}

export function formatTriggerLabel(value: string, locale: string): string {
  return getDefinitionLabels(locale).trigger[value as keyof DefinitionLabels['trigger']] ?? value;
}

export function formatVariableTypeLabel(value: string, locale: string): string {
  return getDefinitionLabels(locale).variableType[
    value as keyof DefinitionLabels['variableType']
  ] ?? value;
}

export function formatStepTypeLabel(value: string, locale: string): string {
  return getDefinitionLabels(locale).stepType[value as keyof DefinitionLabels['stepType']] ?? value;
}

export function formatAssigneeStrategyLabel(value: string | undefined, locale: string): string | null {
  if (!value) return null;
  return getDefinitionLabels(locale).assigneeStrategy[
    value as keyof DefinitionLabels['assigneeStrategy']
  ] ?? value;
}

export function formatApprovalTypeLabel(value: string | undefined, locale: string): string | null {
  if (!value) return null;
  return getDefinitionLabels(locale).approvalType[
    value as keyof DefinitionLabels['approvalType']
  ] ?? value;
}

export function formatApprovalModeLabel(value: string | undefined, locale: string): string | null {
  if (!value) return null;
  return getDefinitionLabels(locale).approvalMode[
    value as keyof DefinitionLabels['approvalMode']
  ] ?? value;
}

export function formatChannelLabel(value: string, locale: string): string {
  return getDefinitionLabels(locale).channel[value as keyof DefinitionLabels['channel']] ?? value;
}

export function formatPromotionStageLabel(value: string, locale: string): string {
  return getDefinitionLabels(locale).promotion.stage[
    value as keyof DefinitionLabels['promotion']['stage']
  ] ?? value;
}

export function formatDurationLabel(seconds: number, locale: string): string {
  if (seconds < 60) {
    return `${seconds}${locale === 'ar' ? 'ث' : 's'}`;
  }
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  const h = locale === 'ar' ? 'س' : 'h';
  const m = locale === 'ar' ? 'د' : 'm';
  const s = locale === 'ar' ? 'ث' : 's';

  if (hours > 0) {
    if (minutes > 0) {
      return `${hours}${h} ${minutes}${m}`;
    }
    return `${hours}${h}`;
  }
  if (remainingSeconds > 0) {
    return `${minutes}${m} ${remainingSeconds}${s}`;
  }
  return `${minutes}${m}`;
}
