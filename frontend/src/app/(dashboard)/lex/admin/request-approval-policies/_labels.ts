/**
 * Feature-local bilingual label catalog for the Request-Approval Policies admin
 * surface — the subject-agnostic two-stage (requester → provider) approval
 * policies for legal *requests* (the request-side analog of the contract
 * Workflow Policies surface).
 *
 * Follows the canonical lex bilingual contract VERBATIM
 * (`../../_lib/lex-i18n.ts`, mirroring `workflow-policies/_components/labels.ts`):
 * the label group is a `LexBilingual<RequestApprovalPolicyLabels>` bundle with
 * two FULL, same-shaped copies — natural English in `en`, professional MSA in
 * `ar`. Function-valued and nested fields appear on BOTH sides and preserve
 * interpolation params + Western digits. Components read the resolved
 * `RequestApprovalPolicyLabels` from {@link useRequestApprovalPolicyLabels}
 * (React) or {@link resolveRequestApprovalPolicyLabels} (non-React / tests,
 * English default).
 *
 * Glossary: طلب (request) / لائحة (policy) / النصاب (quorum) / الصلاحية
 * (authority) / الحوكمة (governance) / إصدار (version) / تدقيق (audit) /
 * مُقدِّم الطلب (requester) / مُقدِّم الخدمة (provider).
 */

'use client';

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n';
import { type LexBilingual, resolveLexBilingual } from '../../_lib/lex-i18n';

export interface RequestApprovalPolicyLabels {
  pageTitle: string;
  pageDescription: string;
  createPolicy: string;
  table: {
    loadError: string;
    emptyTitle: string;
    emptyDescription: string;
    searchPlaceholder: string;
    columns: {
      name: string;
      status: string;
      scope: string;
      route: string;
      priority: string;
      version: string;
      updated: string;
    };
    priority: (value: number | string) => string;
    versionLabel: (value: number | string) => string;
  };
  filters: {
    status: string;
    stage: string;
    anyStatus: string;
    anyStage: string;
  };
  actions: {
    edit: string;
    versions: string;
    audit: string;
    archive: string;
    delete: string;
  };
  scope: {
    anyRequestType: string;
    anyStage: string;
    anyDepartment: string;
    anyValue: string;
    anyTier: string;
    separator: string;
    requestTypePrefix: (value: string) => string;
    fromValue: (currency: string, value: string) => string;
    upToValue: (currency: string, value: string) => string;
    rangeValue: (currency: string, min: string, max: string) => string;
  };
  dialog: {
    createTitle: string;
    editTitle: string;
    description: string;
    sections: {
      identity: string;
      scope: string;
      routing: string;
      authority: string;
      approvers: string;
      formFields: string;
      validity: string;
    };
    name: string;
    namePlaceholder: string;
    descriptionField: string;
    descriptionPlaceholder: string;
    status: string;
    priority: string;
    requestType: string;
    requestTypePlaceholder: string;
    service: string;
    serviceAny: string;
    selectService: string;
    stage: string;
    stageAny: string;
    department: string;
    departmentPlaceholder: string;
    priorityTier: string;
    priorityTierPlaceholder: string;
    currency: string;
    currencyPlaceholder: string;
    minValue: string;
    minValuePlaceholder: string;
    maxValue: string;
    maxValuePlaceholder: string;
    mode: string;
    quorum: string;
    quorumCount: string;
    authorityEvidence: string;
    authorityEvidenceDescription: string;
    toggleAuthorityEvidence: string;
    requiredRole: string;
    requiredRolePlaceholder: string;
    authorityAmount: string;
    authorityAmountPlaceholder: string;
    approversDescription: string;
    add: string;
    approverType: string;
    approverRefRolePlaceholder: string;
    approverRefUserPlaceholder: string;
    approverLabelPlaceholder: string;
    removeApprover: string;
    formFieldsDescription: string;
    fieldNamePlaceholder: string;
    fieldLabelPlaceholder: string;
    fieldType: string;
    removeFormField: string;
    fieldPlaceholderPlaceholder: string;
    fieldOptions: string;
    fieldOptionsPlaceholder: string;
    required: string;
    toggleRequired: string;
    fieldDescription: string;
    fieldDescriptionPlaceholder: string;
    validFrom: string;
    validUntil: string;
    validationHeader: string;
    checkConflicts: string;
    cancel: string;
    save: string;
    create: string;
  };
  conflict: {
    title: string;
    noneTitle: string;
    noneDescription: string;
    conflictsHeader: (count: number) => string;
    identicalHeader: string;
    checking: string;
    error: string;
  };
  versionsDialog: {
    title: string;
    description: string;
    loadError: string;
    emptyTitle: string;
    emptyDescription: string;
    versionLabel: (value: number | string) => string;
    noReason: string;
    restore: string;
    close: string;
    restoreConfirmTitle: string;
    restoreConfirmDescription: (value: number | string) => string;
    restoreConfirm: string;
    restored: string;
  };
  auditDialog: {
    title: string;
    description: string;
    loadError: string;
    emptyTitle: string;
    emptyDescription: string;
    close: string;
    systemActor: string;
    actionLabels: Record<string, string>;
  };
  recommend: {
    title: string;
    description: string;
    requestType: string;
    requestTypePlaceholder: string;
    service: string;
    serviceAny: string;
    selectService: string;
    stage: string;
    stageAny: string;
    department: string;
    departmentPlaceholder: string;
    priorityTier: string;
    priorityTierPlaceholder: string;
    run: string;
    running: string;
    matchedTitle: string;
    noMatchTitle: string;
    matchedBadge: string;
    reviewBadge: string;
    error: string;
  };
  toast: {
    created: string;
    updated: string;
    archived: string;
    deleted: string;
  };
  archiveConfirm: {
    title: string;
    description: (name: string) => string;
    fallbackDescription: string;
    confirm: string;
  };
  deleteConfirm: {
    title: string;
    description: (name: string) => string;
    fallbackDescription: string;
    confirm: string;
  };
  statusLabels: Record<string, string>;
  stageLabels: Record<string, string>;
  modeLabels: Record<string, string>;
  quorumLabels: Record<string, string>;
  fieldTypeLabels: Record<string, string>;
  approverTypeLabels: Record<string, string>;
  quorumFormat: {
    nOfM: (n: number | string, m: number) => string;
  };
  validation: {
    nameRequired: string;
    approverRequired: string;
    quorumAtLeastOne: string;
    quorumExceedsApprovers: string;
    minExceedsMax: string;
    selectFieldNeedsOption: (index: number) => string;
  };
  missingPolicy: string;
}

export const requestApprovalPolicyLabelsBundle: LexBilingual<RequestApprovalPolicyLabels> = {
  en: {
    pageTitle: 'Request-Approval Policies',
    pageDescription:
      'Two-stage requester → provider approval routing for legal requests, scoped by request type, service, stage, department, and value.',
    createPolicy: 'Create Policy',
    table: {
      loadError: 'Failed to load request-approval policies.',
      emptyTitle: 'No request-approval policies',
      emptyDescription:
        'Create a policy to route request approvals by request type, service, stage, and value.',
      searchPlaceholder: 'Search policies...',
      columns: {
        name: 'Policy',
        status: 'Status',
        scope: 'Scope',
        route: 'Route',
        priority: 'Priority',
        version: 'Version',
        updated: 'Updated',
      },
      priority: (value) => `Priority ${value}`,
      versionLabel: (value) => `v${value}`,
    },
    filters: {
      status: 'Status',
      stage: 'Stage',
      anyStatus: 'Any status',
      anyStage: 'Any stage',
    },
    actions: {
      edit: 'Edit',
      versions: 'Versions',
      audit: 'Audit',
      archive: 'Archive',
      delete: 'Delete',
    },
    scope: {
      anyRequestType: 'Any request type',
      anyStage: 'Any stage',
      anyDepartment: 'Any department',
      anyValue: 'Any value',
      anyTier: 'Any tier',
      separator: ' | ',
      requestTypePrefix: (value) => value,
      fromValue: (currency, value) => `From ${currency} ${value}`,
      upToValue: (currency, value) => `Up to ${currency} ${value}`,
      rangeValue: (currency, min, max) => `${currency} ${min}-${max}`,
    },
    dialog: {
      createTitle: 'Create Request-Approval Policy',
      editTitle: 'Edit Request-Approval Policy',
      description:
        'Configure approval routing, authority thresholds, and task form requirements for legal-request approvals.',
      sections: {
        identity: 'Policy',
        scope: 'Scope',
        routing: 'Routing',
        authority: 'Authority evidence',
        approvers: 'Approvers',
        formFields: 'Approval form fields',
        validity: 'Validity window',
      },
      name: 'Policy name',
      namePlaceholder: 'Provider approval — contract review',
      descriptionField: 'Description',
      descriptionPlaceholder: 'Provider-stage approval routing for contract-review requests.',
      status: 'Status',
      priority: 'Priority',
      requestType: 'Request type',
      requestTypePlaceholder: 'contract_review',
      service: 'Service',
      serviceAny: 'Any service',
      selectService: 'Select service',
      stage: 'Stage',
      stageAny: 'Any stage',
      department: 'Department',
      departmentPlaceholder: 'Legal',
      priorityTier: 'Priority tier',
      priorityTierPlaceholder: 'urgent',
      currency: 'Currency',
      currencyPlaceholder: 'SAR',
      minValue: 'Minimum value',
      minValuePlaceholder: '100000',
      maxValue: 'Maximum value',
      maxValuePlaceholder: '500000',
      mode: 'Mode',
      quorum: 'Quorum',
      quorumCount: 'Quorum count',
      authorityEvidence: 'Authority evidence',
      authorityEvidenceDescription: 'Require decision evidence for matching approval tasks.',
      toggleAuthorityEvidence: 'Toggle authority evidence',
      requiredRole: 'Required role',
      requiredRolePlaceholder: 'legal_director',
      authorityAmount: 'Authority amount',
      authorityAmountPlaceholder: '500000',
      approversDescription: 'At least one role or user reference is required.',
      add: 'Add',
      approverType: 'Approver type',
      approverRefRolePlaceholder: 'legal_director',
      approverRefUserPlaceholder: 'Search users',
      approverLabelPlaceholder: 'Legal Director',
      removeApprover: 'Remove approver',
      formFieldsDescription: 'Additional fields appended to the approval task form.',
      fieldNamePlaceholder: 'decision_rationale',
      fieldLabelPlaceholder: 'Decision rationale',
      fieldType: 'Field type',
      removeFormField: 'Remove form field',
      fieldPlaceholderPlaceholder: 'Placeholder',
      fieldOptions: 'Field options',
      fieldOptionsPlaceholder: 'Option A, Option B',
      required: 'Required',
      toggleRequired: 'Toggle required form field',
      fieldDescription: 'Field description',
      fieldDescriptionPlaceholder: 'Description shown to approvers',
      validFrom: 'Valid from',
      validUntil: 'Valid until',
      validationHeader: 'Resolve policy validation issues',
      checkConflicts: 'Check conflicts',
      cancel: 'Cancel',
      save: 'Save changes',
      create: 'Create policy',
    },
    conflict: {
      title: 'Conflict check',
      noneTitle: 'No overlapping policies',
      noneDescription: 'This scope does not overlap an existing active policy.',
      conflictsHeader: (count) => `Overlaps ${count} existing polic${count === 1 ? 'y' : 'ies'}`,
      identicalHeader: 'An identical policy already exists for this scope.',
      checking: 'Checking conflicts...',
      error: 'Failed to run the conflict check.',
    },
    versionsDialog: {
      title: 'Policy versions',
      description: 'Immutable point-in-time snapshots of this policy.',
      loadError: 'Failed to load policy versions.',
      emptyTitle: 'No versions yet',
      emptyDescription: 'Version snapshots are recorded each time the policy changes.',
      versionLabel: (value) => `Version ${value}`,
      noReason: 'No change reason recorded',
      restore: 'Restore',
      close: 'Close',
      restoreConfirmTitle: 'Restore policy version',
      restoreConfirmDescription: (value) =>
        `Restore version ${value}? This creates a new version from the selected snapshot.`,
      restoreConfirm: 'Restore',
      restored: 'Policy version restored.',
    },
    auditDialog: {
      title: 'Policy audit trail',
      description: 'Append-only record of every change to this policy.',
      loadError: 'Failed to load the policy audit trail.',
      emptyTitle: 'No audit entries',
      emptyDescription: 'Audit entries are recorded as the policy is created and changed.',
      close: 'Close',
      systemActor: 'System',
      actionLabels: {
        created: 'Created',
        updated: 'Updated',
        archived: 'Archived',
        restored: 'Restored',
        template_applied: 'Template applied',
      },
    },
    recommend: {
      title: 'Which policy fires?',
      description:
        'Enter request attributes and ask Watheeq which active policy would route the approval.',
      requestType: 'Request type',
      requestTypePlaceholder: 'contract_review',
      service: 'Service',
      serviceAny: 'Any service',
      selectService: 'Select service',
      stage: 'Stage',
      stageAny: 'Any stage',
      department: 'Department',
      departmentPlaceholder: 'Legal',
      priorityTier: 'Priority tier',
      priorityTierPlaceholder: 'urgent',
      run: 'Find policy',
      running: 'Matching...',
      matchedTitle: 'Matched policy',
      noMatchTitle: 'No policy match',
      matchedBadge: 'Matched',
      reviewBadge: 'No match',
      error: 'Failed to run the recommendation.',
    },
    toast: {
      created: 'Request-approval policy created.',
      updated: 'Request-approval policy updated.',
      archived: 'Request-approval policy archived.',
      deleted: 'Request-approval policy deleted.',
    },
    archiveConfirm: {
      title: 'Archive request-approval policy',
      description: (name) =>
        `Archive ${name}? Archived policies remain visible for audit but cannot route new request approvals.`,
      fallbackDescription: 'Archive this request-approval policy?',
      confirm: 'Archive',
    },
    deleteConfirm: {
      title: 'Delete request-approval policy',
      description: (name) =>
        `Delete ${name}? This permanently removes the policy. Archive instead if you need an audit trail.`,
      fallbackDescription: 'Delete this request-approval policy?',
      confirm: 'Delete',
    },
    statusLabels: {
      active: 'Active',
      draft: 'Draft',
      archived: 'Archived',
    },
    stageLabels: {
      requester: 'Requester',
      provider: 'Provider',
    },
    modeLabels: {
      parallel: 'Parallel',
      sequential: 'Sequential',
    },
    quorumLabels: {
      all: 'All',
      any: 'Any',
      n_of_m: 'N of M',
    },
    fieldTypeLabels: {
      textarea: 'Textarea',
      text: 'Text',
      select: 'Select',
      number: 'Number',
      date: 'Date',
      boolean: 'Boolean',
    },
    approverTypeLabels: {
      role: 'Role',
      user: 'User',
    },
    quorumFormat: {
      nOfM: (n, m) => `${n} of ${m}`,
    },
    validation: {
      nameRequired: 'Enter a policy name.',
      approverRequired: 'Add at least one approver reference.',
      quorumAtLeastOne: 'Enter a quorum count of at least 1.',
      quorumExceedsApprovers: 'Quorum count cannot exceed the number of approvers.',
      minExceedsMax: 'Minimum value cannot exceed maximum value.',
      selectFieldNeedsOption: (index) => `Select field ${index} needs at least one option.`,
    },
    missingPolicy: 'Missing request-approval policy.',
  },
  ar: {
    pageTitle: 'لوائح موافقة الطلبات',
    pageDescription:
      'توجيه موافقة الطلبات القانونية على مرحلتين: مُقدِّم الطلب ← مُقدِّم الخدمة، محدودًا حسب نوع الطلب والخدمة والمرحلة والإدارة والقيمة.',
    createPolicy: 'إنشاء لائحة',
    table: {
      loadError: 'تعذّر تحميل لوائح موافقة الطلبات.',
      emptyTitle: 'لا توجد لوائح موافقة طلبات',
      emptyDescription:
        'أنشئ لائحة لتوجيه موافقات الطلبات حسب نوع الطلب والخدمة والمرحلة والقيمة.',
      searchPlaceholder: 'البحث في اللوائح...',
      columns: {
        name: 'اللائحة',
        status: 'الحالة',
        scope: 'النطاق',
        route: 'المسار',
        priority: 'الأولوية',
        version: 'الإصدار',
        updated: 'آخر تحديث',
      },
      priority: (value) => `الأولوية ${value}`,
      versionLabel: (value) => `إصدار ${value}`,
    },
    filters: {
      status: 'الحالة',
      stage: 'المرحلة',
      anyStatus: 'أي حالة',
      anyStage: 'أي مرحلة',
    },
    actions: {
      edit: 'تعديل',
      versions: 'الإصدارات',
      audit: 'التدقيق',
      archive: 'أرشفة',
      delete: 'حذف',
    },
    scope: {
      anyRequestType: 'أي نوع طلب',
      anyStage: 'أي مرحلة',
      anyDepartment: 'أي إدارة',
      anyValue: 'أي قيمة',
      anyTier: 'أي فئة',
      separator: ' | ',
      requestTypePrefix: (value) => value,
      fromValue: (currency, value) => `من ${currency} ${value}`,
      upToValue: (currency, value) => `حتى ${currency} ${value}`,
      rangeValue: (currency, min, max) => `${currency} ${min}-${max}`,
    },
    dialog: {
      createTitle: 'إنشاء لائحة موافقة طلبات',
      editTitle: 'تعديل لائحة موافقة الطلبات',
      description:
        'هيّئ توجيه الموافقة وحدود الصلاحية ومتطلبات نموذج المهمة لموافقات الطلبات القانونية.',
      sections: {
        identity: 'اللائحة',
        scope: 'النطاق',
        routing: 'التوجيه',
        authority: 'إثبات الصلاحية',
        approvers: 'المعتمدون',
        formFields: 'حقول نموذج الموافقة',
        validity: 'نافذة الصلاحية',
      },
      name: 'اسم اللائحة',
      namePlaceholder: 'موافقة مُقدِّم الخدمة — مراجعة العقود',
      descriptionField: 'الوصف',
      descriptionPlaceholder: 'توجيه موافقة مرحلة مُقدِّم الخدمة لطلبات مراجعة العقود.',
      status: 'الحالة',
      priority: 'الأولوية',
      requestType: 'نوع الطلب',
      requestTypePlaceholder: 'contract_review',
      service: 'الخدمة',
      serviceAny: 'أي خدمة',
      selectService: 'اختر الخدمة',
      stage: 'المرحلة',
      stageAny: 'أي مرحلة',
      department: 'الإدارة',
      departmentPlaceholder: 'القانونية',
      priorityTier: 'فئة الأولوية',
      priorityTierPlaceholder: 'urgent',
      currency: 'العملة',
      currencyPlaceholder: 'SAR',
      minValue: 'الحد الأدنى للقيمة',
      minValuePlaceholder: '100000',
      maxValue: 'الحد الأقصى للقيمة',
      maxValuePlaceholder: '500000',
      mode: 'النمط',
      quorum: 'النصاب',
      quorumCount: 'عدد النصاب',
      authorityEvidence: 'إثبات الصلاحية',
      authorityEvidenceDescription: 'اشتراط إثبات القرار لمهام الموافقة المطابقة.',
      toggleAuthorityEvidence: 'تبديل إثبات الصلاحية',
      requiredRole: 'الدور المطلوب',
      requiredRolePlaceholder: 'legal_director',
      authorityAmount: 'مبلغ الصلاحية',
      authorityAmountPlaceholder: '500000',
      approversDescription: 'يلزم مرجع واحد على الأقل لدور أو مستخدم.',
      add: 'إضافة',
      approverType: 'نوع المعتمِد',
      approverRefRolePlaceholder: 'legal_director',
      approverRefUserPlaceholder: 'ابحث عن مستخدم',
      approverLabelPlaceholder: 'المدير القانوني',
      removeApprover: 'إزالة المعتمِد',
      formFieldsDescription: 'حقول إضافية تُلحق بنموذج مهمة الموافقة.',
      fieldNamePlaceholder: 'decision_rationale',
      fieldLabelPlaceholder: 'مبررات القرار',
      fieldType: 'نوع الحقل',
      removeFormField: 'إزالة الحقل',
      fieldPlaceholderPlaceholder: 'نص توضيحي',
      fieldOptions: 'خيارات الحقل',
      fieldOptionsPlaceholder: 'الخيار أ، الخيار ب',
      required: 'مطلوب',
      toggleRequired: 'تبديل حقل النموذج المطلوب',
      fieldDescription: 'وصف الحقل',
      fieldDescriptionPlaceholder: 'الوصف الظاهر للمعتمدين',
      validFrom: 'صالح من',
      validUntil: 'صالح حتى',
      validationHeader: 'عالج مشكلات التحقق من اللائحة',
      checkConflicts: 'فحص التعارض',
      cancel: 'إلغاء',
      save: 'حفظ التغييرات',
      create: 'إنشاء اللائحة',
    },
    conflict: {
      title: 'فحص التعارض',
      noneTitle: 'لا توجد لوائح متداخلة',
      noneDescription: 'لا يتداخل هذا النطاق مع لائحة نشطة قائمة.',
      conflictsHeader: (count) => `يتداخل مع ${count} لائحة قائمة`,
      identicalHeader: 'توجد لائحة مطابقة لهذا النطاق بالفعل.',
      checking: 'جارٍ فحص التعارض...',
      error: 'تعذّر تنفيذ فحص التعارض.',
    },
    versionsDialog: {
      title: 'إصدارات اللائحة',
      description: 'لقطات زمنية غير قابلة للتعديل لهذه اللائحة.',
      loadError: 'تعذّر تحميل إصدارات اللائحة.',
      emptyTitle: 'لا توجد إصدارات بعد',
      emptyDescription: 'تُسجَّل لقطات الإصدارات في كل مرة تتغيّر فيها اللائحة.',
      versionLabel: (value) => `الإصدار ${value}`,
      noReason: 'لم يُسجَّل سبب للتغيير',
      restore: 'استعادة',
      close: 'إغلاق',
      restoreConfirmTitle: 'استعادة إصدار اللائحة',
      restoreConfirmDescription: (value) =>
        `استعادة الإصدار ${value}؟ يؤدي ذلك إلى إنشاء إصدار جديد من اللقطة المحددة.`,
      restoreConfirm: 'استعادة',
      restored: 'تمت استعادة إصدار اللائحة.',
    },
    auditDialog: {
      title: 'سجل تدقيق اللائحة',
      description: 'سجل غير قابل للإلحاق فقط لكل تغيير على هذه اللائحة.',
      loadError: 'تعذّر تحميل سجل تدقيق اللائحة.',
      emptyTitle: 'لا توجد قيود تدقيق',
      emptyDescription: 'تُسجَّل قيود التدقيق عند إنشاء اللائحة وتغييرها.',
      close: 'إغلاق',
      systemActor: 'النظام',
      actionLabels: {
        created: 'أُنشئت',
        updated: 'حُدّثت',
        archived: 'أُرشِفت',
        restored: 'استُعيدت',
        template_applied: 'طُبّق القالب',
      },
    },
    recommend: {
      title: 'أي لائحة تُطبَّق؟',
      description:
        'أدخل سمات الطلب واطلب من وثيق تحديد اللائحة النشطة التي ستوجّه الموافقة.',
      requestType: 'نوع الطلب',
      requestTypePlaceholder: 'contract_review',
      service: 'الخدمة',
      serviceAny: 'أي خدمة',
      selectService: 'اختر الخدمة',
      stage: 'المرحلة',
      stageAny: 'أي مرحلة',
      department: 'الإدارة',
      departmentPlaceholder: 'القانونية',
      priorityTier: 'فئة الأولوية',
      priorityTierPlaceholder: 'urgent',
      run: 'إيجاد اللائحة',
      running: 'جارٍ المطابقة...',
      matchedTitle: 'لائحة مطابقة',
      noMatchTitle: 'لا توجد لائحة مطابقة',
      matchedBadge: 'مطابقة',
      reviewBadge: 'لا تطابق',
      error: 'تعذّر تنفيذ التوصية.',
    },
    toast: {
      created: 'تم إنشاء لائحة موافقة الطلبات.',
      updated: 'تم تحديث لائحة موافقة الطلبات.',
      archived: 'تمت أرشفة لائحة موافقة الطلبات.',
      deleted: 'تم حذف لائحة موافقة الطلبات.',
    },
    archiveConfirm: {
      title: 'أرشفة لائحة موافقة الطلبات',
      description: (name) =>
        `أرشفة ${name}؟ تبقى اللوائح المؤرشفة ظاهرة للتدقيق لكن لا يمكنها توجيه موافقات طلبات جديدة.`,
      fallbackDescription: 'أرشفة لائحة موافقة الطلبات هذه؟',
      confirm: 'أرشفة',
    },
    deleteConfirm: {
      title: 'حذف لائحة موافقة الطلبات',
      description: (name) =>
        `حذف ${name}؟ يؤدي ذلك إلى إزالة اللائحة نهائيًا. استخدم الأرشفة بدلًا من ذلك إذا كنت بحاجة إلى سجل تدقيق.`,
      fallbackDescription: 'حذف لائحة موافقة الطلبات هذه؟',
      confirm: 'حذف',
    },
    statusLabels: {
      active: 'نشطة',
      draft: 'مسودة',
      archived: 'مؤرشفة',
    },
    stageLabels: {
      requester: 'مُقدِّم الطلب',
      provider: 'مُقدِّم الخدمة',
    },
    modeLabels: {
      parallel: 'متوازٍ',
      sequential: 'تسلسلي',
    },
    quorumLabels: {
      all: 'الكل',
      any: 'أي',
      n_of_m: 'ن من م',
    },
    fieldTypeLabels: {
      textarea: 'منطقة نص',
      text: 'نص',
      select: 'قائمة اختيار',
      number: 'رقم',
      date: 'تاريخ',
      boolean: 'منطقي',
    },
    approverTypeLabels: {
      role: 'دور',
      user: 'مستخدم',
    },
    quorumFormat: {
      nOfM: (n, m) => `${n} من ${m}`,
    },
    validation: {
      nameRequired: 'أدخل اسم اللائحة.',
      approverRequired: 'أضف مرجع معتمِد واحدًا على الأقل.',
      quorumAtLeastOne: 'أدخل عدد نصاب لا يقل عن 1.',
      quorumExceedsApprovers: 'لا يمكن أن يتجاوز عدد النصاب عدد المعتمدين.',
      minExceedsMax: 'لا يمكن أن يتجاوز الحد الأدنى للقيمة الحد الأقصى.',
      selectFieldNeedsOption: (index) => `حقل الاختيار ${index} يحتاج خيارًا واحدًا على الأقل.`,
    },
    missingPolicy: 'لائحة موافقة الطلبات مفقودة.',
  },
};

/**
 * resolveRequestApprovalPolicyLabels is the pure resolver for non-React callers
 * and tests; defaults to English so isolated callers keep the English surface.
 */
export function resolveRequestApprovalPolicyLabels(
  locale: AppLocale = 'en',
): RequestApprovalPolicyLabels {
  return resolveLexBilingual(requestApprovalPolicyLabelsBundle, locale);
}

/**
 * useRequestApprovalPolicyLabels is the memoized React hook the Request-Approval
 * Policies surface uses to read the resolved labels for the active locale.
 */
export function useRequestApprovalPolicyLabels(): RequestApprovalPolicyLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveRequestApprovalPolicyLabels(locale), [locale]);
}
