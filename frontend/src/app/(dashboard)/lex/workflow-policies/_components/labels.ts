/**
 * Feature-local bilingual label catalog for the Workflow Policies (Watheeq
 * approval-policy administration) surface.
 *
 * Follows the canonical lex bilingual contract (`../../_lib/lex-i18n.ts`,
 * mirroring `dr/_lib/dr-i18n.ts`): the label group is a
 * `LexBilingual<WorkflowPolicyLabels>` bundle holding two FULL, same-shaped
 * copies — English in `en` (equal to the pre-existing hardcoded strings so
 * English-asserting tests stay green) and professional MSA in `ar`. Components
 * read the resolved `WorkflowPolicyLabels` from {@link useWorkflowPolicyLabels}
 * (React) or {@link resolveWorkflowPolicyLabels} (non-React / tests, English
 * default). Interpolation params and Western digits are preserved across locales.
 *
 * Legal/governance glossary: عقد (contract) / لائحة (policy) / الحوكمة
 * (governance) / الامتثال (compliance) / النصاب (quorum) / الصلاحية (authority).
 */

'use client';

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n';
import { type LexBilingual, resolveLexBilingual } from '../../_lib/lex-i18n';

export interface WorkflowPolicyLabels {
  pageTitle: string;
  pageDescription: string;
  createPolicy: string;
  designer: string;
  tabs: {
    policies: string;
    definitions: string;
    instances: string;
  };
  metrics: {
    policies: string;
    active: string;
    routedTasks: string;
    awaitingQuorum: string;
    drafts: string;
    archived: string;
    avgDecision: string;
  };
  metricDetails: {
    policyScope: string;
    activePolicies: string;
    draftPolicies: string;
    archivedPolicies: string;
    routedWork: string;
    quorumWork: string;
    decisionSpeed: string;
    policyShare: string;
    taskShare: string;
    currentCatalog: string;
  };
  eyebrow: string;
  analyticsCard: {
    title: string;
    description: string;
    loadError: string;
    emptyTitle: string;
    emptyDescription: string;
    summary: {
      completed: string;
      rejected: string;
      cancelled: string;
      openTasks: string;
      avgHours: string;
    };
    columns: {
      policy: string;
      route: string;
      tasks: string;
      open: string;
      done: string;
      rejected: string;
      avgHours: string;
      lastRouted: string;
    };
    authorityEvidenceRequired: string;
    authorityEvidenceOptional: string;
    quorumSuffix: string;
    noTasks: string;
  };
  catalog: {
    title: string;
    description: string;
    loadError: string;
    emptyTitle: string;
    emptyDescription: string;
    emptyCta: string;
    columns: {
      policy: string;
      scope: string;
      route: string;
      authority: string;
      updated: string;
      actions: string;
    };
    priority: (value: number | string) => string;
    anyApprovalAuthority: string;
    evidenceRequired: string;
    evidenceOptional: string;
    editAria: (name: string) => string;
    archiveAria: (name: string) => string;
    updatedTitle: (dual: string) => string;
  };
  recommendation: {
    title: string;
    description: string;
    loadError: string;
    noContracts: string;
    contract: string;
    selectContract: string;
    recommend: string;
    matchedTitle: string;
    noMatchTitle: string;
    matchedBadge: string;
    reviewBadge: string;
    openContract: string;
    context: {
      valuePrefix: string;
      undisclosed: string;
      departmentPrefix: string;
      unassigned: string;
    };
  };
  dialog: {
    createTitle: string;
    editTitle: string;
    description: string;
    name: string;
    namePlaceholder: string;
    descriptionField: string;
    descriptionPlaceholder: string;
    status: string;
    priority: string;
    contractType: string;
    department: string;
    departmentPlaceholder: string;
    currency: string;
    currencyPlaceholder: string;
    minValue: string;
    minValuePlaceholder: string;
    maxValue: string;
    maxValuePlaceholder: string;
    authorityAmount: string;
    authorityAmountPlaceholder: string;
    mode: string;
    quorum: string;
    quorumCount: string;
    authorityEvidence: string;
    authorityEvidenceDescription: string;
    toggleAuthorityEvidence: string;
    requiredRole: string;
    requiredRolePlaceholder: string;
    approvers: string;
    approversDescription: string;
    add: string;
    approverType: string;
    approverRefRolePlaceholder: string;
    approverRefUserPlaceholder: string;
    approverLabelPlaceholder: string;
    removeApprover: string;
    formFields: string;
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
    validationHeader: string;
    cancel: string;
    save: string;
    create: string;
  };
  toast: {
    created: string;
    updated: string;
    archived: string;
  };
  archiveConfirm: {
    title: string;
    description: (name: string) => string;
    fallbackDescription: string;
    confirm: string;
  };
  statusLabels: Record<string, string>;
  modeLabels: Record<string, string>;
  quorumLabels: Record<string, string>;
  fieldTypeLabels: Record<string, string>;
  approverTypeLabels: Record<string, string>;
  contractTypeLabels: Record<string, string>;
  contractTypeAny: string;
  scope: {
    anyType: string;
    anyDepartment: string;
    anyValue: string;
    fromValue: (currency: string, value: string) => string;
    upToValue: (currency: string, value: string) => string;
    rangeValue: (currency: string, min: string, max: string) => string;
    separator: string;
  };
  quorumFormat: {
    nOfM: (n: number | string, m: number | string) => string;
    nOfRouted: (n: number | string) => string;
  };
  validation: {
    quorumAtLeastOne: string;
    quorumExceedsApprovers: string;
    minExceedsMax: string;
    selectFieldNeedsOption: (index: number) => string;
  };
  missingPolicy: string;
}

export const workflowPolicyLabelsBundle: LexBilingual<WorkflowPolicyLabels> = {
  en: {
    pageTitle: 'Workflow Policies',
    pageDescription:
      'Watheeq approval routing, authority evidence, and review form policy administration.',
    createPolicy: 'Create Policy',
    designer: 'Workflow Designer',
    tabs: {
      policies: 'Approval Policies',
      definitions: 'Workflow Definitions',
      instances: 'Workflow Instances',
    },
    metrics: {
      policies: 'Policies',
      active: 'Active',
      routedTasks: 'Routed Tasks',
      awaitingQuorum: 'Awaiting Quorum',
      drafts: 'Drafts',
      archived: 'Archived',
      avgDecision: 'Avg Decision',
    },
    metricDetails: {
      policyScope: 'Approval routing policies in the current catalog.',
      activePolicies: 'Policies currently eligible to route work.',
      draftPolicies: 'Policies still being prepared.',
      archivedPolicies: 'Retired policies kept for audit history.',
      routedWork: 'Tasks created by policy routing.',
      quorumWork: 'Open tasks waiting for quorum completion.',
      decisionSpeed: 'Average elapsed time for routed decisions.',
      policyShare: 'Policy share',
      taskShare: 'Task share',
      currentCatalog: 'Current catalog',
    },
    eyebrow: 'Legal Suite · Watheeq',
    analyticsCard: {
      title: 'Routing Analytics',
      description:
        'Approval-policy routing volume, open quorum work, terminal decisions, and decision timing.',
      loadError: 'Failed to load approval policy analytics.',
      emptyTitle: 'No routing activity yet',
      emptyDescription:
        'Approval tasks will appear here after contract reviews use configured policies.',
      summary: {
        completed: 'Completed',
        rejected: 'Rejected',
        cancelled: 'Cancelled',
        openTasks: 'Open Tasks',
        avgHours: 'Avg Hours',
      },
      columns: {
        policy: 'Policy',
        route: 'Route',
        tasks: 'Tasks',
        open: 'Open',
        done: 'Done',
        rejected: 'Rejected',
        avgHours: 'Avg Hours',
        lastRouted: 'Last Routed',
      },
      authorityEvidenceRequired: 'Authority evidence required',
      authorityEvidenceOptional: 'Authority evidence optional',
      quorumSuffix: 'quorum',
      noTasks: 'No tasks',
    },
    catalog: {
      title: 'Approval Policy Catalog',
      description:
        'Tenant policies used to select approvers, quorum, review fields, and authority evidence.',
      loadError: 'Failed to load approval policies.',
      emptyTitle: 'No approval policies configured',
      emptyDescription:
        'Create a policy to route contract reviews by value, department, and authority role.',
      emptyCta: 'Create your first policy',
      columns: {
        policy: 'Policy',
        scope: 'Scope',
        route: 'Route',
        authority: 'Authority',
        updated: 'Updated',
        actions: 'Actions',
      },
      priority: (value) => `Priority ${value}`,
      anyApprovalAuthority: 'Any approval authority',
      evidenceRequired: 'Evidence required',
      evidenceOptional: 'Evidence optional',
      editAria: (name) => `Edit ${name}`,
      archiveAria: (name) => `Archive ${name}`,
      updatedTitle: (dual) => `Updated ${dual}`,
    },
    recommendation: {
      title: 'Policy Recommendation',
      description:
        'Select a contract and ask Watheeq to match the approval policy for its type, value, currency, and department.',
      loadError: 'Failed to load contracts for recommendation.',
      noContracts: 'No contracts are available for policy recommendation.',
      contract: 'Contract',
      selectContract: 'Select contract',
      recommend: 'Recommend Policy',
      matchedTitle: 'Matched policy',
      noMatchTitle: 'No policy match',
      matchedBadge: 'Matched',
      reviewBadge: 'Review',
      openContract: 'Open contract',
      context: {
        valuePrefix: 'Value:',
        undisclosed: 'Undisclosed',
        departmentPrefix: 'Department:',
        unassigned: 'Unassigned',
      },
    },
    dialog: {
      createTitle: 'Create Approval Policy',
      editTitle: 'Edit Approval Policy',
      description:
        'Configure Watheeq review routing, authority thresholds, and task form requirements.',
      name: 'Policy name',
      namePlaceholder: 'Finance DoA approvals',
      descriptionField: 'Description',
      descriptionPlaceholder: 'Finance authority matrix for vendor contracts.',
      status: 'Status',
      priority: 'Priority',
      contractType: 'Contract type',
      department: 'Department',
      departmentPlaceholder: 'Finance',
      currency: 'Currency',
      currencyPlaceholder: 'SAR',
      minValue: 'Minimum value',
      minValuePlaceholder: '100000',
      maxValue: 'Maximum value',
      maxValuePlaceholder: '500000',
      authorityAmount: 'Authority amount',
      authorityAmountPlaceholder: '500000',
      mode: 'Mode',
      quorum: 'Quorum',
      quorumCount: 'Quorum count',
      authorityEvidence: 'Authority evidence',
      authorityEvidenceDescription: 'Require decision evidence for matching review tasks.',
      toggleAuthorityEvidence: 'Toggle authority evidence',
      requiredRole: 'Required role',
      requiredRolePlaceholder: 'finance_director',
      approvers: 'Approvers',
      approversDescription: 'At least one role or user reference is required.',
      add: 'Add',
      approverType: 'Approver type',
      approverRefRolePlaceholder: 'finance_director',
      approverRefUserPlaceholder: 'Search users',
      approverLabelPlaceholder: 'Finance Director',
      removeApprover: 'Remove approver',
      formFields: 'Review form fields',
      formFieldsDescription: 'Additional fields appended to the approval task form.',
      fieldNamePlaceholder: 'business_justification',
      fieldLabelPlaceholder: 'Business justification',
      fieldType: 'Field type',
      removeFormField: 'Remove form field',
      fieldPlaceholderPlaceholder: 'Placeholder',
      fieldOptions: 'Field options',
      fieldOptionsPlaceholder: 'Option A, Option B',
      required: 'Required',
      toggleRequired: 'Toggle required form field',
      fieldDescription: 'Field description',
      fieldDescriptionPlaceholder: 'Description shown to reviewers',
      validationHeader: 'Resolve policy validation issues',
      cancel: 'Cancel',
      save: 'Save changes',
      create: 'Create policy',
    },
    toast: {
      created: 'Approval policy created.',
      updated: 'Approval policy updated.',
      archived: 'Approval policy archived.',
    },
    archiveConfirm: {
      title: 'Archive approval policy',
      description: (name) =>
        `Archive ${name}? Archived policies remain visible for audit but cannot be used for new contract reviews.`,
      fallbackDescription: 'Archive this approval policy?',
      confirm: 'Archive',
    },
    statusLabels: {
      active: 'active',
      draft: 'draft',
      archived: 'archived',
    },
    modeLabels: {
      parallel: 'parallel',
      sequential: 'sequential',
    },
    quorumLabels: {
      all: 'all',
      any: 'any',
      n_of_m: 'n of m',
    },
    fieldTypeLabels: {
      textarea: 'textarea',
      text: 'text',
      select: 'select',
      number: 'number',
      date: 'date',
      boolean: 'boolean',
    },
    approverTypeLabels: {
      role: 'role',
      user: 'user',
    },
    contractTypeLabels: {
      service_agreement: 'service agreement',
      nda: 'nda',
      employment: 'employment',
      vendor: 'vendor',
      license: 'license',
      lease: 'lease',
      partnership: 'partnership',
      consulting: 'consulting',
      procurement: 'procurement',
      sla: 'sla',
      mou: 'mou',
      amendment: 'amendment',
      renewal: 'renewal',
      other: 'other',
    },
    contractTypeAny: 'any',
    scope: {
      anyType: 'Any type',
      anyDepartment: 'Any department',
      anyValue: 'Any value',
      fromValue: (currency, value) => `From ${currency} ${value}`,
      upToValue: (currency, value) => `Up to ${currency} ${value}`,
      rangeValue: (currency, min, max) => `${currency} ${min}-${max}`,
      separator: ' | ',
    },
    quorumFormat: {
      nOfM: (n, m) => `${n} of ${m}`,
      nOfRouted: (n) => `${n} of routed`,
    },
    validation: {
      quorumAtLeastOne: 'Enter a quorum count of at least 1.',
      quorumExceedsApprovers: 'Quorum count cannot exceed the number of approvers.',
      minExceedsMax: 'Minimum value cannot exceed maximum value.',
      selectFieldNeedsOption: (index) => `Select field ${index} needs at least one option.`,
    },
    missingPolicy: 'Missing approval policy.',
  },
  ar: {
    pageTitle: 'لوائح سير العمل',
    pageDescription:
      'إدارة توجيه الموافقات وإثبات الصلاحية ولوائح نماذج المراجعة في وثيق.',
    createPolicy: 'إنشاء لائحة',
    designer: 'مصمم سير العمل',
    tabs: {
      policies: 'سياسات الاعتماد',
      definitions: 'تعريفات سير العمل',
      instances: 'حالات سير العمل',
    },
    metrics: {
      policies: 'اللوائح',
      active: 'النشطة',
      routedTasks: 'المهام المُوجَّهة',
      awaitingQuorum: 'بانتظار النصاب',
      drafts: 'المسودات',
      archived: 'المؤرشفة',
      avgDecision: 'متوسط القرار',
    },
    metricDetails: {
      policyScope: 'لوائح توجيه الموافقات في الفهرس الحالي.',
      activePolicies: 'لوائح مؤهلة حاليًا لتوجيه العمل.',
      draftPolicies: 'لوائح ما زالت قيد الإعداد.',
      archivedPolicies: 'لوائح متقاعدة محفوظة لسجل التدقيق.',
      routedWork: 'مهام أنشأها توجيه اللوائح.',
      quorumWork: 'مهام مفتوحة تنتظر اكتمال النصاب.',
      decisionSpeed: 'متوسط الوقت المنقضي للقرارات المُوجَّهة.',
      policyShare: 'حصة اللوائح',
      taskShare: 'حصة المهام',
      currentCatalog: 'الفهرس الحالي',
    },
    eyebrow: 'المجموعة القانونية · وثيق',
    analyticsCard: {
      title: 'تحليلات التوجيه',
      description:
        'حجم توجيه لوائح الموافقة وأعمال النصاب المفتوحة والقرارات النهائية وزمن اتخاذ القرار.',
      loadError: 'تعذّر تحميل تحليلات لوائح الموافقة.',
      emptyTitle: 'لا يوجد نشاط توجيه بعد',
      emptyDescription:
        'ستظهر مهام الموافقة هنا بعد أن تستخدم مراجعات العقود اللوائح المُهيّأة.',
      summary: {
        completed: 'مكتملة',
        rejected: 'مرفوضة',
        cancelled: 'ملغاة',
        openTasks: 'مهام مفتوحة',
        avgHours: 'متوسط الساعات',
      },
      columns: {
        policy: 'اللائحة',
        route: 'المسار',
        tasks: 'المهام',
        open: 'المفتوحة',
        done: 'المنجزة',
        rejected: 'المرفوضة',
        avgHours: 'متوسط الساعات',
        lastRouted: 'آخر توجيه',
      },
      authorityEvidenceRequired: 'إثبات الصلاحية مطلوب',
      authorityEvidenceOptional: 'إثبات الصلاحية اختياري',
      quorumSuffix: 'نصاب',
      noTasks: 'لا توجد مهام',
    },
    catalog: {
      title: 'فهرس لوائح الموافقة',
      description:
        'لوائح المستأجر المستخدمة لتحديد المعتمدين والنصاب وحقول المراجعة وإثبات الصلاحية.',
      loadError: 'تعذّر تحميل لوائح الموافقة.',
      emptyTitle: 'لا توجد لوائح موافقة مُهيّأة',
      emptyDescription:
        'أنشئ لائحة لتوجيه مراجعات العقود حسب القيمة والإدارة ودور الصلاحية.',
      emptyCta: 'أنشئ لائحتك الأولى',
      columns: {
        policy: 'اللائحة',
        scope: 'النطاق',
        route: 'المسار',
        authority: 'الصلاحية',
        updated: 'آخر تحديث',
        actions: 'إجراءات',
      },
      priority: (value) => `الأولوية ${value}`,
      anyApprovalAuthority: 'أي صلاحية موافقة',
      evidenceRequired: 'الإثبات مطلوب',
      evidenceOptional: 'الإثبات اختياري',
      editAria: (name) => `تعديل ${name}`,
      archiveAria: (name) => `أرشفة ${name}`,
      updatedTitle: (dual) => `آخر تحديث ${dual}`,
    },
    recommendation: {
      title: 'توصية اللائحة',
      description:
        'اختر عقدًا واطلب من وثيق مطابقة لائحة الموافقة حسب نوعه وقيمته وعملته وإدارته.',
      loadError: 'تعذّر تحميل العقود لأغراض التوصية.',
      noContracts: 'لا توجد عقود متاحة لتوصية اللائحة.',
      contract: 'العقد',
      selectContract: 'اختر العقد',
      recommend: 'توصية بلائحة',
      matchedTitle: 'لائحة مطابقة',
      noMatchTitle: 'لا توجد لائحة مطابقة',
      matchedBadge: 'مطابقة',
      reviewBadge: 'مراجعة',
      openContract: 'فتح العقد',
      context: {
        valuePrefix: 'القيمة:',
        undisclosed: 'غير مُفصح عنها',
        departmentPrefix: 'الإدارة:',
        unassigned: 'غير مُسندة',
      },
    },
    dialog: {
      createTitle: 'إنشاء لائحة موافقة',
      editTitle: 'تعديل لائحة الموافقة',
      description:
        'هيّئ توجيه مراجعة وثيق وحدود الصلاحية ومتطلبات نموذج المهمة.',
      name: 'اسم اللائحة',
      namePlaceholder: 'موافقات تفويض الصلاحيات المالية',
      descriptionField: 'الوصف',
      descriptionPlaceholder: 'مصفوفة الصلاحيات المالية لعقود المورّدين.',
      status: 'الحالة',
      priority: 'الأولوية',
      contractType: 'نوع العقد',
      department: 'الإدارة',
      departmentPlaceholder: 'المالية',
      currency: 'العملة',
      currencyPlaceholder: 'SAR',
      minValue: 'الحد الأدنى للقيمة',
      minValuePlaceholder: '100000',
      maxValue: 'الحد الأقصى للقيمة',
      maxValuePlaceholder: '500000',
      authorityAmount: 'مبلغ الصلاحية',
      authorityAmountPlaceholder: '500000',
      mode: 'النمط',
      quorum: 'النصاب',
      quorumCount: 'عدد النصاب',
      authorityEvidence: 'إثبات الصلاحية',
      authorityEvidenceDescription: 'اشتراط إثبات القرار لمهام المراجعة المطابقة.',
      toggleAuthorityEvidence: 'تبديل إثبات الصلاحية',
      requiredRole: 'الدور المطلوب',
      requiredRolePlaceholder: 'finance_director',
      approvers: 'المعتمدون',
      approversDescription: 'يلزم مرجع واحد على الأقل لدور أو مستخدم.',
      add: 'إضافة',
      approverType: 'نوع المعتمِد',
      approverRefRolePlaceholder: 'finance_director',
      approverRefUserPlaceholder: 'ابحث عن مستخدم',
      approverLabelPlaceholder: 'المدير المالي',
      removeApprover: 'إزالة المعتمِد',
      formFields: 'حقول نموذج المراجعة',
      formFieldsDescription: 'حقول إضافية تُلحق بنموذج مهمة الموافقة.',
      fieldNamePlaceholder: 'business_justification',
      fieldLabelPlaceholder: 'المبرر التجاري',
      fieldType: 'نوع الحقل',
      removeFormField: 'إزالة الحقل',
      fieldPlaceholderPlaceholder: 'نص توضيحي',
      fieldOptions: 'خيارات الحقل',
      fieldOptionsPlaceholder: 'الخيار أ، الخيار ب',
      required: 'مطلوب',
      toggleRequired: 'تبديل حقل النموذج المطلوب',
      fieldDescription: 'وصف الحقل',
      fieldDescriptionPlaceholder: 'الوصف الظاهر للمراجعين',
      validationHeader: 'عالج مشكلات التحقق من اللائحة',
      cancel: 'إلغاء',
      save: 'حفظ التغييرات',
      create: 'إنشاء اللائحة',
    },
    toast: {
      created: 'تم إنشاء لائحة الموافقة.',
      updated: 'تم تحديث لائحة الموافقة.',
      archived: 'تمت أرشفة لائحة الموافقة.',
    },
    archiveConfirm: {
      title: 'أرشفة لائحة الموافقة',
      description: (name) =>
        `أرشفة ${name}؟ تبقى اللوائح المؤرشفة ظاهرة للتدقيق لكن لا يمكن استخدامها في مراجعات عقود جديدة.`,
      fallbackDescription: 'أرشفة لائحة الموافقة هذه؟',
      confirm: 'أرشفة',
    },
    statusLabels: {
      active: 'نشطة',
      draft: 'مسودة',
      archived: 'مؤرشفة',
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
    contractTypeLabels: {
      service_agreement: 'اتفاقية خدمات',
      nda: 'اتفاقية سرية',
      employment: 'توظيف',
      vendor: 'مورّد',
      license: 'ترخيص',
      lease: 'إيجار',
      partnership: 'شراكة',
      consulting: 'استشارات',
      procurement: 'مشتريات',
      sla: 'اتفاقية مستوى خدمة',
      mou: 'مذكرة تفاهم',
      amendment: 'تعديل',
      renewal: 'تجديد',
      other: 'أخرى',
    },
    contractTypeAny: 'أي',
    scope: {
      anyType: 'أي نوع',
      anyDepartment: 'أي إدارة',
      anyValue: 'أي قيمة',
      fromValue: (currency, value) => `من ${currency} ${value}`,
      upToValue: (currency, value) => `حتى ${currency} ${value}`,
      rangeValue: (currency, min, max) => `${currency} ${min}-${max}`,
      separator: ' | ',
    },
    quorumFormat: {
      nOfM: (n, m) => `${n} من ${m}`,
      nOfRouted: (n) => `${n} من المُوجَّهة`,
    },
    validation: {
      quorumAtLeastOne: 'أدخل عدد نصاب لا يقل عن 1.',
      quorumExceedsApprovers: 'لا يمكن أن يتجاوز عدد النصاب عدد المعتمدين.',
      minExceedsMax: 'لا يمكن أن يتجاوز الحد الأدنى للقيمة الحد الأقصى.',
      selectFieldNeedsOption: (index) => `حقل الاختيار ${index} يحتاج خيارًا واحدًا على الأقل.`,
    },
    missingPolicy: 'لائحة الموافقة مفقودة.',
  },
};

/**
 * resolveWorkflowPolicyLabels is the pure resolver for non-React callers and
 * tests; defaults to English so isolated callers keep the English surface.
 */
export function resolveWorkflowPolicyLabels(
  locale: AppLocale = 'en',
): WorkflowPolicyLabels {
  return resolveLexBilingual(workflowPolicyLabelsBundle, locale);
}

/**
 * useWorkflowPolicyLabels is the thin memoized React hook the Workflow Policies
 * page uses to read the resolved {@link WorkflowPolicyLabels} for the active
 * locale.
 */
export function useWorkflowPolicyLabels(): WorkflowPolicyLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveWorkflowPolicyLabels(locale), [locale]);
}
