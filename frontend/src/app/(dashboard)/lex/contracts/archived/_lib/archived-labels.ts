/**
 * CAP-122 — Bilingual (English + Modern Standard Arabic) labels for the Archived
 * Contracts view and its filter rail. Follows the canonical lex bilingual
 * contract (`../../../_lib/lex-i18n.ts`): a `LexBilingual<T>` bundle with two
 * full, same-shaped copies resolved by {@link useArchivedLabels}.
 *
 * The `en` side MUST equal the pre-existing English strings so existing
 * English-asserting tests stay green; the `ar` side is professional MSA using
 * the suite glossary (عقد / أرشفة / تصنيف / حالة / طرف).
 */

'use client';

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n';
import { type LexBilingual, resolveLexBilingual } from '../../../_lib/lex-i18n';

export interface ArchivedLabels {
  title: string;
  description: string;
  eyebrow: string;
  breadcrumbs: {
    home: string;
    contracts: string;
    archive: string;
  };
  kpis: {
    total: string;
    active: string;
    expiring: string;
    expired: string;
  };
  columns: {
    contract: string;
    reference: string;
    counterparty: string;
    type: string;
    startDate: string;
    endDate: string;
    status: string;
    owner: string;
    archived: string;
    reason: string;
    actions: string;
  };
  rowActions: {
    view: string;
    unarchive: string;
    download: string;
  };
  actions: {
    backToContracts: string;
  };
  restoreConfirm: {
    title: string;
    description: (title: string) => string;
    confirm: string;
    cancel: string;
  };
  toast: {
    restored: string;
  };
  empty: {
    title: string;
    description: string;
  };
  error: string;
  loading: string;
  resultCount: (from: number, to: number, total: number) => string;
  pagination: {
    previous: string;
    next: string;
    rowsPerPage: string;
  };
  filters: {
    heading: string;
    search: string;
    searchPlaceholder: string;
    searchAria: string;
    archiveDate: string;
    archiveFrom: string;
    archiveTo: string;
    originalType: string;
    typePlaceholder: string;
    originalStatus: string;
    department: string;
    allDepartments: string;
    departmentPlaceholder: string;
    archivedBy: string;
    archivedByPlaceholder: string;
    owner: string;
    ownerPlaceholder: string;
    allUsers: string;
    tag: string;
    tagPlaceholder: string;
    reset: string;
    activeCount: (count: number) => string;
    /** Original contract-type options, keyed by the raw filter value. */
    typeOptions: Record<string, string>;
    /** Original business-status options, keyed by the raw filter value ('' = all). */
    statusOptions: Record<string, string>;
  };
}

export const archivedLabels: LexBilingual<ArchivedLabels> = {
  en: {
    title: 'Archive',
    description:
      'Advanced search over archived contracts. Filter by archive date, archiver, and the original status, type, owner, or tag.',
    eyebrow: 'Contracts',
    breadcrumbs: {
      home: 'WatheeqTech',
      contracts: 'Contracts',
      archive: 'Archive',
    },
    kpis: {
      total: 'Archived Contracts',
      active: 'Active Agreements',
      expiring: 'Expiring within 30 days',
      expired: 'Expired Agreements',
    },
    columns: {
      contract: 'Contract Title',
      reference: 'Ref Number',
      counterparty: 'Counterparty',
      type: 'Type',
      startDate: 'Start Date',
      endDate: 'End Date',
      status: 'Status',
      owner: 'Owner',
      archived: 'Archived',
      reason: 'Reason',
      actions: 'Actions',
    },
    rowActions: {
      view: 'View',
      unarchive: 'Unarchive',
      download: 'Download',
    },
    actions: {
      backToContracts: 'Back to contracts',
    },
    restoreConfirm: {
      title: 'Restore contract?',
      description: (title) =>
        `“${title}” will return to the live Contracts register. Its original contract status will not change.`,
      confirm: 'Restore contract',
      cancel: 'Keep archived',
    },
    toast: {
      restored: 'Contract restored from archive',
    },
    empty: {
      title: 'No archived contracts',
      description:
        'No contracts match the current filters. Adjust them or archive a contract from its detail page.',
    },
    error: 'Failed to load archived contracts.',
    loading: 'Loading archived contracts…',
    resultCount: (from, to, total) => `Showing ${from}-${to} of ${total} contracts`,
    pagination: {
      previous: 'Previous',
      next: 'Next',
      rowsPerPage: 'Rows per page',
    },
    filters: {
      heading: 'Search & Filter Archive',
      search: 'Search',
      searchPlaceholder: 'Search by contract reference, title, or counterparty...',
      searchAria: 'Search archived contracts',
      archiveDate: 'Archive date',
      archiveFrom: 'Archived from',
      archiveTo: 'Archived to',
      originalType: 'Original type',
      typePlaceholder: 'Contract Type',
      originalStatus: 'Original status',
      department: 'Department',
      allDepartments: 'Department',
      departmentPlaceholder: 'e.g. Legal',
      archivedBy: 'Archived by',
      archivedByPlaceholder: 'Search users',
      owner: 'Owner',
      ownerPlaceholder: 'Search users',
      allUsers: 'All users',
      tag: 'Tag',
      tagPlaceholder: 'e.g. confidential',
      reset: 'Reset filters',
      activeCount: (count) => `${count} active ${count === 1 ? 'filter' : 'filters'}`,
      typeOptions: {
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
        mou: 'MOU',
        amendment: 'Amendment',
        renewal: 'Renewal',
        other: 'Other',
      },
      statusOptions: {
        '': 'Status',
        draft: 'Draft',
        internal_review: 'Internal Review',
        legal_review: 'Legal Review',
        negotiation: 'Negotiation',
        pending_signature: 'Pending Signature',
        active: 'Active',
        suspended: 'Suspended',
        expired: 'Expired',
        terminated: 'Terminated',
        renewed: 'Renewed',
        cancelled: 'Cancelled',
      },
    },
  },
  ar: {
    title: 'الأرشيف',
    description:
      'بحث متقدّم في العقود المؤرشفة. رشّح حسب تاريخ الأرشفة والمُؤرشِف والحالة الأصلية والنوع والمسؤول أو الوسم.',
    eyebrow: 'العقود',
    breadcrumbs: {
      home: 'وثيقتك',
      contracts: 'العقود',
      archive: 'الأرشيف',
    },
    kpis: {
      total: 'العقود المؤرشفة',
      active: 'عقود نشطة',
      expiring: 'تنتهي خلال 30 يوم',
      expired: 'عقود منتهية',
    },
    columns: {
      contract: 'عنوان العقد',
      reference: 'رقم العقد',
      counterparty: 'الطرف المقابل',
      type: 'نوع العقد',
      startDate: 'تاريخ البدء',
      endDate: 'تاريخ الانتهاء',
      status: 'الحالة',
      owner: 'المسؤول',
      archived: 'تاريخ الأرشفة',
      reason: 'السبب',
      actions: 'إجراءات',
    },
    rowActions: {
      view: 'عرض',
      unarchive: 'إلغاء الأرشفة',
      download: 'تنزيل',
    },
    actions: {
      backToContracts: 'العودة إلى العقود',
    },
    restoreConfirm: {
      title: 'استعادة العقد؟',
      description: (title) =>
        `سيعود «${title}» إلى سجل العقود النشط، ولن تتغير حالة العقد الأصلية.`,
      confirm: 'استعادة العقد',
      cancel: 'إبقاؤه مؤرشفًا',
    },
    toast: {
      restored: 'تمت استعادة العقد من الأرشيف',
    },
    empty: {
      title: 'لا توجد عقود مؤرشفة',
      description:
        'لا توجد عقود مطابقة للمرشّحات الحالية. عدّلها أو أرشِف عقدًا من صفحة تفاصيله.',
    },
    error: 'تعذّر تحميل العقود المؤرشفة.',
    loading: 'جارٍ تحميل العقود المؤرشفة…',
    resultCount: (from, to, total) => `عرض ${from}-${to} من أصل ${total} عقدًا مؤرشفًا`,
    pagination: {
      previous: 'السابق',
      next: 'التالي',
      rowsPerPage: 'عدد الصفوف في الصفحة',
    },
    filters: {
      heading: 'فرز وتصفية الأرشيف',
      search: 'بحث',
      searchPlaceholder: 'البحث برقم العقد أو العنوان أو الطرف المقابل...',
      searchAria: 'البحث في العقود المؤرشفة',
      archiveDate: 'تاريخ الأرشفة',
      archiveFrom: 'مؤرشف من',
      archiveTo: 'مؤرشف إلى',
      originalType: 'النوع الأصلي',
      typePlaceholder: 'نوع العقد',
      originalStatus: 'الحالة الأصلية',
      department: 'الإدارة',
      allDepartments: 'الإدارة',
      departmentPlaceholder: 'مثال: الإدارة القانونية',
      archivedBy: 'المُؤرشِف',
      archivedByPlaceholder: 'ابحث عن مستخدم',
      owner: 'المسؤول',
      ownerPlaceholder: 'ابحث عن مستخدم',
      allUsers: 'جميع المستخدمين',
      tag: 'الوسم',
      tagPlaceholder: 'مثال: سري',
      reset: 'إعادة تعيين المرشّحات',
      activeCount: (count) => `${count} من المرشّحات النشطة`,
      typeOptions: {
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
      statusOptions: {
        '': 'الحالة',
        draft: 'مسودة',
        internal_review: 'مراجعة داخلية',
        legal_review: 'مراجعة قانونية',
        negotiation: 'تفاوض',
        pending_signature: 'بانتظار التوقيع',
        active: 'ساري',
        suspended: 'موقوف',
        expired: 'منتهٍ',
        terminated: 'مُنهى',
        renewed: 'مُجدَّد',
        cancelled: 'ملغى',
      },
    },
  },
};

export function useArchivedLabels(): ArchivedLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveLexBilingual(archivedLabels, locale), [locale]);
}

/**
 * resolveArchivedLabels is the pure resolver for non-React callers/tests.
 */
export function resolveArchivedLabels(locale: AppLocale = 'en'): ArchivedLabels {
  return resolveLexBilingual(archivedLabels, locale === 'ar' ? 'ar' : 'en');
}
