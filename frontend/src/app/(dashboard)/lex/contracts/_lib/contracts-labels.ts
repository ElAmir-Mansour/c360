/**
 * Feature-local bilingual (English + Modern Standard Arabic) label bundles for
 * the ClarioLegal / Watheeq contracts surface — the list page
 * (`/lex/contracts`), the create/edit dialog, and the contract detail console
 * (`/lex/contracts/[id]`).
 *
 * This file follows the canonical lex bilingual contract VERBATIM (see
 * `../../_lib/lex-i18n.ts`): every label group is a `LexBilingual<T> = { en, ar }`
 * bundle with two FULL, same-shaped copies — `en` equals the pre-existing English
 * strings EXACTLY (so the `renderWithQuery` `en` default keeps every existing
 * English-asserting test green) and `ar` is professional MSA. Function-valued and
 * nested fields appear on BOTH sides and preserve interpolation params, plural
 * shape, and Western digits.
 *
 * Each bundle is exposed through a thin memoized hook (`use<Feature>Labels`) that
 * is the ONLY thing JSX touches. Status/enum maps are keyed by the RAW backend
 * token with the SAME key set on both locales.
 *
 * Glossary (shared across the lex suite): contract = عقد, clause = بند,
 * matter = قضية, obligation = التزام, regulation = لائحة, legal hold = حجز قانوني,
 * signature = توقيع, playbook = دليل إرشادي, compliance = الامتثال,
 * renewal = تجديد, party = طرف, deviation = انحراف, governance = الحوكمة.
 */

'use client';

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n';
import {
  type LexBilingual,
  lexContractStatusLabels,
  resolveLexBilingual,
} from '../../_lib/lex-i18n';

/* ------------------------------------------------------------------------- *
 * Contract list page (`/lex/contracts`).
 * ------------------------------------------------------------------------- */

export interface ContractsListLabels {
  pageTitle: string;
  pageDescription: string;
  createContract: string;
  searchPlaceholder: string;
  emptyTitle: string;
  emptyDescription: string;
  columns: {
    contract: string;
    parties: string;
    status: string;
    value: string;
    expiry: string;
  };
  stats: {
    total: string;
    active: string;
    expiring: string;
    highRisk: string;
  };
  statDetails: {
    portfolioScope: string;
    matchingFilters: string;
    portfolioShare: string;
    activeLifecycle: string;
    activeShare: string;
    renewalWatchlist: string;
    renewalWindow: string;
    renewalShare: string;
    riskWatchlist: string;
    riskShare: string;
  };
  noParties: string;
  undisclosed: string;
  noExpiry: string;
  filters: {
    status: string;
    type: string;
    risk: string;
    expiryFrom: string;
    expiryTo: string;
  };
  view: {
    table: string;
    board: string;
    label: string;
  };
  board: {
    emptyColumn: string;
    noValue: string;
  };
  bulk: {
    exportSelected: string;
    changeStatus: string;
    changeStatusPrompt: (count: number) => string;
    statusUpdated: (count: number) => string;
    statusFailed: string;
    exported: (count: number) => string;
  };
  savedViews: {
    save: string;
    saved: string;
    empty: string;
  };
  moveError: string;
}

export const contractsListLabels: LexBilingual<ContractsListLabels> = {
  en: {
    pageTitle: 'Contracts',
    pageDescription:
      'Contract portfolio across lifecycle state, counterparty coverage, and renewal timing.',
    createContract: 'Create Contract',
    searchPlaceholder: 'Search contracts...',
    emptyTitle: 'No contracts found',
    emptyDescription: 'No contracts matched the current filters.',
    columns: {
      contract: 'Contract',
      parties: 'Parties',
      status: 'Status',
      value: 'Value',
      expiry: 'Expiry',
    },
    stats: {
      total: 'Total contracts',
      active: 'Active',
      expiring: 'Expiring ≤60d',
      highRisk: 'High risk',
    },
    statDetails: {
      portfolioScope: 'Filtered contract register across the current portfolio.',
      matchingFilters: 'Matching filters',
      portfolioShare: 'Portfolio share',
      activeLifecycle: 'Currently active and governed by the lifecycle workflow.',
      activeShare: 'Active share',
      renewalWatchlist: 'Renewals that need owner review inside the next 60 days.',
      renewalWindow: 'Renewal window',
      renewalShare: 'Renewal exposure',
      riskWatchlist: 'Critical or high-risk contracts requiring legal attention.',
      riskShare: 'Risk exposure',
    },
    noParties: '—',
    undisclosed: 'Undisclosed',
    noExpiry: 'No expiry',
    filters: {
      status: 'Status',
      type: 'Type',
      risk: 'Risk',
      expiryFrom: 'Expiry from',
      expiryTo: 'Expiry to',
    },
    view: {
      table: 'Table',
      board: 'Board',
      label: 'View mode',
    },
    board: {
      emptyColumn: 'No contracts',
      noValue: 'Undisclosed',
    },
    bulk: {
      exportSelected: 'Export selected',
      changeStatus: 'Bulk change status',
      changeStatusPrompt: (count) =>
        `Enter a target status for ${count} contract${count === 1 ? '' : 's'} (e.g. active, suspended, terminated).`,
      statusUpdated: (count) =>
        `${count} contract${count === 1 ? '' : 's'} updated.`,
      statusFailed: 'Some contracts could not be updated.',
      exported: (count) => `Exported ${count} contract${count === 1 ? '' : 's'}.`,
    },
    savedViews: {
      save: 'Save current view',
      saved: 'Saved views',
      empty: 'No saved views yet',
    },
    moveError: 'That status transition is not allowed.',
  },
  ar: {
    pageTitle: 'العقود',
    pageDescription: 'محفظة العقود عبر مراحل دورة الحياة وتغطية الأطراف وتوقيت التجديد.',
    createContract: 'إنشاء عقد',
    searchPlaceholder: 'بحث في العقود...',
    emptyTitle: 'لا توجد عقود',
    emptyDescription: 'لا توجد عقود مطابقة للمرشّحات الحالية.',
    columns: {
      contract: 'العقد',
      parties: 'الأطراف',
      status: 'الحالة',
      value: 'القيمة',
      expiry: 'الانتهاء',
    },
    stats: {
      total: 'إجمالي العقود',
      active: 'نشطة',
      expiring: 'تنتهي خلال ٦٠ يومًا',
      highRisk: 'مخاطر مرتفعة',
    },
    statDetails: {
      portfolioScope: 'سجل العقود المصفّى ضمن المحفظة الحالية.',
      matchingFilters: 'مطابقة للمرشّحات',
      portfolioShare: 'حصة المحفظة',
      activeLifecycle: 'نشطة حاليًا وتدار عبر دورة حياة العقد.',
      activeShare: 'حصة العقود النشطة',
      renewalWatchlist: 'تجديدات تحتاج إلى مراجعة المالك خلال ٦٠ يومًا.',
      renewalWindow: 'نافذة التجديد',
      renewalShare: 'انكشاف التجديد',
      riskWatchlist: 'عقود عالية أو حرجة المخاطر تتطلب انتباهًا قانونيًا.',
      riskShare: 'انكشاف المخاطر',
    },
    noParties: '—',
    undisclosed: 'غير مُفصح عنها',
    noExpiry: 'بلا تاريخ انتهاء',
    filters: {
      status: 'الحالة',
      type: 'النوع',
      risk: 'المخاطر',
      expiryFrom: 'الانتهاء من',
      expiryTo: 'الانتهاء إلى',
    },
    view: {
      table: 'جدول',
      board: 'لوحة',
      label: 'وضع العرض',
    },
    board: {
      emptyColumn: 'لا توجد عقود',
      noValue: 'غير مُفصح عنها',
    },
    bulk: {
      exportSelected: 'تصدير المحدد',
      changeStatus: 'تغيير الحالة بالجملة',
      changeStatusPrompt: (count) =>
        `أدخل الحالة المستهدفة لـ ${count} عقد (مثل: active، suspended، terminated).`,
      statusUpdated: (count) => `تم تحديث ${count} عقد.`,
      statusFailed: 'تعذّر تحديث بعض العقود.',
      exported: (count) => `تم تصدير ${count} عقد.`,
    },
    savedViews: {
      save: 'حفظ العرض الحالي',
      saved: 'العروض المحفوظة',
      empty: 'لا توجد عروض محفوظة بعد',
    },
    moveError: 'انتقال الحالة هذا غير مسموح به.',
  },
};

export function useContractsListLabels(): ContractsListLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveLexBilingual(contractsListLabels, locale), [locale]);
}

/** Pure locale resolver for non-React consumers and contract tests. */
export function resolveContractsListLabels(locale: AppLocale = 'en'): ContractsListLabels {
  return resolveLexBilingual(contractsListLabels, locale === 'ar' ? 'ar' : 'en');
}

/* ------------------------------------------------------------------------- *
 * Contract type options (shared label record keyed by the raw backend token).
 * Used by the list filter and the create/edit dialog type selectors.
 * ------------------------------------------------------------------------- */

export const contractTypeLabels: LexBilingual<Record<string, string>> = {
  en: {
    service_agreement: 'Service Agreement',
    nda: 'NDA',
    employment: 'Employment',
    vendor: 'Vendor',
    license: 'License',
    lease: 'Lease',
    partnership: 'Partnership',
    consulting: 'Consulting',
    procurement: 'Procurement',
    sla: 'SLA',
    mou: 'MoU',
    amendment: 'Amendment',
    renewal: 'Renewal',
    other: 'Other',
  },
  ar: {
    service_agreement: 'اتفاقية خدمات',
    nda: 'اتفاقية عدم إفصاح',
    employment: 'توظيف',
    vendor: 'مورّد',
    license: 'ترخيص',
    lease: 'إيجار',
    partnership: 'شراكة',
    consulting: 'استشارات',
    procurement: 'مشتريات',
    sla: 'اتفاقية مستوى الخدمة',
    mou: 'مذكرة تفاهم',
    amendment: 'تعديل',
    renewal: 'تجديد',
    other: 'أخرى',
  },
};

export function useContractTypeLabels(): Record<string, string> {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveLexBilingual(contractTypeLabels, locale), [locale]);
}

/** Risk level labels keyed by the raw backend token (list filter + dialogs). */
export const contractRiskLabels: LexBilingual<Record<string, string>> = {
  en: {
    critical: 'Critical',
    high: 'High',
    medium: 'Medium',
    low: 'Low',
    none: 'None',
  },
  ar: {
    critical: 'حرج',
    high: 'مرتفع',
    medium: 'متوسط',
    low: 'منخفض',
    none: 'بلا',
  },
};

/**
 * Compliance-alert lifecycle status labels, keyed by the raw
 * `LexComplianceAlertStatus` backend token (open / acknowledged / investigating
 * / resolved / dismissed). Both locales carry the SAME key set; resolve a label
 * with `labels[token] ?? token.replace(/_/g, ' ')`.
 */
export const contractComplianceAlertStatusLabels: LexBilingual<Record<string, string>> = {
  en: {
    open: 'Open',
    acknowledged: 'Acknowledged',
    investigating: 'Investigating',
    resolved: 'Resolved',
    dismissed: 'Dismissed',
  },
  ar: {
    open: 'مفتوح',
    acknowledged: 'تم الإقرار',
    investigating: 'قيد التحقيق',
    resolved: 'تمت المعالجة',
    dismissed: 'تم التجاهل',
  },
};

export function useContractComplianceAlertStatusLabels(): Record<string, string> {
  const { locale } = useLocaleOrDefault();
  return useMemo(
    () => resolveLexBilingual(contractComplianceAlertStatusLabels, locale),
    [locale],
  );
}

/**
 * Regulation lifecycle status labels, keyed by the raw `LexLibraryStatus`
 * backend token (draft / active / in_review / pending_review / approved /
 * rejected / superseded / deprecated / archived). Feminine agreement follows
 * the glossary term لائحة. Resolve with `labels[token] ?? token.replace(/_/g, ' ')`.
 */
export const regulationStatusLabels: LexBilingual<Record<string, string>> = {
  en: {
    draft: 'Draft',
    active: 'Active',
    in_review: 'In review',
    pending_review: 'Pending review',
    approved: 'Approved',
    rejected: 'Rejected',
    superseded: 'Superseded',
    deprecated: 'Deprecated',
    archived: 'Archived',
  },
  ar: {
    draft: 'مسودة',
    active: 'سارية',
    in_review: 'قيد المراجعة',
    pending_review: 'بانتظار المراجعة',
    approved: 'معتمدة',
    rejected: 'مرفوضة',
    superseded: 'مُستبدَلة',
    deprecated: 'متوقفة',
    archived: 'مؤرشفة',
  },
};

export function useRegulationStatusLabels(): Record<string, string> {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveLexBilingual(regulationStatusLabels, locale), [locale]);
}

/**
 * Localized display names for the regulation `authority` field (a single-locale
 * string on the backend model). Well-known KSA regulators are given their
 * official Arabic names with the common acronym in parentheses; acronym-only
 * authorities keep the acronym per the termbase. Unknown values fall back to
 * the raw backend string via `resolveRegulationAuthority`.
 */
export const regulationAuthorityLabels: LexBilingual<Record<string, string>> = {
  en: {
    SDAIA: 'SDAIA',
    'National Cybersecurity Authority': 'National Cybersecurity Authority',
    'Bureau of Experts': 'Bureau of Experts (Council of Ministers)',
    'Communications, Space and Technology Commission':
      'Communications, Space and Technology Commission',
    ZATCA: 'ZATCA',
  },
  ar: {
    SDAIA: 'الهيئة السعودية للبيانات والذكاء الاصطناعي (سدايا)',
    'National Cybersecurity Authority': 'الهيئة الوطنية للأمن السيبراني',
    'Bureau of Experts': 'هيئة الخبراء بمجلس الوزراء',
    'Communications, Space and Technology Commission':
      'هيئة الاتصالات والفضاء والتقنية',
    ZATCA: 'هيئة الزكاة والضريبة والجمارك',
  },
};

export function useRegulationAuthorityLabel(): (authority: string) => string {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => {
    const map = resolveLexBilingual(regulationAuthorityLabels, locale);
    return (authority: string) => map[authority] ?? authority;
  }, [locale]);
}

/**
 * Contract audit/timeline event SOURCE labels, keyed by the raw `source` token
 * the backend projects onto each `LexContractTimelineEvent` (the provenance of
 * the event, rendered as the small "detail" line under the activity story in
 * the audit drawer and the detail console). Both locales carry the SAME key
 * set; resolve with `labels[token] ?? token.replace(/_/g, ' ')`.
 */
export const contractAuditSourceLabels: LexBilingual<Record<string, string>> = {
  en: {
    'contracts.created_at': 'Contract record',
    'contracts.status_changed_at': 'Status history',
    'contracts.last_analyzed_at': 'Analysis record',
    'contracts.workflow_instance_id': 'Workflow link',
    'contract_versions.uploaded_at': 'Version history',
    'contract.metadata.timeline': 'Contract timeline',
  },
  ar: {
    'contracts.created_at': 'سجل العقد',
    'contracts.status_changed_at': 'سجل الحالة',
    'contracts.last_analyzed_at': 'سجل التحليل',
    'contracts.workflow_instance_id': 'ربط سير العمل',
    'contract_versions.uploaded_at': 'سجل النسخ',
    'contract.metadata.timeline': 'الجدول الزمني للعقد',
  },
};

export function useContractAuditSourceLabels(): Record<string, string> {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveLexBilingual(contractAuditSourceLabels, locale), [locale]);
}

/* ------------------------------------------------------------------------- *
 * Create / edit contract dialog (`_components/contract-form-dialog.tsx`).
 * ------------------------------------------------------------------------- */

export interface ContractFormLabels {
  editTitle: string;
  createTitle: string;
  editDescription: string;
  createDescription: string;
  fields: {
    title: string;
    titlePlaceholder: string;
    contractNumber: string;
    contractNumberPlaceholder: string;
    sourceRequest: string;
    sourceRequestPlaceholder: string;
    sourceRequestManual: string;
    sourceRequestEmpty: string;
    sourceRequestHelp: string;
    sourceRequired: string;
    type: string;
    currency: string;
    currencyPlaceholder: string;
    description: string;
    descriptionPlaceholder: string;
    partyA: string;
    partyAPlaceholder: string;
    counterparty: string;
    counterpartyPlaceholder: string;
    partyAEntity: string;
    counterpartyEntity: string;
    entityPlaceholder: string;
    counterpartyContact: string;
    counterpartyContactPlaceholder: string;
    owner: string;
    ownerPlaceholder: string;
    legalReviewer: string;
    reviewerPlaceholder: string;
    unassigned: string;
    totalValue: string;
    totalValuePlaceholder: string;
    effectiveDate: string;
    expiryDate: string;
    renewalDate: string;
    renewalDateHelp: string;
    renewalNoticeDays: string;
    department: string;
    departmentPlaceholder: string;
    requestingDepartment: string;
    requestingDepartmentPlaceholder: string;
    requestingDepartmentRequired: string;
    contractDuration: string;
    durationHelp: string;
    durationNotAvailable: string;
    durationValue: (months: number, days: number) => string;
    paymentTerms: string;
    paymentTermsPlaceholder: string;
    tags: string;
    tagsPlaceholder: string;
  };
  autoRenew: {
    title: string;
    description: string;
  };
  initialDocument: {
    title: string;
    description: string;
    fileLabel: string;
    selectedPrefix: (name: string) => string;
    textLabel: string;
    textPlaceholder: string;
    changeSummaryLabel: string;
    changeSummaryPlaceholder: string;
    uploadProgress: (percent: number) => string;
  };
  usersError: string;
  cancel: string;
  create: string;
  save: string;
  toast: {
    updatedTitle: string;
    createdTitle: string;
    updatedDescription: string;
    createdDescription: string;
    /**
     * The contract itself was created and its first document version stored,
     * but registering that same file in the review desk's `draft` slot failed
     * (it is a secondary copy, and the route sits on a coarser permission than
     * contract creation). The creation must NOT be reported as a failure.
     */
    attachmentSkippedTitle: string;
    attachmentSkippedDescription: string;
  };
}

export const contractFormLabels: LexBilingual<ContractFormLabels> = {
  en: {
    editTitle: 'Edit Contract',
    createTitle: 'Create Contract',
    editDescription: 'Update contract metadata, ownership, dates, and lifecycle context.',
    createDescription:
      'Register a new contract and optionally attach the first document version.',
    fields: {
      title: 'Title',
      titlePlaceholder: 'Master Services Agreement',
      contractNumber: 'Contract number',
      contractNumberPlaceholder: 'LEX-2026-001',
      sourceRequest: 'Approved request source',
      sourceRequestPlaceholder: 'Select an approved request',
      sourceRequestManual: 'Enter a contract number manually',
      sourceRequestEmpty: 'No unlinked approved requests are available',
      sourceRequestHelp:
        'Choose an approved service-desk request, or leave this on manual and enter a contract number.',
      sourceRequired: 'Enter a contract number or select an approved request.',
      type: 'Contract type',
      currency: 'Currency',
      currencyPlaceholder: 'SAR',
      description: 'Description',
      descriptionPlaceholder:
        'Commercial scope, renewal expectations, service obligations, and key legal posture.',
      partyA: 'Party A',
      partyAPlaceholder: 'Clario360 Ltd.',
      counterparty: 'Counterparty',
      counterpartyPlaceholder: 'Acme Holdings',
      partyAEntity: 'Party A entity',
      counterpartyEntity: 'Counterparty entity',
      entityPlaceholder: 'Legal entity name',
      counterpartyContact: 'Counterparty contact',
      counterpartyContactPlaceholder: 'legal@acme.example',
      owner: 'Contract owner',
      ownerPlaceholder: 'Select owner',
      legalReviewer: 'Legal reviewer',
      reviewerPlaceholder: 'Select reviewer',
      unassigned: 'Unassigned',
      totalValue: 'Total value',
      totalValuePlaceholder: '125000',
      effectiveDate: 'Effective date',
      expiryDate: 'Expiry date',
      renewalDate: 'Renewal date',
      renewalDateHelp:
        'Calculated from the expiry date minus the renewal notice. Enter a date to override, or clear it to recalculate.',
      renewalNoticeDays: 'Renewal notice (days)',
      department: 'Department',
      departmentPlaceholder: 'Procurement',
      requestingDepartment: 'Requesting department',
      requestingDepartmentPlaceholder: 'Procurement',
      requestingDepartmentRequired: 'Requesting department is required.',
      contractDuration: 'Contract duration',
      durationHelp: 'Derived from the effective and expiry dates.',
      durationNotAvailable: 'Set effective and expiry dates to compute',
      durationValue: (months, days) =>
        `${months} month${months === 1 ? '' : 's'}${days > 0 ? ` ${days} day${days === 1 ? '' : 's'}` : ''}`,
      paymentTerms: 'Payment terms',
      paymentTermsPlaceholder: 'Net 30',
      tags: 'Tags',
      tagsPlaceholder: 'msa, vendor, renewal',
    },
    autoRenew: {
      title: 'Auto-renew',
      description: 'Mark whether the contract renews automatically unless terminated.',
    },
    initialDocument: {
      title: 'Initial document version',
      description:
        'Optional. Uploading the first version now enables immediate analysis and clause extraction.',
      fileLabel: 'Contract file',
      selectedPrefix: (name) => `Selected: ${name}`,
      textLabel: 'Document text',
      textPlaceholder:
        'Paste contract text to enable deterministic analysis immediately after upload.',
      changeSummaryLabel: 'Change summary',
      changeSummaryPlaceholder: 'Initial signed draft',
      uploadProgress: (percent) => `Upload progress: ${percent}%`,
    },
    usersError:
      'Unable to load the user directory. Contract save is disabled until owners can be resolved.',
    cancel: 'Cancel',
    create: 'Create contract',
    save: 'Save changes',
    toast: {
      updatedTitle: 'Contract updated.',
      createdTitle: 'Contract created.',
      updatedDescription: 'The contract metadata has been saved.',
      createdDescription: 'The contract record is now available in Clario Lex.',
      attachmentSkippedTitle: 'Contract created — document not added to the review desk.',
      attachmentSkippedDescription:
        'The contract and its first document version were saved. Adding the same file to the review desk failed; you can upload it there from the contract.',
    },
  },
  ar: {
    editTitle: 'تعديل العقد',
    createTitle: 'إنشاء عقد',
    editDescription: 'تحديث بيانات العقد والملكية والتواريخ وسياق دورة الحياة.',
    createDescription: 'تسجيل عقد جديد وإرفاق أول نسخة من الوثيقة اختياريًا.',
    fields: {
      title: 'العنوان',
      titlePlaceholder: 'اتفاقية الخدمات الرئيسية',
      contractNumber: 'رقم العقد',
      contractNumberPlaceholder: 'LEX-2026-001',
      sourceRequest: 'مصدر الطلب المعتمد',
      sourceRequestPlaceholder: 'اختر طلبًا معتمدًا',
      sourceRequestManual: 'إدخال رقم العقد يدويًا',
      sourceRequestEmpty: 'لا توجد طلبات معتمدة غير مرتبطة',
      sourceRequestHelp: 'اختر طلبًا معتمدًا من مكتب الخدمة أو أدخل رقم العقد يدويًا.',
      sourceRequired: 'أدخل رقم العقد أو اختر طلبًا معتمدًا.',
      type: 'نوع العقد',
      currency: 'العملة',
      currencyPlaceholder: 'SAR',
      description: 'الوصف',
      descriptionPlaceholder:
        'النطاق التجاري وتوقعات التجديد والتزامات الخدمة والوضع القانوني الأساسي.',
      partyA: 'الطرف الأول',
      partyAPlaceholder: 'كلاريو360 المحدودة',
      counterparty: 'الطرف المقابل',
      counterpartyPlaceholder: 'أكمي القابضة',
      partyAEntity: 'كيان الطرف الأول',
      counterpartyEntity: 'كيان الطرف المقابل',
      entityPlaceholder: 'اسم الكيان القانوني',
      counterpartyContact: 'جهة اتصال الطرف المقابل',
      counterpartyContactPlaceholder: 'legal@acme.example',
      owner: 'مالك العقد',
      ownerPlaceholder: 'اختر المالك',
      legalReviewer: 'المراجع القانوني',
      reviewerPlaceholder: 'اختر المراجع',
      unassigned: 'غير مُسند',
      totalValue: 'القيمة الإجمالية',
      totalValuePlaceholder: '125000',
      effectiveDate: 'تاريخ السريان',
      expiryDate: 'تاريخ الانتهاء',
      renewalDate: 'تاريخ التجديد',
      renewalDateHelp:
        'يُحتسب من تاريخ الانتهاء ناقصًا مهلة إشعار التجديد. أدخل تاريخًا لتجاوزه، أو امسحه لإعادة الاحتساب.',
      renewalNoticeDays: 'إشعار التجديد (أيام)',
      department: 'الإدارة',
      departmentPlaceholder: 'المشتريات',
      requestingDepartment: 'الإدارة الطالبة',
      requestingDepartmentPlaceholder: 'المشتريات',
      requestingDepartmentRequired: 'الإدارة الطالبة مطلوبة.',
      contractDuration: 'مدة العقد',
      durationHelp: 'تُحتسب من تاريخي السريان والانتهاء.',
      durationNotAvailable: 'حدّد تاريخي السريان والانتهاء للاحتساب',
      durationValue: (months, days) =>
        `${months} شهر${days > 0 ? ` و${days} يوم` : ''}`,
      paymentTerms: 'شروط الدفع',
      paymentTermsPlaceholder: 'صافي 30 يومًا',
      tags: 'الوسوم',
      tagsPlaceholder: 'اتفاقية، مورّد، تجديد',
    },
    autoRenew: {
      title: 'التجديد التلقائي',
      description: 'حدّد ما إذا كان العقد يُجدَّد تلقائيًا ما لم يُنهَ.',
    },
    initialDocument: {
      title: 'نسخة الوثيقة الأولية',
      description: 'اختياري. رفع النسخة الأولى الآن يتيح التحليل الفوري واستخراج البنود.',
      fileLabel: 'ملف العقد',
      selectedPrefix: (name) => `المحدد: ${name}`,
      textLabel: 'نص الوثيقة',
      textPlaceholder: 'الصق نص العقد لتفعيل التحليل الحتمي فور الرفع.',
      changeSummaryLabel: 'ملخص التغيير',
      changeSummaryPlaceholder: 'المسودة الموقّعة الأولية',
      uploadProgress: (percent) => `تقدّم الرفع: ${percent}%`,
    },
    usersError: 'تعذّر تحميل دليل المستخدمين. حفظ العقد مُعطَّل حتى يمكن تحديد الملّاك.',
    cancel: 'إلغاء',
    create: 'إنشاء العقد',
    save: 'حفظ التغييرات',
    toast: {
      updatedTitle: 'تم تحديث العقد.',
      createdTitle: 'تم إنشاء العقد.',
      updatedDescription: 'تم حفظ بيانات العقد.',
      createdDescription: 'سجل العقد متاح الآن في كلاريو ليكس.',
      attachmentSkippedTitle: 'تم إنشاء العقد — لم تُضف الوثيقة إلى مكتب المراجعة.',
      attachmentSkippedDescription:
        'تم حفظ العقد وأول نسخة من وثيقته. لم تنجح إضافة الملف نفسه إلى مكتب المراجعة؛ يمكنك رفعه هناك من صفحة العقد.',
    },
  },
};

export function useContractFormLabels(): ContractFormLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveLexBilingual(contractFormLabels, locale), [locale]);
}

/**
 * Clause review status labels keyed by the raw backend token. Used by the clause
 * review dialog's status selector. Resolve with `labels[token] ?? titleCase(token)`.
 */
export const clauseReviewStatusLabels: LexBilingual<Record<string, string>> = {
  en: {
    pending: 'Pending',
    reviewed: 'Reviewed',
    flagged: 'Flagged',
    accepted: 'Accepted',
    rejected: 'Rejected',
  },
  ar: {
    pending: 'قيد المراجعة',
    reviewed: 'تمت المراجعة',
    flagged: 'مُعلَّم',
    accepted: 'مقبول',
    rejected: 'مرفوض',
  },
};

export function useClauseReviewStatusLabels(): Record<string, string> {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveLexBilingual(clauseReviewStatusLabels, locale), [locale]);
}

/* ------------------------------------------------------------------------- *
 * Contract detail console (`[id]/page.tsx`) — the heaviest surface, including
 * the page header, lifecycle stepper, metric/metadata grids, all tabs, and the
 * five dialogs (status / review / renew / version-upload / clause-review).
 * ------------------------------------------------------------------------- */

export interface ContractDetailLabels {
  loadingTitle: string;
  loadingDescription: string;
  errorTitle: string;
  errorDescription: string;
  fallbackDescription: string;
  actions: {
    edit: string;
    analyze: string;
    runCompliance: string;
    exportSummary: string;
  };
  analyzeMessage: (findings: number, flags: number) => string;
  classificationBanner: (verb: string, type: string, confidence: number) => string;
  appliedLabel: string;
  recommendedLabel: string;
  metrics: {
    status: string;
    risk: string;
    riskScore: (score: string) => string;
    noScoreYet: string;
    version: string;
    recordedVersions: (count: number) => string;
    workflow: string;
    activeReview: string;
    noWorkflow: string;
    instancePrefix: (id: string) => string;
    reviewNotStarted: string;
  };
  stepper: {
    title: string;
    description: string;
    current: string;
    completed: string;
    pending: string;
    ariaLabel: string;
  };
  brief: {
    title: string;
    description: string;
    loadError: string;
    counterparty: string;
    owner: string;
    value: string;
    risk: string;
    notSet: string;
    unassigned: string;
    undisclosed: string;
    noScore: string;
    scorePrefix: (score: string) => string;
    executiveSummary: string;
    riskSummary: string;
    topRisks: string;
    keyObligations: string;
    noSignals: string;
    emptyTitle: string;
    emptyDescription: string;
  };
  tabs: {
    overview: string;
    details: string;
    analysis: string;
    versions: string;
    workflow: string;
  };
  detailsTab: {
    description: string;
  };
  keyDates: {
    title: string;
    description: string;
  };
  riskPanel: {
    title: string;
    description: string;
    summaryFallback: string;
    ariaLabel: string;
    riskScore: string;
    riskSuffix: (severity: string) => string;
    clausesReviewed: string;
    missingClauses: string;
    complianceFlags: string;
  };
  findings: {
    title: string;
    description: string;
    empty: string;
    recommendationPrefix: string;
    addClause: string;
    draftWithAi: string;
    view: string;
  };
  lifecycleGroups: {
    statusWorkflow: string;
    documents: string;
    dangerZone: string;
    dangerZoneHelp: string;
  };
  moreMenu: {
    trigger: string;
    label: string;
  };
  lastCompliance: {
    pending: string;
    lastRun: (score: string, when: string) => string;
    alerts: (count: number) => string;
  };
  metadata: {
    title: string;
    description: string;
    contractNumber: string;
    autoGenerated: string;
    type: string;
    owner: string;
    legalReviewer: string;
    unassigned: string;
    department: string;
    notSet: string;
    effectiveDate: string;
    expiryDate: string;
    duration: string;
    durationValue: (months: number, days: number) => string;
    durationNotSet: string;
    renewalDate: string;
    /** Renewal date worked out from the expiry date and the notice period. */
    renewalCalculated: (date: string) => string;
    renewalWarning: string;
    autoRenew: string;
    autoRenewOn: (noticeDays: number) => string;
    autoRenewOff: string;
    paymentTerms: string;
    tags: string;
    noTags: string;
  };
  lifecycleActions: {
    title: string;
    description: string;
    changeStatus: string;
    startReview: string;
    renew: string;
    uploadVersion: string;
    previewDocument: string;
    signatureQueue: string;
    deleteContract: string;
    archiveContract: string;
  };
  classification: {
    title: string;
    description: string;
    recommend: string;
    apply: string;
    recommended: string;
    confidence: (percent: number) => string;
    applied: string;
    appliedBadge: string;
    previewBadge: string;
    previousPrefix: (type: string) => string;
    classifiedAt: string;
    noMatchedTerms: string;
    emptyDescription: string;
    currentTypePrefix: (type: string) => string;
  };
  signature: {
    title: string;
    description: string;
    viewQueue: string;
    loadError: string;
    latestEnvelope: string;
    recipients: string;
    providerNotSet: string;
    deadline: string;
    sentPrefix: (date: string) => string;
    notSent: string;
    noUpdateTimestamp: string;
    send: string;
    cancel: string;
    emptyTitle: string;
    emptyDescription: string;
    progress: (signed: number, total: number) => string;
  };
  matterLink: {
    title: string;
    description: string;
    matter: string;
    matterId: string;
    status: string;
    owner: string;
    priority: string;
    notSet: string;
    emptyTitle: string;
    emptyDescription: string;
  };
  obligations: {
    title: string;
    description: string;
    emptyTitle: string;
    emptyDescription: string;
    unassigned: string;
    noDueDate: string;
    reminderConfigured: (days: number) => string;
    reminderNotConfigured: string;
  };
  parties: {
    title: string;
    description: string;
    partyA: string;
    partyAEntity: string;
    counterparty: string;
    counterpartyEntity: string;
    counterpartyContact: string;
    notSet: string;
    totalValue: string;
    undisclosed: string;
  };
  documentContext: {
    title: string;
    description: string;
    latestVersion: string;
    noUploadedVersions: string;
    latestUpload: string;
    noFileAvailable: string;
    download: string;
    workflowInstance: string;
    notLinked: string;
    lastAnalyzed: string;
    notAnalyzed: string;
    analysisStatus: string;
  };
  complianceRun: {
    title: string;
    description: string;
    score: string;
    alertsCreated: string;
    calculatedAt: string;
    alertsToast: (count: number) => string;
  };
  analysis: {
    riskSummaryTitle: string;
    riskSummaryDescription: string;
    overallRisk: string;
    riskScore: string;
    clauseCount: string;
    highRiskClauses: string;
    analyzedAt: string;
    analysisDurationLabel: string;
    analysisDuration: (ms: number) => string;
    extractedTitle: string;
    extractedDescription: string;
    parties: string;
    noPartiesExtracted: string;
    dates: string;
    noValue: string;
    noDatesExtracted: string;
    keyFindingsTitle: string;
    keyFindingsDescription: string;
    recommendationPrefix: string;
    noKeyFindings: string;
    missingFlagsTitle: string;
    missingFlagsDescription: string;
    missingClauses: string;
    noMissingClauses: string;
    complianceFlags: string;
    noComplianceFlags: string;
    libraryTitle: string;
    libraryDescription: string;
    libraryClauses: string;
    libraryBilingual: string;
    libraryPending: string;
    libraryDeprecated: string;
    cardTitle: string;
    cardEmptyDescription: string;
    emptyTitle: string;
    emptyDescription: string;
    emptyAnalyze: string;
    emptyAnalyzing: string;
  };
  clauses: {
    title: string;
    description: string;
    riskScorePrefix: (score: string) => string;
    confidencePrefix: (percent: number) => string;
    noSectionReference: string;
    noSummary: string;
    reviewClause: string;
    empty: string;
  };
  versions: {
    redlineTitle: string;
    redlineDescription: string;
    basePrefix: (version: number, name: string) => string;
    targetPrefix: (version: number, name: string) => string;
    addedLines: (count: number) => string;
    removedLines: (count: number) => string;
    redlineEmptyTitle: string;
    redlineEmptyDescription: string;
    historyTitle: string;
    historyDescription: string;
    uploadVersion: string;
    loadError: string;
    versionPrefix: (version: number) => string;
    noChangeSummary: string;
    hashPrefix: (hash: string) => string;
    download: string;
    empty: string;
  };
  workflow: {
    linkageTitle: string;
    linkageDescription: string;
    linkageEmptyDescription: string;
    workflowInstance: string;
    contractStatus: string;
    currentVersion: string;
    started: string;
    notAvailable: string;
    emptyTitle: string;
    emptyDescription: string;
    startReview: string;
    timelineTitle: string;
    timelineDescription: string;
    timelineLoadError: string;
    timelineEmptyTitle: string;
    timelineEmptyDescription: string;
    generatedPrefix: (date: string) => string;
    actorPrefix: (actor: string) => string;
  };
  statusDialog: {
    title: string;
    description: (current: string) => string;
    nextStatus: string;
    selectStatus: string;
    noTransitions: string;
    cancel: string;
    submit: string;
  };
  reviewDialog: {
    title: string;
    description: string;
    specificApprover: string;
    loadingUsers: string;
    selectApprover: string;
    assignByRole: string;
    approverRole: string;
    approverRolePlaceholder: string;
    slaHours: string;
    taskDescription: string;
    taskDescriptionPlaceholder: string;
    doaPolicy: string;
    doaPolicyHelp: string;
    policyNone: string;
    policyNoneHelp: string;
    policyCatalog: string;
    policyCatalogHelp: string;
    policyManual: string;
    policyManualHelp: string;
    activePolicies: string;
    recommendPolicy: string;
    recommendedPolicy: string;
    noPolicyMatch: string;
    matched: string;
    review: string;
    applyRecommendation: string;
    recommendationUnavailable: string;
    policiesLoadError: string;
    noActivePolicies: string;
    noActivePoliciesHelp: string;
    policyId: string;
    policyIdPlaceholder: string;
    policyName: string;
    policyNamePlaceholder: string;
    requiredRole: string;
    requiredRolePlaceholder: string;
    authorityAmount: string;
    authorityAmountPlaceholder: string;
    currency: string;
    requireEvidence: string;
    requiredDecisionFields: string;
    businessJustification: string;
    businessJustificationHelp: string;
    riskAcceptance: string;
    riskAcceptanceHelp: string;
    outOfOffice: string;
    outOfOfficeHelp: string;
    delegate: string;
    selectDelegate: string;
    evidenceId: string;
    evidenceIdPlaceholder: string;
    starts: string;
    ends: string;
    delegationReason: string;
    delegationReasonPlaceholder: string;
    cancel: string;
    submit: string;
    formBusinessJustification: string;
    formRiskAcceptance: string;
  };
  reviewToast: {
    title: string;
    description: string;
  };
  approvalPolicy: {
    active: string;
    priorityPrefix: (priority: number) => string;
    scopePrefix: string;
    routePrefix: string;
    authorityPrefix: string;
    noApprovers: string;
    anyType: string;
    anyDepartment: string;
    rangePrefix: (currency: string, min: string, max: string) => string;
    fromPrefix: (currency: string, min: string) => string;
    upToPrefix: (currency: string, max: string) => string;
    anyValue: string;
    quorumNofM: (n: number, total: number) => string;
    anyApprovalAuthority: string;
    evidenceRequired: string;
    evidenceOptional: string;
    undisclosedLower: string;
  };
  renewDialog: {
    title: string;
    description: string;
    newEffectiveDate: string;
    newExpiryDate: string;
    newValue: string;
    changeSummary: string;
    changeSummaryPlaceholder: string;
    cancel: string;
    submit: string;
  };
  uploadDialog: {
    title: string;
    description: string;
    fileLabel: string;
    selectedPrefix: (name: string) => string;
    changeSummary: string;
    changeSummaryPlaceholder: string;
    extractedText: string;
    extractedTextPlaceholder: string;
    uploadProgress: (percent: number) => string;
    selectFileError: string;
    cancel: string;
    submit: string;
  };
  clauseDialog: {
    title: string;
    description: (clauseTitle: string) => string;
    fallbackClause: string;
    reviewStatus: string;
    reviewNotes: string;
    reviewNotesPlaceholder: string;
    cancel: string;
    submit: string;
  };
  exportFields: {
    field: string;
    value: string;
    title: string;
    status: string;
    type: string;
    owner: string;
    legalReviewer: string;
    counterparty: string;
    riskLevel: string;
    riskScore: string;
    renewalWarning: string;
    matter: string;
    obligations: string;
    clauses: string;
  };
  toast: {
    analyzedTitle: string;
    analyzedDescription: string;
    complianceTitle: string;
    classifyAppliedTitle: string;
    classifyRecommendedTitle: string;
    classifyAppliedDescription: (type: string) => string;
    classifyRecommendedDescription: (type: string) => string;
    statusUpdatedTitle: string;
    statusUpdatedDescription: string;
    renewedTitle: string;
    renewedDescription: string;
    reviewStartedTitle: string;
    reviewStartedDescription: string;
    deletedTitle: string;
    deletedDescription: string;
    clauseSavedTitle: string;
    clauseSavedDescription: string;
    signatureSentTitle: string;
    signatureSentDescription: string;
    signatureCancelledTitle: string;
    signatureCancelledDescription: string;
    versionUploadedTitle: string;
    versionUploadedDescription: string;
  };
  deleteConfirm: {
    title: string;
    description: (title: string) => string;
    confirm: string;
  };
}

export const contractDetailLabels: LexBilingual<ContractDetailLabels> = {
  en: {
    loadingTitle: 'Contract',
    loadingDescription: 'Loading contract lifecycle, analysis, and workflow context.',
    errorTitle: 'Contract',
    errorDescription: 'Failed to load contract details.',
    fallbackDescription: 'Legal contract lifecycle detail.',
    actions: {
      edit: 'Edit',
      analyze: 'Analyze',
      runCompliance: 'Run Compliance',
      exportSummary: 'Export Summary',
    },
    analyzeMessage: (findings, flags) =>
      `Analysis completed with ${findings} findings and ${flags} compliance flags.`,
    classificationBanner: (verb, type, confidence) =>
      `${verb} ${type} with ${confidence}% confidence.`,
    appliedLabel: 'Applied',
    recommendedLabel: 'Recommended',
    metrics: {
      status: 'Status',
      risk: 'Risk',
      riskScore: (score) => `Score ${score}`,
      noScoreYet: 'No score yet',
      version: 'Version',
      recordedVersions: (count) => `${count} recorded version${count === 1 ? '' : 's'}`,
      workflow: 'Workflow',
      activeReview: 'Active review',
      noWorkflow: 'No workflow',
      instancePrefix: (id) => `Instance ${id}`,
      reviewNotStarted: 'Review not started',
    },
    stepper: {
      title: 'Lifecycle Stepper',
      description: 'Watheeq contract movement from draft through activation.',
      current: 'Current stage',
      completed: 'Completed',
      pending: 'Pending',
      ariaLabel: 'Contract lifecycle',
    },
    brief: {
      title: 'Contract Brief',
      description: 'Application-generated one-page legal and commercial summary.',
      loadError: 'Failed to load the contract brief.',
      counterparty: 'Counterparty',
      owner: 'Owner',
      value: 'Value',
      risk: 'Risk',
      notSet: 'Not set',
      unassigned: 'Unassigned',
      undisclosed: 'Undisclosed',
      noScore: 'No score',
      scorePrefix: (score) => `Score ${score}`,
      executiveSummary: 'Executive summary',
      riskSummary: 'Risk summary',
      topRisks: 'Top risks',
      keyObligations: 'Key obligations',
      noSignals: 'No signals yet.',
      emptyTitle: 'No brief available',
      emptyDescription: 'The backend did not return a contract brief for this record.',
    },
    tabs: {
      overview: 'Overview',
      details: 'Details',
      analysis: 'Analysis & Clauses',
      versions: 'Versions',
      workflow: 'Workflow',
    },
    detailsTab: {
      description: 'Reference contract metadata, parties, classification, and document context.',
    },
    keyDates: {
      title: 'Key Dates',
      description: 'Effective, renewal, and expiry timeline with live countdowns.',
    },
    riskPanel: {
      title: 'Risk Assessment',
      description: 'Single authoritative risk posture: severity, score, and drivers.',
      summaryFallback: 'No risk summary is available yet. Run analysis to surface drivers.',
      ariaLabel: 'Contract risk',
      riskScore: 'Risk score',
      riskSuffix: (severity) => `${severity} risk`,
      clausesReviewed: 'clauses reviewed',
      missingClauses: 'missing clauses',
      complianceFlags: 'compliance flags',
    },
    findings: {
      title: 'Risk Findings & Gaps',
      description: 'Actionable risks and missing clauses with remediation shortcuts.',
      empty: 'No risk findings yet — run analysis to surface clause-level risks.',
      recommendationPrefix: 'Recommendation: ',
      addClause: 'Add clause',
      draftWithAi: 'Draft with AI',
      view: 'View',
    },
    lifecycleGroups: {
      statusWorkflow: 'Status & Workflow',
      documents: 'Documents',
      dangerZone: 'Danger zone',
      dangerZoneHelp: 'Irreversible actions. Proceed with caution.',
    },
    moreMenu: {
      trigger: 'More',
      label: 'More actions',
    },
    lastCompliance: {
      pending: 'No compliance run in this session.',
      lastRun: (score, when) => `Last run scored ${score}% on ${when}.`,
      alerts: (count) => `${count} alert${count === 1 ? '' : 's'} created.`,
    },
    metadata: {
      title: 'Contract Metadata',
      description: 'Core contract state, dates, and legal ownership.',
      contractNumber: 'Contract number',
      autoGenerated: 'Auto-generated',
      type: 'Type',
      owner: 'Owner',
      legalReviewer: 'Legal reviewer',
      unassigned: 'Unassigned',
      department: 'Department',
      notSet: 'Not set',
      effectiveDate: 'Effective date',
      expiryDate: 'Expiry date',
      duration: 'Duration',
      durationValue: (months, days) =>
        `${months} month${months === 1 ? '' : 's'}${days > 0 ? ` ${days} day${days === 1 ? '' : 's'}` : ''}`,
      durationNotSet: 'Not set',
      renewalDate: 'Renewal date',
      renewalCalculated: (date) => `${date} (calculated)`,
      renewalWarning: 'Renewal warning',
      autoRenew: 'Auto-renew',
      autoRenewOn: (noticeDays) =>
        noticeDays > 0
          ? `On — ${noticeDays} day${noticeDays === 1 ? '' : 's'} notice to cancel`
          : 'On — renews unless terminated',
      autoRenewOff: 'Off — renewal is manual',
      paymentTerms: 'Payment terms',
      tags: 'Tags',
      noTags: 'No tags',
    },
    lifecycleActions: {
      title: 'Lifecycle Actions',
      description: 'Move this contract through its lifecycle: status, review, renewal, and documents.',
      changeStatus: 'Change Status',
      startReview: 'Start Review Workflow',
      renew: 'Renew Contract',
      uploadVersion: 'Upload New Version',
      previewDocument: 'Preview Document',
      signatureQueue: 'Signature Queue',
      deleteContract: 'Delete Contract',
      archiveContract: 'Archive Contract',
    },
    classification: {
      title: 'Classification',
      description: 'Contract type recommendation and optional write-through classification.',
      recommend: 'Recommend',
      apply: 'Apply',
      recommended: 'Recommended',
      confidence: (percent) => `${percent}% confidence`,
      applied: 'Applied',
      appliedBadge: 'Applied',
      previewBadge: 'Preview',
      previousPrefix: (type) => `Previous ${type}`,
      classifiedAt: 'Classified At',
      noMatchedTerms: 'No matched terms',
      emptyDescription:
        'No classification recommendation has been generated for this contract in this session.',
      currentTypePrefix: (type) => `Current type: ${type}`,
    },
    signature: {
      title: 'Signature Handoff',
      description:
        'Signature envelopes linked to this contract and their recipient completion state.',
      viewQueue: 'View queue',
      loadError: 'Failed to load signature envelopes.',
      latestEnvelope: 'Latest envelope',
      recipients: 'Recipients',
      providerNotSet: 'Provider not set',
      deadline: 'Deadline',
      sentPrefix: (date) => `Sent ${date}`,
      notSent: 'Not sent',
      noUpdateTimestamp: 'No update timestamp',
      send: 'Send',
      cancel: 'Cancel',
      emptyTitle: 'No signature handoff',
      emptyDescription: 'No signature envelope is linked to this contract yet.',
      progress: (signed, total) => `${signed}/${total} signed`,
    },
    matterLink: {
      title: 'Matter Link',
      description:
        'Matter context projected from contract metadata until a dedicated matters endpoint is available.',
      matter: 'Matter',
      matterId: 'Matter ID',
      status: 'Status',
      owner: 'Owner',
      priority: 'Priority',
      notSet: 'Not set',
      emptyTitle: 'No linked matter',
      emptyDescription: 'No matter metadata is attached to this contract.',
    },
    obligations: {
      title: 'Obligations & Reminders',
      description:
        'Trackable obligations from contract metadata with due-date and reminder windows.',
      emptyTitle: 'No obligations attached',
      emptyDescription: 'No obligation metadata is attached to this contract.',
      unassigned: 'Unassigned',
      noDueDate: 'No due date',
      reminderConfigured: (days) => `Reminder ${days} days before due date`,
      reminderNotConfigured: 'Reminder not configured',
    },
    parties: {
      title: 'Parties & Value',
      description: 'Commercial parties and financial context.',
      partyA: 'Party A',
      partyAEntity: 'Party A entity',
      counterparty: 'Counterparty',
      counterpartyEntity: 'Counterparty entity',
      counterpartyContact: 'Counterparty contact',
      notSet: 'Not set',
      totalValue: 'Total value',
      undisclosed: 'Undisclosed',
    },
    documentContext: {
      title: 'Document Context',
      description: 'Latest version and workflow linkage for downstream review.',
      latestVersion: 'Latest version',
      noUploadedVersions: 'No uploaded versions',
      latestUpload: 'Latest upload',
      noFileAvailable: 'No file available',
      download: 'Download',
      workflowInstance: 'Workflow instance',
      notLinked: 'Not linked',
      lastAnalyzed: 'Last analyzed',
      notAnalyzed: 'Not analyzed',
      analysisStatus: 'Analysis status',
    },
    complianceRun: {
      title: 'Latest Compliance Run',
      description: 'Most recent contract-scoped compliance execution from the live backend.',
      score: 'Score',
      alertsCreated: 'Alerts Created',
      calculatedAt: 'Calculated At',
      alertsToast: (count) => `${count} alert${count === 1 ? '' : 's'} created for this contract.`,
    },
    analysis: {
      riskSummaryTitle: 'Risk Summary',
      riskSummaryDescription: 'Latest explainable risk analysis for this contract.',
      overallRisk: 'Overall risk',
      riskScore: 'Risk score',
      clauseCount: 'Clause count',
      highRiskClauses: 'High-risk clauses',
      analyzedAt: 'Analyzed at',
      analysisDurationLabel: 'Analysis duration',
      analysisDuration: (ms) => `${ms} ms`,
      extractedTitle: 'Extracted Parties & Dates',
      extractedDescription: 'Deterministic fields extracted during analysis.',
      parties: 'Parties',
      noPartiesExtracted: 'No parties extracted.',
      dates: 'Dates',
      noValue: 'No value',
      noDatesExtracted: 'No dates extracted.',
      keyFindingsTitle: 'Key Findings',
      keyFindingsDescription: 'Top contract findings with recommendations.',
      recommendationPrefix: 'Recommendation:',
      noKeyFindings: 'No key findings were returned.',
      missingFlagsTitle: 'Missing Clauses & Flags',
      missingFlagsDescription: 'Gaps and compliance flags detected in the latest run.',
      missingClauses: 'Missing clauses',
      noMissingClauses: 'No missing clauses detected.',
      complianceFlags: 'Compliance flags',
      noComplianceFlags: 'No compliance flags were raised.',
      libraryTitle: 'Clause Library Readiness',
      libraryDescription:
        'Reusable clause inventory, bilingual coverage, and review status for this contract.',
      libraryClauses: 'Clauses',
      libraryBilingual: 'Bilingual',
      libraryPending: 'Pending',
      libraryDeprecated: 'Deprecated',
      cardTitle: 'Analysis',
      cardEmptyDescription: 'The current contract does not have a stored analysis result yet.',
      emptyTitle: 'No analysis available',
      emptyDescription:
        'Run a contract analysis to populate clause extraction, risk scoring, and compliance signals.',
      emptyAnalyze: 'Analyze Contract',
      emptyAnalyzing: 'Analyzing…',
    },
    clauses: {
      title: 'Clauses',
      description: 'Clause-by-clause review state, summaries, and review workflow.',
      riskScorePrefix: (score) => `Risk score: ${score}`,
      confidencePrefix: (percent) => `Confidence: ${percent}%`,
      noSectionReference: 'No section reference',
      noSummary: 'No analysis summary available.',
      reviewClause: 'Review Clause',
      empty: 'No clauses are available for this contract yet.',
    },
    versions: {
      redlineTitle: 'Redline Preview',
      redlineDescription:
        'Added and removed markup between the latest two extracted-text versions.',
      basePrefix: (version, name) => `Base v${version}: ${name}`,
      targetPrefix: (version, name) => `Target v${version}: ${name}`,
      addedLines: (count) => `${count} added`,
      removedLines: (count) => `${count} removed`,
      redlineEmptyTitle: 'No redline available',
      redlineEmptyDescription:
        'Upload two versions with extracted text to render an added/removed markup preview.',
      historyTitle: 'Version History',
      historyDescription: 'Uploaded contract versions with file hashes and change summaries.',
      uploadVersion: 'Upload Version',
      loadError: 'Failed to load contract versions.',
      versionPrefix: (version) => `Version ${version}`,
      noChangeSummary: 'No change summary recorded.',
      hashPrefix: (hash) => `SHA-256 ${hash}…`,
      download: 'Download',
      empty: 'No versions have been uploaded yet.',
    },
    workflow: {
      linkageTitle: 'Workflow Linkage',
      linkageDescription: 'Contract review state is persisted in the workflow engine.',
      linkageEmptyDescription: 'This contract has not entered a review workflow yet.',
      workflowInstance: 'Workflow instance',
      contractStatus: 'Contract status',
      currentVersion: 'Current version',
      started: 'Started',
      notAvailable: 'Not available',
      emptyTitle: 'No workflow linked',
      emptyDescription:
        'Start a review workflow to create a tenant-scoped human task in the workflow engine.',
      startReview: 'Start Review Workflow',
      timelineTitle: 'Timeline',
      timelineDescription: 'Contract lifecycle, analysis, version, and metadata events.',
      timelineLoadError: 'Failed to load the contract timeline.',
      timelineEmptyTitle: 'No timeline events',
      timelineEmptyDescription: 'No lifecycle events are available for this contract yet.',
      generatedPrefix: (date) => `Generated ${date}`,
      actorPrefix: (actor) => `Actor ${actor}`,
    },
    statusDialog: {
      title: 'Change Status',
      description: (current) => `Move the contract from ${current} to a valid next state.`,
      nextStatus: 'Next status',
      selectStatus: 'Select status',
      noTransitions: 'This contract has no further status transitions from its current state.',
      cancel: 'Cancel',
      submit: 'Update Status',
    },
    reviewDialog: {
      title: 'Start Review Workflow',
      description: 'Create a workflow-backed legal review task for this contract.',
      specificApprover: 'Specific approver',
      loadingUsers: 'Loading users…',
      selectApprover: 'Select approver',
      assignByRole: 'Assign by role',
      approverRole: 'Approver role',
      approverRolePlaceholder: 'legal',
      slaHours: 'SLA hours',
      taskDescription: 'Task description',
      taskDescriptionPlaceholder: 'Review key obligations, clause risks, and approval readiness.',
      doaPolicy: 'DoA policy',
      doaPolicyHelp:
        'Use an active catalog policy or keep a one-off manual override for this review.',
      policyNone: 'No policy',
      policyNoneHelp: 'Create a standard review task.',
      policyCatalog: 'Catalog policy',
      policyCatalogHelp: 'Route through an active policy.',
      policyManual: 'Manual override',
      policyManualHelp: 'Enter inline authority rules.',
      activePolicies: 'Active approval policies',
      recommendPolicy: 'Recommend Policy',
      recommendedPolicy: 'Recommended policy',
      noPolicyMatch: 'No policy match',
      matched: 'Matched',
      review: 'Review',
      applyRecommendation: 'Apply Recommendation',
      recommendationUnavailable:
        'The recommended policy is not available as an active catalog choice.',
      policiesLoadError: 'Failed to load approval policies.',
      noActivePolicies: 'No active approval policies',
      noActivePoliciesHelp: 'Use a manual override or activate a policy in Workflow Policies.',
      policyId: 'Policy ID',
      policyIdPlaceholder: 'DOA-KSA-LEGAL-001',
      policyName: 'Policy name',
      policyNamePlaceholder: 'Saudi approval matrix',
      requiredRole: 'Required role',
      requiredRolePlaceholder: 'finance_director',
      authorityAmount: 'Authority amount',
      authorityAmountPlaceholder: '500000',
      currency: 'Currency',
      requireEvidence: 'Require evidence reference',
      requiredDecisionFields: 'Required decision fields',
      businessJustification: 'Business justification',
      businessJustificationHelp: 'Adds a required textarea to the task.',
      riskAcceptance: 'Risk acceptance',
      riskAcceptanceHelp: 'Adds a required approval checkbox.',
      outOfOffice: 'Out-of-office delegation',
      outOfOfficeHelp: 'Reroute this task while preserving original approver evidence.',
      delegate: 'Delegate',
      selectDelegate: 'Select delegate',
      evidenceId: 'Evidence ID',
      evidenceIdPlaceholder: 'OOO-CALENDAR-123',
      starts: 'Starts',
      ends: 'Ends',
      delegationReason: 'Delegation reason',
      delegationReasonPlaceholder: 'Approver is unavailable during the SLA window.',
      cancel: 'Cancel',
      submit: 'Start Review',
      formBusinessJustification: 'Business justification',
      formRiskAcceptance: 'Risk accepted',
    },
    reviewToast: {
      title: 'Review started.',
      description: 'A workflow instance now tracks the contract review.',
    },
    approvalPolicy: {
      active: 'Active',
      priorityPrefix: (priority) => `Priority ${priority}`,
      scopePrefix: 'Scope:',
      routePrefix: 'Route:',
      authorityPrefix: 'Authority:',
      noApprovers: 'No approvers',
      anyType: 'Any type',
      anyDepartment: 'Any department',
      rangePrefix: (currency, min, max) => `${currency} ${min}-${max}`,
      fromPrefix: (currency, min) => `From ${currency} ${min}`,
      upToPrefix: (currency, max) => `Up to ${currency} ${max}`,
      anyValue: 'Any value',
      quorumNofM: (n, total) => `${n} of ${total}`,
      anyApprovalAuthority: 'Any approval authority',
      evidenceRequired: 'Evidence required',
      evidenceOptional: 'Evidence optional',
      undisclosedLower: 'undisclosed',
    },
    renewDialog: {
      title: 'Renew Contract',
      description: 'Create a renewal record with updated dates and commercial terms.',
      newEffectiveDate: 'New effective date',
      newExpiryDate: 'New expiry date',
      newValue: 'New value',
      changeSummary: 'Change summary',
      changeSummaryPlaceholder: 'Annual renewal with updated commercial rates.',
      cancel: 'Cancel',
      submit: 'Renew Contract',
    },
    uploadDialog: {
      title: 'Upload New Version',
      description: 'Attach a new contract file and optional extracted text for analysis.',
      fileLabel: 'Contract file',
      selectedPrefix: (name) => `Selected: ${name}`,
      changeSummary: 'Change summary',
      changeSummaryPlaceholder: 'Updated commercial schedule and renewal appendix.',
      extractedText: 'Extracted text',
      extractedTextPlaceholder: 'Paste contract text if you want immediate deterministic analysis.',
      uploadProgress: (percent) => `Upload progress: ${percent}%`,
      selectFileError: 'Select a file before uploading a new version.',
      cancel: 'Cancel',
      submit: 'Upload Version',
    },
    clauseDialog: {
      title: 'Review Clause',
      description: (clauseTitle) => `Persist a review decision for ${clauseTitle}.`,
      fallbackClause: 'this clause',
      reviewStatus: 'Review status',
      reviewNotes: 'Review notes',
      reviewNotesPlaceholder: 'Document the legal reasoning behind the clause decision.',
      cancel: 'Cancel',
      submit: 'Save Review',
    },
    exportFields: {
      field: 'Field',
      value: 'Value',
      title: 'Title',
      status: 'Status',
      type: 'Type',
      owner: 'Owner',
      legalReviewer: 'Legal reviewer',
      counterparty: 'Counterparty',
      riskLevel: 'Risk level',
      riskScore: 'Risk score',
      renewalWarning: 'Renewal warning',
      matter: 'Matter',
      obligations: 'Obligations',
      clauses: 'Clauses',
    },
    toast: {
      analyzedTitle: 'Contract analyzed.',
      analyzedDescription: 'The latest clause and risk analysis is now available.',
      complianceTitle: 'Compliance checks completed.',
      classifyAppliedTitle: 'Classification applied.',
      classifyRecommendedTitle: 'Classification recommended.',
      classifyAppliedDescription: (type) => `Contract type is now ${type}.`,
      classifyRecommendedDescription: (type) => `Recommended type is ${type}.`,
      statusUpdatedTitle: 'Status updated.',
      statusUpdatedDescription: 'The contract lifecycle state has been changed.',
      renewedTitle: 'Contract renewed.',
      renewedDescription: 'A renewed contract record has been created.',
      reviewStartedTitle: 'Review started.',
      reviewStartedDescription: 'A workflow instance now tracks the contract review.',
      deletedTitle: 'Contract deleted.',
      deletedDescription: 'The contract has been removed from the active portfolio.',
      clauseSavedTitle: 'Clause review saved.',
      clauseSavedDescription: 'The clause review decision is now attached to the contract.',
      signatureSentTitle: 'Signature envelope sent.',
      signatureSentDescription: 'The contract signature handoff has been sent to recipients.',
      signatureCancelledTitle: 'Signature envelope cancelled.',
      signatureCancelledDescription: 'The contract signature handoff is no longer active.',
      versionUploadedTitle: 'Version uploaded.',
      versionUploadedDescription: 'The contract version history has been updated.',
    },
    deleteConfirm: {
      title: 'Delete Contract',
      description: (title) =>
        `Delete "${title}"? This removes the contract from the active portfolio.`,
      confirm: 'Delete Contract',
    },
  },
  ar: {
    loadingTitle: 'العقد',
    loadingDescription: 'جارٍ تحميل دورة حياة العقد والتحليل وسياق سير العمل.',
    errorTitle: 'العقد',
    errorDescription: 'تعذّر تحميل تفاصيل العقد.',
    fallbackDescription: 'تفاصيل دورة حياة العقد القانوني.',
    actions: {
      edit: 'تعديل',
      analyze: 'تحليل',
      runCompliance: 'تشغيل الامتثال',
      exportSummary: 'تصدير الملخص',
    },
    analyzeMessage: (findings, flags) =>
      `اكتمل التحليل بـ ${findings} نتيجة و${flags} علامة امتثال.`,
    classificationBanner: (verb, type, confidence) => `${verb} ${type} بثقة ${confidence}%.`,
    appliedLabel: 'مُطبَّق',
    recommendedLabel: 'مُوصى به',
    metrics: {
      status: 'الحالة',
      risk: 'المخاطر',
      riskScore: (score) => `الدرجة ${score}`,
      noScoreYet: 'لا توجد درجة بعد',
      version: 'النسخة',
      recordedVersions: (count) => `${count} نسخة مسجّلة`,
      workflow: 'سير العمل',
      activeReview: 'مراجعة نشطة',
      noWorkflow: 'لا يوجد سير عمل',
      instancePrefix: (id) => `النسخة ${id}`,
      reviewNotStarted: 'لم تبدأ المراجعة',
    },
    stepper: {
      title: 'متتبّع دورة الحياة',
      description: 'حركة عقد وثيق من المسودة حتى التفعيل.',
      current: 'المرحلة الحالية',
      completed: 'مكتملة',
      pending: 'قيد الانتظار',
      ariaLabel: 'دورة حياة العقد',
    },
    brief: {
      title: 'موجز العقد',
      description: 'ملخص قانوني وتجاري من صفحة واحدة مولّد من التطبيق.',
      loadError: 'تعذّر تحميل موجز العقد.',
      counterparty: 'الطرف المقابل',
      owner: 'المالك',
      value: 'القيمة',
      risk: 'المخاطر',
      notSet: 'غير محدد',
      unassigned: 'غير مُسند',
      undisclosed: 'غير مُفصح عنها',
      noScore: 'لا توجد درجة',
      scorePrefix: (score) => `الدرجة ${score}`,
      executiveSummary: 'الملخص التنفيذي',
      riskSummary: 'ملخص المخاطر',
      topRisks: 'أبرز المخاطر',
      keyObligations: 'الالتزامات الرئيسية',
      noSignals: 'لا توجد مؤشرات بعد.',
      emptyTitle: 'لا يوجد موجز متاح',
      emptyDescription: 'لم تُرجع الواجهة الخلفية موجزًا لهذا السجل.',
    },
    tabs: {
      overview: 'نظرة عامة',
      details: 'التفاصيل',
      analysis: 'التحليل والبنود',
      versions: 'النسخ',
      workflow: 'سير العمل',
    },
    detailsTab: {
      description: 'بيانات العقد المرجعية والأطراف والتصنيف وسياق الوثيقة.',
    },
    keyDates: {
      title: 'التواريخ الرئيسية',
      description: 'الخط الزمني للسريان والتجديد والانتهاء مع عدّ تنازلي حي.',
    },
    riskPanel: {
      title: 'تقييم المخاطر',
      description: 'وضع مخاطر موحّد ومرجعي: الخطورة والدرجة والمحرّكات.',
      summaryFallback: 'لا يوجد ملخص مخاطر بعد. شغّل التحليل لإظهار المحرّكات.',
      ariaLabel: 'مخاطر العقد',
      riskScore: 'درجة المخاطر',
      riskSuffix: (severity) => `مخاطر ${severity}`,
      clausesReviewed: 'بند مُراجَع',
      missingClauses: 'بند ناقص',
      complianceFlags: 'علامة امتثال',
    },
    findings: {
      title: 'نتائج المخاطر والثغرات',
      description: 'مخاطر قابلة للتنفيذ وبنود ناقصة مع اختصارات المعالجة.',
      empty: 'لا توجد نتائج مخاطر بعد — شغّل التحليل لإظهار مخاطر مستوى البنود.',
      recommendationPrefix: 'التوصية: ',
      addClause: 'إضافة بند',
      draftWithAi: 'الصياغة بالذكاء الاصطناعي',
      view: 'عرض',
    },
    lifecycleGroups: {
      statusWorkflow: 'الحالة وسير العمل',
      documents: 'الوثائق',
      dangerZone: 'منطقة الخطر',
      dangerZoneHelp: 'إجراءات لا رجعة فيها. تابع بحذر.',
    },
    moreMenu: {
      trigger: 'المزيد',
      label: 'إجراءات إضافية',
    },
    lastCompliance: {
      pending: 'لا يوجد تشغيل امتثال في هذه الجلسة.',
      lastRun: (score, when) => `سجّل آخر تشغيل ${score}% في ${when}.`,
      alerts: (count) => `أُنشئ ${count} تنبيه.`,
    },
    metadata: {
      title: 'بيانات العقد',
      description: 'حالة العقد الأساسية والتواريخ والملكية القانونية.',
      contractNumber: 'رقم العقد',
      autoGenerated: 'مولّد تلقائيًا',
      type: 'النوع',
      owner: 'المالك',
      legalReviewer: 'المراجع القانوني',
      unassigned: 'غير مُسند',
      department: 'الإدارة',
      notSet: 'غير محدد',
      effectiveDate: 'تاريخ السريان',
      expiryDate: 'تاريخ الانتهاء',
      duration: 'المدة',
      durationValue: (months, days) =>
        `${months} شهر${days > 0 ? ` و${days} يوم` : ''}`,
      durationNotSet: 'غير محدد',
      renewalDate: 'تاريخ التجديد',
      renewalCalculated: (date) => `${date} (محتسب)`,
      renewalWarning: 'تنبيه التجديد',
      autoRenew: 'التجديد التلقائي',
      autoRenewOn: (noticeDays) =>
        noticeDays > 0
          ? `مُفعّل — إشعار ${noticeDays} يومًا للإلغاء`
          : 'مُفعّل — يُجدَّد ما لم يُنهَ',
      autoRenewOff: 'غير مُفعّل — التجديد يدوي',
      paymentTerms: 'شروط الدفع',
      tags: 'الوسوم',
      noTags: 'لا توجد وسوم',
    },
    lifecycleActions: {
      title: 'إجراءات دورة الحياة',
      description: 'انقل العقد عبر مراحل دورة حياته: الحالة والمراجعة والتجديد والمستندات.',
      changeStatus: 'تغيير الحالة',
      startReview: 'بدء سير عمل المراجعة',
      renew: 'تجديد العقد',
      uploadVersion: 'رفع نسخة جديدة',
      previewDocument: 'معاينة الوثيقة',
      signatureQueue: 'قائمة التوقيع',
      deleteContract: 'حذف العقد',
      archiveContract: 'أرشفة العقد',
    },
    classification: {
      title: 'التصنيف',
      description: 'توصية نوع العقد وتصنيف كتابي اختياري.',
      recommend: 'توصية',
      apply: 'تطبيق',
      recommended: 'مُوصى به',
      confidence: (percent) => `ثقة ${percent}%`,
      applied: 'مُطبَّق',
      appliedBadge: 'مُطبَّق',
      previewBadge: 'معاينة',
      previousPrefix: (type) => `السابق ${type}`,
      classifiedAt: 'صُنّف في',
      noMatchedTerms: 'لا توجد مصطلحات مطابقة',
      emptyDescription: 'لم تُولّد أي توصية تصنيف لهذا العقد في هذه الجلسة.',
      currentTypePrefix: (type) => `النوع الحالي: ${type}`,
    },
    signature: {
      title: 'تسليم التوقيع',
      description: 'مغلّفات التوقيع المرتبطة بهذا العقد وحالة إتمام المستلمين.',
      viewQueue: 'عرض القائمة',
      loadError: 'تعذّر تحميل مغلّفات التوقيع.',
      latestEnvelope: 'أحدث مغلّف',
      recipients: 'المستلمون',
      providerNotSet: 'لم يُحدَّد المزوّد',
      deadline: 'الموعد النهائي',
      sentPrefix: (date) => `أُرسل ${date}`,
      notSent: 'لم يُرسل',
      noUpdateTimestamp: 'لا يوجد طابع زمني للتحديث',
      send: 'إرسال',
      cancel: 'إلغاء',
      emptyTitle: 'لا يوجد تسليم توقيع',
      emptyDescription: 'لا يوجد مغلّف توقيع مرتبط بهذا العقد بعد.',
      progress: (signed, total) => `${signed}/${total} موقّع`,
    },
    matterLink: {
      title: 'ربط القضية',
      description: 'سياق القضية مُسقط من بيانات العقد حتى توفر نقطة نهاية مخصّصة للقضايا.',
      matter: 'القضية',
      matterId: 'معرّف القضية',
      status: 'الحالة',
      owner: 'المالك',
      priority: 'الأولوية',
      notSet: 'غير محدد',
      emptyTitle: 'لا توجد قضية مرتبطة',
      emptyDescription: 'لا توجد بيانات قضية مرفقة بهذا العقد.',
    },
    obligations: {
      title: 'الالتزامات والتذكيرات',
      description: 'التزامات قابلة للتتبع من بيانات العقد مع تواريخ الاستحقاق ونوافذ التذكير.',
      emptyTitle: 'لا توجد التزامات مرفقة',
      emptyDescription: 'لا توجد بيانات التزام مرفقة بهذا العقد.',
      unassigned: 'غير مُسند',
      noDueDate: 'لا يوجد تاريخ استحقاق',
      reminderConfigured: (days) => `تذكير ${days} يومًا قبل تاريخ الاستحقاق`,
      reminderNotConfigured: 'التذكير غير مُهيّأ',
    },
    parties: {
      title: 'الأطراف والقيمة',
      description: 'الأطراف التجارية والسياق المالي.',
      partyA: 'الطرف الأول',
      partyAEntity: 'كيان الطرف الأول',
      counterparty: 'الطرف المقابل',
      counterpartyEntity: 'كيان الطرف المقابل',
      counterpartyContact: 'جهة اتصال الطرف المقابل',
      notSet: 'غير محدد',
      totalValue: 'القيمة الإجمالية',
      undisclosed: 'غير مُفصح عنها',
    },
    documentContext: {
      title: 'سياق الوثيقة',
      description: 'أحدث نسخة وارتباط سير العمل للمراجعة اللاحقة.',
      latestVersion: 'أحدث نسخة',
      noUploadedVersions: 'لا توجد نسخ مرفوعة',
      latestUpload: 'أحدث رفع',
      noFileAvailable: 'لا يوجد ملف متاح',
      download: 'تنزيل',
      workflowInstance: 'نسخة سير العمل',
      notLinked: 'غير مرتبط',
      lastAnalyzed: 'آخر تحليل',
      notAnalyzed: 'لم يُحلَّل',
      analysisStatus: 'حالة التحليل',
    },
    complianceRun: {
      title: 'أحدث تشغيل امتثال',
      description: 'أحدث تنفيذ امتثال على نطاق العقد من الواجهة الخلفية المباشرة.',
      score: 'الدرجة',
      alertsCreated: 'التنبيهات المُنشأة',
      calculatedAt: 'حُسب في',
      alertsToast: (count) => `أُنشئ ${count} تنبيه لهذا العقد.`,
    },
    analysis: {
      riskSummaryTitle: 'ملخص المخاطر',
      riskSummaryDescription: 'أحدث تحليل مخاطر قابل للتفسير لهذا العقد.',
      overallRisk: 'المخاطر الإجمالية',
      riskScore: 'درجة المخاطر',
      clauseCount: 'عدد البنود',
      highRiskClauses: 'البنود عالية المخاطر',
      analyzedAt: 'حُلّل في',
      analysisDurationLabel: 'مدة التحليل',
      analysisDuration: (ms) => `${ms} مللي ثانية`,
      extractedTitle: 'الأطراف والتواريخ المستخرجة',
      extractedDescription: 'حقول حتمية مستخرجة أثناء التحليل.',
      parties: 'الأطراف',
      noPartiesExtracted: 'لم تُستخرج أطراف.',
      dates: 'التواريخ',
      noValue: 'لا توجد قيمة',
      noDatesExtracted: 'لم تُستخرج تواريخ.',
      keyFindingsTitle: 'النتائج الرئيسية',
      keyFindingsDescription: 'أبرز نتائج العقد مع التوصيات.',
      recommendationPrefix: 'التوصية:',
      noKeyFindings: 'لم تُرجع أي نتائج رئيسية.',
      missingFlagsTitle: 'البنود الناقصة والعلامات',
      missingFlagsDescription: 'الثغرات وعلامات الامتثال المكتشفة في أحدث تشغيل.',
      missingClauses: 'البنود الناقصة',
      noMissingClauses: 'لم تُكتشف بنود ناقصة.',
      complianceFlags: 'علامات الامتثال',
      noComplianceFlags: 'لم تُثَر أي علامات امتثال.',
      libraryTitle: 'جاهزية مكتبة البنود',
      libraryDescription: 'مخزون البنود القابلة لإعادة الاستخدام والتغطية ثنائية اللغة وحالة المراجعة لهذا العقد.',
      libraryClauses: 'البنود',
      libraryBilingual: 'ثنائية اللغة',
      libraryPending: 'قيد المراجعة',
      libraryDeprecated: 'مهملة',
      cardTitle: 'التحليل',
      cardEmptyDescription: 'لا يحتوي العقد الحالي على نتيجة تحليل مخزّنة بعد.',
      emptyTitle: 'لا يوجد تحليل متاح',
      emptyDescription: 'شغّل تحليل العقد لتعبئة استخراج البنود وتقدير المخاطر ومؤشرات الامتثال.',
      emptyAnalyze: 'تحليل العقد',
      emptyAnalyzing: 'جارٍ التحليل…',
    },
    clauses: {
      title: 'البنود',
      description: 'حالة المراجعة بندًا بندًا والملخصات وسير عمل المراجعة.',
      riskScorePrefix: (score) => `درجة المخاطر: ${score}`,
      confidencePrefix: (percent) => `الثقة: ${percent}%`,
      noSectionReference: 'لا يوجد مرجع للقسم',
      noSummary: 'لا يوجد ملخص تحليل متاح.',
      reviewClause: 'مراجعة البند',
      empty: 'لا توجد بنود متاحة لهذا العقد بعد.',
    },
    versions: {
      redlineTitle: 'معاينة الخط الأحمر',
      redlineDescription: 'العلامات المُضافة والمحذوفة بين أحدث نسختين من النص المستخرج.',
      basePrefix: (version, name) => `الأساس v${version}: ${name}`,
      targetPrefix: (version, name) => `الهدف v${version}: ${name}`,
      addedLines: (count) => `${count} مُضاف`,
      removedLines: (count) => `${count} محذوف`,
      redlineEmptyTitle: 'لا توجد معاينة خط أحمر',
      redlineEmptyDescription: 'ارفع نسختين بنص مستخرج لعرض معاينة العلامات المُضافة والمحذوفة.',
      historyTitle: 'سجل النسخ',
      historyDescription: 'نسخ العقد المرفوعة مع بصمات الملفات وملخصات التغيير.',
      uploadVersion: 'رفع نسخة',
      loadError: 'تعذّر تحميل نسخ العقد.',
      versionPrefix: (version) => `النسخة ${version}`,
      noChangeSummary: 'لم يُسجَّل ملخص تغيير.',
      hashPrefix: (hash) => `SHA-256 ${hash}…`,
      download: 'تنزيل',
      empty: 'لم تُرفع أي نسخ بعد.',
    },
    workflow: {
      linkageTitle: 'ارتباط سير العمل',
      linkageDescription: 'حالة مراجعة العقد محفوظة في محرّك سير العمل.',
      linkageEmptyDescription: 'لم يدخل هذا العقد سير عمل مراجعة بعد.',
      workflowInstance: 'نسخة سير العمل',
      contractStatus: 'حالة العقد',
      currentVersion: 'النسخة الحالية',
      started: 'بدأ',
      notAvailable: 'غير متاح',
      emptyTitle: 'لا يوجد سير عمل مرتبط',
      emptyDescription: 'ابدأ سير عمل مراجعة لإنشاء مهمة بشرية على نطاق المستأجر في محرّك سير العمل.',
      startReview: 'بدء سير عمل المراجعة',
      timelineTitle: 'الخط الزمني',
      timelineDescription: 'أحداث دورة حياة العقد والتحليل والنسخ والبيانات.',
      timelineLoadError: 'تعذّر تحميل الخط الزمني للعقد.',
      timelineEmptyTitle: 'لا توجد أحداث في الخط الزمني',
      timelineEmptyDescription: 'لا توجد أحداث دورة حياة متاحة لهذا العقد بعد.',
      generatedPrefix: (date) => `مُولّد ${date}`,
      actorPrefix: (actor) => `الفاعل ${actor}`,
    },
    statusDialog: {
      title: 'تغيير الحالة',
      description: (current) => `انقل العقد من ${current} إلى حالة تالية صالحة.`,
      nextStatus: 'الحالة التالية',
      selectStatus: 'اختر الحالة',
      noTransitions: 'لا توجد انتقالات حالة إضافية لهذا العقد من حالته الحالية.',
      cancel: 'إلغاء',
      submit: 'تحديث الحالة',
    },
    reviewDialog: {
      title: 'بدء سير عمل المراجعة',
      description: 'إنشاء مهمة مراجعة قانونية مدعومة بسير العمل لهذا العقد.',
      specificApprover: 'معتمِد محدد',
      loadingUsers: 'جارٍ تحميل المستخدمين…',
      selectApprover: 'اختر المعتمِد',
      assignByRole: 'الإسناد حسب الدور',
      approverRole: 'دور المعتمِد',
      approverRolePlaceholder: 'legal',
      slaHours: 'ساعات اتفاقية مستوى الخدمة',
      taskDescription: 'وصف المهمة',
      taskDescriptionPlaceholder: 'راجع الالتزامات الرئيسية ومخاطر البنود وجاهزية الاعتماد.',
      doaPolicy: 'سياسة تفويض الصلاحيات',
      doaPolicyHelp: 'استخدم سياسة نشطة من الكتالوج أو احتفظ بتجاوز يدوي لمرة واحدة لهذه المراجعة.',
      policyNone: 'بلا سياسة',
      policyNoneHelp: 'إنشاء مهمة مراجعة قياسية.',
      policyCatalog: 'سياسة الكتالوج',
      policyCatalogHelp: 'التوجيه عبر سياسة نشطة.',
      policyManual: 'تجاوز يدوي',
      policyManualHelp: 'أدخل قواعد الصلاحية يدويًا.',
      activePolicies: 'سياسات الاعتماد النشطة',
      recommendPolicy: 'توصية بسياسة',
      recommendedPolicy: 'السياسة المُوصى بها',
      noPolicyMatch: 'لا توجد سياسة مطابقة',
      matched: 'مطابق',
      review: 'مراجعة',
      applyRecommendation: 'تطبيق التوصية',
      recommendationUnavailable: 'السياسة المُوصى بها غير متاحة كخيار نشط في الكتالوج.',
      policiesLoadError: 'تعذّر تحميل سياسات الاعتماد.',
      noActivePolicies: 'لا توجد سياسات اعتماد نشطة',
      noActivePoliciesHelp: 'استخدم تجاوزًا يدويًا أو فعّل سياسة في سياسات سير العمل.',
      policyId: 'معرّف السياسة',
      policyIdPlaceholder: 'DOA-KSA-LEGAL-001',
      policyName: 'اسم السياسة',
      policyNamePlaceholder: 'مصفوفة الاعتماد السعودية',
      requiredRole: 'الدور المطلوب',
      requiredRolePlaceholder: 'finance_director',
      authorityAmount: 'مبلغ الصلاحية',
      authorityAmountPlaceholder: '500000',
      currency: 'العملة',
      requireEvidence: 'اشتراط مرجع الإثبات',
      requiredDecisionFields: 'حقول القرار المطلوبة',
      businessJustification: 'المبرر التجاري',
      businessJustificationHelp: 'يضيف حقل نص مطلوب إلى المهمة.',
      riskAcceptance: 'قبول المخاطر',
      riskAcceptanceHelp: 'يضيف خانة اختيار اعتماد مطلوبة.',
      outOfOffice: 'التفويض خارج المكتب',
      outOfOfficeHelp: 'أعد توجيه هذه المهمة مع الحفاظ على إثبات المعتمِد الأصلي.',
      delegate: 'المفوَّض إليه',
      selectDelegate: 'اختر المفوَّض إليه',
      evidenceId: 'معرّف الإثبات',
      evidenceIdPlaceholder: 'OOO-CALENDAR-123',
      starts: 'يبدأ',
      ends: 'ينتهي',
      delegationReason: 'سبب التفويض',
      delegationReasonPlaceholder: 'المعتمِد غير متاح خلال نافذة اتفاقية مستوى الخدمة.',
      cancel: 'إلغاء',
      submit: 'بدء المراجعة',
      formBusinessJustification: 'المبرر التجاري',
      formRiskAcceptance: 'تم قبول المخاطر',
    },
    reviewToast: {
      title: 'بدأت المراجعة.',
      description: 'تتبع الآن نسخة سير عمل مراجعة العقد.',
    },
    approvalPolicy: {
      active: 'نشطة',
      priorityPrefix: (priority) => `الأولوية ${priority}`,
      scopePrefix: 'النطاق:',
      routePrefix: 'المسار:',
      authorityPrefix: 'الصلاحية:',
      noApprovers: 'لا يوجد معتمِدون',
      anyType: 'أي نوع',
      anyDepartment: 'أي إدارة',
      rangePrefix: (currency, min, max) => `${currency} ${min}-${max}`,
      fromPrefix: (currency, min) => `من ${currency} ${min}`,
      upToPrefix: (currency, max) => `حتى ${currency} ${max}`,
      anyValue: 'أي قيمة',
      quorumNofM: (n, total) => `${n} من ${total}`,
      anyApprovalAuthority: 'أي صلاحية اعتماد',
      evidenceRequired: 'الإثبات مطلوب',
      evidenceOptional: 'الإثبات اختياري',
      undisclosedLower: 'غير مُفصح عنها',
    },
    renewDialog: {
      title: 'تجديد العقد',
      description: 'إنشاء سجل تجديد بتواريخ وشروط تجارية محدّثة.',
      newEffectiveDate: 'تاريخ السريان الجديد',
      newExpiryDate: 'تاريخ الانتهاء الجديد',
      newValue: 'القيمة الجديدة',
      changeSummary: 'ملخص التغيير',
      changeSummaryPlaceholder: 'تجديد سنوي بأسعار تجارية محدّثة.',
      cancel: 'إلغاء',
      submit: 'تجديد العقد',
    },
    uploadDialog: {
      title: 'رفع نسخة جديدة',
      description: 'أرفق ملف عقد جديدًا ونصًا مستخرجًا اختياريًا للتحليل.',
      fileLabel: 'ملف العقد',
      selectedPrefix: (name) => `المحدد: ${name}`,
      changeSummary: 'ملخص التغيير',
      changeSummaryPlaceholder: 'جدول تجاري محدّث وملحق تجديد.',
      extractedText: 'النص المستخرج',
      extractedTextPlaceholder: 'الصق نص العقد إذا أردت تحليلًا حتميًا فوريًا.',
      uploadProgress: (percent) => `تقدّم الرفع: ${percent}%`,
      selectFileError: 'اختر ملفًا قبل رفع نسخة جديدة.',
      cancel: 'إلغاء',
      submit: 'رفع النسخة',
    },
    clauseDialog: {
      title: 'مراجعة البند',
      description: (clauseTitle) => `احفظ قرار مراجعة لـ ${clauseTitle}.`,
      fallbackClause: 'هذا البند',
      reviewStatus: 'حالة المراجعة',
      reviewNotes: 'ملاحظات المراجعة',
      reviewNotesPlaceholder: 'وثّق المبرر القانوني وراء قرار البند.',
      cancel: 'إلغاء',
      submit: 'حفظ المراجعة',
    },
    exportFields: {
      field: 'الحقل',
      value: 'القيمة',
      title: 'العنوان',
      status: 'الحالة',
      type: 'النوع',
      owner: 'المالك',
      legalReviewer: 'المراجع القانوني',
      counterparty: 'الطرف المقابل',
      riskLevel: 'مستوى المخاطر',
      riskScore: 'درجة المخاطر',
      renewalWarning: 'تنبيه التجديد',
      matter: 'القضية',
      obligations: 'الالتزامات',
      clauses: 'البنود',
    },
    toast: {
      analyzedTitle: 'تم تحليل العقد.',
      analyzedDescription: 'أحدث تحليل للبنود والمخاطر متاح الآن.',
      complianceTitle: 'اكتملت فحوص الامتثال.',
      classifyAppliedTitle: 'تم تطبيق التصنيف.',
      classifyRecommendedTitle: 'تمت التوصية بالتصنيف.',
      classifyAppliedDescription: (type) => `نوع العقد الآن ${type}.`,
      classifyRecommendedDescription: (type) => `النوع المُوصى به هو ${type}.`,
      statusUpdatedTitle: 'تم تحديث الحالة.',
      statusUpdatedDescription: 'تم تغيير حالة دورة حياة العقد.',
      renewedTitle: 'تم تجديد العقد.',
      renewedDescription: 'تم إنشاء سجل عقد مُجدَّد.',
      reviewStartedTitle: 'بدأت المراجعة.',
      reviewStartedDescription: 'تتبع الآن نسخة سير عمل مراجعة العقد.',
      deletedTitle: 'تم حذف العقد.',
      deletedDescription: 'تمت إزالة العقد من المحفظة النشطة.',
      clauseSavedTitle: 'تم حفظ مراجعة البند.',
      clauseSavedDescription: 'قرار مراجعة البند مرفق الآن بالعقد.',
      signatureSentTitle: 'تم إرسال مغلّف التوقيع.',
      signatureSentDescription: 'تم إرسال تسليم توقيع العقد إلى المستلمين.',
      signatureCancelledTitle: 'تم إلغاء مغلّف التوقيع.',
      signatureCancelledDescription: 'لم يعد تسليم توقيع العقد نشطًا.',
      versionUploadedTitle: 'تم رفع النسخة.',
      versionUploadedDescription: 'تم تحديث سجل نسخ العقد.',
    },
    deleteConfirm: {
      title: 'حذف العقد',
      description: (title) => `حذف "${title}"؟ يؤدي ذلك إلى إزالة العقد من المحفظة النشطة.`,
      confirm: 'حذف العقد',
    },
  },
};

export function useContractDetailLabels(): ContractDetailLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveLexBilingual(contractDetailLabels, locale), [locale]);
}

/**
 * useContractStatusTokenLabels resolves the suite-wide contract status record
 * (keyed by the raw LexContractStatus backend token) for the active locale.
 * Resolve a label with `labels[token] ?? titleCase(token)`.
 */
export function useContractStatusTokenLabels(): Record<string, string> {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveLexBilingual(lexContractStatusLabels, locale), [locale]);
}

/**
 * useContractRiskLabels resolves the risk-level record (keyed by raw backend
 * token) for the active locale. Resolve with `labels[token] ?? token`.
 */
export function useContractRiskLabels(): Record<string, string> {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveLexBilingual(contractRiskLabels, locale), [locale]);
}

/**
 * resolveContractLabels is a pure non-React resolver bundling every contracts
 * label group for a given locale. Useful for tests and non-React callers.
 * Defaults to English (and any unknown locale → English) so isolated callers
 * keep the English surface.
 */
export function resolveContractLabels(locale: AppLocale = 'en') {
  const loc: AppLocale = locale === 'ar' ? 'ar' : 'en';
  return {
    locale: loc,
    list: resolveLexBilingual(contractsListLabels, loc),
    form: resolveLexBilingual(contractFormLabels, loc),
    detail: resolveLexBilingual(contractDetailLabels, loc),
    types: resolveLexBilingual(contractTypeLabels, loc),
    risk: resolveLexBilingual(contractRiskLabels, loc),
    complianceAlertStatus: resolveLexBilingual(contractComplianceAlertStatusLabels, loc),
    regulationStatus: resolveLexBilingual(regulationStatusLabels, loc),
    auditSource: resolveLexBilingual(contractAuditSourceLabels, loc),
  };
}
