/**
 * Feature-local bilingual label catalog for the Contract Approval-Policy
 * Governance admin surface (Watheeq legal suite).
 *
 * This is the GOVERNANCE half of the contract approval policies
 * (`/workflow-policies/approval`): immutable version history, append-only audit
 * log, scope conflict-check, and reusable templates. The live policy editor
 * (create / edit / archive / recommend / analytics) already ships at
 * `/lex/workflow-policies`; this surface exposes the previously UI-less
 * governance routes against the same policy shape (scoped by `contract_type`).
 *
 * Follows the canonical lex bilingual contract (`../../_lib/lex-i18n.ts`,
 * mirroring `request-approval-policies/_labels.ts`): the label group is a
 * `LexBilingual<ContractApprovalPolicyLabels>` bundle with two FULL, same-shaped
 * copies — natural English in `en`, professional MSA in `ar`. Function-valued
 * and nested fields appear on BOTH sides and preserve interpolation params +
 * Western digits.
 *
 * Glossary: عقد (contract) / لائحة (policy) / الحوكمة (governance) / النصاب
 * (quorum) / الصلاحية (authority) / إصدار (version) / تدقيق (audit) / قالب
 * (template) / تعارض (conflict).
 */

'use client';

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n';
import { type LexBilingual, resolveLexBilingual } from '../../_lib/lex-i18n';

export interface ContractApprovalPolicyLabels {
  pageTitle: string;
  pageDescription: string;
  links: {
    templates: string;
    editor: string;
  };
  table: {
    loadError: string;
    emptyTitle: string;
    emptyDescription: string;
    columns: {
      policy: string;
      status: string;
      scope: string;
      route: string;
      updated: string;
      actions: string;
    };
  };
  actions: {
    versions: string;
    audit: string;
    versionsAria: (name: string) => string;
    auditAria: (name: string) => string;
  };
  scope: {
    anyType: string;
    anyDepartment: string;
    anyValue: string;
    separator: string;
    fromValue: (currency: string, value: string) => string;
    upToValue: (currency: string, value: string) => string;
    rangeValue: (currency: string, min: string, max: string) => string;
  };
  conflictTester: {
    title: string;
    description: string;
    selectPolicy: string;
    selectPlaceholder: string;
    run: string;
    running: string;
    noPolicies: string;
    noneTitle: string;
    noneDescription: string;
    conflictsHeader: (count: number) => string;
    identicalHeader: string;
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
  templates: {
    pageTitle: string;
    pageDescription: string;
    backToPolicies: string;
    policiesLink: string;
    newTemplate: string;
    metrics: {
      templates: string;
      categories: string;
    };
    metricCopy: {
      templates: string;
      categories: string;
      currentCatalog: string;
      policyTemplates: string;
      categorizedShare: string;
    };
    catalog: {
      title: string;
      description: string;
      loadError: string;
      emptyTitle: string;
      emptyDescription: string;
      uncategorized: string;
      noDescription: string;
      columns: {
        template: string;
        category: string;
        description: string;
        updated: string;
        actions: string;
      };
      instantiate: string;
      instantiateAria: (name: string) => string;
      editAria: (name: string) => string;
      deleteAria: (name: string) => string;
    };
    toast: {
      deleted: string;
    };
    deleteConfirm: {
      title: string;
      description: (name: string) => string;
      fallbackDescription: string;
      confirm: string;
    };
    form: {
      createTitle: string;
      editTitle: string;
      description: string;
      name: string;
      namePlaceholder: string;
      descriptionField: string;
      descriptionPlaceholder: string;
      category: string;
      categoryPlaceholder: string;
      definition: string;
      definitionHint: string;
      cancel: string;
      save: string;
      create: string;
      validationHeader: string;
    };
    formToast: {
      created: string;
      updated: string;
    };
    formValidation: {
      nameRequired: string;
      definitionInvalid: string;
    };
    instantiate: {
      title: string;
      description: (name: string) => string;
      overrideName: string;
      overrideNamePlaceholder: string;
      status: string;
      statusKeep: string;
      hint: string;
      confirm: string;
      cancel: string;
      successTitle: string;
      successWithId: (id: string) => string;
      openPolicies: string;
    };
    instantiateToast: string;
  };
  statusLabels: Record<string, string>;
  modeLabels: Record<string, string>;
  quorumLabels: Record<string, string>;
  quorumFormat: {
    nOfM: (n: number | string, m: number | string) => string;
  };
}

export const contractApprovalPolicyLabelsBundle: LexBilingual<ContractApprovalPolicyLabels> = {
  en: {
    pageTitle: 'Contract Approval-Policy Governance',
    pageDescription:
      'Version history, audit trail, scope conflict-checks, and reusable templates for the contract approval policies.',
    links: {
      templates: 'Templates',
      editor: 'Policy editor',
    },
    table: {
      loadError: 'Failed to load contract approval policies.',
      emptyTitle: 'No approval policies',
      emptyDescription:
        'Create contract approval policies in the policy editor, then govern their versions and audit trail here.',
      columns: {
        policy: 'Policy',
        status: 'Status',
        scope: 'Scope',
        route: 'Route',
        updated: 'Updated',
        actions: 'Actions',
      },
    },
    actions: {
      versions: 'Versions',
      audit: 'Audit',
      versionsAria: (name) => `View versions of ${name}`,
      auditAria: (name) => `View audit trail of ${name}`,
    },
    scope: {
      anyType: 'Any contract type',
      anyDepartment: 'Any department',
      anyValue: 'Any value',
      separator: ' | ',
      fromValue: (currency, value) => `From ${currency} ${value}`,
      upToValue: (currency, value) => `Up to ${currency} ${value}`,
      rangeValue: (currency, min, max) => `${currency} ${min}-${max}`,
    },
    conflictTester: {
      title: 'Scope conflict check',
      description:
        'Select a policy to check whether its routing scope overlaps other active policies.',
      selectPolicy: 'Policy',
      selectPlaceholder: 'Select a policy',
      run: 'Check conflicts',
      running: 'Checking...',
      noPolicies: 'No policies to check yet.',
      noneTitle: 'No overlapping policies',
      noneDescription: 'This scope does not overlap another active policy.',
      conflictsHeader: (count) => `Overlaps ${count} existing polic${count === 1 ? 'y' : 'ies'}`,
      identicalHeader: 'An identical-scope policy already exists.',
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
    templates: {
      pageTitle: 'Contract Approval-Policy Templates',
      pageDescription:
        'Reusable named policy definitions a concrete contract approval policy can be materialised from.',
      backToPolicies: 'Back to governance',
      policiesLink: 'Governance',
      newTemplate: 'New template',
      metrics: {
        templates: 'Templates',
        categories: 'Categories',
      },
      metricCopy: {
        templates: 'Reusable definitions for creating contract approval policies.',
        categories: 'Classification groups that help teams choose the right template.',
        currentCatalog: 'Current catalog',
        policyTemplates: 'Templates',
        categorizedShare: 'Categorized templates',
      },
      catalog: {
        title: 'Template catalog',
        description: 'Manage the reusable approval-policy templates for this tenant.',
        loadError: 'Failed to load approval-policy templates.',
        emptyTitle: 'No templates yet',
        emptyDescription: 'Create a template to standardise how contract approval policies are defined.',
        uncategorized: 'Uncategorized',
        noDescription: 'No description',
        columns: {
          template: 'Template',
          category: 'Category',
          description: 'Description',
          updated: 'Updated',
          actions: 'Actions',
        },
        instantiate: 'Instantiate',
        instantiateAria: (name) => `Instantiate a policy from ${name}`,
        editAria: (name) => `Edit ${name}`,
        deleteAria: (name) => `Delete ${name}`,
      },
      toast: {
        deleted: 'Template deleted.',
      },
      deleteConfirm: {
        title: 'Delete template',
        description: (name) =>
          `Delete ${name}? This permanently removes the template. Policies already instantiated from it are unaffected.`,
        fallbackDescription: 'Delete this template?',
        confirm: 'Delete',
      },
      form: {
        createTitle: 'Create template',
        editTitle: 'Edit template',
        description:
          'A template definition is the policy-shape JSON (scope, routing, authority, approvers, form fields) that the instantiate action materialises.',
        name: 'Template name',
        namePlaceholder: 'Vendor contracts — dual approval',
        descriptionField: 'Description',
        descriptionPlaceholder: 'Parallel finance + legal approval for vendor contracts above 100k.',
        category: 'Category',
        categoryPlaceholder: 'procurement',
        definition: 'Definition (JSON)',
        definitionHint:
          'Policy-shape JSON: contract_type, department, min_value, max_value, currency, mode, quorum, quorum_n, approvers, form_fields, require_authority_evidence, required_role, required_authority_amount.',
        cancel: 'Cancel',
        save: 'Save changes',
        create: 'Create template',
        validationHeader: 'Resolve template validation issues',
      },
      formToast: {
        created: 'Template created.',
        updated: 'Template updated.',
      },
      formValidation: {
        nameRequired: 'Enter a template name.',
        definitionInvalid: 'The definition must be valid JSON describing a policy object.',
      },
      instantiate: {
        title: 'Instantiate policy',
        description: (name) => `Materialise a concrete approval policy from ${name}.`,
        overrideName: 'Policy name (optional)',
        overrideNamePlaceholder: 'Inherit template name',
        status: 'Status',
        statusKeep: 'Inherit from template',
        hint: 'Blank fields inherit the template definition.',
        confirm: 'Instantiate',
        cancel: 'Cancel',
        successTitle: 'Policy created',
        successWithId: (id) => `Policy ${id} created.`,
        openPolicies: 'Open governance',
      },
      instantiateToast: 'Policy instantiated from template.',
    },
    statusLabels: {
      active: 'Active',
      draft: 'Draft',
      archived: 'Archived',
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
    quorumFormat: {
      nOfM: (n, m) => `${n} of ${m}`,
    },
  },
  ar: {
    pageTitle: 'حوكمة لوائح موافقة العقود',
    pageDescription:
      'سجل الإصدارات وسجل التدقيق وفحص تعارض النطاق والقوالب القابلة لإعادة الاستخدام للوائح موافقة العقود.',
    links: {
      templates: 'القوالب',
      editor: 'محرّر اللوائح',
    },
    table: {
      loadError: 'تعذّر تحميل لوائح موافقة العقود.',
      emptyTitle: 'لا توجد لوائح موافقة',
      emptyDescription:
        'أنشئ لوائح موافقة العقود في محرّر اللوائح، ثم احكم إصداراتها وسجل تدقيقها من هنا.',
      columns: {
        policy: 'اللائحة',
        status: 'الحالة',
        scope: 'النطاق',
        route: 'المسار',
        updated: 'آخر تحديث',
        actions: 'إجراءات',
      },
    },
    actions: {
      versions: 'الإصدارات',
      audit: 'التدقيق',
      versionsAria: (name) => `عرض إصدارات ${name}`,
      auditAria: (name) => `عرض سجل تدقيق ${name}`,
    },
    scope: {
      anyType: 'أي نوع عقد',
      anyDepartment: 'أي إدارة',
      anyValue: 'أي قيمة',
      separator: ' | ',
      fromValue: (currency, value) => `من ${currency} ${value}`,
      upToValue: (currency, value) => `حتى ${currency} ${value}`,
      rangeValue: (currency, min, max) => `${currency} ${min}-${max}`,
    },
    conflictTester: {
      title: 'فحص تعارض النطاق',
      description: 'اختر لائحة لفحص ما إذا كان نطاق توجيهها يتداخل مع لوائح نشطة أخرى.',
      selectPolicy: 'اللائحة',
      selectPlaceholder: 'اختر لائحة',
      run: 'فحص التعارض',
      running: 'جارٍ الفحص...',
      noPolicies: 'لا توجد لوائح للفحص بعد.',
      noneTitle: 'لا توجد لوائح متداخلة',
      noneDescription: 'لا يتداخل هذا النطاق مع لائحة نشطة أخرى.',
      conflictsHeader: (count) => `يتداخل مع ${count} لائحة قائمة`,
      identicalHeader: 'توجد لائحة بنطاق مطابق بالفعل.',
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
    templates: {
      pageTitle: 'قوالب لوائح موافقة العقود',
      pageDescription:
        'تعريفات لوائح مُسمّاة قابلة لإعادة الاستخدام يمكن اشتقاق لائحة موافقة عقود فعلية منها.',
      backToPolicies: 'العودة إلى الحوكمة',
      policiesLink: 'الحوكمة',
      newTemplate: 'قالب جديد',
      metrics: {
        templates: 'القوالب',
        categories: 'التصنيفات',
      },
      metricCopy: {
        templates: 'تعريفات قابلة لإعادة الاستخدام لإنشاء لوائح موافقة العقود.',
        categories: 'مجموعات تصنيف تساعد الفريق على اختيار القالب الصحيح.',
        currentCatalog: 'الكتالوج الحالي',
        policyTemplates: 'قوالب',
        categorizedShare: 'قوالب مصنفة',
      },
      catalog: {
        title: 'كتالوج القوالب',
        description: 'إدارة قوالب لوائح الموافقة القابلة لإعادة الاستخدام لهذا المستأجر.',
        loadError: 'تعذّر تحميل قوالب لوائح الموافقة.',
        emptyTitle: 'لا توجد قوالب بعد',
        emptyDescription: 'أنشئ قالبًا لتوحيد طريقة تعريف لوائح موافقة العقود.',
        uncategorized: 'غير مصنّف',
        noDescription: 'لا يوجد وصف',
        columns: {
          template: 'القالب',
          category: 'التصنيف',
          description: 'الوصف',
          updated: 'آخر تحديث',
          actions: 'إجراءات',
        },
        instantiate: 'اشتقاق',
        instantiateAria: (name) => `اشتقاق لائحة من ${name}`,
        editAria: (name) => `تعديل ${name}`,
        deleteAria: (name) => `حذف ${name}`,
      },
      toast: {
        deleted: 'تم حذف القالب.',
      },
      deleteConfirm: {
        title: 'حذف القالب',
        description: (name) =>
          `حذف ${name}؟ يؤدي ذلك إلى إزالة القالب نهائيًا. اللوائح المشتقّة منه مسبقًا لا تتأثر.`,
        fallbackDescription: 'حذف هذا القالب؟',
        confirm: 'حذف',
      },
      form: {
        createTitle: 'إنشاء قالب',
        editTitle: 'تعديل القالب',
        description:
          'تعريف القالب هو صيغة اللائحة بتنسيق JSON (النطاق، التوجيه، الصلاحية، المعتمدون، حقول النموذج) التي يشتقّها إجراء الاشتقاق.',
        name: 'اسم القالب',
        namePlaceholder: 'عقود الموردين — موافقة مزدوجة',
        descriptionField: 'الوصف',
        descriptionPlaceholder: 'موافقة مالية وقانونية متوازية لعقود الموردين التي تتجاوز 100 ألف.',
        category: 'التصنيف',
        categoryPlaceholder: 'procurement',
        definition: 'التعريف (JSON)',
        definitionHint:
          'صيغة اللائحة بتنسيق JSON: contract_type، department، min_value، max_value، currency، mode، quorum، quorum_n، approvers، form_fields، require_authority_evidence، required_role، required_authority_amount.',
        cancel: 'إلغاء',
        save: 'حفظ التغييرات',
        create: 'إنشاء القالب',
        validationHeader: 'عالج مشكلات التحقق من القالب',
      },
      formToast: {
        created: 'تم إنشاء القالب.',
        updated: 'تم تحديث القالب.',
      },
      formValidation: {
        nameRequired: 'أدخل اسم القالب.',
        definitionInvalid: 'يجب أن يكون التعريف بتنسيق JSON صالح يصف كائن لائحة.',
      },
      instantiate: {
        title: 'اشتقاق لائحة',
        description: (name) => `اشتقاق لائحة موافقة فعلية من ${name}.`,
        overrideName: 'اسم اللائحة (اختياري)',
        overrideNamePlaceholder: 'وراثة اسم القالب',
        status: 'الحالة',
        statusKeep: 'وراثة من القالب',
        hint: 'الحقول الفارغة ترث تعريف القالب.',
        confirm: 'اشتقاق',
        cancel: 'إلغاء',
        successTitle: 'تم إنشاء اللائحة',
        successWithId: (id) => `تم إنشاء اللائحة ${id}.`,
        openPolicies: 'فتح الحوكمة',
      },
      instantiateToast: 'تم اشتقاق اللائحة من القالب.',
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
    quorumFormat: {
      nOfM: (n, m) => `${n} من ${m}`,
    },
  },
};

/**
 * resolveContractApprovalPolicyLabels is the pure resolver for non-React callers
 * and tests; defaults to English so isolated callers keep the English surface.
 */
export function resolveContractApprovalPolicyLabels(
  locale: AppLocale = 'en',
): ContractApprovalPolicyLabels {
  return resolveLexBilingual(contractApprovalPolicyLabelsBundle, locale);
}

/**
 * useContractApprovalPolicyLabels is the memoized React hook the Contract
 * Approval-Policy Governance surface uses to read the resolved labels.
 */
export function useContractApprovalPolicyLabels(): ContractApprovalPolicyLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveContractApprovalPolicyLabels(locale), [locale]);
}
