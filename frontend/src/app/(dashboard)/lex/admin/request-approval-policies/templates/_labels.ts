/**
 * Feature-local bilingual label catalog for the Request-Approval Policy
 * Templates (Watheeq legal-request approval-template administration) surface.
 *
 * Follows the canonical lex bilingual contract
 * (`../../../_lib/lex-i18n.ts`, mirroring `dr/_lib/dr-i18n.ts`): the label group
 * is a `LexBilingual<TemplateLabels>` bundle holding two FULL, same-shaped
 * copies — natural English in `en` and professional MSA in `ar`. Components read
 * the resolved `TemplateLabels` from {@link useTemplateLabels} (React) or
 * {@link resolveTemplateLabels} (non-React / tests, English default).
 * Interpolation params, ICU/plural shape and Western digits are preserved across
 * both locales.
 *
 * Legal/governance glossary: لائحة (policy) / قالب (template) / الحوكمة
 * (governance) / النصاب (quorum) / الصلاحية (authority) / الطلب (request).
 */

'use client';

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n';
import { type LexBilingual, resolveLexBilingual } from '../../../_lib/lex-i18n';

export interface TemplateLabels {
  pageTitle: string;
  pageDescription: string;
  newTemplate: string;
  backToPolicies: string;
  policiesLink: string;
  metrics: {
    templates: string;
    categories: string;
  };
  catalog: {
    title: string;
    description: string;
    loadError: string;
    retry: string;
    emptyTitle: string;
    emptyDescription: string;
    columns: {
      template: string;
      category: string;
      description: string;
      updated: string;
      actions: string;
    };
    uncategorized: string;
    noDescription: string;
    editAria: (name: string) => string;
    deleteAria: (name: string) => string;
    instantiateAria: (name: string) => string;
    instantiate: string;
  };
  dialog: {
    createTitle: string;
    editTitle: string;
    description: string;
    name: string;
    namePlaceholder: string;
    descriptionField: string;
    descriptionPlaceholder: string;
    category: string;
    categoryPlaceholder: string;
    commonCategories: string;
    definitionSectionTitle: string;
    definitionSectionDescription: string;
    sections: {
      scope: string;
      routing: string;
      authority: string;
      approvers: string;
      formFields: string;
      validity: string;
    };
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
    priority: string;
    priorityPlaceholder: string;
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
    approvers: string;
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
    advancedTitle: string;
    advancedDescription: string;
    metadataKeyPlaceholder: string;
    metadataValuePlaceholder: string;
    addMetadata: string;
    removeMetadata: string;
    metadataReservedKey: string;
    definitionPreviewTitle: string;
    definitionPreviewDescription: string;
    showPreview: string;
    hidePreview: string;
    validationHeader: string;
    cancel: string;
    create: string;
    save: string;
  };
  stageLabels: Record<string, string>;
  modeLabels: Record<string, string>;
  quorumLabels: Record<string, string>;
  approverTypeLabels: Record<string, string>;
  fieldTypeLabels: Record<string, string>;
  validation: {
    nameRequired: string;
    modeInvalid: string;
    quorumInvalid: string;
    stageInvalid: string;
    approverRequired: string;
    approverRefRequired: string;
    quorumAtLeastOne: string;
    quorumExceedsApprovers: string;
    minExceedsMax: string;
    authorityAmountNegative: string;
    formFieldIncomplete: (index: number) => string;
    formFieldSelectNeedsOption: (index: number) => string;
    validFromAfterUntil: string;
  };
  conflict: {
    checkConflicts: string;
    checking: string;
    noneTitle: string;
    noneDescription: string;
    conflictsHeader: (count: number) => string;
    identicalHeader: string;
  };
  instantiate: {
    title: string;
    description: (name: string) => string;
    overrideName: string;
    overrideNamePlaceholder: string;
    status: string;
    statusKeep: string;
    requestType: string;
    requestTypePlaceholder: string;
    department: string;
    departmentPlaceholder: string;
    hint: string;
    cancel: string;
    confirm: string;
    successTitle: string;
    successWithId: (id: string) => string;
    openPolicies: string;
  };
  statusLabels: Record<string, string>;
  deleteConfirm: {
    title: string;
    description: (name: string) => string;
    fallbackDescription: string;
    confirm: string;
  };
  toast: {
    created: string;
    updated: string;
    deleted: string;
    instantiated: string;
  };
}

const templateLabels: LexBilingual<TemplateLabels> = {
  en: {
    pageTitle: 'Request-approval policy templates',
    pageDescription:
      'Reusable named policy definitions that a concrete request-approval policy can be materialised from.',
    newTemplate: 'New template',
    backToPolicies: 'Back to policies',
    policiesLink: 'Policies',
    metrics: {
      templates: 'Templates',
      categories: 'Categories',
    },
    catalog: {
      title: 'Template catalog',
      description: 'Named definitions you can clone into a live request-approval policy.',
      loadError: 'We could not load the templates.',
      retry: 'Try again',
      emptyTitle: 'No templates yet',
      emptyDescription: 'Create a reusable template to standardise request-approval routing.',
      columns: {
        template: 'Template',
        category: 'Category',
        description: 'Description',
        updated: 'Updated',
        actions: 'Actions',
      },
      uncategorized: 'Uncategorised',
      noDescription: 'No description',
      editAria: (name) => `Edit ${name}`,
      deleteAria: (name) => `Delete ${name}`,
      instantiateAria: (name) => `Instantiate ${name} into a policy`,
      instantiate: 'Instantiate → policy',
    },
    dialog: {
      createTitle: 'New template',
      editTitle: 'Edit template',
      description:
        'Define the reusable policy shape. The structured editor below is the single source of truth; the JSON preview is read-only.',
      name: 'Name',
      namePlaceholder: 'e.g. Standard procurement request routing',
      descriptionField: 'Description',
      descriptionPlaceholder: 'Explain when this template should be used.',
      category: 'Category',
      categoryPlaceholder: 'e.g. procurement',
      commonCategories: 'Common categories',
      definitionSectionTitle: 'Definition',
      definitionSectionDescription:
        'The policy shape this template materialises. Every field below feeds the derived definition.',
      sections: {
        scope: 'Scope',
        routing: 'Routing',
        authority: 'Authority evidence',
        approvers: 'Approvers',
        formFields: 'Approval form fields',
        validity: 'Validity window',
      },
      requestType: 'Request type',
      requestTypePlaceholder: 'e.g. contract_review (blank ⇒ any)',
      service: 'Service',
      serviceAny: 'Any service',
      selectService: 'Select service',
      stage: 'Stage',
      stageAny: 'Any stage',
      department: 'Department',
      departmentPlaceholder: 'Legal',
      priorityTier: 'Priority tier',
      priorityTierPlaceholder: 'urgent',
      priority: 'Priority',
      priorityPlaceholder: '10',
      currency: 'Currency',
      currencyPlaceholder: 'SAR',
      minValue: 'Minimum value',
      minValuePlaceholder: '100000',
      maxValue: 'Maximum value',
      maxValuePlaceholder: '500000',
      mode: 'Mode',
      quorum: 'Quorum',
      quorumCount: 'Quorum count (N)',
      authorityEvidence: 'Authority evidence',
      authorityEvidenceDescription: 'Require decision evidence for matching approval tasks.',
      toggleAuthorityEvidence: 'Toggle authority evidence',
      requiredRole: 'Required role',
      requiredRolePlaceholder: 'legal_director',
      authorityAmount: 'Authority amount',
      authorityAmountPlaceholder: '500000',
      approvers: 'Approvers',
      approversDescription: 'Roles or users routed for approval. At least one reference is required.',
      add: 'Add',
      approverType: 'Approver type',
      approverRefRolePlaceholder: 'Role key (e.g. legal_counsel)',
      approverRefUserPlaceholder: 'Search users',
      approverLabelPlaceholder: 'Display label',
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
      advancedTitle: 'Advanced metadata',
      advancedDescription:
        'Arbitrary extra keys merged into the definition. They can never overwrite a managed field above.',
      metadataKeyPlaceholder: 'Key (e.g. routing_note)',
      metadataValuePlaceholder: 'Value (JSON or text)',
      addMetadata: 'Add metadata',
      removeMetadata: 'Remove metadata entry',
      metadataReservedKey: 'This key is managed by the fields above and will be ignored.',
      definitionPreviewTitle: 'Definition JSON (read-only preview)',
      definitionPreviewDescription:
        'Derived from the fields above. This is the exact definition that will be saved.',
      showPreview: 'Show JSON preview',
      hidePreview: 'Hide JSON preview',
      validationHeader: 'Resolve the following before saving:',
      cancel: 'Cancel',
      create: 'Create template',
      save: 'Save changes',
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
      all: 'All approvers',
      any: 'Any approver',
      n_of_m: 'N of M',
    },
    approverTypeLabels: {
      role: 'Role',
      user: 'User',
    },
    fieldTypeLabels: {
      textarea: 'Textarea',
      text: 'Text',
      select: 'Select',
      number: 'Number',
      date: 'Date',
      boolean: 'Boolean',
    },
    validation: {
      nameRequired: 'A template name is required.',
      modeInvalid: 'Mode must be sequential or parallel.',
      quorumInvalid: 'Quorum must be all, any, or N of M.',
      stageInvalid: 'Stage must be requester, provider, or any.',
      approverRequired: 'Add at least one approver reference.',
      approverRefRequired: 'Every approver needs a non-empty reference.',
      quorumAtLeastOne: 'The quorum count must be at least 1.',
      quorumExceedsApprovers: 'The quorum count cannot exceed the number of approvers.',
      minExceedsMax: 'Minimum value cannot exceed maximum value.',
      authorityAmountNegative: 'Authority amount cannot be negative.',
      formFieldIncomplete: (index) => `Form field ${index} needs a name, type, and label.`,
      formFieldSelectNeedsOption: (index) =>
        `Select field ${index} needs at least one option.`,
      validFromAfterUntil: 'Valid-from date cannot be after valid-until date.',
    },
    conflict: {
      checkConflicts: 'Preview conflicts',
      checking: 'Checking conflicts...',
      noneTitle: 'No overlapping policies',
      noneDescription: 'The resolved scope does not overlap an existing active policy.',
      conflictsHeader: (count) => `Overlaps ${count} existing polic${count === 1 ? 'y' : 'ies'}`,
      identicalHeader: 'An identical policy already exists for this scope.',
    },
    instantiate: {
      title: 'Instantiate template',
      description: (name) => `Materialise a live request-approval policy from "${name}".`,
      overrideName: 'Policy name (override)',
      overrideNamePlaceholder: 'Leave blank to inherit the template name',
      status: 'Status',
      statusKeep: 'Inherit from template',
      requestType: 'Request type (override)',
      requestTypePlaceholder: 'Leave blank to inherit',
      department: 'Department (override)',
      departmentPlaceholder: 'Leave blank to inherit',
      hint: 'Overrides win per-field; blank fields inherit the template definition.',
      cancel: 'Cancel',
      confirm: 'Instantiate',
      successTitle: 'Policy created from template.',
      successWithId: (id) => `Created policy ${id}.`,
      openPolicies: 'Open policies',
    },
    statusLabels: {
      draft: 'Draft',
      active: 'Active',
      archived: 'Archived',
    },
    deleteConfirm: {
      title: 'Delete template',
      description: (name) => `Delete "${name}"? This cannot be undone.`,
      fallbackDescription: 'Delete this template? This cannot be undone.',
      confirm: 'Delete',
    },
    toast: {
      created: 'Template created.',
      updated: 'Template updated.',
      deleted: 'Template deleted.',
      instantiated: 'Policy created from template.',
    },
  },
  ar: {
    pageTitle: 'قوالب لوائح اعتماد الطلبات',
    pageDescription:
      'تعريفات لوائح معاد استخدامها ومُسمّاة يمكن اشتقاق لائحة اعتماد طلبات فعلية منها.',
    newTemplate: 'قالب جديد',
    backToPolicies: 'العودة إلى اللوائح',
    policiesLink: 'اللوائح',
    metrics: {
      templates: 'القوالب',
      categories: 'الفئات',
    },
    catalog: {
      title: 'فهرس القوالب',
      description: 'تعريفات مُسمّاة يمكنك استنساخها إلى لائحة اعتماد طلبات فعلية.',
      loadError: 'تعذّر تحميل القوالب.',
      retry: 'إعادة المحاولة',
      emptyTitle: 'لا توجد قوالب بعد',
      emptyDescription: 'أنشئ قالبًا قابلًا لإعادة الاستخدام لتوحيد توجيه اعتماد الطلبات.',
      columns: {
        template: 'القالب',
        category: 'الفئة',
        description: 'الوصف',
        updated: 'آخر تحديث',
        actions: 'الإجراءات',
      },
      uncategorized: 'غير مُصنّف',
      noDescription: 'لا يوجد وصف',
      editAria: (name) => `تعديل ${name}`,
      deleteAria: (name) => `حذف ${name}`,
      instantiateAria: (name) => `اشتقاق لائحة من ${name}`,
      instantiate: 'اشتقاق ← لائحة',
    },
    dialog: {
      createTitle: 'قالب جديد',
      editTitle: 'تعديل القالب',
      description:
        'عرّف شكل اللائحة القابل لإعادة الاستخدام. المحرر المُهيكل أدناه هو المصدر الوحيد للحقيقة؛ ومعاينة JSON للقراءة فقط.',
      name: 'الاسم',
      namePlaceholder: 'مثال: توجيه طلبات المشتريات القياسي',
      descriptionField: 'الوصف',
      descriptionPlaceholder: 'وضّح متى يُستخدم هذا القالب.',
      category: 'الفئة',
      categoryPlaceholder: 'مثال: المشتريات',
      commonCategories: 'فئات شائعة',
      definitionSectionTitle: 'التعريف',
      definitionSectionDescription:
        'شكل اللائحة الذي يشتقّه هذا القالب. كل حقل أدناه يُغذّي التعريف المُشتقّ.',
      sections: {
        scope: 'النطاق',
        routing: 'التوجيه',
        authority: 'إثبات الصلاحية',
        approvers: 'المعتمِدون',
        formFields: 'حقول نموذج الموافقة',
        validity: 'نافذة الصلاحية',
      },
      requestType: 'نوع الطلب',
      requestTypePlaceholder: 'مثال: contract_review (فارغ ⇐ أي نوع)',
      service: 'الخدمة',
      serviceAny: 'أي خدمة',
      selectService: 'اختر الخدمة',
      stage: 'المرحلة',
      stageAny: 'أي مرحلة',
      department: 'الإدارة',
      departmentPlaceholder: 'القانونية',
      priorityTier: 'فئة الأولوية',
      priorityTierPlaceholder: 'urgent',
      priority: 'الأولوية',
      priorityPlaceholder: '10',
      currency: 'العملة',
      currencyPlaceholder: 'SAR',
      minValue: 'الحد الأدنى للقيمة',
      minValuePlaceholder: '100000',
      maxValue: 'الحد الأقصى للقيمة',
      maxValuePlaceholder: '500000',
      mode: 'النمط',
      quorum: 'النصاب',
      quorumCount: 'عدد النصاب (N)',
      authorityEvidence: 'إثبات الصلاحية',
      authorityEvidenceDescription: 'اشتراط إثبات القرار لمهام الموافقة المطابقة.',
      toggleAuthorityEvidence: 'تبديل إثبات الصلاحية',
      requiredRole: 'الدور المطلوب',
      requiredRolePlaceholder: 'legal_director',
      authorityAmount: 'مبلغ الصلاحية',
      authorityAmountPlaceholder: '500000',
      approvers: 'المعتمِدون',
      approversDescription: 'الأدوار أو المستخدمون المُوجَّهون للاعتماد. يلزم مرجع واحد على الأقل.',
      add: 'إضافة',
      approverType: 'نوع المعتمِد',
      approverRefRolePlaceholder: 'مفتاح الدور (مثال: legal_counsel)',
      approverRefUserPlaceholder: 'ابحث عن مستخدم',
      approverLabelPlaceholder: 'التسمية الظاهرة',
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
      advancedTitle: 'بيانات وصفية متقدمة',
      advancedDescription:
        'مفاتيح إضافية اختيارية تُدمج في التعريف. لا يمكنها أبدًا استبدال أي حقل مُدار أعلاه.',
      metadataKeyPlaceholder: 'المفتاح (مثال: routing_note)',
      metadataValuePlaceholder: 'القيمة (JSON أو نص)',
      addMetadata: 'إضافة بيان وصفي',
      removeMetadata: 'إزالة البيان الوصفي',
      metadataReservedKey: 'هذا المفتاح مُدار بواسطة الحقول أعلاه وسيتم تجاهله.',
      definitionPreviewTitle: 'تعريف JSON (معاينة للقراءة فقط)',
      definitionPreviewDescription:
        'مُشتقّ من الحقول أعلاه. هذا هو التعريف الدقيق الذي سيُحفظ.',
      showPreview: 'إظهار معاينة JSON',
      hidePreview: 'إخفاء معاينة JSON',
      validationHeader: 'عالِج ما يلي قبل الحفظ:',
      cancel: 'إلغاء',
      create: 'إنشاء القالب',
      save: 'حفظ التغييرات',
    },
    stageLabels: {
      requester: 'مُقدّم الطلب',
      provider: 'الجهة المُقدِّمة للخدمة',
    },
    modeLabels: {
      parallel: 'متوازٍ',
      sequential: 'متسلسل',
    },
    quorumLabels: {
      all: 'جميع المعتمِدين',
      any: 'أي معتمِد',
      n_of_m: 'N من M',
    },
    approverTypeLabels: {
      role: 'دور',
      user: 'مستخدم',
    },
    fieldTypeLabels: {
      textarea: 'منطقة نص',
      text: 'نص',
      select: 'قائمة اختيار',
      number: 'رقم',
      date: 'تاريخ',
      boolean: 'منطقي',
    },
    validation: {
      nameRequired: 'اسم القالب مطلوب.',
      modeInvalid: 'يجب أن يكون النمط متسلسلًا أو متوازيًا.',
      quorumInvalid: 'يجب أن يكون النصاب: الكل أو أي أو N من M.',
      stageInvalid: 'يجب أن تكون المرحلة: مُقدّم الطلب أو مُقدّم الخدمة أو أي مرحلة.',
      approverRequired: 'أضف مرجع معتمِد واحدًا على الأقل.',
      approverRefRequired: 'يجب أن يحمل كل معتمِد مرجعًا غير فارغ.',
      quorumAtLeastOne: 'يجب ألا يقل عدد النصاب عن 1.',
      quorumExceedsApprovers: 'لا يمكن أن يتجاوز عدد النصاب عدد المعتمِدين.',
      minExceedsMax: 'لا يمكن أن يتجاوز الحد الأدنى للقيمة الحد الأقصى.',
      authorityAmountNegative: 'لا يمكن أن يكون مبلغ الصلاحية سالبًا.',
      formFieldIncomplete: (index) => `الحقل ${index} يحتاج إلى اسم ونوع وتسمية.`,
      formFieldSelectNeedsOption: (index) => `حقل الاختيار ${index} يحتاج خيارًا واحدًا على الأقل.`,
      validFromAfterUntil: 'لا يمكن أن يكون تاريخ "صالح من" بعد تاريخ "صالح حتى".',
    },
    conflict: {
      checkConflicts: 'معاينة التعارض',
      checking: 'جارٍ فحص التعارض...',
      noneTitle: 'لا توجد لوائح متداخلة',
      noneDescription: 'لا يتداخل النطاق المُشتقّ مع لائحة نشطة قائمة.',
      conflictsHeader: (count) => `يتداخل مع ${count} لائحة قائمة`,
      identicalHeader: 'توجد لائحة مطابقة لهذا النطاق بالفعل.',
    },
    instantiate: {
      title: 'اشتقاق القالب',
      description: (name) => `اشتقاق لائحة اعتماد طلبات فعلية من «${name}».`,
      overrideName: 'اسم اللائحة (تجاوز)',
      overrideNamePlaceholder: 'اتركه فارغًا لوراثة اسم القالب',
      status: 'الحالة',
      statusKeep: 'وراثة من القالب',
      requestType: 'نوع الطلب (تجاوز)',
      requestTypePlaceholder: 'اتركه فارغًا للوراثة',
      department: 'القسم (تجاوز)',
      departmentPlaceholder: 'اتركه فارغًا للوراثة',
      hint: 'تتغلّب التجاوزات لكل حقل؛ وترث الحقول الفارغة تعريف القالب.',
      cancel: 'إلغاء',
      confirm: 'اشتقاق',
      successTitle: 'تم إنشاء اللائحة من القالب.',
      successWithId: (id) => `تم إنشاء اللائحة ${id}.`,
      openPolicies: 'فتح اللوائح',
    },
    statusLabels: {
      draft: 'مسودة',
      active: 'ساري',
      archived: 'مؤرشف',
    },
    deleteConfirm: {
      title: 'حذف القالب',
      description: (name) => `حذف «${name}»؟ لا يمكن التراجع عن هذا الإجراء.`,
      fallbackDescription: 'حذف هذا القالب؟ لا يمكن التراجع عن هذا الإجراء.',
      confirm: 'حذف',
    },
    toast: {
      created: 'تم إنشاء القالب.',
      updated: 'تم تحديث القالب.',
      deleted: 'تم حذف القالب.',
      instantiated: 'تم إنشاء اللائحة من القالب.',
    },
  },
};

/** React hook resolving the template labels against the active locale. */
export function useTemplateLabels(): TemplateLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveLexBilingual(templateLabels, locale), [locale]);
}

/** Pure resolver (non-React / tests); English default. */
export function resolveTemplateLabels(locale: AppLocale): TemplateLabels {
  return resolveLexBilingual(templateLabels, locale);
}

/**
 * Resolve a stable validation key emitted by `validateDefinition` (in
 * `_lib/template-definition.ts`) into a localized message. Keys carrying a
 * `:index` suffix (form-field errors) interpolate the 1-based row index. Unknown
 * keys fall back to the raw key so nothing silently disappears.
 */
export function resolveValidationMessage(key: string, labels: TemplateLabels): string {
  const [base, rawIndex] = key.split(':');
  const index = rawIndex ? Number.parseInt(rawIndex, 10) : NaN;
  const v = labels.validation;
  switch (base) {
    case 'mode_invalid':
      return v.modeInvalid;
    case 'quorum_invalid':
      return v.quorumInvalid;
    case 'stage_invalid':
      return v.stageInvalid;
    case 'approver_required':
      return v.approverRequired;
    case 'approver_ref_required':
      return v.approverRefRequired;
    case 'quorum_at_least_one':
      return v.quorumAtLeastOne;
    case 'quorum_exceeds_approvers':
      return v.quorumExceedsApprovers;
    case 'min_exceeds_max':
      return v.minExceedsMax;
    case 'authority_amount_negative':
      return v.authorityAmountNegative;
    case 'form_field_incomplete':
      return v.formFieldIncomplete(Number.isFinite(index) ? index : 0);
    case 'form_field_select_needs_option':
      return v.formFieldSelectNeedsOption(Number.isFinite(index) ? index : 0);
    case 'valid_from_after_until':
      return v.validFromAfterUntil;
    default:
      return key;
  }
}
