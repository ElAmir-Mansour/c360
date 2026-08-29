'use client';

/**
 * Bilingual (English + Modern Standard Arabic) label bundle for the
 * regulation-library surface (page + authoring/search/governance/clause-link
 * components).
 *
 * Follows the canonical lex i18n contract (see `../../_lib/lex-i18n.ts`): a
 * single {@link LexBilingual} bundle with two full, same-shaped copies and a
 * thin `useRegulationLabels()` hook that resolves against the active locale.
 * The `en` side equals the pre-existing English strings exactly so existing
 * English-asserting tests stay green; the `ar` side is professional MSA for the
 * enterprise legal/regulatory domain.
 *
 * Glossary anchors: لائحة/نظام (regulation/law) / بند (clause) / حوكمة
 * (governance) / اختصاص (jurisdiction) / امتثال (compliance) / مصدر (source).
 */

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n';
import { type LexBilingual, resolveLexBilingual } from '../../_lib/lex-i18n';

export interface RegulationReferenceTypeOption {
  label: string;
  value: 'implements' | 'required_by' | 'recommended_by' | 'impacted_by' | 'related';
}

export interface RegulationLabels {
  page: {
    title: string;
    description: string;
    searchPlaceholder: string;
    emptyTitle: string;
    emptyDescription: string;
  };
  metrics: {
    total: string;
    active: string;
    pending: string;
    approved: string;
    inReview: string;
    rejected: string;
    draft: string;
    eyebrow: string;
    emptyCta: string;
  };
  metricDetails: {
    total: string;
    active: string;
    pending: string;
    inReview: string;
    approved: string;
    rejected: string;
    regulationShare: string;
    governanceQueue: string;
  };
  columns: {
    regulation: string;
    authority: string;
    jurisdiction: string;
    governance: string;
    type: string;
    status: string;
    effective: string;
    updated: string;
    noSummary: string;
    unspecified: string;
    defaultJurisdiction: string;
    defaultType: string;
    noDate: string;
  };
  filters: {
    status: string;
    jurisdiction: string;
    governance: string;
    statusOptions: {
      draft: string;
      active: string;
      superseded: string;
      deprecated: string;
      archived: string;
    };
    jurisdictionOptions: {
      SA: string;
      GCC: string;
      GLOBAL: string;
    };
    governanceOptions: {
      pending_review: string;
      in_review: string;
      approved: string;
      rejected: string;
    };
  };
  governance: {
    reviewer: string;
    reviewerPlaceholder: string;
    reviewerEmail: string;
    reviewerEmailPlaceholder: string;
    comment: string;
    activateApproved: string;
    cancel: string;
    submitting: string;
    detailsRequiredTitle: string;
    detailsRequiredMessage: string;
    decisionFailedTitle: string;
    sourceFallback: string;
    actions: {
      submitReview: {
        label: string;
        title: string;
        description: string;
        submitLabel: string;
        successTitle: string;
        commentPlaceholder: string;
      };
      approve: {
        label: string;
        title: string;
        description: string;
        submitLabel: string;
        successTitle: string;
        commentPlaceholder: string;
      };
      requestChanges: {
        label: string;
        title: string;
        description: string;
        submitLabel: string;
        successTitle: string;
        commentPlaceholder: string;
      };
      reject: {
        label: string;
        title: string;
        description: string;
        submitLabel: string;
        successTitle: string;
        commentPlaceholder: string;
      };
    };
  };
  actions: {
    create: string;
    edit: string;
    delete: string;
    links: string;
  };
  form: {
    createTitle: string;
    editTitle: string;
    createDescription: string;
    editDescription: string;
    sectionIdentity: string;
    sectionContent: string;
    sectionClassification: string;
    code: string;
    codePlaceholder: string;
    titleEn: string;
    titleEnPlaceholder: string;
    titleAr: string;
    titleArPlaceholder: string;
    descriptionEn: string;
    descriptionEnPlaceholder: string;
    descriptionAr: string;
    descriptionArPlaceholder: string;
    authority: string;
    authorityPlaceholder: string;
    jurisdiction: string;
    regulationType: string;
    source: string;
    sourcePlaceholder: string;
    sourceUrl: string;
    sourceUrlPlaceholder: string;
    effectiveDate: string;
    status: string;
    tags: string;
    tagsPlaceholder: string;
    tagsHint: string;
    cancel: string;
    submitCreate: string;
    submitEdit: string;
    requiredError: string;
  };
  search: {
    title: string;
    description: string;
    placeholder: string;
    semanticLabel: string;
    emptyPrompt: string;
    noResults: string;
    loading: string;
    errorTitle: string;
    matchedFields: string;
    scoreLabel: string;
    /** Localized names for the raw `matched_fields` tokens the search API returns. */
    matchedFieldNames: Record<string, string>;
  };
  links: {
    title: string;
    description: string;
    referenceType: string;
    clause: string;
    clausePlaceholder: string;
    notes: string;
    notesPlaceholder: string;
    linkSubmit: string;
    empty: string;
    loading: string;
    errorTitle: string;
    unlink: string;
    close: string;
    sourceFallback: string;
  };
  referenceTypeOptions: RegulationReferenceTypeOption[];
  toast: {
    created: string;
    updated: string;
    deleted: string;
    linked: string;
    unlinked: string;
  };
  confirmDelete: {
    title: string;
    description: (title: string) => string;
    confirmLabel: string;
  };
}

export const regulationLabels: LexBilingual<RegulationLabels> = {
  en: {
    page: {
      title: 'Regulation Library',
      description: 'Saudi and regional legal source library mapped to Watheeq compliance rules.',
      searchPlaceholder: 'Search regulations...',
      emptyTitle: 'No regulations found',
      emptyDescription: 'No regulation-library records matched the current filters.',
    },
    metrics: {
      total: 'Total Regulations',
      active: 'Active',
      pending: 'Pending Review',
      approved: 'Approved',
      inReview: 'In Review',
      rejected: 'Rejected',
      draft: 'Draft',
      eyebrow: 'Regulatory Governance',
      emptyCta: 'Add your first regulation',
    },
    metricDetails: {
      total: 'Regulatory library records in the current governance view.',
      active: 'Regulations currently effective for compliance mapping.',
      pending: 'Records waiting for governance review.',
      inReview: 'Regulations actively being reviewed.',
      approved: 'Governance-approved regulatory records.',
      rejected: 'Records rejected during governance review.',
      regulationShare: 'Regulation share',
      governanceQueue: 'Governance queue',
    },
    columns: {
      regulation: 'Regulation',
      authority: 'Authority',
      jurisdiction: 'Jurisdiction',
      governance: 'Governance',
      type: 'Type',
      status: 'Status',
      effective: 'Effective',
      updated: 'Updated',
      noSummary: 'No summary provided',
      unspecified: 'Unspecified',
      defaultJurisdiction: 'Global',
      defaultType: 'Regulation',
      noDate: 'No date',
    },
    filters: {
      status: 'Status',
      jurisdiction: 'Jurisdiction',
      governance: 'Governance',
      statusOptions: {
        draft: 'Draft',
        active: 'Active',
        superseded: 'Superseded',
        deprecated: 'Deprecated',
        archived: 'Archived',
      },
      jurisdictionOptions: {
        SA: 'Saudi Arabia',
        GCC: 'GCC',
        GLOBAL: 'Global',
      },
      governanceOptions: {
        pending_review: 'Pending Review',
        in_review: 'In Review',
        approved: 'Approved',
        rejected: 'Rejected',
      },
    },
    governance: {
      reviewer: 'Reviewer',
      reviewerPlaceholder: 'Reviewer name',
      reviewerEmail: 'Reviewer email',
      reviewerEmailPlaceholder: 'reviewer@example.com',
      comment: 'Comment',
      activateApproved: 'Activate approved regulation',
      cancel: 'Cancel',
      submitting: 'Submitting...',
      detailsRequiredTitle: 'Decision details required.',
      detailsRequiredMessage: 'Add a reviewer and governance comment before submitting.',
      decisionFailedTitle: 'Governance decision failed.',
      sourceFallback: 'Regulation source',
      actions: {
        submitReview: {
          label: 'Submit for review',
          title: 'Submit regulation for governance review',
          description: 'Move this regulation into the Watheeq governance review queue.',
          submitLabel: 'Submit for Review',
          successTitle: 'Regulation submitted for review.',
          commentPlaceholder: 'Summarize why this regulation source is ready for review.',
        },
        approve: {
          label: 'Approve governance',
          title: 'Approve regulation governance',
          description: 'Record reviewer approval for this regulation-library source.',
          submitLabel: 'Approve Regulation',
          successTitle: 'Regulation governance approved.',
          commentPlaceholder: 'Add the legal or operational basis for approval.',
        },
        requestChanges: {
          label: 'Request changes',
          title: 'Request regulation changes',
          description:
            'Return this regulation source with reviewer comments while preserving the governance audit trail.',
          submitLabel: 'Request Changes',
          successTitle: 'Regulation changes requested.',
          commentPlaceholder:
            'Describe the source, citation, or mapping changes required before approval.',
        },
        reject: {
          label: 'Reject governance',
          title: 'Reject regulation governance',
          description: 'Record a final rejection for this regulation-library source.',
          submitLabel: 'Reject Regulation',
          successTitle: 'Regulation governance rejected.',
          commentPlaceholder: 'Explain why this regulation source cannot be approved.',
        },
      },
    },
    actions: {
      create: 'New Regulation',
      edit: 'Edit regulation',
      delete: 'Delete regulation',
      links: 'Linked clauses',
    },
    form: {
      createTitle: 'New regulation source',
      editTitle: 'Edit regulation source',
      createDescription:
        'Register a Saudi or regional legal source. New sources start in draft governance and can be submitted for Watheeq review afterwards.',
      editDescription:
        'Update the regulation source, citation, and lifecycle state. Governance review history is preserved.',
      sectionIdentity: 'Identity',
      sectionContent: 'Description',
      sectionClassification: 'Classification',
      code: 'Code',
      codePlaceholder: 'PDPL-2023',
      titleEn: 'Title (English)',
      titleEnPlaceholder: 'Personal Data Protection Law',
      titleAr: 'Title (Arabic)',
      titleArPlaceholder: 'نظام حماية البيانات الشخصية',
      descriptionEn: 'Description (English)',
      descriptionEnPlaceholder: 'Summarize the scope and applicability of this source.',
      descriptionAr: 'Description (Arabic)',
      descriptionArPlaceholder: 'لخص نطاق هذا المصدر وقابليته للتطبيق.',
      authority: 'Authority',
      authorityPlaceholder: 'SDAIA',
      jurisdiction: 'Jurisdiction',
      regulationType: 'Type',
      source: 'Source',
      sourcePlaceholder: 'official_gazette',
      sourceUrl: 'Source URL',
      sourceUrlPlaceholder: 'https://example.gov.sa/regulation',
      effectiveDate: 'Effective date',
      status: 'Status',
      tags: 'Tags',
      tagsPlaceholder: 'privacy, data',
      tagsHint: 'Comma-separated tags.',
      cancel: 'Cancel',
      submitCreate: 'Create regulation',
      submitEdit: 'Save changes',
      requiredError: 'Add a code and English title before saving.',
    },
    search: {
      title: 'Regulation search',
      description:
        'Full-text and semantic search across the regulation library, scored by relevance.',
      placeholder: 'Search regulations by title, authority, or tag...',
      semanticLabel: 'Semantic search',
      emptyPrompt: 'Enter a query above to search the regulation library.',
      noResults: 'No regulations matched this query.',
      loading: 'Searching regulations...',
      errorTitle: 'Search failed.',
      matchedFields: 'Matched',
      scoreLabel: 'Relevance',
      matchedFieldNames: {
        code: 'Code',
        title_en: 'Title (English)',
        title_ar: 'Title (Arabic)',
        description_en: 'Description (English)',
        description_ar: 'Description (Arabic)',
        tags: 'Tags',
        jurisdiction: 'Jurisdiction',
        authority: 'Authority',
        regulation_type: 'Type',
        status: 'Status',
        risk_level: 'Risk level',
        clause_mappings: 'Linked clauses',
      },
    },
    links: {
      title: 'Linked clauses',
      description: 'Map clause-library entries to this regulation to track implementation coverage.',
      referenceType: 'Reference type',
      clause: 'Clause',
      clausePlaceholder: 'Select a clause to link...',
      notes: 'Notes',
      notesPlaceholder: 'Why this clause implements or relates to the regulation.',
      linkSubmit: 'Link clause',
      empty: 'No clauses are linked to this regulation yet.',
      loading: 'Loading linked clauses...',
      errorTitle: 'Failed to load linked clauses.',
      unlink: 'Unlink',
      close: 'Close',
      sourceFallback: 'Regulation source',
    },
    referenceTypeOptions: [
      { label: 'Implements', value: 'implements' },
      { label: 'Required by', value: 'required_by' },
      { label: 'Recommended by', value: 'recommended_by' },
      { label: 'Impacted by', value: 'impacted_by' },
      { label: 'Related', value: 'related' },
    ],
    toast: {
      created: 'Regulation created.',
      updated: 'Regulation updated.',
      deleted: 'Regulation deleted.',
      linked: 'Clause linked to regulation.',
      unlinked: 'Clause unlinked from regulation.',
    },
    confirmDelete: {
      title: 'Delete regulation source',
      description: (title) =>
        `Delete "${title}"? This removes the regulation source from the active library.`,
      confirmLabel: 'Delete',
    },
  },
  ar: {
    page: {
      title: 'مكتبة اللوائح',
      description: 'مكتبة المصادر القانونية السعودية والإقليمية المرتبطة بقواعد امتثال وثيق.',
      searchPlaceholder: 'ابحث في اللوائح...',
      emptyTitle: 'لا توجد لوائح',
      emptyDescription: 'لا توجد سجلات في مكتبة اللوائح تطابق عوامل التصفية الحالية.',
    },
    metrics: {
      total: 'إجمالي اللوائح',
      active: 'سارية',
      pending: 'بانتظار المراجعة',
      approved: 'موافَق عليها',
      inReview: 'قيد المراجعة',
      rejected: 'مرفوضة',
      draft: 'مسودة',
      eyebrow: 'حوكمة اللوائح',
      emptyCta: 'أضف أول لائحة',
    },
    metricDetails: {
      total: 'سجلات مكتبة اللوائح في عرض الحوكمة الحالي.',
      active: 'لوائح سارية حاليًا لربط الامتثال.',
      pending: 'سجلات تنتظر مراجعة الحوكمة.',
      inReview: 'لوائح تخضع للمراجعة حاليًا.',
      approved: 'سجلات تنظيمية معتمدة من الحوكمة.',
      rejected: 'سجلات رُفضت أثناء مراجعة الحوكمة.',
      regulationShare: 'حصة اللوائح',
      governanceQueue: 'قائمة الحوكمة',
    },
    columns: {
      regulation: 'اللائحة',
      authority: 'الجهة',
      jurisdiction: 'الاختصاص',
      governance: 'الحوكمة',
      type: 'النوع',
      status: 'الحالة',
      effective: 'تاريخ السريان',
      updated: 'آخر تحديث',
      noSummary: 'لا يوجد ملخص',
      unspecified: 'غير محدد',
      defaultJurisdiction: 'عالمي',
      defaultType: 'لائحة',
      noDate: 'بلا تاريخ',
    },
    filters: {
      status: 'الحالة',
      jurisdiction: 'الاختصاص',
      governance: 'الحوكمة',
      statusOptions: {
        draft: 'مسودة',
        active: 'ساري',
        superseded: 'مُستبدل',
        deprecated: 'موقوف',
        archived: 'مؤرشف',
      },
      jurisdictionOptions: {
        SA: 'المملكة العربية السعودية',
        GCC: 'دول الخليج',
        GLOBAL: 'عالمي',
      },
      governanceOptions: {
        pending_review: 'بانتظار المراجعة',
        in_review: 'قيد المراجعة',
        approved: 'موافَق عليه',
        rejected: 'مرفوض',
      },
    },
    governance: {
      reviewer: 'المراجِع',
      reviewerPlaceholder: 'اسم المراجِع',
      reviewerEmail: 'بريد المراجِع الإلكتروني',
      reviewerEmailPlaceholder: 'reviewer@example.com',
      comment: 'تعليق',
      activateApproved: 'تفعيل اللائحة الموافَق عليها',
      cancel: 'إلغاء',
      submitting: 'جارٍ الإرسال...',
      detailsRequiredTitle: 'تفاصيل القرار مطلوبة.',
      detailsRequiredMessage: 'أضف مراجِعًا وتعليق حوكمة قبل الإرسال.',
      decisionFailedTitle: 'فشل قرار الحوكمة.',
      sourceFallback: 'مصدر اللائحة',
      actions: {
        submitReview: {
          label: 'تقديم للمراجعة',
          title: 'تقديم اللائحة لمراجعة الحوكمة',
          description: 'نقل هذه اللائحة إلى قائمة مراجعة الحوكمة في وثيق.',
          submitLabel: 'تقديم للمراجعة',
          successTitle: 'تم تقديم اللائحة للمراجعة.',
          commentPlaceholder: 'لخّص سبب جاهزية مصدر اللائحة هذا للمراجعة.',
        },
        approve: {
          label: 'الموافقة على الحوكمة',
          title: 'الموافقة على حوكمة اللائحة',
          description: 'تسجيل موافقة المراجِع على مصدر مكتبة اللوائح هذا.',
          submitLabel: 'الموافقة على اللائحة',
          successTitle: 'تمت الموافقة على حوكمة اللائحة.',
          commentPlaceholder: 'أضف الأساس القانوني أو التشغيلي للموافقة.',
        },
        requestChanges: {
          label: 'طلب تعديلات',
          title: 'طلب تعديلات على اللائحة',
          description:
            'إعادة مصدر اللائحة مع تعليقات المراجِع مع الحفاظ على سجل تدقيق الحوكمة.',
          submitLabel: 'طلب تعديلات',
          successTitle: 'تم طلب تعديلات على اللائحة.',
          commentPlaceholder: 'صِف تعديلات المصدر أو الاستشهاد أو الربط المطلوبة قبل الموافقة.',
        },
        reject: {
          label: 'رفض الحوكمة',
          title: 'رفض حوكمة اللائحة',
          description: 'تسجيل رفض نهائي لمصدر مكتبة اللوائح هذا.',
          submitLabel: 'رفض اللائحة',
          successTitle: 'تم رفض حوكمة اللائحة.',
          commentPlaceholder: 'وضّح سبب تعذّر الموافقة على مصدر اللائحة هذا.',
        },
      },
    },
    actions: {
      create: 'لائحة جديدة',
      edit: 'تعديل اللائحة',
      delete: 'حذف اللائحة',
      links: 'البنود المرتبطة',
    },
    form: {
      createTitle: 'مصدر لائحة جديد',
      editTitle: 'تعديل مصدر اللائحة',
      createDescription:
        'سجّل مصدرًا قانونيًا سعوديًا أو إقليميًا. تبدأ المصادر الجديدة في حوكمة المسودة ويمكن تقديمها لمراجعة وثيق لاحقًا.',
      editDescription:
        'حدّث مصدر اللائحة والاستشهاد وحالة دورة الحياة. يُحفظ سجل مراجعة الحوكمة.',
      sectionIdentity: 'الهوية',
      sectionContent: 'الوصف',
      sectionClassification: 'التصنيف',
      code: 'الرمز',
      codePlaceholder: 'PDPL-2023',
      titleEn: 'العنوان (بالإنجليزية)',
      titleEnPlaceholder: 'نظام حماية البيانات الشخصية',
      titleAr: 'العنوان (بالعربية)',
      titleArPlaceholder: 'نظام حماية البيانات الشخصية',
      descriptionEn: 'الوصف (بالإنجليزية)',
      descriptionEnPlaceholder: 'لخّص نطاق هذا المصدر وقابليته للتطبيق.',
      descriptionAr: 'الوصف (بالعربية)',
      descriptionArPlaceholder: 'لخص نطاق هذا المصدر وقابليته للتطبيق.',
      authority: 'الجهة',
      authorityPlaceholder: 'سدايا',
      jurisdiction: 'الاختصاص',
      regulationType: 'النوع',
      source: 'المصدر',
      sourcePlaceholder: 'الجريدة الرسمية',
      sourceUrl: 'رابط المصدر',
      sourceUrlPlaceholder: 'https://example.gov.sa/regulation',
      effectiveDate: 'تاريخ السريان',
      status: 'الحالة',
      tags: 'الوسوم',
      tagsPlaceholder: 'الخصوصية، البيانات',
      tagsHint: 'وسوم مفصولة بفواصل.',
      cancel: 'إلغاء',
      submitCreate: 'إنشاء اللائحة',
      submitEdit: 'حفظ التغييرات',
      requiredError: 'أضف رمزًا وعنوانًا إنجليزيًا قبل الحفظ.',
    },
    search: {
      title: 'بحث اللوائح',
      description: 'بحث نصي ودلالي شامل في مكتبة اللوائح مرتّب حسب الصلة.',
      placeholder: 'ابحث في اللوائح بالعنوان أو الجهة أو الوسم...',
      semanticLabel: 'بحث دلالي',
      emptyPrompt: 'أدخل استعلامًا أعلاه للبحث في مكتبة اللوائح.',
      noResults: 'لا توجد لوائح تطابق هذا الاستعلام.',
      loading: 'جارٍ البحث في اللوائح...',
      errorTitle: 'فشل البحث.',
      matchedFields: 'المطابق',
      scoreLabel: 'الصلة',
      matchedFieldNames: {
        code: 'الرمز',
        title_en: 'العنوان (بالإنجليزية)',
        title_ar: 'العنوان (بالعربية)',
        description_en: 'الوصف (بالإنجليزية)',
        description_ar: 'الوصف (بالعربية)',
        tags: 'الوسوم',
        jurisdiction: 'الاختصاص',
        authority: 'الجهة',
        regulation_type: 'النوع',
        status: 'الحالة',
        risk_level: 'مستوى المخاطر',
        clause_mappings: 'البنود المرتبطة',
      },
    },
    links: {
      title: 'البنود المرتبطة',
      description: 'اربط سجلات مكتبة البنود بهذه اللائحة لتتبّع تغطية التطبيق.',
      referenceType: 'نوع الإسناد',
      clause: 'البند',
      clausePlaceholder: 'اختر بندًا للربط...',
      notes: 'ملاحظات',
      notesPlaceholder: 'سبب تطبيق هذا البند للائحة أو ارتباطه بها.',
      linkSubmit: 'ربط البند',
      empty: 'لا توجد بنود مرتبطة بهذه اللائحة بعد.',
      loading: 'جارٍ تحميل البنود المرتبطة...',
      errorTitle: 'تعذّر تحميل البنود المرتبطة.',
      unlink: 'إلغاء الربط',
      close: 'إغلاق',
      sourceFallback: 'مصدر اللائحة',
    },
    referenceTypeOptions: [
      { label: 'يطبّق', value: 'implements' },
      { label: 'مطلوب بموجب', value: 'required_by' },
      { label: 'موصى به بموجب', value: 'recommended_by' },
      { label: 'متأثر بـ', value: 'impacted_by' },
      { label: 'ذو صلة', value: 'related' },
    ],
    toast: {
      created: 'تم إنشاء اللائحة.',
      updated: 'تم تحديث اللائحة.',
      deleted: 'تم حذف اللائحة.',
      linked: 'تم ربط البند باللائحة.',
      unlinked: 'تم إلغاء ربط البند باللائحة.',
    },
    confirmDelete: {
      title: 'حذف مصدر اللائحة',
      description: (title) => `حذف "${title}"؟ يؤدي ذلك إلى إزالة مصدر اللائحة من المكتبة السارية.`,
      confirmLabel: 'حذف',
    },
  },
};

export function resolveRegulationLabels(locale: AppLocale = 'en'): RegulationLabels {
  return resolveLexBilingual(regulationLabels, locale);
}

export function useRegulationLabels(): RegulationLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveRegulationLabels(locale), [locale]);
}
