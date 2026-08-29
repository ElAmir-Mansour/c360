/**
 * Bilingual (English + Modern Standard Arabic) label foundation for the
 * Clario360 Cyber *Remediation* area (`/cyber/remediation/**`).
 *
 * Mirrors the shared `cyber-i18n.ts` `{ en, ar }` bundle pattern. Components read
 * the resolved `T` from `useRemediationLabels()`; the `en` side equals the
 * pre-existing English strings exactly. Acronyms / product names stay as-is:
 * CVE, CISO, IP, UUID.
 */

'use client';

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import {
  resolveCyberBilingual,
  type CyberBilingual,
} from '../../_lib/cyber-i18n';

export interface RemediationLabels {
  // ---- list page ----
  list: {
    title: string;
    description: string;
    newAction: string;
    kpiPendingApproval: string;
    kpiExecuting: string;
    kpiTotalActions: string;
    kpiVerifiedClosed: string;
    byStatus: string;
    statusPending: string;
    statusExecuting: string;
    statusVerified: string;
    statusFailed: string;
    statusRolledBack: string;
    statusClosed: string;
    issues: (count: number) => string;
    loadError: string;
    searchPlaceholder: string;
    emptyTitle: string;
    emptyDescription: string;
    filterStatus: string;
    filterSeverity: string;
    filterType: string;
  };
  // ---- table columns + row actions ----
  columns: {
    severity: string;
    remediation: string;
    status: string;
    reversible: string;
    createdBy: string;
    created: string;
    yes: string;
    no: string;
    actionsAria: string;
    approve: string;
    execute: string;
    viewDetails: string;
  };
  // ---- lifecycle status enum ----
  lifecycleStatus: Record<string, string>;
  // ---- create dialog ----
  create: {
    title: string;
    description: string;
    titleField: string;
    titlePlaceholder: string;
    descriptionField: string;
    descriptionPlaceholder: string;
    type: string;
    severity: string;
    executionMode: string;
    manual: string;
    semiAutomated: string;
    automated: string;
    requiresApprovalFrom: string;
    securityManager: string;
    ciso: string;
    tenantAdmin: string;
    linkedAlertId: string;
    linkedAlertPlaceholder: string;
    linkedVulnId: string;
    linkedVulnPlaceholder: string;
    remediationSteps: string;
    addStep: string;
    stepLabel: (n: number) => string;
    removeStep: (n: number) => string;
    stepActionPlaceholder: string;
    stepTargetPlaceholder: string;
    stepDescriptionPlaceholder: string;
    cancel: string;
    creating: string;
    createAction: string;
    createdToast: string;
    titleMin: string;
    descriptionMin: string;
    actionRequired: string;
    stepRequired: string;
  };
  // ---- approve/reject dialog ----
  approve: {
    approveTitle: string;
    rejectTitle: string;
    remediationWord: string;
    approvePrefix: string;
    rejectPrefix: string;
    approveNotes: string;
    rejectReason: string;
    approveNotesPlaceholder: string;
    rejectReasonPlaceholder: string;
    cancel: string;
    approving: string;
    rejecting: string;
    approve: string;
    reject: string;
    approvedToast: string;
    rejectedToast: string;
    rejectionReasonRequired: string;
  };
  // ---- rollback dialog ----
  rollback: {
    title: string;
    description: (name: string) => string;
    warningBody: string;
    reasonLabel: string;
    reasonPlaceholder: string;
    confirmPromptPrefix: string;
    confirmPromptWord: string;
    confirmPromptSuffix: string;
    confirmPlaceholder: string;
    cancel: string;
    rollingBack: string;
    confirmRollback: string;
    initiatedToast: string;
  };
  // ---- detail page ----
  detail: {
    loadError: string;
    submitForApproval: string;
    submitting: string;
    reject: string;
    approve: string;
    dryRun: string;
    running: string;
    execute: string;
    executing: string;
    rollback: string;
    descriptionTitle: string;
    executionPlanTitle: string;
    targetPrefix: string;
    reversible: string;
    irreversible: string;
    requiresReboot: string;
    riskPrefix: string;
    downtimePrefix: string;
    executionResultTitle: string;
    success: string;
    failed: string;
    stepsExecuted: string;
    changesApplied: string;
    duration: string;
    appliedChanges: string;
    changeOn: (assetId: string) => string;
    before: string;
    after: string;
    verificationTitle: string;
    passed: string;
    expected: string;
    actual: string;
    auditTrailTitle: string;
    systemActor: string;
    detailsTitle: string;
    dStatus: string;
    dSeverity: string;
    dType: string;
    dExecutionMode: string;
    dCreatedBy: string;
    dCreated: string;
    approvalTitle: string;
    approvedByPrefix: string;
    rejectedTitle: string;
    rejectedByPrefix: string;
    rollbackWindowTitle: string;
    rollbackExpires: (when: string) => string;
    tagsTitle: string;
    linkedItemsTitle: string;
    linkAlert: string;
    linkVulnerability: string;
    submittedToast: string;
    dryRunStartedToast: string;
    executionStartedToast: string;
  };
  // ---- dry-run results panel ----
  dryRun: {
    succeeded: string;
    failed: string;
    summary: (changes: number, seconds: string) => string;
    blockers: string;
    warnings: string;
    simulatedChanges: string;
    estimatedImpact: string;
    downtime: string;
    servicesAffected: string;
    riskLevel: string;
    recommendedWindow: string;
  };
  // ---- execution results panel ----
  execution: {
    title: string;
    success: string;
    failed: string;
    completedIn: (seconds: string) => string;
    stepsExecuted: string;
    changesApplied: string;
    steps: string;
    showMore: string;
    showLess: string;
    before: string;
    after: string;
  };
  // ---- verification results panel ----
  verification: {
    title: string;
    verified: string;
    failed: string;
    completedIn: (seconds: string) => string;
    checks: (passed: number, total: number) => string;
    expected: string;
    actual: string;
    failureReason: string;
  };
  // ---- audit trail timeline ----
  auditTimeline: {
    empty: string;
    systemActor: string;
  };
}

export const remediationLabels: CyberBilingual<RemediationLabels> = {
  en: {
    list: {
      title: 'Remediation',
      description: 'Track and orchestrate security remediation actions through their full lifecycle',
      newAction: 'New Action',
      kpiPendingApproval: 'Pending Approval',
      kpiExecuting: 'Executing',
      kpiTotalActions: 'Total Actions',
      kpiVerifiedClosed: 'Verified & Closed',
      byStatus: 'By Status',
      statusPending: 'Pending',
      statusExecuting: 'Executing',
      statusVerified: 'Verified',
      statusFailed: 'Failed',
      statusRolledBack: 'Rolled Back',
      statusClosed: 'Closed',
      issues: (count) => `${count} issue(s)`,
      loadError: 'Failed to load remediation actions',
      searchPlaceholder: 'Search remediation actions…',
      emptyTitle: 'No remediation actions',
      emptyDescription: 'Create your first remediation action to start tracking security fixes.',
      filterStatus: 'Status',
      filterSeverity: 'Severity',
      filterType: 'Type',
    },
    columns: {
      severity: 'Severity',
      remediation: 'Remediation',
      status: 'Status',
      reversible: 'Reversible',
      createdBy: 'Created By',
      created: 'Created',
      yes: '✓ Yes',
      no: '✗ No',
      actionsAria: 'Remediation actions',
      approve: 'Approve',
      execute: 'Execute',
      viewDetails: 'View Details',
    },
    lifecycleStatus: {
      draft: 'Draft',
      pending_approval: 'Pending Approval',
      approved: 'Approved',
      rejected: 'Rejected',
      revision_requested: 'Revision Requested',
      dry_run_running: 'Dry Run…',
      dry_run_completed: 'Dry Run OK',
      dry_run_failed: 'Dry Run Failed',
      execution_pending: 'Execution Pending',
      executing: 'Executing…',
      executed: 'Executed',
      execution_failed: 'Execution Failed',
      verification_pending: 'Verifying…',
      verified: 'Verified',
      verification_failed: 'Verification Failed',
      rollback_pending: 'Rollback Pending',
      rolling_back: 'Rolling Back…',
      rolled_back: 'Rolled Back',
      rollback_failed: 'Rollback Failed',
      closed: 'Closed',
    },
    create: {
      title: 'Create Remediation Action',
      description: 'Define a structured remediation plan with step-by-step execution.',
      titleField: 'Title',
      titlePlaceholder: 'Apply security patch CVE-2024-1234',
      descriptionField: 'Description',
      descriptionPlaceholder: 'What will this remediation accomplish?',
      type: 'Type',
      severity: 'Severity',
      executionMode: 'Execution Mode',
      manual: 'Manual',
      semiAutomated: 'Semi-Automated',
      automated: 'Automated',
      requiresApprovalFrom: 'Requires Approval From',
      securityManager: 'Security Manager',
      ciso: 'CISO',
      tenantAdmin: 'Tenant Admin',
      linkedAlertId: 'Linked alert',
      linkedAlertPlaceholder: 'Select an alert (optional)',
      linkedVulnId: 'Linked vulnerability',
      linkedVulnPlaceholder: 'Select a vulnerability (optional)',
      remediationSteps: 'Remediation Steps',
      addStep: 'Add Step',
      stepLabel: (n) => `Step ${n}`,
      removeStep: (n) => `Remove step ${n}`,
      stepActionPlaceholder: 'Action (e.g. Run apt-get upgrade)',
      stepTargetPlaceholder: 'Target host or resource (optional)',
      stepDescriptionPlaceholder: 'Additional description (optional)',
      cancel: 'Cancel',
      creating: 'Creating…',
      createAction: 'Create Action',
      createdToast: 'Remediation action created',
      titleMin: 'Title must be at least 3 characters',
      descriptionMin: 'Description must be at least 10 characters',
      actionRequired: 'Action is required',
      stepRequired: 'At least one step is required',
    },
    approve: {
      approveTitle: 'Approve Remediation',
      rejectTitle: 'Reject Remediation',
      remediationWord: 'Remediation',
      approvePrefix: 'Approve: ',
      rejectPrefix: 'Reject: ',
      approveNotes: 'Approval Notes',
      rejectReason: 'Rejection Reason',
      approveNotesPlaceholder: 'Any conditions or notes…',
      rejectReasonPlaceholder: 'Why is this being rejected?',
      cancel: 'Cancel',
      approving: 'Approving…',
      rejecting: 'Rejecting…',
      approve: 'Approve',
      reject: 'Reject',
      approvedToast: 'Action approved',
      rejectedToast: 'Action rejected',
      rejectionReasonRequired: 'Rejection reason is required',
    },
    rollback: {
      title: 'Rollback Remediation',
      description: (name) => `Rolling back ${name} will attempt to restore pre-execution state. This action requires elevated confirmation.`,
      warningBody: 'Rollback may cause temporary service disruption. Ensure a maintenance window is in place before proceeding.',
      reasonLabel: 'Reason for Rollback',
      reasonPlaceholder: 'Describe why this remediation needs to be rolled back…',
      confirmPromptPrefix: 'Type ',
      confirmPromptWord: 'ROLLBACK',
      confirmPromptSuffix: ' to confirm',
      confirmPlaceholder: 'ROLLBACK',
      cancel: 'Cancel',
      rollingBack: 'Rolling Back…',
      confirmRollback: 'Confirm Rollback',
      initiatedToast: 'Rollback initiated',
    },
    detail: {
      loadError: 'Failed to load remediation action',
      submitForApproval: 'Submit for Approval',
      submitting: 'Submitting…',
      reject: 'Reject',
      approve: 'Approve',
      dryRun: 'Dry Run',
      running: 'Running…',
      execute: 'Execute',
      executing: 'Executing…',
      rollback: 'Rollback',
      descriptionTitle: 'Description',
      executionPlanTitle: 'Execution Plan',
      targetPrefix: 'Target: ',
      reversible: '✓ Reversible',
      irreversible: '✗ Irreversible',
      requiresReboot: '⚠ Requires reboot',
      riskPrefix: 'Risk: ',
      downtimePrefix: 'Downtime: ',
      executionResultTitle: 'Execution Result',
      success: 'Success',
      failed: 'Failed',
      stepsExecuted: 'Steps Executed',
      changesApplied: 'Changes Applied',
      duration: 'Duration',
      appliedChanges: 'Applied Changes',
      changeOn: (assetId) => `on ${assetId}`,
      before: 'Before: ',
      after: 'After: ',
      verificationTitle: 'Verification',
      passed: 'Passed',
      expected: 'Expected: ',
      actual: 'Actual: ',
      auditTrailTitle: 'Audit Trail',
      systemActor: 'System',
      detailsTitle: 'Details',
      dStatus: 'Status',
      dSeverity: 'Severity',
      dType: 'Type',
      dExecutionMode: 'Execution Mode',
      dCreatedBy: 'Created By',
      dCreated: 'Created',
      approvalTitle: 'Approval',
      approvedByPrefix: 'Approved by ',
      rejectedTitle: 'Rejected',
      rejectedByPrefix: 'By ',
      rollbackWindowTitle: 'Rollback Window',
      rollbackExpires: (when) => `Expires: ${when}`,
      tagsTitle: 'Tags',
      linkedItemsTitle: 'Linked Items',
      linkAlert: 'Alert',
      linkVulnerability: 'Vulnerability',
      submittedToast: 'Submitted for approval',
      dryRunStartedToast: 'Dry run started',
      executionStartedToast: 'Execution started',
    },
    dryRun: {
      succeeded: 'Dry Run Succeeded',
      failed: 'Dry Run Failed',
      summary: (changes, seconds) => `${changes} changes simulated in ${seconds}s`,
      blockers: 'Blockers',
      warnings: 'Warnings',
      simulatedChanges: 'Simulated Changes',
      estimatedImpact: 'Estimated Impact',
      downtime: 'Downtime',
      servicesAffected: 'Services Affected',
      riskLevel: 'Risk Level',
      recommendedWindow: 'Recommended Window',
    },
    execution: {
      title: 'Execution Results',
      success: 'Success',
      failed: 'Failed',
      completedIn: (seconds) => `Completed in ${seconds}s`,
      stepsExecuted: 'Steps Executed',
      changesApplied: 'Changes Applied',
      steps: 'Steps',
      showMore: 'Show more',
      showLess: 'Show less',
      before: 'Before',
      after: 'After',
    },
    verification: {
      title: 'Verification Results',
      verified: 'Verified',
      failed: 'Failed',
      completedIn: (seconds) => `Completed in ${seconds}s`,
      checks: (passed, total) => `Checks (${passed}/${total} passed)`,
      expected: 'Expected',
      actual: 'Actual',
      failureReason: 'Failure Reason',
    },
    auditTimeline: {
      empty: 'No audit trail available',
      systemActor: 'System',
    },
  },
  ar: {
    list: {
      title: 'المعالجة',
      description: 'تتبّع وتنسيق إجراءات المعالجة الأمنية عبر دورة حياتها الكاملة',
      newAction: 'إجراء جديد',
      kpiPendingApproval: 'بانتظار الموافقة',
      kpiExecuting: 'قيد التنفيذ',
      kpiTotalActions: 'إجمالي الإجراءات',
      kpiVerifiedClosed: 'المُتحقَّق منها والمُغلقة',
      byStatus: 'حسب الحالة',
      statusPending: 'معلّق',
      statusExecuting: 'قيد التنفيذ',
      statusVerified: 'مُتحقَّق منه',
      statusFailed: 'فشل',
      statusRolledBack: 'تم التراجع',
      statusClosed: 'مُغلق',
      issues: (count) => `${count} مشكلة`,
      loadError: 'تعذّر تحميل إجراءات المعالجة',
      searchPlaceholder: 'البحث في إجراءات المعالجة…',
      emptyTitle: 'لا توجد إجراءات معالجة',
      emptyDescription: 'أنشئ أول إجراء معالجة لبدء تتبّع الإصلاحات الأمنية.',
      filterStatus: 'الحالة',
      filterSeverity: 'الخطورة',
      filterType: 'النوع',
    },
    columns: {
      severity: 'الخطورة',
      remediation: 'المعالجة',
      status: 'الحالة',
      reversible: 'قابل للتراجع',
      createdBy: 'أنشأه',
      created: 'أُنشئ في',
      yes: '✓ نعم',
      no: '✗ لا',
      actionsAria: 'إجراءات المعالجة',
      approve: 'موافقة',
      execute: 'تنفيذ',
      viewDetails: 'عرض التفاصيل',
    },
    lifecycleStatus: {
      draft: 'مسودة',
      pending_approval: 'بانتظار الموافقة',
      approved: 'مُعتمد',
      rejected: 'مرفوض',
      revision_requested: 'مطلوب مراجعة',
      dry_run_running: 'تشغيل تجريبي…',
      dry_run_completed: 'التشغيل التجريبي ناجح',
      dry_run_failed: 'فشل التشغيل التجريبي',
      execution_pending: 'بانتظار التنفيذ',
      executing: 'قيد التنفيذ…',
      executed: 'تم التنفيذ',
      execution_failed: 'فشل التنفيذ',
      verification_pending: 'جارٍ التحقق…',
      verified: 'مُتحقَّق منه',
      verification_failed: 'فشل التحقق',
      rollback_pending: 'بانتظار التراجع',
      rolling_back: 'جارٍ التراجع…',
      rolled_back: 'تم التراجع',
      rollback_failed: 'فشل التراجع',
      closed: 'مُغلق',
    },
    create: {
      title: 'إنشاء إجراء معالجة',
      description: 'حدّد خطة معالجة منظَّمة بتنفيذ خطوة بخطوة.',
      titleField: 'العنوان',
      titlePlaceholder: 'تطبيق رقعة أمنية CVE-2024-1234',
      descriptionField: 'الوصف',
      descriptionPlaceholder: 'ماذا ستحقّق هذه المعالجة؟',
      type: 'النوع',
      severity: 'الخطورة',
      executionMode: 'وضع التنفيذ',
      manual: 'يدوي',
      semiAutomated: 'شبه آلي',
      automated: 'آلي',
      requiresApprovalFrom: 'يتطلب موافقة من',
      securityManager: 'مدير الأمن',
      ciso: 'CISO',
      tenantAdmin: 'مسؤول المستأجر',
      linkedAlertId: 'التنبيه المرتبط',
      linkedAlertPlaceholder: 'اختر تنبيهًا (اختياري)',
      linkedVulnId: 'الثغرة المرتبطة',
      linkedVulnPlaceholder: 'اختر ثغرة (اختياري)',
      remediationSteps: 'خطوات المعالجة',
      addStep: 'إضافة خطوة',
      stepLabel: (n) => `الخطوة ${n}`,
      removeStep: (n) => `إزالة الخطوة ${n}`,
      stepActionPlaceholder: 'الإجراء (مثال: تشغيل apt-get upgrade)',
      stepTargetPlaceholder: 'المضيف أو المورد الهدف (اختياري)',
      stepDescriptionPlaceholder: 'وصف إضافي (اختياري)',
      cancel: 'إلغاء',
      creating: 'جارٍ الإنشاء…',
      createAction: 'إنشاء إجراء',
      createdToast: 'تم إنشاء إجراء المعالجة',
      titleMin: 'يجب ألا يقل العنوان عن 3 أحرف',
      descriptionMin: 'يجب ألا يقل الوصف عن 10 أحرف',
      actionRequired: 'الإجراء مطلوب',
      stepRequired: 'مطلوب خطوة واحدة على الأقل',
    },
    approve: {
      approveTitle: 'الموافقة على المعالجة',
      rejectTitle: 'رفض المعالجة',
      remediationWord: 'المعالجة',
      approvePrefix: 'موافقة: ',
      rejectPrefix: 'رفض: ',
      approveNotes: 'ملاحظات الموافقة',
      rejectReason: 'سبب الرفض',
      approveNotesPlaceholder: 'أي شروط أو ملاحظات…',
      rejectReasonPlaceholder: 'لماذا يُرفض هذا؟',
      cancel: 'إلغاء',
      approving: 'جارٍ الموافقة…',
      rejecting: 'جارٍ الرفض…',
      approve: 'موافقة',
      reject: 'رفض',
      approvedToast: 'تمت الموافقة على الإجراء',
      rejectedToast: 'تم رفض الإجراء',
      rejectionReasonRequired: 'سبب الرفض مطلوب',
    },
    rollback: {
      title: 'التراجع عن المعالجة',
      description: (name) => `التراجع عن ${name} سيحاول استعادة الحالة قبل التنفيذ. يتطلب هذا الإجراء تأكيدًا مُعزَّزًا.`,
      warningBody: 'قد يتسبب التراجع في تعطّل مؤقت للخدمة. تأكد من وجود نافذة صيانة قبل المتابعة.',
      reasonLabel: 'سبب التراجع',
      reasonPlaceholder: 'صِف لماذا تحتاج هذه المعالجة إلى التراجع…',
      confirmPromptPrefix: 'اكتب ',
      confirmPromptWord: 'ROLLBACK',
      confirmPromptSuffix: ' للتأكيد',
      confirmPlaceholder: 'ROLLBACK',
      cancel: 'إلغاء',
      rollingBack: 'جارٍ التراجع…',
      confirmRollback: 'تأكيد التراجع',
      initiatedToast: 'تم بدء التراجع',
    },
    detail: {
      loadError: 'تعذّر تحميل إجراء المعالجة',
      submitForApproval: 'إرسال للموافقة',
      submitting: 'جارٍ الإرسال…',
      reject: 'رفض',
      approve: 'موافقة',
      dryRun: 'تشغيل تجريبي',
      running: 'جارٍ التشغيل…',
      execute: 'تنفيذ',
      executing: 'قيد التنفيذ…',
      rollback: 'تراجع',
      descriptionTitle: 'الوصف',
      executionPlanTitle: 'خطة التنفيذ',
      targetPrefix: 'الهدف: ',
      reversible: '✓ قابل للتراجع',
      irreversible: '✗ غير قابل للتراجع',
      requiresReboot: '⚠ يتطلب إعادة تشغيل',
      riskPrefix: 'المخاطر: ',
      downtimePrefix: 'التعطّل: ',
      executionResultTitle: 'نتيجة التنفيذ',
      success: 'نجاح',
      failed: 'فشل',
      stepsExecuted: 'الخطوات المنفَّذة',
      changesApplied: 'التغييرات المطبَّقة',
      duration: 'المدة',
      appliedChanges: 'التغييرات المطبَّقة',
      changeOn: (assetId) => `على ${assetId}`,
      before: 'قبل: ',
      after: 'بعد: ',
      verificationTitle: 'التحقق',
      passed: 'ناجح',
      expected: 'المتوقَّع: ',
      actual: 'الفعلي: ',
      auditTrailTitle: 'سجل التدقيق',
      systemActor: 'النظام',
      detailsTitle: 'التفاصيل',
      dStatus: 'الحالة',
      dSeverity: 'الخطورة',
      dType: 'النوع',
      dExecutionMode: 'وضع التنفيذ',
      dCreatedBy: 'أنشأه',
      dCreated: 'أُنشئ في',
      approvalTitle: 'الموافقة',
      approvedByPrefix: 'تمت الموافقة بواسطة ',
      rejectedTitle: 'مرفوض',
      rejectedByPrefix: 'بواسطة ',
      rollbackWindowTitle: 'نافذة التراجع',
      rollbackExpires: (when) => `تنتهي: ${when}`,
      tagsTitle: 'الوسوم',
      linkedItemsTitle: 'العناصر المرتبطة',
      linkAlert: 'التنبيه',
      linkVulnerability: 'الثغرة',
      submittedToast: 'تم الإرسال للموافقة',
      dryRunStartedToast: 'بدأ التشغيل التجريبي',
      executionStartedToast: 'بدأ التنفيذ',
    },
    dryRun: {
      succeeded: 'نجح التشغيل التجريبي',
      failed: 'فشل التشغيل التجريبي',
      summary: (changes, seconds) => `تمت محاكاة ${changes} تغيير خلال ${seconds} ثانية`,
      blockers: 'العوائق',
      warnings: 'التحذيرات',
      simulatedChanges: 'التغييرات المُحاكاة',
      estimatedImpact: 'الأثر المُقدَّر',
      downtime: 'التعطّل',
      servicesAffected: 'الخدمات المتأثرة',
      riskLevel: 'مستوى المخاطر',
      recommendedWindow: 'النافذة الموصى بها',
    },
    execution: {
      title: 'نتائج التنفيذ',
      success: 'نجاح',
      failed: 'فشل',
      completedIn: (seconds) => `اكتمل خلال ${seconds} ثانية`,
      stepsExecuted: 'الخطوات المنفَّذة',
      changesApplied: 'التغييرات المطبَّقة',
      steps: 'الخطوات',
      showMore: 'عرض المزيد',
      showLess: 'عرض أقل',
      before: 'قبل',
      after: 'بعد',
    },
    verification: {
      title: 'نتائج التحقق',
      verified: 'مُتحقَّق منه',
      failed: 'فشل',
      completedIn: (seconds) => `اكتمل خلال ${seconds} ثانية`,
      checks: (passed, total) => `الفحوصات (${passed}/${total} ناجحة)`,
      expected: 'المتوقَّع',
      actual: 'الفعلي',
      failureReason: 'سبب الفشل',
    },
    auditTimeline: {
      empty: 'لا يتوفر سجل تدقيق',
      systemActor: 'النظام',
    },
  },
};

export function useRemediationLabels(): RemediationLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveCyberBilingual(remediationLabels, locale), [locale]);
}
